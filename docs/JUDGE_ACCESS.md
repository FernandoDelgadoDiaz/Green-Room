# Judge access

What the rules say (qloo.devpost.com/rules, read 2026-10-23 and again 2026-10-25):
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

> **No login needed.** Open https://greenroom1.netlify.app and press **This Week in Startups** or **All-In** next to *See a live example*, or go straight to https://greenroom1.netlify.app/?show=this-week-in-startups.
>
> 1. **The five portraits are the answer.** Above them, switch between **Without Qloo**, **With Qloo** and **By audience taste · Qloo**: the same analysis with Qloo off, on, and ordered by Qloo alone. *New with Qloo* marks people who are not in the list without Qloo. When Qloo's own order is strong (five people with high affinity), it opens first.
> 2. **Read "Why these five"**, right below:
>    - what Qloo found out about the show's audience (age, gender and what else it likes);
>    - why each guest is here: their Qloo affinity, what they bring and how recent their last interview is;
>    - what the agent did, step by step, with this run's numbers.
> 3. **Read "What Qloo changed in this search"** (shown when Qloo changes at least 3 of the 5): who entered with Qloo and why, who left, and both lists measured the same way.
> 4. **Open "Prepare invitation"** on any guest card. It is a letter built only from that guest's evidence; you can edit it and open it in your email or WhatsApp. Nothing is sent from the app.
> 5. **Pick any other podcast.** Choose a country and a podcast, or search any show by name or link.
>    - The 24 catalog shows open instantly from a cached Qloo analysis made for judging (the banner says when it was computed).
>    - A podcast analyzed for the first time runs live against Qloo in the background and usually takes 20–90 seconds.
> 6. **Open "Data & method" → "How well Qloo knows each market"** to see, measured on our own live analyses, where Qloo knows a show's audience well (US) and where it doesn't (Argentina). Where Qloo does not know an audience, the results say so instead of guessing.
> 7. **Open "What the agent did"** for every step of the agent loop, and the discovery panel for every person Qloo proposed and why each one was kept or set aside.
>
> The app opens in English (add `?lang=es` for Spanish); the switch is at the top right. If Qloo is ever unavailable, the app says so and offers a retry; it never silently replaces live results with simulated ones. A clearly labeled demo without Qloo exists only if you choose it.
