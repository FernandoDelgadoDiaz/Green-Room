// Green Room agent. A decision loop over tools (history, themes, Qloo, candidate pool, scoring),
// where each branch depends on the data it just observed. Every step is recorded in the trace.

import type { Appearance, Episode, PodcastDataset, Provenance } from '../types';
import { looksLikeSegmentName, nameKey } from '../names';
import { checkIdentity } from '../qloo/resolve';
import { THEMES, addInto, cosine, emptyVector, themesOfTitle, topThemes, type ThemeId, type ThemeVector } from '../themes';
import type { QlooAdapter, QlooEntity } from '../qloo/types';

export interface TraceStep {
  id: string;
  title: string;
  tool?: string;
  detail: string;
  decision?: string;
  provenance: Provenance;
  /** Why the planner chose this step, from what earlier steps observed (rule planner, no LLM). */
  why?: string;
  /** Spanish rendering; the English text stays in the primary fields. */
  es: { title: string; detail: string; decision?: string; why?: string };
}

export type ToolName =
  | 'read_history'
  | 'infer_themes'
  | 'qloo_resolve_guests'
  | 'qloo_find_podcast'
  | 'qloo_find_theme_tags'
  | 'settle_signals'
  | 'qloo_cross_domain'
  | 'build_pool'
  | 'qloo_discover_people'
  | 'filter_repeats'
  | 'score_candidates'
  | 'qloo_score_affinity'
  | 'relax_threshold'
  | 'widen_window'
  | 'check_language'
  | 'select_shortlist'
  | 'verify_shortlist'
  | 'justify';

/** Tools the loop can call; 'justify' is the terminal step after the loop. */
type LoopTool = Exclude<ToolName, 'justify'>;

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
  /** Who this person is in Qloo: confirmed only with context evidence, never by name alone. */
  identity: IdentityStatus;
  language: LanguageStatus;
  /** What "not a past guest" is worth, given how much of the show's history has guest names. */
  history: HistoryStatus;
}

export interface IdentityStatus {
  /** confirmed: exact unique name + shared context; pending: needs a human check; not_checked: Qloo not used. */
  status: 'confirmed' | 'pending' | 'not_checked';
  reason?: 'no_context' | 'ambiguous' | 'fuzzy' | 'not_found' | 'qloo_only';
  evidence: string[];
}

export interface LanguageStatus {
  /** confirmed: verified interview in the show's language; probable: indirect evidence; unknown: no evidence either way. */
  status: 'confirmed' | 'probable' | 'unknown';
  target: string;
  evidenceLanguages: string[];
  evidenceEs?: string;
  evidenceEn?: string;
}

export interface HistoryStatus {
  /** complete: every episode in the history has an identified guest; partial: some episodes have none. */
  status: 'not_found_complete' | 'not_found_partial';
  pastGuestCount: number;
  episodesChecked: number;
  episodesWithoutGuestName: number;
  coverage: number;
}

/** Person proposed by Qloo person insights with no verified appearance in our feeds. */
export interface Discovery {
  name: string;
  key: string;
  qlooEntityId: string;
  /** Rank of this person in Qloo's list (1 = strongest affinity). */
  qlooRank: number;
  popularity?: number;
  /** Audience signal Qloo used to propose this person. */
  signal: AgentResult['signalStrategy'];
  identity: IdentityStatus;
  language: LanguageStatus;
  history: HistoryStatus;
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
  /** Share of history episodes with at least one identified guest. */
  guestCoverage: number;
  /** Qloo-proposed people outside our verified pool, kept apart from the ranking: pending verification. */
  discoveries: Discovery[];
  /** Planner decisions in order: which tool and why (deterministic rule planner, no language model). */
  plan: Array<{ tool: ToolName; why: string; whyEs: string }>;
  /** Which audience signal the agent ended up using after replanning. */
  signalStrategy: 'guests' | 'podcast' | 'tags' | 'podcast+tags' | 'none';
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
  /** Wall-clock budget for the loop; Qloo tools are skipped once it is spent. */
  deadlineMs?: number;
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
  identity: IdentityStatus;
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
  let currentWhy: Bi | null = null;
  const step = (s: { title: Bi; tool?: string; detail: Bi; decision?: Bi; provenance: Provenance }) =>
    trace.push({
      id: `s${trace.length + 1}`,
      title: s.title[0],
      tool: s.tool,
      detail: s.detail[0],
      decision: s.decision?.[0],
      provenance: s.provenance,
      ...(currentWhy ? { why: currentWhy[0] } : {}),
      es: { title: s.title[1], detail: s.detail[1], decision: s.decision?.[1], ...(currentWhy ? { why: currentWhy[1] } : {}) },
    });
  const pct = (x: number) => Math.round(x * 100);
  const d10 = (iso: string) => iso.slice(0, 10);

  // ============================================================================================
  // Agent loop: OBSERVE the state → DECIDE the next tool (rule planner) → ACT → VERIFY → REPLAN.
  // The planner is deterministic and free: it is NOT a language model and the trace says so. Each
  // decision is taken from what the previous tools observed, and failed strategies are replaced
  // (e.g. too few confirmed guest identities → try the show as a Qloo podcast entity → theme tags).
  // ============================================================================================
  const MAX_STEPS = 40;
  const startedAt = Date.now();
  const deadlineMs = input.deadlineMs ?? 50_000;
  const outOfTime = () => Date.now() - startedAt > deadlineMs;
  const done = new Set<ToolName>();
  const planLog: AgentResult['plan'] = [];

