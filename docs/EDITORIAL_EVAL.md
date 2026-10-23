# Blind editorial evaluation (protocol, fixed 2026-10-23 before any rating)

Question: are the guests proposed **with** Qloo editorially better than those proposed **without** it? The historical backtest cannot answer this. A backtest hit only means the host later booked that person; it says nothing about relevance or originality. So the backtest is not used here.

## Lists
Both lists come from the same show, the same RSS data and the same repeat-guest rules, and both have 10 people.
- **A (without Qloo):** the agent's top 10 with Qloo off.
- **B (with Qloo):** the agent's top (10 − d) with live Qloo affinity, plus up to **d = 5** Qloo discoveries (people outside our sources), in Qloo's order.

## Blinding
- The two lists are pooled into one set, so a person proposed by both appears once. The set is shuffled and each person gets a random id.
- Every person gets the same evidence fields: our verified interviews (show, date, title, link). There are no scores, no source, no Qloo values and no list names.
- The key (which list each person came from) is written to `key.json`. Its SHA-256 is printed when the set is prepared, and the key is opened only by the scoring step.
- **Known leak:** Qloo discoveries have no verified interviews in our sources, so a rater may guess they came from B. That is why the results report items exclusive to A or B separately.

## What raters judge (per person)
| Field | Values |
|---|---|
| relevance | 1–5: fits what this show talks about |
| originality | 1–5: not an obvious, overexposed choice for this show |
| identity | ok / doubtful / wrong / unknown: is the person the rater finds the one meant? |
| language | yes / probable / no / unknown: can they do the interview in the show's language? |
| would invite | yes / no |

Raters may search the web. They should not see any Green Room screen while rating. Two or more raters are recommended.

## Steps
```bash
npm run editorial:prepare            # needs the Qloo key (env, `qloo setup --qloo`, or hidden prompt)
# give data/raw/editorial/<run>/sheet.csv to each rater; each returns <rater>.csv
npm run editorial:score -- data/raw/editorial/<run> ana.csv bruno.csv
```
Everything stays in `data/raw/` (gitignored).

## Reading the result
- Main contrast: **onlyB vs onlyA**, the people only one system proposed.
- B is better only if onlyB beats onlyA on relevance **and** originality by at least 0.5 points (1–5 scale), without a higher share of "identity wrong" or "language no".
- With 3 shows and 10 people per list, smaller differences are not meaningful.
- If raters disagree a lot, report "not conclusive".

## What to hand each rater (checklist)
1. `sheet.csv` from `npm run editorial:prepare`. This needs the Qloo key, because list B requires live Qloo.
2. This instruction text, and nothing else from Green Room:
   > "For each person, judge whether they would be a good guest for the named podcast. Use web search if needed. Score relevance (1–5) and originality (1–5: 5 = a non-obvious, fresh choice). Mark whether you are sure who the person is (ok / doubtful / wrong / unknown) and whether they could do the interview in the show's language (yes / probable / no / unknown). Would you invite them (yes/no)? Do not look at Green Room while rating."
3. A deadline. Each rater returns their own CSV, named `<rater>.csv`.

Raters must be **two or more real, independent people** who did not build Green Room. Until there are results, Green Room claims nothing about editorial superiority.
