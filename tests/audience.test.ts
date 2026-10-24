import { describe, expect, it } from 'vitest';
import { runAgent } from '../core/agent/agent';
import { NoQlooAdapter } from '../core/qloo/mock';
import type { PersonRecord } from '../core/people';
import type { PodcastDataset } from '../core/types';
import { audienceSubtitle, citableThemes, whySentences } from '../src/why';

// A show titled with guest names only (like El Método Rebord): its titles carry no themes, its past
// guests say who it talks to: Argentine politicians and musicians.
const ep = (id: string, title: string, guests: string[], published: string) => ({ id, title, published, url: null, guests: guests.map((name) => ({ name, method: 'title-pattern' as const, confidence: 'high' as const })), excluded: false });
const mk = (id: string, episodes: ReturnType<typeof ep>[]): PodcastDataset => ({ id, name: id, host: `Host ${id}`, hostAliases: [`Host ${id}`], language: 'es', description: '', source: { feedUrl: '', website: '', retrievedAt: '', retrievedVia: '', note: '' }, episodes });
const person = (label: string, categories: PersonRecord['categories'], countries: string[], wikipedias: number, occ: string): PersonRecord => ({
  qid: `Q${label.length}${wikipedias}`,
  label,
  description: { en: null, es: occ },
  occupations: [{ en: occ, es: occ }],
  categories,
  countries,
  wikipedias,
  articles: ['eswiki'],
  photo: null,
  match: ['country'],
  matchEvidence: [],
});

const pastPoliticians = ['Ana Uno', 'Bruno Dos', 'Carla Tres', 'Diego Cuatro'];
const pastMusicians = ['Eva Cinco', 'Fede Seis', 'Gabi Siete', 'Hugo Ocho'];
const target = mk(
  'rebordish',
  [...pastPoliticians, ...pastMusicians].map((n, i) => ep(`t${i}`, `#${i} - ${n}`, [n], `2026-0${(i % 8) + 1}-10T00:00:00.000Z`)),
);
const argentine = mk('cajaish', [
  ep('c1', 'Político Nuevo', ['Político Nuevo'], '2026-05-01T00:00:00.000Z'),
  ep('c2', 'Música Nueva', ['Música Nueva'], '2026-04-01T00:00:00.000Z'),
  ep('c3', 'Desconocido Total', ['Desconocido Total'], '2026-06-01T00:00:00.000Z'),
]);
const spanish = mk('aiish', [
  ...[1, 2, 3, 4].map((i) => ep(`a${i}`, `La inteligencia artificial y el futuro del trabajo ${i} | Experto IA`, ['Experto IA'], `2026-0${i + 4}-01T00:00:00.000Z`)),
  ep('a9', 'Estrella Global: el cine y la fama', ['Estrella Global'], '2026-03-01T00:00:00.000Z'),
]);
const people: Record<string, PersonRecord> = {
  ...Object.fromEntries(pastPoliticians.map((n) => [n.toLowerCase(), person(n, ['politics'], ['ar'], 4, 'político')])),
  ...Object.fromEntries(pastMusicians.map((n) => [n.toLowerCase(), person(n, ['music'], ['ar'], 6, 'cantante')])),
  'politico nuevo': person('Político Nuevo', ['politics'], ['ar'], 5, 'político'),
  'musica nueva': person('Música Nueva', ['music'], ['ar'], 3, 'cantante'),
  'experto ia': person('Experto IA', ['technology'], ['es'], 3, 'ingeniero'),
  'estrella global': person('Estrella Global', ['acting'], ['us'], 60, 'actor'),
};
const originOf = new Map([
  ['rebordish', 'ar'],
  ['cajaish', 'ar'],
  ['aiish', 'es'],
]);

describe('who the show interviews, and who its audience knows', () => {
  it('ranks same-country people of the same kind first, and leaves out undocumented names', async () => {
    const r = await runAgent({ target, others: [argentine, spanish], qloo: new NoQlooAdapter(), k: 3, originOf, people, asOf: '2026-10-01T00:00:00.000Z' });
    const names = r.recommendations.map((x) => x.name);
    expect(names.slice(0, 2).sort()).toEqual(['Música Nueva', 'Político Nuevo']);
    expect(names).not.toContain('Desconocido Total');
    // A Spanish engineer with more (AI-themed) interviews is not someone this Argentine audience knows.
    expect(names).not.toContain('Experto IA');
    expect(r.guestProfile).toMatchObject({ resolved: 8, strong: true, country: 'ar', themesWeak: true });
    expect(r.guestProfile!.categories.map((c) => c.id).sort()).toEqual(['music', 'politics']);
    expect(r.trace.some((s) => s.tool === 'profile_guests')).toBe(true);
  });

  it('explains each pick with its own evidence', async () => {
    const r = await runAgent({ target, others: [argentine, spanish], qloo: new NoQlooAdapter(), k: 3, originOf, people, asOf: '2026-10-01T00:00:00.000Z' });
    const pol = r.recommendations.find((x) => x.name === 'Político Nuevo')!;
    const mus = r.recommendations.find((x) => x.name === 'Música Nueva')!;
    const a = whySentences(pol, 'Rebordish', 'es').join(' ');
    const b = whySentences(mus, 'Rebordish', 'es').join(' ');
    expect(a).toMatch(/ya recibió a políticos como/);
    expect(a).toMatch(/Argentina/);
    expect(a).toMatch(/cajaish/);
    expect(b).toMatch(/músicos/);
    expect(a).not.toBe(b);
    expect(audienceSubtitle(pol, 'es')).toBe('Político · Argentina');
  });

  it('without people data, the ranking is the topical one (unchanged)', async () => {
    const r = await runAgent({ target, others: [argentine, spanish], qloo: new NoQlooAdapter(), k: 3, originOf, asOf: '2026-10-01T00:00:00.000Z' });
    expect(r.guestProfile).toBeNull();
    expect(r.recommendations.every((x) => x.audience === null)).toBe(true);
  });
});

describe('why text: a theme is cited only with enough evidence', () => {
  const rec = (words: string[]) =>
    ({ name: 'Cantante', audience: null, appearances: [], sharedThemes: [{ id: 'psychology', label: 'Psychology & Mind', labelEs: 'Psicología y mente', words }] }) as never;
  it('one word in one title ("autoestima") is not enough to say their interviews cover psychology', () => {
    expect(citableThemes(rec(['autoestima']))).toHaveLength(0);
    expect(whySentences(rec(['autoestima']), 'Aislados', 'es').join(' ')).not.toMatch(/Psicología/);
  });
  it('two different theme words are', () => {
    expect(whySentences(rec(['autoestima', 'ansiedad']), 'Aislados', 'es').join(' ')).toMatch(/Sus entrevistas tocan Psicología y mente/);
  });
});
