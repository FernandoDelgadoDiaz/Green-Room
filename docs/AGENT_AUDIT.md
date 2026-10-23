# Agent audit (2026-10-23, updated after the live Qloo tests)

Question: which decisions does Green Room really take from data, and which are fixed rules?

## Short answer
Green Room is a **deterministic pipeline with data-dependent branches**. The order of the tools never changes, every threshold is a constant, and no component plans, reasons or uses a language model. Calling it an "agent" is fair only in a narrow sense: it observes the data and takes different branches, and it records why in the trace. Hackathon judges looking for an agentic system could reasonably see it as a script.

## Fixed rules (constants in code)
| What | Value | Where |
|---|---|---|
| Score weights | topical fit 0.6, momentum 0.25, recency 0.15 | `core/agent/agent.ts` WEIGHTS |
| Qloo blend | 0.5 (LIVE only; MOCK weight 0) | QLOO_BLEND |
| Taste signal | 25 most recent guests; Qloo used only if ≥ 3 resolve | step 3 |
| Candidate window | 36 months, widened once to 72 | step 4 / 7 |
| Topical fit threshold | starts at 0.35, lowered 0.1 at a time | step 7 |
| Shortlist scored in Qloo | top 40 by base score | step 6 |
| Diversity (MMR) | 0.75 × score − 0.25 × redundancy | step 8 |
| Themes | 10 hand-written keyword lists | `core/themes.ts` |
| Guest extraction | per-feed regular expressions + 3 manual overrides | `core/extract.ts` |
| Identity | unique exact canonical-name match | `core/qloo/resolve.ts` |

## Decisions that depend on the data (all deterministic `if` branches)
1. Use Qloo signals, or continue without them (fewer than 3 guests resolved).
2. Add Qloo-discovered people to the pool (LIVE, when person insights return anything).
3. Lower the topical-fit threshold, and/or widen the window, when fewer than k candidates qualify.
4. Keep only same-language candidates, or allow cross-language ones and flag each.
5. Swap near-duplicate profiles in the final 5 (MMR).
6. Discard repeat guests and the host.

## Weak points found in this audit
- **Score scales for Qloo-discovered people.** A person who comes only from Qloo has base 0. Their score is 0.5 × the *raw* Qloo affinity, while verified candidates are scored with a *rank-normalized* affinity, so the two scales differ. These people also skip the topical-fit threshold. Left unchanged until live data shows their real scale; the T5 main arm turns discovery off for this reason.
- **Neutral 0.5 for people Qloo cannot score.** This avoids penalizing coverage gaps, but with low coverage the blend mostly reshuffles the people Qloo does know.
- **Fixed weights.** Nothing was fit to data, and they should not be tuned on the same backtest used to report results.

## Minimal language-model addition (proposal, not activated)
Goal: real planning and better explanations, without letting a model invent facts or touch the measured ranking.

1. **Planner, one call per run.**
   - Input: the show summary (themes, guest coverage, language), the list of tools (resolve guests, Qloo person insights, Qloo rank, cross-domain hooks, widen window, language check) and a call budget.
   - Output: a JSON plan.
   - Code validates the plan against a schema and runs it. An invalid plan falls back to the current pipeline.
   - The planner chooses *which* tools run and in what order. It never sets scores.
2. **Explainer, one call per run.**
   - Writes "why we recommend them" and the invitation draft only from evidence objects (appearances, themes, Qloo results), each with an id.
   - A validator drops any sentence without an evidence id, or with a name, number or title that is not in the evidence.
3. **The ranking stays deterministic**, so the backtest remains comparable and auditable.

Provider options and cost:
- The official harness supports a model only through the interactive `qloo explore`. That route is not meant for an app backend.
- A backend needs a model API (Anthropic or OpenAI). That is pay-per-use.
- **Not activated. It requires your authorization and a cost estimate from the provider's current price list first.**

## Update after the live tests and the Phase 4 fixes
Facts:
- The user reported the outcome of the live T2/T4/T5 runs: Qloo finds new candidates, but it did not improve historical hits.
- The written report (Green-Room-pruebas-Qloo.md) was not available in this environment, so this audit cites no figures from it.

Changes made in Phase 4. They are rule changes, still deterministic:
- **Identity.** A Qloo entity counts as the guest only with an exact, unique name **and** shared context between Qloo's description/tags and the guest's own interview titles. Everything else is "pending verification". This applies to the taste signals and to the candidates that get scored. Names are never merged by name alone.
- **Language.** Confirmed only by a verified interview in the show's language. Probable when an identity-checked Wikipedia article exists in that language. Unknown otherwise. Unknown candidates are no longer removed from the ranking, and Qloo-proposed people are no longer assumed to speak the show's language.
- **History.** "Never a guest" is no longer claimed when part of the feed has no guest names. The card shows the coverage.
- **Discovery.** Qloo-proposed people are kept apart as *discoveries pending verification*. They no longer enter the verified ranking, which also removes the score-scale mismatch noted above. Consequence: the exploratory "+discovery" backtest arm is now identical to the "with Qloo" arm.

## Does it meet the "agentic" bar? Critical view
No, not convincingly. The system observes data and branches, but:
- the **goal never changes the plan**: the tool order is fixed;
- **no step chooses its next tool** from what it just learned, beyond fixed if/else thresholds;
- **nothing is re-planned after a failure**: for example, low Qloo identity coverage does not lead it to try other signals such as podcast entities or tags;
- there is **no reasoning in natural language** over the evidence.

Judges of an agentic hackathon will most likely read it as a well-documented pipeline.

## Minimal improvement proposed (not activated; no paid service)
1. **A tool-calling loop, with the planner behind an interface.**
   - Expose the existing steps as tools with typed inputs and outputs:
     - `read_history`, `infer_themes`, `resolve_identity`;
     - `qloo_person_insights`, `qloo_podcast_entities`, `qloo_tags_for_themes`;
     - `score_candidates`, `check_language`, `select_shortlist`, `draft_invitation`.
   - The loop asks a planner for the next tool given the goal, the observations so far and the remaining call budget, and stops on "done", on the budget or on the deadline.
   - Ship two planners:
     - **RulePlanner**, deterministic. It reproduces today's behavior and adds one real re-plan: if fewer than 3 identities are confirmed, try Qloo podcast entities or theme tags as the taste signal instead of giving up.
     - **LLMPlanner**, behind the same interface. It is off until you authorize a model provider.
2. **Explainer.** An LLM writes the "why" from evidence objects only. A validator drops any sentence without an evidence id. Off until authorized; today's template text stays as the fallback.
3. **The ranking stays deterministic**, so every evaluation remains comparable.

Free routes:
- Step 1 with the RulePlanner costs nothing and makes the agentic structure real.
- A model call needs your authorization. The official Qloo harness's `qloo explore` uses your own model sign-in for interactive use only; it is not a backend route.
