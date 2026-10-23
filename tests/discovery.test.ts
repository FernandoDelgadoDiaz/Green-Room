import { describe, expect, it } from 'vitest';
import { runAgent } from '../core/agent/agent';
import { compareWithBaseline } from '../core/discovery';
import { nameKey } from '../core/names';
import { MockQlooAdapter, NoQlooAdapter } from '../core/qloo/mock';
import type { QlooAdapter, QlooCall, QlooEntity } from '../core/qloo/types';
import type { PodcastDataset } from '../core/types';
import { CORE_DATASETS } from '../core/api';

const ep = (id: string, title: string, published: string, guests: string[]) => ({ id, title, published, url: null, guests: guests.map((name) => ({ name, method: 'title-pattern' as const, confidence: 'high' as const })), excluded: false });
const mk = (id: string, language: string, episodes: ReturnType<typeof ep>[]): PodcastDataset => ({ id, name: id, host: 'Host ' + id, hostAliases: ['Host ' + id], language, description: '', source: { feedUrl: '', website: '', retrievedAt: '', retrievedVia: '', note: '' }, episodes });
const AS_OF = '2024-06-01T00:00:00.000Z';

// Target: an English show about AI and robots, with named guests.
const target = mk('target', 'en', [
  ep('t1', 'Zed Past: the future of AI and robots', '2024-01-01T00:00:00.000Z', ['Zed Past']),
  ep('t2', 'Yan Past: robots, AI safety and the economy', '2024-02-01T00:00:00.000Z', ['Yan Past']),
  ep('t3', 'Xi Past: what AI means for jobs', '2024-03-01T00:00:00.000Z', ['Xi Past']),
]);
// Comparison show: who appeared where is the verifiable evidence.
const other = mk('other', 'en', [
  ep('o1', 'Ann Lee: AI safety and robots', '2024-04-01T00:00:00.000Z', ['Ann Lee']),
  ep('o2', 'Bob Ray: AI robots and the future of work', '2024-05-01T00:00:00.000Z', ['Bob Ray']),
  ep('o3', 'Bob Ray returns: AI robots and the economy', '2024-05-10T00:00:00.000Z', ['Bob Ray']),
  ep('o4', 'Bob Ray on AI chips and robots', '2024-05-20T00:00:00.000Z', ['Bob Ray']),
  ep('o5', 'Cara Cook: pasta recipes and Italian cooking', '2024-04-15T00:00:00.000Z', ['Cara Cook']),
]);
const titlesOf = (name: string) => [...target.episodes, ...other.episodes].filter((e) => e.guests.some((g) => g.name === name)).map((e) => e.title).join(' ');

/** LIVE test double: Qloo proposes a scripted list per signal; descriptions decide identity context. */
class DiscoveryQloo implements QlooAdapter {
  readonly mode = 'LIVE' as const;
  readonly calls: QlooCall[] = [];
  readonly insightCalls: Array<{ signals: number; tags: number }> = [];
  constructor(
    private readonly propose: (args: { signalIds: string[]; tagIds?: string[] }) => QlooEntity[],
    private readonly affinity: Record<string, number> = {},
  ) {}
  async searchPerson(name: string): Promise<QlooEntity[]> {
    return [{ entityId: `p:${nameKey(name)}`, name, description: titlesOf(name) || undefined }];
  }
  async searchPodcast(): Promise<QlooEntity[]> {
    return [];
  }
  async findTags(q: string): Promise<QlooEntity[]> {
    return [{ entityId: `urn:tag:${q}`, name: q }];
  }
  async personInsights(args: { signalIds: string[]; tagIds?: string[] }): Promise<QlooEntity[]> {
    this.insightCalls.push({ signals: args.signalIds.length, tags: args.tagIds?.length ?? 0 });
    // Person insights are typed people (Qloo subtype urn:entity:person), unless a test says otherwise.
    return this.propose(args).map((e) => ({ types: ['urn:entity:person', 'urn:entity'], ...e }));
  }
  async affinityFor({ candidateIds }: { candidateIds: string[] }) {
    return new Map(candidateIds.filter((id) => id in this.affinity).map((id) => [id, this.affinity[id]]));
  }
  async categoryInsights(): Promise<QlooEntity[]> {
    return [];
  }
}

