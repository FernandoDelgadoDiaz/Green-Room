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
  /** People we already had who entered the top-k only through Qloo affinity reweighting (no discovery). */
  affinityPromoted: Array<{ name: string; baselineRank: number | null }>;
  /** Baseline picks that left the top-k. */
  displaced: string[];
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
  const affinityPromoted = enriched.recommendations.filter((r) => r.assessment.qlooProposedRank === null && !bSet.has(r.key)).map((r) => ({ name: r.name, baselineRank: bRank.get(r.key) ?? null }));
  const eSet = new Set(eTop);
  const displaced = baseline.recommendations.filter((r) => !eSet.has(r.key)).map((r) => r.name);
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
    affinityPromoted,
    displaced,
    pending: enriched.discoveries.length,
    verdict,
    verdictEs,
  };
}

// ------------------------------------------------------------------ four controlled arms
export type ArmId = 'A' | 'B' | 'C' | 'D';
export const ARM_LABELS: Record<ArmId, { en: string; es: string }> = {
  A: { en: 'Baseline (no Qloo)', es: 'Base (sin Qloo)' },
  B: { en: 'Baseline + Qloo discoveries (no affinity weighting)', es: 'Base + descubrimientos de Qloo (sin ponderar afinidad)' },
  C: { en: 'Baseline + Qloo affinity on existing candidates (no discoveries)', es: 'Base + afinidad Qloo sobre candidatos existentes (sin descubrimientos)' },
  D: { en: 'Discoveries + affinity', es: 'Descubrimientos + afinidad' },
};

export interface ArmMetrics {
  arm: ArmId;
  label: { en: string; es: string };
  top: Array<{ name: string; source: string; baselineRank: number | null; editorialRelevance: number; evidence: string; identity: string; language: string }>;
  /** People in this arm's top-k that are also in the baseline top-k. */
  overlapWithBaseline: number;
  /** Mean editorial relevance (topical fit, momentum, recency from evidence; no Qloo) of the top-k. */
  meanEditorialRelevance: number;
  /** Top-k people not in the baseline top-k, and how many of them Qloo proposed. */
  /** proposedByQloo: Qloo proposed them; newToCorpus: of those, people with no interviews in our RSS (true discoveries, not reorderings). */
  originality: { newVsBaseline: number; proposedByQloo: number; newToCorpus: number };
  evidence: Record<'high' | 'medium' | 'low', number>;
  /** Top-k people whose identity is pending verification. */
  identityIssues: number;
  languageConfirmed: number;
  funnel: { proposed: number; identityVerified: number; externalDocumented: number; externalOverCap: number; typePending: number; ranked: number; typeErrors: number; signal: string };
}

const round = (x: number) => Math.round(x * 1000) / 1000;

