# Public Qloo LIVE (`/api/discover`)

A visitor searches for a podcast, picks it, and gets recommendations built with the **real Qloo API**. No token is needed. The key stays in the Netlify Function.

**Status on 2026-10-23:**
- The code is deployed and the switch is **off** (`QLOO_PUBLIC_ENABLED` is unset).
- It has not been validated against the real Qloo API yet. See "Before switching it on".

## Endpoints
| Endpoint | Qloo | Who | What it accepts |
|---|---|---|---|
| `/api/agent` | always MOCK | public | catalog, shows, recommend, backtest (unchanged) |
| `/api/podcasts` | always MOCK | public | open search, link resolution, MOCK analysis (unchanged) |
| `/api/discover` | **LIVE**, inside the limits below | public | only `status`, `recommend {showId}`, `analyze {appleId}` and `job {jobId}` |
| `/api/discover-run` | runs a queued job | background function | a job id; only a job still `queued` in Blobs runs, once |
| `/api/live` | LIVE | private token | diagnostics, A/B/C/D `compare`, `editorial`, and the public-path controls |

- Any other action sent to `/api/discover` gets a 400. That includes `compare`, `editorial`, `diagnose` and the controls.
- `/api/discover` reads its own switch. `QLOO_LIVE_ENABLED` (private tests) does not turn it on.

## How a public analysis runs
1. `POST /api/discover {recommend|analyze}`.
   - A fresh cached result comes back at once (200).
   - Otherwise the guard reserves the budget, a job is written to Blobs, the background function is started, and the answer is `202 {jobId}`.
2. `discover-run-background` claims the job with compare-and-swap (queued → running), runs the analysis, settles the reservation, caches the result and writes the outcome.
   - It never throws, so Netlify's automatic retries are no-ops.
3. The browser polls `POST /api/discover {job, jobId}` every 3 s.
   - A job queued for more than 90 s, or running past its lease, is reported as `stalled`. Nothing is substituted.

Design and evidence: `docs/LIVE_ENGINE_FIX.md`.

## What can be analyzed
1. **The catalog shows.** These are the 20 curated datasets listed by `status.scope.catalog`.
2. **Any show in Apple's podcast directory**, found through the open search.
   - The client sends only the `appleId`. The server looks up the feed URL in Apple's directory, so it is never taken from the client.
   - The feed is fetched through the SSRF-safe client: https only, public addresses only, re-checked redirects, size and time caps.
   - It must parse as RSS with enough dated interviews.
   - Its title must match Apple's entry for that `appleId` (`feed_mismatch` otherwise).
   - A show that is already in the catalog uses its curated dataset.
3. **Links with no Apple entry** (RSS-only, or Spotify/YouTube titles not found in Apple) are not analyzed with Qloo LIVE. The UI says why and offers the MOCK demo explicitly.

## How consumption is protected
All counters live in **one document per UTC day** in Netlify Blobs (store `public-live`, strong consistency). They are updated with ETag compare-and-swap, so they hold across every function instance. None of these limits is per-instance memory.

| Limit | Variable | Default | How it holds |
|---|---|---|---|
| Qloo calls per UTC day (hard ceiling) | `PUBLIC_DAILY_QLOO_CALLS` | 400 | A fresh analysis first reserves its worst case. It runs only if `spent + in-flight reservations + cap ≤ ceiling`. |
| Qloo calls per analysis | `PUBLIC_CALLS_PER_ANALYSIS` | 80 | Enforced by the adapter (`maxCalls`, retries included); the agent skips optional steps before reaching it. After the run, the reservation is settled to the real count. |
| Simultaneous analyses | `PUBLIC_MAX_CONCURRENT` | 2 | Leases that expire after `PUBLIC_JOB_MAX_SECONDS` + 60 s. An unsettled lease (crash) expires and counts its **whole** reservation as spent. A second visitor asking for a show already being analyzed joins that job (no new reservation). |
| Fresh analyses per visitor per day | `PUBLIC_FRESH_PER_IP_PER_DAY` | 3 | Keyed by a salted SHA-256 of IP and day. Raw IPs are never stored. |
| New open-search feeds per day | `PUBLIC_OPEN_FEEDS_PER_DAY` | 10 | A separate counter, so the catalog stays available. |
| Result cache | `PUBLIC_CACHE_HOURS` / `PUBLIC_PARTIAL_CACHE_HOURS` | 24 h / 1 h | A cache hit costs 0 Qloo calls. Results that lost Qloo answers (after retries) are cached for 1 h and labeled partial. |
| Burst limit | function `config.rateLimit` | 40 / 60 s per IP | Netlify edge rate limit (polling a job is one request every 3 s). |
| Time | `PUBLIC_JOB_MAX_SECONDS` | 240 s per analysis (Qloo deadline 180 s), 10 s per call | Runs in a background function (15 min limit), not in the HTTP request. |
| Qloo rate | — | 250 ms between request starts, 3 in flight, adaptive | On 429 every request backs off (Retry-After honored, up to 15 s), concurrency is halved; up to 3 retries, each counted. |

