# LIVE engine fix: background jobs, Qloo rate limiting and a call plan that fits

Inputs:
- the production test of 2026-10-23, as summarized in the task (the report file itself was not available in this environment);
- draft PR #1 (`fix/public-live-budgeted-discovery`);
- the code at `c27b28d`.

The benchmark uses a **simulated** Qloo (`scripts/live-engine-bench.ts`). It measures our engine, not Qloo.

## 1. Diagnosis

### Facts (reproduced or read in the code)
1. **The call plan did not fit the budget.** At `c27b28d` one analysis asked for about 80 Qloo calls. The public cap was 60.
   - Measured with `scripts/live-engine-bench.ts` and with a scripted adapter:

     | Step | Calls |
     |---|---|
     | Past guests, all looked up, concurrently | 25 |
     | Podcast | 1–3 |
     | Theme tags | 6 |
     | Cultural hooks | 3 |
     | Discovery | 1 |
     | **Identity lookups for affinity on the top 40 pool candidates** | **40** |
     | Affinity | 1 |

   - Every run exhausted the cap, so later calls failed with `budget` errors and the result was `partial`.
   - Partial results were never cached, so every visitor paid again. This matches "60 calls, no cacheable result".
2. **Most of those lookups could not change anything.** Affinity is applied only inside the editorial band (15 % of the 5th-best score). The 40 lookups covered candidates far below it.
3. **Bursts caused the 429s.** Up to 4–6 requests fired at once, and the 25 guest lookups were issued together.
   - On 429 only the failing request waited, at most 2 s; the others kept firing.
   - In the simulation at 5 req/s, develop produces 12–13 × 429 per analysis; at 2 req/s, 21–23. Production saw 17 × 429 and 2 timeouts.
   - Every retry counts as a call, so retries also drained the budget.
4. **The synchronous HTTP function cannot hold the analysis.**
   - Netlify documents a 60 s synchronous limit; production failed at 30 s on DOAC.
   - The analysis is Qloo plus Wikidata/Wikipedia verification of up to 12 proposals plus the baseline run plus profile lookups.
   - At realistic latencies Qloo alone takes 30–45 s when paced (simulation below).
5. **Qloo candidates in the final list.** Measured on DOAC with real Wikidata fixtures (Phase 8): the proposals that pass verification score below the 5th pick on topical evidence. Yang, Biden and Schultz would stay below even with maximal activity and recency.
   - Nothing in this fix changes the ranking rules: no weight, band or eligibility change.
   - Affinity now actually runs, where before it was often cut by the budget.

### Hypotheses (not verifiable here)
- **The 30 s cut-off.** It may come from the function's effective timeout on this site or plan, or from Netlify's edge. Either way, waiting synchronously is the wrong shape.
- **Qloo's real rate limit is not documented in what we have.** The pacing (≤ 4 req/s, adaptive) is conservative. It must be checked LIVE: `qlooMetrics.statuses[429]` and `retries`.
- **Language.** For Spanish-language shows, most Qloo proposals are English-speaking public figures. They are held back by the language rule (no evidence they interview in Spanish), which we consider correct.
  - Wikidata's P1412 coverage is incomplete (Dan Price), which can also hold back English-speaking proposals.
  - We did not add new language evidence without data showing it is reliable.

## 2. Architecture chosen
1. **Background jobs for the public path.**
   - `/api/discover` reserves the budget, writes a job to Netlify Blobs, starts `discover-run-background` (up to 15 min) and returns `202 {jobId}`. The browser polls.
   - The job is claimed with compare-and-swap, so Netlify's retries and repeated POSTs are harmless.
   - A second visitor asking for the same show joins the running job.
   - A job that never starts is reported as `stalled`.
2. **A rate-aware Qloo client.**
   - 250 ms between request starts; 3 in flight, halved on every 429 and raised back after successes.
   - A shared cool-down that honors Retry-After (up to 15 s); 429s are retried up to 3 times, every attempt counted.
   - `budgetLeft()` lets the agent plan.
3. **A call plan that keeps Qloo's value inside the budget.**
   - **Guests:** looked up in waves of 5, most recent first, stopping at 10 confirmed identities. Hard shows like CREATIVO still try all 25.
   - **Affinity:** looked up only for candidates inside the editorial band, the only ones it can reorder, plus every verified Qloo proposal at no extra lookup.
   - **Cultural hooks (artists, films, books):** these only explain, they don't rank, so they run last. They are skipped, and the trace says so, when the budget is short.
   - **Second discovery round:** only if the budget covers it.
