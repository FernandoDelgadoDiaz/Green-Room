// Public Qloo LIVE path (/api/discover): limits, failures, kill switch and scope.
// Qloo is a scripted LIVE-shaped adapter here: these tests prove the guard and the handler, not Qloo.
import { describe, expect, it } from 'vitest';
import { cacheKeyFor, MemoryCasStore, PublicGuard, publicConfig, type CasStore } from '../core/public-live/guard';
import { handlePublicLive, liveHealth, RULES_VERSION, runPublicJob, type PublicLiveDeps, type PublicLiveEnv } from '../core/public-live/handler';
import { handleLive } from '../core/api';
import { sha256Hex } from '../core/access';
import { QlooError, type QlooAdapter, type QlooCall } from '../core/qloo/types';

const KEY = 'test-key-never-printed-0123456789';
const ENV: PublicLiveEnv = { QLOO_PUBLIC_ENABLED: 'true', QLOO_API_KEY: KEY, PROFILE_LOOKUP: '0', EXTERNAL_VERIFY: '0' };
const T0 = Date.parse('2026-10-23T12:00:00Z');

/** LIVE-shaped scripted adapter that counts its "network calls" like the real one. */
function scripted(mode: 'ok' | 'down' | 'auth' | 'partial' = 'ok') {
  const metrics = { networkCalls: 0, cacheHits: 0, retries: 0, errors: {} as Record<string, number>, statuses: {} as Record<number, number>, maxInFlight: 1, latenciesMs: [] as number[], startedAt: Date.now() };
  let n = 0;
  const hit = async <T,>(value: T): Promise<T> => {
    metrics.networkCalls++;
    n++;
    if (mode === 'down' || (mode === 'partial' && n % 2 === 0)) {
      metrics.errors.timeout = (metrics.errors.timeout ?? 0) + 1;
      throw new QlooError('Qloo /x timed out', null, 'timeout');
    }
    if (mode === 'auth') {
      metrics.statuses[401] = (metrics.statuses[401] ?? 0) + 1;
      throw new QlooError('Qloo /x HTTP 401', 401);
    }
    metrics.statuses[200] = (metrics.statuses[200] ?? 0) + 1;
    return value;
  };
  const adapter: QlooAdapter & { metrics: typeof metrics } = {
    mode: 'LIVE',
    calls: [] as QlooCall[],
    metrics,
    searchPerson: (name) => hit([{ entityId: `p:${name}`, name, types: ['urn:entity:person'] }]),
    searchPodcast: () => hit([]),
    findTags: () => hit([]),
    personInsights: () => hit([]),
    affinityFor: () => hit(new Map<string, number>()),
    categoryInsights: () => hit([{ entityId: 'a1', name: 'Some Artist', types: ['urn:entity:artist'] }]),
  };
  return adapter;
}

function deps(store: CasStore | null, opts: { mode?: Parameters<typeof scripted>[0]; ip?: string; now?: () => number; built?: QlooAdapter[] } = {}) {
  return {
    store,
    ip: opts.ip ?? '203.0.113.7',
    now: opts.now ?? (() => T0),
    qlooFactory: () => {
      const a = scripted(opts.mode);
      opts.built?.push(a);
      return a;
    },
  };
}

/** Public request as the browser makes it: start (202 + jobId) → background job → poll the outcome. */
async function live(req: unknown, env: PublicLiveEnv, d: PublicLiveDeps) {
  const jobs: Promise<void>[] = [];
  const full: PublicLiveDeps = { ...d, trigger: d.trigger ?? (async (id) => (jobs.push(runPublicJob(id, env, d)), true)) };
  const r = await handlePublicLive(req, env, full);
  if (r.status !== 202) return r;
  await Promise.all(jobs);
  return handlePublicLive({ action: 'job', jobId: (r.body as { jobId: string }).jobId }, env, full);
}

