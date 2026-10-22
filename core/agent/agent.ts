// Green Room agent. A decision loop over tools (history, themes, Qloo, candidate pool, scoring),
// where each branch depends on the data it just observed. Every step is recorded in the trace.

import type { Appearance, PodcastDataset, Provenance } from '../types';
import { nameKey, sameName } from '../names';
import { THEMES, addInto, cosine, emptyVector, themesOfTitle, topThemes, type ThemeId, type ThemeVector } from '../themes';
import type { QlooAdapter, QlooEntity } from '../qloo/types';

export interface TraceStep {
  id: string;
  title: string;
  tool?: string;
  detail: string;
  decision?: string;
  provenance: Provenance;
}

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
  sharedThemes: Array<{ id: ThemeId; label: string; words: string[] }>;
  conversationTopics: string[];
  qlooEntityId: string | null;
  source: 'verified-pool' | 'qloo-person-insights';
  rationale: Array<{ text: string; provenance: Provenance }>;
}

export interface Discarded {
  name: string;
  reason: string;
  evidence?: Appearance;
}

export interface AgentResult {
  showId: string;
  showName: string;
  asOf: string;
  qlooMode: QlooAdapter['mode'];
  trace: TraceStep[];
  themes: Array<{ id: ThemeId; label: string; share: number; words: string[] }>;
  pastGuestCount: number;
  historyEpisodeCount: number;
  culturalAffinities: Array<{ type: string; entities: QlooEntity[]; provenance: Provenance }>;
  recommendations: Recommendation[];
  /** Full ranking (used by the backtest). */
  ranked: Array<{ key: string; name: string; score: number }>;
  discarded: Discarded[];
  warnings: string[];
  qlooCalls: QlooAdapter['calls'];
}

export interface AgentInput {
  target: PodcastDataset;
  others: PodcastDataset[];
  qloo: QlooAdapter;
  /** Only information published strictly before this instant is used. Defaults to now. */
  asOf?: string;
  k?: number;
}

