# Judge access

What the rules say (qloo.devpost.com/rules, read 2026-10-23):
- Access must be provided to a working project for judging and testing.
- The project must be available "free of charge and without any restriction … until the Judging Period ends".
- Judging period: Nov 2, 2026 12:00 ET to Nov 5, 2026 23:45 ET.

## Setup for the judging period
- **No login.** The public demo at https://greenroom1.netlify.app uses the real Qloo API for every analysis, so judges need no token.
- **Cache warmed before judging (Nov 1).**
  - All 24 catalog shows are analyzed with Qloo once, and their results are cached for 7 days (`PUBLIC_CACHE_HOURS=168`).
  - Judges then see real Qloo results instantly. Opening a cached show costs no Qloo call.
- **Budget raised for Nov 2–5.**
  - `PUBLIC_DAILY_QLOO_CALLS` goes up from 300, the per-visitor cap goes up (`PUBLIC_FRESH_PER_IP_PER_DAY=10`) and the open-search allowance goes from 3 to 15 new podcasts a day (`PUBLIC_OPEN_FEEDS_PER_DAY=15`), so judges can analyze shows of their own.
  - The global Qloo call ceiling, one-at-a-time background jobs, the 429-aware pacing and the emergency pause stay on.
  - Qloo's own key quota: ask in Discord #api-help to confirm or raise it for the judging period, as the developer guide suggests.
- **After Nov 5 23:45 ET:**
  - set `QLOO_PUBLIC_ENABLED=false` and redeploy;
  - the key is deactivated by Qloo after the event anyway.

## Testing instructions (paste into Devpost)

> **No login needed.** Open https://greenroom1.netlify.app, or go straight to a live example: https://greenroom1.netlify.app/?show=all-in (also "All-In →" and "This Week in Startups →" on the home page).
>
> 1. **Pick a podcast.** Choose a country, then a podcast, and press **Analyze**. Or search any podcast by name or link; shows listed in Apple Podcasts whose episode titles name their guests can be analyzed.
>    - The 24 catalog shows open instantly from a cached Qloo analysis made for judging (the banner says when it was computed).
>    - A podcast analyzed for the first time runs live against Qloo in the background and usually takes 20–90 seconds.
> 2. **The five recommended guests come first**, as portraits; click one to jump to its card. Then read **"What Qloo added"**:
>    - who this show's audience is, according to Qloo (age and gender affinity);
>    - new people that only Qloo's taste graph surfaced, each verified (identity, theme, not a past guest, language);
>    - Qloo's cultural conversation hooks (music, films, books).
> 3. **Read the five guest cards.** They are people this show's audience knows (same country and the same kind of guest the show already interviews), with a verifiable interview track record. Each card shows:
>    - Qloo's read of the guest's audience: affinity to the show's audience (profile match and 12-week trend appear only when Qloo has them for that person);
>    - the evidence, with links;
>    - a draft invitation.
> 4. **Open "Data & method" → "How well Qloo knows each market"** to see, measured on every live analysis, how well Qloo knows US, UK, Mexican, Spanish and Argentine shows. Where Qloo does not know a show's audience, the results say so instead of guessing.
> 5. **Open "What the agent did"** to see every step of the agent loop, why it ran and how it re-planned. Open the discovery panel to see every person Qloo proposed and why each one was kept or set aside.
>
> The app opens in English (add `?lang=es` for Spanish); the switch is at the top right. If Qloo is ever unavailable, the app says so and offers a retry; it never silently replaces live results with simulated ones. A clearly labeled demo without Qloo exists only if you choose it.
