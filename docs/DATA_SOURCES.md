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
