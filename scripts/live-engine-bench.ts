// Reproducible benchmark of one public LIVE analysis against a SIMULATED, rate-limited Qloo.
// It measures our engine (call plan, pacing, retries, time), NOT Qloo: the real rate limit and
// latency are unknown, so the simulation uses an explicit hypothesis (see SIM below).
//
//   npx tsx scripts/live-engine-bench.ts [variant] [root]
//     variant: current | develop-c27b28d | pr1   (which engine settings to use)
//     root:    repository checkout to import the engine from (default: this one), e.g. a git worktree
//
// Output: one JSON line per show with calls, 429s, errors, elapsed, health and what Qloo contributed.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const variant = (process.argv[2] ?? 'current') as 'current' | 'develop-c27b28d' | 'pr1';
const root = resolve(process.argv[3] ?? '.');
const SHOWS = (process.env.SHOWS ?? 'diary-of-a-ceo,marco-antonio-regil,creativo,santiago-bilinkis').split(',');

// ---------------------------------------------------------------- simulated Qloo (hypothesis)
const SIM = { latencyMs: Number(process.env.SIM_LATENCY_MS ?? 250), ratePerSec: Number(process.env.SIM_RPS ?? 5), burst: Number(process.env.SIM_BURST ?? 5), retryAfterS: 1 };
let tokens = SIM.burst;
let last = Date.now();
const take = () => {
  const now = Date.now();
  tokens = Math.min(SIM.burst, tokens + ((now - last) / 1000) * SIM.ratePerSec);
  last = now;
  if (tokens >= 1) return (tokens -= 1), true;
  return false;
};
const { ALL_DATASETS } = await import(pathToFileURL(`${root}/core/datasets.ts`).href);
const titles = new Map<string, string>();
for (const d of ALL_DATASETS) for (const e of d.episodes) for (const g of e.guests) titles.set(g.name.toLowerCase(), `${titles.get(g.name.toLowerCase()) ?? ''} ${e.title}`);
const PEOPLE = Array.from({ length: 30 }, (_, i) => ({ entity_id: `SIM-P${i}`, name: `Simulated Person ${i}`, type: 'urn:entity', subtype: 'urn:entity:person', query: { affinity: 1 - i / 40 } }));
globalThis.fetch = (async (input: string | URL, init?: { signal?: AbortSignal }) => {
  await new Promise<void>((ok, ko) => {
    const t = setTimeout(ok, SIM.latencyMs);
    init?.signal?.addEventListener('abort', () => (clearTimeout(t), ko(new Error('aborted'))));
  });
  const u = new URL(String(input));
  if (!take()) return new Response('{"error":"rate limited"}', { status: 429, headers: { 'retry-after': String(SIM.retryAfterS) } });
  const p = u.searchParams;
  let body: unknown = { results: [] };
  if (u.pathname === '/search' && p.get('types') === 'urn:entity:person') {
    const q = p.get('query') ?? '';
    body = { results: [{ entity_id: `SIM-${q}`, name: q, subtype: 'urn:entity:person', type: 'urn:entity', properties: { short_description: titles.get(q.toLowerCase()) ?? '' } }] };
  } else if (u.pathname === '/v2/insights' && p.get('filter.results.entities')) {
    body = { results: { entities: (p.get('filter.results.entities') ?? '').split(',').map((id, i) => ({ entity_id: id, name: id, query: { affinity: 0.9 - i / 100 } })) } };
  } else if (u.pathname === '/v2/insights' && p.get('filter.type') === 'urn:entity:person') {
    body = { results: { entities: PEOPLE } };
  } else if (u.pathname === '/v2/insights') {
    body = { results: { entities: [{ entity_id: `SIM-C-${p.get('filter.type')}`, name: 'Simulated cultural entity', subtype: p.get('filter.type') }] } };
  }
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

// ---------------------------------------------------------------- engine settings per variant
const api = await import(pathToFileURL(`${root}/core/api.ts`).href);
const { LiveQlooAdapter } = await import(pathToFileURL(`${root}/core/qloo/client.ts`).href);
const LIMITS = {
  // develop @ c27b28d: synchronous public path.
  'develop-c27b28d': { maxCalls: 60, concurrency: 4, timeoutMs: 8000, deadlineMs: 40_000, retries: 1 },
  // PR #1: reduced synchronous path.
  pr1: { maxCalls: 24, concurrency: 2, timeoutMs: 2500, deadlineMs: 15_000, retries: 0 },
  // This branch: background job (see core/public-live/handler.ts backgroundLimits).
  current: { maxCalls: 80, concurrency: 3, minIntervalMs: 250, timeoutMs: 10_000, deadlineMs: 180_000, retries: 1, retries429: 3, maxRetryWaitMs: 15_000 },
}[variant];
const env = { PROFILE_LOOKUP: '0', EXTERNAL_VERIFY: '0' };
const opts = variant === 'pr1' ? { publicFast: true, deadlineMs: 20_000 } : variant === 'current' ? { deadlineMs: 200_000 } : undefined;

for (const id of SHOWS) {
  const target = api.DATASETS.find((d: { id: string }) => d.id === id);
  const adapter = new LiveQlooAdapter({ apiKey: 'sim', baseUrl: `https://sim-${variant}-${id}.qloo.test`, limits: LIMITS });
  tokens = SIM.burst;
  const t0 = Date.now();
  const r = await api.recommendFor(target, api.DATASETS.filter((d: { id: string }) => d.id !== id), adapter, env, 5, null, opts);
  const m = adapter.metrics;
  const ok2xx = Object.entries(m.statuses).filter(([s]) => +s >= 200 && +s < 300).reduce((a, [, n]) => a + (n as number), 0);
  const errors = { ...m.errors, ...Object.fromEntries(Object.entries(m.statuses).filter(([s]) => +s >= 400).map(([s, n]) => [`http_${s}`, n])) };
  // Same rule as the public handler (liveHealth): partial only when answers were lost after retries.
  const health = !ok2xx ? 'failed' : (m.lost ?? Object.keys(errors).length) ? 'partial' : 'ok';
  const calls = (r.qlooCalls as Array<{ endpoint: string; params: Record<string, string> }>) ?? [];
  console.log(JSON.stringify({
    variant,
    show: id,
    elapsedS: +((Date.now() - t0) / 1000).toFixed(1),
    networkCalls: m.networkCalls,
    http429: m.statuses[429] ?? 0,
    errors,
    lostAnswers: m.lost ?? null,
    health,
    // What Qloo contributed in this run.
    guestsConfirmed: r.signalDiagnostics.guests.confirmed,
    signal: r.signalStrategy,
    discoveryRan: calls.some((c) => c.endpoint === '/v2/insights' && c.params['filter.type'] === 'urn:entity:person' && !c.params['filter.results.entities']),
    proposals: r.funnel.proposed,
    affinityRan: calls.some((c) => Boolean(c.params['filter.results.entities'])),
    culturalHooks: r.culturalAffinities.reduce((s: number, c: { entities: unknown[] }) => s + c.entities.length, 0),
    top5: r.recommendations.map((x: { name: string }) => x.name),
  }));
}
