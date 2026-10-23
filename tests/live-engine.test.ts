// LIVE engine fixes: Qloo rate limiting (429), call plan inside the budget, and background jobs.
// Qloo is simulated here (fake fetch / scripted adapter). These tests prove our behavior, not Qloo's.
import { describe, expect, it } from 'vitest';
import { LiveQlooAdapter } from '../core/qloo/client';
import { runAgent, GUEST_SIGNAL_TARGET } from '../core/agent/agent';
import { DATASETS, ORIGIN_OF } from '../core/api';
import { nameKey } from '../core/names';
import type { QlooAdapter, QlooCall, QlooEntity } from '../core/qloo/types';
import { MemoryCasStore, PublicGuard, publicConfig } from '../core/public-live/guard';
import { handlePublicLive, runPublicJob, type PublicLiveDeps, type PublicLiveEnv } from '../core/public-live/handler';

// ------------------------------------------------------------------ 429 handling in the client
function rateLimitedFetch(opts: { limitEvery?: number; retryAfterS?: number } = {}) {
  const starts: number[] = [];
  let n = 0;
  const impl = async () => {
    starts.push(Date.now());
    n++;
    const limited = opts.limitEvery ? n % opts.limitEvery === 0 : false;
    return {
      status: limited ? 429 : 200,
      ok: !limited,
      headers: { get: (h: string) => (limited && h.toLowerCase() === 'retry-after' ? String(opts.retryAfterS ?? 1) : null) },
      json: async () => ({ results: [] }),
    };
  };
  return { impl, starts };
}