const MIXED: QlooEntity[] = [
  { entityId: 'q:ann', name: 'Ann Lee', description: 'AI safety researcher who writes about robots' },
  { entityId: 'q:bob', name: 'Bob Ray', description: 'Award-winning pastry chef' },
  { entityId: 'q:cara', name: 'Cara Cook', description: 'Italian cooking and pasta recipes' },
  { entityId: 'q:zed', name: 'Zed Past', description: 'AI robots' },
  { entityId: 'q:seg', name: 'The Weekly Roundup' },
  { entityId: 'q:unk', name: 'Nora Unknown', description: 'novelist' },
];

describe('Qloo-first discovery: Qloo proposes, the agent verifies', () => {
  it('classifies every proposal and only lets verified, on-theme people into the ranking', async () => {
    const r = await runAgent({ target, others: [other], qloo: new DiscoveryQloo(() => MIXED), asOf: AS_OF, k: 2 });
    const out = Object.fromEntries(r.qlooProposals.map((p) => [p.name, [p.outcome, p.failure ?? null]]));
    expect(out).toEqual({
      'Ann Lee': ['ranked', null],
      'Bob Ray': ['pending', 'identity'], // same name, but "pastry chef" shares no context with AI interviews
      'Cara Cook': ['discarded', 'theme'],
      'Zed Past': ['discarded', 'repeat'],
      'The Weekly Roundup': ['discarded', 'not_person'],
      'Nora Unknown': ['pending', 'coverage'],
    });
    expect(r.funnel).toMatchObject({ proposed: 6, notPerson: 1, repeats: 1, identityVerified: 2, noRecord: 1, identityUnconfirmed: 1, offTheme: 1, ranked: 1, languageCompatible: 1, diagnosis: 'ok' });
    // Only the unverifiable Qloo-only person is a pending discovery; nobody is promoted on Qloo's word.
    expect(r.discoveries.map((d) => d.name)).toEqual(['Nora Unknown']);
    const ann = r.recommendations.find((x) => x.name === 'Ann Lee')!;
    expect(ann.source).toBe('qloo-person-insights');
    expect(ann.identity.status).toBe('confirmed');
    expect(ann.assessment.qlooProposedRank).toBe(1);
    expect(ann.rationale.some((x) => /Proposed by Qloo .* verified/.test(x.text))).toBe(true);
    // Every proposal carries its checks, in both languages.
    for (const p of r.qlooProposals) for (const c of p.checks) expect(c.detail && c.detailEs).toBeTruthy();
    expect(r.trace.some((s) => s.tool === 'verify_discoveries')).toBe(true);
  });

  it('gives Qloo-proposed people no score bonus: same formula as the baseline candidates', async () => {
    const live = await runAgent({ target, others: [other], qloo: new DiscoveryQloo(() => MIXED), asOf: AS_OF, k: 2 });
    const base = await runAgent({ target, others: [other], qloo: new NoQlooAdapter(), asOf: AS_OF, k: 2 });
    const ann = (x: typeof live) => x.recommendations.find((r) => r.name === 'Ann Lee')!;
    // No affinity values returned: the LIVE blend keeps everyone at the neutral 0.5, nothing else changes.
    expect(ann(live).assessment.editorialRelevance).toBeCloseTo(ann(base).assessment.editorialRelevance, 9);
  });

  it('replans the discovery with another signal when nothing Qloo proposed can be verified', async () => {
    const q = new DiscoveryQloo((a) => (a.tagIds?.length ? [MIXED[0]] : [MIXED[5]]));
    const r = await runAgent({ target, others: [other], qloo: q, asOf: AS_OF, k: 2 });
    const plan = r.plan.map((p) => p.tool);
    expect(plan.filter((x) => x === 'qloo_discover_people')).toHaveLength(2);
    expect(r.plan.find((p) => p.tool === 'qloo_find_theme_tags')!.why).toMatch(/Replanning the discovery — Coverage/);
    expect(r.funnel.attempts.map((x) => x.signal)).toEqual(['guests', 'tags']);
    expect(r.qlooProposals.find((p) => p.name === 'Ann Lee')).toMatchObject({ outcome: 'ranked', attempt: 2 });
    // The alternative tags only drive the discovery: the affinity signal stays the confirmed guests.
    expect(q.insightCalls[0]).toEqual({ signals: 3, tags: 0 });
    expect(q.insightCalls[1]).toEqual({ signals: 0, tags: expect.any(Number) });
  });

  it('says so honestly when Qloo yields nothing verifiable, and keeps the verified ranking', async () => {
    const r = await runAgent({ target, others: [other], qloo: new DiscoveryQloo(() => [MIXED[5]]), asOf: AS_OF, k: 2 });
    expect(r.funnel.ranked).toBe(0);
    expect(r.funnel.diagnosis).toBe('coverage');
    expect(r.warnings.some((w) => /did not yield any verifiable new candidate/.test(w))).toBe(true);
    expect(r.recommendations.every((x) => x.assessment.qlooProposedRank === null)).toBe(true);
    expect(r.recommendations.length).toBe(2);
  });

  it('reports a coverage failure when Qloo proposes nobody', async () => {
    const r = await runAgent({ target, others: [other], qloo: new DiscoveryQloo(() => []), asOf: AS_OF, k: 2 });
    expect(r.funnel).toMatchObject({ proposed: 0, diagnosis: 'coverage' });
    expect(r.funnel.diagnosisText).toMatch(/proposed nobody/);
  });

  it('MOCK and baseline runs never claim a discovery', async () => {
    for (const qloo of [new MockQlooAdapter(), new NoQlooAdapter()]) {
      const d = CORE_DATASETS[0];
      const r = await runAgent({ target: d, others: CORE_DATASETS.filter((x) => x.id !== d.id), qloo });
      expect(r.funnel.proposed).toBe(0);
      expect(r.funnel.diagnosis).toBe('not_run');
      expect(r.recommendations.every((x) => x.source === 'verified-pool')).toBe(true);
    }
  });
});

