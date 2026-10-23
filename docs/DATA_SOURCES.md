# Data sources

Snapshot date: **2026-10-22**. All data comes from each show's official public RSS feed. RSS feeds exist so that podcast apps and readers can fetch them. No scraping of platforms (Spotify, YouTube, Apple) was done.

| Show | Language | Feed | How the feed URL was found | Items | Episodes with ≥1 identified guest |
|---|---|---|---|---|---|
| Lex Fridman Podcast | en | https://lexfridman.com/feed/podcast/ | Official site | 502 | 485 |
| The Diary Of A CEO | en | https://rss2.flightcast.com/xmsftuzjjykcmqwolaqn6mdn | Listed on podnews.net/podcast/idte and podcastaddict.com | 900 (317 excluded: clips, solo, trailers) | 292 |
| CREATIVO (Roberto Mtz) | es | https://anchor.fm/s/fdd14414/podcast/rss | Listed on podnews.net/podcast/i4ie8 | 784 (21 excluded) | 677 |

## What is stored

`data/podcasts/<id>.json` keeps only: episode id (guid), title, publication date, link, extracted guest names with the extraction method and confidence, and the exclusion reason. Full descriptions and audio links are third-party content and are not stored. The raw XML snapshots live in `data/raw/`, which is gitignored.

## How guests are identified

There are deterministic per-feed rules in `core/extract.ts`:
- **Lex:** `#N – Name: topics`, `#N – topics – Name`, or the first sentence of the description ("Andrew Scull is a historian…").
- **DOAC:** the trailing `| Name` / `- Name` / `: Name` slot, then a leading `Name:`. Role phrases ("Klarna Founder", "The Deathbed Doctor") are rejected. "Most Replayed Moment", "Moment N" and `E\d+:` are excluded.
- **CREATIVO:** the uppercase name slot `NNN. NAME | subtitle`, the trailing `| Name` and `c/Name` patterns. Host-only and RECREATIVO episodes are excluded. Re-uploads marked "(2023)" count as past appearances but never as new bookings.
- **Manual overrides**, each with a reason: Frida Kahlo, Leonardo da Vinci and Nikola Tesla are biographical CREATIVO episodes (the person is the subject, not a guest).

When no rule matches, the guest list stays empty: about 50% of DOAC titles have no name in the title. The agent warns about this instead of guessing.

## Known limitations

- About 50% guest coverage for DOAC: some past DOAC guests may go undetected, so a recommended person might already have appeared.
- Names are matched by exact canonical key (case, accents and honorifics normalized). Spelling variants across feeds can be missed; we prefer missing a match to inventing one.
- Lex/DOAC and CREATIVO share almost no guests. Without Qloo, Spanish-language recommendations for CREATIVO are cross-language and flagged as such.
- Refreshing: `npm run data:build` re-fetches feeds when `data/raw/*.xml` is absent. The development container could not reach the feeds directly (network policy), so the snapshots were fetched through a scraping service.

## Guest photos and bios

`data/profiles.json` was built by `scripts/build-profiles.ts` on 2026-10-22 for the 103 people who can appear in the current recommendations and backtests: **66 profiles accepted, 58 with a photo.**

| Field | Source | License |
|---|---|---|
| Photo (`photo.thumbUrl`) | Wikimedia Commons, via Wikipedia `pageimages` with `pilicense=free` | Per-file free license (CC BY, CC BY-SA, CC0, public domain, OGL). The author and license shown on the card come from Commons `extmetadata`. |
| Specialty (`description.en/es`) | Wikidata | CC0 |
| Bio quote (`extract.en/es`) | Wikipedia intro, shown as a quote with a link | CC BY-SA 4.0 |

### Identity safeguards (no photos of the wrong person)
1. Disambiguation pages are never used directly. Green Room only considers the options listed on the page (e.g. "Scott Galloway (professor)"), and accepts one only if exactly one of them matches the context.
2. **Context check.** The Wikipedia text must share at least one meaningful word (6-letter stem) with the person's own interview titles. Example: Wikipedia's "Shawn Ryan" is a TV screenwriter, while the Diary Of A CEO guest is a different person, so no profile is attached.
3. Words that justified each match are stored in `matchEvidence` and shown on the card ("Identity check").
4. The 66 accepted profiles were also reviewed by hand on 2026-10-22.

When any check fails, the card shows elegant initials. Known misses: Scott Galloway, Matthew McConaughey and Tony Robbins have Wikipedia pages, but their interview titles share no words with them. We chose false negatives over false positives.

### Runtime
- People without a stored profile are looked up live by the server function (Wikipedia/Wikidata APIs, 4 s timeout, in-memory cache). Any failure means initials.
- Set `PROFILE_LOOKUP=0` to disable lookups.
- Images are hotlinked from `upload.wikimedia.org` / `thumb.wikimedia.org`. They are not re-hosted in the repo.

### Note about the development container
The container cannot reach Wikimedia hosts. API responses were fetched through Firecrawl and cached in `data/raw/wiki-cache/` (gitignored). For the QA screenshots, the test browser was served local crops of the same Commons images, made from page renders, via request interception. Real users' browsers load them directly from Wikimedia.

## Five-country catalog (2026-10-23)
- **Charts.** Official Apple Podcasts "Top Shows" charts for US, MX, GB, AR and ES (`rss.applemarketingtools.com/api/v2/<cc>/podcasts/top/…`, updated 2026-10-23 03:48 UTC). Positions are Apple's. Green Room only *selects* interview/conversation formats from the chart, so the selection is editorial and labeled as such. No audience figures are shown because none are verifiable.
- **Metadata.** The official iTunes lookup API gives the feed URL, artwork, genre, episode count and last release.
- **Episodes.** Snapshots of each official RSS feed: titles, dates and links only, up to 500 per show. They were fetched through a scraping service because this container cannot reach feed hosts.
- **Guests in new shows.** `core/extract-generic.ts` only reads name slots: the whole title, the first or last segment, a parenthesized name, a leading "Name on…", or a trailing "with Name". Confidence is "low". A spot check of 36 extractions found 3 non-person phrases.
- **Recurring segments.** Segment names ("Tertulia de Sapiens", CREATIVO's "EL TREN") are rejected at extraction and again by the agent's verification step.
- **Not analyzable, with the reason shown:**
  - Palabra Plena (inactive since 2020, 6 episodes);
  - The Megyn Kelly Show and Martha Debayle (feeds of about 2,000 episodes, not processed in this version).
- **Limited, with the reason shown:** Santiago Bilinkis, Aislados and The Wild Project, where fewer than 30% of titles name a guest. Their analysis exercises the agent's re-planning.
- **Country vs. language.** The country is where a show charts; the language comes from its RSS. The candidate pool is international, and language is checked per person (confirmed / probable / unknown).

Rebuild with `npm run catalog:build`, using `data/catalog/sources.json` and `data/raw/catalog/*.xml`.
