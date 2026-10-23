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
| `/api/discover` | **LIVE**, inside the limits below | public | only `status`, `recommend {showId}` and `analyze {appleId}` |
| `/api/live` | LIVE | private token | diagnostics, A/B/C/D `compare`, `editorial`, and the public-path controls |

- Any other action sent to `/api/discover` gets a 400. That includes `compare`, `editorial`, `diagnose` and the controls.
- `/api/discover` reads its own switch. `QLOO_LIVE_ENABLED` (private tests) does not turn it on.

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
| Qloo calls per analysis | `PUBLIC_CALLS_PER_ANALYSIS` | 60 | Enforced by the adapter (`maxCalls`, retries included). After the run, the reservation is settled to the real count. |
| Simultaneous analyses | `PUBLIC_MAX_CONCURRENT` | 2 | Leases with a 75 s expiry. An unsettled lease (crash, timeout) expires and counts its **whole** reservation as spent. |
| Fresh analyses per visitor per day | `PUBLIC_FRESH_PER_IP_PER_DAY` | 3 | Keyed by a salted SHA-256 of IP and day. Raw IPs are never stored. |
| New open-search feeds per day | `PUBLIC_OPEN_FEEDS_PER_DAY` | 10 | A separate counter, so the catalog stays available. |
| Result cache | `PUBLIC_CACHE_HOURS` | 24 | Only complete LIVE results are cached, and a cache hit costs 0 Qloo calls. Partial results are never cached. |
| Burst limit | function `config.rateLimit` | 10 / 60 s per IP | Netlify edge rate limit. |
| Time | — | 40 s per analysis, 8 s per call | Stays under Netlify's synchronous limit. |

**Worst case.** The public path can never spend more than `PUBLIC_DAILY_QLOO_CALLS` Qloo calls in a UTC day. With the defaults that is 400 calls, at most 6 fresh analyses a day; cached shows are unlimited.

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

## Budgeted discovery candidate (not yet validated LIVE)

The proposed public fast path prioritizes **person discovery** instead of spending the synchronous function budget on every optional enrichment step. It resolves at most six recent guests, up to three theme queries, performs Qloo person discovery, and independently verifies at most four external proposals. Cross-domain artist/movie/book lookups, the second discovery pass and affinity reranking are skipped **only on the public path**. The private LIVE diagnostic and A/B/C/D paths are unchanged.

The public adapter has a stricter limit of at most 24 network calls (or the configured per-analysis cap, if lower), two in flight, 2.5-second request timeouts, a 15-second Qloo deadline and no retries. The agent's planner is given a 20-second soft deadline; this is **not a hard total-function timeout**. The guard still reserves the configured per-analysis maximum and settles the actual call count. Profile lookups are disabled for the public fast path; existing static profiles still display.

**Tradeoff:** public results will show Qloo discoveries but will not claim that Qloo affinity reweighted the final ranking or generated cross-domain cultural hooks. This is a reliability-first experimental change, not proof that Qloo improves the top five. It must pass typecheck/tests and real production tests before merging and re-enabling public Qloo.

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
