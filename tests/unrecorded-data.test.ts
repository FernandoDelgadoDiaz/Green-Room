// People Qloo proposed whose Wikidata record lacks citizenship or spoken languages: unknown is not a
// mismatch. A recorded country or language list that does not fit still excludes them.
import { describe, expect, it } from 'vitest';
import { runAgent } from '../core/agent/agent';
import type { PersonRecord } from '../core/people';
import type { QlooAdapter, QlooCall, QlooEntity } from '../core/qloo/types';
import type { ExternalCheck } from '../core/verify/external';
import type { PodcastDataset } from '../core/types';

const ep = (id: string, title: string, guests: string[], published: string) => ({ id, title, published, url: null, guests: guests.map((name) => ({ name, method: 'title-pattern' as const, confidence: 'high' as const })), excluded: false });
const mk = (id: string, episodes: ReturnType<typeof ep>[]): PodcastDataset => ({ id, name: id, host: `Host ${id}`, hostAliases: [`Host ${id}`], language: 'es', description: '', source: { feedUrl: '', website: '', retrievedAt: '', retrievedVia: '', note: '' }, episodes });
const person = (label: string): PersonRecord => ({ qid: `Q${label.length}`, label, description: { en: 'Argentine politician', es: 'político' }, occupations: [{ en: 'politician', es: 'político' }], categories: ['politics'], countries: ['ar'], wikipedias: 3, articles: ['eswiki'], photo: null, match: ['country'], matchEvidence: [] });
const past = ['Ana Uno', 'Bruno Dos', 'Carla Tres', 'Diego Cuatro'];
const target = mk('show', past.map((n, i) => ep(`t${i}`, `${n}: la política, el gobierno y las elecciones`, [n], `2026-0${i + 1}-10T00:00:00.000Z`)));
const other = mk('other', [ep('o1', 'Político Nuevo: la política y el gobierno', ['Político Nuevo'], '2026-05-01T00:00:00.000Z')]);
const people = Object.fromEntries([...past, 'Político Nuevo'].map((n) => [n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), person(n)]));

const check = (name: string, countries: string[], spoken: string[]): ExternalCheck => ({
  name, qlooIds: [`q:${name}`], qlooTypes: ['urn:entity:person'], kind: 'person', status: 'documented', reason: '', reasonEs: '', wikidataId: `Q9${name.length}${countries.length}${spoken.length}`,
  sources: [], identityEvidence: ['Qloo record links to Wikidata'], description: { en: 'Argentine politician', es: 'político' }, occupations: [{ en: 'politician', es: 'político' }],
  backgroundText: 'politician político', wikipedia: null, languages: { spoken, articles: ['es'] }, countries, namesakes: [], names: [name], canonicalName: name, limitations: [], limitationsEs: [],
});
const proposals = [check('Sin Pais', [], ['es']), check('Sin Idioma', ['ar'], []), check('Otro Pais', ['us'], ['es']), check('Otro Idioma', ['ar'], ['ru'])];

class Live implements QlooAdapter {
  readonly mode = 'LIVE' as const;
  readonly calls: QlooCall[] = [];
  async searchPerson(name: string): Promise<QlooEntity[]> { return [{ entityId: `p:${name}`, name, description: [target, other].flatMap((d) => d.episodes).filter((e) => e.guests.some((g) => g.name === name)).map((e) => e.title).join(' ') }]; }
  async searchPodcast() { return []; }
  async findTags() { return []; }
  async personInsights(): Promise<QlooEntity[]> { return proposals.map((c) => ({ entityId: c.qlooIds[0], name: c.name, types: ['urn:entity:person'] })); }
  async affinityFor() { return new Map<string, number>(); }
  async categoryInsights() { return []; }
}
const verifier = { calls: [] as string[], maxCandidates: 12, verify: async () => proposals.map((c) => structuredClone(c)) };

describe('unrecorded citizenship or language does not exclude Qloo’s proposals', () => {
  it('keeps people with no recorded country or language, and still excludes a recorded mismatch', async () => {
    const r = await runAgent({ target, others: [other], qloo: new Live(), k: 3, people, originOf: new Map([['show', 'ar'], ['other', 'ar']]), verifier: verifier as never, asOf: '2026-10-01T00:00:00.000Z' });
    const names = r.recommendations.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(['Sin Pais', 'Sin Idioma']));
    expect(names).not.toContain('Otro Pais');
    expect(names).not.toContain('Otro Idioma');
    const noLang = r.recommendations.find((x) => x.name === 'Sin Idioma')!;
    expect(noLang.language).toMatchObject({ status: 'probable', basis: 'citizenship', evidenceLanguages: ['es'] });
    // No country is imputed: the card makes no same-country claim.
    expect(r.recommendations.find((x) => x.name === 'Sin Pais')!.audience?.sameCountry).toBe(false);
  });
});
