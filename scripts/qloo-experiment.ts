// Phase 3: real Qloo experiment (T2 coverage, T4 originality, T5 with vs. without Qloo).
//
//   npm run qloo:experiment                       # all tests
//   npm run qloo:experiment -- --only t2          # one test; also t4, t5
//   npm run qloo:experiment -- --max-calls 400    # network budget (cached calls are free)
//
// Key: QLOO_API_KEY env var, else the private config written by `qloo setup --qloo`, else a hidden
// prompt. The key is never printed, logged, written to disk or put in a URL.
// Qloo responses are cached privately in data/raw/qloo-cache/ and the full report goes to
// data/raw/qloo-reports/. Both are gitignored: Qloo data must not reach a public repository.
// If authentication fails the script stops: it never falls back to MOCK or prints made-up numbers.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DATASETS } from '../core/api';
import { LiveQlooAdapter } from '../core/qloo/client';
import { loadQlooCredentials, redact } from '../core/qloo/credentials';
import { DEFAULT_CUTOFFS, runComparison, runCoverage, runOriginality, summarizeComparison, summarizeCoverage } from '../core/experiment';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = new Set((opt('only') ?? 't2,t4,t5').split(',').map((s) => s.trim().toLowerCase()));
const maxCalls = Number(opt('max-calls') ?? 800);
const cutoffs = opt('cutoffs')?.split(',') ?? DEFAULT_CUTOFFS;

const CACHE = 'data/raw/qloo-cache';
const REPORTS = 'data/raw/qloo-reports';
mkdirSync(CACHE, { recursive: true });
mkdirSync(REPORTS, { recursive: true });

const creds = await loadQlooCredentials().catch((e: Error) => {
  console.error(`No key: ${e.message}`);
  process.exit(2);
});
const say = (s: string) => console.log(redact(s, creds.apiKey));
say(`Qloo base URL: ${creds.baseUrl} | key from: ${creds.source} | key length: ${creds.apiKey.length} chars (value not shown)`);

// ------------------------------------------------------------------ bounded, cached fetch
let networkCalls = 0;
let cacheHits = 0;
let lastCall = 0;
const statusCounts: Record<string, number> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cachedFetch(url: string, init?: { headers?: Record<string, string> }) {
  const file = `${CACHE}/${createHash('sha1').update(url).digest('hex')}.json`;
  if (existsSync(file)) {
    cacheHits++;
    const { status, body } = JSON.parse(readFileSync(file, 'utf8'));
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  }
  for (let attempt = 0; ; attempt++) {
    if (networkCalls >= maxCalls) throw new Error(`Network budget of ${maxCalls} calls reached (raise --max-calls; cached results are kept).`);
    const wait = 150 - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    networkCalls++;
    const res = await fetch(url, { headers: init?.headers, signal: AbortSignal.timeout(20000) });
    statusCounts[res.status] = (statusCounts[res.status] ?? 0) + 1;
    if (res.status === 429 && attempt < 3) {
      const retryAfter = Number(res.headers.get('retry-after')) || 2 ** (attempt + 1);
      say(`  rate limited (429); waiting ${retryAfter}s`);
      await sleep(retryAfter * 1000);
      continue;
    }
    const body = await res.json().catch(() => null);
    if (res.status === 200 || res.status === 404) writeFileSync(file, JSON.stringify({ status: res.status, body }));
    return { status: res.status, ok: res.ok, json: async () => body };
  }
}

// The serverless per-analysis limits do not apply here: this run has its own --max-calls budget.
const makeQloo = () =>
  new LiveQlooAdapter({ apiKey: creds.apiKey, baseUrl: creds.baseUrl, fetchImpl: cachedFetch, limits: { maxCalls: 1e9, deadlineMs: 6 * 3600_000, concurrency: 4, timeoutMs: 20000, retries: 0 } });

