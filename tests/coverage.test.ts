import { describe, expect, it } from 'vitest';
import { coverageByCountry, coverageOf } from '../core/coverage';

const result = (o: Record<string, unknown>) => ({ showId: 'x', showName: 'X', recommendations: [], ...o });

describe('Qloo coverage: counts derived from the agent’s own diagnostics', () => {
  it('reads one live result', () => {
    const row = coverageOf(
      result({
        signalStrategy: 'podcast+tags',
        signalDiagnostics: { guests: { searched: 25, confirmed: 12 } },
        funnel: { proposed: 30 },
        discoveryPositions: [{ source: 'qloo-external', eligible: true }, { source: 'qloo-external', eligible: false }, { source: 'rss', eligible: true }],
        audienceDemographics: { demographics: {} },
        recommendations: [{ qlooAudience: { affinity: 0.9 } }, { qlooAudience: null, components: { qlooAffinity: { value: null } } }],
        comparison: { k: 5, overlap: 4 },
      }),
      { country: 'us', computedAt: '2026-10-24T00:00:00Z' },
    );
    expect(row).toMatchObject({ showFound: true, guestsConfirmed: 12, guestsSearched: 25, qlooProposed: 30, qlooVerified: 1, audienceProfile: true, picksWithAffinity: 1, changedTopFive: true });
  });

  it('groups by country, best guest recognition first', () => {
    const us = coverageOf(result({ signalStrategy: 'podcast', signalDiagnostics: { guests: { searched: 25, confirmed: 15 } } }), { country: 'us', computedAt: 'a' })!;
    const ar = coverageOf(result({ signalStrategy: 'tags', signalDiagnostics: { guests: { searched: 25, confirmed: 1 } }, comparison: { k: 5, overlap: 5 } }), { country: 'ar', computedAt: 'b' })!;
    const by = coverageByCountry([ar, us, { ...us, guestsConfirmed: 5 }]);
    expect(by.map((c) => c.country)).toEqual(['us', 'ar']);
    expect(by[0]).toMatchObject({ shows: 2, guestsConfirmed: 20, guestsSearched: 50, showFound: 2 });
    expect(by[1]).toMatchObject({ showFound: 0, changedTopFive: 0 });
  });
});