describe('baseline comparison', () => {
  it('a high Qloo affinity cannot lift a much less relevant person over the baseline pick (editorial band)', async () => {
    // Bob has three recent interviews, Ann one: Ann is far outside the editorial band, so a 0.95
    // affinity does not move her above Bob. (Before Phase 7 it did: this is the deliberate change.)
    const q = new DiscoveryQloo(() => [MIXED[0]], { 'q:ann': 0.95, 'p:bob ray': 0.05 });
    const enriched = await runAgent({ target, others: [other], qloo: q, asOf: AS_OF, k: 1 });
    const baseline = await runAgent({ target, others: [other], qloo: new NoQlooAdapter(), asOf: AS_OF, k: 1 });
    expect(baseline.recommendations.map((x) => x.name)).toEqual(['Bob Ray']);
    expect(enriched.recommendations.map((x) => x.name)).toEqual(['Bob Ray']);
    const c = compareWithBaseline(baseline, enriched);
    expect(c.newRelations).toEqual([]);
    expect(c.overlap).toBe(1);
  });

  it('counts agreement as a confirmation, not as a contribution', async () => {
    const enriched = await runAgent({ target, others: [other], qloo: new DiscoveryQloo(() => [MIXED[0]]), asOf: AS_OF, k: 2 });
    const baseline = await runAgent({ target, others: [other], qloo: new NoQlooAdapter(), asOf: AS_OF, k: 2 });
    const c = compareWithBaseline(baseline, enriched);
    expect(c.confirmations).toEqual(['Ann Lee']);
    expect(c.newRelations).toEqual([]);
  });
});
