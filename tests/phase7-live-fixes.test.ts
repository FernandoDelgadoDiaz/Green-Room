import { describe, expect, it } from 'vitest';
import { parseEntities } from '../core/qloo/client';
import { qlooKind, type QlooAdapter, type QlooCall, type QlooEntity } from '../core/qloo/types';
import { identityEvidence } from '../core/qloo/resolve';
import { WikidataVerifier } from '../core/verify/external';
import { runAgent } from '../core/agent/agent';
import { nameKey } from '../core/names';
import { fixtureFetch } from './fixtures/wikidata/fetch';
import type { PodcastDataset } from '../core/types';

// Entity shape as read by the official @qloo/qloo-harness 0.1.26 (entityType: `subtype || type`;
// descriptions at top level or under properties). Values are illustrative, not a recorded response.
const insightsBody = {
  success: true,
  results: {
    entities: [
      { name: 'Andrew Yang', entity_id: 'AAA-1', type: 'urn:entity', subtype: 'urn:entity:person', popularity: 0.97, query: { affinity: 0.81 }, properties: { short_description: 'American entrepreneur and political candidate' } },
      { name: 'Khruangbin', entity_id: 'BBB-2', type: 'urn:entity', subtype: 'urn:entity:artist', popularity: 0.9, query: { affinity: 0.7 } },
      { name: 'Some Film', entity_id: 'CCC-3', type: 'urn:entity', subtype: 'urn:entity:movie' },
      { name: 'Generic Only', entity_id: 'DDD-4', type: 'urn:entity', short_description: 'top-level description' },
    ],
  },
};

describe('Qloo type contract (root cause of 89/90 rejections)', () => {
  it('reads the specific kind from `subtype`, not only the generic `type`', () => {
    const [yang, khru, film, generic] = parseEntities(insightsBody);
    expect(yang.types).toEqual(['urn:entity:person', 'urn:entity']);
    expect(yang.type).toBe('urn:entity:person');
    expect(yang.description).toBe('American entrepreneur and political candidate');
    expect(qlooKind(yang.types)).toBe('person');
    expect(qlooKind(khru.types)).toBe('unknown'); // artist covers solo artists AND bands: settled in Wikidata
    expect(qlooKind(film.types)).toBe('non_person');
    expect(generic.types).toEqual(['urn:entity']);
    expect(qlooKind(generic.types)).toBe('unknown');
    expect(generic.description).toBe('top-level description');
  });

  it('still reads a `types` array (/search shape)', () => {
    const [e] = parseEntities({ results: [{ entity_id: 'x', name: 'X', types: ['urn:entity:person'] }] });
    expect(qlooKind(e.types)).toBe('person');
  });
});

// ---------------------------------------------------------------- full circuit on real Wikidata fixtures
const ep = (id: string, title: string, published: string, guests: string[]) => ({ id, title, published, url: null, guests: guests.map((name) => ({ name, method: 'title-pattern' as const, confidence: 'high' as const })), excluded: false });
const mk = (id: string, episodes: ReturnType<typeof ep>[], language = 'en'): PodcastDataset => ({ id, name: id, host: 'Host ' + id, hostAliases: ['Host ' + id], language, description: '', source: { feedUrl: '', website: '', retrievedAt: '', retrievedVia: '', note: '' }, episodes });
const AS_OF = '2024-06-01T00:00:00.000Z';
const target = mk('t', [
  ep('1', 'Zed Past: entrepreneur on business, money and the economy', '2024-01-01T00:00:00.000Z', ['Zed Past']),
  ep('2', 'Yan Past: politics, democracy and the election', '2024-02-01T00:00:00.000Z', ['Yan Past']),
  ep('3', 'Xi Past: how to build a company and invest', '2024-03-01T00:00:00.000Z', ['Xi Past']),
]);
const other = mk('o', [ep('o1', 'Bob Ray: business and money for entrepreneurs', '2024-04-01T00:00:00.000Z', ['Bob Ray'])]);

