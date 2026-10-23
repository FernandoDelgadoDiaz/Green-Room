# Demo script (≈ 3 minutes, three moments)

Recorded in Spanish or English with the language switch. Every number on screen comes from the app; nothing is said that the app does not show.

## 1. Understanding a podcast (≈ 50 s)
- Pick **The Diary Of A CEO**. The agent trace plays: it reads the official RSS feed, finds guest names, and infers the show's themes.
- Say: "It read N episodes from the public RSS feed. It found a guest name in about half of them; the rest have no name in the title. It tells you so instead of hiding it."
- Point at the themes panel: themes are inferred from titles, and each one shows the words that triggered it.

## 2. Unexpected guests via Qloo (≈ 70 s, requires LIVE in a private session)
- Open the site with `?private=1` and enter the access token. The badge turns LIVE.
- In the trace, show the step "Resolve past guests in Qloo": only guests whose identity is **confirmed with context** become taste signals; the rest are counted as unverified.
- Scroll to **"Unexpected guests found by Qloo"**. Say: "These are people Qloo associates with this show's past guests, and none of them appear in our sources. That is the discovery part. Identity and language come from Qloo only, so they are marked *pending verification*."
- Do **not** claim Qloo improves historical hit rates. It did not in our backtest (see the test report).

## 3. Justify every proposal with evidence (≈ 60 s)
- Open the first recommendation and click "View evidence": verified interviews with links, the identity check and the photo license.
- Point at the three status chips:
  - **history:** "not among the 256 identified guests; names found in 50% of episodes". It does not claim "never".
  - **language:** confirmed, probable or unknown, with the reason.
  - **identity:** confirmed in Qloo, or pending.
- Click "Prepare invitation": every sentence of the draft cites a verified appearance or a shared theme.
- Close with: "Green Room proposes and justifies; the producer decides and verifies."

## Before recording
- `QLOO_LIVE_ENABLED=true` only for the recording session, then back to `false`.
- If Qloo returns fewer than 3 confirmed identities for a show, the agent says so and continues without Qloo. Show that honestly, or demo another show.
