// Green Room agent. A decision loop over tools (history, themes, Qloo, candidate pool, scoring),
// where each branch depends on the data it just observed. Every step is recorded in the trace.

import type { Appearance, PodcastDataset, Provenance } from '../types';
import { nameKey } from '../names';
import { resolvePerson } from '../qloo/resolve';
import { THEMES, addInto, cosine, emptyVector, themesOfTitle, topThemes, type ThemeId, type ThemeVector } from '../themes';
import type { QlooAdapter, QlooEntity } from '../qloo/types';

export interface TraceStep {
  id: string;
  title: string;
  tool?: string;
  detail: string;
  decision?: string;
  provenance: Provenance;
  /** Spanish rendering; the English text stays in the primary fields. */
  es: { title: string; detail: string; decision?: string };
}

type Bi = [en: string, es: string];

export interface ScoreComponent {
  value: number | null;
  weight: number;
  provenance: Provenance;
  explanation: string;
}

export interface Recommendation {
  rank: number;
  name: string;
  key: string;
  score: number;
  components: { themeFit: ScoreComponent; qlooAffinity: ScoreComponent; momentum: ScoreComponent; recency: ScoreComponent };
  appearances: Appearance[];
  sharedThemes: Array<{ id: ThemeId; label: string; labelEs: string; words: string[] }>;
  conversationTopics: string[];
  qlooEntityId: string | null;
  source: 'verified-pool' | 'qloo-person-insights';
  rationale: Array<{ text: string; textEs: string; provenance: Provenance }>;
}

export interface Discarded {
  name: string;
  reason: string;
  reasonEs: string;
  evidence?: Appearance;
}

export interface AgentResult {
  showId: string;
  showName: string;
  asOf: string;
  qlooMode: QlooAdapter['mode'];
  trace: TraceStep[];
  themes: Array<{ id: ThemeId; label: string; labelEs: string; share: number; words: string[] }>;
  pastGuestCount: number;
  historyEpisodeCount: number;
  culturalAffinities: Array<{ type: string; entities: QlooEntity[]; provenance: Provenance }>;
  recommendations: Recommendation[];
  /** Full ranking (used by the backtest). */
  ranked: Array<{ key: string; name: string; score: number }>;
  discarded: Discarded[];
  warnings: string[];
  warningsEs: string[];
  qlooCalls: QlooAdapter['calls'];
}

export interface AgentInput {
  target: PodcastDataset;
  others: PodcastDataset[];
  qloo: QlooAdapter;
  /** Only information published strictly before this instant is used. Defaults to now. */
  asOf?: string;
  k?: number;
  /**
   * Let Qloo person insights add people outside the verified pool (default true). The T5
   * experiment sets it to false so both arms rank exactly the same candidate base.
   */
  qlooDiscovery?: boolean;
}

const MONTH_MS = 30.44 * 24 * 3600 * 1000;
const WEIGHTS = { themeFit: 0.6, momentum: 0.25, recency: 0.15 };
export const QLOO_BLEND = 0.5;

interface Candidate {
  key: string;
  name: string;
  appearances: Appearance[];
  vector: ThemeVector;
  matched: Map<ThemeId, Set<string>>;
  source: Recommendation['source'];
  qlooEntityId: string | null;
  qlooAffinity: number | null;
  themeFit: number;
  momentum: number;
  recency: number;
  base: number;
  score: number;
}

function monthsBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / MONTH_MS;
}