class Live implements QlooAdapter {
  readonly mode = 'LIVE' as const;
  readonly calls: QlooCall[] = [];
  constructor(private readonly people: QlooEntity[]) {}
  async searchPerson(name: string): Promise<QlooEntity[]> {
    return [{ entityId: `p:${nameKey(name)}`, name, types: ['urn:entity:person'], description: [...target.episodes, ...other.episodes].filter((e) => e.guests.some((g) => g.name === name)).map((e) => e.title).join(' ') }];
  }
  async searchPodcast() { return []; }
  async findTags() { return []; }
  async personInsights() { return this.people; }
  async affinityFor() { return new Map<string, number>(); }
  async categoryInsights() { return []; }
}
// The exact situation reported by the LIVE run: every proposal typed only as "urn:entity".
const GENERIC = ['urn:entity'];
const people: QlooEntity[] = [
  { entityId: 'L1', name: 'Andrew Yang', types: GENERIC, description: 'Entrepreneur and political candidate' },
  { entityId: 'L2', name: 'Tulsi Gabbard', types: GENERIC, description: 'American politician' },
  { entityId: 'L3', name: 'Khruangbin', types: GENERIC, description: 'psychedelic band' },
  { entityId: 'L4', name: 'Rodrigo y Gabriela', types: GENERIC, description: 'guitar duo' },
];

describe('full circuit: proposal → identity → external verification → editorial evaluation → ranking', () => {
  it('generic Qloo types are classified in Wikidata, not discarded: people pass, bands do not', async () => {
    const r = await runAgent({ target, others: [other], qloo: new Live(people), asOf: AS_OF, k: 3, verifier: new WikidataVerifier({ fetchJson: fixtureFetch() }) });
    const out = Object.fromEntries(r.qlooProposals.map((p) => [p.name, [p.outcome, p.failure ?? null, p.external?.kind ?? null, p.external?.status ?? null]]));
    expect(out).toEqual({
      'Andrew Yang': ['ranked', null, 'person', 'documented'],
      'Tulsi Gabbard': ['ranked', null, 'person', 'documented'],
      Khruangbin: ['discarded', 'type', 'group', 'discarded'],
      'Rodrigo y Gabriela': ['discarded', 'type', 'group', 'discarded'],
    });
    // Andrew Yang went all the way into the final list, with sources and no imputed activity.
    const yang = r.recommendations.find((x) => x.name === 'Andrew Yang')!;
    expect(yang.external?.sources.map((s) => s.url)).toEqual(['https://www.wikidata.org/wiki/Q28723576', 'https://en.wikipedia.org/wiki/Andrew_Yang']);
    expect(yang.components.momentum.value).toBeNull();
    expect(yang.language).toMatchObject({ status: 'confirmed', basis: 'wikidata' });
    expect(r.funnel).toMatchObject({ externalQueued: 4, externalChecked: 4, externalOverCap: 0, externalDocumented: 2, typeErrors: 2 });
    // The proposal's checks record the generic type and the past-guest check.
    const checks = r.qlooProposals.find((p) => p.name === 'Andrew Yang')!.checks.map((c) => [c.check, c.ok]);
    expect(checks).toEqual(expect.arrayContaining([['person', null], ['repeat', true], ['external', true], ['identity', true], ['theme', true]]));
  });

  it('without the verifier, generic types stay pending (never ranked, never silently dropped)', async () => {
    const r = await runAgent({ target, others: [other], qloo: new Live(people), asOf: AS_OF, k: 3 });
    expect(r.qlooProposals.every((p) => p.outcome === 'pending')).toBe(true);
    expect(r.recommendations.every((x) => x.assessment.qlooProposedRank === null)).toBe(true);
  });

  it('an RSS-verified person with a generic Qloo type is ranked only after Wikidata says "human"', async () => {
    // "Bob Ray" is not in Wikidata: identity is proven by our RSS, the kind cannot be confirmed → pending.
    const r = await runAgent({ target, others: [other], qloo: new Live([{ entityId: 'B', name: 'Bob Ray', types: GENERIC, description: 'business and money for entrepreneurs' }]), asOf: AS_OF, k: 2, verifier: new WikidataVerifier({ fetchJson: fixtureFetch() }) });
    expect(r.qlooProposals[0]).toMatchObject({ outcome: 'pending', failure: 'type' });
    expect(r.funnel.typePending).toBe(1);
  });

  it('records proposals left out by the verification cap instead of dropping them silently', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ entityId: `M${i}`, name: `Unknown Person${i}`, types: GENERIC }));
    const r = await runAgent({ target, others: [other], qloo: new Live(many), asOf: AS_OF, k: 2, verifier: new WikidataVerifier({ fetchJson: fixtureFetch(), maxCandidates: 2 }) });
    expect(r.funnel).toMatchObject({ externalQueued: 5, externalChecked: 2, externalOverCap: 3 });
    expect(r.qlooProposals.filter((p) => /cap/.test(p.reason))).toHaveLength(3);
  });
});

