// Phase 8: the blockers confirmed by the Phase 7 LIVE validation, reproduced on real data.
// Qloo answers here are SCRIPTED (names and tag strings observed in the LIVE run); RSS feeds and
// Wikidata/Wikipedia responses are real (fixtures recorded 2026-10-23). Nothing here is LIVE evidence.
import { describe, expect, it } from 'vitest';
import { runAgent } from '../core/agent/agent';
import { DATASETS, ORIGIN_OF } from '../core/api';
import { compareArms } from '../core/discovery';
import { BLIND_COLUMNS, blindNames, blindSheetCsv, buildBlindSet } from '../core/editorial';
import { nameKey } from '../core/names';
import { NoQlooAdapter } from '../core/qloo/mock';
import { compactKey } from '../core/qloo/signals';
import type { QlooAdapter, QlooCall, QlooEntity } from '../core/qloo/types';
import { externalThemes } from '../core/verify/occupations';
import { WikidataVerifier } from '../core/verify/external';
import type { PodcastDataset } from '../core/types';
import { fixtureFetch } from './fixtures/wikidata/fetch';

const show = (id: string) => DATASETS.find((d) => d.id === id)!;
const othersOf = (id: string) => DATASETS.filter((d) => d.id !== id);

/** A LIVE-shaped adapter whose answers are scripted; records what reached personInsights. */
function scripted(o: Partial<Pick<QlooAdapter, 'searchPerson' | 'searchPodcast' | 'findTags'>> & { people?: QlooEntity[] } = {}) {
  const insights: Array<{ signalIds: string[]; tagIds?: string[] }> = [];
  const qloo: QlooAdapter = {
    mode: 'LIVE',
    calls: [] as QlooCall[],
    searchPerson: o.searchPerson ?? (async () => []),
    searchPodcast: o.searchPodcast ?? (async () => []),
    findTags: o.findTags ?? (async () => []),
    personInsights: async (a) => (insights.push(a), o.people ?? []),
    affinityFor: async () => new Map<string, number>(),
    categoryInsights: async () => [],
  };
  return { qloo, insights };
}

// Tag strings exactly as the LIVE run returned them (case and spacing variants of one concept).
const OBSERVED_TAGS: QlooEntity[] = [
  { entityId: 'urn:tag:keyword:qloo:stand_up_comedy', name: 'Stand Up Comedy' },
  { entityId: 'urn:tag:genre:qloo:stand_up_comedy', name: 'stand up comedy' },
  { entityId: 'urn:tag:keyword:qloo:artificial_intelligence', name: 'Artificial Intelligence' },
  { entityId: 'urn:tag:genre:qloo:artificial_intelligence', name: 'artificial intelligence' },
  { entityId: 'urn:tag:keyword:qloo:technology', name: 'Technology' },
];

describe('semantic tag duplicates (root cause: equivalent results rejected as ambiguous)', () => {
  it('normalizes case, spaces, hyphens and accents to one key', () => {
    expect(new Set(['Stand Up Comedy', 'stand up comedy', 'Stand-Up Comedy', 'stand-up comedy'].map(compactKey))).toEqual(new Set(['standupcomedy']));
    expect(compactKey('Tecnología')).toBe(compactKey('tecnologia'));
    expect(compactKey('Artificial Intelligence')).toBe(compactKey('artificial intelligence'));
  });

  it('CREATIVO: "comediantes" → stand-up comedy is accepted with both equivalent ids and provenance', async () => {
    const { qloo, insights } = scripted({ findTags: async () => OBSERVED_TAGS });
    const r = await runAgent({ target: show('creativo'), others: othersOf('creativo'), qloo, originOf: ORIGIN_OF });
    const tag = r.signalDiagnostics.tags.find((t) => t.word === 'comediantes')!;
    expect(tag).toMatchObject({ query: 'stand-up comedy', accepted: 'Stand Up Comedy', acceptedIds: ['urn:tag:keyword:qloo:stand_up_comedy', 'urn:tag:genre:qloo:stand_up_comedy'] });
    // Unrelated tags returned for other words are NOT accepted just because Qloo returned them.
    for (const t of r.signalDiagnostics.tags.filter((x) => x.word !== 'comediantes')) expect(t.accepted).toBeNull();
    // Generic words never reach Qloo as signals.
    expect(r.signalDiagnostics.skippedGeneric).toEqual(expect.arrayContaining(['musica', 'dinero', 'exito']));
    expect(r.signalDiagnostics.verdict).toBe('ok');
    expect(insights[0].tagIds).toEqual(['urn:tag:keyword:qloo:stand_up_comedy', 'urn:tag:genre:qloo:stand_up_comedy']);
  });

  it('a broader or different tag is not taken as the concept (no forced acceptance)', async () => {
    const { qloo, insights } = scripted({ findTags: async () => [{ entityId: 'c', name: 'Comedy' }, { entityId: 'i', name: 'Improv Comedy' }] });
    const r = await runAgent({ target: show('creativo'), others: othersOf('creativo'), qloo, originOf: ORIGIN_OF });
    expect(r.signalDiagnostics.tags.every((t) => t.accepted === null)).toBe(true);
    expect(r.signalDiagnostics.verdict).toBe('unrecognized');
    expect(insights).toHaveLength(0);
  });
});

