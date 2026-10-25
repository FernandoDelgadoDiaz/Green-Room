import { describe, expect, it } from 'vitest';
import { fixtureFetch } from './fixtures/wikidata/fetch';
import { WikidataVerifier } from '../core/verify/external';
import { runAgent } from '../core/agent/agent';
import { nameKey } from '../core/names';
import type { QlooAdapter, QlooCall, QlooEntity } from '../core/qloo/types';
import type { PodcastDataset } from '../core/types';

// Real Wikidata/Wikipedia responses retrieved 2026-10-23 (tests/fixtures/wikidata). The Qloo
// descriptions below are TEST INPUTS, not values returned by Qloo.
const q = (id: string, name: string, extra: Partial<QlooEntity> = {}): { entity: QlooEntity } => ({ entity: { entityId: id, name, ...extra } });
const verify = (items: Array<{ entity: QlooEntity }>, lang = 'en') => new WikidataVerifier({ fetchJson: fixtureFetch() }).verify(items, { targetLang: lang });

describe('external verification (Wikidata + Wikipedia, real fixtures)', () => {
  it('documents a person with no RSS appearance when Qloo’s context matches one namesake', async () => {
    const [c] = await verify([q('qa', 'Andrew Yang', { description: 'Entrepreneur and political candidate' })]);
    expect(c).toMatchObject({ kind: 'person', status: 'documented', wikidataId: 'Q28723576' });
    expect(c.identityEvidence.join(' ')).toMatch(/entrepreneur|political/);
    expect(c.namesakes.length).toBeGreaterThanOrEqual(3); // film producer, artist, PhD, Taiwanese politician…
    expect(c.wikipedia?.url).toBe('https://en.wikipedia.org/wiki/Andrew_Yang');
    expect(c.languages.spoken).toEqual(['en']);
    // Citizenship (P27) is read too: without it, Qloo's proposals never met the audience-country gate.
    expect(c.countries).toEqual(['us']);
    expect(c.sources.map((s) => s.name)).toEqual(['Wikidata', 'Wikipedia']);
  });

  it('never merges namesakes by name alone: no context → pending', async () => {
    const [c] = await verify([q('qa', 'Andrew Yang')]);
    expect(c.status).toBe('pending');
    expect(c.wikidataId).toBeNull();
    expect(c.namesakes.map((n) => n.wikidataId)).toEqual(expect.arrayContaining(['Q28723576', 'Q55603945', 'Q63112961']));
  });

  it('a single same-name person without Qloo context is only partially verified', async () => {
    const [partial] = await verify([q('qk', 'Santiago Korovsky')], 'es');
    expect(partial).toMatchObject({ status: 'partial', wikidataId: 'Q117071274' });
    const [doc] = await verify([q('qk', 'Santiago Korovsky', { description: 'Argentine actor and screenwriter' })], 'es');
    expect(doc).toMatchObject({ status: 'documented', wikipedia: { lang: 'es' } });
    expect(doc.languages.spoken).toEqual(['es']);
    expect(doc.countries).toEqual(['ar']);
  });

  it('detects bands and duos from Wikidata types, not from the name', async () => {
    const out = await verify([q('qb', 'Khruangbin', { description: 'psychedelic band' }), q('qr', 'Rodrigo y Gabriela', { description: 'guitar duo' })]);
    expect(out.map((c) => [c.name, c.kind, c.status])).toEqual([
      ['Khruangbin', 'group', 'discarded'],
      ['Rodrigo y Gabriela', 'group', 'discarded'],
    ]);
  });

  it('merges two Qloo ids only when both resolve to the same Wikidata person, keeping both ids', async () => {
    const out = await verify([q('qc1', 'Charly García', { description: 'Argentine rock musician' }), q('qc2', 'Charly García', { tags: ['Argentine rock', 'Musician'] })], 'es');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ wikidataId: 'Q467940', status: 'documented', qlooIds: ['qc1', 'qc2'] });
    // The water-polo player who shares the alias was a namesake, not a match.
    expect(out[0].namesakes.map((n) => n.wikidataId)).toEqual(['Q119686510']);
  });

  it('two Qloo ids for namesakes with different context stay separate', async () => {
    const out = await verify([q('a1', 'Andrew Yang', { description: 'entrepreneur and political candidate' }), q('a2', 'Andrew Yang', { description: 'film producer' })]);
    expect(out.map((c) => c.wikidataId)).toEqual(['Q28723576', 'Q63112961']);
    expect(out[1].status).toBe('partial'); // the film producer has no Wikipedia article
  });

  it('trusts Qloo’s own Wikidata link when present', async () => {
    const [c] = await verify([q('qx', 'Charly García', { wikidataIds: ['Q467940'] })]);
    expect(c).toMatchObject({ status: 'documented', wikidataId: 'Q467940' });
    expect(c.identityEvidence[0]).toMatch(/links to Wikidata Q467940/);
  });

  it('nothing found → pending with insufficient evidence; network failures do not throw', async () => {
    const [c] = await verify([q('qn', 'Nadie Inventado')]);
    expect(c.status).toBe('pending');
    const failing = new WikidataVerifier({ fetchJson: async () => { throw new Error('timeout'); } });
    const [f] = await failing.verify([q('qa', 'Andrew Yang', { description: 'entrepreneur' })], { targetLang: 'en' });
    expect(f.status).toBe('pending');
  });

  it('respects the per-run candidate cap', async () => {
    const v = new WikidataVerifier({ fetchJson: fixtureFetch(), maxCandidates: 2 });
    const out = await v.verify([q('1', 'Andrew Yang'), q('2', 'Khruangbin'), q('3', 'Tulsi Gabbard')], { targetLang: 'en' });
    expect(out).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------- agent integration
const ep = (id: string, title: string, published: string, guests: string[]) => ({ id, title, published, url: null, guests: guests.map((name) => ({ name, method: 'title-pattern' as const, confidence: 'high' as const })), excluded: false });
const mk = (id: string, language: string, episodes: ReturnType<typeof ep>[]): PodcastDataset => ({ id, name: id, host: 'Host ' + id, hostAliases: ['Host ' + id], language, description: '', source: { feedUrl: '', website: '', retrievedAt: '', retrievedVia: '', note: '' }, episodes });
const AS_OF = '2024-06-01T00:00:00.000Z';
// A business & politics show: past guests named, comparison show with a few verified people.
const target = mk('t', 'en', [
  ep('1', 'Zed Past: entrepreneur on business, money and the economy', '2024-01-01T00:00:00.000Z', ['Zed Past']),
  ep('2', 'Yan Past: politics, democracy and the election', '2024-02-01T00:00:00.000Z', ['Yan Past']),
  ep('3', 'Xi Past: how to build a company and invest', '2024-03-01T00:00:00.000Z', ['Xi Past']),
]);
const other = mk('o', 'en', [ep('o1', 'Bob Ray: business and money for entrepreneurs', '2024-04-01T00:00:00.000Z', ['Bob Ray']), ep('o2', 'Ann Lee: politics and the economy', '2024-05-01T00:00:00.000Z', ['Ann Lee'])]);

class Scripted implements QlooAdapter {
  readonly mode = 'LIVE' as const;
  readonly calls: QlooCall[] = [];
  constructor(private readonly people: QlooEntity[], private readonly sets: PodcastDataset[] = [target, other]) {}
  async searchPerson(name: string): Promise<QlooEntity[]> {
    return [{ entityId: `p:${nameKey(name)}`, name, description: this.sets.flatMap((d) => d.episodes).filter((e) => e.guests.some((g) => g.name === name)).map((e) => e.title).join(' ') }];
  }
  async searchPodcast() { return []; }
  async findTags() { return []; }
  async personInsights() { return this.people; }
  async affinityFor() { return new Map<string, number>(); }
  async categoryInsights() { return []; }
}

describe('agent: externally documented people enter the main ranking', () => {
  const people: QlooEntity[] = [
    { entityId: 'q:yang', name: 'Andrew Yang', description: 'Entrepreneur and political candidate', types: ['urn:entity:person'] },
    { entityId: 'q:khru', name: 'Khruangbin', description: 'psychedelic band', types: ['urn:entity:person'] },
    { entityId: 'q:tulsi', name: 'Tulsi Gabbard', description: 'American politician', types: ['urn:entity:person'] },
    { entityId: 'q:album', name: 'Some Album', types: ['urn:entity:album'] },
  ];

  it('verifies outside RSS, ranks without imputed activity, and records every check', async () => {
    const r = await runAgent({ target, others: [other], qloo: new Scripted(people), asOf: AS_OF, k: 3, verifier: new WikidataVerifier({ fetchJson: fixtureFetch() }) });
    const out = Object.fromEntries(r.qlooProposals.map((p) => [p.name, [p.outcome, p.failure ?? null]]));
    expect(out['Andrew Yang']).toEqual(['ranked', null]);
    expect(out['Khruangbin']).toEqual(['discarded', 'type']);
    expect(out['Some Album']).toEqual(['discarded', 'type']); // Qloo's own type says it is not a person
    expect(r.funnel).toMatchObject({ externalDocumented: 2, typeErrors: 2 });
    const yang = r.recommendations.find((x) => x.name === 'Andrew Yang')!;
    expect(yang.source).toBe('qloo-external');
    expect(yang.external?.wikidataId).toBe('Q28723576');
    expect(yang.appearances).toEqual([]);
    expect(yang.components.momentum.value).toBeNull();
    expect(yang.components.recency.value).toBeNull();
    expect(yang.assessment.evidence).toMatchObject({ kind: 'external', level: 'medium' });
    expect(yang.language).toMatchObject({ status: 'confirmed', basis: 'wikidata' });
    expect(yang.rationale.some((x) => /not imputed/.test(x.text))).toBe(true);
    expect(r.trace.some((s) => s.tool === 'wikidata + wikipedia')).toBe(true);
    for (const p of r.qlooProposals) for (const c of p.checks) expect(c.detail && c.detailEs).toBeTruthy();
  });

  it('without a verifier the same people stay pending (previous behavior)', async () => {
    const r = await runAgent({ target, others: [other], qloo: new Scripted(people), asOf: AS_OF, k: 3 });
    expect(r.qlooProposals.find((p) => p.name === 'Andrew Yang')!.outcome).toBe('pending');
    expect(r.recommendations.every((x) => x.source !== 'qloo-external')).toBe(true);
  });

  it('a documented person off the show’s themes is discarded on relevance, whatever Qloo’s rank', async () => {
    const music = mk('m', 'es', [
      ep('1', 'Cocinar pasta: recetas de la abuela', '2024-01-01T00:00:00.000Z', ['Uno Past']),
      ep('2', 'Recetas de cocina italiana', '2024-02-01T00:00:00.000Z', ['Dos Past']),
      ep('3', 'Cocina y comida para la familia', '2024-03-01T00:00:00.000Z', ['Tres Past']),
    ]);
    const r = await runAgent({ target: music, others: [other], qloo: new Scripted([people[2]], [music, other]), asOf: AS_OF, k: 2, verifier: new WikidataVerifier({ fetchJson: fixtureFetch() }) });
    expect(r.qlooProposals[0]).toMatchObject({ name: "Tulsi Gabbard", outcome: "discarded", failure: "theme" });
  });
});
