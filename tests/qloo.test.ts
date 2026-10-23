import { describe, expect, it } from 'vitest';
import { LiveQlooAdapter, buildUrl, parseEntities, QLOO_HACKATHON_BASE_URL } from '../core/qloo/client';
import { MockQlooAdapter } from '../core/qloo/mock';
import { QlooError } from '../core/qloo/types';
import { makeQloo } from '../core/api';

function fakeFetch(status: number, body: unknown) {
  const seen: Array<{ url: string; headers?: Record<string, string> }> = [];
  const impl = async (url: string, init?: { headers?: Record<string, string> }) => {
    seen.push({ url, headers: init?.headers });
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  return { impl, seen };
}

describe('LIVE client (offline, with a fake fetch)', () => {
  it('refuses to start without a key', () => {
    expect(() => new LiveQlooAdapter({ apiKey: '' })).toThrow(QlooError);
  });

  it('uses the hackathon base URL, GET query params and the X-Api-Key header', async () => {
    const f = fakeFetch(200, { success: true, results: [] });
    const q = new LiveQlooAdapter({ apiKey: 'k_test', fetchImpl: f.impl });
    await q.searchPerson('Rick Rubin');
    const url = new URL(f.seen[0].url);
    expect(url.origin).toBe(QLOO_HACKATHON_BASE_URL);
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('query')).toBe('Rick Rubin');
    expect(url.searchParams.get('types')).toBe('urn:entity:person');
    expect(f.seen[0].headers?.['X-Api-Key']).toBe('k_test');
    expect(f.seen[0].url).not.toContain('k_test');
  });

  it('builds insights requests with exclusions and caps take at 50', async () => {
    const f = fakeFetch(200, { results: { entities: [] } });
    const q = new LiveQlooAdapter({ apiKey: 'k', fetchImpl: f.impl });
    await q.personInsights({ signalIds: ['a', 'b'], excludeIds: ['a', 'b'], take: 80 });
    const url = new URL(f.seen[0].url);
    expect(url.pathname).toBe('/v2/insights');
    expect(url.searchParams.get('filter.type')).toBe('urn:entity:person');
    expect(url.searchParams.get('signal.interests.entities')).toBe('a,b');
    expect(url.searchParams.get('filter.exclude.entities')).toBe('a,b');
    expect(url.searchParams.get('take')).toBe('50');
    expect(url.searchParams.has('filter.popularity.max')).toBe(false);
  });

  it('surfaces HTTP errors and logs empty 200s', async () => {
    const q401 = new LiveQlooAdapter({ apiKey: 'k', fetchImpl: fakeFetch(401, {}).impl });
    await expect(q401.searchPerson('x')).rejects.toMatchObject({ status: 401 });
    const qEmpty = new LiveQlooAdapter({ apiKey: 'k', fetchImpl: fakeFetch(200, { results: { entities: [] } }).impl });
    await qEmpty.categoryInsights({ signalIds: ['a'], type: 'urn:entity:artist', take: 5 });
    expect(qEmpty.calls[0].note).toMatch(/empty 200/);
  });

  it('parses both documented result shapes', () => {
    expect(parseEntities({ results: [{ entity_id: 'e1', name: 'A', popularity: 0.9 }] })).toEqual([{ entityId: 'e1', name: 'A', popularity: 0.9, affinity: undefined, tags: undefined, type: undefined }]);
    expect(parseEntities({ results: { entities: [{ entity_id: 'e2', name: 'B', query: { affinity: 0.7 } }, { name: 'no id' }] } })).toHaveLength(1);
    expect(buildUrl('https://x.test', '/v2/insights', { a: '1', b: '' })).toBe('https://x.test/v2/insights?a=1');
  });
});

describe('MOCK adapter', () => {
  it('never invents entities and labels its calls', async () => {
    const m = new MockQlooAdapter();
    expect(await m.personInsights({ signalIds: ['x'], excludeIds: [], take: 10 })).toEqual([]);
    expect(await m.categoryInsights({ type: 'urn:entity:artist' })).toEqual([]);
    const [hit] = await m.searchPerson('Rick Rubin');
    expect(hit.entityId.startsWith('MOCK:')).toBe(true);
    expect(m.calls.every((c) => c.status === 'mock')).toBe(true);
  });

  it('is deterministic', async () => {
    const a = await new MockQlooAdapter().affinityFor({ signalIds: ['s'], candidateIds: ['c1', 'c2'] });
    const b = await new MockQlooAdapter().affinityFor({ signalIds: ['s'], candidateIds: ['c1', 'c2'] });
    expect([...a]).toEqual([...b]);
  });

  it('is selected unless QLOO_LIVE_ENABLED=true and a key are both set', () => {
    expect(makeQloo({}).mode).toBe('MOCK');
    // A key alone is not enough: LIVE needs the explicit switch.
    expect(makeQloo({ QLOO_API_KEY: 'k' }).mode).toBe('MOCK');
    expect(makeQloo({ QLOO_API_KEY: 'k', QLOO_LIVE_ENABLED: 'TRUE' }).mode).toBe('MOCK');
    expect(makeQloo({ QLOO_API_KEY: 'k', QLOO_LIVE_ENABLED: 'true' }).mode).toBe('LIVE');
  });
});