describe('missing guest names in the RSS (Santiago Bilinkis: few episodes name a guest)', () => {
  it('the real feed has almost no guest names, so the signal must come from the podcast or tags', () => {
    const d = show('santiago-bilinkis');
    expect(d.episodes.filter((e) => e.guests.length).length / d.episodes.length).toBeLessThan(0.05);
  });

  it('tags "Artificial Intelligence" and "Technology" reach personInsights; the verdict is ok', async () => {
    const { qloo, insights } = scripted({ findTags: async () => OBSERVED_TAGS });
    const r = await runAgent({ target: show('santiago-bilinkis'), others: othersOf('santiago-bilinkis'), qloo, originOf: ORIGIN_OF });
    const accepted = r.signalDiagnostics.tags.filter((t) => t.accepted).map((t) => [t.word, t.accepted, t.acceptedIds]);
    expect(accepted).toEqual([
      ['ia', 'Artificial Intelligence', ['urn:tag:keyword:qloo:artificial_intelligence', 'urn:tag:genre:qloo:artificial_intelligence']],
      ['tecnologia', 'Technology', ['urn:tag:keyword:qloo:technology']],
    ]);
    expect(r.signalDiagnostics.verdict).toBe('ok');
    expect(r.signalStrategy).toBe('tags');
    expect(insights[0].tagIds).toEqual(['urn:tag:keyword:qloo:artificial_intelligence', 'urn:tag:genre:qloo:artificial_intelligence', 'urn:tag:keyword:qloo:technology']);
    // No invented guests: zero person signals when the feed names none.
    expect(insights[0].signalIds).toEqual([]);
  });

  it('a podcast record matching the show name (with the "Host – Title" form) is used as the signal', async () => {
    const { qloo, insights } = scripted({ searchPodcast: async () => [{ entityId: 'pod:bilinkis', name: 'Futuro en Construcción', types: ['urn:entity:podcast'] }] });
    const r = await runAgent({ target: show('santiago-bilinkis'), others: othersOf('santiago-bilinkis'), qloo, originOf: ORIGIN_OF });
    expect(r.signalDiagnostics.podcast.some((p) => p.exactMatches > 0)).toBe(true);
    expect(insights[0].signalIds).toContain('pod:bilinkis');
  });
});

describe('Spanish guest identity: same-name records are settled by context, never by luck', () => {
  const ep = (id: string, title: string, guests: string[]) => ({ id, title, published: `2024-0${id}-01T00:00:00.000Z`, url: null, guests: guests.map((name) => ({ name, method: 'title-pattern' as const, confidence: 'high' as const })), excluded: false });
  const es: PodcastDataset = { id: 'es', name: 'Show ES', host: 'Host', hostAliases: ['Host'], language: 'es', description: '', source: { feedUrl: '', website: '', retrievedAt: '', retrievedVia: '', note: '' }, episodes: [ep('1', 'Ana Uno: la cantante mexicana y su nuevo disco', ['Ana Uno']), ep('2', 'Beto Dos: el futbolista argentino', ['Beto Dos']), ep('3', 'Ceci Tres: la escritora chilena', ['Ceci Tres'])] };
  const AS_OF = '2024-06-01T00:00:00.000Z';

  it('two records with the guest’s name: the one sharing context is confirmed and reaches personInsights', async () => {
    const { qloo, insights } = scripted({
      searchPerson: async (n) => [
        { entityId: `${n}:right`, name: n, description: { 'Ana Uno': 'Mexican singer and songwriter', 'Beto Dos': 'Argentine football player', 'Ceci Tres': 'Chilean writer' }[n] },
        { entityId: `${n}:other`, name: n, description: 'Canadian swimmer' },
      ],
    });
    const r = await runAgent({ target: es, others: [], qloo, asOf: AS_OF });
    expect(r.signalDiagnostics.guests).toMatchObject({ searched: 3, confirmed: 3, ambiguous: 0 });
    expect(r.signalStrategy).toBe('guests');
    expect(insights[0].signalIds.sort()).toEqual(['Ana Uno:right', 'Beto Dos:right', 'Ceci Tres:right']);
  });

  it('two records and no context for either: stays ambiguous, nothing is sent', async () => {
    const { qloo, insights } = scripted({ searchPerson: async (n) => [{ entityId: 'a', name: n }, { entityId: 'b', name: n }] });
    const r = await runAgent({ target: es, others: [], qloo, asOf: AS_OF });
    expect(r.signalDiagnostics.guests.confirmed).toBe(0);
    expect(r.signalDiagnostics.verdict).toBe('ambiguous');
    expect(insights).toHaveLength(0);
  });
});

