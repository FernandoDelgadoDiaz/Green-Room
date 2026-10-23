# Green Room

**The guest your audience is waiting for.** Green Room is an AI agent for podcast producers. It reads a show's real public episode history, finds people with a verifiable interview track record, checks that they have never been on the show, and recommends five guests, with the evidence for every claim and a draft invitation.

Built for the [Qloo Agentic Hackathon 2026](https://qloo.devpost.com/). Qloo's taste graph is the audience signal: past guests become the taste fingerprint of the show, and Qloo finds and scores people with affinity to it.

> **Status (2026-10-22): MOCK mode.** The Qloo hackathon key has not arrived yet. Podcasts, episodes, dates and guests are real (official RSS feeds). Every Qloo value is simulated, labeled **MOCK**, shown in pink, and has **weight 0** in the ranking. The live client is implemented and unit-tested against the documented API, but it is **not validated against the real API yet**.

## What it does

1. **Pick a show**: Lex Fridman Podcast, The Diary Of A CEO, or CREATIVO (Spanish, Mexico).
2. **The agent runs** a decision loop and shows each step and decision:
   read history → infer themes → resolve past guests in Qloo → map cross-domain taste → search candidates → discard repeat guests → score → relax thresholds or widen the window when data is thin → check language fit → pick a varied shortlist → justify.
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
| With Qloo | pending live API | | |

Only 7 of the 59 later first-time guests were reachable: they had appeared on a comparison show before the cutoff. That is the ceiling for any method here. These are small numbers. A hit means agreement with the host's real choices, not audience impact.

## Run it

```bash
npm install
npm run dev           # http://localhost:5173 (API served by the same handler as the Netlify Function)
npm test              # 44 tests: extraction, agent decisions, leakage, Qloo client, secrets, i18n, profiles, unchanged ranking
npm run typecheck
npm run build
npm run backtest -- <showId> <YYYY-MM-DD>
npm run profiles:build  # refresh data/profiles.json from Wikipedia/Wikidata (needs network to those hosts)
```

Live Qloo (when the key arrives):

```bash
cp .env.example .env   # set QLOO_API_KEY — server-side only, never VITE_-prefixed
npm run qloo:smoke     # validates connectivity, person coverage, exclusions, explainability
npm run dev            # header badge switches to LIVE
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

## License

Not yet licensed: the repository is private during development. Before the hackathon submission it must become public with an OSI-approved license (rules section 4).
