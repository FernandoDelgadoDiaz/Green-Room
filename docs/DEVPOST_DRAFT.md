# Devpost submission draft (not submitted)

## Status checklist (2026-10-23)
| Requirement (rules page) | Status |
|---|---|
| Working app integrating the Qloo API, agentic | App deployed at https://greenroom1.netlify.app (MOCK public). The agent loop is implemented. **LIVE Qloo has been tested from Netlify earlier, but not with this version.** |
| Link to a functional demo | Ready once LIVE is re-tested |
| **Public** repo with an **open-source license** visible in About | **Pending your decision**: the repo is private and has no LICENSE. MIT is suggested |
| English text description | Draft below |
| Testing instructions (credentials if private) | See docs/JUDGE_ACCESS.md |
| Demo video | Script in docs/DEMO.md. The rules mention judging on "text description, images, and video"; check the exact video requirement on the overview page before recording |
| Deadline | **Oct 30, 2026, 11:45 pm EDT** (verified on the rules page on Oct 23) |

## Text description (draft)

**Green Room — an agent that finds podcast guests you can defend.**

Podcast producers book from the same small circle. Green Room picks a real show (from Apple Podcasts' charts in the US, Mexico, the UK, Argentina and Spain), reads its public RSS history and proposes guests with evidence for every claim.

**How the agent works.** A planner chooses each next tool from what it has observed.
- If a show's titles name enough past guests, it confirms their identities in Qloo, using context and never a name alone, and uses them as the audience's taste signal.
- If they don't, it re-plans: it looks up the show itself as a Qloo podcast entity, then maps the show's themes to Qloo tags. If nothing works, it continues without Qloo and says so.
- It builds a candidate pool from verified interviews on 17 other shows, removes past guests, scores the candidates, and blends in Qloo affinity where identities are confirmed.
- It checks language, verifies the shortlist (and re-selects when, for example, a pick's name already appears in one of the show's titles), and writes an invitation from evidence only.

The planner is deterministic and rule-based. Every step in the trace says why it ran.

**What Qloo adds.**
- An audience signal built from the show's past guests, the show itself or its themes.
- Cross-domain cultural hooks.
- **Unexpected guests**: people outside our sources with affinity to the show's audience. They are shown apart, pending verification.

**Honest limits.**
- In our live backtests on three shows, Qloo did not improve historical hit rates; we report that.
- Qloo describes aggregate taste, not individual listeners.
- Guest names in new catalog shows are extracted automatically (about 92% precision in a spot check) and are flagged accordingly.

**Built with:** TypeScript, React, Vite, Netlify Functions, Qloo Insights API (`/search`, `/v2/insights`, `/v2/tags`), Apple Podcasts public chart and lookup APIs, official RSS feeds, Wikipedia/Wikidata (CC0/CC BY-SA) for photos and bios.