// ------------------------------------------------------------------ 1. authentication (uncached)
function describeBody(b: unknown): string {
  if (!b || typeof b !== 'object') return '';
  const r = b as Record<string, unknown>;
  const msg = r.message ?? r.error ?? (r.errors && JSON.stringify(r.errors));
  return msg ? ` — ${String(msg).slice(0, 200)}` : '';
}
let auth: { status: number | 'network_error'; ok: boolean; detail: string };
try {
  const u = new URL('/search', creds.baseUrl);
  u.searchParams.set('query', 'Lex Fridman');
  u.searchParams.set('types', 'urn:entity:person');
  u.searchParams.set('take', '1');
  const res = await fetch(u, { headers: { 'X-Api-Key': creds.apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  networkCalls++;
  const body = await res.json().catch(() => null);
  const hint: Record<number, string> = {
    401: 'key rejected, or wrong base URL (hackathon keys only work on https://hackathon.api.qloo.com)',
    403: 'forbidden: entity type not enabled for this key, or the key lacks permission',
    429: 'rate limited or quota exhausted',
  };
  auth = { status: res.status, ok: res.status === 200, detail: `${hint[res.status] ?? ''}${describeBody(body)}` };
} catch (e) {
  auth = { status: 'network_error', ok: false, detail: `cannot reach ${creds.baseUrl}: ${String(e)} (proxy, VPN or network policy?)` };
}
say(`\n[1] Authentication: HTTP ${auth.status}${auth.ok ? ' — OK' : ` — FAILED: ${auth.detail}`}`);
if (!auth.ok) {
  say('Stopping. No experiment results are produced without a working key (no MOCK fallback).');
  process.exit(3);
}

// ------------------------------------------------------------------ 2. response shape probes
async function probe(path: string, params: Record<string, string>) {
  const u = new URL(path, creds.baseUrl);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await cachedFetch(u.toString(), { headers: { 'X-Api-Key': creds.apiKey } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> | null };
}
const shape = (v: unknown, depth = 0): unknown =>
  Array.isArray(v) ? (v.length ? [shape(v[0], depth + 1)] : []) : v && typeof v === 'object' && depth < 4 ? Object.fromEntries(Object.entries(v).slice(0, 25).map(([k, x]) => [k, shape(x, depth + 1)])) : typeof v;

const report: Record<string, unknown> = { generatedAt: new Date().toISOString(), baseUrl: creds.baseUrl, auth: { status: auth.status }, cutoffs };
const lexSearch = await probe('/search', { query: 'Lex Fridman', types: 'urn:entity:person', take: '1' });
const lexId = (lexSearch.body?.results as Array<{ entity_id?: string }> | undefined)?.[0]?.entity_id;
report.shapes = { search: shape(lexSearch.body) };
if (lexId) {
  const ins = await probe('/v2/insights', { 'filter.type': 'urn:entity:person', 'signal.interests.entities': lexId, take: '3' });
  const exp = await probe('/v2/insights', { 'filter.type': 'urn:entity:person', 'signal.interests.entities': lexId, 'feature.explainability': 'true', take: '3' });
  const first = ((ins.body?.results as Record<string, unknown> | undefined)?.entities as unknown[] | undefined)?.[0] as Record<string, unknown> | undefined;
  const affinityField = first && typeof (first.query as Record<string, unknown> | undefined)?.affinity === 'number';
  report.shapes = { ...(report.shapes as object), insightsPerson: shape(ins.body), explainabilityPresent: JSON.stringify(exp.body ?? {}).includes('explainab') };
  say(`[2] Shapes: /search ${lexSearch.status}; /v2/insights person ${ins.status}; query.affinity present: ${Boolean(affinityField)}; explainability present: ${(report.shapes as { explainabilityPresent: boolean }).explainabilityPresent}`);
} else {
  say('[2] Shapes: "Lex Fridman" not found as a person in Qloo; insights shape probe skipped.');
}

// ------------------------------------------------------------------ 3. tests
try {
  if (only.has('t2')) {
    say('\n[T2] Coverage of our people in Qloo …');
    const rows = await runCoverage(makeQloo(), DATASETS, cutoffs);
    const s = summarizeCoverage(rows);
    report.t2 = { summary: s, rows };
    const pc = (x: number) => `${Math.round(x * 100)}%`;
    say(`  overall: ${s.overall.total} people, resolved ${pc(s.overall.resolvedRate)} (confirmed ${s.overall.exact_confirmed}, unconfirmed ${s.overall.exact_unconfirmed}, description mismatch ${s.overall.exact_mismatch}), ambiguous ${s.overall.ambiguous}, fuzzy only ${s.overall.fuzzy_only}, not found ${s.overall.not_found}, errors ${s.overall.error}`);
    for (const [id, c] of Object.entries(s.byShow)) say(`  ${id}: ${c.total} people, resolved ${pc(c.resolvedRate)}, ambiguous ${c.ambiguous}, not found ${c.not_found}`);
    say(`  past guests (signals): resolved ${pc(s.byRole.past_guest.resolvedRate)} | candidates: resolved ${pc(s.byRole.candidate.resolvedRate)}`);
  }
  if (only.has('t4')) {
    say('\n[T4] Originality of Qloo person insights …');
    const r = await runOriginality(makeQloo(), DATASETS);
    report.t4 = r;
    for (const x of r) {
      say(`  ${x.showId}: ${x.signalCount} signals → ${x.returned} people: ${x.alreadyGuests.length} already guests, ${x.inOurTop25.length} in our top 25, ${x.inVerifiedPool.length} elsewhere in our feeds, ${x.newToUs.length} new to us`);
      say(`    median popularity — Qloo-new: ${x.medianPopularity.qlooNew ?? 'n/a'} | our top 25: ${x.medianPopularity.ourTop25Resolved ?? 'n/a'} | cultural hooks: ${JSON.stringify(x.culturalHooks)}`);
    }
  }
  if (only.has('t5')) {
    say('\n[T5] Backtests with vs. without Qloo (same candidate base) …');
    const cells = await runComparison(makeQloo, DATASETS, cutoffs);
    const summary = Object.fromEntries(([5, 10, 25] as const).map((k) => [k, summarizeComparison(cells, k)]));
    report.t5 = { cells, summary };
    for (const c of cells) say(`  ${c.showId} @ ${c.cutoff}: reachable ${c.reachable}/${c.hidden} | hits@10 random ${c.random[10]?.toFixed(2)} · without ${c.without[10]} · with Qloo ${c.withQloo[10]} · +discovery ${c.withDiscovery[10]} | top-10 overlap ${c.top10Overlap}/10 | affinity ${c.affinityReceived}/${c.affinityRequested}`);
    const s = summary[10];
    say(`  @10 total: random ${s.hits.random.toFixed(2)}, without ${s.hits.without}, with Qloo ${s.hits.withQloo}; wins/losses/ties ${s.wins}/${s.losses}/${s.ties}; sign test p=${s.signTestP.toFixed(3)}; affinity coverage ${Math.round(s.affinityCoverage * 100)}%${s.noAffinityData ? ' — NO affinity values returned: comparison is not informative' : ''}`);
    say('  Leakage: Qloo’s graph is current; T5 is agreement with today’s graph, not a leakage-free prediction.');
  }
} catch (e) {
  say(`\nStopped early: ${String(e)}`);
  report.stoppedEarly = String(e);
}

report.calls = { network: networkCalls, cached: cacheHits, statusCounts };
const file = `${REPORTS}/experiment-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(file, redact(JSON.stringify(report, null, 1), creds.apiKey));
say(`\nCalls: ${networkCalls} network, ${cacheHits} cached; HTTP ${JSON.stringify(statusCounts)}`);
say(`Full report (private, gitignored): ${file}`);