**Worst case.** The public path can never spend more than `PUBLIC_DAILY_QLOO_CALLS` Qloo calls in a UTC day. With the defaults that is 400 calls: at most 5 fresh analyses a day at the 80-call cap (more when analyses settle below it); cached shows are unlimited.

**Fail closed.** If the Blobs store cannot be read or written, no Qloo call is made. The visitor sees `guard_unavailable`.

## Emergency off
- **Instant, no redeploy.** `POST /api/live {"action":"public-pause","note":"…"}` with the private token.
  - New Qloo calls stop immediately. Cached LIVE results are still served, dated, and cost nothing.
  - `public-resume` undoes it.
  - `public-usage` shows today's spend, reservations, analyses and the limits.
- **Full off.** Set `QLOO_PUBLIC_ENABLED=false` and redeploy. Environment variables only apply on a new deploy.
- **Key rotation.** Change `QLOO_API_KEY` in Netlify (secret, Functions scope) and redeploy.

## What the UI shows
**When it works**, a green banner reads "Built with the real Qloo API · computed <date> UTC" and states either "served from cache: no new Qloo queries" or "<n> Qloo queries". It also says when the result is partial (some Qloo calls failed) or an earlier dated result.

The banner and the affinities panel always carry the audience notice:
> Inferred, not measured: Qloo's affinities are taste patterns of people who like this show's signals (its past guests, the show itself or its topics). They are not data about this show's listeners, and we do not know who they are.

Qloo's contribution is shown with the existing panels:
- discovered candidates, verified, discarded and pending, with each reason (`discoveryPositions`);
- inferred cultural affinities;
- the baseline comparison (`comparison`: what changed versus the same analysis without Qloo).

Nobody is forced into the top 5.

**When it fails**, a card reads "Qloo LIVE could not produce this result" with the honest reason. Possible codes: `qloo_unavailable`, `qloo_auth`, `busy`, `budget`, `visitor_limit`, `open_limit`, `paused`, `guard_unavailable`, `source_unavailable`, `feed_mismatch`, `unsafe_feed`, `not_in_directory`.

The card offers these choices:
- **Try again**, when retrying makes sense;
- **See the earlier LIVE result (<date>)**, when one exists;
- **See a demo without Qloo (MOCK)**.

MOCK is only shown when the visitor chooses it, and then the existing MOCK notice is displayed. Nothing is substituted silently.

## Before switching it on
1. **Run the LIVE test.** With the private token, run `recommend` on 3–5 catalog shows through `/api/live` (or the public path in a preview deploy). Record `qlooMetrics.networkCalls`, p95 latency, errors and the funnel.
2. **Set the limits from that measurement:**
   - `PUBLIC_CALLS_PER_ANALYSIS` ≥ the observed p95 of calls per analysis, so results are not cut short;
   - `PUBLIC_DAILY_QLOO_CALLS` = what you accept to spend per day.
3. **Validate the public path itself.** Set `QLOO_PUBLIC_ENABLED=true` on a **deploy preview or branch deploy**, not production:
   - analyze a catalog show and an Apple-directory show;
   - check the banner, the cache hit on a second request and `public-usage`;
   - test `public-pause` / `public-resume`.
4. **Switch on in production** only then. Keep `public-usage` at hand.

## Tests
- `tests/public-live.test.ts` covers:
  - the budget is never over-committed under 20 concurrent reservations;
  - concurrency cap, lease expiry, per-visitor, open-search and pause limits;
  - no raw IP is stored;
  - every private action is refused;
  - off by default;
  - fail closed without the store;
  - LIVE result then cache hit at zero calls;
  - Qloo down → 502 with no MOCK and no cache; auth error; partial results not cached; stale LIVE offered on refusal;
  - Apple-directory feed resolution (client feed URL ignored), title mismatch, SSRF on the listed feed;
  - emergency pause through `/api/live`.
- These use a scripted LIVE-shaped Qloo adapter. They prove the guard and the handler, **not** Qloo.
