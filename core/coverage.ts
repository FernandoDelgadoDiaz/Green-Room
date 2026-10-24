// How much Qloo knew about each show Green Room analyzed live: counts only, derived from the agent's
// own diagnostics. No Qloo response content is kept, so this can be shown publicly.

export interface CoverageRow {
  showId: string;
  showName: string;
  /** Verified country of origin for catalog shows; null for open-search shows. */
  country: string | null;
  computedAt: string;
  signal: string;
  /** The show itself was found as a Qloo podcast entity. */
  showFound: boolean;
  guestsSearched: number;
  guestsConfirmed: number;
  /** People Qloo proposed, and how many passed every check for this show. */
  qlooProposed: number;
  qlooVerified: number;
  /** Qloo returned an age/gender profile for the show's audience signal. */
  audienceProfile: boolean;
  picksWithAffinity: number;
  /** The top five differs from the same run without Qloo. */
  changedTopFive: boolean | null;
}

interface ResultLike {
  showId: string;
  showName: string;
  signalStrategy?: string;
  signalDiagnostics?: { guests?: { searched?: number; confirmed?: number } };
  funnel?: { proposed?: number; ranked?: number };
  discoveryPositions?: Array<{ source?: string; eligible?: boolean }>;
  audienceDemographics?: unknown;
  recommendations?: Array<{ qlooAudience?: { affinity?: number | null } | null; components?: { qlooAffinity?: { value?: number | null } } }>;
  comparison?: { k?: number; overlap?: number } | null;
}

export function coverageOf(result: unknown, meta: { country: string | null; computedAt: string }): CoverageRow | null {
  const r = result as ResultLike | null;
  if (!r?.showId) return null;
  const g = r.signalDiagnostics?.guests ?? {};
  const signal = r.signalStrategy ?? 'none';
  const picks = r.recommendations ?? [];
  const c = r.comparison;
  return {
    showId: r.showId,
    showName: r.showName,
    country: meta.country,
    computedAt: meta.computedAt,
    signal,
    showFound: signal.includes('podcast'),
    guestsSearched: g.searched ?? 0,
    guestsConfirmed: g.confirmed ?? 0,
    qlooProposed: r.funnel?.proposed ?? 0,
    qlooVerified: (r.discoveryPositions ?? []).filter((p) => p.source === 'qloo-external' && p.eligible).length,
    audienceProfile: Boolean(r.audienceDemographics),
    picksWithAffinity: picks.filter((p) => (p.qlooAudience?.affinity ?? p.components?.qlooAffinity?.value ?? null) !== null).length,
    changedTopFive: c && typeof c.overlap === 'number' && typeof c.k === 'number' ? c.overlap < c.k : null,
  };
}

export interface CountryCoverage {
  country: string | null;
  shows: number;
  showFound: number;
  guestsSearched: number;
  guestsConfirmed: number;
  qlooVerified: number;
  audienceProfile: number;
  changedTopFive: number;
}

/** Per-country totals: markets where Qloo knew more of the shows first, then by people it contributed. */
export function coverageByCountry(rows: CoverageRow[]): CountryCoverage[] {
  const m = new Map<string | null, CountryCoverage>();
  for (const r of rows) {
    const a = m.get(r.country) ?? { country: r.country, shows: 0, showFound: 0, guestsSearched: 0, guestsConfirmed: 0, qlooVerified: 0, audienceProfile: 0, changedTopFive: 0 };
    a.shows++;
    a.showFound += Number(r.showFound);
    a.guestsSearched += r.guestsSearched;
    a.guestsConfirmed += r.guestsConfirmed;
    a.qlooVerified += r.qlooVerified;
    a.audienceProfile += Number(r.audienceProfile);
    a.changedTopFive += Number(r.changedTopFive === true);
    m.set(r.country, a);
  }
  return [...m.values()].sort((a, b) => b.showFound / b.shows - a.showFound / a.shows || b.qlooVerified - a.qlooVerified);
}
