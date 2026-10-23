import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { handleApi, handleLive } from '../core/api';
import { HourlyQuota, limitsFromEnv, sha256Hex, verifyBearer } from '../core/access';
import { LiveQlooAdapter } from '../core/qloo/client';

const TOKEN = 'test-token-0123456789abcdefghijklmnopqrstuvwxyz';
const KEY = 'qloo-secret-key-SHOULD-NEVER-LEAK';
const liveEnv = (extra: Record<string, string> = {}) => ({ QLOO_LIVE_ENABLED: 'true', QLOO_API_KEY: KEY, LIVE_ACCESS_TOKEN_SHA256: sha256Hex(TOKEN), PROFILE_LOOKUP: '0', EXTERNAL_VERIFY: '0', ...extra });
const auth = `Bearer ${TOKEN}`;

/** Fake Qloo with documented shapes and a configurable latency; records the headers it saw. */
function fakeQloo(latencyMs = 0, status = 200) {
  const seen: Array<{ url: string; key?: string }> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const impl = vi.fn(async (input: string | URL, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => {
    const url = String(input);
    seen.push({ url, key: init?.headers?.['X-Api-Key'] });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, latencyMs);
      init?.signal?.addEventListener('abort', () => (clearTimeout(t), reject(new Error('aborted'))));
    }).finally(() => inFlight--);
    const u = new URL(url);
    const body =
      u.pathname === '/search'
        ? { results: [{ entity_id: `p:${u.searchParams.get('query')}`, name: u.searchParams.get('query'), properties: { short_description: 'Podcast guest' } }] }
        : { results: { entities: (u.searchParams.get('filter.results.entities') ?? '').split(',').filter(Boolean).map((id, i) => ({ entity_id: id, name: id.slice(2), query: { affinity: 0.9 - i * 0.01 } })) } };
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
  return { impl, seen, maxInFlight: () => maxInFlight };
}

afterEach(() => vi.unstubAllGlobals());

