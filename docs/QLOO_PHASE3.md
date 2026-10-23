# Phase 3: real Qloo integration (protocol)

Written on 2026-10-23, **before** any live result, so the success criteria cannot be adjusted afterwards.

## Status
- The key exists (it arrived by email). It has **not** been validated yet: the development container's network policy denies `hackathon.api.qloo.com` (the proxy returns 403 on CONNECT). No live call has been made.
- The REST client has been checked against the official docs and the official harness (`@qloo/qloo-harness` 0.1.26). That check found one bug, now fixed (see below).

## Fixes made from the official kit and docs
1. **Candidate scoring used a parameter that does not exist.** It sent `filter.entities`; the documented parameter for `urn:entity:person` is `filter.results.entities` (Entity Type Parameter Guide, and the harness `rank` workflow). The API silently ignores unknown parameters, so the live run would have returned arbitrary people with no error.
2. **Namesakes.** `/search` now asks for 5 results (as the harness does). When two different Qloo people share the exact name, the guest is left unresolved instead of taking the first one.

## How to run it on your computer (the key never enters a chat, file or repo)
```bash
# Node 22.19+
git clone <private repo> && cd green-room-qloo && git checkout develop && npm install
npm install --global @qloo/qloo-harness   # official kit, version 0.1.26+
qloo setup --qloo                          # hidden prompt; stored in ~/.qloo/config (mode 600)
npm run qloo:experiment                    # reads the key from ~/.qloo/config
```
Alternatives:
- Skip the harness: run `npm run qloo:experiment` with no key configured. The script asks for the key itself, with hidden input, and keeps it in memory only.
- Set `QLOO_API_KEY` in your shell. Avoid putting it on the command line, because it stays in shell history.

Rules the script follows:
- It sends the key only to `https://*.qloo.com`. It defaults to `https://hackathon.api.qloo.com`, and it ignores `base_url=https://api.qloo.com` from the harness config, because hackathon keys fail on production.
- It never prints the key; it only shows its length.
- If authentication fails it stops. It does not fall back to MOCK.
- It caches responses in `data/raw/qloo-cache/` and writes the full report to `data/raw/qloo-reports/`. Both folders are gitignored, because the developer guide says not to put Qloo data in a public repository.
- Network budget: 800 calls by default (`--max-calls`). Repeated calls come from the cache.
- Bring back the console summary (aggregate numbers). Do not bring the key.

## Tests and pre-registered criteria
**T1. Authentication and response shape**
- Pass condition: HTTP 200 on `/search`.
- Also recorded: whether `results.entities[].query.affinity` exists, and whether `feature.explainability` returns anything for people.

**T2. Coverage**
- Population: for each show, the 25 most recent guests (the agent's taste signal) and the top 40 baseline candidates (the people the agent scores), now and at every cutoff.
- Each person is classified as:
  - *confirmed*: exact match whose Qloo description shares words with their interview titles;
  - *unconfirmed*: exact match without a description;
  - *mismatch*: has a description, but it shares no words with the titles;
  - *ambiguous*: two or more namesakes;
  - *fuzzy only*;
  - *not found*.
- Usable for Green Room: resolved rate ≥ 70% of past guests on at least 2 of the 3 shows (the agent needs ≥ 3 signals per show).

**T4. Originality** (as of today, per show)
- Qloo person insights are seeded with the resolved recent guests, which are excluded from the results.
- Returned people are split into:
  - already guests of the show (a sign of consistency);
  - in our own top 25;
  - elsewhere in our feeds;
  - new to us.
- Fame proxy: median Qloo popularity of the "new to us" people compared with our top 25.
- Relevance cannot be decided automatically. The "new" list needs a human review and stays **not conclusive** until it gets one.

**T5. With vs. without Qloo**
- Setup: 3 shows × 4 cutoffs (2023-07-01, 2024-01-01, 2024-07-01, 2025-01-01), 24-month horizon.
- Both arms use the same candidate base and identical rules. The only difference is the 0.5 blend of the Qloo affinity rank. Qloo discovery is off in the main arm.
- An exploratory arm turns discovery on. Its results are reported separately because it is the most exposed to leakage.

Qloo **improves** results only if all four conditions hold at @10:
- (a) affinity values came back for ≥ 50% of the scored candidates;
- (b) total hits with Qloo > total hits without Qloo;
- (c) wins > losses across cells;
- (d) the result is not driven by a single cell.

It is **conclusive** only if, in addition, the exact sign test gives p < 0.05. With at most 12 cells and few reachable guests per cell, we expect it **not** to be conclusive, and we will say so.

If (a) fails, the comparison measures nothing about Qloo. It is reported as "no data", not as "no improvement".

## Temporal leakage (cannot be removed)
Qloo's graph is a current snapshot and cannot be queried "as of" a cutoff. Two things may already reflect events after the cutoff, including the very bookings we count as hits:
- a candidate's affinity to the show's earlier guests;
- the people Qloo returns.

T5 therefore measures **agreement with today's graph**, and any gain is an upper bound. Only Green Room's own inputs pass the leakage audit (the RSS data, the candidate pool, the signals).

The only fully clean test is prospective: freeze recommendations now and check bookings later. It cannot be finished before the deadline.
