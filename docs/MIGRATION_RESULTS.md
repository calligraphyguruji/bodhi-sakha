# Migration results — 2026-10-23

## Audit summary

React/Vite already had one Vercel gateway plus duplicated standalone Express routing. Local scripts/Vite proxy and optional VITE_API_BASE_URL perpetuated the separate backend workflow; no tracked Render/Railway hosting configuration was found. Gemini-only retries, temporary production file storage, a default JWT secret, unawaited writes, oversized upload bodies, raw diagnostic responses and missing retry UI were the major findings. See [the pre-implementation report](MIGRATION_AUDIT.md) for the feature inventory and plan.

## Changes

**Created:**

- `lib/server/ai/{gemini,groq,http,aiRouter}.js`: supported HTTP APIs, bounded aborts, response validation, pre-output-only fallback and centralized orchestration.
- `lib/server/{errors,validation,personality,weather,uploads}.js`: structured/sanitized errors, limits, preserved prompt/weather logic, signed private-upload tickets.
- `src/services/chatResponse.js`: safe browser errors and SSE completion/failure parsing.
- `scripts/migrate-db.js`, `scripts/import-local-data.js`: explicit schema migration and transactional legacy-data import (validation-only unless --apply).
- `tests/{api,providers}.test.js`, `tests/browser.mjs`, `tests/helpers/providerFetch.js`: API/provider/security/partial-stream coverage and authored browser retry checks.
- `postman/mocks/providers/{default,groq}.cjs`, `postman/simulations/ai.sim.yaml`: repeatable local provider simulation fixtures.
- `docs/{MIGRATION_AUDIT,API,MIGRATION_RESULTS}.md`: audit, contract and handoff.

**Modified:**

- Gateway `api/index.js`: shared request limits, same-origin policy, persistent rate limits, normalized errors and safe health.
- Domain handlers `chat`, `auth`, `conversations`, `files`, `images`, `memory`; helper modules `auth`, `cors`, `db`, `memory`; `intent` lint corrections and `search` sanitized logging.
- `src/components/{Chatbot,ChatInput,ChatMessage}.jsx`, `src/services/aiService.js`, `src/utils/chatbotLogic.js`, `src/App.css`: same-origin requests, direct large uploads, session/navigation isolation, retry without duplicate turns, context preservation, timezone-aware canned date/time and a small error/retry presentation. Existing theme/layout/branding/assets retained.
- `package.json`, `package-lock.json`, `vercel.json`, `vite.config.js`, `eslint.config.js`, `.env.example`, `README.md` and both existing test files.

**Removed:** `server/server.js` (only redundant standalone listener). Removed runtime dependencies Express, cors, dotenv, multer and both unused/replaced Google SDKs. Neon tooling moved to devDependencies. Added private Blob runtime client and Vercel/Playwright development tooling. The .gitignore already protected .env/.env.local/.data/.vercel and needed no change. No existing local data or secret files were modified. Nothing was committed, pushed or deployed.

**Endpoints:** `/api/chat`, `/api/health`, `/api/auth`, `/api/conversations[/:id]`, `/api/memory[/:id]`, `/api/files[/:id]`, `/api/images` all go through the same Vercel function. Large-file prepare/token/finalize actions share `/api/files`; no second backend or duplicated API implementation was introduced. See [API contract](API.md).

## Provider behavior

Gemini first, Groq second; missing credentials skipped. Configurable models default to gemini-flash-latest and llama-3.3-70b-versatile. One attempt per provider, up to 18 seconds each (36-second text routing budget), zero repeated quota/auth/request retries. Empty, malformed, timed out, network and HTTP failures trigger fallback before output. Once a delta has been sent, a stream failure becomes a friendly SSE error; no provider mixing. Successful owned-conversation writes and request completion are transactional/idempotent. Memory extraction is optional and bounded, and awaited instead of abandoned after return. User errors are never inserted into later model context.

Gemini/Groq keys, database/JWT secrets and Blob token are server-only runtime values. The frontend uses relative API URLs. The browser Blob SDK contains the literal environment-variable identifier BLOB_READ_WRITE_TOKEN in shared SDK code; this is not a token value. The bundle scan found no actual secret values from existing local environments, no Gemini/Groq key identifiers, and no server AI endpoint URLs.

## Verification actually run

| Check | Result and scope |
| --- | --- |
| npm install | Initial network install failed (registry DNS blocked). Offline installation from existing local cache succeeded; lockfile updated. |
| npm run lint | Passed. Includes server/lib/scripts/tests/frontend. |
| npm run build | Passed; Vite output generated in dist. |
| npm test | Passed: 36 Node-reported tests, including nested cases, plus all 18 acceptance assertions in the existing evaluation script. |
| API handler checks | Passed in-process gateway tests: health/404/CORS, registration/login, ownership, upload ownership, attachment context, saved messages, idempotent retry, configuration failure and partial-stream error. No local HTTP listener was used. |
| Provider checks | Passed using synthetic serialized request/Response stream fixtures, with abort simulation. This is not real HTTP or live-provider evidence. |
| Browser retry test | Authored and attempted with installed Chrome. Browser launch aborted under sandbox permissions; no browser/UI pass claimed. |
| Vercel local development | Attempted. Fixed recursive dev script; subsequent project retrieval failed with fetch failed. Full Vercel dev routing remains unverified. |
| Postman simulation | Authored and attempted. Listener failed with EPERM on 127.0.0.1; no simulation request log or real HTTP pass claimed. |
| Secret/bundle and obsolete-host scan | No actual configured server secrets found in dist. No external backend host, override, Express import or listener remains in application code. Local loopback references are test/simulation documentation only. |
| git diff --check | Passed. |
| npm audit --offline --omit=dev | Cached result reported zero vulnerabilities; not a current online advisory audit. |
| CodeRabbit review | CLI present, signed out. No remote CodeRabbit review ran; source/diff inspection used. |

