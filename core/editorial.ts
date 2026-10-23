// Blind editorial evaluation: are guests proposed WITH Qloo editorially better than WITHOUT it?
//
// Design (fixed before any rating):
//   - List A (without Qloo): the agent's top 10 with Qloo off.
//   - List B (with Qloo):   the agent's top (10 − d) with live Qloo affinity, plus up to d = 5 Qloo
//                           discoveries (people outside our sources), in Qloo's order.
//   - Both lists come from the same show, data and repeat-guest rules, and have the same size.
//   - Raters see ONE pooled, shuffled set of people with random ids and the same evidence fields
//     for everyone: our verified interviews (titles, dates, links) and nothing else. No scores, no
//     source, no Qloo values. Raters judge relevance, originality, identity and language themselves.
//   - The key (who came from which list) is written to a separate file, hashed, and only opened
//     by the scoring step.
//   - The historical backtest is NOT an input: hits are not evidence of editorial quality.
// Known limit: people Qloo discovers have no verified interviews in our sources, so a rater can
// guess they came from list B. Scoring reports exclusive items separately so this is visible.

import { createHash, randomBytes } from 'node:crypto';
import type { PodcastDataset } from './types';
import { runAgent } from './agent/agent';
import { NoQlooAdapter } from './qloo/mock';
import { nameKey } from './names';
import type { QlooAdapter } from './qloo/types';

export const LIST_SIZE = 10;
export const MAX_DISCOVERIES = 5;

export interface EditorialItem {
  itemId: string;
  showId: string;
  showName: string;
  name: string;
  interviews: Array<{ show: string; title: string; date: string; url: string | null }>;
}

export interface EditorialKey {
  createdAt: string;
  design: string;
  sheetSha256: string;
  lists: Record<string, { A: string[]; B: string[]; bDiscoveries: number; qlooMode: string }>;
}

export interface Rating {
  itemId: string;
  rater: string;
  relevance: number | null; // 1–5
  originality: number | null; // 1–5
  identity: 'ok' | 'doubtful' | 'wrong' | 'unknown' | null;
  language: 'yes' | 'probable' | 'no' | 'unknown' | null;
  wouldInvite: boolean | null;
}

const randomId = () => randomBytes(4).toString('hex');

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomBytes(4).readUInt32BE(0) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function buildEditorialSet(datasets: PodcastDataset[], makeLive: () => QlooAdapter, targets?: string[]) {
  const items: EditorialItem[] = [];
  const lists: EditorialKey['lists'] = {};
  for (const t of datasets.filter((d) => !targets || targets.includes(d.id))) {
    const others = datasets.filter((d) => d.id !== t.id);
    const live = makeLive();
    const a = await runAgent({ target: t, others, qloo: new NoQlooAdapter(), k: LIST_SIZE });
    const b = await runAgent({ target: t, others, qloo: live, k: LIST_SIZE });
    const d = Math.min(MAX_DISCOVERIES, b.discoveries.length);
    const bPeople = [
      ...b.recommendations.slice(0, LIST_SIZE - d).map((r) => ({ key: r.key, name: r.name, appearances: r.appearances })),
      ...b.discoveries.slice(0, d).map((x) => ({ key: x.key, name: x.name, appearances: [] as typeof a.recommendations[number]['appearances'] })),
    ];
    const aPeople = a.recommendations.map((r) => ({ key: r.key, name: r.name, appearances: r.appearances }));
    const byKey = new Map<string, EditorialItem>();
    for (const p of [...aPeople, ...bPeople]) {
      if (byKey.has(p.key)) continue;
      byKey.set(p.key, {
        itemId: randomId(),
        showId: t.id,
        showName: t.name,
        name: p.name,
        interviews: p.appearances.slice(0, 3).map((x) => ({ show: x.showName, title: x.title, date: x.published.slice(0, 10), url: x.url })),
      });
    }
    lists[t.id] = { A: aPeople.map((p) => byKey.get(p.key)!.itemId), B: bPeople.map((p) => byKey.get(p.key)!.itemId), bDiscoveries: d, qlooMode: live.mode };
    items.push(...byKey.values());
  }
  return { items: shuffle(items), lists };
}