describe('signal verdict only describes real Qloo answers', () => {
  it('MOCK runs report not_run', async () => {
    const { MockQlooAdapter } = await import('../core/qloo/mock');
    const r = await runAgent({ target, others: [other], qloo: new MockQlooAdapter(), asOf: AS_OF });
    expect(r.signalDiagnostics.verdict).toBe('not_run');
  });
});

describe('Spanish discovery: identity context across languages', () => {
  it('an English Qloo description matches Spanish interview titles', () => {
    const ev = identityEvidence({ entityId: 'x', name: 'Lila Downs', description: 'Mexican singer and songwriter' }, 'Lila Downs', ['Lila Downs: la cantante mexicana que canta en lenguas indígenas']);
    expect(ev.length).toBeGreaterThan(0);
    // Unrelated context still does not match.
    expect(identityEvidence({ entityId: 'y', name: 'Lila Downs', description: 'American football player' }, 'Lila Downs', ['Lila Downs: la cantante mexicana'])).toEqual([]);
  });
});

describe('signal diagnostics tell absence, non-recognition and ambiguity apart', () => {
  const show = mk('s', [
    ep('1', 'Ana Uno: la ciencia de los datos y la tecnología', '2024-01-01T00:00:00.000Z', ['Ana Uno']),
    ep('2', 'Beto Dos: inteligencia artificial y el futuro', '2024-02-01T00:00:00.000Z', ['Beto Dos']),
    ep('3', 'Ceci Tres: tecnología y negocios', '2024-03-01T00:00:00.000Z', ['Ceci Tres']),
  ], 'es');
  const base = { mode: 'LIVE' as const, calls: [] as QlooCall[], personInsights: async () => [], affinityFor: async () => new Map<string, number>(), categoryInsights: async () => [] };
  it('none_in_qloo: every lookup came back empty', async () => {
    const r = await runAgent({ target: show, others: [], qloo: { ...base, searchPerson: async () => [], searchPodcast: async () => [], findTags: async () => [] }, asOf: AS_OF });
    expect(r.signalDiagnostics.verdict).toBe('none_in_qloo');
    expect(r.signalDiagnostics.guests.notFound).toBe(3);
  });
  it('unrecognized: Qloo answered, but nothing matched exactly or shared context', async () => {
    const r = await runAgent({ target: show, others: [], qloo: { ...base, searchPerson: async (n: string) => [{ entityId: 'z', name: `${n} Jr` }], searchPodcast: async () => [{ entityId: 'p', name: 's Clips' }], findTags: async () => [{ entityId: 't', name: 'Technology News' }] }, asOf: AS_OF });
    expect(r.signalDiagnostics.verdict).toBe('unrecognized');
    expect(r.signalDiagnostics.tags[0]).toMatchObject({ results: 1, accepted: null, sample: ['Technology News'] });
  });
  it('ambiguous: namesakes prevented a match', async () => {
    const r = await runAgent({ target: show, others: [], qloo: { ...base, searchPerson: async (n: string) => [{ entityId: 'a', name: n }, { entityId: 'b', name: n }], searchPodcast: async () => [], findTags: async () => [] }, asOf: AS_OF });
    expect(r.signalDiagnostics.verdict).toBe('ambiguous');
  });
  it('ok: a Spanish show reaches Qloo through English tag names, without generic words', async () => {
    const r = await runAgent({ target: show, others: [], qloo: { ...base, searchPerson: async () => [], searchPodcast: async () => [], findTags: async (q: string) => (q === 'technology' ? [{ entityId: 'urn:tag:technology', name: 'Technology' }] : []) }, asOf: AS_OF });
    expect(r.signalDiagnostics.verdict).toBe('ok');
    expect(r.signalStrategy).toBe('tags');
    expect(r.signalDiagnostics.tags.find((x) => x.accepted)).toMatchObject({ word: 'tecnologia', query: 'technology', accepted: 'Technology' });
  });
});