const MONTH_MS = 30.44 * 24 * 3600 * 1000;
const WEIGHTS = { themeFit: 0.6, momentum: 0.25, recency: 0.15 };
const QLOO_BLEND = 0.5;

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
  const discarded: Discarded[] = [];
  const step = (s: Omit<TraceStep, 'id'>) => trace.push({ id: `s${trace.length + 1}`, ...s });

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
    title: 'Read the show’s public episode history',
    tool: 'load_history',
    detail: `${history.length} episodes before ${asOf.slice(0, 10)} from the official RSS feed; guest names identified in ${withGuests.length} (${Math.round(coverage * 100)}%), ${pastGuests.size} distinct guests.`,
    decision:
      coverage < 0.6
        ? 'Guest coverage is low, so the repeat-guest check may miss people. Flagging it and continuing.'
        : 'Coverage is enough to check for repeat guests reliably.',
    provenance: 'VERIFIED',
  });
  if (coverage < 0.6) warnings.push(`Only ${Math.round(coverage * 100)}% of episodes have an identified guest; some past guests may not be detected.`);

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
    title: 'Identify what the show talks about',
    tool: 'infer_themes',
    detail: themes.length
      ? `Top themes from recent titles (recency-weighted): ${themes.map((t) => `${t.label} ${Math.round(t.share * 100)}%`).join(', ')}.`
      : 'No theme keywords matched the titles.',
    decision: themes.length ? 'Using these themes to measure topical fit.' : 'Topical fit cannot be measured; ranking will lean on other signals.',
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
  if (qloo.mode === 'OFF') {
    step({ title: 'Ask Qloo about the audience’s taste', tool: 'qloo', detail: 'Qloo disabled for this run (baseline arm).', decision: 'Ranking with verified history and themes only.', provenance: 'INFERRED' });
  } else {
    for (const g of recentGuests) {
      try {
        const hits = await qloo.searchPerson(g.name);
        const match = hits.find((h) => sameName(h.name, g.name));
        if (match) resolved.push(match);
      } catch (err) {
        warnings.push(`Qloo search failed for ${g.name}: ${String(err)}`);
      }
    }
    qlooUsable = resolved.length >= 3;
    step({
      title: 'Resolve past guests in Qloo’s taste graph',
      tool: 'qloo.search',
      detail: `${resolved.length} of the ${recentGuests.length} most recent guests resolved to Qloo person entities (exact name match only).`,
      decision: qlooUsable
        ? 'Using these guests as the taste signal for the audience.'
        : 'Too few guests resolved (<3). Continuing without Qloo signals rather than guessing.',
      provenance: qlooProvenance,
    });
    if (qlooUsable) {
      const signalIds = resolved.map((r) => r.entityId);
      for (const type of ['urn:entity:artist', 'urn:entity:movie', 'urn:entity:book'] as const) {
        try {
          const entities = await qloo.categoryInsights({ signalIds, type, take: 6 });
          culturalAffinities.push({ type, entities, provenance: qloo.mode });
        } catch (err) {
          warnings.push(`Qloo ${type} insights failed: ${String(err)}`);
        }
      }
      const total = culturalAffinities.reduce((s, c) => s + c.entities.length, 0);
      step({
        title: 'Map the cross-domain taste of that audience',
        tool: 'qloo.insights (artist, movie, book)',
        detail: total ? `${total} artists, films and books with affinity to this guest list.` : 'Qloo returned no cross-domain entities for these signals.',
        decision: total ? 'Using them as conversation hooks.' : 'No cultural hooks available; explanations will rely on themes and prior appearances.',
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
    title: 'Search for candidates with a verifiable public track record',
    tool: 'search_candidate_pool',
    detail: `${pool.size} people who appeared on ${others.map((o) => o.name).join(' or ')} in the ${windowMonths} months before ${asOf.slice(0, 10)}.`,
    decision: pool.size >= k ? 'Enough candidates to rank.' : 'Pool is small; will widen the time window if needed.',
    provenance: 'VERIFIED',
  });

  if (qlooUsable) {
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
        title: 'Ask Qloo who else this audience has affinity for',
        tool: 'qloo.insights (person)',
        detail: `${people.length} people returned; ${added} new to the candidate pool.`,
        decision: people.length ? 'Adding them; they have no verified appearance on the comparison shows, so their evidence is Qloo affinity only.' : 'Nothing returned; staying with the verified pool.',
        provenance: qlooProvenance,
      });
    } catch (err) {
      warnings.push(`Qloo person insights failed: ${String(err)}`);
    }
  }

  // 5. Contrast against the show's own history -------------------------------------------------
  const filterRepeats = (p: Map<string, Candidate>) => {
    for (const [key, c] of p) {
      const past = pastGuests.get(key);
      if (past) {
        discarded.push({ name: c.name, reason: `Already a guest on ${target.name} (${past.published.slice(0, 10)})`, evidence: past });
        p.delete(key);
      } else if (targetHostKeys.has(key)) {
        discarded.push({ name: c.name, reason: `Host of ${target.name}` });
        p.delete(key);
      }
    }
  };
  filterRepeats(pool);
  step({
    title: 'Discard people who already appeared on the show',
    tool: 'check_history',
    detail: `${discarded.length} candidates removed because they were already guests (or the host).`,
    decision: discarded.length ? `Example: ${discarded[0].name} — ${discarded[0].reason}.` : 'No overlap with past guests.',
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
    for (const c of shortlist) {
      if (c.qlooEntityId) continue;
      try {
        const hits = await qloo.searchPerson(c.name);
        const match = hits.find((h) => sameName(h.name, c.name));
        if (match) c.qlooEntityId = match.entityId;
      } catch (err) {
        warnings.push(`Qloo search failed for candidate ${c.name}: ${String(err)}`);
      }
    }
    const ids = shortlist.map((c) => c.qlooEntityId).filter((x): x is string => Boolean(x));
    let affinities = new Map<string, number>();
    try {
      affinities = await qloo.affinityFor({ signalIds: resolved.map((r) => r.entityId), candidateIds: ids });
    } catch (err) {
      warnings.push(`Qloo affinity scoring failed: ${String(err)}`);
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
      title: 'Score candidates against the audience’s taste',
      tool: 'qloo.insights (filter.entities)',
      detail: `${ids.length} of the top ${shortlist.length} candidates resolved in Qloo; ${affinities.size} received an affinity score.`,
      decision:
        blend > 0
          ? `Final score = ${1 - blend}×(topical fit, momentum, recency) + ${blend}×Qloo affinity rank.`
          : 'MOCK affinities are computed to exercise the pipeline but are NOT used for ranking.',
      provenance: qlooProvenance,
    });
  }

  // 7. Threshold loop: relax requirements only when the data forces it --------------------------
  let minFit = 0.35;
  const eligible = () => [...pool.values()].filter((c) => c.themeFit >= minFit || c.source === 'qloo-person-insights');
  while (eligible().length < k && minFit > 0) {
    const before = minFit;
    minFit = Math.max(0, Math.round((minFit - 0.1) * 100) / 100);
    step({ title: 'Too few candidates fit the show’s themes', tool: 'relax_threshold', detail: `Only ${eligible().length} candidates at topical fit ≥ ${before}.`, decision: `Lowering the minimum topical fit to ${minFit}.`, provenance: 'INFERRED' });
  }
  if (eligible().length < k && windowMonths < 72) {
    windowMonths = 72;
    const widened = buildPool(windowMonths);
    for (const [key, c] of widened) if (!pool.has(key)) pool.set(key, c);
    filterRepeats(pool);
    score(pool);
    step({ title: 'Widen the search window', tool: 'search_candidate_pool', detail: `Pool now ${pool.size} people across ${windowMonths} months.`, decision: 'Re-scored with the larger pool.', provenance: 'VERIFIED' });
  }

  // Language: prefer candidates with a verified appearance in the show's language.
  const targetLang = target.language;
  const langOf = new Map(others.map((o) => [o.id, o.language]));
  const speaksTarget = (c: Candidate) => c.source === 'qloo-person-insights' || c.appearances.some((a) => langOf.get(a.showId) === targetLang);
  const sameLanguage = eligible().filter(speaksTarget).length;
  let languageFilter = false;
  if (sameLanguage >= k) {
    languageFilter = true;
    step({ title: 'Check language fit', tool: 'check_language', detail: `${sameLanguage} eligible candidates have a verified appearance on a "${targetLang}" show.`, decision: 'Keeping only same-language candidates.', provenance: 'INFERRED' });
  } else {
    warnings.push(`Only ${sameLanguage} verified candidates appeared on a ${targetLang.toUpperCase()}-language show. Remaining suggestions are cross-language; in-language candidates need Qloo person insights (live API).`);
    step({ title: 'Check language fit', tool: 'check_language', detail: `Only ${sameLanguage} of ${eligible().length} eligible candidates have a verified appearance in "${targetLang}".`, decision: 'Not enough same-language candidates: allowing cross-language suggestions and flagging each one.', provenance: 'INFERRED' });
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
    title: 'Pick a varied shortlist',
    tool: 'select_shortlist',
    detail: `Selected ${picks.length} of ${eligible().length} eligible candidates.`,
    decision: reordered ? 'Swapped near-duplicate profiles for more varied ones (diversity re-ranking).' : 'Top-scored candidates were already varied.',
    provenance: 'INFERRED',
  });

  // 9. Justify ---------------------------------------------------------------------------------
  const themeIdsInProfile = new Set(themes.map((t) => t.id));
  const recommendations: Recommendation[] = picks.map((c, i) => {
    const sharedThemes = [...c.matched.entries()]
      .filter(([id]) => themeIdsInProfile.has(id))
      .map(([id, words]) => ({ id, label: THEMES[id].label, words: [...words].slice(0, 4) }));
    const appearances = c.appearances.sort((a, b) => b.published.localeCompare(a.published));
    const conversationTopics = [...new Set(appearances.slice(0, 3).map((a) => topicPhrase(a.title, c.name)).filter(Boolean))];
    const rationale: Recommendation['rationale'] = [];
    if (appearances.length) {
      const a = appearances[0];
      rationale.push({ text: `Appeared on ${a.showName} on ${a.published.slice(0, 10)}: “${a.title}”.`, provenance: 'VERIFIED' });
      if (appearances.length > 1) rationale.push({ text: `${appearances.length} verified appearances on comparison shows in the search window.`, provenance: 'VERIFIED' });
    }
    rationale.push({ text: `Not found among ${pastGuests.size} past guests of ${target.name}.`, provenance: 'VERIFIED' });
    if (sharedThemes.length) rationale.push({ text: `Shares the show’s themes: ${sharedThemes.map((s) => s.label).join(', ')}.`, provenance: 'INFERRED' });
    if (c.qlooAffinity !== null) {
      rationale.push({
        text: qloo.mode === 'MOCK' ? 'Qloo affinity score is SIMULATED (no API key yet) and must not be read as evidence.' : `Qloo affinity rank ${Math.round(c.qlooAffinity * 100)}/100 within the shortlist.`,
        provenance: qloo.mode === 'MOCK' ? 'MOCK' : 'LIVE',
      });
    }
    const crossLanguage = !speaksTarget(c);
    if (crossLanguage && c.appearances.length) rationale.push({ text: `Cross-language suggestion: known appearances are not in “${targetLang}”.`, provenance: 'INFERRED' });
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
    title: 'Explain every recommendation with its evidence',
    tool: 'justify',
    detail: `${recommendations.length} recommendations, each with sources and provenance labels.`,
    decision: qloo.mode === 'MOCK' ? 'Qloo values are labeled MOCK and excluded from any claim.' : 'Done.',
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
    qlooCalls: qloo.calls,
  };
}