  // Observed state ---------------------------------------------------------------------------
  let history: Episode[] = [];
  let withGuests: Episode[] = [];
  const pastGuests = new Map<string, Appearance & { name: string }>();
  let coverage = 0;
  const titlesByKey = new Map<string, string[]>();
  let historyStatus: HistoryStatus = { status: 'not_found_partial', pastGuestCount: 0, episodesChecked: 0, episodesWithoutGuestName: 0, coverage: 0 };
  const profile = emptyVector();
  let themes: AgentResult['themes'] = [];
  const resolved: QlooEntity[] = [];
  let podcastEntity: QlooEntity | null = null;
  const tagSignals: QlooEntity[] = [];
  let signalStrategy: AgentResult['signalStrategy'] = 'none';
  let signalsSettled = qloo.mode === 'OFF';
  let qlooUsable = false;
  const culturalAffinities: AgentResult['culturalAffinities'] = [];
  const blend = qloo.mode === 'LIVE' ? QLOO_BLEND : 0; // simulated affinities never change the ranking
  const qlooProvenance: Provenance = qloo.mode === 'OFF' ? 'INFERRED' : qloo.mode;
  const unconfirmedGuests: string[] = [];
  const targetHostKeys = new Set(target.hostAliases.map(nameKey));
  let windowMonths = 36;
  let pool = new Map<string, Candidate>();
  const discoveries: Discovery[] = [];
  let affinityRank = new Map<string, number>();
  let minFit = 0.35;
  const eligible = () => [...pool.values()].filter((c) => c.themeFit >= minFit);
  const targetLang = target.language;
  const langOf = new Map(others.map((o) => [o.id, o.language]));
  // Confirmed only by a verified interview in the show's language. Nobody is assumed to speak it.
  const speaksTarget = (c: Candidate) => c.appearances.some((a) => langOf.get(a.showId) === targetLang);
  let languageFilter = false;
  let picks: Candidate[] = [];
  const rejected = new Map<string, Bi>();
  let verifyRounds = 0;
  const weakEvidence = new Set<string>();
  let verified = false;
  let picksNeedReselect = false;
  const signalIds = () => [...resolved.map((r) => r.entityId), ...(podcastEntity ? [podcastEntity.entityId] : [])];
  const tagIds = () => tagSignals.map((t) => t.entityId);

  const buildPool = (months: number) => {
    const p = new Map<string, Candidate>();
    for (const show of others) {
      const showHostKeys = new Set(show.hostAliases.map(nameKey));
      for (const e of show.episodes) {
        if (!e.published || e.published >= asOf || e.excluded) continue;
        if (monthsBetween(e.published, asOf) > months) continue;
        for (const g of e.guests) {
          const key = nameKey(g.name);
          if (!key || showHostKeys.has(key)) continue;
          const c =
            p.get(key) ??
            ({ key, name: g.name, appearances: [], vector: emptyVector(), matched: new Map(), source: 'verified-pool', qlooEntityId: null, qlooAffinity: null, identity: { status: 'not_checked', evidence: [] }, themeFit: 0, momentum: 0, recency: 0, base: 0, score: 0 } as Candidate);
          c.appearances.push({ showId: show.id, showName: show.name, episodeId: e.id, title: e.title, published: e.published, url: e.url, confidence: g.confidence });
          const { vector, matched } = themesOfTitle(e.title, [g.name]);
          addInto(c.vector, vector);
          for (const [id, words] of matched) {
            const set = c.matched.get(id) ?? new Set<string>();
            for (const w of words) set.add(w);
            c.matched.set(id, set);
          }
          p.set(key, c);
        }
      }
    }
    return p;
  };
  const filterRepeats = (p: Map<string, Candidate>) => {
    for (const [key, c] of p) {
      const past = pastGuests.get(key);
      if (past) {
        discarded.push({ name: c.name, reason: `Already a guest on ${target.name} (${d10(past.published)})`, reasonEs: `Ya fue invitado en ${target.name} (${d10(past.published)})`, evidence: past });
        p.delete(key);
      } else if (targetHostKeys.has(key)) {
        discarded.push({ name: c.name, reason: `Host of ${target.name}`, reasonEs: `Conductor de ${target.name}` });
        p.delete(key);
      }
    }
  };
  const score = (p: Map<string, Candidate>) => {
    for (const c of p.values()) {
      c.themeFit = cosine(c.vector, profile);
      const recent = c.appearances.filter((a) => monthsBetween(a.published, asOf) <= 24).length;
      c.momentum = Math.min(1, Math.log2(1 + recent) / 2);
      const last = c.appearances.reduce((m, a) => (a.published > m ? a.published : m), '');
      c.recency = last ? Math.exp(-monthsBetween(last, asOf) / 12) : 0;
      c.base = WEIGHTS.themeFit * c.themeFit + WEIGHTS.momentum * c.momentum + WEIGHTS.recency * c.recency;
      if (c.qlooEntityId && affinityRank.has(c.qlooEntityId)) c.qlooAffinity = affinityRank.get(c.qlooEntityId)!;
      // Candidates Qloo cannot score keep a neutral 0.5 instead of being penalized for coverage gaps.
      c.score = blend > 0 && affinityRank.size ? (1 - blend) * c.base + blend * (c.qlooAffinity ?? 0.5) : c.base;
    }
  };

