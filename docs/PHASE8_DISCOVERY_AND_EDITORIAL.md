# Phase 8: unblocking discovery and measuring editorial value

Scope: only the problems confirmed by the Phase 7 LIVE validation. In this document, "measured" means real RSS feeds plus real Wikidata/Wikipedia responses (fixtures recorded 2026-10-23), with Qloo answers **scripted** from the names and tag strings the LIVE run reported. **Nothing here is a LIVE result.**

## 1. Spanish signals

### Tags rejected although Qloo returned the right concept
- **Root cause (confirmed by reproduction).** There were two problems.
  - Tag names were compared with `nameKey`, which keeps word boundaries. So `stand-up comedy` (our query) never matched `Stand Up Comedy` (Qloo's name).
  - When Qloo returned the same concept twice (for example `Artificial Intelligence` as a keyword and `artificial intelligence` as a genre), the rule `exact.length === 1` treated it as ambiguous and accepted nothing.
- **Fix.** Names are compared with `compactKey`, which drops case, accents, spaces and punctuation. Equivalent results are grouped, and up to 2 ids are kept, with provenance in `signalDiagnostics.tags[].acceptedIds`.
- **Unchanged.**
  - A result is accepted only when it matches the concept we asked for. `Comedy` or `Improv Comedy` are not taken for `stand-up comedy`.
  - Generic words (`musica`, `dinero`, `exito`, `amor`…) never become signals.

### Same-name guest records
- **Root cause.** Two Qloo records with the guest's exact name made the guest "ambiguous", even when only one of them shared context with the interview titles. That is the CREATIVO pattern: 24 of 25 with results, 1 accepted.
- **Fix.** `checkIdentity` confirms a record only when it has **strictly more** context evidence than every other same-name record. Ties and records with no evidence stay `pending/ambiguous`.

### Podcast names of the form "Host – Title"
- Example: Santiago Bilinkis – Futuro en Construcción. The exact-variant set now also includes the title after the dash, but only when the part before it is the host. Variants are still exact (no fuzzy matching), with at most 3 queries.
- **Not verified LIVE.** We don't know how Qloo names this podcast.

### Feeds without guest names
- The Bilinkis feed names a guest in under 5% of episodes. The agent does not invent guests. It goes to the podcast entity and the tags, and personInsights runs with `signalIds: []` and the accepted `tagIds`.

## 2. Why discoveries don't reach the top 5 (DOAC)

`AgentResult.discoveryPositions` gives, for every admitted Qloo proposal:
- Qloo rank, source and identity;
- theme fit, editorial relevance and Qloo affinity;
- whether it was inside the editorial band and whether its language was confirmed;
- what was **not measured**;
- the final rank and a concrete reason.

`AgentResult.cutoff` is the last pick.

Measured on DOAC (no affinity). The cutoff is Marc Andreessen, 0.675.

| Candidate | Outcome | Final rank | Fit / editorial | Reason |
|---|---|---|---|---|
| Andrew Yang | ranked | 96 | 0.44 / 0.44 | below cutoff; ceiling with max activity and recency 0.67 < 0.675: **topical gap, not missing history** |
| Saagar Enjeti | ranked | 184 | 0.35 / 0.36 | below cutoff |
| Joe Biden | ranked | 189 | 0.35 / 0.35 | below cutoff (ceiling 0.61); availability not assessed |
| Howard Schultz | ranked | 285 | 0.27 / 0.27 | below cutoff (ceiling 0.56) |
| Tulsi Gabbard | ranked | 452 | 0.35 / 0.23 | below cutoff (in RSS: low recency and momentum are measured, not imputed) |
| Dan Price | ranked | 1216 | 0.49 / 0.49 | language not confirmed (no P1412 in Wikidata) while ≥ 5 confirmed candidates exist |
| Steven M. Greer | discarded | — | — | off-theme: his own description is "American ufologist" |
| Lex Friedman | pending | — | — | resolves to Lex Fridman (Q76448707, via alias). Our only RSS record ("#2260 - Lex Fridman") has no context to prove it is the same person |

**Missing history.**
- For people outside our RSS, the base score is theme fit only. Momentum and recency are not imputed in either direction.
- The reason text gives a counterfactual ceiling, `0.6·fit + 0.25 + 0.15`, so a reader can tell when missing history *could* matter. For Yang, Biden and Schultz it would not.

**Band (0.15) and weight (0.5).**
- Unchanged. No generalizable evidence supported changing them, and changing them only to push a Qloo name into the top 5 is what this phase forbids.
- Affinity still reorders only within 0.15 of the k-th best eligible base score.

## 3. Thematic evaluation

Identity, pertinence, potential, affinity and availability are now separate.

- **Identity.** RSS evidence, or a documented Wikidata/Wikipedia record with shared context. Name variants resolve through Wikidata labels and aliases to a canonical name. A different person with the variant name (Lex Friedman, Q119266625) is not merged.
- **Pertinence.** Uses `pertinent(c) = themeFit ≥ 0.35 || establishedTheme(c)`.
  - `establishedTheme(c)` requires that the candidate's dominant theme holds ≥ 50% of their vector and is a show theme with ≥ 10% share.
  - This only widens eligibility; the score still uses cosine fit. That is why Schultz (business) is eligible but ranks 285.
- **External themes.** These come from the person's **own description** first, and from occupations only when there is no description.
  - Using every Wikidata occupation had pushed Greer to 0.62 through "physician". The Wikipedia extract is not used.
- **Editorial potential.** `assessment.editorialPotential` covers interviews and shows on record and a documented profile. Fame and affinity are not part of it.
- **Availability.** `assessment.availability = 'not_assessed'`. Nothing here says Joe Biden would accept an invitation.

## 4. Blind editorial evaluation

- The private `/api/live` action `{ "action": "editorial", "showId": "…" }` returns:
  - `sheetCsv` and `rubric`, to hand to raters;
  - a separate `key`, kept private, with the sheet's SHA-256.
- The set pools the baseline top 10 with every admitted Qloo proposal. Items are shuffled with random ids.
- Every item gets its description from **one identical Wikidata lookup**, so the description doesn't reveal the arm.
- **Known leak.** Qloo-only people have no interviews in our RSS. The key lists them in `qlooExternal`, so their ratings can be scored separately.
- Criteria: relevance, novelty, conversation potential, evidence sufficiency, repeat risk, language, would-invite.
- **No ratings exist yet.** None have been produced or simulated.

## 5. A/B/C/D

`compareArms` now reports:
- `originality.newToCorpus`: people from outside our RSS in the top list;
- `qlooImprovedTopWithNewPeople`;
- a `verdict` that says plainly when Qloo only reordered candidates we already had.

## Tests
`tests/phase8-discovery.test.ts` covers semantic tag duplicates with the observed strings, Spanish signals, missing guest names (real Bilinkis feed), the thematic cases, DOAC discovery positions, A/B/C/D attribution and the blind set.
