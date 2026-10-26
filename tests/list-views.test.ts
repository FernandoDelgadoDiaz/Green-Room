// Which lists a result offers, and which opens first, decided per show from its own data.
import { describe, expect, it } from 'vitest';
import { listViews } from '../src/components/RecommendView';

const pick = (key: string, affinity: number | null) => ({ key, qlooAudience: affinity === null ? null : { affinity } });
const base = (taste: Array<number | null>, overlap: number) =>
  ({
    qlooMode: 'LIVE',
    recommendations: [1, 2, 3, 4, 5].map((i) => pick(`r${i}`, null)),
    tasteRecommendations: taste.map((a, i) => pick(`t${i}`, a)),
    baselineRecommendations: [1, 2, 3, 4, 5].map((i) => pick(`b${i}`, null)),
    comparison: { k: 5, overlap, rows: [] },
  }) as never;

describe('lists per show', () => {
  it('opens Qloo’s order first only with five people of affinity ≥ 0.5 (This Week in Startups, 2026-10-26)', () => {
    expect(listViews(base([1, 0.88, 0.83, 0.54, 0.5], 1))).toEqual({ views: ['none', 'evidence', 'taste'], initial: 'taste' });
  });

  it('keeps evidence first, and hides "Without Qloo", when Qloo’s list is thin and changed little (All-In, 2026-10-26)', () => {
    expect(listViews(base([1, 0.46, 0.08, 0], 3))).toEqual({ views: ['evidence', 'taste'], initial: 'evidence' });
  });

  it('a single low affinity is enough to keep evidence first', () => {
    expect(listViews(base([1, 0.9, 0.8, 0.7, 0.49], 2)).initial).toBe('evidence');
  });

  it('outside LIVE there is only the evidence list', () => {
    expect(listViews({ ...(base([1, 1, 1, 1, 1], 0) as object), qlooMode: 'MOCK' } as never)).toEqual({ views: ['evidence'], initial: 'evidence' });
  });
});
