# Phase 7: fixes for the LIVE blockers found on 2026-10-23

## 1. 89 of 90 proposals rejected by type
- **Root cause (confirmed).** Qloo entities carry a generic `type: "urn:entity"` and the specific kind in `subtype` (e.g. `urn:entity:person`). The official harness (`@qloo/qloo-harness` 0.1.26) reads `subtype || type`. Our `parseEntity` ignored `subtype`, built `types: ["urn:entity"]`, and the filter required the literal `urn:entity:person`.
- **Fix.** The parser keeps `subtype`, `types[]` and `type`, specific kinds first. It also reads the top-level `short_description`/`description`, as the harness does.
- **Classification.** `qlooKind()` returns:
  - `person` for `urn:entity:person`;
  - `non_person` for a specific non-person kind (movie, album, place, brand, book, tv_show, podcast…), which is discarded;
  - `unknown` for only `urn:entity`, for `urn:entity:artist` (covers soloists **and** bands), or for no type.
- **`unknown` is never discarded.**
  - With no RSS record, it goes to full Wikidata/Wikipedia verification.
  - With identity proven by RSS, Wikidata only settles "individual human or not".
  - Until then it stays pending.

## 2. External verification actually reached
- Every coverage-pending proposal and every generic-typed RSS match is queued, highest Qloo rank first.
- The cap stays at 12 per analysis. `EXTERNAL_VERIFY_MAX` can set 1–30, but only after measuring.
- The response reports `funnel.externalQueued`, `externalChecked`, `externalOverCap` and `externalVerification.calls`, so the cost of a larger cap can be measured before changing it. Proposals beyond the cap say so; they are not dropped silently.

## 3. Spanish discovery
- **Likely cause** (cannot be confirmed without the raw LIVE responses):
  - guest identities need shared context, and an English Qloo description ("Mexican singer") shared no word with Spanish titles ("cantante mexicana");
  - the exact title search for the show found nothing;
  - only generic tags (Música, TV) matched, and Phase 6 stopped accepting them;
  
  so no signal was left.
- **Fixes:**
  - the identity context compares Spanish occupation and nationality words with their English forms (both sides; it only widens what counts as the same word);
  - tag queries are sent in English, and the Spanish or English word is accepted as an exact tag name;
  - exact show-title variants are tried.
- **Diagnostics.** `signalDiagnostics` records each lookup (guest results, podcast results per variant, tag results per query with a sample) and a verdict:
  - `none_in_qloo`: Qloo returned nothing;
  - `unrecognized`: results came back but matched nothing exactly or shared no context;
  - `ambiguous`: namesakes;
  - `ok`.

## 4. Rankings
- **Editorial band** (`EDITORIAL_BAND = 0.15`, fixed before any LIVE evaluation).
  - Qloo affinity (0.5 blend, unchanged) applies only to candidates whose editorial relevance is within 15% of the k-th best eligible candidate.
  - It can reorder comparable candidates, but never lift a clearly less relevant one above them.
  - It has no effect without LIVE affinity, so MOCK and baseline rankings are unchanged.
- **Neutral 0.5.** Kept for candidates Qloo cannot score, but only inside the band.
- **Diversity (MMR).** Unchanged. Out-of-band candidates are picked only when no band member is left.
- **What moved the ranking.** The comparison now names the effect:
  - Qloo discoveries (`newRelations`);
  - people we already had who entered through affinity (`affinityPromoted`);
  - baseline picks that left (`displaced`).
  
  Arms A/B/C/D are unchanged.

## Not verified here
- No LIVE call was made from this environment.
- The type contract comes from the official harness code, not from a recorded response.
- The ChatGPT Work LIVE report was not available to us.
