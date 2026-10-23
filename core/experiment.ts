// Phase 3 experiment: does real Qloo data improve Green Room's recommendations?
//   T2 coverage    — how many of our people Qloo recognizes, and how many names are ambiguous.
//   T4 originality — whom Qloo person insights return, compared with our verified pool.
//   T5 comparison  — same candidate base, same rules, with vs. without Qloo affinity (backtest).
//
// Pure logic over a QlooAdapter, so it runs offline in tests with a fake adapter and live from
// scripts/qloo-experiment.ts. Nothing here decides whether a result is "good": it counts.
//
// Leakage: Qloo's taste graph is a present-day snapshot and cannot be rolled back to a cutoff.
// Affinities used in a T5 backtest may already reflect events after the cutoff (including the
// later bookings we score as hits). T5 is therefore reported as "agreement with a current graph",
// never as a leakage-free historical prediction.

import { nameKey } from './names';
import type { PodcastDataset } from './types';
import { runAgent } from './agent/agent';
import { runBacktest, KS, type BacktestResult } from './backtest';
import { NoQlooAdapter } from './qloo/mock';
import { resolvePerson, type Resolution } from './qloo/resolve';
import type { QlooAdapter, QlooEntity } from './qloo/types';
import { contextOverlap } from './profiles';

export const DEFAULT_CUTOFFS = ['2023-07-01', '2024-01-01', '2024-07-01', '2025-01-01'];

// ------------------------------------------------------------------ T2 coverage
export type CoverageStatus = 'exact_confirmed' | 'exact_unconfirmed' | 'exact_mismatch' | 'ambiguous' | 'fuzzy_only' | 'not_found' | 'error';

export interface CoverageRow {
  name: string;
  showId: string;
  role: 'past_guest' | 'candidate';
  status: CoverageStatus;
  qlooName?: string;
  qlooDescription?: string;
  popularity?: number;
  /** Words shared by Qloo's description and the person's interview titles. */
  identityEvidence?: string[];
  namesakes?: number;
}

function classify(res: Resolution, titles: string[], name: string): Pick<CoverageRow, 'status' | 'qlooName' | 'qlooDescription' | 'popularity' | 'identityEvidence' | 'namesakes'> {
  if (res.status === 'none') return { status: 'not_found' };
  if (res.status === 'fuzzy') return { status: 'fuzzy_only', qlooName: res.candidates[0]?.name };
  if (res.status === 'ambiguous') return { status: 'ambiguous', namesakes: new Set(res.candidates.map((c) => c.entityId)).size, qlooDescription: res.candidates.map((c) => c.description ?? '—').join(' | ') };
  const e = res.entity;
  const base = { qlooName: e.name, qlooDescription: e.description, popularity: e.popularity };
  if (!e.description) return { status: 'exact_unconfirmed', ...base };
  const ev = contextOverlap(name, `${e.description} ${(e.tags ?? []).join(' ')}`, titles);
  return { status: ev.length ? 'exact_confirmed' : 'exact_mismatch', identityEvidence: ev, ...base };
}

/** People the agent would look up in Qloo: recent past guests (signals) and top baseline candidates. */
export async function coverageSample(datasets: PodcastDataset[], cutoffs: string[] = DEFAULT_CUTOFFS, targets?: string[]) {
  const titles = new Map<string, string[]>();
  for (const d of datasets) for (const e of d.episodes) for (const g of e.guests) titles.set(nameKey(g.name), [...(titles.get(nameKey(g.name)) ?? []), e.title]);
  const rows: Array<{ name: string; showId: string; role: CoverageRow['role'] }> = [];
  const seen = new Set<string>();
  const add = (name: string, showId: string, role: CoverageRow['role']) => {
    const id = `${showId}|${role}|${nameKey(name)}`;
    if (!seen.has(id)) {
      seen.add(id);
      rows.push({ name, showId, role });
    }
  };
  for (const t of datasets.filter((d) => !targets || targets.includes(d.id))) {
    const others = datasets.filter((d) => d.id !== t.id);
    for (const asOf of [undefined, ...cutoffs.map((c) => new Date(c).toISOString())]) {
      const limit = asOf ?? new Date().toISOString();
      const guests = new Map<string, { name: string; published: string }>();
      for (const e of t.episodes) {
        if (!e.published || e.published >= limit || e.excluded) continue;
        for (const g of e.guests) {
          const prev = guests.get(nameKey(g.name));
          if (!prev || e.published > prev.published) guests.set(nameKey(g.name), { name: g.name, published: e.published });
        }
      }
      // Same 25 the agent uses as signals.
      for (const g of [...guests.values()].sort((a, b) => b.published.localeCompare(a.published)).slice(0, 25)) add(g.name, t.id, 'past_guest');
      // Same 40 the agent tries to score.
      const r = await runAgent({ target: t, others, qloo: new NoQlooAdapter(), asOf });
      for (const c of r.ranked.slice(0, 40)) add(c.name, t.id, 'candidate');
    }
  }
  return { rows, titles };
}

