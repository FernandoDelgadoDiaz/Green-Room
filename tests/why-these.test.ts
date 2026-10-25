// "Why these five": every sentence comes from a field of the result; nothing when it is missing.
import { describe, expect, it } from 'vitest';
import { agentSteps, audienceRead, guestWhy } from '../src/whyThese';
import type { Recommendation } from '../core/agent/agent';

const diag = (strategy: string, confirmed = 0, searched = 0) =>
  ({
    signalStrategy: strategy,
    signalDiagnostics: { guests: { searched, withResults: confirmed, confirmed, ambiguous: 0, noContext: 0, fuzzyOnly: 0, notFound: 0, errors: 0 }, podcast: [], tags: [{ word: 'ai', query: 'artificial intelligence', results: 10, accepted: 'Artificial Intelligence', acceptedIds: [], sample: [] }], skippedGeneric: [], verdict: 'ok' },
  }) as never;

const base = {
  ...(diag('podcast+tags') as object),
  qlooMode: 'LIVE',
  pastGuestCount: 114,
  historyEpisodeCount: 499,
  audienceDemographics: { demographics: { age: { '45_to_54': 0.3, '35_to_44': 0.1, '24_and_younger': -0.2 }, gender: { male: 0.2, female: -0.2 } } },
  culturalAffinities: [
    { type: 'urn:entity:book', entities: [{ entityId: 'b1', name: 'The Power Law', popularity: 0.9 }, { entityId: 'b2', name: 'Chaos Monkeys', popularity: 0.88 }], provenance: 'LIVE' },
    { type: 'urn:entity:artist', entities: [{ entityId: 'a1', name: 'Obscure', popularity: 0.2 }, { entityId: 'a2', name: 'Lane 8', popularity: 0.97 }], provenance: 'LIVE' },
  ],
  funnel: { proposed: 30, identityVerified: 19, ranked: 15 },
  discarded: [{}, {}],
} as never;

describe('what Qloo found out about the audience', () => {
  it('states the profile and the recognizable tastes, and how Qloo got there', () => {
    const a = audienceRead(base, 'TWiST', 'es');
    expect(a.profile).toBe('más hombres que mujeres, sobre todo de 45 a 54 y de 35 a 44 años');
    expect(a.likes).toEqual([{ label: 'Libros', names: ['The Power Law', 'Chaos Monkeys'] }]); // books first; music only when nothing else came back
    const young = audienceRead({ ...(base as object), audienceDemographics: { demographics: { age: { '24_and_younger': 0.5, '30_to_34': 0.4 }, gender: {} } } } as never, 'X', 'es');
    expect(young.profile).toBe('sobre todo menores de 25 y de 30 a 34 años');
    expect(a.how).toMatch(/siguen TWiST o se interesan por Artificial Intelligence\. No es una encuesta/);
  });

  it('says plainly when Qloo barely knows the show', () => {
    expect(audienceRead({ ...(base as object), ...(diag('tags') as object) } as never, 'Caja Negra', 'es').how).toMatch(/^Qloo casi no conoce/);
  });
});

describe('why each guest', () => {
  const rec = (q: Partial<NonNullable<Recommendation['qlooAudience']>> | null) =>
    ({ key: 'k', name: 'Ann', rank: 1, sharedThemes: [], appearances: [{ showName: 'Lex Fridman Podcast', published: '2026-05-10T00:00:00Z', title: 't' }], audience: null, qlooAudience: q }) as unknown as Recommendation;

  it('gives the affinity and, only when Qloo explained it, what weighed most', () => {
    expect(guestWhy(rec({ affinity: 0.88 }), 'es', Date.parse('2026-10-25')).qloo).toBe('Afinidad con tu público: 88 de 100, comparada con los demás candidatos.');
    expect(guestWhy(rec({ affinity: 0.88, explainedBy: ['Artificial Intelligence', 'This Week in Startups'] }), 'es').qloo).toMatch(/Lo que más pesó: Artificial Intelligence y This Week in Startups\.$/);
    expect(guestWhy(rec(null), 'es').qloo).toBe('Qloo no tiene dato de afinidad para esta persona.');
    expect(guestWhy(rec({ affinity: 0.5, explainedBy: ['All-In'] }), 'es', Date.now(), 'All-In').qloo).not.toMatch(/pesó/);
  });

  it('dates the latest interview and flags an old one', () => {
    expect(guestWhy(rec(null), 'es', Date.parse('2026-10-25')).timely).toBe('Última entrevista: Lex Fridman Podcast, mayo de 2026.');
    expect(guestWhy(rec(null), 'es', Date.parse('2027-12-01')).timely).toMatch(/^Su entrevista más reciente que encontramos es de mayo de 2026/);
  });
});

describe('what the agent did', () => {
  it('uses this run’s numbers, in order', () => {
    const s = agentSteps(base, 'TWiST', 'es');
    expect(s[0]).toBe('Leí 499 episodios de TWiST y encontré 114 invitados anteriores, que no vuelvo a proponer.');
    expect(s).toContain('Qloo me propuso 30 personas nuevas; 19 pasaron la verificación de identidad y 15 quedaron como candidatas.');
    expect(s[s.length - 1]).toBe('Descarté a 2 por no pasar algún control; el detalle está más abajo.');
  });

  it('never mentions Qloo proposals when there were none', () => {
    expect(agentSteps({ ...(base as object), funnel: { proposed: 0, identityVerified: 0, ranked: 0 } } as never, 'X', 'es').join(' ')).not.toMatch(/me propuso/);
  });
});
