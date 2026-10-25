import { describe, expect, it } from 'vitest';
import { runAgent } from '../core/agent/agent';
import { compareArms, compareWithBaseline } from '../core/discovery';
import { buildTagQueries, showNameVariants } from '../core/qloo/signals';
import { nameKey } from '../core/names';
import { NoQlooAdapter } from '../core/qloo/mock';
import type { QlooAdapter, QlooCall, QlooEntity } from '../core/qloo/types';
import type { PodcastDataset } from '../core/types';

const ep = (id: string, title: string, published: string, guests: string[]) => ({ id, title, published, url: null, guests: guests.map((name) => ({ name, method: 'title-pattern' as const, confidence: 'high' as const })), excluded: false });
const mk = (id: string, episodes: ReturnType<typeof ep>[]): PodcastDataset => ({ id, name: id, host: 'Host ' + id, hostAliases: ['Host ' + id], language: 'en', description: '', source: { feedUrl: '', website: '', retrievedAt: '', retrievedVia: '', note: '' }, episodes });
const AS_OF = '2024-06-01T00:00:00.000Z';
const target = mk('t', [
  ep('t1', 'Zed Past: the future of AI and robots', '2024-01-01T00:00:00.000Z', ['Zed Past']),
  ep('t2', 'Yan Past: robots, AI safety and the economy', '2024-02-01T00:00:00.000Z', ['Yan Past']),
  ep('t3', 'Xi Past: what AI means for jobs', '2024-03-01T00:00:00.000Z', ['Xi Past']),
]);
const other = mk('o', [
  ep('o1', 'Ann Lee: AI safety and robots', '2024-04-01T00:00:00.000Z', ['Ann Lee']),
  ep('o2', 'Bob Ray: AI robots and the future of work', '2024-05-01T00:00:00.000Z', ['Bob Ray']),
  ep('o3', 'Bob Ray returns: AI robots and the economy', '2024-05-10T00:00:00.000Z', ['Bob Ray']),
]);
const titlesOf = (name: string) => [...target.episodes, ...other.episodes].filter((e) => e.guests.some((g) => g.name === name)).map((e) => e.title).join(' ');

class Fake implements QlooAdapter {
  readonly mode = 'LIVE' as const;
  readonly calls: QlooCall[] = [];
  constructor(private readonly people: QlooEntity[], private readonly aff: Record<string, number>) {}
  async searchPerson(name: string): Promise<QlooEntity[]> {
    return [{ entityId: `p:${nameKey(name)}`, name, description: titlesOf(name) }];
  }
  async searchPodcast() { return []; }
  async findTags() { return []; }
  async personInsights() { return this.people.map((e) => ({ types: ['urn:entity:person', 'urn:entity'], ...e })); }
  async affinityFor({ candidateIds }: { candidateIds: string[] }) {
    return new Map(candidateIds.filter((id) => id in this.aff).map((id) => [id, this.aff[id]]));
  }
  async categoryInsights() { return []; }
  readonly explanations = new Map<string, Array<{ entityId: string; score: number }>>();
}

describe('four controlled arms: which Qloo effect changes the list', () => {
  it('separates discovery from affinity weighting (the CREATIVO case: changes without any admitted discovery)', async () => {
    // Qloo proposes nobody verifiable, but its affinity favors Ann over Bob, who leads the baseline.
    const make = () => new Fake([{ entityId: 'q:x', name: 'Nora Unknown' }], { 'p:ann lee': 0.9, 'p:bob ray': 0.1 });
    const run = (qloo: QlooAdapter, d: boolean, a: boolean) => runAgent({ target, others: [other], qloo, asOf: AS_OF, k: 1, qlooDiscovery: d, qlooAffinity: a });
    const arms = { A: await run(new NoQlooAdapter(), false, false), B: await run(make(), true, false), C: await run(make(), false, true), D: await run(make(), true, true) };
    const cmp = compareArms(arms);
    const top = Object.fromEntries(cmp.arms.map((m) => [m.arm, m.top.map((x) => x.name)]));
    expect(top).toEqual({ A: ['Bob Ray'], B: ['Bob Ray'], C: ['Ann Lee'], D: ['Ann Lee'] });
    expect(cmp.arms.find((m) => m.arm === 'B')!.funnel.ranked).toBe(0);
    expect(cmp.attribution.en).toMatch(/^Discovery alone did not change the top list; affinity weighting alone changed 1/);
    // Ann's editorial relevance (no Qloo) is lower than Bob's: the change is affinity, not evidence.
    const c = cmp.arms.find((m) => m.arm === 'C')!;
    expect(c.top[0].baselineRank).toBe(2);
    expect(c.meanEditorialRelevance).toBeLessThan(cmp.arms.find((m) => m.arm === 'A')!.meanEditorialRelevance);
    for (const n of cmp.notes) expect(n.es).toBeTruthy();
  });

  it('arm B lets a verified discovery compete without any affinity bonus', async () => {
    const make = () => new Fake([{ entityId: 'q:ann', name: 'Ann Lee', description: 'AI safety researcher on robots' }], { 'q:ann': 0.99 });
    const B = await runAgent({ target, others: [other], qloo: make(), asOf: AS_OF, k: 2, qlooDiscovery: true, qlooAffinity: false });
    const ann = B.recommendations.find((r) => r.name === 'Ann Lee')!;
    expect(ann.assessment.qlooProposedRank).toBe(1);
    expect(ann.assessment.qlooAffinity).toBeNull();
    expect(ann.score).toBeCloseTo(ann.assessment.editorialRelevance, 9);
    expect(B.qlooCalls.some((c) => c.params?.['filter.results.entities'])).toBe(false);
  });
});