  // Tools ------------------------------------------------------------------------------------
  const tools: Record<LoopTool, () => Promise<void>> = {
    read_history: async () => {
      history = target.episodes.filter((e) => e.published && e.published < asOf && !e.excluded);
      withGuests = history.filter((e) => e.guests.length > 0);
      for (const e of withGuests)
        for (const g of e.guests) {
          const key = nameKey(g.name);
          const prev = pastGuests.get(key);
          if (!prev || e.published < prev.published) pastGuests.set(key, { name: g.name, showId: target.id, showName: target.name, episodeId: e.id, title: e.title, published: e.published, url: e.url });
        }
      coverage = history.length ? withGuests.length / history.length : 0;
      // Interview titles per person (this show and comparison shows, before asOf): the context used to
      // confirm an identity in Qloo.
      for (const show of [target, ...others])
        for (const e of show.episodes) if (e.published && e.published < asOf) for (const g of e.guests) titlesByKey.set(nameKey(g.name), [...(titlesByKey.get(nameKey(g.name)) ?? []), e.title]);
      historyStatus = {
        status: withGuests.length === history.length ? 'not_found_complete' : 'not_found_partial',
        pastGuestCount: pastGuests.size,
        episodesChecked: history.length,
        episodesWithoutGuestName: history.length - withGuests.length,
        coverage,
      };
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
    },

    infer_themes: async () => {
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
      themes = topThemes(profile, 5).map((t) => ({
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
    },

    qloo_resolve_guests: async () => {
      const recentGuests = [...pastGuests.values()].sort((a, b) => b.published.localeCompare(a.published)).slice(0, 25);
      // Lookups run concurrently (the adapter bounds concurrency); results are consumed in list order,
      // so the outcome does not depend on response timing.
      const lookups = await Promise.all(recentGuests.map((g) => qloo.searchPerson(g.name).then((hits) => ({ hits }), (err: unknown) => ({ err }))));
      const guestErrors: string[] = [];
      recentGuests.forEach((g, i) => {
        const l = lookups[i];
        if ('err' in l) return void guestErrors.push(String(l.err));
        const r = checkIdentity(l.hits, g.name, titlesByKey.get(nameKey(g.name)) ?? []);
        if (r.status === 'confirmed') resolved.push(r.entity);
        else if (r.status === 'pending') unconfirmedGuests.push(g.name);
      });
      if (guestErrors.length)
        warn([`${guestErrors.length} Qloo guest lookups failed (first: ${guestErrors[0]}).`, `Fallaron ${guestErrors.length} búsquedas de invitados en Qloo (primera: ${guestErrors[0]}).`]);
      step({
        title: ['Resolve past guests in Qloo’s taste graph', 'Ubicar a los invitados anteriores en el grafo de gustos de Qloo'],
        tool: 'qloo.search',
        detail: [
          `${resolved.length} of the ${recentGuests.length} most recent guests confirmed in Qloo (unique exact name AND Qloo's description shares context with their interview titles)${unconfirmedGuests.length ? `; ${unconfirmedGuests.length} left out as unverified (name only, namesakes or no context)` : ''}.`,
          `${resolved.length} de los ${recentGuests.length} invitados más recientes confirmados en Qloo (nombre exacto y único Y la descripción de Qloo comparte contexto con los títulos de sus entrevistas)${unconfirmedGuests.length ? `; ${unconfirmedGuests.length} quedan afuera sin verificar (solo nombre, homónimos o sin contexto)` : ''}.`,
        ],
        decision:
          resolved.length >= 3
            ? ['Using these guests as the taste signal for the audience.', 'Uso a estos invitados como señal del gusto de la audiencia.']
            : ['Too few confirmed identities (<3) to describe the audience from its guests.', 'Muy pocas identidades confirmadas (<3) para describir a la audiencia a partir de sus invitados.'],
        provenance: qlooProvenance,
      });
    },

    qloo_find_podcast: async () => {
      let hits: QlooEntity[] = [];
      try {
        hits = await qloo.searchPodcast(target.name);
      } catch (err) {
        warn([`Qloo podcast search failed: ${String(err)}`, `Falló la búsqueda del podcast en Qloo: ${String(err)}`]);
      }
      // Same identity policy as for people: exact, unique title only.
      const exact = hits.filter((h) => nameKey(h.name) === nameKey(target.name));
      if (new Set(exact.map((h) => h.entityId)).size === 1) podcastEntity = exact[0];
      step({
        title: ['Look up the show itself in Qloo', 'Buscar el propio programa en Qloo'],
        tool: 'qloo.search (podcast)',
        detail: podcastEntity
          ? [`Found “${podcastEntity.name}” as a Qloo podcast entity (unique exact title).`, `Encontré “${podcastEntity.name}” como entidad de podcast en Qloo (título exacto y único).`]
          : [`${hits.length} podcast results, none with a unique exact title match.`, `${hits.length} resultados de podcast, ninguno con título exacto y único.`],
        decision: podcastEntity
          ? ['Using the show entity as the audience signal.', 'Uso la entidad del programa como señal de la audiencia.']
          : ['No reliable show entity; will not guess.', 'No hay una entidad confiable del programa; no voy a adivinar.'],
        provenance: qlooProvenance,
      });
    },

    qloo_find_theme_tags: async () => {
      const queries = themes.slice(0, 3).flatMap((t) => t.words.slice(0, 2));
      for (const q of [...new Set(queries)].slice(0, 5)) {
        try {
          const tags = await qloo.findTags(q);
          // Accept a tag only when its name equals the query (the harness's own exact-or-choose rule).
          const exact = tags.filter((t) => nameKey(t.name) === nameKey(q));
          if (exact.length === 1 && !tagSignals.some((x) => x.entityId === exact[0].entityId)) tagSignals.push(exact[0]);
        } catch (err) {
          warn([`Qloo tag search failed for “${q}”: ${String(err)}`, `Falló la búsqueda de etiquetas en Qloo para “${q}”: ${String(err)}`]);
        }
      }
      step({
        title: ['Translate the show’s themes into Qloo tags', 'Traducir los temas del programa a etiquetas de Qloo'],
        tool: 'qloo.tags',
        detail: [
          `${tagSignals.length} of ${new Set(queries).size} theme words matched a Qloo tag exactly${tagSignals.length ? `: ${tagSignals.map((t) => t.name).join(', ')}` : ''}.`,
          `${tagSignals.length} de ${new Set(queries).size} palabras temáticas coincidieron exactamente con una etiqueta de Qloo${tagSignals.length ? `: ${tagSignals.map((t) => t.name).join(', ')}` : ''}.`,
        ],
        decision: tagSignals.length
          ? ['Using these tags as a weaker, theme-level audience signal.', 'Uso estas etiquetas como una señal más débil, a nivel de temas.']
          : ['No exact tag matches; nothing to use from Qloo here.', 'Sin coincidencias exactas; no hay nada que usar de Qloo aquí.'],
        provenance: qlooProvenance,
      });
    },

    settle_signals: async () => {
      signalsSettled = true;
      qlooUsable = resolved.length >= 3 || Boolean(podcastEntity) || tagSignals.length > 0;
      signalStrategy = resolved.length >= 3 ? 'guests' : podcastEntity && tagSignals.length ? 'podcast+tags' : podcastEntity ? 'podcast' : tagSignals.length ? 'tags' : 'none';
      const label: Record<string, Bi> = {
        guests: [`${resolved.length} confirmed past guests`, `${resolved.length} invitados anteriores confirmados`],
        podcast: ['the show’s own Qloo entity', 'la entidad del propio programa en Qloo'],
        tags: [`${tagSignals.length} theme tags`, `${tagSignals.length} etiquetas temáticas`],
        'podcast+tags': ['the show’s Qloo entity plus theme tags', 'la entidad del programa más etiquetas temáticas'],
      };
      step({
        title: ['Decide the audience signal', 'Decidir la señal de audiencia'],
        tool: 'settle_signals',
        detail: qlooUsable
          ? [`Audience signal: ${label[signalStrategy][0]}.`, `Señal de audiencia: ${label[signalStrategy][1]}.`]
          : ['No reliable Qloo signal after trying guests, the show entity and theme tags.', 'Sin señal confiable de Qloo después de probar invitados, la entidad del programa y etiquetas temáticas.'],
        decision: qlooUsable
          ? signalStrategy === 'guests'
            ? ['Strongest option available; continuing.', 'Es la opción más fuerte disponible; sigo.']
            : ['Weaker than guest-based signals: Qloo results will be flagged as partial evidence.', 'Más débil que una señal basada en invitados: los resultados de Qloo se marcarán como evidencia parcial.']
          : ['Continuing with verified history and themes only, and saying so.', 'Sigo solo con historial verificado y temas, y lo informo.'],
        provenance: qlooProvenance,
      });
      if (qlooUsable && signalStrategy !== 'guests')
        warn([
          `Qloo signals are partial (${label[signalStrategy][0]}), not the show's past guests.`,
          `Las señales de Qloo son parciales (${label[signalStrategy][1]}), no los invitados anteriores del programa.`,
        ]);
    },

    qloo_cross_domain: async () => {
      const types = ['urn:entity:artist', 'urn:entity:movie', 'urn:entity:book'] as const;
      const got = await Promise.all(types.map((type) => qloo.categoryInsights({ signalIds: signalIds(), tagIds: tagIds(), type, take: 6 }).then((entities) => ({ entities }), (err: unknown) => ({ err }))));
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
          ? [`${total} artists, films and books with affinity to this signal.`, `${total} artistas, películas y libros con afinidad con esta señal.`]
          : ['Qloo returned no cross-domain entities for these signals.', 'Qloo no devolvió entidades de otros dominios para estas señales.'],
        decision: total
          ? ['Using them as conversation hooks.', 'Los uso como disparadores de conversación.']
          : ['No cultural hooks available; explanations will rely on themes and prior appearances.', 'No hay referencias culturales disponibles; las explicaciones se basarán en temas y apariciones previas.'],
        provenance: qlooProvenance,
      });
    },

    build_pool: async () => {
      pool = buildPool(windowMonths);
      step({
        title: ['Search for candidates with a verifiable public track record', 'Buscar candidatos con trayectoria pública verificable'],
        tool: 'search_candidate_pool',
        detail: [
          `${pool.size} people who appeared on ${others.length} comparison shows in the ${windowMonths} months before ${d10(asOf)}.`,
          `${pool.size} personas que participaron en ${others.length} programas de comparación en los ${windowMonths} meses anteriores al ${d10(asOf)}.`,
        ],
        decision:
          pool.size >= k
            ? ['Enough candidates to rank.', 'Hay suficientes candidatos para clasificar.']
            : ['Pool is small; will widen the time window if needed.', 'El grupo es chico; ampliaré la ventana de tiempo si hace falta.'],
        provenance: 'VERIFIED',
      });
    },

    qloo_discover_people: async () => {
      try {
        const people = await qloo.personInsights({ signalIds: signalIds(), tagIds: tagIds(), excludeIds: resolved.map((r) => r.entityId), take: 30 });
        let inPool = 0;
        people.forEach((p, i) => {
          const key = nameKey(p.name);
          if (!key) return;
          // Same name as someone in our pool is NOT proof it is the same person: no merge by name.
          if (pool.has(key)) return void inPool++;
          if (pastGuests.has(key) || targetHostKeys.has(key)) {
            discarded.push({ name: p.name, reason: `Proposed by Qloo, but the name matches a past guest or host of ${target.name}`, reasonEs: `Propuesto por Qloo, pero el nombre coincide con un invitado anterior o el conductor de ${target.name}` });
            return;
          }
          discoveries.push({
            name: p.name,
            key,
            qlooEntityId: p.entityId,
            qlooRank: i + 1,
            popularity: p.popularity,
            signal: signalStrategy,
            identity: { status: 'pending', reason: 'qloo_only', evidence: p.description ? [p.description] : [] },
            language: { status: 'unknown', target: target.language, evidenceLanguages: [], evidenceEn: 'No verified interview in our sources.', evidenceEs: 'Sin entrevistas verificadas en nuestras fuentes.' },
            history: historyStatus,
          });
        });
        step({
          title: ['Ask Qloo who else this audience has affinity for', 'Preguntar a Qloo con quién más tiene afinidad esta audiencia'],
          tool: 'qloo.insights (person)',
          detail: [
            `${people.length} people returned; ${discoveries.length} are new to our sources, ${inPool} share a name with someone in our pool.`,
            `${people.length} personas devueltas; ${discoveries.length} son nuevas para nuestras fuentes y ${inPool} comparten nombre con alguien de nuestro grupo.`,
          ],
          decision: discoveries.length
            ? [
                'Listing the new people separately as discoveries pending verification: identity and language come only from Qloo, so they are not mixed into the verified ranking.',
                'Muestro a las personas nuevas por separado como descubrimientos pendientes de verificación: su identidad e idioma solo vienen de Qloo, así que no se mezclan con el ranking verificado.',
              ]
            : ['No new people; staying with the verified pool.', 'Ninguna persona nueva; sigo con el grupo verificado.'],
          provenance: qlooProvenance,
        });
      } catch (err) {
        warn([`Qloo person insights failed: ${String(err)}`, `Falló la consulta de personas en Qloo: ${String(err)}`]);
      }
    },

    filter_repeats: async () => {
      filterRepeats(pool);
      step({
        title: ['Discard people who already appeared on the show', 'Descartar a quienes ya participaron en el programa'],
        tool: 'check_history',
        detail: [`${discarded.length} candidates removed because they were already guests (or the host).`, `${discarded.length} candidatos descartados porque ya fueron invitados (o son el conductor).`],
        decision: discarded.length
          ? [`Example: ${discarded[0].name} — ${discarded[0].reason}.`, `Ejemplo: ${discarded[0].name} — ${discarded[0].reasonEs}.`]
          : ['No overlap with past guests.', 'Ninguna coincidencia con invitados anteriores.'],
        provenance: 'VERIFIED',
      });
    },

    score_candidates: async () => {
      score(pool);
      step({
        title: ['Score candidates by topical fit and track record', 'Puntuar candidatos por ajuste temático y trayectoria'],
        tool: 'score',
        detail: [
          `${pool.size} candidates scored: ${WEIGHTS.themeFit}×topical fit + ${WEIGHTS.momentum}×momentum + ${WEIGHTS.recency}×recency.`,
          `${pool.size} candidatos puntuados: ${WEIGHTS.themeFit}×ajuste temático + ${WEIGHTS.momentum}×momento + ${WEIGHTS.recency}×recencia.`,
        ],
        provenance: 'INFERRED',
      });
    },

    qloo_score_affinity: async () => {
      const shortlist = [...pool.values()].sort((a, b) => b.base - a.base).slice(0, 40);
      const found = await Promise.all(shortlist.map((c) => qloo.searchPerson(c.name).then((hits) => ({ hits }), (err: unknown) => ({ err }))));
      const candidateErrors: string[] = [];
      shortlist.forEach((c, i) => {
        const f = found[i];
        if ('err' in f) return void candidateErrors.push(String(f.err));
        const r = checkIdentity(f.hits, c.name, titlesByKey.get(c.key) ?? c.appearances.map((a) => a.title));
        if (r.status === 'confirmed') {
          c.qlooEntityId = r.entity.entityId;
          c.identity = { status: 'confirmed', evidence: r.evidence };
        } else c.identity = { status: 'pending', reason: r.status === 'pending' ? r.reason : 'not_found', evidence: [] };
      });
      if (candidateErrors.length)
        warn([`${candidateErrors.length} Qloo candidate lookups failed (first: ${candidateErrors[0]}).`, `Fallaron ${candidateErrors.length} búsquedas de candidatos en Qloo (primera: ${candidateErrors[0]}).`]);
      const ids = shortlist.map((c) => c.qlooEntityId).filter((x): x is string => Boolean(x));
      let affinities = new Map<string, number>();
      try {
        if (ids.length) affinities = await qloo.affinityFor({ signalIds: signalIds(), tagIds: tagIds(), candidateIds: ids });
      } catch (err) {
        warn([`Qloo affinity scoring failed: ${String(err)}`, `Falló el cálculo de afinidad en Qloo: ${String(err)}`]);
      }
      // Rank-normalize affinities within the shortlist so the blend does not depend on Qloo's raw scale.
      const sorted = [...affinities.entries()].sort((a, b) => a[1] - b[1]);
      affinityRank = new Map(sorted.map(([id], i) => [id, sorted.length > 1 ? i / (sorted.length - 1) : 1]));
      score(pool);
      step({
        title: ['Score candidates against the audience’s taste', 'Puntuar candidatos según el gusto de la audiencia'],
        tool: 'qloo.insights (filter.results.entities)',
        detail: [
          `${ids.length} of the top ${shortlist.length} candidates confirmed in Qloo with context evidence; ${affinities.size} received an affinity score. The rest keep a neutral value and are marked pending verification.`,
          `${ids.length} de los ${shortlist.length} mejores candidatos confirmados en Qloo con evidencia de contexto; ${affinities.size} recibieron puntaje de afinidad. El resto queda con un valor neutro y marcado como pendiente de verificación.`,
        ],
        decision:
          blend > 0
            ? [`Final score = ${1 - blend}×(topical fit, momentum, recency) + ${blend}×Qloo affinity rank.`, `Puntaje final = ${1 - blend}×(ajuste temático, momento, recencia) + ${blend}×posición de afinidad en Qloo.`]
            : ['MOCK affinities are computed to exercise the pipeline but are NOT used for ranking.', 'Las afinidades MOCK se calculan para probar el circuito, pero NO se usan en el ranking.'],
        provenance: qlooProvenance,
      });
    },

    relax_threshold: async () => {
      const before = minFit;
      const n = eligible().length;
      minFit = Math.max(0, Math.round((minFit - 0.1) * 100) / 100);
      step({
        title: ['Too few candidates fit the show’s themes', 'Pocos candidatos encajan con los temas del programa'],
        tool: 'relax_threshold',
        detail: [`Only ${n} candidates at topical fit ≥ ${before}.`, `Solo ${n} candidatos con ajuste temático ≥ ${before}.`],
        decision: [`Lowering the minimum topical fit to ${minFit}.`, `Bajo el ajuste temático mínimo a ${minFit}.`],
        provenance: 'INFERRED',
      });
    },

    widen_window: async () => {
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
    },

    check_language: async () => {
      const sameLanguage = eligible().filter(speaksTarget).length;
      languageFilter = sameLanguage >= k;
      if (!languageFilter)
        warn([
          `Only ${sameLanguage} verified candidates appeared on a ${targetLang.toUpperCase()}-language show. Remaining suggestions have an unknown language for this show and are flagged.`,
          `Solo ${sameLanguage} candidatos verificados participaron en un programa en ${targetLang.toUpperCase()}. El resto de las sugerencias tiene idioma desconocido para este programa y quedan marcadas.`,
        ]);
      step({
        title: ['Check language fit', 'Verificar el idioma'],
        tool: 'check_language',
        detail: [
          `${sameLanguage} of ${eligible().length} eligible candidates have a verified appearance on a "${targetLang}" show.`,
          `${sameLanguage} de ${eligible().length} candidatos elegibles tienen una aparición verificada en un programa en "${targetLang}".`,
        ],
        decision: languageFilter
          ? [
              'Picking the shortlist among confirmed-language candidates. Others keep their place in the full ranking with language "unknown": not having an interview in this language does not prove they do not speak it.',
              'Elijo la lista corta entre candidatos con idioma confirmado. Los demás conservan su lugar en el ranking completo con idioma "desconocido": no tener una entrevista en este idioma no prueba que no lo hablen.',
            ]
          : ['Not enough confirmed-language candidates: allowing others and flagging each one as "language to verify".', 'No hay suficientes candidatos con idioma confirmado: permito otros y marco cada uno como "idioma por verificar".'],
        provenance: 'INFERRED',
      });
    },

    select_shortlist: async () => {
      // Diversity-aware selection (MMR) among eligible candidates not rejected by verification.
      picks = [];
      const candidates = eligible()
        .filter((c) => (!languageFilter || speaksTarget(c)) && !rejected.has(c.key))
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
      const rankedNow = [...pool.values()].filter((c) => !rejected.has(c.key)).sort((a, b) => b.score - a.score);
      const reordered = picks.some((p, i) => rankedNow[i]?.key !== p.key);
      step({
        title: ['Pick a varied shortlist', 'Elegir una lista corta variada'],
        tool: 'select_shortlist',
        detail: [`Selected ${picks.length} of ${eligible().length} eligible candidates.`, `Seleccioné ${picks.length} de ${eligible().length} candidatos elegibles.`],
        decision: reordered
          ? ['Swapped near-duplicate profiles for more varied ones (diversity re-ranking).', 'Reemplacé perfiles casi duplicados por otros más variados (reordenamiento por diversidad).']
          : ['Top-scored candidates were already varied.', 'Los mejor puntuados ya eran variados.'],
        provenance: 'INFERRED',
      });
    },

    verify_shortlist: async () => {
      verifyRounds++;
      // Check each pick against evidence the earlier steps could not use. Failures send the planner
      // back to select_shortlist with the rejected people excluded (at most 2 rounds).
      const targetTitles = history.map((e) => ` ${nameKey(e.title)} `);
      const newlyRejected: string[] = [];
      for (const c of picks) {
        const key = ` ${c.key} `;
        if (looksLikeSegmentName(c.name)) {
          rejected.set(c.key, ['looks like a recurring segment or series name, not a person', 'parece el nombre de una sección o serie recurrente, no de una persona']);
          newlyRejected.push(c.name);
        } else if (c.key.split(' ').length >= 2 && targetTitles.some((t) => t.includes(key))) {
          rejected.set(c.key, [`name appears in a ${target.name} episode title: possible earlier appearance`, `su nombre aparece en el título de un episodio de ${target.name}: posible participación anterior`]);
          newlyRejected.push(c.name);
        }
      }
      // Weak evidence is flagged for a human, not silently dropped (it is most of a new catalog show).
      const weak = picks.filter((c) => !rejected.has(c.key) && c.appearances.every((a) => a.confidence === 'low') && c.appearances.length === 1);
      for (const c of weak) weakEvidence.add(c.key);
      verified = newlyRejected.length === 0 || verifyRounds >= 3;
      step({
        title: ['Verify the shortlist against the evidence', 'Verificar la lista corta contra la evidencia'],
        tool: 'verify_shortlist',
        detail: newlyRejected.length
          ? [
              `${newlyRejected.length} pick(s) failed: ${newlyRejected.map((n) => `${n} (${rejected.get(nameKey(n))?.[0]})`).join('; ')}.`,
              `${newlyRejected.length} elegido(s) no pasaron: ${newlyRejected.map((n) => `${n} (${rejected.get(nameKey(n))?.[1]})`).join('; ')}.`,
            ]
          : [`All ${picks.length} picks have verified appearances and no sign of an earlier appearance on the show.`, `Los ${picks.length} elegidos tienen apariciones verificadas y ningún indicio de haber participado antes.`],
        decision: newlyRejected.length && !verified
          ? ['Replanning: re-selecting the shortlist without them.', 'Replanifico: vuelvo a elegir la lista corta sin ellos.']
          : newlyRejected.length
            ? ['Verification budget reached; keeping the remaining verified picks.', 'Llegué al límite de verificaciones; me quedo con los elegidos verificados.']
            : ['Shortlist verified.', 'Lista corta verificada.'],
        provenance: 'VERIFIED',
      });
      if (newlyRejected.length && verified) {
        picks = picks.filter((p) => !rejected.has(p.key));
        warn([`Only ${picks.length} picks passed verification after ${verifyRounds} rounds.`, `Solo ${picks.length} elegidos pasaron la verificación después de ${verifyRounds} rondas.`]);
      }
      if (weak.length)
        warn([
          `${weak.length} pick(s) rest on a single automatically extracted name; check the episode before inviting.`,
          `${weak.length} elegido(s) se apoyan en un único nombre extraído automáticamente; revisá el episodio antes de invitar.`,
        ]);
    },
  };

  // Rule planner: reads the observed state and returns the next tool and why ---------------------
  const plan = (): { tool: LoopTool; why: Bi } | null => {
    if (!done.has('read_history')) return { tool: 'read_history', why: ['Nothing is known about the show yet: start from its public history.', 'Todavía no sé nada del programa: empiezo por su historial público.'] };
    if (!done.has('infer_themes')) return { tool: 'infer_themes', why: [`${history.length} episodes read: next, what they are about.`, `Leí ${history.length} episodios: ahora, de qué tratan.`] };
    if (!signalsSettled) {
      const qlooTime = !outOfTime();
      if (qlooTime && !done.has('qloo_resolve_guests') && !done.has('qloo_find_podcast')) {
        if (pastGuests.size >= 3 && coverage >= 0.3)
          return { tool: 'qloo_resolve_guests', why: [`${pastGuests.size} named guests (${pct(coverage)}% of episodes): use them to describe the audience in Qloo.`, `${pastGuests.size} invitados con nombre (${pct(coverage)}% de los episodios): los uso para describir a la audiencia en Qloo.`] };
        return { tool: 'qloo_find_podcast', why: [`Only ${pct(coverage)}% of episodes name a guest (${pastGuests.size} people): guests cannot carry the audience signal, so I try the show itself in Qloo.`, `Solo el ${pct(coverage)}% de los episodios nombra a un invitado (${pastGuests.size} personas): los invitados no alcanzan para la señal de audiencia, así que pruebo con el propio programa en Qloo.`] };
      }
      if (qlooTime && resolved.length < 3 && !done.has('qloo_find_podcast'))
        return { tool: 'qloo_find_podcast', why: [`Replanning: only ${resolved.length} guest identities confirmed (<3). Trying the show itself as a Qloo podcast entity.`, `Replanifico: solo ${resolved.length} identidades de invitados confirmadas (<3). Pruebo con el programa como entidad de podcast en Qloo.`] };
      if (qlooTime && resolved.length < 3 && !done.has('qloo_find_theme_tags') && themes.length)
        return {
          tool: 'qloo_find_theme_tags',
          why: podcastEntity
            ? ['The show entity alone is a thin signal: adding the show’s themes as Qloo tags.', 'La entidad del programa sola es una señal débil: agrego los temas del programa como etiquetas de Qloo.']
            : ['Replanning again: no reliable show entity. Mapping the show’s themes to Qloo tags.', 'Replanifico otra vez: no hay entidad confiable del programa. Traduzco los temas del programa a etiquetas de Qloo.'],
        };
      return { tool: 'settle_signals', why: outOfTime() ? ['Time budget reached for Qloo lookups: deciding with what I have.', 'Llegué al límite de tiempo para Qloo: decido con lo que tengo.'] : ['All signal strategies tried: deciding which one to use.', 'Probé todas las estrategias de señal: decido cuál usar.'] };
    }
    if (qlooUsable && !done.has('qloo_cross_domain') && !outOfTime()) return { tool: 'qloo_cross_domain', why: ['A usable audience signal exists: look for cultural hooks across domains.', 'Hay una señal de audiencia utilizable: busco referencias culturales en otros dominios.'] };
    if (!done.has('build_pool')) return { tool: 'build_pool', why: ['Look for people with verified interviews on comparable shows.', 'Busco personas con entrevistas verificadas en programas comparables.'] };
    if (qlooUsable && input.qlooDiscovery !== false && !done.has('qloo_discover_people') && !outOfTime())
      return { tool: 'qloo_discover_people', why: ['Ask Qloo for people outside our sources with affinity to this audience.', 'Pido a Qloo personas fuera de nuestras fuentes con afinidad con esta audiencia.'] };
    if (!done.has('filter_repeats')) return { tool: 'filter_repeats', why: ['Remove anyone who already appeared on the show.', 'Saco a quien ya haya participado en el programa.'] };
    if (!done.has('score_candidates')) return { tool: 'score_candidates', why: [`${pool.size} candidates left: score them.`, `Quedan ${pool.size} candidatos: los puntúo.`] };
    if (qlooUsable && !done.has('qloo_score_affinity') && !outOfTime()) return { tool: 'qloo_score_affinity', why: ['Add Qloo affinity for candidates whose identity can be confirmed.', 'Agrego la afinidad de Qloo para los candidatos cuya identidad se pueda confirmar.'] };
    if (eligible().length < k && minFit > 0) return { tool: 'relax_threshold', why: [`Only ${eligible().length} candidates pass the topical-fit bar (need ${k}).`, `Solo ${eligible().length} candidatos superan el ajuste temático mínimo (necesito ${k}).`] };
    if (eligible().length < k && windowMonths < 72 && !done.has('widen_window')) return { tool: 'widen_window', why: [`Still ${eligible().length} eligible after relaxing: widen the time window.`, `Siguen siendo ${eligible().length} elegibles después de relajar: amplío la ventana de tiempo.`] };
    if (!done.has('check_language')) return { tool: 'check_language', why: [`Show language is “${targetLang}”: check which candidates have a verified interview in it.`, `El idioma del programa es “${targetLang}”: reviso quién tiene una entrevista verificada en ese idioma.`] };
    if (!picks.length && !done.has('select_shortlist')) return { tool: 'select_shortlist', why: ['Choose a varied shortlist.', 'Elijo una lista corta variada.'] };
    if (done.has('select_shortlist') && !verified) {
      if (picksNeedReselect) return { tool: 'select_shortlist', why: [`Verification rejected ${rejected.size} pick(s): re-selecting without them.`, `La verificación rechazó ${rejected.size} elegido(s): vuelvo a elegir sin ellos.`] };
      return { tool: 'verify_shortlist', why: ['Check every pick before justifying it.', 'Controlo cada elegido antes de justificarlo.'] };
    }
    return null;
  };

  for (let i = 0; i < MAX_STEPS; i++) {
    const next = plan();
    if (!next) break;
    currentWhy = next.why;
    planLog.push({ tool: next.tool, why: next.why[0], whyEs: next.why[1] });
    const rejectedBefore = rejected.size;
    await tools[next.tool]();
    currentWhy = null;
    done.add(next.tool);
    if (next.tool === 'verify_shortlist') picksNeedReselect = rejected.size > rejectedBefore && !verified;
    if (next.tool === 'select_shortlist') picksNeedReselect = false;
    if (i === MAX_STEPS - 1) warn(['Step budget reached; stopping the loop.', 'Llegué al límite de pasos; detengo el ciclo.']);
  }
  if (outOfTime()) warn(['Time budget reached: some Qloo lookups were skipped.', 'Llegué al límite de tiempo: se omitieron algunas consultas a Qloo.']);
  // Ranking used by the backtest: confirmed-language candidates first; nobody removed for an unknown language.
  const ranked = [...pool.values()].sort((a, b) => (languageFilter ? Number(speaksTarget(b)) - Number(speaksTarget(a)) : 0) || b.score - a.score);


  currentWhy = ['Shortlist verified: write each justification only from the evidence collected.', 'Lista corta verificada: escribo cada justificación solo con la evidencia reunida.'];
  planLog.push({ tool: 'justify', why: currentWhy[0], whyEs: currentWhy[1] });
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
    rationale.push(
      historyStatus.status === 'not_found_complete'
        ? { text: `Not found among the ${pastGuests.size} guests of ${target.name}'s ${history.length} episodes.`, textEs: `No figura entre los ${pastGuests.size} invitados de los ${history.length} episodios de ${target.name}.`, provenance: 'VERIFIED' }
        : {
            text: `Not found among the ${pastGuests.size} guests identified in ${target.name}; ${historyStatus.episodesWithoutGuestName} of ${history.length} episodes have no guest name in the feed, so an earlier appearance cannot be ruled out.`,
            textEs: `No figura entre los ${pastGuests.size} invitados identificados en ${target.name}; ${historyStatus.episodesWithoutGuestName} de ${history.length} episodios no tienen nombre de invitado en el RSS, así que no se puede descartar una participación anterior.`,
            provenance: 'VERIFIED',
          },
    );
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
    const langs = [...new Set(c.appearances.map((a) => langOf.get(a.showId) ?? '?'))];
    if (crossLanguage && c.appearances.length)
      rationale.push({
        text: `Language to verify: verified interviews are in ${langs.join(', ')}, not “${targetLang}”. That does not show they cannot speak it.`,
        textEs: `Idioma por verificar: sus entrevistas verificadas son en ${langs.join(', ')}, no en “${targetLang}”. Eso no demuestra que no lo hable.`,
        provenance: 'INFERRED',
      });
    if (weakEvidence.has(c.key))
      rationale.push({
        text: 'Evidence to verify: one interview title, guest name extracted automatically (low confidence).',
        textEs: 'Evidencia por verificar: un solo título de entrevista, con el nombre extraído automáticamente (confianza baja).',
        provenance: 'INFERRED',
      });
    if (c.identity.status === 'pending')
      rationale.push({
        text: 'Qloo identity pending verification: no context evidence that Qloo’s entity is this person.',
        textEs: 'Identidad en Qloo pendiente de verificación: no hay evidencia de contexto de que la entidad de Qloo sea esta persona.',
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
      identity: c.identity,
      language: crossLanguage
        ? { status: 'unknown', target: targetLang, evidenceLanguages: langs, evidenceEn: `Verified interviews in: ${langs.join(', ')}`, evidenceEs: `Entrevistas verificadas en: ${langs.join(', ')}` }
        : { status: 'confirmed', target: targetLang, evidenceLanguages: [targetLang], evidenceEn: `Verified interview in “${targetLang}”`, evidenceEs: `Entrevista verificada en “${targetLang}”` },
      history: historyStatus,
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
    guestCoverage: coverage,
    discoveries,
    plan: planLog,
    signalStrategy,
    culturalAffinities,
    recommendations,
    ranked: ranked.map((c) => ({ key: c.key, name: c.name, score: c.score })),
    discarded,
    warnings,
    warningsEs,
    qlooCalls: qloo.calls,
  };
}