describe('shared guard: limits hold across concurrent requests (CAS on one daily document)', () => {
  it('never over-commits the daily budget, whatever the concurrency', async () => {
    const store = new MemoryCasStore();
    const g = new PublicGuard(store, { ...publicConfig({ PUBLIC_DAILY_QLOO_CALLS: '200', PUBLIC_CALLS_PER_ANALYSIS: '60', PUBLIC_MAX_CONCURRENT: '5', PUBLIC_FRESH_PER_IP_PER_DAY: '20' }) }, () => T0);
    const out = await Promise.all(Array.from({ length: 20 }, (_, i) => g.reserve('catalog', `198.51.100.${i}`)));
    expect(out.filter((r) => r.ok)).toHaveLength(3); // 3 × 60 = 180 ≤ 200; a 4th would be 240
    expect(out.filter((r) => !r.ok).every((r) => !r.ok && r.reason === 'budget')).toBe(true);
    expect((await g.usage()).committed).toBe(180);
  });

  it('caps simultaneous analyses; settling frees the slot and records the real call count', async () => {
    const g = new PublicGuard(new MemoryCasStore(), publicConfig({ PUBLIC_MAX_CONCURRENT: '2' }), () => T0);
    const [a, b, c] = await Promise.all([g.reserve('catalog', '1.1.1.1'), g.reserve('catalog', '2.2.2.2'), g.reserve('catalog', '3.3.3.3')]);
    expect([a.ok, b.ok, c.ok].filter(Boolean)).toHaveLength(2);
    expect([a, b, c].find((r) => !r.ok)).toMatchObject({ reason: 'busy' });
    const first = [a, b].find((r) => r.ok) as { ok: true; leaseId: string };
    await g.settle(first.leaseId, 17);
    expect((await g.usage()).used).toBe(17);
    expect((await g.reserve('catalog', '3.3.3.3')).ok).toBe(true);
  });

  it('a lease never settled (crash) expires and counts its whole reservation as spent', async () => {
    let now = T0;
    const g = new PublicGuard(new MemoryCasStore(), publicConfig({ PUBLIC_CALLS_PER_ANALYSIS: '60' }), () => now);
    expect((await g.reserve('catalog', '1.1.1.1')).ok).toBe(true);
    now += g.cfg.leaseMs + 1000; // longer than a background job may run
    expect(await g.usage()).toMatchObject({ used: 60, inFlight: 0 });
  });

  it('per-visitor and open-search caps, and the pause flag', async () => {
    const g = new PublicGuard(new MemoryCasStore(), publicConfig({ PUBLIC_FRESH_PER_IP_PER_DAY: '2', PUBLIC_OPEN_FEEDS_PER_DAY: '1', PUBLIC_MAX_CONCURRENT: '5' }), () => T0);
    expect((await g.reserve('catalog', '9.9.9.9')).ok).toBe(true);
    expect((await g.reserve('catalog', '9.9.9.9')).ok).toBe(true);
    expect(await g.reserve('catalog', '9.9.9.9')).toEqual({ ok: false, reason: 'visitor_limit' });
    expect((await g.reserve('open', '8.8.8.8')).ok).toBe(true);
    expect(await g.reserve('open', '7.7.7.7')).toEqual({ ok: false, reason: 'open_limit' });
    await g.setPaused(true, 'test');
    expect(await g.reserve('catalog', '6.6.6.6')).toEqual({ ok: false, reason: 'paused' });
  });

  it('does not store raw IP addresses', async () => {
    const store = new MemoryCasStore();
    await new PublicGuard(store, publicConfig({}), () => T0).reserve('catalog', '203.0.113.99');
    expect(JSON.stringify((await store.get('day/2026-10-23'))!.data)).not.toContain('203.0.113.99');
  });
});