export async function runCoverage(qloo: QlooAdapter, datasets: PodcastDataset[], cutoffs?: string[], targets?: string[]): Promise<CoverageRow[]> {
  const { rows, titles } = await coverageSample(datasets, cutoffs, targets);
  const byName = new Map<string, Promise<QlooEntity[] | Error>>();
  const out: CoverageRow[] = [];
  // Start every lookup first (the adapter bounds concurrency), then read them back in order.
  for (const r of rows) if (!byName.has(nameKey(r.name))) byName.set(nameKey(r.name), qloo.searchPerson(r.name).catch((e: Error) => e));
  for (const r of rows) {
    const k = nameKey(r.name);
    const hits = await byName.get(k)!;
    if (hits instanceof Error) out.push({ ...r, status: 'error' });
    else out.push({ ...r, ...classify(resolvePerson(hits, r.name), titles.get(k) ?? [], r.name) });
  }
  return out;
}

export function summarizeCoverage(rows: CoverageRow[]) {
  const unique = new Map<string, CoverageRow>();
  for (const r of rows) unique.set(`${r.showId}|${nameKey(r.name)}`, r);
  const count = (xs: CoverageRow[]) => {
    const c: Record<CoverageStatus, number> = { exact_confirmed: 0, exact_unconfirmed: 0, exact_mismatch: 0, ambiguous: 0, fuzzy_only: 0, not_found: 0, error: 0 };
    for (const x of xs) c[x.status]++;
    const usable = c.exact_confirmed + c.exact_unconfirmed + c.exact_mismatch;
    return { total: xs.length, ...c, resolvedRate: xs.length ? usable / xs.length : 0 };
  };
  const all = [...unique.values()];
  const shows = [...new Set(all.map((r) => r.showId))];
  return {
    overall: count(all),
    byShow: Object.fromEntries(shows.map((s) => [s, count(all.filter((r) => r.showId === s))])),
    byRole: { past_guest: count(all.filter((r) => r.role === 'past_guest')), candidate: count(all.filter((r) => r.role === 'candidate')) },
    ambiguous: all.filter((r) => r.status === 'ambiguous').map((r) => ({ name: r.name, showId: r.showId, namesakes: r.namesakes, descriptions: r.qlooDescription })),
    mismatches: all.filter((r) => r.status === 'exact_mismatch').map((r) => ({ name: r.name, showId: r.showId, qloo: r.qlooDescription })),
  };
}

