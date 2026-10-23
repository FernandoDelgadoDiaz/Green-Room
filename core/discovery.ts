// Baseline vs Qloo-enriched discovery: what Qloo adds, measured on the same show, data and rules.
// Both runs use the same candidate checks; the only difference is that the enriched run lets Qloo
// propose people (and adds Qloo affinity to the score in LIVE). Nothing here claims editorial
// quality: that needs a blind human evaluation (docs/EDITORIAL_EVAL.md).

import type { AgentResult } from './agent/agent';

export interface BaselineComparison {
  k: number;
  baselineTop: string[];
  enrichedTop: string[];
  /** People in both top-k lists. */
  overlap: number;
  proposed: number;
  identityVerified: number;
  ranked: number;
  inShortlist: number;
  /** Qloo-proposed, verified people in the enriched top-k that the baseline top-k does not contain. */
  newRelations: Array<{ name: string; qlooRank: number; baselineRank: number | null }>;
  /** Qloo-proposed people the baseline had already put in its top-k (agreement, not a new find). */
  confirmations: string[];
  /** Pending discoveries: Qloo-only people we could not verify. Never counted as a contribution. */
  pending: number;
  verdict: string;
  verdictEs: string;
}

export function compareWithBaseline(baseline: AgentResult, enriched: AgentResult): BaselineComparison {
  const k = enriched.recommendations.length;
  const bTop = baseline.recommendations.map((r) => r.key);
  const eTop = enriched.recommendations.map((r) => r.key);
  const bSet = new Set(bTop);
  const bRank = new Map(baseline.ranked.map((r, i) => [r.key, i + 1]));
  const qlooRanked = enriched.qlooProposals.filter((p) => p.outcome === 'ranked');
  const newRelations = enriched.recommendations
    .filter((r) => r.assessment.qlooProposedRank !== null && !bSet.has(r.key))
    .map((r) => ({ name: r.name, qlooRank: r.assessment.qlooProposedRank!, baselineRank: bRank.get(r.key) ?? null }));
  const confirmations = qlooRanked.filter((p) => bSet.has(p.key)).map((p) => p.name);
  const f = enriched.funnel;
  const verdict =
    f.proposed === 0
      ? 'Qloo proposed nobody: the enriched run equals the baseline.'
      : newRelations.length
        ? `Qloo added ${newRelations.length} verified ${newRelations.length === 1 ? 'person' : 'people'} the baseline did not put in its top ${k}. Whether they are editorially better is not measured here.`
        : 'Qloo proposals were checked, but none changed the top list.';
  const verdictEs =
    f.proposed === 0
      ? 'Qloo no propuso a nadie: la ejecución enriquecida es igual a la base.'
      : newRelations.length
        ? `Qloo sumó ${newRelations.length} ${newRelations.length === 1 ? 'persona verificada' : 'personas verificadas'} que la base no puso en su top ${k}. Si son editorialmente mejores no se mide aquí.`
        : 'Las propuestas de Qloo se verificaron, pero ninguna cambió la lista principal.';
  return {
    k,
    baselineTop: baseline.recommendations.map((r) => r.name),
    enrichedTop: enriched.recommendations.map((r) => r.name),
    overlap: eTop.filter((x) => bSet.has(x)).length,
    proposed: f.proposed,
    identityVerified: f.identityVerified,
    ranked: f.ranked,
    inShortlist: f.inShortlist,
    newRelations,
    confirmations,
    pending: enriched.discoveries.length,
    verdict,
    verdictEs,
  };
}