describe('public endpoint: scope and switches', () => {
  it('refuses every private/diagnostic action', async () => {
    for (const action of ['compare', 'editorial', 'diagnose', 'public-pause', 'public-resume', 'public-usage', 'backtest', 'shows'])
      expect(await handlePublicLive({ action, showId: 'diary-of-a-ceo' }, ENV, deps(new MemoryCasStore()))).toMatchObject({ status: 400 });
  });

  it('off by default: no switch → 503, and Qloo is never built', async () => {
    const built: QlooAdapter[] = [];
    const r = await live({ action: 'recommend', showId: 'diary-of-a-ceo' }, { ...ENV, QLOO_PUBLIC_ENABLED: undefined }, deps(new MemoryCasStore(), { built }));
    expect(r).toMatchObject({ status: 503, body: { code: 'disabled' } });
    expect(built).toHaveLength(0);
    // The private switch does not turn the public path on.
    expect((await handlePublicLive({ action: 'status' }, { ...ENV, QLOO_PUBLIC_ENABLED: 'false', QLOO_LIVE_ENABLED: 'true' }, deps(new MemoryCasStore()))).body).toMatchObject({ live: false, code: 'disabled' });
  });

  it('fails closed without the shared store (no reliable limit → no Qloo call)', async () => {
    const built: QlooAdapter[] = [];
    const r = await live({ action: 'recommend', showId: 'diary-of-a-ceo' }, ENV, deps(null, { built }));
    expect(r).toMatchObject({ status: 503, body: { code: 'guard_unavailable' } });
    const broken: CasStore = { get: async () => { throw new Error('blobs down'); }, set: async () => false, put: async () => undefined };
    expect(await live({ action: 'recommend', showId: 'diary-of-a-ceo' }, ENV, deps(broken, { built }))).toMatchObject({ status: 503, body: { code: 'guard_unavailable' } });
    expect(built).toHaveLength(0);
  });

  it('status never exposes the key', async () => {
    const r = await handlePublicLive({ action: 'status' }, ENV, deps(new MemoryCasStore()));
    expect(r.body).toMatchObject({ live: true, code: null });
    expect(JSON.stringify(r.body)).not.toContain(KEY);
  });
});

describe('public endpoint: LIVE results, cache and honest failures', () => {
  it('runs LIVE once, labels it, includes the baseline comparison, then serves it from cache at zero Qloo cost', async () => {
    const store = new MemoryCasStore();
    const built: QlooAdapter[] = [];
    const r1 = await live({ action: 'recommend', showId: 'diary-of-a-ceo' }, ENV, deps(store, { built }));
    expect(r1.status).toBe(200);
    const b1 = r1.body as { live: { mode: string; cached: boolean; qlooCalls: number }; qlooMode: string; comparison: unknown; recommendations: unknown[] };
    expect(b1.live).toMatchObject({ mode: 'LIVE', cached: false });
    expect(b1.live.qlooCalls).toBeGreaterThan(0);
    expect(b1.qlooMode).toBe('LIVE');
    expect(b1.comparison).not.toBeNull();
    expect(JSON.stringify(b1)).not.toContain(KEY);
    const r2 = await live({ action: 'recommend', showId: 'diary-of-a-ceo' }, ENV, deps(store, { built, ip: '198.51.100.1' }));
    expect((r2.body as { live: { cached: boolean } }).live.cached).toBe(true);
    expect(built).toHaveLength(1);
    const usage = await new PublicGuard(store, publicConfig(ENV), () => T0).usage();
    expect(usage).toMatchObject({ analyses: 1, used: b1.live.qlooCalls, inFlight: 0 });
  });

  it('Qloo down → 502 with an explanation and retry; no result, no MOCK, nothing cached', async () => {
    const store = new MemoryCasStore();
    const r = await live({ action: 'recommend', showId: 'creativo' }, ENV, deps(store, { mode: 'down' }));
    expect(r).toMatchObject({ status: 502, body: { code: 'qloo_unavailable', retry: true } });
    expect(JSON.stringify(r.body)).not.toMatch(/recommendations|MOCK/);
    expect(await new PublicGuard(store, publicConfig(ENV), () => T0).cached('show-x')).toBeNull();
  });

  it('Qloo rejects the key → 502 qloo_auth (the key itself is never echoed)', async () => {
    const r = await live({ action: 'recommend', showId: 'creativo' }, ENV, deps(new MemoryCasStore(), { mode: 'auth' }));
    expect(r).toMatchObject({ status: 502, body: { code: 'qloo_auth' } });
    expect(JSON.stringify(r.body)).not.toContain(KEY);
  });

  it('partial results are labeled partial and cached only for PUBLIC_PARTIAL_CACHE_HOURS (default 1 h)', async () => {
    let now = T0;
    const store = new MemoryCasStore();
    const built: QlooAdapter[] = [];
    const r = await live({ action: 'recommend', showId: 'diary-of-a-ceo' }, ENV, deps(store, { mode: 'partial', built, now: () => now }));
    expect(r.status).toBe(200);
    expect((r.body as { live: { partial: boolean; errors: Record<string, number> } }).live).toMatchObject({ partial: true, errors: { timeout: expect.any(Number) } });
    const again = await live({ action: 'recommend', showId: 'diary-of-a-ceo' }, ENV, deps(store, { built, ip: '198.51.100.2', now: () => now }));
    expect((again.body as { live: { cached: boolean; partial: boolean } }).live).toMatchObject({ cached: true, partial: true });
    expect(built).toHaveLength(1);
    now += 61 * 60_000;
    await live({ action: 'recommend', showId: 'diary-of-a-ceo' }, ENV, deps(store, { built, ip: '198.51.100.3', now: () => now }));
    expect(built).toHaveLength(2); // partial entry expired: a new run
  });

  it('a cached result from older agent rules is recomputed on the next visit', async () => {
    const store = new MemoryCasStore();
    const built: QlooAdapter[] = [];
    await live({ action: 'recommend', showId: 'diary-of-a-ceo' }, ENV, deps(store, { built }));
    const key = `result/${cacheKeyFor('show', 'diary-of-a-ceo')}`;
    const saved = (await store.get(key))!.data as { body: { rules?: number } };
    expect(saved.body.rules).toBe(RULES_VERSION);
    // The same entry as written before the rules version existed: still fresh by time, but older rules.
    delete saved.body.rules;
    await store.put(key, saved);
    await live({ action: 'recommend', showId: 'diary-of-a-ceo' }, ENV, deps(store, { built, ip: '198.51.100.9' }));
    expect(built).toHaveLength(2);
  });

  it('when a limit refuses a new run, an earlier dated LIVE result is offered (never MOCK)', async () => {
    let now = T0;
    const store = new MemoryCasStore();
    await live({ action: 'recommend', showId: 'diary-of-a-ceo' }, ENV, deps(store, { now: () => now }));
    now += 25 * 3600_000; // cache expired
    await new PublicGuard(store, publicConfig(ENV), () => now).setPaused(true, 'incident');
    const r = await live({ action: 'recommend', showId: 'diary-of-a-ceo' }, ENV, deps(store, { now: () => now }));
    expect(r).toMatchObject({ status: 503, body: { code: 'paused', staleLive: { live: { mode: 'LIVE', stale: true } } } });
  });

  it('liveHealth: no successful answer is a failure, an auth error is a failure', () => {
    expect(liveHealth({ networkCalls: 3, cacheHits: 0, retries: 0, errors: { timeout: 3 }, statuses: {}, maxInFlight: 1, latenciesMs: [], startedAt: 0 }).state).toBe('failed');
    expect(liveHealth({ networkCalls: 3, cacheHits: 0, retries: 0, errors: {}, statuses: { 200: 2, 403: 1 }, maxInFlight: 1, latenciesMs: [], startedAt: 0 })).toMatchObject({ state: 'failed', code: 'qloo_auth' });
    expect(liveHealth({ networkCalls: 3, cacheHits: 0, retries: 0, errors: {}, statuses: { 200: 3 }, maxInFlight: 1, latenciesMs: [], startedAt: 0 }).state).toBe('ok');
  });
});

