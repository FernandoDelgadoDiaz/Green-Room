# Devpost submission draft (not submitted)

## Status checklist (2026-10-23)
| Requirement (rules page) | Status |
|---|---|
| Working agentic app integrating the Qloo API | **Done.** https://greenroom1.netlify.app runs on the real Qloo API (validated on Netlify, Oct 23). |
| Link to a functional demo | https://greenroom1.netlify.app |
| **Public** repo with an **open-source license** visible in About | MIT `LICENSE` added. **Pending: switch the repository to public** (GitHub → Settings → General → Danger Zone → Change visibility). Audit done: no secrets in history, no Qloo responses stored. |
| English text description | Below |
| Testing instructions | [docs/JUDGE_ACCESS.md](JUDGE_ACCESS.md) (ready to paste) |
| Demo video | Script in [docs/DEMO.md](DEMO.md). Judges may decide on the video and text alone, so record it with the live app. |
| Deadline | **Oct 30, 2026, 11:45 pm EDT** |
| Before judging (Nov 1) | Warm the cache for all catalog shows (7-day cache) and raise the daily budget; see JUDGE_ACCESS.md |

## Text description

**Green Room — the guest your audience is waiting for.**

**The problem.** Podcast producers book guests from the same small circle, and the "who should we invite?" question is answered from memory and gut feeling. Booking the wrong guest costs a whole episode. Green Room gives producers a shortlist they can defend.

**What it does.** Pick a podcast: one of 20 interview shows from Apple Podcasts' charts in the US, Mexico, the UK, Argentina and Spain, or any show found by name. Green Room reads its public RSS history and recommends five guests who have never been on the show. Each guest comes with verified evidence, the themes they share with the show and a draft invitation. It also shows **what Qloo's taste graph adds**:
- new people the show's own history could never surface;
- cultural conversation hooks.

**How the agent works.** A planner chooses each next tool from what it has observed, and every step records why it ran.
- **Audience signal.** If a show's titles name enough past guests, the agent confirms their identities in Qloo, by context and never by name alone, and uses them as the audience's taste signal.
  - If they don't, it re-plans: it tries the show itself as a Qloo podcast entity, then maps the show's themes to Qloo tags, translating Spanish themes to Qloo's English tags.
- **Discovery.** It asks Qloo for people with affinity to that signal. It verifies each one: Qloo entity type, a Wikidata/Wikipedia record matched by context, theme fit, not a past guest, interview language.
- **Ranking.** It builds a candidate pool from verified interviews on comparable shows and ranks on evidence.
  - Qloo affinity can reorder only candidates who are already comparable, inside an editorial band. It never lifts a weaker candidate above a stronger one.
- **Final checks.** It checks language, re-selects when a pick fails verification, and writes the invitation from evidence only.

**What Qloo adds (measured on the live app, Oct 23).**
- Qloo's Insights API (`/search`, `/v2/tags`, `/v2/insights` for people, artists, films and books) runs about 40–70 calls per analysis.
- 15–21 Qloo proposals per show were verified and documented as real, on-theme people outside our sources.
- They are shown in "What Qloo added" with their real position and reason.
- On the three shows we validated, none outranked the five evidence-based picks. Green Room says so instead of forcing them in.

**Engineering for a real, public demo.**
- Analyses run as Netlify background jobs, with results persisted in Netlify Blobs.
- The Qloo client is rate-aware: it paces requests, honors Retry-After and adapts concurrency. Validation runs had 0 lost answers to rate limits.
- A shared daily call budget and a 24 h result cache protect the hackathon key.
- An emergency pause stops new Qloo calls without a redeploy.
- Every value is labeled by provenance, and the app never claims to know a show's listeners.

**Honest limits.**
- Qloo describes aggregate taste, not individual listeners.
- In historical backtests, Qloo did not improve hit rates on our three core shows; we report it.
- Guest names in some catalog shows are extracted automatically and are flagged.

**Built with:** TypeScript, React, Vite, Netlify Functions (incl. background functions) and Netlify Blobs, Qloo Insights API, Apple Podcasts public APIs, official RSS feeds, Wikidata and Wikipedia.
