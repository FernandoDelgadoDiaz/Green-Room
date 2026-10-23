# Judge access to live Qloo (prepared, not active)

What the rules say (qloo.devpost.com/rules, read 2026-10-23):
- "Access must be provided to an Entrant's working Project for judging and testing."
- "If Entrant's website is private, Entrant must include login credentials in its testing instructions."
- The project must be available "free of charge and without any restriction … until the Judging Period ends."
- Judging period: Nov 2, 2026 12:00 ET to Nov 5, 2026 23:45 ET.

## Proposed setup (no paid services)
1. **The whole app stays public in MOCK mode.** Judges can use every screen without credentials: countries, catalog, agent trace and recommendations. MOCK values are labeled.
2. **LIVE Qloo through `/api/live` with a dedicated judge token.**
   - Run `npm run live:token` once for the judges; it must not be your personal token.
   - Add its hash to `LIVE_ACCESS_TOKEN_SHA256` (comma-separated, next to yours), so each token can be revoked on its own.
   - In Devpost's testing instructions: "Open https://greenroom1.netlify.app/?private=1 and enter the access token: …". The token appears only there.
3. **Limits.** Netlify allows 6 LIVE requests per minute per IP (code-based rule, available on all plans). Each analysis is capped at 80 Qloo calls and 45 s. `LIVE_MAX_ANALYSES_PER_HOUR=30` per token is held in each instance's memory, so it is a soft limit.
4. **Turn on** `QLOO_LIVE_ENABLED=true` on Nov 2 at the latest, and redeploy.
5. **Turn off** after Nov 5 23:45 ET: set `false`, remove the judge hash, redeploy.

## Risks to decide on
- **Rate limits vs. "without any restriction."** The per-IP and per-analysis limits protect the shared Qloo key, and MOCK mode stays fully open, so this seems reasonable. A strict reading of the rule could object. Recommendation: say it plainly in the testing instructions.
- **Who can see the testing instructions on Devpost** has not been verified. If they are public, anyone can use the judge token until it is revoked; the limits above bound the damage.
- **The Qloo key's quota** is the event's; ask in Discord #api-help if more headroom is needed.
- **The live behavior has not been verified from this environment**, which cannot reach hackathon.api.qloo.com. Test it on Netlify with your token before giving one to judges.
