# Open podcast search, sources and verification (Phase 6, 2026-10-23)

## Open search (`/api/podcasts`, public, Qloo always MOCK)
| Input | What happens | Source |
|---|---|---|
| Name | Apple Podcasts Search API; results from every storefront are shown, never hidden by country | itunes.apple.com |
| Apple link | `id…` → Apple Lookup API → feed URL | itunes.apple.com |
| Spotify show/episode link | oEmbed gives the **title only**; we search Apple for it and the user chooses the same show (no merge by name) | open.spotify.com/oembed |
| YouTube link | oEmbed gives title and channel; same as Spotify | www.youtube.com/oembed |
| Any other link | Fetched as a direct RSS feed; anything that is not RSS is rejected | the show's host |

The private LIVE endpoint accepts `{"action":"analyze","feedUrl":…}` to run the same analysis with real Qloo.

**Origin.** Only shows in the curated catalog carry a verified origin. Everything found through the search is "origin not verified"; the Apple storefront is shown as availability, never as origin.

**Analysis states.** `complete` · `limited` (guest names in < 30% of titles, or no episode in the last year) · `insufficient` (fewer than 5 dated episodes, fewer than 3 titles with guest names, not RSS, HTTP error). Each state lists its reasons and the sources read.

## Security (core/net/safe-fetch.ts)
- https only (http is upgraded), default port, no credentials, no IP literals, no local host names.
- Every resolved address must be public (IPv4/IPv6 private, loopback, link-local, CGNAT, multicast, mapped addresses).
- Redirects followed manually, each one re-validated, at most 3. Size caps (feeds 8 MB, APIs 3 MB) and timeouts (6–10 s).
- API hosts are allow-listed (Apple, Spotify oEmbed, YouTube oEmbed, Wikidata, Wikipedia).
- Per request at most 3 API calls and 1 feed fetch; 10-minute in-memory cache; Netlify rate limit 20 requests/min per IP.
- The XML parser does not expand entities.
- Residual risk: the runtime resolves DNS again after our check (rebinding window). The function has no internal services to reach and never returns raw responses.

## Platforms
- **Apple Podcasts + RSS: operational** (search, links, metadata, episodes).
- **Spotify: link adapter only.** We read the oEmbed title, which needs no key. We do not use the Web API: it requires an app in Development Mode with its own limits, and its terms forbid using Spotify content to train or feed ML/AI models. No Spotify content is stored or analyzed.
- **YouTube: link adapter only.** oEmbed (title and channel). The Data API (quota-based, needs a key) and transcripts are not used.
- **Canonical show identity:** each search hit keeps its Apple id, feed URL and link. Shows are linked across platforms only by the user's explicit choice, never by name similarity. Rankings and plays from different platforms are never combined.

## External verification of Qloo proposals (core/verify/external.ts)
- Runs only in LIVE, for proposals with no interviews in our RSS. At most 12 per run, ~4 calls per batch plus one Wikipedia summary per kept person.
- **Identity.** In order of strength:
  1. Qloo's own Wikidata link, if the entity has one (the field is parsed tolerantly; its shape has not been validated live yet).
  2. Exactly one same-name Wikidata person whose description or occupations share context with Qloo's description or tags, strictly better than any namesake.
  3. The only notable namesake → *partial* only.
  
  Several namesakes and no distinguishing context → *pending*. Nothing is ever merged by name alone.
- **Type.** Wikidata P31 (human, musical group, organization, work) plus Qloo's own types. Bands and duos are *discarded*, not ranked.
- **Duplicates.** Two Qloo ids that resolve to the same Wikidata person are merged, and both ids are kept.
- **States:**
  - documented: identity linked and a Wikipedia article exists;
  - partial;
  - pending;
  - discarded: type, identity or repeat.
- **Ranking.** Only *documented*, on-theme people enter the main ranking. Topical fit comes from Wikidata/Wikipedia text. Momentum and recency are unknown, so they are left out and the weight is renormalized, never imputed.
- **Language.** Confirmed only through Wikidata P1412 (languages spoken). A Wikipedia article in the language is only *probable*.
- **Sources.** Wikidata (CC0) and Wikipedia (CC BY-SA 4.0), read with a descriptive User-Agent. Wikimedia blocks automated SPARQL through proxies, so the verifier uses the standard action API instead.
- **Test fixtures.** Real responses retrieved 2026-10-23 for Andrew Yang, Santiago Korovsky, Charly García, Khruangbin, Rodrigo y Gabriela and Tulsi Gabbard (tests/fixtures/wikidata). The Qloo descriptions in the tests are test inputs, not Qloo output.

## Four controlled arms (private `/api/live` `{"action":"compare","showId":…}`)
| Arm | Variant |
|---|---|
| A | Baseline (no Qloo) |
| B | Plus Qloo discoveries, without affinity weighting |
| C | Plus Qloo affinity on existing candidates, without discoveries |
| D | Both |

Metrics per arm:
- top-k with baseline rank;
- overlap with A;
- mean editorial relevance (without Qloo);
- originality (new vs A, proposed by Qloo);
- evidence levels;
- pending identities;
- confirmed language;
- funnel.

An attribution line says which Qloo effect changed the list. **CREATIVO:** its two changed recommendations with zero admitted discoveries are the arm-C effect. The 0.5 affinity blend reorders candidates we already had (covered by a test). The weight was not changed.

## Qloo signals (core/qloo/signals.ts)
- Generic words ("música", "TV", "vida", "fama"…) are no longer sent as tags.
- Specific theme words are sent in English when a translation exists ("inteligencia" → "artificial intelligence", "tecnología" → "technology"), and the original word is still accepted as an exact match.
- Show-title variants are exact ("X – subtitle" → "X"), never fuzzy.
- For Bilinkis the queries are now: artificial intelligence, chatgpt, technology, world cup, messi, parenting.

Whether Qloo has matching tags is **not verified**: that needs a LIVE run.
