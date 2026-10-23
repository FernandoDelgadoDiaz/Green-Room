# Should Green Room add a language model? (evaluation, 2026-10-23)

## Today
The agent loop is real, but its planner is **rule-based and deterministic**: Green Room's own rules choose each next tool from the observed state, and the trace says so. No LLM is used, so nothing costs money and the ranking is auditable.

## What an LLM would improve
| Decision | Rule planner today | With an LLM |
|---|---|---|
| Which audience-signal strategy to try next | Fixed order: guests → show entity → theme tags | Could pick the query wording, for example tag phrases in the show's language |
| Theme → Qloo tag queries | Two frequent words per theme, exact tag-name match | Better candidate phrases; the exact-match rule should stay |
| Explanations and invitation drafts | Templates filled with evidence | More natural text. Every sentence must cite an evidence id; a validator drops the rest |
| Ranking | Deterministic formula | **Keep deterministic**, so results stay auditable and comparable |

## Estimated cost per analysis
Assumptions: 1 planner call plus 1 explainer call, about 8,000 input and 2,000 output tokens in total. These are estimates, not measurements.

| Model (official price page, read 2026-10-23) | Input / output per million tokens | Per analysis | 1,000 analyses |
|---|---|---|---|
| Claude Haiku 5.5 | $0.10 / $0.50 (prompts up to 100k tokens) | ≈ $0.002 | ≈ $2 |
| Claude Sonnet 5.5 | $2 / $10 | ≈ $0.036 | ≈ $36 |

- OpenAI's pricing page lists models at $0.10/$0.50 and $10/$50 per million tokens. Our extraction did not capture the model names, so no OpenAI model is named here. Check the page before choosing.
- **There is no free option** for a hosted backend. Local models cannot run inside Netlify Functions. The Qloo harness's `qloo explore` uses your own model sign-in for interactive use only.

## Recommendation
- Do not add an LLM to the ranking.
- If you authorize a paid API, add only the explainer (Haiku-class, ≈ $0.002 per analysis), behind the existing evidence validator, with the template text as fallback.
- Judges will see "real agent loop + optional LLM explanations", which is accurate.
- **Nothing is activated.** It needs your authorization and an API account with billing.
