# Netlify: controlled LIVE test (prepared, not deployed)

Status on 2026-10-23: nothing is deployed and no key has been loaded.

## Architecture
| Endpoint | Function | Qloo | Access | Netlify rate limit |
|---|---|---|---|---|
| `POST /api/agent` | `netlify/functions/agent.ts` | **always MOCK** (reads no Qloo variable) | public | 60 / 60 s per IP |
| `POST /api/live` | `netlify/functions/live.ts` | LIVE only if all conditions below hold | bearer token | 6 / 60 s per IP |

LIVE requires all four conditions:
1. `QLOO_LIVE_ENABLED` is exactly `true`. Any other value keeps every request in MOCK.
2. `QLOO_API_KEY` is set.
3. A valid token. The server stores only `SHA-256(token)` in `LIVE_ACCESS_TOKEN_SHA256` and compares in constant time. Tokens must be at least 32 characters, and no token or hash is in the frontend.
4. The token has not used its hourly quota (`LIVE_MAX_ANALYSES_PER_HOUR`). This quota is held in memory per function instance, so it is a soft guard. The hard per-IP limit is the Netlify code-based rate limit, available on all plans.

Limits for each LIVE request:
| Setting | Default | Allowed range |
|---|---|---|
| Qloo calls per analysis | 80 | 1–200 |
| Qloo calls per diagnostic | 150 | 1–300 |
| Concurrency | 6 | 1–10 |
| Timeout per call | 8 s | 1–15 s |
| Total time per request | 45 s | 5–50 s; Netlify's synchronous limit is 60 s |
| Retries | 1 | only for 429, 5xx, network errors and timeouts |
| Private response cache | 1 h | — |

When a limit is reached, the analysis continues with fewer Qloo signals and reports it in `warnings` and `qlooMetrics`. It does not fail silently.

Measured performance, against a **simulated** Qloo (`npm run perf:sim`). This measures our orchestration, not Qloo's real latency:
| latency per call | concurrency 1 | concurrency 6 |
|---|---|---|
| 150 ms | 10.7 s (70 calls) | 2.3 s |
| 400 ms | 28.1 s | 6.0 s |
| 800 ms | 45.0 s (deadline reached, 57 calls) | 12.1 s |

## Create the project in Netlify
1. **Add new project → Import an existing project → GitHub → `FernandoDelgadoDiaz/Green-Room`.**
2. Build settings (also defined in `netlify.toml`):
   - Branch to deploy: `develop`
   - Base directory: *(empty)*
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
   - Node: `22`, set in `[build.environment]`
3. To avoid deploying yet: right after linking, go to **Project configuration → Build & deploy → Continuous deployment → Stop builds**.
4. Add the variables below. Then **Deploys → Trigger deploy** when we decide to deploy.

## Environment variables (Project configuration → Environment variables)
| Name | First value | Scope | Mark as secret |
|---|---|---|---|
| `QLOO_LIVE_ENABLED` | `false` (switch to `true` only for the test) | Functions | no |
| `QLOO_API_KEY` | the hackathon key, typed by you in the Netlify UI | **Functions** | **yes** |
| `QLOO_BASE_URL` | `https://hackathon.api.qloo.com` | Functions | no |
| `LIVE_ACCESS_TOKEN_SHA256` | the hash printed by `npm run live:token` | Functions | yes |
| `LIVE_MAX_ANALYSES_PER_HOUR` | `20` | Functions | no |
| `QLOO_MAX_CALLS_PER_ANALYSIS` | `80` | Functions | no |
| `QLOO_MAX_CALLS_PER_DIAGNOSTIC` | `150` | Functions | no |
| `QLOO_CONCURRENCY` | `6` | Functions | no |
| `QLOO_TIMEOUT_MS` | `8000` | Functions | no |
| `QLOO_DEADLINE_MS` | `45000` | Functions | no |
| `PROFILE_LOOKUP` | *(empty)* | Functions | no |

- Never use a `VITE_` prefix.
- The token itself is never stored in Netlify, only its hash.

## Controlled test, step by step
1. On your computer, run `npm run live:token`. Save the token in a password manager and put the hash in `LIVE_ACCESS_TOKEN_SHA256`.
2. Deploy with `QLOO_LIVE_ENABLED=false`, then open `https://<site>/?private=1` and type the token. Expected: "LIVE is switched off", and requests stay in MOCK.
3. Set `QLOO_LIVE_ENABLED=true` and redeploy (environment variables apply on a new deploy).
4. From your computer:
   - `npm run live:diagnose -- https://<site> status`
   - `npm run live:diagnose -- https://<site> auth`. This call is uncached; it confirms the key and whether `query.affinity` exists.
   - Then `t2`, `t4` and `t5` per show, or `all`. `all` makes 11 requests with pauses, so it stays under 6/min.
5. In the app, with `?private=1` and the token, analyses use LIVE. The badge shows LIVE and the results include `qlooMetrics`.
6. When finished: set `QLOO_LIVE_ENABLED=false` and redeploy, or remove the hash.

Diagnostic responses contain aggregate numbers and our own RSS names. They contain no Qloo descriptions, and never the key.

## Qloo REST access (evidence, consulted 2026-10-23)
- **Developer guide** (docs.qloo.com, "Qloo Agentic Hackathon Developer Guide", updated 2026-10-07):
  - "During the hackathon, all Qloo API endpoints are available."
  - It shows `curl -H "X-Api-Key: …" "https://hackathon.api.qloo.com/v2/insights?…"` and a Python `requests` example.
  - "Private server-side caching is fine".
  
  That is direct REST, with no harness.
- **Official kit** (github.com/qloo/qloo-hackathon-kit):
  - `docs/API_ACCESS.md` says "the supported surfaces are `qloo explore`, `qloo exec`, `qloo api`, and `qloo mcp`".
  - The sentence "Serverless functions are not a supported route" appears in the MCP starter. It refers to running `qloo mcp`, a stdio process.
- **Conclusion:** no rule found requires the harness for REST calls, and the guide documents direct REST. Green Room uses REST with `X-Api-Key` from a server function. The kit's wording about "supported surfaces" means "supported by the harness team", not a stated ban on REST. Asking on Discord #api-help is optional, not a blocker.
