# Devpost submission draft (not submitted)

## Status checklist (2026-10-24)
| Requirement (qloo.devpost.com and its rules) | Status |
|---|---|
| Working agentic app integrating the Qloo API | **Done.** https://greenroom1.netlify.app runs every analysis on the real Qloo API. |
| Link to a functional demo, externally hosted, free and unrestricted until judging ends | https://greenroom1.netlify.app (no login) |
| **Public** repo with an **open-source license** visible in About | MIT `LICENSE` is in the repo. **Pending: switch the repository to public** (GitHub → Settings → General → Danger Zone → Change visibility). No secrets in history, no Qloo responses stored. |
| English text description | Below |
| Testing instructions | [docs/JUDGE_ACCESS.md](JUDGE_ACCESS.md) (ready to paste) |
| Demo video | **Not required** ("Demo videos are not required. Instead … something judges can actually use"). Judges may still decide on text, images and video alone: upload the screenshots in `docs/screenshots/`. Script kept in [docs/DEMO.md](DEMO.md) if a video is added. |
| Deadline | **Oct 30, 2026, 11:45 pm EDT** (Oct 31, 00:45 in Argentina) |
| Finalists | The top 3 present live on Nov 5 with Jason Calacanis, Cedric the Entertainer and Alex Elias, and must be available to prepare beforehand. |
| Before judging (Nov 1) | Warm the cache for every catalog show and raise the daily budget; see JUDGE_ACCESS.md |

## Title and tagline
**Green Room** · *The guest your audience is waiting for: an agent that books podcast guests on evidence and on taste.*

## Text description

**The problem.** Podcast producers book guests from the same small circle, from memory and gut feeling. A wrong booking costs a whole episode, and the usual shortcut, "who is famous?", ignores whether *this* audience cares. Producers need a shortlist they can defend: people with a real interview track record, who have never been on the show, whom their audience knows and likes.

**What it does.** Pick a podcast (interview shows from Apple's charts in the US, Mexico, the UK, Argentina and Spain, or any show in Apple's directory). Green Room's agent reads the show's real episode history and recommends five guests, each with:
- **who they are**: occupation, country, free photo;
- **why this show**: the past guests they resemble, where they were interviewed and on what;
- **what Qloo says about their audience**: affinity to the show's audience, how similar their audience's age/gender profile is to the show's, and whether they are rising over the last 12 weeks;
- **verified evidence**: interview links, identity and language checks;
- **a draft invitation** written only from that evidence.

It also shows **who the show's audience is according to Qloo**, **new people only Qloo's taste graph surfaced**, and **cultural conversation hooks** (music, films, books).

**Why it only works with Qloo.** The show's own data says who has been booked; only Qloo says what its audience likes. The agent turns past guests (or, when titles don't name them, the show itself and its themes) into a Qloo taste signal. It then uses Qloo to:
1. discover people with affinity to that audience, outside the show's history;
2. score each comparable candidate's affinity to the audience;
3. profile the show's audience and each guest's audience by age and gender (`urn:demographics`) and compare them;
4. read each guest's 12-week popularity trend (`/v2/trending`);
5. find cross-domain cultural hooks.

Without Qloo, Green Room can still list credible people. It can't tell a producer whose audience overlaps theirs, who their audience is, or who is on the rise.

**How the agent works.** A rule-based planner observes, decides, acts, verifies and re-plans, and every step records why it ran.
- If guests can't carry the audience signal, it tries the show as a Qloo podcast entity, then its themes as Qloo tags.
- It profiles **who the show interviews** from its past guests' Wikidata records (kinds of guest, citizenship). Each country's shows then get guests that audience knows: Argentine shows get Argentines, Mexican shows Mexicans.
- It never recommends someone who has died, already appeared on the show or is the host.
- It looks further back in time before relaxing any rule, and says so.

**Engineering for a real public demo.**
- Analyses run as Netlify background jobs; results are persisted in Netlify Blobs.
- A rate-aware Qloo client paces requests, honors Retry-After and adapts concurrency.
- A shared daily Qloo budget, a per-visitor cap and a server-side cache protect the hackathon key.
- An emergency pause stops new Qloo calls without a redeploy.
- Qloo data is never committed to the public repo.
- 213 automated tests.

**Honest limits.**
- Qloo describes aggregate taste, not individual listeners, and the app says so on every Qloo value.
- In historical backtests, Qloo affinity did not raise hit rates on our core shows. Green Room uses Qloo to explain and qualify picks, not to claim better predictions.
- Guest names in some feeds are extracted automatically; identity is confirmed with context or the person is not used.

**Built with:** TypeScript, React, Vite, Netlify Functions (incl. background functions) and Netlify Blobs, Qloo Insights API (`/search`, `/v2/tags`, `/v2/insights` for person, demographics, artist, movie and book, `/v2/trending`), Apple Podcasts public APIs, official RSS feeds, Wikidata, Wikipedia and Wikimedia Commons.
