// Card copy: every defect found reading all 120 catalog cards (Oct 24) has a case here.
import { describe, expect, it } from 'vitest';
import type { Recommendation } from '../core/agent/agent';
import { mainCategory } from '../core/people';
import { cleanTopic, clipTopic, topicPhrase } from '../core/topic';
import { audienceSubtitle, monthYear, whySentences } from '../src/why';

describe('topics read as phrases', () => {
  it.each([
    ['sobre su novela "Patria y familia"', 'Su novela "Patria y familia"'],
    ['- Confesiones Sobre La Fama, La Enfermedad y El Amor', 'Confesiones Sobre La Fama, La Enfermedad y El Amor'],
    ['La Verdad sobre el Estado de Derecho   #LFDE', 'La Verdad sobre el Estado de Derecho'],
    ['Fixing the American Dream with', 'Fixing the American Dream'],
    ['Why Giving Is Actually Good For Your Health, with', 'Why Giving Is Actually Good For Your Health'],
    ['& Gwynne Shotwell on AI Risks and Peer Review, Starship', 'AI Risks and Peer Review, Starship'],
    ['DOGE updates + Liberation Day Tariff Reactions with   and Antonio Gracias', 'DOGE updates + Liberation Day Tariff Reactions with Antonio Gracias'],
    ['"Era utópico pensar de que íbamos a poder jugar en la NBA"', 'Era utópico pensar de que íbamos a poder jugar en la NBA'],
    ['discusses the secret to his comedy, being a late bloomer', 'The secret to his comedy, being a late bloomer'],
  ])('%s', (raw, clean) => expect(cleanTopic(raw)).toBe(clean));

  it('drops topics with no content', () => {
    expect(cleanTopic('In conversation with')).toBeNull();
    expect(cleanTopic('#123 -')).toBeNull();
  });

  it('removes the guest’s own name and never clips mid-word', () => {
    expect(topicPhrase('EMILIA MERNES | Anécdotas de su vida, Concursos de belleza', 'Emilia Mernes')).toBe('Anécdotas de su vida, Concursos de belleza');
    const t = clipTopic('Su historia de éxito, Adicción al sexo, Momentos difíciles, Maldita primavera y otros recuerdos de su carrera', 60);
    expect(t).toBe('Su historia de éxito, Adicción al sexo, Momentos difíciles…');
  });
});

describe('dates and the kind of guest', () => {
  it('writes dates as people say them', () => {
    expect(monthYear('2026-01-10T00:00:00.000Z', 'es')).toBe('enero de 2026');
    expect(monthYear('2026-01-10T00:00:00.000Z', 'en')).toBe('January 2026');
  });

  it('reads the kind of guest from what the description leads with', () => {
    expect(mainCategory('American businessman (born 1971)')).toBe('business');
    expect(mainCategory('German football manager')).toBe('sports');
    expect(mainCategory('English sports broadcaster and former footballer')).toBe('media');
    expect(mainCategory('Lebanese-American media personality and former actress')).toBe('media');
    expect(mainCategory('American legal clerk and environmental activist')).toBeNull();
    expect(mainCategory('Argentine lawyer and politician')).toBe('politics');
    expect(mainCategory('Argentine historian')).toBe('thought');
  });
});

const rec = (over: Omit<Partial<Recommendation>, 'audience'> & { audience?: Partial<NonNullable<Recommendation['audience']>> } = {}): Recommendation =>
  ({
    rank: 1,
    name: 'Emilia Mernes',
    sharedThemes: [],
    conversationTopics: [],
    appearances: [{ showId: 'creativo', showName: 'CREATIVO', title: 'EMILIA MERNES | Anécdotas de su vida, Concursos de belleza', published: '2026-01-10T00:00:00.000Z', url: null, episodeId: 'e' }],
    ...over,
    audience: {
      occupations: [{ en: 'singer-songwriter', es: 'cantautor' }],
      categories: ['music'],
      sharedCategories: [],
      countries: ['ar'],
      showCountry: 'ar',
      sameCountry: true,
      matchedCountry: 'ar',
      sameCountryShows: [],
      wikipedias: 27,
      similarPastGuests: [],
      similarByCategory: {},
      typeFit: null,
      regionFit: 1,
      known: 0.5,
      description: { en: 'Argentine singer (born 1996)', es: 'cantante argentina' },
      wikidataId: 'Q1',
      ...over.audience,
    },
  }) as Recommendation;