4. **Honest health.**
   - "Partial" now means answers were really lost after retries; a 429 that was retried and answered is not a loss.
   - Partial results are cached for 1 h and labeled. Complete ones are cached for 24 h.
5. **Visible discoveries.** A "New people Qloo found (verified, on-theme)" list shows admitted proposals with no interviews in our corpus: their Qloo rank, topical fit, real position and the reason they are not in the top five. Nobody is moved into the top five.

## 3. Alternatives considered and set aside
- **PR #1 (reduce work to fit 30 s).** Not merged. In the same simulation it finishes in about 1.3 s with 7 calls and no 429s. It achieves that by:
  - looking up only 6 guests (CREATIVO confirmed 1 of 25 in production, so 6 rarely gives a signal);
  - 3 tag queries;
  - turning off affinity and cultural hooks;
  - verifying only 4 proposals;
  - retries 0 and 2.5 s timeouts, so any 429 becomes a lost answer.

  It also gives the agent a 20 s soft deadline, not a hard one. It trades away most of what Qloo adds to stay inside a limit that the background job removes.
  - Its useful idea (do discovery before optional enrichment) is kept here, without dropping the enrichment.
- **Splitting the analysis across several synchronous requests driven by the browser.** Rejected: more state to carry, still bounded by each request's limit, and fragile if the tab closes.
- **Precomputing every catalog show on a schedule.** Possible later for the catalog. It does not cover open search, and it spends budget on shows nobody asked for.
- **Raising the per-analysis cap to fit the old plan (≈ 80 calls).** Rejected alone: it would have hidden the 40 useless lookups and kept the bursts.

## 4. Benchmark (simulated Qloo; `scripts/live-engine-bench.ts`)
The simulated Qloo is a token bucket with Retry-After: 1 s.

**Scenario A:** 5 req/s, burst 5, 250 ms latency.
| Engine | DOAC | Marco Regil | CREATIVO |
|---|---|---|---|
| develop `c27b28d` | 60 calls, 12 × 429, budget exhausted, partial, 9 s | 60, 12 × 429, partial, 10 s | 60, 13 × 429, partial, 10 s |
| PR #1 | 7 calls, ok, 1.3 s; no affinity, no hooks | 7, ok, 1.2 s; idem | 7, ok, 1.2 s; idem |
| this branch | 40 calls, 0 × 429, ok, 10 s; discovery + affinity + hooks | 52, 0 × 429, ok, 13 s | 59, 0 × 429, ok, 15 s |

**Scenario B:** 2 req/s, burst 2, 800 ms latency.
| Engine | DOAC | Marco Regil | CREATIVO |
|---|---|---|---|
| develop `c27b28d` | 60 calls, 23 × 429, partial, 24 s | 60, 22 × 429, partial, 24 s | 60, 21 × 429, partial, 24 s |
| this branch | 43 calls, 3 × 429 retried, 0 lost, ok, 30 s | 55, 3 × 429, 0 lost, ok, 39 s | 62, 3 × 429, 0 lost, ok, 45 s |

- Scenario B is beyond a 30 s synchronous request, which is why the job runs in the background.
- Elapsed times exclude Wikidata/Wikipedia verification. That is set to 24 proposals in the background job, against 12 before.

Reproduce:
```
npx tsx scripts/live-engine-bench.ts current .
git worktree add /tmp/dev c27b28d && ln -s $PWD/node_modules /tmp/dev/node_modules && npx tsx scripts/live-engine-bench.ts develop-c27b28d /tmp/dev
SIM_RPS=2 SIM_BURST=2 SIM_LATENCY_MS=800 npx tsx scripts/live-engine-bench.ts current .
```

## 5. Pending risks
- **No LIVE run here.** Qloo's real rate limit, latency and answers are unverified. Required next:
  - a private LIVE run of the background path on a deploy preview;
  - the evidence to record: `qlooMetrics`, 429s, total time, health, cache hit.
- **Background functions on this site** (plan, the `-background` naming, Blobs access from them) are unverified until that preview.
  - A known Netlify CLI issue affects `config.background`. This uses the filename suffix instead.
- **Editorial value is still unmeasured.** The blind evaluation set (`editorial` on `/api/live`) needs raters.
