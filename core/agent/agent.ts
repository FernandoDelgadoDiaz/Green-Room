// Green Room agent. A decision loop over tools (history, themes, Qloo, candidate pool, scoring),
// where each branch depends on the data it just observed. Every step is recorded in the trace.

import type { Appearance, Episode, PodcastDataset, Provenance } from '../types';
import { looksLikeSegmentName, nameKey } from '../names';
import { checkIdentity, identityEvidence } from '../qloo/resolve';
import { contextOverlap } from '../profiles';
import { appearanceLanguage, detectTitleLanguage, languageProfile, type LanguageProfile } from '../language';
import type { ExternalCheck } from '../verify/external';
import { buildTagQueries, compactKey, GENERIC_WORDS, showNameVariants } from '../qloo/signals';
import { externalThemes } from '../verify/occupations';
import { THEMES, THEME_IDS, addInto, cosine, emptyVector, themesOfTitle, topThemes, type ThemeId, type ThemeVector } from '../themes';
import { qlooKind, type Demographics, type QlooAdapter, type QlooEntity, type Trend } from '../qloo/types';
import { topicPhrase } from '../topic';
export { topicPhrase };
import { CATEGORY_LABELS, categoriesOf, mainCategory, type OccupationCategory, type PersonRecord } from '../people';

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
  | 'profile_language'
  | 'qloo_resolve_guests'
  | 'qloo_find_podcast'
  | 'qloo_find_theme_tags'
  | 'settle_signals'
  | 'qloo_cross_domain'
  | 'build_pool'
  | 'qloo_discover_people'
  | 'verify_discoveries'
  | 'verify_external'
  | 'filter_repeats'
  | 'profile_guests'
  | 'score_candidates'
  | 'qloo_score_affinity'
  | 'relax_threshold'
  | 'widen_window'
  | 'check_language'
  | 'select_shortlist'
  | 'verify_shortlist'
  | 'qloo_audience_profile'
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
  /** verified-pool: our RSS sources; qloo-person-insights: proposed by Qloo, verified in our RSS; qloo-external: proposed by Qloo, verified in Wikidata/Wikipedia. */
  source: 'verified-pool' | 'qloo-person-insights' | 'qloo-external';
  /** External identity evidence (Wikidata/Wikipedia), for people verified outside our RSS sources. */
  external: ExternalCheck | null;
  rationale: Array<{ text: string; textEs: string; provenance: Provenance }>;
  /** Who this person is in Qloo: confirmed only with context evidence, never by name alone. */
  identity: IdentityStatus;
  language: LanguageStatus;
  /** What "not a past guest" is worth, given how much of the show's history has guest names. */
  history: HistoryStatus;
  /** Three separate readings, never merged into one claim. */
  assessment: Assessment;
  /** Who this person is (Wikidata) and how that fits who the show interviews; null without people data. */
  audience: RecommendationAudience | null;
  /** What Qloo says about this guest's audience against the show's (LIVE only; null otherwise). */
  qlooAudience: QlooAudience | null;
}

/**
 * Qloo's read of a pick's audience. Inferred taste data, never listener data:
 * - affinity: rank of the guest's affinity to the show's audience signal among the scored candidates (0–1);
 * - demographicMatch: similarity (0–1) of the guest's and the show's age/gender affinity profiles;
 * - trend: direction of the guest's weekly popularity over the last 12 weeks.
 */
export interface QlooAudience {
  qlooEntityId: string;
  affinity: number | null;
  demographicMatch: number | null;
  demographics: Demographics | null;
  trend: Trend['direction'] | null;
  trendPercentile: number | null;
}

export interface RecommendationAudience {
  occupations: Array<{ en: string; es: string }>;
  categories: OccupationCategory[];
  /** Categories shared with the show's past guests, most frequent on the show first. */
  sharedCategories: OccupationCategory[];
  countries: string[];
  showCountry: string | null;
  /** Citizen of one of the audience's countries (the show's own, or one many of its guests come from). */
  sameCountry: boolean;
  matchedCountry: string | null;
  /** Comparison shows from the show's country where this person was interviewed. */
  sameCountryShows: string[];
  wikipedias: number;
  /** Past guests of the show with the same kind of profile (best documented first). */
  similarPastGuests: string[];
  /** The same, for each shared category. */
  similarByCategory: Partial<Record<OccupationCategory, string[]>>;
  typeFit: number | null;
  regionFit: number;
  known: number;
  description: { en: string | null; es: string | null };
  wikidataId: string;
}

/** Who a show interviews, from its past guests' Wikidata records. */
export interface ShowGuestProfile {
  resolved: number;
  pastGuests: number;
  strong: boolean;
  country: string | null;
  countryShare: number;
  categories: Array<{ id: OccupationCategory; share: number; label: string; labelEs: string; examples: string[] }>;
  /** Share of recent titles that name any theme: below 25 % the title themes are too thin to rank on. */
  themeEvidence: number;
  themesWeak: boolean;
  /** How strictly "known by this audience" was applied: 0 strictest … 3 not applied (see the trace). */
  gateLevel: number;
}

export interface Assessment {
  /** Position in Qloo's person-insights list when Qloo proposed this person (null: came from our sources only). */
  qlooProposedRank: number | null;
  /** Qloo affinity rank within the scored set (LIVE only; null when not measured). */
  qlooAffinity: number | null;
  /** Editorial relevance: topical fit, momentum and recency from verified interviews (0–1). */
  editorialRelevance: number;
  /** How solid the public evidence is. */
  evidence: { level: 'high' | 'medium' | 'low'; appearances: number; shows: number; automaticNamesOnly: boolean; kind: 'interviews' | 'external' };
  /**
   * Editorial potential, as evidence only (never a score, never fame): long-form interviews on record
   * in our sources, and whether a documented public profile exists.
   */
  editorialPotential: { interviewsOnRecord: number; showsOnRecord: number; documentedProfile: boolean };
  /** Availability or viability as a guest: no source provides it, so it is never assumed. */
  availability: 'not_assessed';
}

/** Why a Qloo-proposed person did not reach the ranking. */
export type DiscoveryFailure = 'coverage' | 'identity' | 'theme' | 'repeat' | 'not_person' | 'type';

export interface QlooProposal {
  name: string;
  key: string;
  qlooEntityId: string;
  qlooRank: number;
  /** 1 = first discovery request; 2 = after replanning with another signal. */
  attempt: number;
  signal: string;
  outcome: 'ranked' | 'pending' | 'discarded';
  failure?: DiscoveryFailure;
  reason: string;
  reasonEs: string;
  checks: Array<{ check: 'person' | 'repeat' | 'identity' | 'external' | 'theme' | 'language'; ok: boolean | null; detail: string; detailEs: string }>;
  /** Result of the external (Wikidata/Wikipedia) verification, when it ran for this person. */
  external?: ExternalCheck;
}

export interface DiscoveryFunnel {
  attempts: Array<{ signal: string; proposed: number }>;
  proposed: number;
  notPerson: number;
  repeats: number;
  /** Identity verified: our feeds have their interviews AND Qloo's description/tags share context with them. */
  identityVerified: number;
  /** No verified interview in our sources: identity, language and background cannot be checked here. */
  noRecord: number;
  /** Same name as someone in our sources, but no shared context: not merged. */
  identityUnconfirmed: number;
  offTheme: number;
  languageCompatible: number;
  languageUnknown: number;
  /** External verification (outside our RSS): documented, partial, still pending, and type errors (bands, companies, works). */
  /** Proposals sent to independent verification, how many were actually checked, and how many the per-run cap left out. */
  externalQueued: number;
  externalChecked: number;
  externalOverCap: number;
  externalDocumented: number;
  externalPartial: number;
  externalPending: number;
  typeErrors: number;
  /** Identity verified, but Qloo's type was generic and Wikidata could not confirm an individual person. */
  typePending: number;
  /** Verified and on-theme: compete in the main ranking under the same rules as everyone else. */
  ranked: number;
  /** Of those, how many made the final shortlist. */
  inShortlist: number;
  diagnosis: DiscoveryFailure | 'language' | 'ok' | 'not_run';
  diagnosisText: string;
  diagnosisTextEs: string;
}

export interface DiscoveryPosition {
  name: string;
  qlooRank: number;
  source: Recommendation['source'];
  identity: string;
  themeFit: number;
  editorialRelevance: number;
  qlooAffinity: number | null;
  inBand: boolean;
  languageConfirmed: boolean;
  /** Passed verification and the pertinence bar: a real candidate, whatever its final rank. */
  eligible: boolean;
  /** Missing measurements, never imputed (e.g. no interviews in our RSS → no momentum/recency). */
  notMeasured: string[];
  finalRank: number;
  inTopK: boolean;
  reason: string;
  reasonEs: string;
}

export interface SignalDiagnostics {
  guests: { searched: number; withResults: number; confirmed: number; ambiguous: number; noContext: number; fuzzyOnly: number; notFound: number; errors: number };
  podcast: Array<{ query: string; results: number; exactMatches: number; sample: string[] }>;
  tags: Array<{ word: string; query: string; results: number; accepted: string | null; acceptedIds?: string[]; sample: string[] }>;
  skippedGeneric: string[];
  /**
   * ok: a usable signal; none_in_qloo: lookups returned nothing; unrecognized: Qloo returned results
   * but none matched exactly or shared context; ambiguous: namesakes prevented a match; not_run.
   */
  verdict: 'ok' | 'none_in_qloo' | 'unrecognized' | 'ambiguous' | 'not_run';
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
  /**
   * Where the language evidence comes from: an interview whose show declares the language and whose
   * title agrees ('declared+title'), only the show's declared language ('declared'), only the title
   * ('title'), languages spoken in Wikidata ('wikidata'), or a Wikipedia article ('wikipedia').
   */
  basis?: 'declared+title' | 'declared' | 'title' | 'wikidata' | 'wikipedia';
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
  /** External verification result, when it ran (partial or pending: not enough to rank). */
  external?: ExternalCheck;
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
  /** Every person Qloo proposed, with the checks the agent ran and the outcome. */
  qlooProposals: QlooProposal[];
  funnel: DiscoveryFunnel;
  /** Habitual interview languages of the show, from its own titles. */
  languageProfile: LanguageProfile;
  /** What each Qloo signal lookup returned, to tell "nothing in Qloo" from "not recognized" and "ambiguous". */
  signalDiagnostics: SignalDiagnostics;
  /** Every Qloo proposal that entered the ranking: where it ended and the specific reason it is or is not in the top k. */
  discoveryPositions: DiscoveryPosition[];
  /** The last pick of the top k (the bar a discovery must clear). */
  cutoff: { name: string; score: number; editorialRelevance: number; themeFit: number } | null;
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
  /** Who the show interviews (null without people data). */
  guestProfile: ShowGuestProfile | null;
  /** Age/gender affinity of the show's audience signal, from Qloo (LIVE only). */
  audienceDemographics: { demographics: Demographics; basis: 'guests' | 'podcast' | 'tags'; signals: number } | null;
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
  /** Verified origin country per show id (unverified shows absent): used for the international-guest history. */
  originOf?: Map<string, string>;
  /** Wikidata records of guests (data/people.json), keyed by nameKey: occupation, citizenship, reach. */
  people?: Record<string, PersonRecord>;
  /** Blend Qloo affinity into the score of existing candidates (default true; LIVE only). Arms B and C of the comparison turn one of the two Qloo effects off. */
  qlooAffinity?: boolean;
  /** Independent verification of Qloo proposals with no record in our RSS (Wikidata/Wikipedia). */
  verifier?: { maxCandidates?: number; verify(proposals: Array<{ entity: QlooEntity }>, ctx: { targetLang: string }): Promise<ExternalCheck[]> };
}

const MONTH_MS = 30.44 * 24 * 3600 * 1000;
const WEIGHTS = { themeFit: 0.6, momentum: 0.25, recency: 0.15 };
/**
 * With people data the score also asks who the person is (rules fixed before looking at results):
 * - type: same kind of guest as the show interviews (occupation categories, cosine);
 * - region: citizen of the show's country (1), or interviewed on shows from that country (0.6);
 * - known: how widely documented (number of Wikipedia editions, log scale, 30+ = 1).
 * When the show's titles carry little theme evidence, the weight moves from themes to guest type.
 */
const AUDIENCE_WEIGHTS = {
  profile: { themeFit: 0.25, typeFit: 0.25, region: 0.2, known: 0.15, momentum: 0.1, recency: 0.05 },
  profileWeakThemes: { themeFit: 0.05, typeFit: 0.45, region: 0.2, known: 0.15, momentum: 0.1, recency: 0.05 },
  noProfile: { themeFit: 0.45, typeFit: 0, region: 0.2, known: 0.15, momentum: 0.12, recency: 0.08 },
};
/** Wikipedia editions above which someone counts as known across countries. */
export const INTERNATIONAL_WIKIPEDIAS = 25;
/** Resolved past guests needed to describe who a show interviews. */
const GUEST_PROFILE_MIN = 6;
export const QLOO_BLEND = 0.5;
/** Width of the editorial band inside which Qloo affinity may reorder candidates (see applyEditorialBand). */
export const EDITORIAL_BAND = 0.15;
/** Guest signal: most recent guests are looked up in waves until this many identities are confirmed. */
export const GUEST_SIGNAL_TARGET = 10;
const GUEST_WAVE = 5;
const GUEST_LOOKUP_MAX = 25;

interface Candidate {
  key: string;
  name: string;
  appearances: Appearance[];
  vector: ThemeVector;
  matched: Map<ThemeId, Set<string>>;
  source: Recommendation['source'];
  qlooEntityId: string | null;
  qlooAffinity: number | null;
  qlooProposedRank: number | null;
  external?: ExternalCheck;
  identity: IdentityStatus;
  themeFit: number;
  momentum: number;
  recency: number;
  base: number;
  score: number;
  /** Score with Qloo affinity blended in (LIVE); applied only inside the editorial band. */
  blended?: number;
  inBand?: boolean;
  /** Wikidata record (people data, or the external check); null: not documented. */
  person?: PersonRecord | null;
  typeFit?: number;
  regionFit?: number;
  known?: number;
}

/** high: several interviews, or one with a curated/explicit name; medium: two automatic mentions; low: one automatic mention. */
/**
 * Interviews: high = several interviews, or one with a curated/explicit name; medium = two automatic
 * mentions; low = one automatic mention. External: medium = documented identity and background, but
 * no interview on record (an interview track record is what makes evidence "high").
 */