// ------------------------------------------------------------------ CSV (rater sheet)
export const SHEET_COLUMNS = ['item_id', 'show', 'name', 'verified_interviews', 'relevance_1_5', 'originality_1_5', 'identity_ok_doubtful_wrong_unknown', 'language_yes_probable_no_unknown', 'would_invite_yes_no', 'notes'];

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function sheetCsv(items: EditorialItem[]): string {
  const rows = items.map((i) => [
    i.itemId,
    i.showName,
    i.name,
    i.interviews.length ? i.interviews.map((x) => `${x.show} ${x.date}: ${x.title}${x.url ? ` <${x.url}>` : ''}`).join(' | ') : 'No verified interviews in our sources',
    '',
    '',
    '',
    '',
    '',
    '',
  ]);
  return [SHEET_COLUMNS, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c !== '')) rows.push(row);
      (row = []), (cell = '');
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}

export function ratingsFromCsv(text: string, rater: string): Rating[] {
  const [head, ...rows] = parseCsv(text);
  const col = (name: string) => head.indexOf(name);
  const num = (v: string) => (/^[1-5]$/.test(v.trim()) ? Number(v) : null);
  const pick = <T extends string>(v: string, allowed: readonly T[]) => (allowed.includes(v.trim().toLowerCase() as T) ? (v.trim().toLowerCase() as T) : null);
  return rows.map((r) => ({
    itemId: r[col('item_id')],
    rater,
    relevance: num(r[col('relevance_1_5')] ?? ''),
    originality: num(r[col('originality_1_5')] ?? ''),
    identity: pick(r[col('identity_ok_doubtful_wrong_unknown')] ?? '', ['ok', 'doubtful', 'wrong', 'unknown'] as const),
    language: pick(r[col('language_yes_probable_no_unknown')] ?? '', ['yes', 'probable', 'no', 'unknown'] as const),
    wouldInvite: /^(yes|si|sí)$/i.test((r[col('would_invite_yes_no')] ?? '').trim()) ? true : /^no$/i.test((r[col('would_invite_yes_no')] ?? '').trim()) ? false : null,
  }));
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// ------------------------------------------------------------------ scoring (after rating)
function aggregate(rs: Rating[]) {
  const mean = (xs: Array<number | null>) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null;
  };
  const share = (xs: Array<boolean | null>) => {
    const v = xs.filter((x): x is boolean => x !== null);
    return v.length ? Math.round((v.filter(Boolean).length / v.length) * 100) / 100 : null;
  };
  return {
    ratings: rs.length,
    relevance: mean(rs.map((r) => r.relevance)),
    originality: mean(rs.map((r) => r.originality)),
    identityOk: share(rs.map((r) => (r.identity === null || r.identity === 'unknown' ? null : r.identity === 'ok'))),
    identityWrong: share(rs.map((r) => (r.identity === null ? null : r.identity === 'wrong'))),
    languageFit: share(rs.map((r) => (r.language === null || r.language === 'unknown' ? null : r.language !== 'no'))),
    wouldInvite: share(rs.map((r) => r.wouldInvite)),
  };
}

export function scoreEditorial(key: EditorialKey, ratings: Rating[]) {
  const out: Record<string, unknown> = {};
  const all: Record<'A' | 'B' | 'onlyA' | 'onlyB' | 'both', Rating[]> = { A: [], B: [], onlyA: [], onlyB: [], both: [] };
  for (const [showId, l] of Object.entries(key.lists)) {
    const a = new Set(l.A);
    const b = new Set(l.B);
    const of = (ids: Set<string>) => ratings.filter((r) => ids.has(r.itemId));
    const onlyA = new Set([...a].filter((x) => !b.has(x)));
    const onlyB = new Set([...b].filter((x) => !a.has(x)));
    const both = new Set([...a].filter((x) => b.has(x)));
    out[showId] = { overlap: both.size, A: aggregate(of(a)), B: aggregate(of(b)), onlyA: aggregate(of(onlyA)), onlyB: aggregate(of(onlyB)), bDiscoveries: l.bDiscoveries, qlooMode: l.qlooMode };
    all.A.push(...of(a));
    all.B.push(...of(b));
    all.onlyA.push(...of(onlyA));
    all.onlyB.push(...of(onlyB));
    all.both.push(...of(both));
  }
  const raters = [...new Set(ratings.map((r) => r.rater))];
  return {
    raters,
    overall: { A: aggregate(all.A), B: aggregate(all.B), onlyA: aggregate(all.onlyA), onlyB: aggregate(all.onlyB), both: aggregate(all.both) },
    byShow: out,
    notes: [
      'The informative contrast is onlyA vs onlyB (people proposed by just one system); shared people count for both lists.',
      'Small samples: with 3 shows × ≤10 items per list, differences under ~0.5 points on a 1–5 scale are not meaningful.',
      'No backtest result is used here.',
      raters.length < 2 ? 'Only one rater: no agreement check is possible.' : `${raters.length} raters.`,
    ],
  };
}