describe('editorial band: affinity reorders comparable candidates only', () => {
  const show = (others: PodcastDataset) => others;
  it('reorders within the band, never lifts a clearly less relevant candidate', async () => {
    // Close: Ann and Bob both have one recent AI interview (comparable relevance) → affinity may decide.
    const close = mk('c', [ep('c1', 'Ann Lee: AI safety and robots', '2024-05-01T00:00:00.000Z', ['Ann Lee']), ep('c2', 'Bob Ray: AI robots and the future', '2024-05-02T00:00:00.000Z', ['Bob Ray'])]);
    // Far: Bob has four recent interviews, Ann one old one → affinity must not lift Ann.
    const far = mk('f', [
      ep('f1', 'Ann Lee: AI safety and robots', '2023-01-01T00:00:00.000Z', ['Ann Lee']),
      ...['2024-05-01', '2024-05-05', '2024-05-10', '2024-05-20'].map((d, i) => ep(`b${i}`, 'Bob Ray: AI robots and the future of work', `${d}T00:00:00.000Z`, ['Bob Ray'])),
    ]);
    const aff = { 'p:ann lee': 0.99, 'p:bob ray': 0.01 };
    const run = (o: PodcastDataset) => runAgent({ target, others: [show(o)], qloo: new Fake([], aff), asOf: AS_OF, k: 1, qlooDiscovery: false });
    const closeRun = await run(close);
    expect(closeRun.recommendations[0].name).toBe('Ann Lee');
    // The comparison names the effect: Ann entered through affinity (no discovery), Bob was displaced.
    const base = await runAgent({ target, others: [close], qloo: new NoQlooAdapter(), asOf: AS_OF, k: 1 });
    const cmp = compareWithBaseline(base, closeRun);
    expect(cmp.affinityPromoted.map((x) => x.name)).toEqual(['Ann Lee']);
    expect(cmp.displaced).toEqual(['Bob Ray']);
    expect(cmp.newRelations).toEqual([]);
    // Person by person, measured alike: Ann entered on affinity, Bob left with a lower affinity.
    const ann = cmp.rows!.find((x) => x.name === 'Ann Lee')!;
    const bob = cmp.rows!.find((x) => x.name === 'Bob Ray')!;
    expect(ann).toMatchObject({ status: 'entered', enteredBy: 'affinity', withQlooRank: 1, withoutQlooRank: 2 });
    expect(bob).toMatchObject({ status: 'left', enteredBy: null, withQlooRank: null, withoutQlooRank: 1 });
    expect(ann.affinity!).toBeGreaterThan(bob.affinity!);
    expect(bob.editorial!).toBeGreaterThan(ann.editorial!);
    expect(cmp.means!.withQloo).toEqual({ affinity: ann.affinity, affinityKnown: 1, editorial: ann.editorial });
    expect(cmp.means!.withoutQloo).toEqual({ affinity: bob.affinity, affinityKnown: 1, editorial: bob.editorial });
    // Explainability: the past guests that drove Ann's affinity, by name; nothing invented when Qloo gives none.
    const explained = new Fake([], { 'p:ann lee': 0.9, 'p:bob ray': 0.1 });
    explained.explanations.set('p:ann lee', [{ entityId: 'p:yan past', score: 0.6 }, { entityId: 'p:zed past', score: 0.3 }, { entityId: 'unknown', score: 0.9 }]);
    const withWhy = await runAgent({ target, others: [close], qloo: explained, asOf: AS_OF, k: 1 });
    expect(withWhy.recommendations[0].qlooAudience?.explainedBy).toEqual(['Yan Past', 'Zed Past']);
    expect(closeRun.recommendations[0].qlooAudience?.explainedBy).toBeUndefined();
    const r = await run(far);
    expect(r.recommendations[0].name).toBe('Bob Ray');
    expect(r.trace.find((s) => s.tool?.startsWith('qloo.insights (filter'))!.decision).toMatch(/within 15%/);
  });
});

describe('Qloo signals from documented themes', () => {
  it('skips generic words and sends specific ones in English when possible', () => {
    const { queries, skippedGeneric } = buildTagQueries([{ words: ['musica', 'tv', 'comediantes'] }, { words: ['inteligencia', 'artificial', 'tecnologia'] }]);
    expect(skippedGeneric).toEqual(['musica', 'tv']);
    expect(queries.map((q) => q.query)).toEqual(['stand-up comedy', 'artificial intelligence', 'technology']);
    expect(queries[1].accepts).toEqual(['inteligencia', 'artificialintelligence']);
  });

  it('never invents themes: no words, no queries', () => {
    expect(buildTagQueries([]).queries).toEqual([]);
    expect(buildTagQueries([{ words: ['vida', 'amor'] }]).queries).toEqual([]);
  });

  it('exact-title variants of a show name, never fuzzy', () => {
    expect(showNameVariants('Santiago Bilinkis – Futuro en Construcción', 'Santiago Bilinkis')).toEqual(['Santiago Bilinkis – Futuro en Construcción', 'Futuro en Construcción', 'Santiago Bilinkis']);
    expect(showNameVariants('LO QUE TÚ DIGAS con Alex Fidalgo')).toEqual(['LO QUE TÚ DIGAS con Alex Fidalgo', 'LO QUE TÚ DIGAS']);
    expect(showNameVariants('The Joe Rogan Experience')).toEqual(['The Joe Rogan Experience']);
  });
});
