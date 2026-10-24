import { describe, expect, it } from 'vitest';
import { runAgent } from '../core/agent/agent';
import { DATASETS, ORIGIN_OF, PEOPLE } from '../core/api';
import { nameKey } from '../core/names';
import { parseDemographics, parseTrend } from '../core/qloo/client';
import type { Demographics, QlooAdapter, QlooCall, QlooEntity } from '../core/qloo/types';
import { demographicSummary } from '../src/components/RecommendView';

// The documented Demographic Insights response (docs.qloo.com/reference/demographics-use-case).
const DEMO_DOC = {
  success: true,
  results: {
    demographics: [
      { entity_id: 'urn:tag:genre:media:action', query: { age: { '24_and_younger': 0, '25_to_29': 0.43, '30_to_34': 0.23, '35_to_44': -0.02, '45_to_54': -0.28, '55_and_older': -0.17 }, gender: { male: 0.08, female: -0.08 } } },
      { entity_id: 'B8BEE72B', query: { age: { '24_and_younger': -0.09, '25_to_29': 0.36, '30_to_34': 0.7, '35_to_44': 0.17, '45_to_54': -0.53, '55_and_older': -0.32 }, gender: { male: 0.16, female: -0.16 } } },
    ],
  },
  duration: 77,
};

describe('Qloo demographics and trending: tolerant parsing', () => {
  it('reads the documented demographics response', () => {
    const m = parseDemographics(DEMO_DOC);
    expect(m.get('B8BEE72B')?.age['30_to_34']).toBe(0.7);
    expect(m.get('urn:tag:genre:media:action')?.gender.male).toBe(0.08);
    expect(demographicSummary(m.get('B8BEE72B')!, 'en')).toBe('skews 30–34 and 25–29 · slightly more men');
  });

  it('reads a weekly trending series and its direction; unknown shapes give null, never an error', () => {
    const series = (pcts: number[]) => ({ success: true, results: { trending: pcts.map((p, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, population_percentile: p, velocity: 0 })) } });
    expect(parseTrend(series([0.4, 0.45, 0.6]), 'x')).toMatchObject({ direction: 'rising', latestPercentile: 0.6 });
    expect(parseTrend(series([0.6, 0.6, 0.61]), 'x')?.direction).toBe('steady');
    expect(parseTrend(series([80, 70, 50]), 'x')).toMatchObject({ direction: 'falling', latestPercentile: 0.5 });
    expect(parseTrend({ success: true, results: { entities: [] } }, 'x')).toBeNull();
    expect(parseTrend(null, 'x')).toBeNull();
    expect(parseDemographics({ nope: 1 }).size).toBe(0);
  });
});

describe('agent: Qloo reads each pick’s audience after verification (LIVE)', () => {
  const doac = DATASETS.find((d) => d.id === 'diary-of-a-ceo')!;
  const others = DATASETS.filter((d) => d.id !== doac.id);
  const titles = new Map<string, string[]>();
  for (const d of DATASETS) for (const e of d.episodes) for (const g of e.guests) titles.set(nameKey(g.name), [...(titles.get(nameKey(g.name)) ?? []), e.title]);
  const profile = (seed: number): Demographics => ({ age: { '25_to_29': 0.3 * seed, '45_to_54': -0.2 * seed }, gender: { male: 0.1 * seed, female: -0.1 * seed } });

  function adapter(withAudience: boolean) {
    const used: Record<string, number> = {};
    const c = (k: string) => (used[k] = (used[k] ?? 0) + 1);
    const q: QlooAdapter = {
      mode: 'LIVE',
      calls: [] as QlooCall[],
      searchPerson: async (name) => (c('searchPerson'), [{ entityId: `p:${nameKey(name)}`, name, types: ['urn:entity:person'], description: titles.get(nameKey(name))?.join(' ') } as QlooEntity]),
      searchPodcast: async () => [],
      findTags: async () => [],
      personInsights: async () => [],
      affinityFor: async ({ candidateIds }) => new Map(candidateIds.map((id, i) => [id, 1 - i / candidateIds.length])),
      categoryInsights: async () => [],
      ...(withAudience
        ? {
            demographics: async ({ entityIds = [] }) => (c('demographics'), new Map(entityIds.map((id, i) => [id, profile(i % 2 ? 1 : 0.8)]))),
            trending: async () => (c('trending'), { points: [], direction: 'rising' as const, latestPercentile: 0.7 }),
          }
        : {}),
    };
    return { q, used };
  }

  it('adds affinity, profile match and trend to every pick confirmed in Qloo, and the show’s audience profile', async () => {
    const { q, used } = adapter(true);
    const r = await runAgent({ target: doac, others, qloo: q, originOf: ORIGIN_OF, people: PEOPLE });
    expect(used.demographics).toBe(1);
    expect(r.audienceDemographics).not.toBeNull();
    const withQloo = r.recommendations.filter((x) => x.qlooAudience);
    expect(withQloo.length).toBeGreaterThan(0);
    for (const x of withQloo) {
      expect(x.qlooAudience!.demographicMatch).toBeGreaterThan(0);
      expect(x.qlooAudience!.trend).toBe('rising');
    }
    expect(r.trace.some((s) => s.tool === 'qloo_audience')).toBe(true);
  });

  it('never reorders the picks: the same list with or without the audience step', async () => {
    const a = await runAgent({ target: doac, others, qloo: adapter(true).q, originOf: ORIGIN_OF, people: PEOPLE });
    const b = await runAgent({ target: doac, others, qloo: adapter(false).q, originOf: ORIGIN_OF, people: PEOPLE });
    expect(a.recommendations.map((x) => x.name)).toEqual(b.recommendations.map((x) => x.name));
    expect(b.recommendations.every((x) => x.qlooAudience === null)).toBe(true);
  });
});