/** Topic phrase of an appearance title, without the guest's name ("Mark Zuckerberg: Future of AI…" -> "Future of AI…"). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function topicPhrase(title: string, name: string): string {
  let t = title.replace(/^#?\d+\.?\s*[–-]?\s*/, '').replace(/\(.*?\)/g, ' ');
  t = t.replace(new RegExp(escapeRe(name), 'gi'), ' ');
  const parts = t
    .split(/\s*(?:\||:|\s[–-]\s)\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length > 12);
  const best = parts.sort((a, b) => b.length - a.length)[0] ?? '';
  return best.length > 90 ? `${best.slice(0, 87).trim()}…` : best;
}

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const { target, others, qloo } = input;
  const k = input.k ?? 5;
  const asOf = input.asOf ?? new Date().toISOString();
  const trace: TraceStep[] = [];
  const warnings: string[] = [];
  const warningsEs: string[] = [];
  const warn = ([en, es]: Bi) => {
    warnings.push(en);
    warningsEs.push(es);
  };
  const discarded: Discarded[] = [];
  const step = (s: { title: Bi; tool?: string; detail: Bi; decision?: Bi; provenance: Provenance }) =>
    trace.push({
      id: `s${trace.length + 1}`,
      title: s.title[0],
      tool: s.tool,
      detail: s.detail[0],
      decision: s.decision?.[0],
      provenance: s.provenance,
      es: { title: s.title[1], detail: s.detail[1], decision: s.decision?.[1] },
    });
  const pct = (x: number) => Math.round(x * 100);
  const d10 = (iso: string) => iso.slice(0, 10);

  // 1. History ---------------------------------------------------------------------------------
  const history = target.episodes.filter((e) => e.published && e.published < asOf && !e.excluded);
  const withGuests = history.filter((e) => e.guests.length > 0);
  const pastGuests = new Map<string, Appearance & { name: string }>();
  for (const e of withGuests) {
    for (const g of e.guests) {
      const key = nameKey(g.name);
      const prev = pastGuests.get(key);
      if (!prev || e.published < prev.published) {
        pastGuests.set(key, { name: g.name, showId: target.id, showName: target.name, episodeId: e.id, title: e.title, published: e.published, url: e.url });
      }
    }
  }
  const coverage = history.length ? withGuests.length / history.length : 0;
  step({
    title: ['Read the show’s public episode history', 'Leer el historial público de episodios'],
    tool: 'load_history',
    detail: [
      `${history.length} episodes before ${d10(asOf)} from the official RSS feed; guest names identified in ${withGuests.length} (${pct(coverage)}%), ${pastGuests.size} distinct guests.`,
      `${history.length} episodios anteriores al ${d10(asOf)} del RSS oficial; invitados identificados en ${withGuests.length} (${pct(coverage)}%), ${pastGuests.size} invitados distintos.`,
    ],
    decision:
      coverage < 0.6
        ? ['Guest coverage is low, so the repeat-guest check may miss people. Flagging it and continuing.', 'La cobertura de invitados es baja: el control de repetidos podría no detectar a alguien. Lo señalo y continúo.']
        : ['Coverage is enough to check for repeat guests reliably.', 'La cobertura alcanza para controlar invitados repetidos con confianza.'],
    provenance: 'VERIFIED',
  });
  if (coverage < 0.6)
    warn([
      `Only ${pct(coverage)}% of episodes have an identified guest; some past guests may not be detected.`,
      `Solo el ${pct(coverage)}% de los episodios tiene un invitado identificado; algunos invitados anteriores podrían no detectarse.`,
    ]);

  // 2. Themes ----------------------------------------------------------------------------------
  const profile = emptyVector();
  const profileWords = new Map<ThemeId, Map<string, number>>();
  for (const e of history.slice(0, 150)) {
    const ageYears = Math.max(0, monthsBetween(e.published, asOf) / 12);
    const { vector, matched } = themesOfTitle(e.title, e.guests.map((g) => g.name));
    addInto(profile, vector, Math.pow(0.5, ageYears));
    for (const [id, words] of matched) {
      const m = profileWords.get(id) ?? new Map<string, number>();
      for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
      profileWords.set(id, m);
    }
  }
  const themes = topThemes(profile, 5).map((t) => ({
    ...t,
    words: [...(profileWords.get(t.id) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w),
  }));
  step({
    title: ['Identify what the show talks about', 'Identificar de qué habla el programa'],
    tool: 'infer_themes',
    detail: themes.length
      ? [
          `Top themes from recent titles (recency-weighted): ${themes.map((t) => `${t.label} ${pct(t.share)}%`).join(', ')}.`,
          `Temas principales en los títulos recientes (ponderados por recencia): ${themes.map((t) => `${t.labelEs} ${pct(t.share)}%`).join(', ')}.`,
        ]
      : ['No theme keywords matched the titles.', 'Ningún término temático coincidió con los títulos.'],
    decision: themes.length
      ? ['Using these themes to measure topical fit.', 'Uso estos temas para medir el ajuste temático.']
      : ['Topical fit cannot be measured; ranking will lean on other signals.', 'No se puede medir el ajuste temático; el ranking se apoyará en otras señales.'],
    provenance: 'INFERRED',
  });

  // 3. Qloo taste profile ----------------------------------------------------------------------
  const recentGuests = [...pastGuests.values()].sort((a, b) => b.published.localeCompare(a.published)).slice(0, 25);
  const resolved: QlooEntity[] = [];
  const culturalAffinities: AgentResult['culturalAffinities'] = [];
  let qlooUsable = false;
  // Simulated affinities must never change the ranking.
  const blend = qloo.mode === 'LIVE' ? QLOO_BLEND : 0;
  const qlooProvenance: Provenance = qloo.mode === 'OFF' ? 'INFERRED' : qloo.mode;
  const ambiguousGuests: string[] = [];
  if (qloo.mode === 'OFF') {
    step({
      title: ['Ask Qloo about the audience’s taste', 'Consultar a Qloo sobre el gusto de la audiencia'],
      tool: 'qloo',
      detail: ['Qloo disabled for this run (baseline arm).', 'Qloo desactivado en esta ejecución (brazo de comparación).'],
      decision: ['Ranking with verified history and themes only.', 'Ranking solo con historial verificado y temas.'],
      provenance: 'INFERRED',
    });
  } else {
    // Lookups run concurrently (the adapter bounds concurrency); results are consumed in list order,
    // so the outcome does not depend on response timing.
    const lookups = await Promise.all(recentGuests.map((g) => qloo.searchPerson(g.name).then((hits) => ({ hits }), (err: unknown) => ({ err }))));
    const guestErrors: string[] = [];
    recentGuests.forEach((g, i) => {
      const l = lookups[i];
      if ('err' in l) return void guestErrors.push(String(l.err));
      const r = resolvePerson(l.hits, g.name);
      if (r.status === 'exact') resolved.push(r.entity);
      else if (r.status === 'ambiguous') ambiguousGuests.push(g.name);
    });
    if (guestErrors.length)
      warn([
        `${guestErrors.length} Qloo guest lookups failed (first: ${guestErrors[0]}).`,
        `Fallaron ${guestErrors.length} búsquedas de invitados en Qloo (primera: ${guestErrors[0]}).`,
      ]);
    qlooUsable = resolved.length >= 3;
    step({
      title: ['Resolve past guests in Qloo’s taste graph', 'Ubicar a los invitados anteriores en el grafo de gustos de Qloo'],
      tool: 'qloo.search',
      detail: [
        `${resolved.length} of the ${recentGuests.length} most recent guests resolved to Qloo person entities (unique exact name match only)${ambiguousGuests.length ? `; ${ambiguousGuests.length} skipped as ambiguous (namesakes in Qloo)` : ''}.`,
        `${resolved.length} de los ${recentGuests.length} invitados más recientes se encontraron como personas en Qloo (solo coincidencia exacta y única de nombre)${ambiguousGuests.length ? `; ${ambiguousGuests.length} omitidos por ambiguos (homónimos en Qloo)` : ''}.`,
      ],
      decision: qlooUsable
        ? ['Using these guests as the taste signal for the audience.', 'Uso a estos invitados como señal del gusto de la audiencia.']
        : ['Too few guests resolved (<3). Continuing without Qloo signals rather than guessing.', 'Muy pocos invitados encontrados (<3). Continúo sin señales de Qloo en lugar de adivinar.'],
      provenance: qlooProvenance,
    });
    if (qlooUsable) {
      const signalIds = resolved.map((r) => r.entityId);
      const types = ['urn:entity:artist', 'urn:entity:movie', 'urn:entity:book'] as const;
      const got = await Promise.all(types.map((type) => qloo.categoryInsights({ signalIds, type, take: 6 }).then((entities) => ({ entities }), (err: unknown) => ({ err }))));
      types.forEach((type, i) => {
        const g = got[i];
        if ('err' in g) warn([`Qloo ${type} insights failed: ${String(g.err)}`, `Falló la consulta de Qloo (${type}): ${String(g.err)}`]);
        else culturalAffinities.push({ type, entities: g.entities, provenance: qlooProvenance });
      });
      const total = culturalAffinities.reduce((s, c) => s + c.entities.length, 0);
      step({
        title: ['Map the cross-domain taste of that audience', 'Mapear el gusto de esa audiencia en otros dominios'],
        tool: 'qloo.insights (artist, movie, book)',
        detail: total
          ? [`${total} artists, films and books with affinity to this guest list.`, `${total} artistas, películas y libros con afinidad con esta lista de invitados.`]
          : ['Qloo returned no cross-domain entities for these signals.', 'Qloo no devolvió entidades de otros dominios para estas señales.'],
        decision: total
          ? ['Using them as conversation hooks.', 'Los uso como disparadores de conversación.']
          : ['No cultural hooks available; explanations will rely on themes and prior appearances.', 'No hay referencias culturales disponibles; las explicaciones se basarán en temas y apariciones previas.'],
        provenance: qlooProvenance,
      });
    }
  }

  // 4. Candidate search ------------------------------------------------------------------------
  const targetHostKeys = new Set(target.hostAliases.map(nameKey));
  const buildPool = (windowMonths: number) => {
    const pool = new Map<string, Candidate>();
    for (const show of others) {
      const showHostKeys = new Set(show.hostAliases.map(nameKey));
      for (const e of show.episodes) {
        if (!e.published || e.published >= asOf || e.excluded) continue;
        if (monthsBetween(e.published, asOf) > windowMonths) continue;
        for (const g of e.guests) {
          const key = nameKey(g.name);
          if (!key || showHostKeys.has(key)) continue;
          const c =
            pool.get(key) ??
            ({ key, name: g.name, appearances: [], vector: emptyVector(), matched: new Map(), source: 'verified-pool', qlooEntityId: null, qlooAffinity: null, themeFit: 0, momentum: 0, recency: 0, base: 0, score: 0 } as Candidate);
          c.appearances.push({ showId: show.id, showName: show.name, episodeId: e.id, title: e.title, published: e.published, url: e.url });
          const { vector, matched } = themesOfTitle(e.title, [g.name]);
          addInto(c.vector, vector);
          for (const [id, words] of matched) {
            const set = c.matched.get(id) ?? new Set<string>();
            for (const w of words) set.add(w);
            c.matched.set(id, set);
          }
          pool.set(key, c);
        }
      }
    }
    return pool;
  };

  let windowMonths = 36;
  let pool = buildPool(windowMonths);
  step({
    title: ['Search for candidates with a verifiable public track record', 'Buscar candidatos con trayectoria pública verificable'],
    tool: 'search_candidate_pool',
    detail: [
      `${pool.size} people who appeared on ${others.map((o) => o.name).join(' or ')} in the ${windowMonths} months before ${d10(asOf)}.`,
      `${pool.size} personas que participaron en ${others.map((o) => o.name).join(' o ')} en los ${windowMonths} meses anteriores al ${d10(asOf)}.`,
    ],
    decision:
      pool.size >= k
        ? ['Enough candidates to rank.', 'Hay suficientes candidatos para clasificar.']
        : ['Pool is small; will widen the time window if needed.', 'El grupo es chico; ampliaré la ventana de tiempo si hace falta.'],
    provenance: 'VERIFIED',
  });

  if (qlooUsable && input.qlooDiscovery !== false) {
    try {
      const people = await qloo.personInsights({ signalIds: resolved.map((r) => r.entityId), excludeIds: resolved.map((r) => r.entityId), take: 30 });
      let added = 0;
      for (const p of people) {
        const key = nameKey(p.name);
        if (!key || pool.has(key)) {
          const existing = pool.get(key);
          if (existing) existing.qlooEntityId = p.entityId;
          continue;
        }
        pool.set(key, { key, name: p.name, appearances: [], vector: emptyVector(), matched: new Map(), source: 'qloo-person-insights', qlooEntityId: p.entityId, qlooAffinity: p.affinity ?? null, themeFit: 0, momentum: 0, recency: 0, base: 0, score: 0 });
        added++;
      }
      step({
        title: ['Ask Qloo who else this audience has affinity for', 'Preguntar a Qloo con quién más tiene afinidad esta audiencia'],
        tool: 'qloo.insights (person)',
        detail: [`${people.length} people returned; ${added} new to the candidate pool.`, `${people.length} personas devueltas; ${added} nuevas para el grupo de candidatos.`],
        decision: people.length
          ? [
              'Adding them; they have no verified appearance on the comparison shows, so their evidence is Qloo affinity only.',
              'Las agrego; no tienen apariciones verificadas en los programas de comparación, así que su evidencia es solo la afinidad de Qloo.',
            ]
          : ['Nothing returned; staying with the verified pool.', 'No devolvió nada; sigo con el grupo verificado.'],
        provenance: qlooProvenance,
      });
    } catch (err) {
      warn([`Qloo person insights failed: ${String(err)}`, `Falló la consulta de personas en Qloo: ${String(err)}`]);
    }
  }

  // 5. Contrast against the show's own history -------------------------------------------------
  const filterRepeats = (p: Map<string, Candidate>) => {
    for (const [key, c] of p) {
      const past = pastGuests.get(key);
      if (past) {
        discarded.push({
          name: c.name,
          reason: `Already a guest on ${target.name} (${d10(past.published)})`,
          reasonEs: `Ya fue invitado en ${target.name} (${d10(past.published)})`,
          evidence: past,
        });
        p.delete(key);
      } else if (targetHostKeys.has(key)) {
        discarded.push({ name: c.name, reason: `Host of ${target.name}`, reasonEs: `Conductor de ${target.name}` });
        p.delete(key);
      }
    }
  };
  filterRepeats(pool);
  step({
    title: ['Discard people who already appeared on the show', 'Descartar a quienes ya participaron en el programa'],
    tool: 'check_history',
    detail: [
      `${discarded.length} candidates removed because they were already guests (or the host).`,
      `${discarded.length} candidatos descartados porque ya fueron invitados (o son el conductor).`,
    ],
    decision: discarded.length
      ? [`Example: ${discarded[0].name} — ${discarded[0].reason}.`, `Ejemplo: ${discarded[0].name} — ${discarded[0].reasonEs}.`]
      : ['No overlap with past guests.', 'Ninguna coincidencia con invitados anteriores.'],
    provenance: 'VERIFIED',
  });

  // 6. Score -----------------------------------------------------------------------------------
  const score = (p: Map<string, Candidate>) => {
    for (const c of p.values()) {
      c.themeFit = cosine(c.vector, profile);
      const recent = c.appearances.filter((a) => monthsBetween(a.published, asOf) <= 24).length;
      c.momentum = Math.min(1, Math.log2(1 + recent) / 2);
      const last = c.appearances.reduce((m, a) => (a.published > m ? a.published : m), '');
      c.recency = last ? Math.exp(-monthsBetween(last, asOf) / 12) : 0;
      c.base = WEIGHTS.themeFit * c.themeFit + WEIGHTS.momentum * c.momentum + WEIGHTS.recency * c.recency;
      c.score = c.base;
    }
  };
  score(pool);

  if (qlooUsable) {
    const shortlist = [...pool.values()].sort((a, b) => b.base - a.base).slice(0, 40);
    const toResolve = shortlist.filter((c) => !c.qlooEntityId);
    const found = await Promise.all(toResolve.map((c) => qloo.searchPerson(c.name).then((hits) => ({ hits }), (err: unknown) => ({ err }))));
    const candidateErrors: string[] = [];
    toResolve.forEach((c, i) => {
      const f = found[i];
      if ('err' in f) return void candidateErrors.push(String(f.err));
      const r = resolvePerson(f.hits, c.name);
      if (r.status === 'exact') c.qlooEntityId = r.entity.entityId;
    });
    if (candidateErrors.length)
      warn([
        `${candidateErrors.length} Qloo candidate lookups failed (first: ${candidateErrors[0]}).`,
        `Fallaron ${candidateErrors.length} búsquedas de candidatos en Qloo (primera: ${candidateErrors[0]}).`,
      ]);
    const ids = shortlist.map((c) => c.qlooEntityId).filter((x): x is string => Boolean(x));
    let affinities = new Map<string, number>();
    try {
      affinities = await qloo.affinityFor({ signalIds: resolved.map((r) => r.entityId), candidateIds: ids });
    } catch (err) {
      warn([`Qloo affinity scoring failed: ${String(err)}`, `Falló el cálculo de afinidad en Qloo: ${String(err)}`]);
    }
    // Rank-normalize affinities within the shortlist so the blend does not depend on Qloo's raw scale.
    const sorted = [...affinities.entries()].sort((a, b) => a[1] - b[1]);
    const rankOf = new Map(sorted.map(([id], i) => [id, sorted.length > 1 ? i / (sorted.length - 1) : 1]));
    for (const c of pool.values()) {
      if (c.qlooEntityId && rankOf.has(c.qlooEntityId)) c.qlooAffinity = rankOf.get(c.qlooEntityId)!;
      // Candidates Qloo cannot score keep a neutral 0.5 instead of being penalized for coverage gaps.
      if (blend > 0) c.score = (1 - blend) * c.base + blend * (c.qlooAffinity ?? 0.5);
    }
    step({
      title: ['Score candidates against the audience’s taste', 'Puntuar candidatos según el gusto de la audiencia'],
      tool: 'qloo.insights (filter.results.entities)',
      detail: [
        `${ids.length} of the top ${shortlist.length} candidates resolved in Qloo; ${affinities.size} received an affinity score.`,
        `${ids.length} de los ${shortlist.length} mejores candidatos se encontraron en Qloo; ${affinities.size} recibieron puntaje de afinidad.`,
      ],
      decision:
        blend > 0
          ? [
              `Final score = ${1 - blend}×(topical fit, momentum, recency) + ${blend}×Qloo affinity rank.`,
              `Puntaje final = ${1 - blend}×(ajuste temático, momento, recencia) + ${blend}×posición de afinidad en Qloo.`,
            ]
          : [
              'MOCK affinities are computed to exercise the pipeline but are NOT used for ranking.',
              'Las afinidades MOCK se calculan para probar el circuito, pero NO se usan en el ranking.',
            ],
      provenance: qlooProvenance,
    });
  }

  // 7. Threshold loop: relax requirements only when the data forces it --------------------------
  let minFit = 0.35;
  const eligible = () => [...pool.values()].filter((c) => c.themeFit >= minFit || c.source === 'qloo-person-insights');
  while (eligible().length < k && minFit > 0) {
    const before = minFit;
    minFit = Math.max(0, Math.round((minFit - 0.1) * 100) / 100);
    step({
      title: ['Too few candidates fit the show’s themes', 'Pocos candidatos encajan con los temas del programa'],
      tool: 'relax_threshold',
      detail: [`Only ${eligible().length} candidates at topical fit ≥ ${before}.`, `Solo ${eligible().length} candidatos con ajuste temático ≥ ${before}.`],
      decision: [`Lowering the minimum topical fit to ${minFit}.`, `Bajo el ajuste temático mínimo a ${minFit}.`],
      provenance: 'INFERRED',
    });
  }
  if (eligible().length < k && windowMonths < 72) {
    windowMonths = 72;
    const widened = buildPool(windowMonths);
    for (const [key, c] of widened) if (!pool.has(key)) pool.set(key, c);
    filterRepeats(pool);
    score(pool);
    step({
      title: ['Widen the search window', 'Ampliar la ventana de búsqueda'],
      tool: 'search_candidate_pool',
      detail: [`Pool now ${pool.size} people across ${windowMonths} months.`, `El grupo ahora tiene ${pool.size} personas en ${windowMonths} meses.`],
      decision: ['Re-scored with the larger pool.', 'Vuelvo a puntuar con el grupo ampliado.'],
      provenance: 'VERIFIED',
    });
  }

  // Language: prefer candidates with a verified appearance in the show's language.
  const targetLang = target.language;
  const langOf = new Map(others.map((o) => [o.id, o.language]));
  const speaksTarget = (c: Candidate) => c.source === 'qloo-person-insights' || c.appearances.some((a) => langOf.get(a.showId) === targetLang);
  const sameLanguage = eligible().filter(speaksTarget).length;
  let languageFilter = false;
  if (sameLanguage >= k) {
    languageFilter = true;
    step({
      title: ['Check language fit', 'Verificar el idioma'],
      tool: 'check_language',
      detail: [
        `${sameLanguage} eligible candidates have a verified appearance on a "${targetLang}" show.`,
        `${sameLanguage} candidatos elegibles tienen una aparición verificada en un programa en "${targetLang}".`,
      ],
      decision: ['Keeping only same-language candidates.', 'Me quedo solo con candidatos del mismo idioma.'],
      provenance: 'INFERRED',
    });
  } else {
    warn([
      `Only ${sameLanguage} verified candidates appeared on a ${targetLang.toUpperCase()}-language show. Remaining suggestions are cross-language; in-language candidates need Qloo person insights (live API).`,
      `Solo ${sameLanguage} candidatos verificados participaron en un programa en ${targetLang.toUpperCase()}. El resto de las sugerencias son de otro idioma; los candidatos del mismo idioma requieren las consultas de personas de Qloo (API real).`,
    ]);
    step({
      title: ['Check language fit', 'Verificar el idioma'],
      tool: 'check_language',
      detail: [
        `Only ${sameLanguage} of ${eligible().length} eligible candidates have a verified appearance in "${targetLang}".`,
        `Solo ${sameLanguage} de ${eligible().length} candidatos elegibles tienen una aparición verificada en "${targetLang}".`,
      ],
      decision: [
        'Not enough same-language candidates: allowing cross-language suggestions and flagging each one.',
        'No hay suficientes candidatos del mismo idioma: permito sugerencias de otro idioma y marco cada una.',
      ],
      provenance: 'INFERRED',
    });
  }

  // 8. Diversity-aware selection (MMR) ---------------------------------------------------------
  const ranked = [...pool.values()]
    .filter((c) => !languageFilter || speaksTarget(c))
    .sort((a, b) => b.score - a.score);
  const picks: Candidate[] = [];
  const candidates = eligible()
    .filter((c) => !languageFilter || speaksTarget(c))
    .sort((a, b) => (speaksTarget(b) ? 1 : 0) - (speaksTarget(a) ? 1 : 0) || b.score - a.score)
    .slice(0, 60);
  while (picks.length < k && candidates.length) {
    let best = 0;
    let bestVal = -Infinity;
    candidates.forEach((c, i) => {
      const redundancy = picks.length ? Math.max(...picks.map((p) => cosine(p.vector, c.vector))) : 0;
      const val = 0.75 * c.score - 0.25 * redundancy * c.score;
      if (val > bestVal) {
        bestVal = val;
        best = i;
      }
    });
    picks.push(candidates.splice(best, 1)[0]);
  }
  const reordered = picks.some((p, i) => ranked[i]?.key !== p.key);
  step({
    title: ['Pick a varied shortlist', 'Elegir una lista corta variada'],
    tool: 'select_shortlist',
    detail: [`Selected ${picks.length} of ${eligible().length} eligible candidates.`, `Seleccioné ${picks.length} de ${eligible().length} candidatos elegibles.`],
    decision: reordered
      ? ['Swapped near-duplicate profiles for more varied ones (diversity re-ranking).', 'Reemplacé perfiles casi duplicados por otros más variados (reordenamiento por diversidad).']
      : ['Top-scored candidates were already varied.', 'Los mejor puntuados ya eran variados.'],
    provenance: 'INFERRED',
  });

  // 9. Justify ---------------------------------------------------------------------------------
  const themeIdsInProfile = new Set(themes.map((t) => t.id));
  const recommendations: Recommendation[] = picks.map((c, i) => {
    const sharedThemes = [...c.matched.entries()]
      .filter(([id]) => themeIdsInProfile.has(id))
      .map(([id, words]) => ({ id, label: THEMES[id].label, labelEs: THEMES[id].labelEs, words: [...words].slice(0, 4) }));
    const appearances = c.appearances.sort((a, b) => b.published.localeCompare(a.published));
    const conversationTopics = [...new Set(appearances.slice(0, 3).map((a) => topicPhrase(a.title, c.name)).filter(Boolean))];
    const rationale: Recommendation['rationale'] = [];
    if (appearances.length) {
      const a = appearances[0];
      rationale.push({ text: `Appeared on ${a.showName} on ${d10(a.published)}: “${a.title}”.`, textEs: `Participó en ${a.showName} el ${d10(a.published)}: “${a.title}”.`, provenance: 'VERIFIED' });
      if (appearances.length > 1)
        rationale.push({
          text: `${appearances.length} verified appearances on comparison shows in the search window.`,
          textEs: `${appearances.length} apariciones verificadas en programas de comparación dentro de la ventana de búsqueda.`,
          provenance: 'VERIFIED',
        });
    }
    rationale.push({ text: `Not found among ${pastGuests.size} past guests of ${target.name}.`, textEs: `No figura entre los ${pastGuests.size} invitados anteriores de ${target.name}.`, provenance: 'VERIFIED' });
    if (sharedThemes.length)
      rationale.push({
        text: `Shares the show’s themes: ${sharedThemes.map((s) => s.label).join(', ')}.`,
        textEs: `Comparte temas del programa: ${sharedThemes.map((s) => s.labelEs).join(', ')}.`,
        provenance: 'INFERRED',
      });
    if (c.qlooAffinity !== null) {
      rationale.push({
        text: qloo.mode === 'MOCK' ? 'Qloo affinity score is SIMULATED (no API key yet) and must not be read as evidence.' : `Qloo affinity rank ${pct(c.qlooAffinity)}/100 within the shortlist.`,
        textEs:
          qloo.mode === 'MOCK'
            ? 'El puntaje de afinidad de Qloo es SIMULADO (todavía sin clave de API) y no debe leerse como evidencia.'
            : `Posición de afinidad en Qloo: ${pct(c.qlooAffinity)}/100 dentro de la lista corta.`,
        provenance: qloo.mode === 'MOCK' ? 'MOCK' : 'LIVE',
      });
    }
    const crossLanguage = !speaksTarget(c);
    if (crossLanguage && c.appearances.length)
      rationale.push({
        text: `Cross-language suggestion: known appearances are not in “${targetLang}”.`,
        textEs: `Sugerencia de otro idioma: sus apariciones conocidas no son en “${targetLang}”.`,
        provenance: 'INFERRED',
      });
    return {
      rank: i + 1,
      name: c.name,
      key: c.key,
      score: c.score,
      components: {
        themeFit: { value: c.themeFit, weight: WEIGHTS.themeFit, provenance: 'INFERRED', explanation: 'Cosine similarity between the themes of their appearance titles and this show’s themes.' },
        qlooAffinity: {
          value: c.qlooAffinity,
          weight: qlooUsable ? blend : 0,
          provenance: qlooProvenance,
          explanation:
            qloo.mode === 'MOCK'
              ? 'SIMULATED value shown to test the interface; weight 0, it does not affect the ranking.'
              : qlooUsable
                ? 'Affinity of this person to the show’s past guests in Qloo’s taste graph (rank within shortlist).'
                : 'Not used in this run.',
        },
        momentum: { value: c.momentum, weight: WEIGHTS.momentum, provenance: 'VERIFIED', explanation: 'Number of verified appearances on comparison shows in the last 24 months.' },
        recency: { value: c.recency, weight: WEIGHTS.recency, provenance: 'VERIFIED', explanation: 'How recently they were last interviewed on a comparison show.' },
      },
      appearances,
      sharedThemes,
      conversationTopics,
      qlooEntityId: c.qlooEntityId,
      source: c.source,
      rationale,
    };
  });
  step({
    title: ['Explain every recommendation with its evidence', 'Justificar cada recomendación con su evidencia'],
    tool: 'justify',
    detail: [`${recommendations.length} recommendations, each with sources and provenance labels.`, `${recommendations.length} recomendaciones, cada una con fuentes y etiquetas de procedencia.`],
    decision:
      qloo.mode === 'MOCK'
        ? ['Qloo values are labeled MOCK and excluded from any claim.', 'Los valores de Qloo están marcados como MOCK y quedan fuera de toda afirmación.']
        : ['Done.', 'Listo.'],
    provenance: 'INFERRED',
  });

  return {
    showId: target.id,
    showName: target.name,
    asOf,
    qlooMode: qloo.mode,
    trace,
    themes,
    pastGuestCount: pastGuests.size,
    historyEpisodeCount: history.length,
    culturalAffinities,
    recommendations,
    ranked: ranked.map((c) => ({ key: c.key, name: c.name, score: c.score })),
    discarded,
    warnings,
    warningsEs,
    qlooCalls: qloo.calls,
  };
}
