// Qloo feature.explainability on the affinity call: parsed when present, dropped when rejected.
import { describe, expect, it } from 'vitest';
import { LiveQlooAdapter, parseExplain } from '../core/qloo/client';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('Qloo explainability', () => {
  it('reads the documented shape, highest contribution first, and ignores anything else', () => {
    expect(parseExplain({ 'signal.interests.entities': [{ entity_id: 'A', score: 0.2 }, { entity_id: 'B', score: 0.7 }, { foo: 1 }] })).toEqual([
      { entityId: 'B', score: 0.7 },
      { entityId: 'A', score: 0.2 },
    ]);
    expect(parseExplain(undefined)).toEqual([]);
    expect(parseExplain('x')).toEqual([]);
  });

  it('asks for it on the affinity call and keeps it per candidate, with no extra request', async () => {
    const urls: string[] = [];
    const fetchImpl = async (u: string | URL | Request) => {
      urls.push(String(u));
      return ok({ results: { entities: [{ entity_id: 'C1', name: 'Cand', query: { affinity: 0.9, explainability: { 'signal.interests.entities': [{ entity_id: 'G1', score: 0.8 }] } } }] } });
    };
    const q = new LiveQlooAdapter({ apiKey: 'k', fetchImpl: fetchImpl as typeof fetch });
    const m = await q.affinityFor({ signalIds: ['G1'], candidateIds: ['C1'] });
    expect(m.get('C1')).toBe(0.9);
    expect(q.explanations.get('C1')).toEqual([{ entityId: 'G1', score: 0.8 }]);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('feature.explainability=true');
    expect(q.calls[0].note).toContain('explainability: 1');
  });

  it('repeats the call without it once if Qloo answers 400, and stops asking', async () => {
    const urls: string[] = [];
    const fetchImpl = async (u: string | URL | Request) => {
      urls.push(String(u));
      if (String(u).includes('feature.explainability')) return new Response('{}', { status: 400 });
      return ok({ results: { entities: [{ entity_id: 'C1', name: 'Cand', query: { affinity: 0.5 } }] } });
    };
    const q = new LiveQlooAdapter({ apiKey: 'k', fetchImpl: fetchImpl as typeof fetch, limits: { retries: 0 } });
    expect((await q.affinityFor({ signalIds: ['G1'], candidateIds: ['C1'] })).get('C1')).toBe(0.5);
    await q.affinityFor({ signalIds: ['G1'], candidateIds: ['C2'] });
    expect(urls.filter((u) => u.includes('feature.explainability'))).toHaveLength(1);
    expect(q.explanations.size).toBe(0);
  });
});

describe('Qloo quota headers', () => {
  it('keeps the rate-limit headers of the latest response as numbers, and nothing else', async () => {
    const { rateLimitHeaders } = await import('../core/qloo/client');
    const h = new Headers({ 'X-RateLimit-Remaining-Month': '48210', 'X-RateLimit-Limit-Second': '10', 'Content-Type': 'application/json', 'X-RateLimit-Bogus': 'n/a' });
    expect(rateLimitHeaders(h)).toEqual({ 'x-ratelimit-remaining-month': 48210, 'x-ratelimit-limit-second': 10 });
    const fetchImpl = async () => new Response(JSON.stringify({ results: [] }), { status: 200, headers: h });
    const q = new LiveQlooAdapter({ apiKey: 'k', fetchImpl: fetchImpl as typeof fetch });
    await q.searchPerson('x');
    expect(q.metrics.rateLimit?.['x-ratelimit-remaining-month']).toBe(48210);
  });
});