// ------------------------------------------------ DOAC: the candidates named by the LIVE validation
// Names (and Qloo's generic "urn:entity" type) as reported by the LIVE run; no affinity, so the
// ranking below is our own evidence only. Wikidata/Wikipedia answers are real fixtures.
const DOAC_NAMES: Array<[string, string]> = [
  ['Andrew Yang', 'entrepreneur and political candidate'],
  ['Tulsi Gabbard', 'American politician'],
  ['Dan Price', 'Internet entrepreneur'],
  ['Saagar Enjeti', 'political podcaster and journalist'],
  ['Howard Schultz', 'businessman'],
  ['Steven M. Greer', 'ufologist'],
  ['Joe Biden', 'politician, president'],
  ['Lex Friedman', 'computer scientist and podcaster'],
];
function doacQloo() {
  const titles = new Map<string, string[]>();
  for (const d of DATASETS) for (const e of d.episodes) for (const g of e.guests) titles.set(nameKey(g.name), [...(titles.get(nameKey(g.name)) ?? []), e.title]);
  return scripted({
    searchPerson: async (name) => [{ entityId: `p:${nameKey(name)}`, name, types: ['urn:entity:person'], description: titles.get(nameKey(name))?.join(' ') }],
    people: DOAC_NAMES.map(([name, description], i) => ({ entityId: `S${i}`, name, description, types: ['urn:entity'] })),
  }).qloo;
}
const runDoac = () => runAgent({ target: show('diary-of-a-ceo'), others: othersOf('diary-of-a-ceo'), qloo: doacQloo(), originOf: ORIGIN_OF, verifier: new WikidataVerifier({ fetchJson: fixtureFetch() }), qlooAffinity: false });

describe('thematic evaluation separates identity, pertinence, potential and availability', () => {
  it('Greer is discarded on theme from his own description (ufologist), not promoted by a secondary occupation', () => {
    const t = externalThemes({ description: { en: 'American ufologist', es: null }, occupations: ['physician', 'ufologist'] } as never);
    expect(t.basis).toBe('description');
    expect(t.vector.health ?? 0).toBe(0);
  });

  it('DOAC: each named candidate gets an explicit, separate verdict', async () => {
    const r = await runDoac();
    const out = Object.fromEntries(r.qlooProposals.map((p) => [p.name, [p.outcome, p.failure ?? null, p.external?.wikidataId ?? null]]));
    expect(out['Steven M. Greer']).toEqual(['discarded', 'theme', 'Q2428144']);
    // Schultz (fit 0.27 in LIVE) is now eligible through the show's established business theme…
    expect(out['Howard Schultz']).toEqual(['ranked', null, 'Q472330']);
    // …and Biden's identity is documented, but availability is explicitly NOT assessed.
    expect(out['Joe Biden']).toEqual(['ranked', null, 'Q6279']);
    expect(r.recommendations.every((x) => x.assessment.availability === 'not_assessed')).toBe(true);
    // "Lex Friedman" resolves to Lex Fridman (Q76448707, via alias), not to the other Lex Friedman (Q119266625)…
    expect(out['Lex Friedman']).toEqual(['pending', 'identity', 'Q76448707']);
    // …but our only RSS record ("#2260 - Lex Fridman") carries no context to prove it is the same person: pending, not merged.
    const lex = r.qlooProposals.find((p) => p.name === 'Lex Friedman')!;
    const identity = lex.checks.filter((c) => c.check === 'identity');
    expect(identity.some((c) => /“Lex Friedman” is Wikidata’s “Lex Fridman” \(Q76448707\)/.test(c.detail))).toBe(true);
    expect(identity.at(-1)).toMatchObject({ ok: false, detail: expect.stringMatching(/possible namesake/) });
  });
});