describe('card text', () => {
  it('subtitle: the person’s own description, gender included; long ones end at a list boundary', () => {
    expect(audienceSubtitle(rec(), 'es')).toBe('Cantante argentina');
    expect(audienceSubtitle(rec(), 'en')).toBe('Argentine singer');
    expect(audienceSubtitle(rec({ audience: { description: { en: null, es: 'Músico, compositor, pianista, director de cine y cantante argentino' } } }), 'es')).toBe('Músico, compositor, pianista, director de cine');
    expect(audienceSubtitle(rec({ audience: { description: { en: null, es: 'Economista y político argentino. Ministro de Economía' } } }), 'es')).toBe('Economista y político argentino');
  });

  it('no wrong nationality: a description naming another country drops the country claim', () => {
    const douglas = rec({ name: 'Michael Douglas', audience: { countries: ['us', 'gb'], showCountry: 'gb', matchedCountry: 'gb', description: { en: 'American actor, producer and activist', es: 'actor estadounidense' } } });
    expect(whySentences(douglas, 'Off Menu', 'es').join(' ')).not.toMatch(/Reino Unido/);
  });

  it('“del Reino Unido”, natural dates, no ISO dates, no double parentheses', () => {
    const uk = rec({ name: 'Tracey Ullman', appearances: [{ showId: 'x', showName: 'Conversaciones (Gustavo Noriega)', title: 'Tracey Ullman: Finding fame in the US', published: '2024-02-13T00:00:00.000Z', url: null, episodeId: 'e' }] as never, audience: { countries: ['gb'], showCountry: 'gb', matchedCountry: 'gb', description: { en: 'British actress', es: 'actriz británica' } } });
    const es = whySentences(uk, 'Off Menu', 'es').join(' ');
    const en = whySentences(uk, 'Off Menu', 'en').join(' ');
    expect(es).toMatch(/del Reino Unido/);
    expect(es).toMatch(/febrero de 2024/);
    for (const t of [es, en]) {
      expect(t).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(t).not.toMatch(/\)\s*\(/);
    }
  });

  it('five cards in a row do not share the same wording', () => {
    const texts = [0, 1, 2].map((v) =>
      whySentences(rec({ audience: { sharedCategories: ['music'], similarByCategory: { music: ['Soledad Pastorutti', 'Juliana Gattas'] }, sameCountryShows: ['Caja Negra'] } }), 'El Método Rebord', 'es', v).join(' '),
    );
    expect(new Set(texts).size).toBe(3);
    for (const t of texts) expect(t).toMatch(/Soledad Pastorutti/);
  });

  it('no “same kind of guest” claim on results computed before card version 2', () => {
    const r = rec({ audience: { sharedCategories: ['music'], similarByCategory: { music: ['Soledad Pastorutti'] } } });
    expect(whySentences(r, 'El Método Rebord', 'es', 0, { kindClaims: false }).join(' ')).not.toMatch(/Pastorutti/);
  });
});

describe('identity: a namesake does not get in on name and country alone', () => {
  it('needs shared context, or a Wikipedia article, to trust a country-only match', async () => {
    const { trustedRecord } = await import('../core/people');
    expect(trustedRecord({ match: ['country'], wikipedias: 0 })).toBe(false);
    expect(trustedRecord({ match: ['country'], wikipedias: 2 })).toBe(true);
    expect(trustedRecord({ match: ['context'], wikipedias: 0 })).toBe(true);
  });
});

describe('positions read right', () => {
  it('feminine Spanish titles for women, from their own Wikipedia opening', async () => {
    const { feminineTitle, isWoman, positionLabel, specificPosition } = await import('../core/positions');
    expect(feminineTitle('Senador de Argentina')).toBe('Senadora de Argentina');
    expect(feminineTitle('gobernador de la provincia de Buenos Aires')).toBe('gobernadora de la provincia de Buenos Aires');
    expect(feminineTitle('Presidente de la Nación Argentina')).toBe('Presidenta de la Nación Argentina');
    expect(feminineTitle('ministro de Economía')).toBe('ministra de Economía');
    expect(isWoman({ bio: { es: 'Carolina Losada es una política y periodista argentina.' } })).toBe(true);
    expect(isWoman({ bio: { es: 'Axel Kicillof es un economista y político argentino.' } })).toBe(false);
    const senate = { en: 'Senator of Argentina', es: 'Senador de Argentina', since: '2021' };
    expect(positionLabel(senate, 'es', { bio: { es: 'Carolina Losada es una política.' } })).toBe('Senadora de Argentina');
    expect(positionLabel(senate, 'en', { bio: { es: 'Carolina Losada es una política.' } })).toBe('Senator of Argentina');
    expect(specificPosition([{ en: 'Chief executive officer', es: 'director ejecutivo', since: '2014' }])).toBeUndefined();
  });

  it('a board seat with no organization is not a specific position', async () => {
    const { specificPosition } = await import('../core/positions');
    expect(specificPosition([{ en: 'board of directors member', es: 'miembro del consejo de administración', since: '2008' }])).toBeUndefined();
    expect(specificPosition([{ en: 'member of the board of directors', es: 'miembro de la junta directiva', since: null }])).toBeUndefined();
    expect(specificPosition([{ en: 'Governor of Buenos Aires Province', es: 'gobernador de la provincia de Buenos Aires', since: '2023' }])?.en).toBe('Governor of Buenos Aires Province');
  });
});