// ================================================================== Phase 8: blind set, Qloo vs baseline
// Pools the baseline top list (no Qloo) with every Qloo-proposed person the agent ADMITTED (verified
// identity, on-theme), whatever their final rank. Raters see the same fields for everyone and no
// provenance. Known leak: Qloo-only people have no interviews in our RSS; the scoring step reports
// them separately so a rater who guesses provenance cannot hide inside the average.
import type { AgentResult } from './agent/agent';

export const BLIND_COLUMNS = [
  'item_id',
  'show',
  'name',
  'documented_description',
  'verified_interviews',
  'relevance_1_5',
  'novelty_1_5',
  'conversation_potential_1_5',
  'evidence_sufficient_yes_no',
  'repeat_risk_low_medium_high',
  'language_ok_yes_probable_no_unknown',
  'would_invite_yes_no',
  'notes',
] as const;

export const BLIND_RUBRIC = {
  relevance_1_5: 'Fit with what this show actually talks about (1 = unrelated, 5 = squarely in its core themes).',
  novelty_1_5: 'Would this guest bring something the show has not already covered with past guests? (1 = repetitive, 5 = fresh).',
  conversation_potential_1_5: 'Likely to sustain a long, substantive conversation for this audience (1 = unlikely, 5 = very likely).',
  evidence_sufficient_yes_no: 'Is the evidence shown enough to know who this is and why they are suggested?',
  repeat_risk_low_medium_high: 'Risk that the person already appeared on the show (check the show if unsure).',
  language_ok_yes_probable_no_unknown: 'Can the person be interviewed in the show’s language?',
  would_invite_yes_no: 'Overall: would you put this person on the booking shortlist?',
};

export interface BlindItem {
  itemId: string;
  showId: string;
  showName: string;
  name: string;
  description: string;
  interviews: string;
}

export interface BlindKey {
  createdAt: string;
  showId: string;
  baseline: string[];
  qloo: string[];
  /** Qloo-proposed people with no RSS interviews (the provenance-leak group). */
  qlooExternal: string[];
}

export function buildBlindSet(show: { id: string; name: string }, baseline: AgentResult, enriched: AgentResult, descriptions: Record<string, string | null> = {}) {
  const items = new Map<string, BlindItem>();
  const key: BlindKey = { createdAt: new Date().toISOString(), showId: show.id, baseline: [], qloo: [], qlooExternal: [] };
  const add = (k: string, name: string, desc: string | null, apps: Array<{ showName: string; published: string; title: string }>) => {
    if (!items.has(k))
      items.set(k, {
        itemId: randomId(),
        showId: show.id,
        showName: show.name,
        name,
        description: desc ?? 'No documented description available',
        interviews: apps.length ? apps.slice(0, 3).map((a) => `${a.showName} ${a.published.slice(0, 10)}: ${a.title}`).join(' | ') : 'No verified interviews in our sources',
      });
    return items.get(k)!.itemId;
  };
  // Descriptions come ONLY from `descriptions`, looked up the same way for every name (see
  // blindNames); using the run's own Wikidata data would describe Qloo people and not the baseline.
  for (const r of baseline.recommendations) key.baseline.push(add(r.key, r.name, descriptions[r.key] ?? null, r.appearances));
  // Every admitted Qloo proposal (verified, on-theme), whatever its final rank.
  for (const p of enriched.discoveryPositions) {
    const rec = enriched.recommendations.find((r) => nameKey(r.name) === nameKey(p.name));
    const id = add(nameKey(p.name), p.name, descriptions[nameKey(p.name)] ?? null, rec?.appearances ?? []);
    key.qloo.push(id);
    if (p.source === 'qloo-external') key.qlooExternal.push(id);
  }
  return { items: shuffle([...items.values()]), key };
}

/** Every name that will go into the blind set, to describe them all through one identical lookup. */
export const blindNames = (baseline: AgentResult, enriched: AgentResult) => [...new Map([...baseline.recommendations.map((r) => r.name), ...enriched.discoveryPositions.map((p) => p.name)].map((n) => [nameKey(n), n])).values()];

export function blindSheetCsv(items: BlindItem[]): string {
  const rows = items.map((i) => [i.itemId, i.showName, i.name, i.description, i.interviews, ...BLIND_COLUMNS.slice(5).map(() => '')]);
  return [BLIND_COLUMNS as unknown as string[], ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