export function evidenceQuality(apps: Appearance[], external?: ExternalCheck): Assessment['evidence'] {
  if (external && !apps.length) return { level: external.status === 'documented' ? 'medium' : 'low', appearances: 0, shows: 0, automaticNamesOnly: false, kind: 'external' };
  const shows = new Set(apps.map((a) => a.showId)).size;
  const automaticNamesOnly = apps.length > 0 && apps.every((a) => a.confidence === 'low');
  const level = apps.length >= 2 && (!automaticNamesOnly || shows >= 2) ? 'high' : apps.length >= 2 || (apps.length === 1 && !automaticNamesOnly) ? 'medium' : 'low';
  return { level, appearances: apps.length, shows, automaticNamesOnly, kind: 'interviews' };
}

function monthsBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / MONTH_MS;
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
  const useAffinity = input.qlooAffinity !== false;
  const blend = qloo.mode === 'LIVE' && useAffinity ? QLOO_BLEND : 0; // simulated affinities never change the ranking
  const qlooProvenance: Provenance = qloo.mode === 'OFF' ? 'INFERRED' : qloo.mode;
  const unconfirmedGuests: string[] = [];
  const targetHostKeys = new Set(target.hostAliases.map(nameKey));
  let windowMonths = 36;
  let pool = new Map<string, Candidate>();
  const discoveries: Discovery[] = [];
  let affinityRank = new Map<string, number>();
  let minFit = 0.35;
  // Who the show interviews (people data). Without it every audience term is off and the ranking is
  // the topical one, unchanged.
  const people = input.people ?? null;
  // Verified origin; for shows outside the catalog, the country most of its documented guests share (≥ 50 %).
  let showCountry = input.originOf?.get(target.id) ?? null;
  // The audience's countries: the show's own, plus any country at least 15 % of its documented past
  // guests come from (an English-language show from London interviewing Americans is heard by both).
  let audienceCountries = new Set(showCountry ? [showCountry] : []);
  const AUDIENCE_COUNTRY_SHARE = 0.15;
  let guestProfile: ShowGuestProfile | null = null;
  let audienceDemographics: AgentResult['audienceDemographics'] = null;
  const qlooAudienceOf = new Map<string, QlooAudience>();
  let themeEvidence = 1;
  const catShare = new Map<OccupationCategory, number>();
  const profileStrong = () => Boolean(guestProfile?.strong);
  const themesWeak = () => Boolean(guestProfile?.themesWeak);
  let gateLevel = 3;
  const personOf = (c: Candidate): PersonRecord | null => {
    if (c.person !== undefined) return c.person;
    if (!people) return (c.person = null);
    if (c.external?.wikidataId && c.external.kind === 'person') {
      c.person = {
        qid: c.external.wikidataId,
        label: c.external.canonicalName,
        description: c.external.description,
        occupations: c.external.occupations.slice(0, 4),
        categories: categoriesOf(c.external.occupations.map((o) => o.en)),
        countries: [],
        wikipedias: c.external.languages.articles.length,
        articles: c.external.languages.articles.map((l) => `${l}wiki`),
        photo: null,
        match: ['qloo-external'],
        matchEvidence: c.external.identityEvidence,
      };
      return c.person;
    }
    return (c.person = people[c.key] ?? null);
  };
  const sameCountryShows = (c: Candidate) => (showCountry ? [...new Set(c.appearances.filter((a) => input.originOf?.get(a.showId) === showCountry).map((a) => a.showName))] : []);
  const audienceTerms = (c: Candidate) => {
    const p = personOf(c);
    const cats = p?.categories ?? [];
    let typeFit = 0;
    if (cats.length && catShare.size) {
      const dot = cats.reduce((sum, cat) => sum + (catShare.get(cat) ?? 0) / cats.length, 0);
      const na = Math.sqrt(cats.length * (1 / cats.length) ** 2);
      const nb = Math.sqrt([...catShare.values()].reduce((sum, v) => sum + v * v, 0));
      typeFit = na && nb ? dot / (na * nb) : 0;
    }
    const regionFit = p?.countries.some((cc) => audienceCountries.has(cc)) ? 1 : sameCountryShows(c).length ? 0.6 : 0;
    const known = p ? Math.min(1, Math.log2(1 + p.wikipedias) / Math.log2(31)) : 0;
    return { typeFit, regionFit, known };
  };
  // "Known by this audience", from strictest (0) to not applied (3). The loosest level is used only
  // when stricter ones leave fewer than k candidates, and the trace says which one was used.
  const audienceOk = (c: Candidate, level = gateLevel) => {
    // Never recommend someone who has died (Wikidata P570), whatever the level.
    if (personOf(c)?.died) return false;
    if (!people || level >= 3) return true;
    const p = personOf(c);
    if (!p) return false;
    if (level === 2) return true;
    if (level === 1) return p.wikipedias >= INTERNATIONAL_WIKIPEDIAS || (c.regionFit ?? 0) >= 0.6;
    return (c.regionFit ?? 0) === 1 && (!profileStrong() || (c.typeFit ?? 0) > 0);
  };
  const gateText = (): Bi[] => [
    [`documented people from the audience’s countries (${[...audienceCountries].join('/').toUpperCase() || '—'}) who match the kind of guest the show interviews`, `personas documentadas de los países de su audiencia (${[...audienceCountries].join('/').toUpperCase() || '—'}) del mismo tipo de invitado que entrevista el programa`],
    [`documented people from ${showCountry?.toUpperCase() ?? 'the show’s country'}, interviewed on its shows, or known in ${INTERNATIONAL_WIKIPEDIAS}+ Wikipedias`, `personas documentadas de ${showCountry?.toUpperCase() ?? 'el país del programa'}, entrevistadas en sus programas, o conocidas en ${INTERNATIONAL_WIKIPEDIAS}+ Wikipedias`],
    ['people documented in Wikidata, from any country', 'personas documentadas en Wikidata, de cualquier país'],
    ['anyone with verified interviews (people data does not cover enough candidates)', 'cualquiera con entrevistas verificadas (los datos de personas no cubren suficientes candidatos)'],
  ];
  // Speaking the show's language is required at every level, as in the shortlist.
  const settleGate = () => {
    if (!people) return;
    gateLevel = 3;
    for (let level = 0; level < 3; level++) {
      if ([...pool.values()].filter((c) => pertinent(c) && audienceOk(c, level) && speaksTarget(c)).length >= k) {
        gateLevel = level;
        break;
      }
    }
    if (guestProfile) guestProfile.gateLevel = gateLevel;
  };
  // Pertinence is not the same as cosine fit. A guest whose interviews (or documented occupation) sit
  // mostly in ONE of the show's established themes (≥ 10% of its titles) is pertinent even when the
  // cosine against the show's whole theme mix is low (e.g. a business guest on a multi-theme show).
  // This only widens eligibility; the score keeps using the cosine fit, unchanged.
  const establishedTheme = (c: Candidate) => {
    const total = THEME_IDS.reduce((s, id) => s + c.vector[id], 0);
    if (!total) return null;
    const best = THEME_IDS.reduce((a, b) => (c.vector[b] > c.vector[a] ? b : a));
    const th = themes.find((x) => x.id === best);
    return c.vector[best] / total >= 0.5 && th && th.share >= 0.1 ? th : null;
  };
  const themePertinent = (c: Candidate) => (!themesWeak() && c.themeFit >= minFit) || Boolean(!themesWeak() && establishedTheme(c));
  // With a guest profile, being the same kind of guest the show interviews is also pertinent; when the
  // titles carry too little theme evidence, it is the main test (topical fit alone then needs 0.5).
  const pertinent = (c: Candidate) =>
    profileStrong() ? themePertinent(c) || (c.typeFit ?? 0) >= Math.max(0.25, minFit - 0.1) || (themesWeak() && c.themeFit >= 0.5) : c.themeFit >= minFit || Boolean(establishedTheme(c));
  const themeCheck = (c: Candidate, what: Bi): QlooProposal['checks'][number] => {
    const th = establishedTheme(c);
    if (c.themeFit >= minFit) return { check: 'theme', ok: true, detail: `${what[0]} fit the show’s theme mix at ${c.themeFit.toFixed(2)} ≥ ${minFit}.`, detailEs: `${what[1]} encaja con la mezcla temática del programa en ${c.themeFit.toFixed(2)} ≥ ${minFit}.` };
    if (th) return { check: 'theme', ok: true, detail: `${what[0]} sit mainly in “${th.label}”, an established theme of the show (${Math.round(th.share * 100)}% of titles); overall fit ${c.themeFit.toFixed(2)}.`, detailEs: `${what[1]} se ubica principalmente en “${th.labelEs}”, un tema establecido del programa (${Math.round(th.share * 100)}% de los títulos); ajuste global ${c.themeFit.toFixed(2)}.` };
    return { check: 'theme', ok: false, detail: `${what[0]} fit the show’s themes at ${c.themeFit.toFixed(2)} < ${minFit}, and their main theme is not one of the show’s established themes.`, detailEs: `${what[1]} encaja con los temas del programa en ${c.themeFit.toFixed(2)} < ${minFit}, y su tema principal no es uno de los temas establecidos del programa.` };
  };
  const eligible = () => [...pool.values()].filter((c) => pertinent(c) && audienceOk(c));
  const targetLang = target.language;
  const langOf = new Map(others.map((o) => [o.id, o.language]));
  // Habitual languages of the show (from its own titles); until profiled, the declared language.
  const langProfile: LanguageProfile = languageProfile(target, others, { asOf, originOf: input.originOf });
  let accepted = new Set([targetLang]);
  const appLang = (a: Appearance) => a.language ?? langOf.get(a.showId);
  // Confirmed only by a verified interview in one of the show's habitual languages. Nobody is assumed to speak it.
  // External candidates: only languages documented in Wikidata (P1412) count as confirmed.
  const speaksTarget = (c: Candidate) => (c.external ? c.external.languages.spoken.some((l) => accepted.has(l)) : c.appearances.some((a) => accepted.has(appLang(a) ?? '')));
  const acceptedLabel = () => [...accepted].join('/');
  let languageFilter = false;
  let picks: Candidate[] = [];
  const rejected = new Map<string, Bi>();
  let verifyRounds = 0;
  const weakEvidence = new Set<string>();
  let verified = false;
  let picksNeedReselect = false;
  const signalIds = () => [...resolved.map((r) => r.entityId), ...(podcastEntity ? [podcastEntity.entityId] : [])];
  const tagIds = () => tagSignals.map((t) => t.entityId);
  // Discovery (Qloo proposes, the agent verifies). Alternative signals found while replanning the
  // discovery are kept apart, so they never change the affinity signal used for scoring.
  const proposals: QlooProposal[] = [];
  const unverified: Array<{ entity: QlooEntity; rank: number; attempt: number; signal: string }> = [];
  const attempts: DiscoveryFunnel['attempts'] = [];
  let discoveryAttempts = 0;
  let verifyDiscoveryRuns = 0;
  let altPodcast: QlooEntity | null = null;
  const altTags: QlooEntity[] = [];
  let funnelDiagnosis: Pick<DiscoveryFunnel, 'diagnosis' | 'diagnosisText' | 'diagnosisTextEs'> = {
    diagnosis: 'not_run',
    diagnosisText: qloo.mode === 'LIVE' ? 'Qloo discovery did not run (no usable audience signal or time budget spent).' : `Qloo discovery runs only in LIVE mode (this run: ${qloo.mode}).`,
    diagnosisTextEs: qloo.mode === 'LIVE' ? 'El descubrimiento con Qloo no se ejecutó (sin señal de audiencia utilizable o sin tiempo).' : `El descubrimiento con Qloo solo funciona en modo LIVE (esta ejecución: ${qloo.mode}).`,
  };
  const rankedProposals = () => proposals.filter((x) => x.outcome === 'ranked').length;
  const sig: SignalDiagnostics = {
    guests: { searched: 0, withResults: 0, confirmed: 0, ambiguous: 0, noContext: 0, fuzzyOnly: 0, notFound: 0, errors: 0 },
    podcast: [],
    tags: [],
    skippedGeneric: [],
    verdict: 'not_run',
  };
  // 'full': no record in our RSS, identity and kind come from Wikidata/Wikipedia.
  // 'type': identity already proven by our RSS; Wikidata only settles whether it is an individual person.
  const externalQueue: Array<{ entity: QlooEntity; rank: number; mode: 'full' | 'type'; candidate?: Candidate; evidence?: string[] }> = [];
  const externalStats = { queued: 0, checked: 0, overCap: 0 };
  const admitPoolCandidate = (c: Candidate, qlooId: string, rank: number, ev: string[]) => {
    c.source = 'qloo-person-insights';
    c.qlooEntityId = qlooId;
    c.qlooProposedRank = rank;
    c.identity = { status: 'confirmed', evidence: ev };
  };
  const funnelCounts = () => {
    const n = (f: (x: QlooProposal) => boolean) => proposals.filter(f).length;
    const lang = (x: QlooProposal, ok: boolean | null) => x.outcome === 'ranked' && x.checks.some((c) => c.check === 'language' && c.ok === ok);
    return {
      proposed: proposals.length,
      notPerson: n((x) => x.failure === 'not_person'),
      repeats: n((x) => x.failure === 'repeat'),
      identityVerified: n((x) => x.checks.some((c) => c.check === 'identity' && c.ok === true)),
      noRecord: n((x) => x.failure === 'coverage'),
      identityUnconfirmed: n((x) => x.failure === 'identity'),
      offTheme: n((x) => x.failure === 'theme'),
      languageCompatible: n((x) => lang(x, true)),
      languageUnknown: n((x) => lang(x, null)),
      externalQueued: externalStats.queued,
      externalChecked: externalStats.checked,
      externalOverCap: externalStats.overCap,
      externalDocumented: n((x) => x.external?.kind === 'person' && x.external.status === 'documented'),
      externalPartial: n((x) => x.external?.kind === 'person' && x.external.status === 'partial'),
      externalPending: n((x) => x.external?.status === 'pending'),
      typeErrors: n((x) => x.failure === 'type' && x.outcome === 'discarded'),
      typePending: n((x) => x.failure === 'type' && x.outcome === 'pending'),
      ranked: rankedProposals(),
      inShortlist: n((x) => x.outcome === 'ranked' && picks.some((p) => p.key === x.key)),
    };
  };
  // Diagnose why Qloo's proposals did not turn into candidates, so the planner can change strategy.
  const diagnose = (): Bi => {
    const f = funnelCounts();
    const failures = proposals.filter((x) => x.failure).map((x) => x.failure!);
    const top = (['coverage', 'identity', 'theme', 'repeat', 'not_person', 'type'] as const).map((k) => [k, failures.filter((x) => x === k).length] as const).sort((a, b) => b[1] - a[1])[0];
    const texts: Record<DiscoveryFailure | 'language' | 'ok', Bi> = {
      ok: [`${f.ranked} Qloo-proposed people verified and on-theme.`, `${f.ranked} personas propuestas por Qloo verificadas y dentro de los temas.`],
      coverage: ['Coverage: most people Qloo proposed have no verifiable record in our sources or in Wikidata.', 'Cobertura: la mayoría de las personas que propuso Qloo no tiene registro verificable en nuestras fuentes ni en Wikidata.'],
      identity: ['Identity: names match several people, or people in our sources, without context that tells them apart.', 'Identidad: los nombres coinciden con varias personas, o con personas de nuestras fuentes, sin contexto que permita distinguirlas.'],
      theme: ['Thematic fit: verified people, but their interviews or documented background are about other subjects.', 'Ajuste temático: personas verificadas, pero sus entrevistas o su trayectoria documentada tratan otros temas.'],
      repeat: ['Repeats: Qloo mostly proposed people who already appeared on the show.', 'Repetidos: Qloo propuso sobre todo a personas que ya participaron en el programa.'],
      not_person: ['Qloo returned names that are not people.', 'Qloo devolvió nombres que no son personas.'],
      type: ['Type: Qloo proposed bands, duos, companies or works, not individual people.', 'Tipo: Qloo propuso bandas, dúos, empresas u obras, no personas individuales.'],
      language: ['Language: verified people, none with an interview in the show’s languages.', 'Idioma: personas verificadas, ninguna con entrevistas en los idiomas del programa.'],
    };
    const diagnosis: DiscoveryFunnel['diagnosis'] = f.proposed === 0 ? 'coverage' : f.ranked > 0 ? (f.languageCompatible === 0 ? 'language' : 'ok') : top[1] ? top[0] : 'coverage';
    const dt: Bi = f.proposed === 0 ? (['Coverage: Qloo proposed nobody for the signals tried.', 'Cobertura: Qloo no propuso a nadie con las señales probadas.'] as Bi) : texts[diagnosis as keyof typeof texts];
    funnelDiagnosis = { diagnosis, diagnosisText: dt[0], diagnosisTextEs: dt[1] };
    return dt;
  };

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
            ({ key, name: g.name, appearances: [], vector: emptyVector(), matched: new Map(), source: 'verified-pool', qlooEntityId: null, qlooAffinity: null, qlooProposedRank: null, identity: { status: 'not_checked', evidence: [] }, themeFit: 0, momentum: 0, recency: 0, base: 0, score: 0 } as Candidate);
          c.appearances.push({ showId: show.id, showName: show.name, episodeId: e.id, title: e.title, published: e.published, url: e.url, confidence: g.confidence, language: appearanceLanguage(e, show.language) ?? undefined });
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
    const W = profileStrong() ? (themesWeak() ? AUDIENCE_WEIGHTS.profileWeakThemes : AUDIENCE_WEIGHTS.profile) : AUDIENCE_WEIGHTS.noProfile;
    for (const c of p.values()) {
      c.themeFit = cosine(c.vector, profile);
      if (people) Object.assign(c, audienceTerms(c));
      const audience = people ? W.typeFit * (c.typeFit ?? 0) + W.region * (c.regionFit ?? 0) + W.known * (c.known ?? 0) : 0;
      if (c.external) {
        // No interviews in our sources: momentum and recency are unknown, not zero. They are left
        // out and the remaining weight is renormalized, so absence from our corpus is not a penalty.
        c.momentum = 0;
        c.recency = 0;
        c.base = people ? (W.themeFit * c.themeFit + audience) / (W.themeFit + W.typeFit + W.region + W.known) : c.themeFit;
        if (c.qlooEntityId && affinityRank.has(c.qlooEntityId)) c.qlooAffinity = affinityRank.get(c.qlooEntityId)!;
        c.blended = blend > 0 && affinityRank.size ? (1 - blend) * c.base + blend * (c.qlooAffinity ?? 0.5) : c.base;
        c.score = c.blended;
        continue;
      }
      const recent = c.appearances.filter((a) => monthsBetween(a.published, asOf) <= 24).length;
      c.momentum = Math.min(1, Math.log2(1 + recent) / 2);
      const last = c.appearances.reduce((m, a) => (a.published > m ? a.published : m), '');
      c.recency = last ? Math.exp(-monthsBetween(last, asOf) / 12) : 0;
      c.base = people ? W.themeFit * c.themeFit + audience + W.momentum * c.momentum + W.recency * c.recency : WEIGHTS.themeFit * c.themeFit + WEIGHTS.momentum * c.momentum + WEIGHTS.recency * c.recency;
      if (c.qlooEntityId && affinityRank.has(c.qlooEntityId)) c.qlooAffinity = affinityRank.get(c.qlooEntityId)!;
      // Candidates Qloo cannot score keep a neutral 0.5 instead of being penalized for coverage gaps.
      c.blended = blend > 0 && affinityRank.size ? (1 - blend) * c.base + blend * (c.qlooAffinity ?? 0.5) : c.base;
      c.score = c.blended;
    }
  };
  // Editorial band (rule fixed before any LIVE evaluation, not tuned on results): Qloo affinity may
  // reorder candidates whose editorial relevance is within EDITORIAL_BAND of the k-th best eligible
  // candidate; it never lifts anyone below that band, and band members always rank above them.
  // Without LIVE affinity this is a no-op, so MOCK/baseline rankings are unchanged.
  let bandFloor = -Infinity;
  const applyEditorialBand = () => {
    bandFloor = -Infinity;
    if (!(blend > 0 && affinityRank.size)) {
      for (const c of pool.values()) ((c.inBand = true), (c.score = c.blended ?? c.score));
      return;
    }
    const bases = [...pool.values()].filter((c) => (people ? pertinent(c) && audienceOk(c) : c.themeFit >= minFit)).map((c) => c.base).sort((a, b) => b - a);
    const kth = bases[Math.min(k, bases.length) - 1] ?? 0;
    bandFloor = kth * (1 - EDITORIAL_BAND);
    for (const c of pool.values()) {
      c.inBand = c.base >= bandFloor;
      c.score = c.inBand ? (c.blended ?? c.base) : c.base;
    }
  };
  const byRank = (a: Candidate, b: Candidate) => Number(b.inBand !== false) - Number(a.inBand !== false) || b.score - a.score;

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
      let withTheme = 0;
      for (const e of history.slice(0, 150)) {
        const ageYears = Math.max(0, monthsBetween(e.published, asOf) / 12);
        const { vector, matched } = themesOfTitle(e.title, e.guests.map((g) => g.name));
        if (matched.size) withTheme++;
        addInto(profile, vector, Math.pow(0.5, ageYears));
        for (const [id, words] of matched) {
          const m = profileWords.get(id) ?? new Map<string, number>();
          for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
          profileWords.set(id, m);
        }
      }
      themeEvidence = history.length ? withTheme / Math.min(150, history.length) : 0;
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

    profile_language: async () => {
      if (langProfile.accepted.length) accepted = new Set(langProfile.accepted);
      const intl = langProfile.internationalGuests;
      step({
        title: ['Profile the languages the show interviews in', 'Perfilar los idiomas en que entrevista el programa'],
        tool: 'language_profile',
        detail: [
          `${langProfile.preference} Declared in the feed: “${langProfile.declared || '—'}”. ${intl.length} of ${pastGuests.size} past guests also have interviews on shows in another language or country in our sources (${pct(langProfile.internationalShare)}%).`,
          `${langProfile.preferenceEs} Declarado en el RSS: “${langProfile.declared || '—'}”. ${intl.length} de ${pastGuests.size} invitados anteriores también tienen entrevistas en programas de otro idioma o país en nuestras fuentes (${pct(langProfile.internationalShare)}%).`,
        ],
        decision: langProfile.accepted.length
          ? [
              `Habitual language(s): ${acceptedLabel()} (confidence ${langProfile.confidence}). Candidates with a verified interview in ${acceptedLabel()} count as language-compatible.`,
              `Idioma(s) habitual(es): ${acceptedLabel()} (confianza ${langProfile.confidence === 'high' ? 'alta' : langProfile.confidence === 'medium' ? 'media' : 'baja'}). Los candidatos con una entrevista verificada en ${acceptedLabel()} cuentan como compatibles.`,
            ]
          : ['Interview language unknown: no candidate can be confirmed as language-compatible.', 'Idioma de las entrevistas desconocido: ningún candidato puede confirmarse como compatible.'],
        provenance: langProfile.basis === 'evidence' ? 'INFERRED' : 'VERIFIED',
      });
      if (!langProfile.accepted.length) accepted = new Set();
      if (langProfile.basis !== 'evidence')
        warn([
          `Interview language rests on the feed's declared language only (${langProfile.detected} titles with a detectable language).`,
          `El idioma de las entrevistas se apoya solo en el idioma declarado en el RSS (${langProfile.detected} títulos con idioma detectable).`,
        ]);
    },

    qloo_resolve_guests: async () => {
      const candidates = [...pastGuests.values()].sort((a, b) => b.published.localeCompare(a.published)).slice(0, GUEST_LOOKUP_MAX);
      // Most recent first, in waves: once GUEST_SIGNAL_TARGET identities are confirmed the signal is
      // complete and the remaining lookups are not spent (they are the largest cost of an analysis).
      // Each wave runs concurrently; results are consumed in list order, so timing never changes the outcome.
      const recentGuests: typeof candidates = [];
      const lookups: Array<{ hits: QlooEntity[] } | { err: unknown }> = [];
      let confirmed = 0;
      // A wave never asks for more lookups than the Qloo budget still allows.
      const budgetLeft = () => qloo.budgetLeft?.() ?? Infinity;
      for (let i = 0; i < candidates.length && confirmed < GUEST_SIGNAL_TARGET && !outOfTime() && budgetLeft() > 0; ) {
        const wave = candidates.slice(i, i + Math.min(GUEST_WAVE, budgetLeft()));
        i += wave.length;
        const got = await Promise.all(wave.map((g) => qloo.searchPerson(g.name).then((hits) => ({ hits }), (err: unknown) => ({ err }))));
        recentGuests.push(...wave);
        lookups.push(...got);
        wave.forEach((g, j) => {
          const l = got[j];
          if (!('err' in l) && checkIdentity(l.hits, g.name, titlesByKey.get(nameKey(g.name)) ?? []).status === 'confirmed') confirmed++;
        });
      }
      const guestErrors: string[] = [];
      sig.guests.searched += recentGuests.length;
      recentGuests.forEach((g, i) => {
        const l = lookups[i];
        if ('err' in l) return void (sig.guests.errors++, guestErrors.push(String(l.err)));
        if (l.hits.length) sig.guests.withResults++;
        const r = checkIdentity(l.hits, g.name, titlesByKey.get(nameKey(g.name)) ?? []);
        if (r.status === 'confirmed') (resolved.push(r.entity), sig.guests.confirmed++);
        else if (r.status === 'pending') {
          unconfirmedGuests.push(g.name);
          if (r.reason === 'ambiguous') sig.guests.ambiguous++;
          else if (r.reason === 'fuzzy') sig.guests.fuzzyOnly++;
          else sig.guests.noContext++;
        } else sig.guests.notFound++;
      });
      if (guestErrors.length)
        warn([`${guestErrors.length} Qloo guest lookups failed (first: ${guestErrors[0]}).`, `Fallaron ${guestErrors.length} búsquedas de invitados en Qloo (primera: ${guestErrors[0]}).`]);
      step({
        title: ['Resolve past guests in Qloo’s taste graph', 'Ubicar a los invitados anteriores en el grafo de gustos de Qloo'],
        tool: 'qloo.search',
        detail: [
          `${resolved.length} of the ${recentGuests.length} most recent guests confirmed in Qloo (unique exact name AND Qloo's description shares context with their interview titles)${unconfirmedGuests.length ? `; ${unconfirmedGuests.length} left out as unverified (name only, namesakes or no context)` : ''}${recentGuests.length < candidates.length ? `. Stopped after ${GUEST_SIGNAL_TARGET} confirmed identities: ${candidates.length - recentGuests.length} older guests not looked up` : ''}.`,
          `${resolved.length} de los ${recentGuests.length} invitados más recientes confirmados en Qloo (nombre exacto y único Y la descripción de Qloo comparte contexto con los títulos de sus entrevistas)${unconfirmedGuests.length ? `; ${unconfirmedGuests.length} quedan afuera sin verificar (solo nombre, homónimos o sin contexto)` : ''}${recentGuests.length < candidates.length ? `. Me detuve al llegar a ${GUEST_SIGNAL_TARGET} identidades confirmadas: ${candidates.length - recentGuests.length} invitados más antiguos no se buscaron` : ''}.`,
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
      // Exact-title variants of the show's name (subtitle, "Podcast", "con …" removed); never fuzzy.
      const variants = showNameVariants(target.name, target.host);
      const variantKeys = new Set(variants.map(compactKey));
      // A hit matches when its own exact-title variants ("X Podcast" → "X") meet ours, after normalization.
      const hitMatches = (name: string) => showNameVariants(name).some((v) => variantKeys.has(compactKey(v)));
      for (const v of variants) {
        try {
          const got = await qloo.searchPodcast(v);
          hits = [...hits, ...got];
          sig.podcast.push({ query: v, results: got.length, exactMatches: got.filter((h) => hitMatches(h.name)).length, sample: got.slice(0, 3).map((h) => h.name) });
        } catch (err) {
          warn([`Qloo podcast search failed: ${String(err)}`, `Falló la búsqueda del podcast en Qloo: ${String(err)}`]);
        }
        if (hits.some((h) => hitMatches(h.name))) break;
      }
      // Same identity policy as for people: exact, unique title only.
      const exact = hits.filter((h) => hitMatches(h.name));
      if (new Set(exact.map((h) => h.entityId)).size === 1) {
        // After the signals are settled this runs only to replan the discovery: kept apart from scoring.
        if (signalsSettled) altPodcast = exact[0];
        else podcastEntity = exact[0];
      }
      const found = signalsSettled ? altPodcast : podcastEntity;
      step({
        title: ['Look up the show itself in Qloo', 'Buscar el propio programa en Qloo'],
        tool: 'qloo.search (podcast)',
        detail: found
          ? [`Found “${found.name}” as a Qloo podcast entity (unique exact title).`, `Encontré “${found.name}” como entidad de podcast en Qloo (título exacto y único).`]
          : [`${hits.length} podcast results, none with a unique exact title match.`, `${hits.length} resultados de podcast, ninguno con título exacto y único.`],
        decision: found
          ? ['Using the show entity as the audience signal.', 'Uso la entidad del programa como señal de la audiencia.']
          : ['No reliable show entity; will not guess.', 'No hay una entidad confiable del programa; no voy a adivinar.'],
        provenance: qlooProvenance,
      });
    },

    qloo_find_theme_tags: async () => {
      // Specific theme words only (generic ones like "music" or "TV" are skipped), in their English
      // form when one exists, so Spanish-language shows can reach Qloo's tags.
      const { queries: tq, skippedGeneric } = buildTagQueries(themes);
      const queries = tq.map((x) => x.query);
      for (const s of skippedGeneric) if (!sig.skippedGeneric.includes(s)) sig.skippedGeneric.push(s);
      for (const { query: q, accepts, word } of tq) {
        try {
          const tags = await qloo.findTags(q);
          // Accept a tag only when its name equals the word or its English form (exact-or-choose rule).
          // Several results with the same normalized name ("Stand Up Comedy" / "stand up comedy", or one
          // concept as genre and keyword) are the SAME cultural signal: accepted together (ids kept), not
          // rejected as ambiguous. Results that only resemble the query are not accepted.
          const exact = tags.filter((t) => accepts.includes(compactKey(t.name)) && !GENERIC_WORDS.has(compactKey(t.name)));
          const ids = [...new Map(exact.map((x) => [x.entityId, x])).values()].slice(0, 2);
          sig.tags.push({ word, query: q, results: tags.length, accepted: ids.length ? ids[0].name : null, acceptedIds: ids.map((x) => x.entityId), sample: tags.slice(0, 3).map((x) => x.name) });
          const into = signalsSettled ? altTags : tagSignals;
          for (const x of ids) if (!into.some((y) => y.entityId === x.entityId)) into.push(x);
        } catch (err) {
          warn([`Qloo tag search failed for “${q}”: ${String(err)}`, `Falló la búsqueda de etiquetas en Qloo para “${q}”: ${String(err)}`]);
        }
      }
      step({
        title: ['Translate the show’s themes into Qloo tags', 'Traducir los temas del programa a etiquetas de Qloo'],
        tool: 'qloo.tags',
        detail: [
          `${(signalsSettled ? altTags : tagSignals).length} of ${queries.length} specific theme queries (${queries.join(', ') || '—'}) matched a Qloo tag exactly${(signalsSettled ? altTags : tagSignals).length ? `: ${(signalsSettled ? altTags : tagSignals).map((t) => t.name).join(', ')}` : ''}.${skippedGeneric.length ? ` Skipped as too generic: ${skippedGeneric.join(', ')}.` : ''}`,
          `${(signalsSettled ? altTags : tagSignals).length} de ${queries.length} consultas temáticas específicas (${queries.join(', ') || '—'}) coincidieron exactamente con una etiqueta de Qloo${(signalsSettled ? altTags : tagSignals).length ? `: ${(signalsSettled ? altTags : tagSignals).map((t) => t.name).join(', ')}` : ''}.${skippedGeneric.length ? ` Descartadas por demasiado generales: ${skippedGeneric.join(', ')}.` : ''}`,
        ],
        decision: (signalsSettled ? altTags : tagSignals).length
          ? ['Using these tags as a weaker, theme-level audience signal.', 'Uso estas etiquetas como una señal más débil, a nivel de temas.']
          : ['No exact tag matches; nothing to use from Qloo here.', 'Sin coincidencias exactas; no hay nada que usar de Qloo aquí.'],
        provenance: qlooProvenance,
      });
    },

    settle_signals: async () => {
      signalsSettled = true;
      qlooUsable = resolved.length >= 3 || Boolean(podcastEntity) || tagSignals.length > 0;
      const anyResults = sig.guests.withResults + sig.podcast.reduce((s, x) => s + x.results, 0) + sig.tags.reduce((s, x) => s + x.results, 0);
      // Only real Qloo answers say anything about Qloo: MOCK/OFF runs report "not_run".
      sig.verdict = qloo.mode !== 'LIVE' ? 'not_run' : qlooUsable ? 'ok' : anyResults === 0 ? 'none_in_qloo' : sig.guests.ambiguous > sig.guests.noContext + sig.guests.fuzzyOnly ? 'ambiguous' : 'unrecognized';
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
          : [
              `No reliable Qloo signal after trying guests, the show entity and theme tags (${sig.verdict === 'none_in_qloo' ? 'Qloo returned nothing for these lookups' : sig.verdict === 'ambiguous' ? 'results were namesakes' : 'Qloo returned results, but none matched exactly or shared context'}).`,
              `Sin señal confiable de Qloo después de probar invitados, la entidad del programa y etiquetas temáticas (${sig.verdict === 'none_in_qloo' ? 'Qloo no devolvió nada para estas búsquedas' : sig.verdict === 'ambiguous' ? 'los resultados eran homónimos' : 'Qloo devolvió resultados, pero ninguno coincidió exactamente ni compartió contexto'}).`,
            ],
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
      // Display-only enrichment: it runs after discovery and affinity, and only if the budget still covers it.
      if ((qloo.budgetLeft?.() ?? Infinity) < types.length) {
        step({
          title: ['Map the cross-domain taste of that audience', 'Mapear el gusto de esa audiencia en otros dominios'],
          tool: 'qloo.insights (artist, movie, book)',
          detail: ['Skipped: the Qloo call budget left for this analysis was kept for discovery and affinity.', 'Omitido: el presupuesto de consultas a Qloo de este análisis se reservó para el descubrimiento y la afinidad.'],
          decision: ['No cultural hooks this time; explanations rely on themes and prior appearances.', 'Esta vez no hay referencias culturales; las explicaciones se basan en temas y apariciones previas.'],
          provenance: qlooProvenance,
        });
        return;
      }
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
      discoveryAttempts++;
      // Attempt 1 uses the settled audience signal; attempt 2 (replanning) an alternative one.
      const alt = discoveryAttempts > 1;
      const sIds = alt ? (altPodcast ? [altPodcast.entityId] : podcastEntity ? [podcastEntity.entityId] : []) : signalIds();
      const tIds = alt ? (altTags.length ? altTags : tagSignals).map((x) => x.entityId) : tagIds();
      const signal = alt ? [sIds.length ? 'podcast' : '', tIds.length ? 'tags' : ''].filter(Boolean).join('+') || 'none' : signalStrategy;
      const seen = new Set([...resolved.map((r) => r.entityId), ...proposals.map((x) => x.qlooEntityId), ...unverified.map((x) => x.entity.entityId)]);
      let people: QlooEntity[] = [];
      try {
        people = await qloo.personInsights({ signalIds: sIds, tagIds: tIds, excludeIds: [...seen], take: 30 });
      } catch (err) {
        warn([`Qloo person insights failed: ${String(err)}`, `Falló la consulta de personas en Qloo: ${String(err)}`]);
      }
      const fresh = people.filter((p) => p.entityId && nameKey(p.name) && !seen.has(p.entityId));
      fresh.forEach((p, i) => unverified.push({ entity: p, rank: i + 1, attempt: discoveryAttempts, signal }));
      attempts.push({ signal, proposed: fresh.length });
      if (!fresh.length && !proposals.length)
        funnelDiagnosis = { diagnosis: 'coverage', diagnosisText: 'Coverage: Qloo proposed nobody for the signals tried.', diagnosisTextEs: 'Cobertura: Qloo no propuso a nadie con las señales probadas.' };
      step({
        title: alt ? ['Ask Qloo again with another audience signal', 'Volver a preguntar a Qloo con otra señal de audiencia'] : ['Ask Qloo who else this audience has affinity for', 'Preguntar a Qloo con quién más tiene afinidad esta audiencia'],
        tool: 'qloo.insights (person)',
        detail: [`${fresh.length} people proposed by Qloo (signal: ${signal}).`, `${fresh.length} personas propuestas por Qloo (señal: ${signal}).`],
        decision: fresh.length
          ? [
              'Qloo proposes; it does not decide. Each person must pass the same checks as any other candidate before entering the ranking.',
              'Qloo propone; no decide. Cada persona debe pasar los mismos controles que cualquier otro candidato antes de entrar al ranking.',
            ]
          : ['Qloo proposed nobody for this signal.', 'Qloo no propuso a nadie con esta señal.'],
        provenance: qlooProvenance,
      });
    },

    verify_discoveries: async () => {
      verifyDiscoveryRuns++;
      const targetTitles = history.map((e) => ` ${nameKey(e.title)} `);
      const batch = unverified.splice(0);
      for (const u of batch) {
        const name = u.entity.name;
        const key = nameKey(name);
        const checks: QlooProposal['checks'] = [];
        const base = { name, key, qlooEntityId: u.entity.entityId, qlooRank: u.rank, attempt: u.attempt, signal: u.signal, checks };
        const out = (o: Pick<QlooProposal, 'outcome' | 'failure' | 'reason' | 'reasonEs'>) => proposals.push({ ...base, ...o });
        if (looksLikeSegmentName(name)) {
          checks.push({ check: 'person', ok: false, detail: 'Looks like a segment or series name, not a person.', detailEs: 'Parece el nombre de una sección o serie, no de una persona.' });
          out({ outcome: 'discarded', failure: 'not_person', reason: 'Not a person', reasonEs: 'No es una persona' });
          continue;
        }
        // Qloo's own type: a specific non-person kind discards; a generic or ambiguous one ("urn:entity",
        // "urn:entity:artist") does NOT — the kind is then settled with Wikidata before any ranking.
        const kind = qlooKind(u.entity.types);
        const typesLabel = u.entity.types?.join(', ') || '—';
        if (kind === 'non_person') {
          checks.push({ check: 'person', ok: false, detail: `Qloo types: ${typesLabel} (a non-person kind).`, detailEs: `Tipos en Qloo: ${typesLabel} (no es una persona).` });
          out({ outcome: 'discarded', failure: 'type', reason: 'Qloo types it as a non-person entity', reasonEs: 'Qloo lo tipifica como algo que no es una persona' });
          continue;
        }
        checks.push(
          kind === 'person'
            ? { check: 'person', ok: true, detail: `Qloo type: ${typesLabel}.`, detailEs: `Tipo en Qloo: ${typesLabel}.` }
            : { check: 'person', ok: null, detail: `Qloo type is generic or ambiguous (${typesLabel}): the kind (person, band, organization) must be confirmed in Wikidata.`, detailEs: `El tipo en Qloo es genérico o ambiguo (${typesLabel}): el tipo de entidad (persona, banda, organización) se confirma en Wikidata.` },
        );
        const past = pastGuests.get(key);
        const inTitles = key.split(' ').length >= 2 && targetTitles.some((x) => x.includes(` ${key} `));
        if (past || targetHostKeys.has(key) || inTitles) {
          const why: Bi = past
            ? [`Already a guest on ${target.name} (${d10(past.published)})`, `Ya fue invitado en ${target.name} (${d10(past.published)})`]
            : targetHostKeys.has(key)
              ? [`Host of ${target.name}`, `Conductor de ${target.name}`]
              : [`Name appears in a ${target.name} episode title`, `Su nombre aparece en el título de un episodio de ${target.name}`];
          checks.push({ check: 'repeat', ok: false, detail: why[0], detailEs: why[1] });
          out({ outcome: 'discarded', failure: 'repeat', reason: why[0], reasonEs: why[1] });
          discarded.push({ name, reason: `Proposed by Qloo, but: ${why[0]}`, reasonEs: `Propuesto por Qloo, pero: ${why[1]}` });
          continue;
        }
        checks.push({ check: 'repeat', ok: true, detail: `Not among the ${pastGuests.size} identified guests of ${target.name}.`, detailEs: `No figura entre los ${pastGuests.size} invitados identificados de ${target.name}.` });
        const c = pool.get(key);
        if (!c) {
          checks.push({ check: 'identity', ok: null, detail: `No verified interview in our ${others.length} comparison shows: identity, background and language cannot be checked here.`, detailEs: `Sin entrevistas verificadas en nuestros ${others.length} programas de comparación: no se pueden comprobar aquí identidad, trayectoria ni idioma.` });
          out({ outcome: 'pending', failure: 'coverage', reason: 'No verifiable record in our sources', reasonEs: 'Sin registro verificable en nuestras fuentes' });
          discoveries.push({
            name,
            key,
            qlooEntityId: u.entity.entityId,
            qlooRank: u.rank,
            popularity: u.entity.popularity,
            signal: signalStrategy,
            identity: { status: 'pending', reason: 'qloo_only', evidence: u.entity.description ? [u.entity.description] : [] },
            language: { status: 'unknown', target: targetLang, evidenceLanguages: [], evidenceEn: 'No verified interview in our sources.', evidenceEs: 'Sin entrevistas verificadas en nuestras fuentes.' },
            history: historyStatus,
          });
          externalQueue.push({ entity: u.entity, rank: u.rank, mode: 'full' });
          continue;
        }
        // Same name as someone with verified interviews: merged only with shared context (never by name alone).
        const ev = identityEvidence(u.entity, name, titlesByKey.get(key) ?? c.appearances.map((a) => a.title));
        if (!ev.length) {
          checks.push({ check: 'identity', ok: false, detail: `Same name as a person in our sources, but Qloo's description and tags share no context with their ${c.appearances.length} interview title(s): could be a namesake.`, detailEs: `Mismo nombre que una persona de nuestras fuentes, pero la descripción y etiquetas de Qloo no comparten contexto con sus ${c.appearances.length} título(s) de entrevista: podría ser un homónimo.` });
          out({ outcome: 'pending', failure: 'identity', reason: 'Identity not confirmed (possible namesake)', reasonEs: 'Identidad no confirmada (posible homónimo)' });
          continue;
        }
        checks.push({ check: 'identity', ok: true, detail: `Confirmed: ${c.appearances.length} verified interview(s); shared context: ${ev.slice(0, 4).join(', ')}.`, detailEs: `Confirmada: ${c.appearances.length} entrevista(s) verificada(s); contexto compartido: ${ev.slice(0, 4).join(', ')}.` });
        const tc = themeCheck(c, ['Their interviews', 'Sus entrevistas']);
        checks.push(tc);
        if (!tc.ok) {
          out({ outcome: 'discarded', failure: 'theme', reason: 'Verified, but off the show’s themes', reasonEs: 'Verificado, pero fuera de los temas del programa' });
          continue;
        }
        const langs = [...new Set(c.appearances.map(appLang).filter(Boolean))];
        const okLang = speaksTarget(c);
        checks.push(
          okLang
            ? { check: 'language', ok: true, detail: `Verified interview in ${acceptedLabel()}.`, detailEs: `Entrevista verificada en ${acceptedLabel()}.` }
            : { check: 'language', ok: null, detail: `Interviews in ${langs.join(', ')}; ${acceptedLabel()} not verified (not proof they cannot speak it).`, detailEs: `Entrevistas en ${langs.join(', ')}; ${acceptedLabel()} sin verificar (no prueba que no lo hable).` },
        );
        if (kind !== 'person') {
          // Identity proven by our RSS; only the kind is unknown. Ranked only after Wikidata says "human".
          out({ outcome: 'pending', failure: 'type', reason: 'Identity verified; kind to confirm (generic Qloo type)', reasonEs: 'Identidad verificada; falta confirmar el tipo (tipo genérico en Qloo)' });
          externalQueue.push({ entity: u.entity, rank: u.rank, mode: 'type', candidate: c, evidence: ev });
          continue;
        }
        admitPoolCandidate(c, u.entity.entityId, u.rank, ev);
        out({ outcome: 'ranked', reason: 'Verified: competes in the main ranking', reasonEs: 'Verificado: compite en el ranking principal' });
      }
      const f = funnelCounts();
      const dt = diagnose();
      step({
        title: ['Verify every person Qloo proposed', 'Verificar a cada persona que propuso Qloo'],
        tool: 'verify_discoveries',
        detail: [
          `${batch.length} checked: ${f.identityVerified} identity verified, ${f.noRecord} without a record in our sources, ${f.identityUnconfirmed} possible namesakes, ${f.repeats} repeats, ${f.offTheme} off-theme, ${f.notPerson} not people. ${f.ranked} enter the main ranking (${f.languageCompatible} language-compatible).`,
          `${batch.length} revisadas: ${f.identityVerified} con identidad verificada, ${f.noRecord} sin registro en nuestras fuentes, ${f.identityUnconfirmed} posibles homónimos, ${f.repeats} repetidos, ${f.offTheme} fuera de tema, ${f.notPerson} no son personas. ${f.ranked} entran al ranking principal (${f.languageCompatible} con idioma compatible).`,
        ],
        decision: [`${dt[0]} Unverifiable people stay apart as pending discoveries; nobody is promoted by Qloo's word alone.`, `${dt[1]} Las personas no verificables quedan aparte como descubrimientos pendientes; nadie sube solo por la palabra de Qloo.`],
        provenance: 'VERIFIED',
      });
    },

    verify_external: async () => {
      // Highest Qloo rank first; the verifier checks at most `maxCandidates` per run.
      const all = externalQueue.splice(0).sort((a, b) => a.rank - b.rank);
      const cap = input.verifier!.maxCandidates ?? 12;
      const queue = all.slice(0, cap);
      externalStats.queued += all.length;
      externalStats.overCap += all.length - queue.length;
      for (const q of all.slice(cap)) {
        const prop = proposals.find((x) => x.qlooEntityId === q.entity.entityId);
        if (prop) {
          prop.checks.push({ check: 'external', ok: null, detail: `Not checked: verification cap (${cap} per analysis) reached; lower Qloo rank.`, detailEs: `Sin revisar: se alcanzó el límite de verificación (${cap} por análisis); menor posición en Qloo.` });
          Object.assign(prop, { reason: `Not checked (cap of ${cap} reached)`, reasonEs: `Sin revisar (límite de ${cap} alcanzado)` });
        }
      }
      let checks: ExternalCheck[] = [];
      try {
        checks = await input.verifier!.verify(queue, { targetLang: [...accepted][0] ?? targetLang });
      } catch (err) {
        warn([`External verification failed: ${String(err)}`, `Falló la verificación externa: ${String(err)}`]);
      }
      externalStats.checked += checks.reduce((s, c) => s + c.qlooIds.length, 0);
      const modeOf = new Map(queue.map((q) => [q.entity.entityId, q]));
      const removeDiscovery = (id: string) => {
        const i = discoveries.findIndex((d) => d.qlooEntityId === id);
        if (i >= 0) discoveries.splice(i, 1);
      };
      for (const ch of checks) {
        const [primaryId, ...dupIds] = ch.qlooIds;
        const prop = proposals.find((x) => x.qlooEntityId === primaryId);
        if (!prop) continue;
        prop.external = ch;
        const item = modeOf.get(primaryId);
        if (item?.mode === 'type') {
          // Identity was proven by our RSS; Wikidata only answers "individual person or not".
          if (ch.kind === 'person') {
            prop.checks.push({ check: 'external', ok: true, detail: `Wikidata lists “${ch.name}” as a human${ch.wikidataId ? ` (${ch.wikidataId})` : ''}.`, detailEs: `Wikidata registra a “${ch.name}” como ser humano${ch.wikidataId ? ` (${ch.wikidataId})` : ''}.` });
            admitPoolCandidate(item.candidate!, primaryId, prop.qlooRank, item.evidence!);
            Object.assign(prop, { outcome: 'ranked', failure: undefined, reason: 'Verified: competes in the main ranking', reasonEs: 'Verificado: compite en el ranking principal' });
          } else if (ch.status === 'discarded') {
            prop.checks.push({ check: 'external', ok: false, detail: ch.reason, detailEs: ch.reasonEs });
            Object.assign(prop, { outcome: 'discarded', failure: 'type', reason: `Not an individual person (${ch.kind})`, reasonEs: `No es una persona individual (${ch.kind})` });
          } else {
            prop.checks.push({ check: 'external', ok: null, detail: 'No Wikidata record settles the kind: kept pending.', detailEs: 'Ningún registro de Wikidata confirma el tipo: queda pendiente.' });
            Object.assign(prop, { reason: 'Kind not confirmed', reasonEs: 'Tipo no confirmado' });
          }
          continue;
        }
        const src = ch.sources.map((s) => s.url).join(' · ');
        // Duplicate Qloo ids proven to be the same person (same Wikidata item): kept, merged into one.
        for (const id of dupIds) {
          const dup = proposals.find((x) => x.qlooEntityId === id);
          if (!dup) continue;
          Object.assign(dup, { outcome: 'discarded', failure: undefined, external: ch, reason: `Same person as Qloo #${prop.qlooRank} (Wikidata ${ch.wikidataId}): merged`, reasonEs: `Misma persona que Qloo n.º ${prop.qlooRank} (Wikidata ${ch.wikidataId}): fusionado` });
          dup.checks.push({ check: 'external', ok: true, detail: `Both Qloo ids resolve to Wikidata ${ch.wikidataId}.`, detailEs: `Ambos ids de Qloo corresponden a Wikidata ${ch.wikidataId}.` });
          removeDiscovery(id);
        }
        const d = discoveries.find((x) => x.qlooEntityId === primaryId);
        if (ch.kind !== 'person' && ch.status === 'discarded') {
          prop.checks.push({ check: 'external', ok: false, detail: `${ch.reason} ${src}`, detailEs: `${ch.reasonEs} ${src}` });
          Object.assign(prop, { outcome: 'discarded', failure: 'type', reason: `Not an individual person (${ch.kind})`, reasonEs: `No es una persona individual (${ch.kind})` });
          removeDiscovery(primaryId);
          discarded.push({ name: ch.name, reason: `Proposed by Qloo, but: ${ch.reason}`, reasonEs: `Propuesto por Qloo, pero: ${ch.reasonEs}` });
          continue;
        }
        if (ch.status !== 'documented') {
          prop.checks.push({ check: 'external', ok: null, detail: `${ch.reason}${src ? ` ${src}` : ''}`, detailEs: `${ch.reasonEs}${src ? ` ${src}` : ''}` });
          Object.assign(prop, {
            failure: ch.status === 'partial' || ch.namesakes.length ? 'identity' : 'coverage',
            reason: ch.status === 'partial' ? 'Partially verified: not enough to rank' : ch.namesakes.length ? 'Namesakes: identity not proven' : 'Not enough evidence',
            reasonEs: ch.status === 'partial' ? 'Verificado parcialmente: no alcanza para el ranking' : ch.namesakes.length ? 'Homónimos: identidad no probada' : 'Evidencia insuficiente',
          });
          if (d) d.external = ch;
          continue;
        }
        // Documented identity: placed in the show's themes from its documented background.
        prop.checks.push({ check: 'external', ok: true, detail: `${ch.reason} ${ch.identityEvidence.join('; ')}. ${src}`, detailEs: `${ch.reasonEs} ${ch.identityEvidence.join('; ')}. ${src}` });
        prop.checks.push({ check: 'identity', ok: true, detail: `Documented outside our RSS: Wikidata ${ch.wikidataId}.`, detailEs: `Documentada fuera de nuestro RSS: Wikidata ${ch.wikidataId}.` });
        // Shown and keyed under Wikidata's label ("Lex Fridman"), whatever spelling Qloo used.
        const key = nameKey(ch.canonicalName);
        if (key !== nameKey(ch.name)) prop.checks.push({ check: 'identity', ok: true, detail: `Qloo’s “${ch.name}” is Wikidata’s “${ch.canonicalName}” (${ch.wikidataId}).`, detailEs: `“${ch.name}” de Qloo es “${ch.canonicalName}” en Wikidata (${ch.wikidataId}).` });
        // The same person under another spelling (Wikidata labels/aliases): a past guest is a repeat, and
        // someone we already have in our RSS is the same candidate, never a second one.
        const variantKeys = [...new Set([...ch.names, ch.name].map(nameKey))].filter((x) => x && x !== key);
        // The canonical name itself may be a past guest (Qloo spelled it differently).
        if (pastGuests.has(key) || targetHostKeys.has(key)) variantKeys.unshift(key);
        const pastVariant = variantKeys.find((x) => pastGuests.has(x) || targetHostKeys.has(x));
        if (pastVariant) {
          const why: Bi = [`Same person as “${ch.names.find((n) => nameKey(n) === pastVariant)}”, already on ${target.name} or its host (Wikidata ${ch.wikidataId})`, `Misma persona que “${ch.names.find((n) => nameKey(n) === pastVariant)}”, que ya participó en ${target.name} o es su conductor (Wikidata ${ch.wikidataId})`];
          prop.checks.push({ check: 'repeat', ok: false, detail: why[0], detailEs: why[1] });
          Object.assign(prop, { outcome: 'discarded', failure: 'repeat', reason: why[0], reasonEs: why[1] });
          removeDiscovery(primaryId);
          continue;
        }
        // Includes the canonical key itself: never overwrite someone we already have in our RSS.
        const rssVariant = [key, ...variantKeys].map((x) => pool.get(x)).find((x): x is Candidate => Boolean(x));
        if (rssVariant) {
          // Merge only with shared context between the Wikidata record and that person's RSS interviews.
          const ctx = contextOverlap(rssVariant.name, ch.backgroundText, titlesByKey.get(rssVariant.key) ?? rssVariant.appearances.map((a) => a.title));
          if (ctx.length) {
            prop.checks.push({ check: 'identity', ok: true, detail: `Same person as “${rssVariant.name}” in our RSS (Wikidata ${ch.wikidataId} lists both spellings; shared context: ${ctx.slice(0, 3).join(', ')}).`, detailEs: `Misma persona que “${rssVariant.name}” en nuestro RSS (Wikidata ${ch.wikidataId} registra ambas grafías; contexto compartido: ${ctx.slice(0, 3).join(', ')}).` });
            const tc = themeCheck(rssVariant, ['Their interviews', 'Sus entrevistas']);
            prop.checks.push(tc);
            if (!tc.ok) {
              Object.assign(prop, { outcome: 'discarded', failure: 'theme', reason: 'Verified, but off the show’s themes', reasonEs: 'Verificado, pero fuera de los temas del programa' });
            } else {
              admitPoolCandidate(rssVariant, primaryId, prop.qlooRank, [`Wikidata ${ch.wikidataId}`, ...ctx]);
              Object.assign(prop, { outcome: 'ranked', failure: undefined, reason: `Verified as “${rssVariant.name}” (name variant): competes in the main ranking`, reasonEs: `Verificado como “${rssVariant.name}” (variante del nombre): compite en el ranking principal` });
            }
            removeDiscovery(primaryId);
            continue;
          }
        }
        if (rssVariant) {
          // Same name as someone in our RSS but no shared context: possibly a namesake, never merged or overwritten.
          prop.checks.push({ check: 'identity', ok: false, detail: `Same name as “${rssVariant.name}” in our RSS, but no shared context with their interviews: possible namesake.`, detailEs: `Mismo nombre que “${rssVariant.name}” en nuestro RSS, pero sin contexto compartido con sus entrevistas: posible homónimo.` });
          Object.assign(prop, { outcome: 'pending', failure: 'identity', reason: 'Identity not confirmed (possible namesake)', reasonEs: 'Identidad no confirmada (posible homónimo)' });
          continue;
        }
        const { vector, matched } = externalThemes(ch);
        const c: Candidate = {
          key,
          name: ch.canonicalName,
          appearances: [],
          vector,
          matched: new Map([...matched].map(([id, w]) => [id, new Set(w)])),
          source: 'qloo-external',
          qlooEntityId: primaryId,
          qlooAffinity: null,
          qlooProposedRank: prop.qlooRank,
          external: ch,
          identity: { status: 'confirmed', evidence: ch.identityEvidence },
          themeFit: cosine(vector, profile),
          momentum: 0,
          recency: 0,
          base: 0,
          score: 0,
        };
        const tc = themeCheck(c, ['Their documented description and occupations', 'Su descripción y ocupaciones documentadas']);
        prop.checks.push(tc);
        if (!tc.ok) {
          Object.assign(prop, { outcome: 'discarded', failure: 'theme', reason: 'Documented, but off the show’s themes', reasonEs: 'Documentado, pero fuera de los temas del programa' });
          removeDiscovery(primaryId);
          continue;
        }
        const okLang = speaksTarget(c);
        prop.checks.push(
          okLang
            ? { check: 'language', ok: true, detail: `Wikidata lists ${acceptedLabel()} among the languages spoken.`, detailEs: `Wikidata registra ${acceptedLabel()} entre los idiomas que habla.` }
            : { check: 'language', ok: null, detail: `Languages spoken in Wikidata: ${ch.languages.spoken.join(', ') || 'not recorded'}.`, detailEs: `Idiomas que habla según Wikidata: ${ch.languages.spoken.join(', ') || 'sin registrar'}.` },
        );
        pool.set(key, c);
        Object.assign(prop, { outcome: 'ranked', failure: undefined, reason: 'Documented outside our RSS: competes in the main ranking', reasonEs: 'Documentado fuera de nuestro RSS: compite en el ranking principal' });
        removeDiscovery(primaryId);
      }
      score(pool);
      const f = funnelCounts();
      const dt = diagnose();
      step({
        title: ['Verify the remaining proposals in independent sources', 'Verificar las propuestas restantes en fuentes independientes'],
        tool: 'wikidata + wikipedia',
        detail: [
          `${queue.length} people without interviews in our RSS checked: ${f.externalDocumented} documented, ${f.externalPartial} partially verified, ${f.externalPending} without enough evidence, ${f.typeErrors} not individual people (bands, duos, companies or works).`,
          `${queue.length} personas sin entrevistas en nuestro RSS revisadas: ${f.externalDocumented} documentadas, ${f.externalPartial} verificadas parcialmente, ${f.externalPending} sin evidencia suficiente, ${f.typeErrors} no son personas individuales (bandas, dúos, empresas u obras).`,
        ],
        decision: [`${dt[0]} Documented, on-theme people compete in the main ranking; activity and recency are not imputed for them.`, `${dt[1]} Las personas documentadas y dentro de los temas compiten en el ranking principal; no se les imputa actividad ni recencia.`],
        provenance: 'VERIFIED',
      });
    },

    profile_guests: async () => {
      const recs = [...pastGuests.entries()].map(([key, g]) => ({ name: g.name, p: people?.[key] ?? null }));
      const known = recs.filter((r) => r.p);
      const counts = new Map<OccupationCategory, Array<{ name: string; w: number }>>();
      const countries = new Map<string, number>();
      for (const r of known) {
        for (const cat of r.p!.categories) counts.set(cat, [...(counts.get(cat) ?? []), { name: r.p!.label, w: r.p!.wikipedias }]);
        for (const cc of r.p!.countries) countries.set(cc, (countries.get(cc) ?? 0) + 1);
      }
      const totalCats = [...counts.values()].reduce((s2, v) => s2 + v.length, 0);
      for (const [cat, v] of counts) catShare.set(cat, v.length / (totalCats || 1));
      const topCountry = [...countries.entries()].sort((a, b) => b[1] - a[1])[0];
      const strong = known.length >= GUEST_PROFILE_MIN && totalCats > 0;
      if (!showCountry && topCountry && known.length >= GUEST_PROFILE_MIN && topCountry[1] / known.length >= 0.5) showCountry = topCountry[0];
      audienceCountries = new Set([...(showCountry ? [showCountry] : []), ...(known.length >= GUEST_PROFILE_MIN ? [...countries.entries()].filter(([, n]) => n / known.length >= AUDIENCE_COUNTRY_SHARE).map(([cc]) => cc) : [])]);
      guestProfile = {
        resolved: known.length,
        pastGuests: pastGuests.size,
        strong,
        country: showCountry ?? topCountry?.[0] ?? null,
        countryShare: known.length && (showCountry ?? topCountry?.[0]) ? (countries.get((showCountry ?? topCountry[0])!) ?? 0) / known.length : 0,
        categories: [...counts.entries()]
          .map(([id, v]) => ({ id, share: v.length / (totalCats || 1), label: CATEGORY_LABELS[id].enPlural, labelEs: CATEGORY_LABELS[id].esPlural, examples: v.sort((a, b) => b.w - a.w).slice(0, 3).map((x) => x.name) }))
          .sort((a, b) => b.share - a.share)
          .slice(0, 6),
        themeEvidence,
        themesWeak: strong && themeEvidence < 0.25,
        gateLevel: 3,
      };
      const cats = guestProfile.categories.slice(0, 4);
      const catText: Bi = [cats.map((c) => `${c.label} ${pct(c.share)}% (e.g. ${c.examples.join(', ')})`).join('; '), cats.map((c) => `${c.labelEs} ${pct(c.share)}% (p. ej. ${c.examples.join(', ')})`).join('; ')];
      const where = guestProfile.country ? guestProfile.country.toUpperCase() : null;
      step({
        title: ['Profile who the show interviews', 'Perfilar a quién entrevista el programa'],
        tool: 'profile_guests',
        detail: [
          `${known.length} of ${pastGuests.size} past guests documented in Wikidata. ${strong ? `Kinds of guest: ${catText[0]}.` : 'Too few to describe the kind of guest.'}${where ? ` ${pct(guestProfile.countryShare)}% are citizens of ${where}, the show’s country.` : ''} ${pct(themeEvidence)}% of recent titles name a theme.`,
          `${known.length} de ${pastGuests.size} invitados anteriores documentados en Wikidata. ${strong ? `Tipos de invitado: ${catText[1]}.` : 'Son pocos para describir el tipo de invitado.'}${where ? ` El ${pct(guestProfile.countryShare)}% tiene ciudadanía de ${where}, el país del programa.` : ''} El ${pct(themeEvidence)}% de los títulos recientes nombra un tema.`,
        ],
        decision: guestProfile.themesWeak
          ? ['Titles say little about topics (mostly the guest’s name): ranking on who the show interviews, its country and how known each person is; title themes count little.', 'Los títulos dicen poco de los temas (casi siempre solo el nombre del invitado): ordeno por a quién entrevista el programa, su país y qué tan conocida es cada persona; los temas de los títulos pesan poco.']
          : strong
            ? ['Ranking on themes and on the kind of guest, preferring people known to this audience (same country, or widely known).', 'Ordeno por temas y por tipo de invitado, prefiriendo personas conocidas por esta audiencia (mismo país, o muy conocidas).']
            : ['Ranking on themes, preferring people known to this audience (same country, or widely known).', 'Ordeno por temas, prefiriendo personas conocidas por esta audiencia (mismo país, o muy conocidas).'],
        provenance: 'VERIFIED',
      });
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
      settleGate();
      const W = profileStrong() ? (themesWeak() ? AUDIENCE_WEIGHTS.profileWeakThemes : AUDIENCE_WEIGHTS.profile) : AUDIENCE_WEIGHTS.noProfile;
      step({
        title: people ? ['Score candidates by fit, audience and track record', 'Puntuar candidatos por ajuste, audiencia y trayectoria'] : ['Score candidates by topical fit and track record', 'Puntuar candidatos por ajuste temático y trayectoria'],
        tool: 'score',
        detail: people
          ? [
              `${pool.size} candidates scored: ${W.themeFit}×topical fit + ${W.typeFit}×same kind of guest + ${W.region}×same country + ${W.known}×how widely known + ${W.momentum}×momentum + ${W.recency}×recency.`,
              `${pool.size} candidatos puntuados: ${W.themeFit}×ajuste temático + ${W.typeFit}×mismo tipo de invitado + ${W.region}×mismo país + ${W.known}×qué tan conocido + ${W.momentum}×momento + ${W.recency}×recencia.`,
            ]
          : [
              `${pool.size} candidates scored: ${WEIGHTS.themeFit}×topical fit + ${WEIGHTS.momentum}×momentum + ${WEIGHTS.recency}×recency.`,
              `${pool.size} candidatos puntuados: ${WEIGHTS.themeFit}×ajuste temático + ${WEIGHTS.momentum}×momento + ${WEIGHTS.recency}×recencia.`,
            ],
        decision: people
          ? [`Eligible: ${gateText()[gateLevel][0]}${gateLevel > 0 ? ' (stricter levels left fewer than ' + k + ' candidates in the show’s language)' : ''}.`, `Elegibles: ${gateText()[gateLevel][1]}${gateLevel > 0 ? ' (los niveles más estrictos dejaban menos de ' + k + ' candidatos en el idioma del programa)' : ''}.`]
          : undefined,
        provenance: 'INFERRED',
      });
    },

    qloo_score_affinity: async () => {
      // Affinity can only reorder candidates inside the editorial band (see applyEditorialBand), so only
      // those are looked up (at most 40), plus every verified Qloo proposal, whose id is already known
      // and costs no lookup. Looking up anyone below the band would spend calls that cannot change a rank.
      const fitBases = [...pool.values()].filter((c) => (people ? pertinent(c) && audienceOk(c) : c.themeFit >= minFit)).map((c) => c.base).sort((a, b) => b - a);
      const floor = (fitBases[Math.min(k, fitBases.length) - 1] ?? 0) * (1 - EDITORIAL_BAND);
      const top = [...pool.values()].filter((c) => c.base >= floor).sort((a, b) => b.base - a.base).slice(0, 40);
      const shortlist = [...top, ...[...pool.values()].filter((c) => c.qlooProposedRank !== null && !top.includes(c))];
      // Highest editorial scores first; never more lookups than the budget leaves after the affinity call itself.
      const lookupBudget = Math.max(0, (qloo.budgetLeft?.() ?? Infinity) - 1);
      const wanted = shortlist.filter((c) => !(c.qlooProposedRank !== null && c.identity.status === 'confirmed'));
      const toLookup = wanted.slice(0, lookupBudget);
      if (toLookup.length < wanted.length)
        warn([`Qloo call budget: ${wanted.length - toLookup.length} lower-scored candidates in the band were not looked up for affinity (they keep a neutral value).`, `Presupuesto de consultas a Qloo: ${wanted.length - toLookup.length} candidatos de menor puntaje dentro de la banda no se buscaron para la afinidad (quedan con valor neutro).`]);
      const found = await Promise.all(toLookup.map((c) => qloo.searchPerson(c.name).then((hits) => ({ hits }), (err: unknown) => ({ err }))));
      const candidateErrors: string[] = [];
      toLookup.forEach((c, i) => {
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
          `${ids.length} of ${shortlist.length} candidates (the ${top.length} inside the editorial band${shortlist.length > top.length ? ` + ${shortlist.length - top.length} verified Qloo proposals` : ''}) confirmed in Qloo with context evidence; ${affinities.size} received an affinity score. The rest keep a neutral value and are marked pending verification. Candidates below the band were not looked up: affinity cannot change their rank.`,
          `${ids.length} de ${shortlist.length} candidatos (los ${top.length} dentro de la banda editorial${shortlist.length > top.length ? ` + ${shortlist.length - top.length} propuestas verificadas de Qloo` : ''}) confirmados en Qloo con evidencia de contexto; ${affinities.size} recibieron puntaje de afinidad. El resto queda con un valor neutro y marcado como pendiente de verificación. No se buscó a los candidatos debajo de la banda: la afinidad no puede cambiar su posición.`,
        ],
        decision:
          blend > 0
            ? [
                `Final score = ${1 - blend}×(topical fit, momentum, recency) + ${blend}×Qloo affinity rank, applied only within ${EDITORIAL_BAND * 100}% of the k-th best editorial score: affinity can reorder comparable candidates, never lift a less relevant one above them.`,
                `Puntaje final = ${1 - blend}×(ajuste temático, momento, recencia) + ${blend}×posición de afinidad en Qloo, aplicado solo dentro del ${EDITORIAL_BAND * 100}% del k-ésimo mejor puntaje editorial: la afinidad puede reordenar candidatos comparables, nunca subir a uno menos pertinente por encima de ellos.`,
              ]
            : ['MOCK affinities are computed to exercise the pipeline but are NOT used for ranking.', 'Las afinidades MOCK se calculan para probar el circuito, pero NO se usan en el ranking.'],
        provenance: qlooProvenance,
      });
    },

    relax_threshold: async () => {
      const before = minFit;
      const n = eligible().length;
      minFit = Math.max(0, Math.round((minFit - 0.1) * 100) / 100);
      settleGate();
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
      settleGate();
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
          `Only ${sameLanguage} verified candidates have an interview in ${acceptedLabel().toUpperCase() || 'the show’s language'}. Remaining suggestions have an unknown language for this show and are flagged.`,
          `Solo ${sameLanguage} candidatos verificados tienen una entrevista en ${acceptedLabel().toUpperCase() || 'el idioma del programa'}. El resto de las sugerencias tiene idioma desconocido para este programa y quedan marcadas.`,
        ]);
      step({
        title: ['Check language fit', 'Verificar el idioma'],
        tool: 'check_language',
        detail: [
          `${sameLanguage} of ${eligible().length} eligible candidates have a verified interview in the show’s habitual language(s) “${acceptedLabel()}”.`,
          `${sameLanguage} de ${eligible().length} candidatos elegibles tienen una entrevista verificada en el/los idioma(s) habitual(es) del programa “${acceptedLabel()}”.`,
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
      applyEditorialBand();
      const candidates = eligible()
        .filter((c) => (!languageFilter || speaksTarget(c)) && !rejected.has(c.key))
        .sort((a, b) => (speaksTarget(b) ? 1 : 0) - (speaksTarget(a) ? 1 : 0) || byRank(a, b))
        .slice(0, 60);
      while (picks.length < k && candidates.length) {
        let best = 0;
        let bestVal = -Infinity;
        candidates.forEach((c, i) => {
          // Too similar to a pick already made: same themes, or (with people data) the same kind of guest.
          const sameKind = (p: Candidate) => {
            const a = new Set(personOf(p)?.categories ?? []);
            const b = personOf(c)?.categories ?? [];
            return a.size && b.length ? b.filter((x) => a.has(x)).length / new Set([...a, ...b]).size : 0;
          };
          const redundancy = picks.length ? Math.max(...picks.map((p) => Math.max(cosine(p.vector, c.vector), sameKind(p)))) : 0;
          // Out-of-band candidates are only picked once no band member is left.
          const val = (c.inBand === false ? -1 : 0) + 0.75 * c.score - 0.25 * redundancy * c.score;
          if (val > bestVal) {
            bestVal = val;
            best = i;
          }
        });
        picks.push(candidates.splice(best, 1)[0]);
      }
      const rankedNow = [...pool.values()].filter((c) => !rejected.has(c.key)).sort(byRank);
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

    qloo_audience_profile: async () => {
      const budget = () => qloo.budgetLeft?.() ?? Infinity;
      // Picks need a Qloo id confirmed with context; the affinity step already has most of them.
      for (const c of picks) {
        if (c.qlooEntityId || budget() < 4) continue;
        const hits = await qloo.searchPerson(c.name).catch(() => [] as QlooEntity[]);
        const r = checkIdentity(hits, c.name, titlesByKey.get(c.key) ?? c.appearances.map((a) => a.title));
        if (r.status === 'confirmed') (c.qlooEntityId = r.entity.entityId), (c.identity = { status: 'confirmed', evidence: r.evidence });
      }
      const withId = picks.filter((c) => c.qlooEntityId);
      const showIds = signalIds().slice(0, 8);
      const showTags = showIds.length ? [] : tagIds().slice(0, 6);
      // Qloo answers one profile for all the signals in a call, so the show's signals go in one call
      // and each pick in its own. A single profile is read whatever id it is keyed by.
      const profile = async (entityIds: string[], tagIds: string[] = []): Promise<Demographics | null> => {
        if (!qloo.demographics || (!entityIds.length && !tagIds.length) || budget() < 1) return null;
        try {
          const m = await qloo.demographics({ entityIds, tagIds });
          const own = entityIds.length === 1 ? m.get(entityIds[0]) : undefined;
          return own ?? (m.size === 1 ? [...m.values()][0] : null);
        } catch (err) {
          warn([`Qloo demographics failed: ${String(err)}`, `Falló la consulta de demografía en Qloo: ${String(err)}`]);
          return null;
        }
      };
      const demo = new Map<string, Demographics>();
      const showProfile = await profile(showIds, showTags);
      for (const c of withId) {
        const d = await profile([c.qlooEntityId!]);
        if (d) demo.set(c.qlooEntityId!, d);
      }
      const showBlocks = showProfile ? [showProfile] : [];
      const avg = (key: 'age' | 'gender') => {
        const keys = [...new Set(showBlocks.flatMap((b) => Object.keys(b[key])))];
        return Object.fromEntries(keys.map((k) => [k, showBlocks.reduce((s2, b) => s2 + (b[key][k] ?? 0), 0) / showBlocks.length]));
      };
      if (showBlocks.length) audienceDemographics = { demographics: { age: avg('age'), gender: avg('gender') }, basis: showIds.length ? (resolved.length ? 'guests' : 'podcast') : 'tags', signals: showIds.length + showTags.length };
      const vec = (d: Demographics) => ({ ...Object.fromEntries(Object.entries(d.age).map(([k, v]) => [`a:${k}`, v])), ...Object.fromEntries(Object.entries(d.gender).map(([k, v]) => [`g:${k}`, v])) });
      const similarity = (a: Demographics, b: Demographics) => {
        const va = vec(a);
        const vb = vec(b);
        const keys = [...new Set([...Object.keys(va), ...Object.keys(vb)])];
        const dot = keys.reduce((s2, k) => s2 + (va[k] ?? 0) * (vb[k] ?? 0), 0);
        const na = Math.sqrt(keys.reduce((s2, k) => s2 + (va[k] ?? 0) ** 2, 0));
        const nb = Math.sqrt(keys.reduce((s2, k) => s2 + (vb[k] ?? 0) ** 2, 0));
        return na && nb ? (dot / (na * nb) + 1) / 2 : null;
      };
      // Popularity trend over the last 12 weeks, one call per pick while the budget allows.
      const end = d10(asOf);
      const start = d10(new Date(Date.parse(asOf) - 84 * 24 * 3600 * 1000).toISOString());
      let trends = 0;
      for (const c of withId) {
        let trend: Trend | null = null;
        if (qloo.trending && budget() >= 1 && !outOfTime()) {
          trend = await qloo.trending({ entityId: c.qlooEntityId!, type: 'urn:entity:person', start, end }).catch(() => null);
          if (trend) trends++;
        }
        const gd = demo.get(c.qlooEntityId!) ?? null;
        qlooAudienceOf.set(c.key, {
          qlooEntityId: c.qlooEntityId!,
          affinity: c.qlooAffinity,
          demographicMatch: gd && audienceDemographics ? similarity(gd, audienceDemographics.demographics) : null,
          demographics: gd,
          trend: trend?.direction ?? null,
          trendPercentile: trend?.latestPercentile ?? null,
        });
      }
      const matched = [...qlooAudienceOf.values()].filter((q) => q.demographicMatch !== null).length;
      step({
        title: ['Read each pick’s audience in Qloo', 'Leer en Qloo la audiencia de cada elegido'],
        tool: 'qloo_audience',
        detail: [
          `${withId.length} of ${picks.length} picks confirmed in Qloo. Demographic profile of the show’s audience signal: ${audienceDemographics ? `${audienceDemographics.signals} signal(s)` : 'not available'}; guests compared with it: ${matched}; 12-week popularity trend read for ${trends}.`,
          `${withId.length} de ${picks.length} elegidos confirmados en Qloo. Perfil demográfico de la señal de audiencia del programa: ${audienceDemographics ? `${audienceDemographics.signals} señal(es)` : 'no disponible'}; invitados comparados con él: ${matched}; tendencia de popularidad de 12 semanas leída para ${trends}.`,
        ],
        decision: ['Shown on each card as Qloo’s read of the guest’s audience. It explains the picks; it does not reorder them.', 'Se muestra en cada tarjeta como la lectura de Qloo sobre la audiencia del invitado. Explica las elecciones; no las reordena.'],
        provenance: 'LIVE',
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
    if (!done.has('profile_language'))
      return { tool: 'profile_language', why: ['Before looking for people: which languages does this show actually interview in?', 'Antes de buscar personas: ¿en qué idiomas entrevista realmente este programa?'] };
    if (people && !done.has('profile_guests'))
      return { tool: 'profile_guests', why: ['Titles say what a show talks about; its past guests say who it talks to. Look them up.', 'Los títulos dicen de qué habla un programa; sus invitados, con quién habla. Los reviso.'] };
    if (!signalsSettled) {
      const qlooTime = !outOfTime();
      if (qlooTime && !done.has('qloo_resolve_guests') && !done.has('qloo_find_podcast')) {
        if (pastGuests.size >= 3 && coverage >= 0.3)
          return { tool: 'qloo_resolve_guests', why: [`${pastGuests.size} named guests (${pct(coverage)}% of episodes): use them to describe the audience in Qloo.`, `${pastGuests.size} invitados con nombre (${pct(coverage)}% de los episodios): los uso para describir a la audiencia en Qloo.`] };
        return { tool: 'qloo_find_podcast', why: [`Only ${pct(coverage)}% of episodes name a guest (${pastGuests.size} people): guests cannot carry the audience signal, so I try the show itself in Qloo.`, `Solo el ${pct(coverage)}% de los episodios nombra a un invitado (${pastGuests.size} personas): los invitados no alcanzan para la señal de audiencia, así que pruebo con el propio programa en Qloo.`] };
      }
      if (qlooTime && resolved.length < 3 && !done.has('qloo_find_podcast'))
        return { tool: 'qloo_find_podcast', why: [`Replanning: only ${resolved.length} guest identities confirmed (<3). Trying the show itself as a Qloo podcast entity.`, `Replanifico: solo ${resolved.length} identidades de invitados confirmadas (<3). Pruebo con el programa como entidad de podcast en Qloo.`] };
      if (qlooTime && resolved.length < 3 && !done.has('qloo_find_theme_tags') && themes.length && !themesWeak())
        return {
          tool: 'qloo_find_theme_tags',
          why: podcastEntity
            ? ['The show entity alone is a thin signal: adding the show’s themes as Qloo tags.', 'La entidad del programa sola es una señal débil: agrego los temas del programa como etiquetas de Qloo.']
            : ['Replanning again: no reliable show entity. Mapping the show’s themes to Qloo tags.', 'Replanifico otra vez: no hay entidad confiable del programa. Traduzco los temas del programa a etiquetas de Qloo.'],
        };
      return { tool: 'settle_signals', why: outOfTime() ? ['Time budget reached for Qloo lookups: deciding with what I have.', 'Llegué al límite de tiempo para Qloo: decido con lo que tengo.'] : ['All signal strategies tried: deciding which one to use.', 'Probé todas las estrategias de señal: decido cuál usar.'] };
    }
    if (!done.has('build_pool')) return { tool: 'build_pool', why: ['Look for people with verified interviews on comparable shows.', 'Busco personas con entrevistas verificadas en programas comparables.'] };
    if (qlooUsable && input.qlooDiscovery !== false && !done.has('qloo_discover_people') && !outOfTime())
      return { tool: 'qloo_discover_people', why: ['Ask Qloo for people outside our sources with affinity to this audience.', 'Pido a Qloo personas fuera de nuestras fuentes con afinidad con esta audiencia.'] };
    if (!done.has('filter_repeats')) return { tool: 'filter_repeats', why: ['Remove anyone who already appeared on the show.', 'Saco a quien ya haya participado en el programa.'] };
    if (!done.has('score_candidates')) return { tool: 'score_candidates', why: [`${pool.size} candidates left: score them.`, `Quedan ${pool.size} candidatos: los puntúo.`] };
    if (unverified.length)
      return { tool: 'verify_discoveries', why: [`Qloo proposed ${unverified.length} people: verify identity, history, themes and language before any of them can be ranked.`, `Qloo propuso ${unverified.length} personas: verifico identidad, historial, temas e idioma antes de que puedan entrar al ranking.`] };
    if (input.verifier && externalQueue.length && !outOfTime())
      return {
        tool: 'verify_external',
        why: [
          `${externalQueue.length} Qloo proposals have no interviews in our RSS: check them in independent sources instead of dropping them.`,
          `${externalQueue.length} propuestas de Qloo no tienen entrevistas en nuestro RSS: las reviso en fuentes independientes en lugar de descartarlas.`,
        ],
      };
    // Replanning the discovery: Qloo's people could not be turned into verified candidates.
    if (qloo.mode === 'LIVE' && discoveryAttempts === 1 && rankedProposals() === 0 && !outOfTime() && (qloo.budgetLeft?.() ?? Infinity) >= 8) {
      const why = funnelDiagnosis.diagnosisText;
      const whyEs = funnelDiagnosis.diagnosisTextEs;
      if (signalStrategy === 'guests' && !done.has('qloo_find_theme_tags') && themes.length && !themesWeak())
        return { tool: 'qloo_find_theme_tags', why: [`Replanning the discovery — ${why} Trying the show’s themes as Qloo tags as a different signal.`, `Replanifico el descubrimiento — ${whyEs} Pruebo los temas del programa como etiquetas de Qloo, una señal distinta.`] };
      if (signalStrategy === 'guests' && !done.has('qloo_find_podcast'))
        return { tool: 'qloo_find_podcast', why: [`Replanning the discovery — ${why} Trying the show itself as the signal.`, `Replanifico el descubrimiento — ${whyEs} Pruebo con el propio programa como señal.`] };
      if (altPodcast || altTags.length)
        return { tool: 'qloo_discover_people', why: ['Alternative signal found: asking Qloo once more (one retry, within the call budget).', 'Encontré una señal alternativa: le pregunto a Qloo una vez más (un solo reintento, dentro del límite de consultas).'] };
    }
    if (qlooUsable && useAffinity && !done.has('qloo_score_affinity') && !outOfTime()) return { tool: 'qloo_score_affinity', why: ['Add Qloo affinity for candidates whose identity can be confirmed.', 'Agrego la afinidad de Qloo para los candidatos cuya identidad se pueda confirmar.'] };
    // Cultural hooks come last: they explain, they do not rank, so they never take budget from discovery.
    if (qlooUsable && !done.has('qloo_cross_domain') && !outOfTime()) return { tool: 'qloo_cross_domain', why: ['A usable audience signal exists: look for cultural hooks across domains.', 'Hay una señal de audiencia utilizable: busco referencias culturales en otros dominios.'] };
    // Older interviews of people this audience knows beat recent ones of people it does not: widen the
    // window before letting the "known by this audience" rule go down a level.
    if (people && gateLevel > 0 && windowMonths < 72 && !done.has('widen_window') && done.has('score_candidates'))
      return { tool: 'widen_window', why: [`Fewer than ${k} candidates from the audience’s countries in ${windowMonths} months: look further back before relaxing who counts as known.`, `Menos de ${k} candidatos de los países de su audiencia en ${windowMonths} meses: busco más atrás antes de relajar quién cuenta como conocido.`] };
    if (eligible().length < k && minFit > 0) return { tool: 'relax_threshold', why: [`Only ${eligible().length} candidates pass the topical-fit bar (need ${k}).`, `Solo ${eligible().length} candidatos superan el ajuste temático mínimo (necesito ${k}).`] };
    if (eligible().length < k && windowMonths < 72 && !done.has('widen_window')) return { tool: 'widen_window', why: [`Still ${eligible().length} eligible after relaxing: widen the time window.`, `Siguen siendo ${eligible().length} elegibles después de relajar: amplío la ventana de tiempo.`] };
    if (!done.has('check_language')) return { tool: 'check_language', why: [`Habitual language(s) “${acceptedLabel()}”: check which candidates have a verified interview in them.`, `Idioma(s) habitual(es) “${acceptedLabel()}”: reviso quién tiene una entrevista verificada en ellos.`] };
    if (!picks.length && !done.has('select_shortlist')) return { tool: 'select_shortlist', why: ['Choose a varied shortlist.', 'Elijo una lista corta variada.'] };
    if (done.has('select_shortlist') && !verified) {
      if (picksNeedReselect) return { tool: 'select_shortlist', why: [`Verification rejected ${rejected.size} pick(s): re-selecting without them.`, `La verificación rechazó ${rejected.size} elegido(s): vuelvo a elegir sin ellos.`] };
      return { tool: 'verify_shortlist', why: ['Check every pick before justifying it.', 'Controlo cada elegido antes de justificarlo.'] };
    }
    if (verified && qloo.mode === 'LIVE' && qlooUsable && qloo.demographics && picks.length && !done.has('qloo_audience_profile') && !outOfTime() && (qloo.budgetLeft?.() ?? Infinity) >= 2)
      return { tool: 'qloo_audience_profile', why: ['Picks verified: ask Qloo how each guest’s audience compares with the show’s, and who is on the rise.', 'Elegidos verificados: le pregunto a Qloo cómo se compara la audiencia de cada invitado con la del programa, y quién está en alza.'] };
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
  if (qloo.mode === 'LIVE' && discoveryAttempts > 0 && rankedProposals() === 0)
    warn([
      `Qloo did not yield any verifiable new candidate (${funnelDiagnosis.diagnosisText}) The ranking comes from verified sources only.`,
      `Qloo no aportó ningún candidato nuevo verificable (${funnelDiagnosis.diagnosisTextEs}) El ranking sale solo de fuentes verificadas.`,
    ]);
  // Ranking used by the backtest: confirmed-language candidates first; nobody removed for an unknown language.
  applyEditorialBand();
  const ranked = [...pool.values()].sort((a, b) => (languageFilter ? Number(speaksTarget(b)) - Number(speaksTarget(a)) : 0) || byRank(a, b));
  // Why each admitted Qloo discovery is (or is not) in the top k, from the same values the ranking used.
  const rankOf = new Map(ranked.map((c, i) => [c.key, i + 1]));
  const last = picks[picks.length - 1];
  const f2 = (x: number) => x.toFixed(2);
  const discoveryPositions: DiscoveryPosition[] = proposals
    .filter((p) => p.outcome === 'ranked' && pool.has(p.key))
    .map((p) => {
      const c = pool.get(p.key)!;
      const inTopK = picks.some((x) => x.key === c.key);
      const langOk = speaksTarget(c);
      let why: Bi;
      if (inTopK) why = ['In the top list.', 'En la lista principal.'];
      else if (rejected.has(c.key)) why = [`Rejected at verification: ${rejected.get(c.key)![0]}.`, `Rechazado en la verificación: ${rejected.get(c.key)![1]}.`];
      else if (!pertinent(c)) why = [`Topical fit ${f2(c.themeFit)} below the eligibility bar ${minFit}.`, `Ajuste temático ${f2(c.themeFit)} por debajo del mínimo ${minFit}.`];
      else if (languageFilter && !langOk) why = [`Language not confirmed for “${acceptedLabel()}” while at least ${k} eligible candidates have it: the shortlist is drawn from those.`, `Idioma no confirmado para “${acceptedLabel()}” mientras al menos ${k} candidatos elegibles lo tienen: la lista corta sale de ellos.`];
      else if (c.inBand === false) why = [`Editorial relevance ${f2(c.base)} is outside the band (floor ${f2(bandFloor)}): Qloo affinity cannot lift it over more relevant candidates.`, `Relevancia editorial ${f2(c.base)} fuera de la banda (piso ${f2(bandFloor)}): la afinidad de Qloo no puede subirlo por encima de candidatos más pertinentes.`];
      else if (last && c.score < last.score) {
        why = [
          `Score ${f2(c.score)} below the last pick, ${last.name} (${f2(last.score)}; editorial ${f2(last.base)} vs ${f2(c.base)}).`,
          `Puntaje ${f2(c.score)} por debajo del último elegido, ${last.name} (${f2(last.score)}; editorial ${f2(last.base)} contra ${f2(c.base)}).`,
        ];
        // Counterfactual, never used for ranking: even with maximal (unmeasured) activity and recency.
        if (c.external) {
          const ceiling = WEIGHTS.themeFit * c.themeFit + WEIGHTS.momentum + WEIGHTS.recency;
          why = ceiling < last.base
            ? [`${why[0]} Even assuming maximal activity and recency (not measured), it would reach only ${f2(ceiling)}: the gap is topical, not missing history.`, `${why[1]} Aun suponiendo actividad y recencia máximas (no medidas), llegaría solo a ${f2(ceiling)}: la brecha es temática, no de historial.`]
            : [`${why[0]} With maximal activity and recency it could reach ${f2(ceiling)}: missing history (not imputed) may be what keeps it out.`, `${why[1]} Con actividad y recencia máximas podría llegar a ${f2(ceiling)}: la falta de historial (no imputada) puede ser lo que lo deja afuera.`];
        }
      }
      else why = ['Comparable score, but left out by the diversity rule (too similar to a pick already in the list).', 'Puntaje comparable, pero quedó afuera por la regla de diversidad (demasiado parecido a alguien ya elegido).'];
      return {
        name: c.name,
        qlooRank: p.qlooRank,
        source: c.source,
        identity: c.external ? `Wikidata ${c.external.wikidataId} (${c.external.status})` : `RSS interviews: ${c.appearances.length}`,
        themeFit: c.themeFit,
        editorialRelevance: c.base,
        qlooAffinity: c.qlooAffinity,
        inBand: c.inBand !== false,
        languageConfirmed: langOk,
        eligible: !rejected.has(c.key) && pertinent(c),
        notMeasured: c.external ? ['momentum', 'recency'] : [],
        finalRank: rankOf.get(c.key) ?? 0,
        inTopK,
        reason: why[0],
        reasonEs: why[1],
      };
    })
    .sort((a, b) => a.finalRank - b.finalRank);


  currentWhy = ['Shortlist verified: write each justification only from the evidence collected.', 'Lista corta verificada: escribo cada justificación solo con la evidencia reunida.'];
  planLog.push({ tool: 'justify', why: currentWhy[0], whyEs: currentWhy[1] });
  // 9. Justify ---------------------------------------------------------------------------------
  const themeIdsInProfile = new Set(themes.map((t) => t.id));
  // Language status with its basis: declared vs title-inferred for interviews; Wikidata/Wikipedia for external people.
  const languageStatusOf = (c: Candidate, cross: boolean, langs: string[]): LanguageStatus => {
    if (c.external) {
      const ex = c.external;
      const spoken = ex.languages.spoken.filter((l) => accepted.has(l));
      if (spoken.length) return { status: 'confirmed', target: targetLang, evidenceLanguages: spoken, basis: 'wikidata', evidenceEn: `Wikidata lists “${spoken.join(', ')}” among languages spoken`, evidenceEs: `Wikidata registra “${spoken.join(', ')}” entre los idiomas que habla` };
      const art = ex.languages.articles.filter((l) => accepted.has(l));
      if (art.length) return { status: 'probable', target: targetLang, evidenceLanguages: art, basis: 'wikipedia', evidenceEn: `Wikipedia article in “${art.join(', ')}” (not proof of an interview in it)`, evidenceEs: `Artículo de Wikipedia en “${art.join(', ')}” (no prueba una entrevista en ese idioma)` };
      return { status: 'unknown', target: targetLang, evidenceLanguages: ex.languages.spoken, evidenceEn: 'No language evidence for the show’s languages', evidenceEs: 'Sin evidencia de idioma para los idiomas del programa' };
    }
    if (cross) return { status: 'unknown', target: targetLang, evidenceLanguages: langs, evidenceEn: `Verified interviews in: ${langs.join(', ')}`, evidenceEs: `Entrevistas verificadas en: ${langs.join(', ')}` };
    const a = c.appearances.find((x) => accepted.has(appLang(x) ?? ''))!;
    const hit = appLang(a)!;
    const declared = langOf.get(a.showId);
    const titleLang = detectTitleLanguage(a.title);
    const basis: LanguageStatus['basis'] = declared === hit && titleLang === hit ? 'declared+title' : declared === hit ? 'declared' : 'title';
    return { status: 'confirmed', target: targetLang, evidenceLanguages: [hit], basis, evidenceEn: `Interview in “${hit}” (${basis === 'declared+title' ? 'show language and title agree' : basis === 'declared' ? 'show’s declared language' : 'from the title'})`, evidenceEs: `Entrevista en “${hit}” (${basis === 'declared+title' ? 'coinciden idioma del programa y título' : basis === 'declared' ? 'idioma declarado del programa' : 'según el título'})` };
  };
  // Past guests of the show by what their description leads with (best documented first), to say
  // "like X and Y, who were on the show". Someone whose description names no known kind is never an example.
  const pastByCategory = new Map<OccupationCategory, Array<{ name: string; w: number }>>();
  if (people)
    for (const [key, g] of pastGuests) {
      const p = people[key];
      const cat = p ? mainCategory(p.description?.en) : null;
      // The name as the show itself wrote it (Wikidata labels are stored in Spanish first).
      if (p && cat) pastByCategory.set(cat, [...(pastByCategory.get(cat) ?? []), { name: g.name, w: p.wikipedias }]);
    }
  const audienceOf = (c: Candidate): RecommendationAudience | null => {
    const p = personOf(c);
    if (!p) return null;
    const order = guestProfile?.categories.map((x) => x.id) ?? [];
    // Text only: what the person is mainly known for, so a businessman is never called an actor.
    const lead = mainCategory(p.description?.en);
    // Only what the description itself says: without one, no "same kind of guest" claim is made.
    const shared = categoriesOf([p.description?.en ?? ''])
      .filter((cat) => catShare.has(cat))
      .sort((a, b) => Number(b === lead) - Number(a === lead) || order.indexOf(a) - order.indexOf(b));
    const similar = shared.length ? [...(pastByCategory.get(shared[0]) ?? [])].sort((a, b) => b.w - a.w).map((x) => x.name).filter((n, j, all) => all.indexOf(n) === j).slice(0, 2) : [];
    return {
      occupations: p.occupations,
      categories: p.categories,
      sharedCategories: shared,
      countries: p.countries,
      showCountry,
      sameCountry: p.countries.some((cc) => audienceCountries.has(cc)),
      matchedCountry: p.countries.find((cc) => cc === showCountry) ?? p.countries.find((cc) => audienceCountries.has(cc)) ?? null,
      sameCountryShows: sameCountryShows(c),
      wikipedias: p.wikipedias,
      similarPastGuests: similar,
      similarByCategory: Object.fromEntries(shared.map((cat) => [cat, [...(pastByCategory.get(cat) ?? [])].sort((a, b) => b.w - a.w).map((x) => x.name).filter((n, j, all) => all.indexOf(n) === j).slice(0, 2)])),
      typeFit: profileStrong() ? (c.typeFit ?? 0) : null,
      regionFit: c.regionFit ?? 0,
      known: c.known ?? 0,
      description: p.description,
      wikidataId: p.qid,
    };
  };
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
    if (c.qlooProposedRank !== null)
      rationale.push({
        text: `Proposed by Qloo (#${c.qlooProposedRank} in person insights) and verified by the agent: identity confirmed with shared context (${c.identity.evidence.slice(0, 3).join(', ')}).`,
        textEs: `Propuesto por Qloo (#${c.qlooProposedRank} en person insights) y verificado por el agente: identidad confirmada con contexto compartido (${c.identity.evidence.slice(0, 3).join(', ')}).`,
        provenance: qlooProvenance,
      });
    if (c.external) {
      const ex = c.external;
      const desc = ex.description.en ?? ex.description.es;
      rationale.push({
        text: `Identity documented outside our RSS: Wikidata ${ex.wikidataId}${desc ? ` (“${desc}”)` : ''}${ex.wikipedia ? `, Wikipedia (${ex.wikipedia.lang})` : ''}. ${ex.identityEvidence.join('; ')}.`,
        textEs: `Identidad documentada fuera de nuestro RSS: Wikidata ${ex.wikidataId}${ex.description.es ?? desc ? ` (“${ex.description.es ?? desc}”)` : ''}${ex.wikipedia ? `, Wikipedia (${ex.wikipedia.lang})` : ''}. ${ex.identityEvidence.join('; ')}.`,
        provenance: 'VERIFIED',
      });
      if (ex.occupations.length)
        rationale.push({ text: `Documented occupations: ${ex.occupations.map((o) => o.en).join(', ')}.`, textEs: `Ocupaciones documentadas: ${ex.occupations.map((o) => o.es).join(', ')}.`, provenance: 'VERIFIED' });
      rationale.push({
        text: 'No interviews in our RSS sources: activity and recency were not measured, and were not imputed. Ranked on documented topical fit (and Qloo affinity in LIVE).',
        textEs: 'Sin entrevistas en nuestras fuentes RSS: actividad y recencia no se midieron ni se imputaron. Se ordena por ajuste temático documentado (y afinidad de Qloo en LIVE).',
        provenance: 'INFERRED',
      });
      if (ex.namesakes.length)
        rationale.push({ text: `${ex.namesakes.length} namesake(s) in Wikidata were not chosen.`, textEs: `${ex.namesakes.length} homónimo(s) en Wikidata no fueron elegidos.`, provenance: 'VERIFIED' });
    }
    const crossLanguage = !speaksTarget(c);
    const langs = [...new Set(c.appearances.map((a) => appLang(a) ?? '?'))];
    if (crossLanguage && c.appearances.length)
      rationale.push({
        text: `Language to verify: verified interviews are in ${langs.join(', ')}, not in the show’s habitual ${acceptedLabel() || 'language (unknown)'}. That does not show they cannot speak it.`,
        textEs: `Idioma por verificar: sus entrevistas verificadas son en ${langs.join(', ')}, no en el idioma habitual del programa (${acceptedLabel() || 'desconocido'}). Eso no demuestra que no lo hable.`,
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
        themeFit: c.external
          ? { value: c.themeFit, weight: 1, provenance: 'INFERRED', explanation: 'Cosine similarity between the themes of their documented background (Wikidata, Wikipedia) and this show’s themes. Weight renormalized: momentum and recency are unknown.' }
          : { value: c.themeFit, weight: WEIGHTS.themeFit, provenance: 'INFERRED', explanation: 'Cosine similarity between the themes of their appearance titles and this show’s themes.' },
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
        momentum: c.external
          ? { value: null, weight: 0, provenance: 'VERIFIED', explanation: 'Not measured: no interviews in our sources (not imputed).' }
          : { value: c.momentum, weight: WEIGHTS.momentum, provenance: 'VERIFIED', explanation: 'Number of verified appearances on comparison shows in the last 24 months.' },
        recency: c.external
          ? { value: null, weight: 0, provenance: 'VERIFIED', explanation: 'Not measured: no interviews in our sources (not imputed).' }
          : { value: c.recency, weight: WEIGHTS.recency, provenance: 'VERIFIED', explanation: 'How recently they were last interviewed on a comparison show.' },
      },
      appearances,
      sharedThemes,
      conversationTopics,
      qlooEntityId: c.qlooEntityId,
      source: c.source,
      rationale,
      identity: c.identity,
      language: languageStatusOf(c, crossLanguage, langs),
      history: historyStatus,
      external: c.external ?? null,
      audience: audienceOf(c),
      qlooAudience: qlooAudienceOf.get(c.key) ?? null,
      assessment: {
        qlooProposedRank: c.qlooProposedRank,
        qlooAffinity: blend > 0 ? c.qlooAffinity : null,
        editorialRelevance: c.base,
        evidence: evidenceQuality(c.appearances, c.external),
        editorialPotential: { interviewsOnRecord: c.appearances.length, showsOnRecord: new Set(c.appearances.map((a) => a.showId)).size, documentedProfile: Boolean(c.external?.wikipedia) },
        availability: 'not_assessed',
      },
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
    guestProfile,
    audienceDemographics,
    trace,
    themes,
    pastGuestCount: pastGuests.size,
    historyEpisodeCount: history.length,
    guestCoverage: coverage,
    discoveries,
    qlooProposals: proposals,
    signalDiagnostics: sig,
    discoveryPositions,
    cutoff: last ? { name: last.name, score: last.score, editorialRelevance: last.base, themeFit: last.themeFit } : null,
    funnel: { attempts, ...funnelCounts(), ...funnelDiagnosis },
    languageProfile: langProfile,
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