describe('public endpoint: open search shows (Apple directory only)', () => {
  const NAMES = ['Lucía Pérez', 'Martín Gómez', 'Sofía Díaz', 'Julián Torres', 'Valeria Ruiz', 'Diego Morales', 'Camila Rojas', 'Tomás Herrera', 'Paula Méndez', 'Nicolás Castro', 'Elena Vidal', 'Bruno Silva'];
  const rss = (title: string) =>
    `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><language>es</language><itunes:author>Ana Conductora</itunes:author>${NAMES.map((n, i) => `<item><guid>g${i}</guid><title>${n}: la vida y la ciencia de los datos</title><pubDate>${new Date(`2026-0${(i % 9) + 1}-10T00:00:00Z`).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
  const apple = (feedUrl: string) => async () => ({ results: [{ kind: 'podcast', collectionId: 4242, collectionName: 'Show de Prueba', artistName: 'Ana Conductora', feedUrl, collectionViewUrl: 'https://podcasts.apple.com/podcast/id4242' }] });

  it('the feed address comes from Apple’s directory, not from the client; the feed is analyzed LIVE', async () => {
    const asked: string[] = [];
    const r = await live({ action: 'analyze', appleId: 4242, feedUrl: 'https://evil.example/x' }, ENV, {
      ...deps(new MemoryCasStore()),
      fetchJson: apple('https://feeds.example.com/show.rss'),
      fetchText: async (u) => (asked.push(u), { url: u, status: 200, contentType: 'application/rss+xml', text: rss('Show de Prueba') }),
    });
    expect(asked).toEqual(['https://feeds.example.com/show.rss']);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ analysis: { level: 'complete' }, result: { live: { mode: 'LIVE' } } });
  });

  it('a feed whose title does not match Apple’s entry is refused before any Qloo call', async () => {
    const built: QlooAdapter[] = [];
    const r = await live({ action: 'analyze', appleId: 4242 }, ENV, {
      ...deps(new MemoryCasStore(), { built }),
      fetchJson: apple('https://feeds.example.com/show.rss'),
      fetchText: async (u) => ({ url: u, status: 200, contentType: 'application/rss+xml', text: rss('Otro Programa Distinto') }),
    });
    expect(r).toMatchObject({ status: 422, body: { code: 'feed_mismatch' } });
    expect(built).toHaveLength(0);
  });

  it('SSRF protection still applies to the feed Apple lists', async () => {
    const r = await live({ action: 'analyze', appleId: 4242 }, ENV, { ...deps(new MemoryCasStore()), fetchJson: apple('https://127.0.0.1/feed') });
    expect(r).toMatchObject({ status: 400, body: { code: 'unsafe_feed' } });
  });

  it('rejects a non-numeric appleId', async () => {
    expect(await live({ action: 'analyze', appleId: '../../etc' }, ENV, deps(new MemoryCasStore()))).toMatchObject({ status: 400 });
  });
});