describe('why discoveries do or do not reach the top 5 (DOAC)', () => {
  it('reports cutoff, final rank and a concrete reason per admitted discovery; nobody is forced in', async () => {
    const r = await runDoac();
    expect(r.cutoff?.name).toBeTruthy();
    const pos = Object.fromEntries(r.discoveryPositions.map((p) => [p.name, p]));
    expect(Object.keys(pos).sort()).toEqual(['Andrew Yang', 'Dan Price', 'Howard Schultz', 'Joe Biden', 'Saagar Enjeti', 'Tulsi Gabbard']);
    for (const p of Object.values(pos)) {
      expect(p.inTopK).toBe(false);
      expect(p.finalRank).toBeGreaterThan(5);
      expect(p.reason).toBeTruthy();
      expect(p.reasonEs).toBeTruthy();
    }
    // The gap is topical, not missing history: even with maximal activity and recency Yang stays below the cutoff.
    expect(pos['Andrew Yang'].reason).toMatch(/gap is topical, not missing history/);
    expect(pos['Andrew Yang'].notMeasured).toEqual(expect.arrayContaining(['momentum', 'recency']));
    // Dan Price is held back by an unconfirmed language, and the reason says so.
    expect(pos['Dan Price'].languageConfirmed).toBe(false);
    expect(pos['Dan Price'].reason).toMatch(/Language not confirmed/);
    expect(r.recommendations.every((x) => x.source !== 'qloo-external')).toBe(true);
  });
});

describe('A/B/C/D attribution does not credit Qloo for reordering', () => {
  it('reports no new-to-corpus people in the top list and says Qloo did not improve it', async () => {
    const run = (qloo: QlooAdapter, d: boolean) => runAgent({ target: show('diary-of-a-ceo'), others: othersOf('diary-of-a-ceo'), qloo, originOf: ORIGIN_OF, qlooDiscovery: d, qlooAffinity: false, verifier: d ? new WikidataVerifier({ fetchJson: fixtureFetch() }) : undefined });
    const A = await run(new NoQlooAdapter(), false);
    const B = await run(doacQloo(), true);
    const cmp = compareArms({ A, B, C: A, D: B });
    expect(cmp.arms.find((m) => m.arm === 'B')!.originality.newToCorpus).toBe(0);
    expect(cmp.qlooImprovedTopWithNewPeople).toBe(false);
    expect(cmp.verdict.en).toMatch(/Qloo did not improve the top list with new people/);
    expect(cmp.verdict.es).toMatch(/Qloo no mejoró la lista principal/);
  });
});

describe('blind editorial set', () => {
  it('pools baseline and admitted Qloo people with identical fields and no provenance in the sheet', async () => {
    const A = await runAgent({ target: show('diary-of-a-ceo'), others: othersOf('diary-of-a-ceo'), qloo: new NoQlooAdapter(), originOf: ORIGIN_OF, k: 5 });
    const D = await runDoac();
    const names = blindNames(A, D);
    const descriptions = Object.fromEntries(names.map((n) => [nameKey(n), `desc of ${n}`]));
    const { items, key } = buildBlindSet({ id: 'diary-of-a-ceo', name: 'DOAC' }, A, D, descriptions);
    expect(items).toHaveLength(names.length);
    expect(key.baseline).toHaveLength(5);
    expect(key.qloo).toHaveLength(D.discoveryPositions.length);
    // Every item has a description from the same lookup (none falls back because of where it came from).
    expect(items.every((i) => i.description.startsWith('desc of '))).toBe(true);
    const csv = blindSheetCsv(items);
    expect(csv.split('\n')[0]).toBe(BLIND_COLUMNS.join(','));
    expect(csv).not.toMatch(/qloo|baseline|verified-pool|affinity/i);
    // Ids are opaque and the key is the only link to the arm.
    expect(new Set(items.map((i) => i.itemId)).size).toBe(items.length);
    expect([...key.baseline, ...key.qloo].every((id) => items.some((i) => i.itemId === id))).toBe(true);
  });
});
