# Bodhi-Sakha chat failure audit — 2026-10-23

## A. Root cause and evidence

**The exact production trigger is not confirmed.** The screenshot's configuration message maps to `CONFIGURATION`, which several independent branches return. Production DNS lookup failed from this workspace; Vercel CLI metadata inspection did not return usable account/environment information. Neither dashboard settings, runtime logs, production credentials nor the deployed commit were verified. The local Vercel link names `basic-chatbot`; its relationship to the supplied `bodhi-sakha-phi.vercel.app` alias must be verified before deployment.

Confirmed repository defect: `lib/server/ai/aiRouter.js:routeAI` defaulted Groq to `llama-3.3-70b-versatile`. [Groq's current deprecation notice](https://console.groq.com/docs/deprecations) lists shutdown for free/developer tiers on August 16, 2026 (committed-spend enterprise contracts are excluded). Thus a primary-provider failure can encounter a retired fallback model. If both attempts are classified as provider configuration failures, `routeAI` returns `CONFIGURATION`/503. This is a confirmed obsolete default, not proof of the deployed account's model permissions or the reason Gemini failed.

A second confirmed path is independent of AI credentials:

`AIService.sendMessage` → `POST /api/chat` → `api/index.js:handler` → `consumeRateLimit` → `getPool` → missing `DATABASE_URL` → `allowLocalStore` → `CONFIGURATION`/503 → `readChatResponse` → chat error.

An automated regression reproduces this path with **both AI keys present**, confirms zero provider calls, and verifies the internal `DATABASE_URL_MISSING` diagnostic. Production deliberately disallows the development JSON store. Removing this check would weaken shared rate limiting and persistence; it has been preserved. A missing rate-limit table or unavailable database is now separately classified internally.

Other confirmed paths to the original message: neither usable provider key exists, or every attempted provider returns an auth/model configuration failure. Previously HTTP 400, 401, 403 and 404 were collapsed into one provider configuration category. Invalid requests were also unnecessarily sent to the fallback provider. The fix distinguishes these conditions without returning provider bodies to the browser.

The new preflight loaded with local `.env` and `.env.local` reported `JWT_SECRET_MISSING` and `AI_KEYS_MISSING`; it did not report `DATABASE_URL_MISSING`. These are **local** findings. The preflight checks value presence/shape, not credential validity, database connectivity, schema or Vercel configuration.

## Request lifecycle and repository audit

| Area | Finding |
| --- | --- |
| Frontend | React 19, Vite 8, ESM JavaScript; build script `vite build`, output `dist`. No configured type-check script or TS application checking. |
| UI submission | `src/components/Chatbot.jsx:handleSendMessage` guards concurrent sends, creates stable retry IDs, retains failed user turns and attachment/context snapshots, sets a 58-second abort timer and clears busy state in `finally`. |
| Frontend transport | `src/services/aiService.js:sendMessage` uses relative `/api/chat`, same-origin headers, JSON body and SSE response mode. No external AI backend URL. |
| Deployment routing | `vercel.json` selects Vite, rewrites `/api/(.*)` to `/api/index.js` before the SPA catch-all, and assigns the Node function a 60-second maximum. `package.json` selects Node 24.x. Existing routing was retained. |
| Function gateway | `api/index.js` imports server handlers, applies same-origin CORS policy, checks method/content type, bounds/parses streamed or pre-parsed JSON, authenticates private resources and applies PostgreSQL rate limits. |
| Chat handler | `server/endpoints/chat.js` validates input, checks owned conversations, handles idempotent requests, retains local responses/weather/RAG/search/attachments, invokes the AI router, streams results and persists owned turns. |
| AI setup | Native Node `fetch` adapters, no Gemini/Groq SDK to initialize or migrate. No new runtime dependency was introduced. |
| Gemini | `lib/server/ai/gemini.js` uses Google's `v1beta/models/{model}:generateContent` or `streamGenerateContent?alt=sse`, `x-goog-api-key`, user/model contents, system instruction and candidate text extraction. Default remains documented `gemini-flash-latest`. |
| Groq | `lib/server/ai/groq.js` uses Bearer authentication and `/openai/v1/chat/completions`, maps the same bounded messages/system context, and extracts JSON/SSE choices. Default is now supported `openai/gpt-oss-120b`. |
| Fallback/timeouts | One attempt per available provider, Gemini first; 18 seconds per attempt, 36-second routing budget. Recoverable failures can switch before output; invalid request errors stop. A partial stream cannot switch providers or send `done` after failure. |
| Public errors | Structured JSON status/code/message/retryable errors before streaming, SSE error events after output. Fixed friendly messages; raw upstream details never returned. Missing API routes/HTML SPA responses become client connection errors. |
| Feature preservation | Theme, sidebar, history, auth, attachments, Deep Thinking, speech and responsive CSS retained. Database, Blob uploads, image generation, weather and web search services retained. They are not replaced by the text fallback. |
| Diagnostics | Server-generated UUID in `X-Request-ID`; AsyncLocalStorage correlates request start/end, attempt start/success/failure, missing keys, fallback, status and duration. Fixed categories distinguish auth, model, quota, timeout, malformed response, network and storage errors. No prompts, headers, keys, tokens, provider bodies or stack traces are logged by these diagnostics. |

## B. Files modified

| File | Purpose |
| --- | --- |
| `.env.example` | Update default Groq model. |
| `README.md` | Update model, diagnostics and troubleshooting instructions; link this audit. |
| `api/index.js` | Add request diagnostics and reject unsupported chat methods before spending the database/provider path. |
| `docs/API.md` | Update friendly error examples, BOTH_UNAVAILABLE and request-ID/fallback contract. |
| `docs/CHAT_FAILURE_AUDIT.md` | Record evidence, changes, verification and deployment requirements. |
| `lib/server/ai/aiRouter.js` | Replace retired fallback default, log attempts/missing keys/fallback, stop on invalid requests, distinguish both-provider outage. |
| `lib/server/ai/http.js` | Classify auth/model/quota/request/timeouts/network/invalid JSON; inspect error text only internally. |
| `lib/server/errors.js` | Friendly public messages and correlated safe diagnostics. |
| `lib/server/validation.js` | Allow provider-key validation against an explicitly supplied environment for preflight checks. |
| `lib/server/configuration.js` | Value-free checks for production prerequisites and retired Groq overrides. |
| `lib/server/diagnostics.js` | Request context, correlation ID, structured event logging and final outcomes. |
| `package.json` | Add `check:production-config`; dependencies unchanged. |
| `scripts/check-production-config.js` | Exit nonzero with category names if configuration prerequisites are absent. |
| `postman/mocks/providers/default.cjs` | Model missing/model errors and invalid provider requests distinctly. |
| `server/endpoints/chat.js` | Mark SSE failures for accurate final outcome logs even after HTTP 200 headers. |
| `server/endpoints/lib/db.js` | Identify missing URL, schema and database availability errors while preserving fail-closed behavior. |
| `src/services/chatResponse.js` | Friendly messages and connection handling for missing routes/HTML responses. |
| `tests/api.test.js` | Add method/JSON validation and production database prerequisite/log-privacy regression. |
| `tests/configuration.test.js` | Test preflight and provider error classification. |
| `tests/providers.test.js` | Check new fallback model, model-not-found, invalid-request termination and missing-route handling. |
| `tests/browser.mjs` | Update failed-response history assertion to match the new error copy. |

## C. Vercel environment variables

| Exact name | Type / target | Requirement |
| --- | --- | --- |
| `GEMINI_API_KEY` | Secret / Production | Real Gemini API credential, server only. |
| `GROQ_API_KEY` | Secret / Production | Real Groq credential, server only; needed for independent fallback. |
| `DATABASE_URL` | Secret / Production | Reachable PostgreSQL connection with migrated schema, including `rate_limits`; required even for guest AI requests. |
| `JWT_SECRET` | Secret / Production | Stable random signing secret of at least 32 characters for accounts/sessions. Existing `AUTH_SECRET` alias is supported. |
| `GEMINI_MODEL` | Config / Production, optional | Default `gemini-flash-latest`; verify availability for the account. |
| `GROQ_MODEL` | Config / Production, optional | Remove an obsolete override or set `openai/gpt-oss-120b`; a deployed override takes precedence over the code default. |
| `BLOB_READ_WRITE_TOKEN` | Secret / Production | Existing private Blob store credential, needed for direct large-file uploads. |
| `IMAGE_API_KEY`, `IMAGE_MODEL` | Secret, Config respectively / Production, optional | Existing image-only overrides, independent of text fallback. |

[Vercel's current Config/Secret documentation](https://vercel.com/docs/environment-variables/sensitive-environment-variables) says Config values are readable and Secret values write-only after saving; legacy Sensitive variables continue working as Secrets. These classifications do not change application variable names or require an SDK/decryption step. Server reads remain `process.env.GEMINI_API_KEY` and `process.env.GROQ_API_KEY` via `providerKey`. [Vercel environment documentation](https://vercel.com/docs/environment-variables) explains deployment/environment scope and redeploy requirements. Save secrets in the project owning the production alias, target Production, then create a new deployment; changing dashboard settings does not update an existing deployment.

No `VITE_` or `NEXT_PUBLIC_` provider secret references were found in `src`. Only `.env.example` is tracked; real env files remain ignored. The built JS scan found neither actual local secret values (12+ characters) nor AI key names/provider endpoint references. This is a bounded scan of the current build, not a historical secret audit.

## D–F. Provider and build verification

| Check actually executed | Result |
| --- | --- |
| Baseline `npm test` | 36 passed, 0 failed. |
| `npm ci --offline --no-audit --no-fund` | Succeeded; 606 packages installed. Node 26 engine warnings; expected Node target is 24.x. |
| Final `npm test` | **41 passed, 0 failed**. Dummy credentials and serialized provider fixtures only; no paid AI requests. |
| `npm run lint` | Passed. |
| `npm run build` | Passed; Vite production output in `dist`. |
| Type checking | No configured script; not claimed. |
| `git diff --check` | Passed. |
| Client secret/reference scan | Passed for current bundle and locally available env values. |
| Production preflight, env files loaded | Failed as expected: local `JWT_SECRET_MISSING`, `AI_KEYS_MISSING`. Production not inspected. |
| Postman CLI 1.75 simulation | Existing `postman/simulations/ai.sim.yaml` attempted; cannot bind `127.0.0.1` (`EPERM`). No HTTP simulation pass claimed. |
| Playwright browser test | Missing bundled Chromium; system Chrome fallback also failed to launch under sandbox restrictions. No browser pass claimed. |
| Function source import | Passed as part of gateway tests. |
| Vercel dependency tracing | `@vercel/nft` traced 638 files. Warnings for `unpdf` import.meta parsing and optional `pg-native`/`cloudflare:sockets` resolution; this is not a full Vercel build. Validate uploads in deployment. |
| CodeRabbit CLI review | CLI 0.7.6 present, signed out; remote review not run. Authentication command: `coderabbit auth login`. Local diff reviewed instead. |
| Production access | curl hostname resolution failed; web health access failed; CLI `whoami`/Production env metadata did not yield usable data. No deployment or provider-live test performed. |

Gemini tests: primary success, context serialization, JSON/SSE, missing key, rate limit, auth, model error/404, timeout, service failure, network/HTML errors, malformed/empty output and partial stream.

Groq tests: independent success with Gemini key absent, fallback after primary failures, supported model payload, missing fallback key while Gemini succeeds, and both-provider failure outcomes. Invalid input returns 400; unsupported methods return 405. Gateway tests preserve owned history, attachment context and idempotent retries. Frontend response-parser tests cover network errors, missing routes, HTML routing errors and truncated SSE. Browser behavior is source-audited and has a retained runnable browser test, but was not executed successfully here.

Postman/Orbit discovery and integration returned a Gemini multi-turn REST contract with a stale model example. The existing fixtures are locally authored from vendor formats, not provider-owned published mocks. Official vendor documentation was used for current model selection and the supported `x-goog-api-key` header. No shared Postman resource was published or altered.

## G. Deployment and production verification steps

1. Verify the Vercel project owning `https://bodhi-sakha-phi.vercel.app`; do not assume the local `basic-chatbot` link owns that alias. Use `npx vercel inspect https://bodhi-sakha-phi.vercel.app` in an authenticated, network-enabled shell, or inspect Domains in the dashboard.
2. In that project's Settings → Environment Variables, verify all required variables above target **Production**, with secrets stored as **Secret**. Do not print their values. Remove/update any retired `GROQ_MODEL` override. Leave `ALLOW_LOCAL_DB` disabled in production.
3. With the intended environment securely injected, run `npm run check:production-config`. For a local check only: `node --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/check-production-config.js`. A pass only establishes the preflight's presence/shape checks.
4. Verify PostgreSQL schema and apply the existing `npm run db:migrate` when required, with the intended database URL injected. Test migration on an isolated database/branch first; do not use local JSON as production storage. Existing account/history data must be preserved.
5. On Node 24, run `npm ci`, `npm run lint`, `npm test`, `npm run build`. In a shell that allows localhost servers, start `postman simulation run postman/simulations/ai.sim.yaml --port 4900 --output ndjson`, then run `SIM_URL=http://127.0.0.1:4900 node --test tests/providers.test.js`; confirm both members receive request events. Install Playwright Chromium if necessary and run `npm run test:browser`.
6. Deploy the changed revision through the correct project's existing Git deployment workflow, or use `npx vercel deploy --prod` **after verifying the project link**. Keep Vite, output `dist`, Node 24.x, the existing API-first rewrites and the 60-second function maximum. Environment edits require a new deployment.
7. Confirm `/api/health` responds, then send a synthetic non-local prompt such as `Help me debug code` through the production UI. Health alone is not provider readiness. Confirm a complete AI response and inspect Runtime Logs with the response's `X-Request-ID` for provider success.
8. On a separate Preview deployment, verify Gemini alone and Groq alone with appropriate secret scope, then deliberately cause a Gemini failure to verify Groq fallback. Do not mutate production secrets to test outages. Mocked tests already cover the failure matrix without paid calls.
9. Verify retry without duplicate turns, signed-in persisted history, dark/light mode, attachments (including large-file upload), Deep Thinking and voice on the deployed application. Check Network tools for relative `/api/chat` and JSON/SSE rather than an HTML SPA response.

## H. Remaining conditions

Production root trigger, Production variables, credentials, model permissions/quota, schema readiness, Vercel packaging, deployed alias and end-to-end chat remain unverified. Updating the default model fixes the confirmed repository defect, but cannot supply missing Vercel secrets, migrate an inaccessible database or fix an overriding dashboard model value. No successful deployment is claimed.