describe('emergency pause from the private endpoint (no redeploy)', () => {
  const TOKEN = 'operator-token-0123456789abcdef0123456789';
  const PENV = { ...ENV, LIVE_ACCESS_TOKEN_SHA256: sha256Hex(TOKEN) };
  it('pause stops new public Qloo runs at once; resume restores them; needs the private token', async () => {
    const store = new MemoryCasStore();
    expect(await handleLive({ action: 'public-pause' }, PENV, 'Bearer wrong-token-wrong-token-wrong-token', { store })).toMatchObject({ status: 401 });
    expect(await handleLive({ action: 'public-pause', note: 'incident' }, PENV, `Bearer ${TOKEN}`, { store })).toMatchObject({ status: 200, body: { control: { paused: true } } });
    const built: QlooAdapter[] = [];
    // public-usage reads the real clock, so the runs use it too (a fixed T0 would land on another UTC day).
    const now = () => Date.now();
    expect(await live({ action: 'recommend', showId: 'diary-of-a-ceo' }, ENV, deps(store, { built, now }))).toMatchObject({ status: 503, body: { code: 'paused' } });
    expect(built).toHaveLength(0);
    await handleLive({ action: 'public-resume' }, PENV, `Bearer ${TOKEN}`, { store });
    expect((await live({ action: 'recommend', showId: 'diary-of-a-ceo' }, ENV, deps(store, { built, now }))).status).toBe(200);
    const usage = await handleLive({ action: 'public-usage' }, PENV, `Bearer ${TOKEN}`, { store });
    expect(usage.body).toMatchObject({ publicEnabled: true, control: { paused: false }, usage: { analyses: 1 } });
  });
});

describe('public endpoint: Qloo coverage per market (counts only)', () => {
  it('records each live run and returns its coverage, with the show’s verified country and no Qloo content', async () => {
    const store = new MemoryCasStore();
    await live({ action: 'recommend', showId: 'diary-of-a-ceo' }, ENV, deps(store));
    const r = await handlePublicLive({ action: 'coverage' }, ENV, deps(store));
    expect(r.status).toBe(200);
    const rows = (r.body as { rows: Array<Record<string, unknown>> }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ showId: 'diary-of-a-ceo', country: 'gb', guestsSearched: expect.any(Number), audienceKnown: expect.any(Boolean) });
    expect(JSON.stringify(rows)).not.toMatch(/Some Artist|recommendations/);
  });

  it('answers with an empty list when nothing was analyzed or there is no store', async () => {
    expect((await handlePublicLive({ action: 'coverage' }, ENV, deps(new MemoryCasStore()))).body).toEqual({ rows: [] });
    expect((await handlePublicLive({ action: 'coverage' }, ENV, deps(null))).body).toEqual({ rows: [] });
  });
});
