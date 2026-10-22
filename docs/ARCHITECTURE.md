# Architecture

```
Browser (React + Tailwind, src/)            no secrets, no Qloo client
   │  POST /api/agent {action}
   ▼
Netlify Function (netlify/functions/agent.ts)  ─┐  same handler in dev via a Vite middleware
core/api.ts  handleApi()                        ─┘  (vite.config.ts), so the key stays server-side
   │
   ├── core/agent/agent.ts      decision loop + trace
   ├── core/backtest.ts         cutoff/hidden-future evaluation + leakage audit
   ├── core/themes.ts           bilingual theme lexicon (INFERRED)
   ├── core/extract.ts          deterministic guest extraction from RSS titles
   ├── core/pitch.ts            evidence-only interview proposal
   └── core/qloo/
         types.ts               QlooAdapter interface (mode: LIVE | MOCK | OFF)
         client.ts              LIVE: hackathon.api.qloo.com, X-Api-Key, GET, tolerant parser
         mock.ts                MOCK: never invents entities; pseudo-affinities with weight 0
                                OFF: no-op (the "without Qloo" arm)
data/podcasts/*.json            derived datasets (scripts/build-dataset.ts)
```

## Agent loop (core/agent/agent.ts)

| Step | Tool | Branch taken from observed data |
|---|---|---|
| 1 | `load_history` | Guest coverage < 60% → warn that the repeat-guest check is weaker |
| 2 | `infer_themes` | No themes → topical fit can't be used |
| 3 | `qloo.search` | < 3 past guests resolved → continue without Qloo instead of guessing |
| 4 | `qloo.insights` (artist/movie/book) | Empty → explanations fall back to themes |
| 5 | `search_candidate_pool` | Verified people from comparison shows inside a 36-month window |
| 6 | `qloo.insights` (person, exclude past guests) | Adds Qloo-only candidates (LIVE) |
| 7 | `check_history` | Removes repeat guests and hosts, with the episode as evidence |
| 8 | `qloo.insights` (filter.entities) | LIVE: blend 50/50 with the base score. MOCK: weight 0 |
| 9 | `relax_threshold` / widen window | Fewer than k candidates → lower the fit threshold, then widen to 72 months |
| 10 | `check_language` | ≥ k same-language candidates → keep only those; otherwise flag every cross-language pick |
| 11 | `select_shortlist` | MMR diversity re-ranking |
| 12 | `justify` | Rationale lines, each with a provenance label |

Base score = 0.6 × topical fit + 0.25 × momentum + 0.15 × recency. In LIVE mode the final score = 0.5 × base + 0.5 × Qloo affinity rank. Candidates Qloo cannot score get a neutral 0.5.

There is no LLM in the loop yet. The decisions are deterministic and depend on the data. An LLM can later replace the template proposal and the theme lexicon, but it is not needed to make the decisions real.

## Backtest (core/backtest.ts)

- History = target episodes with `published < cutoff`.
- Pool = comparison-show appearances with `published < cutoff`.
- Hidden = first-time guests of the target in `[cutoff, cutoff + horizon)`, excluding re-uploads.
- Arms: OFF (without Qloo) and the configured adapter. MOCK arms are marked `isEvidence: false`.
- Leakage audit: the maximum dates of history and pool must be before the cutoff, and no recommendation may cite a later appearance.

## Security

- `QLOO_API_KEY` is read only in `netlify/functions/agent.ts`, `vite.config.ts` (server middleware) and `scripts/`.
- `tests/security.test.ts` fails if browser code references the key or the live client.
- Qloo responses are never written to the repository (developer guide rule). The smoke script prints only shapes and counts.