describe('Qloo client under rate limiting', () => {
  it('spaces request starts (minIntervalMs) instead of bursting', async () => {
    const f = rateLimitedFetch();
    const q = new LiveQlooAdapter({ apiKey: 'k', fetchImpl: f.impl, limits: { concurrency: 6, minIntervalMs: 60 } });
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map((x) => q.searchPerson(x)));
    const gaps = f.starts.slice(1).map((t, i) => t - f.starts[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(50);
  });

  it('on 429 honors Retry-After for every request, halves concurrency, retries, and counts each attempt', async () => {
    const f = rateLimitedFetch({ limitEvery: 3, retryAfterS: 1 });
    const q = new LiveQlooAdapter({ apiKey: 'k', fetchImpl: f.impl, limits: { concurrency: 4, retries: 0, retries429: 2, maxRetryWaitMs: 1000, deadlineMs: 20_000 } });
    const t0 = Date.now();
    const out = await Promise.allSettled(['a', 'b', 'c', 'd'].map((x) => q.searchPerson(x)));
    expect(out.every((o) => o.status === 'fulfilled')).toBe(true); // all recovered
    expect(q.metrics.statuses[429]).toBeGreaterThan(0);
    expect(q.metrics.networkCalls).toBe(f.starts.length); // retries are real calls and are counted
    // After the 429, no request started before the Retry-After cool-down ended.
    const first429 = f.starts[2];
    expect(f.starts.filter((t) => t > first429).every((t) => t - first429 >= 950)).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(950);
  });

  it('never retries past the call budget', async () => {
    const f = rateLimitedFetch({ limitEvery: 1, retryAfterS: 0 });
    const q = new LiveQlooAdapter({ apiKey: 'k', fetchImpl: f.impl, limits: { maxCalls: 3, retries429: 10, maxRetryWaitMs: 1 } });
    await Promise.allSettled(['a', 'b'].map((x) => q.searchPerson(x)));
    expect(q.metrics.networkCalls).toBeLessThanOrEqual(3);
    expect(q.budgetLeft()).toBe(0);
  });
});

// ------------------------------------------------------------------ the call plan fits the budget
const titles = new Map<string, string[]>();
for (const d of DATASETS) for (const e of d.episodes) for (const g of e.guests) titles.set(nameKey(g.name), [...(titles.get(nameKey(g.name)) ?? []), e.title]);

/** Scripted LIVE adapter: confirms every person searched (description = their real interview titles). */
function counting(budget = Infinity) {
  const count: Record<string, number> = {};
  let used = 0;
  const c = (k: string) => ((count[k] = (count[k] ?? 0) + 1), used++);
  const people: QlooEntity[] = Array.from({ length: 30 }, (_, i) => ({ entityId: `Q${i}`, name: `Proposed Person ${i}`, types: ['urn:entity:person'] }));
  const q: QlooAdapter = {
    mode: 'LIVE',
    calls: [] as QlooCall[],
    budgetLeft: () => Math.max(0, budget - used),
    searchPerson: async (name) => (c('searchPerson'), [{ entityId: `p:${nameKey(name)}`, name, types: ['urn:entity:person'], description: titles.get(nameKey(name))?.join(' ') }]),
    searchPodcast: async () => (c('searchPodcast'), []),
    findTags: async () => (c('findTags'), []),
    personInsights: async () => (c('personInsights'), people),
    affinityFor: async () => (c('affinityFor'), new Map<string, number>()),
    categoryInsights: async () => (c('categoryInsights'), []),
  };
  return { q, count, used: () => used };
}

describe('call plan: Qloo value first, inside the budget', () => {
  const doac = DATASETS.find((d) => d.id === 'diary-of-a-ceo')!;
  const others = DATASETS.filter((d) => d.id !== doac.id);

  it('stops guest lookups once the signal has enough confirmed identities', async () => {
    const { q } = counting();
    const r = await runAgent({ target: doac, others, qloo: q, originOf: ORIGIN_OF });
    expect(r.signalDiagnostics.guests.confirmed).toBeGreaterThanOrEqual(GUEST_SIGNAL_TARGET);
    expect(r.signalDiagnostics.guests.searched).toBeLessThan(25);
    expect(r.signalStrategy).toBe('guests');
  });

  it('discovery always runs; cultural hooks are skipped (and said so) when the budget is short, with no budget errors', async () => {
    const { q, count, used } = counting(30);
    const r = await runAgent({ target: doac, others, qloo: q, originOf: ORIGIN_OF });
    expect(count.personInsights).toBeGreaterThanOrEqual(1);
    expect(used()).toBeLessThanOrEqual(30);
    const hooks = r.trace.find((s) => /cross-domain/.test(s.title));
    expect(hooks?.detail).toMatch(/Skipped: the Qloo call budget/);
    expect(count.categoryInsights ?? 0).toBe(0);
  });

  it('affinity lookups only cover candidates the editorial band lets affinity reorder', async () => {
    const { q, count } = counting();
    const r = await runAgent({ target: doac, others, qloo: q, originOf: ORIGIN_OF });
    const step = r.trace.find((s) => /Score candidates against/.test(s.title))!;
    expect(step.detail).toMatch(/inside the editorial band/);
    // Guest lookups + band lookups stay well under the old 25 + 40.
    expect(count.searchPerson).toBeLessThan(65);
  });
});

// ------------------------------------------------------------------ background jobs
const KEY = 'test-key-never-printed-0123456789';
const ENV: PublicLiveEnv = { QLOO_PUBLIC_ENABLED: 'true', QLOO_API_KEY: KEY, PROFILE_LOOKUP: '0', EXTERNAL_VERIFY: '0' };
const T0 = Date.parse('2026-10-23T12:00:00Z');

function scriptedLive(built: unknown[]) {
  return () => {
    const metrics = { networkCalls: 0, cacheHits: 0, retries: 0, errors: {} as Record<string, number>, statuses: {} as Record<number, number>, maxInFlight: 1, latenciesMs: [] as number[], startedAt: Date.now() };
    const hit = async <T,>(v: T) => ((metrics.networkCalls++, (metrics.statuses[200] = (metrics.statuses[200] ?? 0) + 1)), v);
    const a = { mode: 'LIVE' as const, calls: [] as QlooCall[], metrics, searchPerson: (n: string) => hit([{ entityId: `p:${n}`, name: n }]), searchPodcast: () => hit([]), findTags: () => hit([]), personInsights: () => hit([]), affinityFor: () => hit(new Map<string, number>()), categoryInsights: () => hit([]) };
    built.push(a);
    return a;
  };
}

describe('public LIVE runs as a background job', () => {
  it('start → 202 with a job id → poll 202 while queued → 200 with the LIVE result', async () => {
    const store = new MemoryCasStore();
    const built: unknown[] = [];
    let queued = '';
    const d: PublicLiveDeps = { store, ip: '1.2.3.4', now: () => T0, qlooFactory: scriptedLive(built), trigger: async (id) => ((queued = id), true) };
    const start = await handlePublicLive({ action: 'recommend', showId: 'creativo' }, ENV, d);
    expect(start).toMatchObject({ status: 202, body: { status: 'queued' } });
    expect(await handlePublicLive({ action: 'job', jobId: queued }, ENV, d)).toMatchObject({ status: 202, body: { status: 'queued' } });
    await runPublicJob(queued, ENV, d);
    const done = await handlePublicLive({ action: 'job', jobId: queued }, ENV, d);
    expect(done.status).toBe(200);
    expect((done.body as { live: { mode: string } }).live.mode).toBe('LIVE');
    // Running the same job again (Netlify retry, repeated POST) does nothing.
    await runPublicJob(queued, ENV, d);
    expect(built).toHaveLength(1);
  });

  it('a second visitor asking for the same show joins the running job (one reservation, one Qloo run)', async () => {
    const store = new MemoryCasStore();
    const ids: string[] = [];
    const d = (ip: string): PublicLiveDeps => ({ store, ip, now: () => T0, qlooFactory: scriptedLive([]), trigger: async (id) => (ids.push(id), true) });
    const a = await handlePublicLive({ action: 'recommend', showId: 'creativo' }, ENV, d('1.1.1.1'));
    const b = await handlePublicLive({ action: 'recommend', showId: 'creativo' }, ENV, d('2.2.2.2'));
    expect((b.body as { jobId: string; shared: boolean })).toMatchObject({ jobId: (a.body as { jobId: string }).jobId, shared: true });
    expect(ids).toHaveLength(1);
    expect((await new PublicGuard(store, publicConfig(ENV), () => T0).usage()).analyses).toBe(1);
  });

  it('a job that never starts is reported as stalled; a failed trigger releases the reservation', async () => {
    let now = T0;
    const store = new MemoryCasStore();
    let queued = '';
    const d: PublicLiveDeps = { store, ip: '1.2.3.4', now: () => now, trigger: async (id) => ((queued = id), true) };
    await handlePublicLive({ action: 'recommend', showId: 'creativo' }, ENV, d);
    now += 91_000;
    expect(await handlePublicLive({ action: 'job', jobId: queued }, ENV, d)).toMatchObject({ status: 502, body: { code: 'stalled', retry: true } });

    const store2 = new MemoryCasStore();
    const r = await handlePublicLive({ action: 'recommend', showId: 'creativo' }, ENV, { store: store2, ip: '1.2.3.4', now: () => T0, trigger: async () => false });
    expect(r).toMatchObject({ status: 502, body: { code: 'start_failed' } });
    expect(await new PublicGuard(store2, publicConfig(ENV), () => T0).usage()).toMatchObject({ used: 0, inFlight: 0 });
  });

  it('a pause that arrives while the job is queued stops it before any Qloo call', async () => {
    const store = new MemoryCasStore();
    const built: unknown[] = [];
    let queued = '';
    const d: PublicLiveDeps = { store, ip: '1.2.3.4', now: () => T0, qlooFactory: scriptedLive(built), trigger: async (id) => ((queued = id), true) };
    await handlePublicLive({ action: 'recommend', showId: 'creativo' }, ENV, d);
    await new PublicGuard(store, publicConfig(ENV), () => T0).setPaused(true, 'incident');
    await runPublicJob(queued, ENV, d);
    expect(await handlePublicLive({ action: 'job', jobId: queued }, ENV, d)).toMatchObject({ status: 503, body: { code: 'paused' } });
    expect(built).toHaveLength(0);
    expect((await new PublicGuard(store, publicConfig(ENV), () => T0).usage()).inFlight).toBe(0);
  });

  it('without a way to start jobs, nothing is reserved (fail closed)', async () => {
    const store = new MemoryCasStore();
    expect(await handlePublicLive({ action: 'recommend', showId: 'creativo' }, ENV, { store, ip: '1.2.3.4', now: () => T0 })).toMatchObject({ status: 503, body: { code: 'guard_unavailable' } });
    expect((await new PublicGuard(store, publicConfig(ENV), () => T0).usage()).analyses).toBe(0);
  });

  it('rejects malformed job ids', async () => {
    expect(await handlePublicLive({ action: 'job', jobId: '../../x' }, ENV, { store: new MemoryCasStore(), ip: null })).toMatchObject({ status: 400 });
  });
});