describe('public endpoint never uses LIVE', () => {
  it('stays MOCK even with a key and the switch on', async () => {
    const f = fakeQloo();
    vi.stubGlobal('fetch', f.impl);
    const shows = (await handleApi({ action: 'shows' }, liveEnv())).body as { qlooMode: string };
    expect(shows.qlooMode).toBe('MOCK');
    const rec = (await handleApi({ action: 'recommend', showId: 'diary-of-a-ceo' }, liveEnv())).body as { qlooMode: string };
    expect(rec.qlooMode).toBe('MOCK');
    expect(f.impl).not.toHaveBeenCalled();
  });

  it('Netlify functions: public reads no Qloo env; both declare a code-based rate limit', () => {
    const pub = readFileSync('netlify/functions/agent.ts', 'utf8');
    const live = readFileSync('netlify/functions/live.ts', 'utf8');
    expect(pub).not.toMatch(/QLOO_API_KEY|QLOO_LIVE_ENABLED/);
    expect(pub).toMatch(/rateLimit: \{ windowLimit: 60/);
    expect(live).toMatch(/rateLimit: \{ windowLimit: 6, windowSize: 60/);
    expect(live).toMatch(/path: '\/api\/live'/);
  });

  it('the frontend bundle source contains no token or hash', () => {
    const app = readFileSync('src/App.tsx', 'utf8') + readFileSync('src/api.ts', 'utf8');
    expect(app).not.toMatch(/[0-9a-f]{64}/);
    expect(app).toMatch(/sessionStorage/);
  });
});

describe('private endpoint access control', () => {
  it('rejects when unconfigured, without a token, with a wrong or short token', async () => {
    expect((await handleLive({ action: 'status' }, { QLOO_API_KEY: KEY }, auth)).status).toBe(503);
    expect((await handleLive({ action: 'status' }, liveEnv(), null)).status).toBe(401);
    expect((await handleLive({ action: 'status' }, liveEnv(), 'Bearer wrong-token-wrong-token-wrong-token-xx')).status).toBe(401);
    expect(verifyBearer('Bearer short', liveEnv())).toBeNull();
    expect(verifyBearer(auth, liveEnv())).toBe(sha256Hex(TOKEN));
  });

  it('a valid token with the switch off stays MOCK and says why', async () => {
    const r = await handleLive({ action: 'status' }, liveEnv({ QLOO_LIVE_ENABLED: 'false' }), auth);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ mode: 'MOCK', reason: expect.stringMatching(/QLOO_LIVE_ENABLED/) });
    const noKey = await handleLive({ action: 'status' }, { ...liveEnv(), QLOO_API_KEY: '' }, auth);
    expect(noKey.status).toBe(403);
  });

  it('runs LIVE within the call budget, never echoes the key, and reports metrics', async () => {
    const f = fakeQloo(5);
    vi.stubGlobal('fetch', f.impl);
    const r = await handleLive({ action: 'recommend', showId: 'diary-of-a-ceo' }, liveEnv({ QLOO_MAX_CALLS_PER_ANALYSIS: '12', QLOO_CONCURRENCY: '3' }), auth);
    expect(r.status).toBe(200);
    const b = r.body as { qlooMode: string; warnings: string[]; qlooMetrics: { networkCalls: number; maxInFlight: number; errors: Record<string, number> } };
    expect(b.qlooMode).toBe('LIVE');
    expect(b.qlooMetrics.networkCalls).toBeLessThanOrEqual(12);
    expect(b.qlooMetrics.maxInFlight).toBeLessThanOrEqual(3);
    expect(b.qlooMetrics.errors.budget).toBeGreaterThan(0);
    expect(b.warnings.some((w) => /budget/.test(w))).toBe(true);
    expect(f.seen.every((s) => s.key === KEY && !s.url.includes(KEY))).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(KEY);
  });

  it('LIVE recommend carries the baseline comparison, the funnel and the verified origin; public stays MOCK without them', async () => {
    vi.stubGlobal('fetch', fakeQloo().impl);
    const r = await handleLive({ action: 'recommend', showId: 'creativo' }, liveEnv(), auth);
    expect(r.status).toBe(200);
    const b = r.body as { comparison: { k: number; proposed: number; baselineTop: string[] } | null; funnel: { proposed: number }; origin: { country: string } };
    expect(b.comparison).not.toBeNull();
    expect(b.comparison!.baselineTop.length).toBe(b.comparison!.k);
    expect(b.comparison!.proposed).toBe(b.funnel.proposed);
    expect(b.origin.country).toBe('mx');
    const pub = await handleApi({ action: 'recommend', showId: 'creativo' }, liveEnv());
    expect((pub.body as { qlooMode: string; comparison: unknown }).qlooMode).toBe('MOCK');
    expect((pub.body as { comparison: unknown }).comparison).toBeNull();
  });

  it('diagnose auth reports a rejected key without leaking it', async () => {
    vi.stubGlobal('fetch', fakeQloo(0, 401).impl);
    const r = await handleLive({ action: 'diagnose', test: 'auth' }, liveEnv(), auth);
    expect(r.body).toMatchObject({ test: 'auth', authenticated: false, qlooStatus: 401 });
    expect(JSON.stringify(r.body)).not.toContain(KEY);
  });

  it('diagnose t2/t4 return aggregates without Qloo descriptions', async () => {
    vi.stubGlobal('fetch', fakeQloo().impl);
    const t2 = await handleLive({ action: 'diagnose', test: 't2', showId: 'lex-fridman' }, liveEnv(), auth);
    expect(t2.status).toBe(200);
    expect(JSON.stringify(t2.body)).not.toContain('Podcast guest');
    expect((t2.body as { overall: { total: number } }).overall.total).toBeGreaterThan(0);
    const t4 = await handleLive({ action: 'diagnose', test: 't4', showId: 'lex-fridman' }, liveEnv(), auth);
    expect(Object.keys(t4.body as object)).toEqual(expect.arrayContaining(['signals', 'returned', 'newToUs', 'qlooMetrics']));
  });

  it('hourly quota per token', async () => {
    vi.stubGlobal('fetch', fakeQloo().impl);
    const env = liveEnv({ LIVE_MAX_ANALYSES_PER_HOUR: '2', LIVE_ACCESS_TOKEN_SHA256: sha256Hex(`${TOKEN}-q`) });
    const a = `Bearer ${TOKEN}-q`;
    for (let i = 0; i < 2; i++) expect((await handleLive({ action: 'diagnose', test: 'auth' }, env, a)).status).toBe(200);
    expect((await handleLive({ action: 'diagnose', test: 'auth' }, env, a)).status).toBe(429);
    const q = new HourlyQuota(() => 0);
    expect(q.take('x', 1).ok).toBe(true);
    expect(q.take('x', 1).ok).toBe(false);
  });

  it('limits are clamped and the deadline stays under Netlify’s 60 s', () => {
    expect(limitsFromEnv({ QLOO_DEADLINE_MS: '999999', QLOO_CONCURRENCY: '100', QLOO_MAX_CALLS_PER_ANALYSIS: '5000' })).toMatchObject({ deadlineMs: 50000, concurrency: 10, maxCalls: 200 });
    expect(limitsFromEnv({})).toMatchObject({ maxCalls: 80, concurrency: 6, timeoutMs: 8000, deadlineMs: 45000 });
  });
});

describe('client limits', () => {
  it('times out slow requests and retries once', async () => {
    const f = fakeQloo(200);
    const q = new LiveQlooAdapter({ apiKey: 'k', fetchImpl: f.impl as never, limits: { timeoutMs: 50, retries: 1 } });
    await expect(q.searchPerson('x')).rejects.toMatchObject({ kind: 'timeout' });
    expect(q.metrics.retries).toBe(1);
    expect(q.metrics.networkCalls).toBe(2);
  });

  it('retries 429 once, then fails with the HTTP status', async () => {
    const f = fakeQloo(0, 429);
    const q = new LiveQlooAdapter({ apiKey: 'k', fetchImpl: f.impl as never, limits: { retries: 1 } });
    await expect(q.searchPerson('x')).rejects.toMatchObject({ kind: 'http', status: 429 });
    expect(q.metrics.networkCalls).toBe(2);
  });

  it('stops starting requests after the deadline', async () => {
    const q = new LiveQlooAdapter({ apiKey: 'k', fetchImpl: fakeQloo(30).impl as never, limits: { deadlineMs: 20, retries: 0 } });
    await q.searchPerson('a').catch(() => {});
    await new Promise((r) => setTimeout(r, 30));
    await expect(q.searchPerson('b')).rejects.toMatchObject({ kind: 'deadline' });
  });

  it('serves repeated requests from the private cache', async () => {
    const cache = new Map();
    const f = fakeQloo();
    const a = new LiveQlooAdapter({ apiKey: 'k', fetchImpl: f.impl as never, cache });
    await a.searchPerson('Rick Rubin');
    const b = new LiveQlooAdapter({ apiKey: 'k', fetchImpl: f.impl as never, cache });
    await b.searchPerson('Rick Rubin');
    expect(f.impl).toHaveBeenCalledTimes(1);
    expect(b.metrics.cacheHits).toBe(1);
  });
});
