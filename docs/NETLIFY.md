# Netlify (prepared, not deployed)

Status on 2026-10-23: the configuration is in `netlify.toml` and nothing has been deployed. Linking the repository in Netlify starts a build, and that build is a deploy, so follow the order below.

## What the configuration does
- **Build:** `npm run build` (typecheck + Vite), publishes `dist/`, Node 22.
- **API:** `POST /api/agent` → Netlify Function `netlify/functions/agent.ts`. It uses the same handler as the dev server and returns 405 for anything but POST.
- **Headers:**
  - a CSP that allows only the site itself, Wikimedia images and Google Fonts;
  - `nosniff`, `Referrer-Policy`, `Permissions-Policy`;
  - `no-store` on `/api/*`.
- **SPA fallback:** `/* → /index.html`.

Checked locally on 2026-10-23:
- the function bundles with esbuild and answers `shows` and `recommend` (MOCK, ~30 ms), and returns 405 on GET;
- the built app renders recommendations in Chromium under this CSP with 0 violations.

## Environment variables (Site configuration → Environment variables)
| Name | Value | Scope | Secret |
|---|---|---|---|
| `QLOO_API_KEY` | hackathon key | **Functions only** | yes ("Contains secret values") |
| `QLOO_BASE_URL` | `https://hackathon.api.qloo.com` | Functions | no |
| `PROFILE_LOOKUP` | empty, or `0` to disable live Wikipedia lookups | Functions | no |

- Never use a `VITE_` prefix: Vite would embed the value in the browser bundle.
- Without `QLOO_API_KEY` the site runs in MOCK mode and says so.

## Order of steps (when we decide to deploy)
1. Netlify → Add new site → Import from GitHub → `FernandoDelgadoDiaz/Green-Room`, branch `develop`.
2. If you want to link without deploying: right after linking, go to Site configuration → Build & deploy → Continuous deployment → **Stop builds**. Then add the variables. Re-enable builds only when we decide to deploy.
3. Add the variables above before the first build.

## Open issues before a deploy (not fixed yet)
1. **Function timeout.** Synchronous functions stop at 10 s by default. In LIVE mode the agent makes about 70 Qloo calls one after another:
   - about 25 guest searches;
   - 3 cross-domain queries;
   - person insights;
   - up to 40 candidate searches;
   - the scoring call.

   That can exceed 10 s. It needs parallel calls with a concurrency limit, plus a server cache, before going LIVE. It has not been measured against the real API yet.
2. **The Qloo quota is exposed.** `/api/agent` is public and has no rate limit, so anyone can spend the event quota. It needs a limit per IP/session, or access protection, before LIVE.
3. **Hackathon rules.** The official kit lists the Qloo harness (`qloo explore/exec/api/mcp`) as the supported surfaces, and says its MCP server does not run on serverless. Green Room calls the documented REST API (`X-Api-Key`) from a function. Ask on Qloo's Discord (#api-help) to confirm this is allowed; the alternative is hosting the backend on a VM.
4. **Netlify secret scanning.** It fails the build if a secret value appears in the build output. The key is read only at runtime, from `process.env`, so this should not trigger.