// ------------------------------------------------------------------ T4 originality
export interface OriginalityResult {
  showId: string;
  signalCount: number;
  returned: number;
  /** Returned people who already were guests of this show (not used as signals). */
  alreadyGuests: string[];
  /** Returned people who are also in our verified pool (appeared on a comparison show). */
  inVerifiedPool: string[];
  /** Returned people who are in the top 25 of our own ranking. */
  inOurTop25: string[];
  /** New to Green Room: no verified appearance in any of the three feeds. */
  newToUs: Array<{ name: string; popularity?: number; affinity?: number; description?: string }>;
  medianPopularity: { qlooNew: number | null; ourTop25Resolved: number | null };
  culturalHooks: Record<string, number>;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export async function runOriginality(qloo: QlooAdapter, datasets: PodcastDataset[], targets?: string[]): Promise<OriginalityResult[]> {
  const everyGuest = new Set(datasets.flatMap((d) => d.episodes.flatMap((e) => e.guests.map((g) => nameKey(g.name)))));
  const out: OriginalityResult[] = [];
  for (const t of datasets.filter((d) => !targets || targets.includes(d.id))) {
    const others = datasets.filter((d) => d.id !== t.id);
    const now = new Date().toISOString();
    const past = new Map<string, { name: string; published: string }>();
    for (const e of t.episodes) if (e.published && e.published < now && !e.excluded) for (const g of e.guests) {
      const prev = past.get(nameKey(g.name));
      if (!prev || e.published > prev.published) past.set(nameKey(g.name), { name: g.name, published: e.published });
    }
    const signals: QlooEntity[] = [];
    const recent = [...past.values()].sort((a, b) => b.published.localeCompare(a.published)).slice(0, 25);
    const recentHits = await Promise.all(recent.map((g) => qloo.searchPerson(g.name).catch(() => [])));
    recent.forEach((g, i) => {
      const r = resolvePerson(recentHits[i], g.name);
      if (r.status === 'exact') signals.push(r.entity);
    });
    const baseline = await runAgent({ target: t, others, qloo: new NoQlooAdapter() });
    const top25 = new Set(baseline.ranked.slice(0, 25).map((r) => r.key));
    const pool = new Set(baseline.ranked.map((r) => r.key));
    const res: OriginalityResult = { showId: t.id, signalCount: signals.length, returned: 0, alreadyGuests: [], inVerifiedPool: [], inOurTop25: [], newToUs: [], medianPopularity: { qlooNew: null, ourTop25Resolved: null }, culturalHooks: {} };
    if (signals.length >= 3) {
      const ids = signals.map((s) => s.entityId);
      const people = await qloo.personInsights({ signalIds: ids, excludeIds: ids, take: 30 }).catch(() => []);
      res.returned = people.length;
      for (const p of people) {
        const k = nameKey(p.name);
        if (past.has(k)) res.alreadyGuests.push(p.name);
        else if (top25.has(k)) res.inOurTop25.push(p.name);
        else if (pool.has(k) || everyGuest.has(k)) res.inVerifiedPool.push(p.name);
        else res.newToUs.push({ name: p.name, popularity: p.popularity, affinity: p.affinity, description: p.description });
      }
      const hookTypes = ['urn:entity:artist', 'urn:entity:movie', 'urn:entity:book', 'urn:entity:podcast'] as const;
      const hooks = await Promise.all(hookTypes.map((type) => qloo.categoryInsights({ signalIds: ids, type, take: 10 }).catch(() => [])));
      hookTypes.forEach((type, i) => (res.culturalHooks[type] = hooks[i].length));
      const ours: number[] = [];
      const top = baseline.ranked.slice(0, 25);
      const topHits = await Promise.all(top.map((c) => qloo.searchPerson(c.name).catch(() => [])));
      top.forEach((c, i) => {
        const r = resolvePerson(topHits[i], c.name);
        if (r.status === 'exact' && r.entity.popularity !== undefined) ours.push(r.entity.popularity);
      });
      res.medianPopularity = { qlooNew: median(res.newToUs.map((p) => p.popularity).filter((x): x is number => x !== undefined)), ourTop25Resolved: median(ours) };
    }
    out.push(res);
  }
  return out;
}

// ------------------------------------------------------------------ T5 with vs. without Qloo
export interface ComparisonCell {
  showId: string;
  cutoff: string;
  reachable: number;
  hidden: number;
  random: Record<number, number>;
  without: Record<number, number>;
  withQloo: Record<number, number>;
  /** Exploratory arm: Qloo may also add people outside the verified pool (most exposed to leakage). */
  withDiscovery: Record<number, number>;
  top10Overlap: number;
  affinityRequested: number;
  affinityReceived: number;
  signalsResolved: number;
  leakageAuditOk: boolean;
}

function affinityStats(calls: QlooAdapter['calls']) {
  const scoring = calls.filter((c) => c.endpoint === '/v2/insights' && 'filter.results.entities' in c.params);
  return {
    requested: scoring.reduce((s, c) => s + (c.params['filter.results.entities'] ? c.params['filter.results.entities'].split(',').length : 0), 0),
    received: scoring.reduce((s, c) => s + Number(/affinity values: (\d+)/.exec(c.note ?? '')?.[1] ?? 0), 0),
  };
}

export async function runComparison(makeQloo: () => QlooAdapter, datasets: PodcastDataset[], cutoffs: string[] = DEFAULT_CUTOFFS, targets?: string[]): Promise<ComparisonCell[]> {
  const cells: ComparisonCell[] = [];
  for (const t of datasets.filter((d) => !targets || targets.includes(d.id))) {
    const others = datasets.filter((d) => d.id !== t.id);
    for (const c of cutoffs) {
      const cutoff = new Date(c).toISOString();
      const q1 = makeQloo();
      const a: BacktestResult = await runBacktest({ target: t, others, cutoff, qlooArm: { label: 'Qloo affinity, same pool', adapter: q1, discovery: false } });
      const q2 = makeQloo();
      const b = await runBacktest({ target: t, others, cutoff, qlooArm: { label: 'Qloo affinity + discovery', adapter: q2, discovery: true } });
      const [off, live] = a.arms;
      const stats = affinityStats(q1.calls);
      const top10 = new Set(off.top.slice(0, 10));
      cells.push({
        showId: t.id,
        cutoff: c,
        reachable: a.reachable.length,
        hidden: a.hidden.length,
        random: a.randomExpectation,
        without: off.hitsAt,
        withQloo: live?.hitsAt ?? {},
        withDiscovery: b.arms[1]?.hitsAt ?? {},
        top10Overlap: live ? live.top.slice(0, 10).filter((k) => top10.has(k)).length : 10,
        affinityRequested: stats.requested,
        affinityReceived: stats.received,
        signalsResolved: countSignals(q1),
        leakageAuditOk: a.leakage.ok,
      });
    }
  }
  return cells;
}

function countSignals(q: QlooAdapter): number {
  // The first /v2/insights call with signals tells how many guests were used as the taste signal.
  const first = q.calls.find((c) => c.endpoint === '/v2/insights' && c.params['signal.interests.entities']);
  return first ? first.params['signal.interests.entities'].split(',').filter(Boolean).length : 0;
}

/** Two-sided exact sign test over cells that differ (ties dropped). */
export function signTest(wins: number, losses: number): number {
  const n = wins + losses;
  if (!n) return 1;
  const k = Math.min(wins, losses);
  let p = 0;
  let comb = 1;
  for (let i = 0; i <= k; i++) {
    if (i > 0) comb = (comb * (n - i + 1)) / i;
    p += comb;
  }
  return Math.min(1, (2 * p) / 2 ** n);
}

export function summarizeComparison(cells: ComparisonCell[], k: (typeof KS)[number] = 10) {
  const informative = cells.filter((c) => c.reachable > 0);
  const sum = (f: (c: ComparisonCell) => number) => informative.reduce((s, c) => s + f(c), 0);
  const wins = informative.filter((c) => (c.withQloo[k] ?? 0) > (c.without[k] ?? 0)).length;
  const losses = informative.filter((c) => (c.withQloo[k] ?? 0) < (c.without[k] ?? 0)).length;
  const received = sum((c) => c.affinityReceived);
  return {
    k,
    cells: cells.length,
    informativeCells: informative.length,
    reachableTotal: sum((c) => c.reachable),
    hits: { random: sum((c) => c.random[k] ?? 0), without: sum((c) => c.without[k] ?? 0), withQloo: sum((c) => c.withQloo[k] ?? 0), withDiscovery: sum((c) => c.withDiscovery[k] ?? 0) },
    wins,
    losses,
    ties: informative.length - wins - losses,
    signTestP: signTest(wins, losses),
    meanTop10Overlap: cells.length ? cells.reduce((s, c) => s + c.top10Overlap, 0) / cells.length : 0,
    affinityCoverage: sum((c) => c.affinityRequested) ? received / sum((c) => c.affinityRequested) : 0,
    /** If Qloo returned no affinity values, "no change" says nothing about Qloo's usefulness. */
    noAffinityData: received === 0,
  };
}
