// Historical backtest: hide everything after a cutoff, let the agent recommend using only earlier
// data, then check which recommended people really became first-time guests later.
//
// What a hit means: the show booked that person within the horizon. It is evidence of historical
// coincidence with the host's real choices. It is NOT evidence of audience impact (downloads,
// retention) and NOT proof of causation; the UI says so next to every number.

import { nameKey } from './names';
import type { PodcastDataset } from './types';
import { runAgent } from './agent/agent';
import type { QlooAdapter } from './qloo/types';
import { NoQlooAdapter } from './qloo/mock';

export interface ArmResult {
  label: string;
  qlooMode: QlooAdapter['mode'];
  /** False when any input is simulated: such numbers test the pipeline, they are not results. */
  isEvidence: boolean;
  hitsAt: Record<number, number>;
  hits: Array<{ name: string; rank: number; bookedOn: string; title: string }>;
}

export interface BacktestResult {
  targetId: string;
  targetName: string;
  cutoff: string;
  horizonEnd: string;
  historyEpisodes: number;
  /** First-time guests booked after the cutoff and within the horizon. */
  hidden: Array<{ name: string; bookedOn: string; title: string }>;
  poolSize: number;
  /** Hidden guests who were in the candidate pool at cutoff time (the ceiling for any method). */
  reachable: string[];
  randomExpectation: Record<number, number>;
  arms: ArmResult[];
  leakage: { maxHistoryDate: string; maxPoolDate: string; ok: boolean };
  limitations: string[];
}

export const KS = [5, 10, 25] as const;

export async function runBacktest(args: {
  target: PodcastDataset;
  others: PodcastDataset[];
  cutoff: string;
  horizonMonths?: number;
  qlooArm?: { label: string; adapter: QlooAdapter };
}): Promise<BacktestResult> {
  const { target, others, cutoff } = args;
  const horizonMonths = args.horizonMonths ?? 24;
  const horizonEnd = new Date(new Date(cutoff).getTime() + horizonMonths * 30.44 * 24 * 3600 * 1000).toISOString();

  const before = target.episodes.filter((e) => e.published && e.published < cutoff && !e.excluded);
  const pastKeys = new Set(before.flatMap((e) => e.guests.map((g) => nameKey(g.name))));
  const hiddenMap = new Map<string, { name: string; bookedOn: string; title: string }>();
  for (const e of target.episodes) {
    if (!e.published || e.published < cutoff || e.published >= horizonEnd || e.excluded || e.rerun) continue;
    for (const g of e.guests) {
      const key = nameKey(g.name);
      if (pastKeys.has(key)) continue;
      const prev = hiddenMap.get(key);
      if (!prev || e.published < prev.bookedOn) hiddenMap.set(key, { name: g.name, bookedOn: e.published, title: e.title });
    }
  }

  const baseline = await runAgent({ target, others, qloo: new NoQlooAdapter(), asOf: cutoff, k: 10 });
  const poolKeys = new Set(baseline.ranked.map((r) => r.key));
  const reachable = [...hiddenMap.keys()].filter((k) => poolKeys.has(k));
  const poolSize = baseline.ranked.length;

  const scoreArm = (label: string, mode: QlooAdapter['mode'], ranked: Array<{ key: string; name: string }>): ArmResult => {
    const hits = ranked
      .map((r, i) => ({ r, rank: i + 1 }))
      .filter(({ r }) => hiddenMap.has(r.key))
      .map(({ r, rank }) => ({ name: r.name, rank, bookedOn: hiddenMap.get(r.key)!.bookedOn, title: hiddenMap.get(r.key)!.title }));
    const hitsAt = Object.fromEntries(KS.map((k) => [k, hits.filter((h) => h.rank <= k).length]));
    return { label, qlooMode: mode, isEvidence: mode !== 'MOCK', hitsAt, hits: hits.filter((h) => h.rank <= KS[KS.length - 1]) };
  };

  const arms: ArmResult[] = [scoreArm('Without Qloo (themes + verified track record)', 'OFF', baseline.ranked)];
  if (args.qlooArm) {
    const withQloo = await runAgent({ target, others, qloo: args.qlooArm.adapter, asOf: cutoff, k: 10 });
    arms.push(scoreArm(args.qlooArm.label, args.qlooArm.adapter.mode, withQloo.ranked));
  }

  // Leakage audit: nothing the agent saw may be dated on/after the cutoff.
  const maxHistoryDate = before.reduce((m, e) => (e.published > m ? e.published : m), '');
  const maxPoolDate = others
    .flatMap((o) => o.episodes)
    .filter((e) => e.published && e.published < cutoff)
    .reduce((m, e) => (e.published > m ? e.published : m), '');
  const usedAfter = baseline.recommendations.some((r) => r.appearances.some((a) => a.published >= cutoff));

  return {
    targetId: target.id,
    targetName: target.name,
    cutoff,
    horizonEnd,
    historyEpisodes: before.length,
    hidden: [...hiddenMap.values()].sort((a, b) => a.bookedOn.localeCompare(b.bookedOn)),
    poolSize,
    reachable: reachable.map((k) => hiddenMap.get(k)!.name),
    randomExpectation: Object.fromEntries(KS.map((k) => [k, poolSize ? (Math.min(k, poolSize) * reachable.length) / poolSize : 0])),
    arms,
    leakage: { maxHistoryDate, maxPoolDate, ok: maxHistoryDate < cutoff && maxPoolDate < cutoff && !usedAfter },
    limitations: [
      'A hit means the host later booked that person. It measures agreement with the host’s real choices, not audience impact.',
      `Only ${reachable.length} of ${hiddenMap.size} later first-time guests had appeared on a comparison show before the cutoff, so that is the maximum any method can find here.`,
      'Guest names come from RSS titles with deterministic rules; unparsed titles are treated as unknown, which can hide hits.',
      'Small samples: differences of one or two hits are not meaningful.',
    ],
  };
}
