# Green Room

**The guest your audience is waiting for.** Green Room is an AI agent for podcast producers. It reads a show's real public episode history, finds people with a verifiable interview track record, checks that they have never been on the show, and recommends five guests, with the evidence for every claim and a draft invitation.

Built for the [Qloo Agentic Hackathon 2026](https://qloo.devpost.com/). Qloo's taste graph is the audience signal: past guests become the taste fingerprint of the show, and Qloo finds and scores people with affinity to it.

> **Status (2026-10-23): live with the real Qloo API.** The public demo at https://greenroom1.netlify.app runs every analysis against Qloo's hackathon API, in a background job with a shared daily budget and a result cache. Validated end to end on Netlify with real Qloo: complete results with no rate-limit errors (see [docs/LIVE_ENGINE_FIX.md](docs/LIVE_ENGINE_FIX.md) and [docs/PUBLIC_LIVE.md](docs/PUBLIC_LIVE.md)). Podcasts, episodes, dates and guests come from official RSS feeds. Anything not returned by Qloo is labeled; a MOCK demo exists only when the visitor chooses it.

## What it does

1. **Pick a country, then a podcast.** The catalog covers the US, Mexico, the UK, Argentina and Spain: 21 interview shows selected from Apple Podcasts' official charts. 15 are analyzable, 3 are limited (few guest names in titles) and 3 are not analyzable; each card says why. You can also search by name.
2. **The agent loop runs: observe → decide → act → verify → replan.** A deterministic rule planner (no language model) picks each next tool from what it has observed, and every step records *why*. It re-plans when the data is thin:
   - not enough confirmed guest identities → the show as a Qloo podcast entity → theme tags;
   - too few candidates → relax the threshold → widen the window;
   - a failed verification → re-select.

   See [docs/AGENT_AUDIT.md](docs/AGENT_AUDIT.md).
3. **Five recommendations**, each with:
   - score components: topical fit, Qloo affinity, momentum and recency;
   - verified appearances, with links;
   - shared themes and conversation threads;
   - a draft interview proposal built only from that evidence.
4. **Backtest**: hide everything after a cutoff date, recommend with earlier data only, then count how many recommended people the host really booked later. The page also shows a random baseline, a leakage audit and limitations.

## Languages and guest profiles

- **Español | English** selector in the header. Spanish is the default; the choice is remembered in the browser (localStorage). Switching language re-renders texts only: it does not re-run the analysis or change the ranking (checked in the browser QA run and in `tests/i18n-profiles.test.ts`).
- Agent steps, decisions, reasons, warnings, backtest labels and interview proposals exist in both languages. Proper names, episode titles and quotes from sources stay in their original language.
- **Guest cards** show the photo, name, specialty, score, "why we recommend them", an evidence button and an invitation button. Technical details and the VERIFIED/INFERRED/MOCK/LIVE labels are in a collapsible section; MOCK is also flagged on the collapsed summary.
- **Photos** come from Wikimedia Commons with free licenses only. Author and license are shown in the evidence panel. A Wikipedia profile is attached only when its text matches the guest's own interview titles; otherwise the card shows initials. See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md#guest-photos-and-bios).

## Provenance labels

| Label | Meaning |
|---|---|
| `VERIFIED` | Read directly from the show's public RSS feed (title, date, link). |
| `INFERRED` | Derived by Green Room's own transparent rules from verified data. |
| `MOCK` | Simulated stand-in for Qloo. Not evidence. Never affects ranking. |
| `LIVE` | Returned by the real Qloo hackathon API. |

Green Room has no listener data and never claims to. Qloo affinities describe taste patterns, not a show's actual listeners.

## Current backtest result (real data, without Qloo)

`npm run backtest -- diary-of-a-ceo 2025-01-01`. The leakage audit passed.

| | Hits @5 | @10 | @25 |
|---|---|---|---|
| Random pick from the same pool (expected) | 0.20 | 0.40 | 1.01 |
| Without Qloo (themes + verified track record) | 2 | 2 | 2 |
| With Qloo | not re-measured with the current engine | | |

Only 7 of the 59 later first-time guests were reachable: they had appeared on a comparison show before the cutoff. That is the ceiling for any method here. These are small numbers. A hit means agreement with the host's real choices, not audience impact.

## Run it

```bash
npm install
npm run dev           # http://localhost:5173 (API served by the same handler as the Netlify Function)
npm test              # 87+ tests: extraction, agent loop and re-planning, leakage, Qloo client and limits, LIVE access control, secrets, i18n, profiles, unchanged ranking, experiment, editorial evaluation
npm run catalog:build # rebuild the five-country catalog from data/catalog/sources.json + RSS snapshots
npm run typecheck
npm run build
npm run backtest -- <showId> <YYYY-MM-DD>
npm run profiles:build  # refresh data/profiles.json from Wikipedia/Wikidata (needs network to those hosts)
```

Live Qloo experiment (key never printed or stored by Green Room):

```bash
npm install --global @qloo/qloo-harness && qloo setup --qloo   # official kit, hidden input
npm run qloo:experiment   # T2 coverage, T4 originality, T5 with vs. without Qloo; stops if auth fails
```

Public LIVE analyses go through `/api/discover` (queues a background job; the browser polls). It is controlled by `QLOO_PUBLIC_ENABLED`, a daily Qloo call budget and an emergency pause; see [docs/PUBLIC_LIVE.md](docs/PUBLIC_LIVE.md). `/api/agent` stays MOCK, and `/api/live` is the private diagnostics endpoint (token-protected). Netlify setup, limits and variables: [docs/NETLIFY.md](docs/NETLIFY.md).

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

## License

MIT — see [LICENSE](LICENSE). Qloo API responses are never stored in this repository (Qloo hackathon developer guide); they are cached privately on the server only.
