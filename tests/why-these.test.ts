// "Why these five": every sentence comes from a field of the result; nothing when it is missing.
import { describe, expect, it } from 'vitest';
import { agentSteps, audienceRead, guestWhy, withQlooFate } from '../src/whyThese';
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
    expect(guestWhy({ ...rec(null), identity: { status: 'pending', reason: 'not_found', evidence: [] } } as Recommendation, 'es').qloo).toBe('No está en el catálogo de Qloo: entra por la evidencia de sus entrevistas.');
    // A same-name record Qloo could not confirm is not "not in Qloo".
    expect(guestWhy({ ...rec(null), identity: { status: 'pending', reason: 'no_context', evidence: [] } } as Recommendation, 'es').qloo).toMatch(/^Qloo tiene a alguien con este nombre/);
    expect(guestWhy(rec(null), 'es').qloo).toBe('Sin dato de Qloo para esta persona: entra por la evidencia.');
    expect(guestWhy({ ...rec(null), qlooEntityId: 'q1' } as Recommendation, 'es').qloo).toBe('Qloo conoce a esta persona, pero no le dio puntaje con este público.');
    // Consecutive evidence-only cards do not repeat the same sentence.
    const lines = [1, 2, 3].map((rank) => guestWhy({ ...rec(null), rank, identity: { status: 'pending', reason: 'not_found', evidence: [] } } as Recommendation, 'es').qloo);
    expect(new Set(lines).size).toBe(3);
    expect(guestWhy(rec({ affinity: 0.5, explainedBy: ['All-In'] }), 'es', Date.now(), 'All-In').qloo).not.toMatch(/pesó/);
  });

  it('dates the latest interview and flags an old one', () => {
    expect(guestWhy(rec(null), 'es', Date.parse('2026-10-25')).timely).toBe('Última entrevista: Lex Fridman Podcast, mayo de 2026.');
    expect(guestWhy(rec(null), 'es', Date.parse('2027-12-01')).timely).toMatch(/^Su entrevista más reciente que encontramos es de mayo de 2026/);
  });
});

describe('people Qloo proposed', () => {
  const ext = {
    key: 'bh', name: 'Ben Horowitz', rank: 1, sharedThemes: [], appearances: [], source: 'qloo-external',
    external: { status: 'documented', wikipedia: { lang: 'en', title: 'Ben Horowitz', url: 'u', extract: '' }, description: { en: 'American businessman', es: 'empresario e inversor estadounidense' } },
    audience: { positions: [], sharedCategories: ['business'], similarByCategory: { business: ['Alexis Ohanian', 'Brian Chesky'] } },
    qlooAudience: { affinity: 1 },
  } as unknown as Recommendation;
  it('says Qloo proposed them, how they were verified, and which past guests share their profile', () => {
    const w = guestWhy(ext, 'es', Date.now(), 'TWiST', { kindClaims: true });
    expect(w.kind).toBe('Del mismo tipo de invitado que Alexis Ohanian y Brian Chesky, que ya pasaron por el programa.');
    expect(w.offers).toBe('Empresario e inversor estadounidense.');
    expect(w.timely).toBe('Lo propuso Qloo; no tiene entrevistas en nuestras fuentes y su identidad está verificada en Wikidata y Wikipedia.');
    expect(guestWhy({ ...(ext as object), rank: 2 } as Recommendation, 'es').timely).not.toBe(w.timely);
    expect(guestWhy(ext, 'es', Date.now(), 'TWiST', { kindClaims: false }).kind).toBeNull();
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

describe('the list without Qloo', () => {
  it('says why each person leaves once Qloo is on, or that they stay', () => {
    expect(withQlooFate({ status: 'left', affinity: 0.29 }, 'es')).toBe('Sale con Qloo: buena evidencia, pero este público se inclina poco por esta persona (afinidad 29/100).');
    expect(withQlooFate({ status: 'left', affinity: null }, 'en')).toMatch(/^Out with Qloo: Qloo has no affinity value/);
    expect(withQlooFate({ status: 'kept', affinity: 0.6 }, 'es')).toBe('Se queda también con Qloo: afinidad con tu público 60/100.');
    expect(withQlooFate(undefined, 'es')).toBeNull();
  });
});
