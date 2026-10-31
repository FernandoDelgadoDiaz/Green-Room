# Devpost submission draft (not submitted)

## Status checklist (2026-10-26)
| Requirement (qloo.devpost.com and its rules, read again on 2026-10-25) | Status |
|---|---|
| Working agentic app integrating the Qloo API | **Done.** https://greenroom1.netlify.app runs every analysis on the real Qloo API. |
| Link to a functional demo, externally hosted, free and unrestricted until judging ends | https://greenroom1.netlify.app (no login). The hackathon key stays active through the judging period (developer guide). |
| **Public** repo with an **open-source license** visible in About | **Done.** Public, MIT, About with description, website and topics. No secrets in history, no Qloo responses stored. |
| Newly built in the submission period | **Yes.** Repository created on 2026-10-23, inside the period (Sep 30 – Oct 30). |
| English text description | Below |
| Testing instructions | [docs/JUDGE_ACCESS.md](JUDGE_ACCESS.md) (ready to paste) |
| Demo video | **Not required** ("Demo videos are not required. Instead … something judges can actually use"). Judges may decide on text and images alone, so the eight screenshots below matter. They are kept out of the repo because they show Qloo results. |
| Deadline | **Oct 30, 2026, 11:45 pm EDT** (Oct 31, 00:45 in Argentina) |
| Finalists | The top 3 present live on Nov 5 with Jason Calacanis, Cedric the Entertainer and Alex Elias, and must be available to prepare beforehand. |
| Before judging (Nov 1) | Warm the cache for every catalog show and raise the daily budget; see JUDGE_ACCESS.md |

## Screenshots to upload (taken from production on 2026-10-26, in this order)
1. Home: pick a country and a podcast, or press a live example.
2. This Week in Startups: five portraits in Qloo's taste order, each with its Qloo affinity.
3. "Why these five": what Qloo found out about the audience, why each guest is here, what the agent did.
4. "Without Qloo": the same analysis with Qloo off.
5. "What Qloo changed in this search": who entered, who left, and Qloo's order at 74/100 audience affinity against 19/100 without Qloo.
6. "Who this show's audience is", according to Qloo.
7. The invitation: editable, opens in email or WhatsApp.
8. "How well Qloo knows each market".

## Title and tagline
**Green Room** · *The guest your audience is waiting for: an agent that finds podcast guests your audience already follows, powered by Qloo's taste graph.*

## Text description

**The problem.** Podcast producers book guests from the same small circle, from memory and gut feeling. A wrong booking costs a whole episode. The usual shortcut, "who is famous?", ignores whether *this* audience cares. Producers need a shortlist they can defend: people with a real interview track record, who have never been on the show, and whom their audience already follows.

**What it does.** Pick a podcast: interview shows from Apple's charts in the US, the UK, Mexico, Spain and Argentina, or any show in Apple's directory. Green Room's agent reads the show's real episode history and answers with **five guest portraits**, then explains them in plain words:
- **What Qloo found out about your audience**: its age and gender lean, and what else it likes (for This Week in Startups: mostly men aged 45–54, readers of *The Power Law* and *Chaos Monkeys*).
- **Why each guest**: their Qloo affinity with this audience, what they bring (position, the show's topics they talk about, or the past guests they resemble) and how recent their last interview is.
- **What the agent did**, step by step, with this run's numbers.

Every guest has verified evidence (interview links, identity and language checks) and a **draft invitation** written only from that evidence. The producer can edit it and open it in email or WhatsApp; nothing is sent by the app.

**Why it only works with Qloo.** The show's feed says who has been booked. Only Qloo says what its audience likes. The agent turns the show (its Qloo podcast entity, its past guests, its themes as Qloo tags) into a taste signal, then uses Qloo to:
1. **discover** people with affinity to that audience, outside the show's history;
2. **score** every verified candidate's affinity to the audience, with `feature.explainability` saying which of the show's signals drove it;
3. **profile** the audience by age and gender (`urn:demographics`);
4. find what else that audience likes across books, films and music.

**The same analysis with Qloo turned off** is one tap away ("Without Qloo"). On This Week in Startups (live run, 2026-10-31; Qloo's answers vary somewhat between runs):
- Qloo changes **3 of the 5** guests.
- Qloo's taste order (Dustin Moskovitz, Bret Taylor, Adam D'Angelo, Ron Conway, Jessica Livingston: none of them on the list without Qloo, none of them ever on the show) averages **74/100** audience affinity. The list without Qloo (Ray Dalio, Eric Weinstein, Satya Nadella, Erin Brockovich, Elon Musk) averages **19/100**, both measured the same way in the same run.
- Without Qloo you get famous people. With Qloo you get the people this audience leans toward.

**Why a general-purpose LLM can't do this.** Asked "who should This Week in Startups book?", a language model guesses from fame. It does not know:
- who has already been on the show (Green Room reads the whole feed and the show's official YouTube titles back to 2009, and never proposes a past guest or the host: on This Week in Startups it set aside 67 past guests Qloo's audience still loves, such as Ben Horowitz and Travis Kalanick);
- whether a name is the right person (Green Room checks identity in Wikidata and Wikipedia, and drops namesakes and people who have died);
- what this audience actually likes. That is measured taste from Qloo's graph, not general knowledge.

**How the agent works.** A rule-based planner observes, decides, acts, verifies and re-plans, and records why each step ran. Qloo proposes; the agent verifies. On This Week in Startups, Qloo proposed 30 people: 19 passed identity verification and 15 became candidates. Every pick passes the same checks as any other candidate. If the guests can't carry the audience signal, the agent falls back to the show as a Qloo podcast entity, then to its themes as Qloo tags. It also looks further back in time before relaxing any rule, and says so.

**Where Qloo is strong, and where it isn't.** Green Room measures it on its own runs and shows it in "How well Qloo knows each market":
- **US shows:** Qloo knows the audiences well, and the demo shows are from there.
- **Argentine shows:** Qloo knows little, and the app says so on the screen instead of pretending.

For a Latin American launch, that gap is a data opportunity, not a reason to fake results.

**Engineering for a real public demo.**
- Analyses run as Netlify background jobs; results are kept in Netlify Blobs.
- A rate-aware Qloo client paces requests, honors Retry-After and adapts concurrency.
- A shared daily Qloo budget, a per-visitor cap and a server-side cache protect the hackathon key.
- An emergency pause stops new Qloo calls without a redeploy.
- Qloo data is never committed to the public repository.
- 272 automated tests.

**Honest limits.**
- Qloo describes aggregate taste, not individual listeners, and the app labels every Qloo value that way.
- Affinity is each person's position among the candidates Qloo scored for this audience (0 to 100), not a forecast of downloads.
- In historical backtests, Qloo affinity did not raise hit rates on our core shows. Green Room uses Qloo to choose and explain, not to claim better predictions of who a host will book.

**Built with:** TypeScript, React, Vite, Netlify Functions (incl. background functions) and Netlify Blobs, Qloo Insights API (`/search`, `/v2/tags`, `/v2/insights` for person, demographics, artist, movie and book, with `feature.explainability`), Apple Podcasts public APIs, official RSS feeds, Wikidata, Wikipedia and Wikimedia Commons.