export function compareArms(arms: Record<ArmId, AgentResult>) {
  const A = arms.A;
  const baseTop = new Set(A.recommendations.map((r) => r.key));
  const baseRank = new Map(A.ranked.map((r, i) => [r.key, i + 1]));
  const metrics = (Object.keys(arms) as ArmId[]).map((id): ArmMetrics => {
    const r = arms[id];
    const recs = r.recommendations;
    const ev = { high: 0, medium: 0, low: 0 };
    for (const x of recs) ev[x.assessment.evidence.level]++;
    return {
      arm: id,
      label: ARM_LABELS[id],
      top: recs.map((x) => ({
        name: x.name,
        source: x.source,
        baselineRank: baseRank.get(x.key) ?? null,
        editorialRelevance: round(x.assessment.editorialRelevance),
        evidence: x.assessment.evidence.level,
        identity: x.identity.status,
        language: x.language.status,
      })),
      overlapWithBaseline: recs.filter((x) => baseTop.has(x.key)).length,
      meanEditorialRelevance: recs.length ? round(recs.reduce((s, x) => s + x.assessment.editorialRelevance, 0) / recs.length) : 0,
      originality: { newVsBaseline: recs.filter((x) => !baseTop.has(x.key)).length, proposedByQloo: recs.filter((x) => x.assessment.qlooProposedRank !== null).length, newToCorpus: recs.filter((x) => x.source === 'qloo-external').length },
      evidence: ev,
      identityIssues: recs.filter((x) => x.identity.status === 'pending').length,
      languageConfirmed: recs.filter((x) => x.language.status === 'confirmed').length,
      funnel: { proposed: r.funnel.proposed, identityVerified: r.funnel.identityVerified, externalDocumented: r.funnel.externalDocumented, externalOverCap: r.funnel.externalOverCap, typePending: r.funnel.typePending, ranked: r.funnel.ranked, typeErrors: r.funnel.typeErrors, signal: r.signalDiagnostics.verdict },
    };
  });
  const by = Object.fromEntries(metrics.map((m) => [m.arm, m])) as Record<ArmId, ArmMetrics>;
  // Attribution: which Qloo effect changed the top list.
  const changedByDiscovery = by.B.overlapWithBaseline < by.A.top.length;
  const changedByAffinity = by.C.overlapWithBaseline < by.A.top.length;
  // Only people Qloo brought in from outside our corpus are discoveries; anything else is a reordering.
  const discoveredInTop = by.D.originality.newToCorpus;
  const attribution = {
    en: `${changedByDiscovery ? `Discovery changed ${by.B.originality.newVsBaseline} of the top ${by.A.top.length}` : 'Discovery alone did not change the top list'}; ${changedByAffinity ? `affinity weighting alone changed ${by.C.originality.newVsBaseline}, by reordering candidates we already had` : 'affinity weighting alone did not change it'}.`,
    es: `${changedByDiscovery ? `El descubrimiento cambió ${by.B.originality.newVsBaseline} de los ${by.A.top.length} primeros` : 'El descubrimiento solo no cambió la lista principal'}; ${changedByAffinity ? `la ponderación por afinidad sola cambió ${by.C.originality.newVsBaseline}, reordenando candidatos que ya teníamos` : 'la ponderación por afinidad sola no la cambió'}.`,
  };
  return {
    arms: metrics,
    attribution,
    /** True only when Qloo brought someone from outside our corpus into the final top list (arm D). */
    qlooImprovedTopWithNewPeople: discoveredInTop > 0,
    verdict: discoveredInTop
      ? { en: `${discoveredInTop} person(s) from outside our corpus reached the top list through Qloo. Whether they are better guests needs the blind editorial evaluation.`, es: `${discoveredInTop} persona(s) de fuera de nuestro corpus llegaron a la lista principal gracias a Qloo. Si son mejores invitados lo dirá la evaluación editorial ciega.` }
      : { en: 'No person from outside our corpus reached the top list; any change came from reordering candidates we already had. Qloo did not improve the top list with new people.', es: 'Ninguna persona de fuera de nuestro corpus llegó a la lista principal; cualquier cambio vino de reordenar candidatos que ya teníamos. Qloo no mejoró la lista principal con personas nuevas.' },
    notes: [
      { en: 'Same show, data, candidate checks and k in every arm. Only the two Qloo effects are switched on or off.', es: 'Mismo programa, datos, controles y k en todas las variantes. Solo se prenden o apagan los dos efectos de Qloo.' },
      { en: 'Editorial relevance is our evidence-based score without Qloo; it is not a probability that a guest accepts, nor a measure of editorial quality.', es: 'La relevancia editorial es nuestro puntaje basado en evidencia, sin Qloo; no es la probabilidad de que un invitado acepte ni una medida de calidad editorial.' },
      { en: 'Editorial quality needs an independent blind evaluation (docs/EDITORIAL_EVAL.md).', es: 'La calidad editorial requiere una evaluación ciega independiente (docs/EDITORIAL_EVAL.md).' },
    ],
  };
}