Commands ran on this machine's Node.js 26.5.1. Production is pinned to supported Node.js 24.x; exact Node 24 runtime verification remains outstanding. The static build does not compile/deploy Vercel functions. PostgreSQL schema/import/SQL counter behavior, Blob token/upload/finalization, Gemini/Groq credentials, model access, weather/search/image providers and live production deployment were not tested against real services. No production database changes were attempted.

## Remaining release actions

1. Configure Production/Preview/Development secrets in Vercel: GEMINI_API_KEY, GROQ_API_KEY, optional model overrides, DATABASE_URL, random JWT_SECRET and a connected PRIVATE Blob token. Enable model access/billing as needed.
2. Back up existing data; apply `npm run db:migrate` against the target database. If existing users live in local JSON, validate and transactionally import it before cutover. Preserve the existing real JWT secret, or require sign-in again when replacing the insecure default.
3. Review/commit/deploy from the repository with the correct Vercel root, Vite/dist and Node 24. Re-run browser, real Postman HTTP, Vercel dev and production smoke checks in an unrestricted environment.
4. Set temporary Blob lifecycle cleanup and Vercel Firewall abuse controls appropriate to the public deployment. Periodically delete expired database rate-limit rows. Request/body limits and distributed counters are implemented, but no claim is made of complete bot/DDoS protection.

Existing unpaginated resource responses can become too large with unusually large histories, especially repeated generated image data URLs; evaluate object storage/pagination if that workload is expected. Image attachments still carry filename/type context, not OCR/vision, as in the audited implementation. Pollinations fallback remains a third-party image dependency whose live availability was not verified. No required persistent service has been silently replaced with memory or temporary disk.

## Final source tree

Ignored runtime/development artifacts (`node_modules`, `dist`, `.git`, `.vercel`, `.data`, local .env files and agent directories) are excluded below; they were not deleted.

```text
basic-chatbot/
├── api/
│   └── index.js
├── docs/
│   ├── API.md
│   ├── MIGRATION_AUDIT.md
│   └── MIGRATION_RESULTS.md
├── lib/
│   └── server/
│       ├── ai/
│       │   ├── aiRouter.js
│       │   ├── gemini.js
│       │   ├── groq.js
│       │   └── http.js
│       ├── errors.js
│       ├── personality.js
│       ├── uploads.js
│       ├── validation.js
│       └── weather.js
├── postman/
│   ├── mocks/
│   │   └── providers/
│   │       ├── default.cjs
│   │       └── groq.cjs
│   └── simulations/
│       └── ai.sim.yaml
├── public/
│   ├── favicon.svg
│   └── icons.svg
├── scripts/
│   ├── import-local-data.js
│   └── migrate-db.js
├── server/
│   └── endpoints/
│       ├── lib/
│       │   ├── auth.js
│       │   ├── cors.js
│       │   ├── db.js
│       │   └── memory.js
│       ├── auth.js
│       ├── chat.js
│       ├── conversations.js
│       ├── files.js
│       ├── images.js
│       ├── intent.js
│       ├── memory.js
│       ├── rag.js
│       └── search.js
├── src/
│   ├── assets/
│   │   ├── hero.png
│   │   ├── react.svg
│   │   └── vite.svg
│   ├── components/
│   │   ├── AuthModal.jsx
│   │   ├── Avatars.jsx
│   │   ├── ChatInput.jsx
│   │   ├── ChatMessage.jsx
│   │   ├── Chatbot.jsx
│   │   ├── MarkdownContent.jsx
│   │   ├── MemoryModal.jsx
│   │   ├── SettingsModal.jsx
│   │   ├── Sidebar.jsx
│   │   └── TypingIndicator.jsx
│   ├── context/
│   │   ├── AuthContext.jsx
│   │   └── useAuth.js
│   ├── services/
│   │   ├── aiService.js
│   │   └── chatResponse.js
│   ├── utils/
│   │   ├── chatbotLogic.js
│   │   └── speechUtils.js
│   ├── App.css
│   ├── App.jsx
│   ├── index.css
│   └── main.jsx
├── tests/
│   ├── helpers/
│   │   └── providerFetch.js
│   ├── api.test.js
│   ├── assistant.test.js
│   ├── browser.mjs
│   ├── evaluation.test.js
│   └── providers.test.js
├── .env.example
├── .gitignore
├── LICENSE
├── README.md
├── eslint.config.js
├── index.html
├── neon.ts
├── package-lock.json
├── package.json
├── skills-lock.json
├── vercel.json
└── vite.config.js
```
