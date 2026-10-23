# Bodhi-Sakha (बोधिसखा)

React/Vite frontend and Node.js Vercel Functions in **one Vercel project**. Gemini is the primary text provider; Groq automatically takes over when Gemini is missing, unavailable, rate limited, times out or returns invalid output. No Express process or separately hosted backend is required.

Created by Mr. Aman Mishra. [Pre-migration audit](docs/MIGRATION_AUDIT.md) · [API contract](docs/API.md) · [Verification and changes](docs/MIGRATION_RESULTS.md)

## Architecture and preserved features

```text
Browser → Vercel static React frontend
        → /api/* → api/index.js → domain handlers
                              → Gemini → Groq fallback
                              → PostgreSQL (durable data + rate limits)
                              → private Vercel Blob (temporary large uploads)
```

The existing interface, saffron branding, themes, responsive sidebar, conversation search/rename/pin/archive/delete API, Markdown/LaTeX, English/Hindi/Hinglish personality, voice input/playback, document Q&A, deep thinking, educational intent/RAG, weather and web search remain. Signed-in users retain database-backed conversations and personal memories; guest sessions stay browser-local and disappear on reload, as before. Deep Thinking asks the configured provider for a carefully checked final answer; provider capabilities and quality differ, and internal chain of thought is never requested for display.

The retained domain handlers live under `server/endpoints/`; that directory contains function code, **not a running server**. One function gateway keeps deployment small. `/api/chat`, `/api/health`, `/api/auth`, `/api/conversations`, `/api/files`, `/api/memory`, `/api/images` share the frontend's origin. API rewrites precede the SPA fallback. Static output is `dist`; Node.js **24.x** is pinned for Vercel.

Persistent data still needs PostgreSQL (for example a Vercel Marketplace Neon integration). A serverless deployment does not remove that dependency. No production in-memory/file database or rate limiter is used. Existing Neon tooling configuration is retained.

## Installation and local development

Use Node.js 24 and npm:

```bash
npm ci
cp .env.example .env.local
```

Fill `.env.local` locally without committing it. Add your AI keys, a random JWT secret of at least 32 characters, and PostgreSQL URL. Generate a secret with `openssl rand -hex 32` and copy its result directly into your secret manager/environment.

```bash
npm run db:migrate
npx vercel login
npm run dev:full
```

`dev:full` runs `vercel dev`, serving React and functions together. Link the existing Vercel project when prompted. Vercel's Development Command must be `vite --port $PORT` (already in `vercel.json`), never `vercel dev`. `npm run dev` runs only Vite for isolated UI work; it does not provide APIs. `npm run preview` previews the static build only.

For explicitly local-only JSON development instead of PostgreSQL, leave `DATABASE_URL` empty and set `ALLOW_LOCAL_DB=true`. Data stays in `.data/db.json` or the absolute `LOCAL_DATA_DIR`. Production rejects this mode. Local JSON mode does not simulate shared production rate limits.

## Environment variables and provider setup

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Server-only Gemini key from [Google AI Studio](https://aistudio.google.com/apikey) |
| `GROQ_API_KEY` | Server-only Groq key from [Groq Console](https://console.groq.com/keys) |
| `GEMINI_MODEL` | Default `gemini-flash-latest`; choose an available model for your account |
| `GROQ_MODEL` | Default `llama-3.3-70b-versatile`; configurable without client changes |
| `DATABASE_URL` | Required production PostgreSQL URL, preferably pooled, with verified TLS |
| `JWT_SECRET` | Required random signing secret, at least 32 characters |
| `BLOB_READ_WRITE_TOKEN` | Private Vercel Blob token; required for uploads over 3 MB |
| `IMAGE_API_KEY` | Optional image provider key; otherwise uses Gemini key |
| `IMAGE_MODEL` | Optional Gemini image model; default `gemini-3.1-flash-image` |
| `AUTH_SECRET` | Legacy JWT secret alias, retained for existing deployments; prefer `JWT_SECRET` |
| `ALLOW_LOCAL_DB`, `LOCAL_DATA_DIR` | Explicit local-development database settings only |

Enable API access/billing and sufficient quotas for the chosen models. Configure both AI keys to obtain fallback. One configured key works alone; neither configured key returns a friendly configuration error for AI requests. Canned identity/greeting/date/weather-location prompts do not require an AI call. Server secrets are read at runtime. Never use `VITE_` for any secret. `VITE_API_BASE_URL`, `PORT`, `CLIENT_ORIGIN`, and the previous adjustable chat limits are no longer used. Remove obsolete deployment variables.

The provider adapters use Google's and Groq's supported HTTP APIs, so no AI SDK or new server framework is required. Both providers receive the same assistant personality, bounded history, document context and educational instructions. Groq's supported default is documented in [Groq's model reference](https://console.groq.com/docs/model/llama-3.3-70b-versatile); Google's model aliases are documented in [Gemini models](https://ai.google.dev/gemini-api/docs/models).

Each provider gets **one attempt** with an 18-second deadline, including reading its response; the text routing budget is 36 seconds. There are zero automatic same-provider retries, including for 429/authentication/invalid-request errors. Gemini is skipped when its key is missing. Groq receives the original context when fallback is needed. After a response delta is sent, providers are never switched. The browser receives explicit SSE error/completion events and can retry manually without inserting another user message. The request ID is reused; PostgreSQL claims/transactions return an already completed answer and prevent duplicate saved turns. A concurrent pending request returns 409; stale claims can be reclaimed after two minutes.

## Documents and image features

PDF, DOCX, TXT, CSV, JSON, PNG, JPEG and WebP remain accepted up to **15 MB**. Files up to 3 MB use inline JSON. Larger files upload directly to a **private Vercel Blob store**, then the function fetches the signed pathname and extracts text. This avoids Vercel's [4.5 MB function request/response limit](https://vercel.com/docs/functions/limitations). Never connect a public store for private documents.

1. In Vercel Storage, create a **private** Blob store and connect it to this project/environments.
2. Confirm `BLOB_READ_WRITE_TOKEN` is available to the function.
3. Redeploy and test a file above 3 MB.

Ten-minute signed upload tickets constrain identity, pathname and maximum size. Logged-in files can attach only to owned conversations. Guest tickets are bearer capabilities and should not be shared. The app persists extracted text/metadata, not original documents; attachment names and context remain available in saved conversations. Images remain filename/type attachments, matching the previous implementation: image OCR/vision was not implemented. The previously returned image data URL is no longer echoed or persisted, preventing multi-MB upload responses; existing stored data is untouched. Temporary Blob objects are deleted after processing. Abandoned/failed uploads can remain: configure store lifecycle cleanup for the `temporary/` prefix, or periodically remove expired objects using trusted storage tooling. Do not treat Blob as the durable conversation database.

Authenticated image-generation prompts such as “Generate an image of a futuristic city” now use the existing image flow. The image provider has a 25-second timeout and configurable model. The existing Pollinations image URL fallback remains; it receives the image prompt and is an external service, with availability outside this app's control. Groq fallback covers **text**, not image generation. Verify image model access and fallback rendering before release. Large generated image histories may require separate image object storage/pagination in deployments with heavy image use.

## Deploy to Vercel

1. Import the existing GitHub repository into Vercel. If the GitHub root contains `basic-chatbot/`, set **Root Directory** to `basic-chatbot`; if its root already has `package.json`, use the repository root.
2. Select **Vite**, Node.js **24.x**, build command `npm run build`, output `dist`. Keep `vercel.json`; do not add an Express/custom-server start command or a second backend project.
3. Connect a PostgreSQL database and a **private** Blob store. Retain the current PostgreSQL database if it already holds user data.
4. Go to **Vercel Dashboard → Project Settings → Environment Variables**. Add `GEMINI_API_KEY`, `GROQ_API_KEY`, `GEMINI_MODEL`, `GROQ_MODEL`, `DATABASE_URL`, `JWT_SECRET`, and the connected `BLOB_READ_WRITE_TOKEN`. Set appropriate values for Production, Preview and Development. Use a separate preview database/store where possible. Keep the JWT secret stable across deploys to preserve valid sessions; replacing the old hardcoded fallback requires users to sign in again.
5. Run `npm run db:migrate` from a trusted environment with the target `DATABASE_URL`. It creates missing tables/indexes, including `chat_requests` and `rate_limits`; it does not delete existing tables. Apply migrations before sending traffic to the new code. Builds never migrate the database.
6. If local JSON contains real users, follow the import procedure below **before** cutover. Do not discard it or use `/tmp` as a production database.
7. Deploy/redeploy so functions read the new environment values. Git changes are intentionally not committed or pushed by this migration task. When ready, review and commit them yourself; Vercel can then deploy that commit from GitHub.
8. Check `/api/health`, sign in/register, send an AI message, reload saved history, test retry with an unavailable primary, test a 15 MB supported document, and test image generation. Open a frontend route and an unknown `/api/...` path: the former should serve the SPA; the latter must return JSON 404.

No separate Render/Railway/Node backend is needed. The database, AI providers, Blob, weather/search/image providers remain external dependencies. A successful static build does not establish live API credentials, SQL connectivity, Blob permissions or model access.

### Preserve an existing local JSON database

Back up `.data/db.json` and the target PostgreSQL database. Stop writes during cutover. Configure the target `DATABASE_URL` in `.env.local`, then:

```bash
npm run db:migrate
npm run db:import -- --file=/absolute/path/to/db.json
npm run db:import -- --file=/absolute/path/to/db.json --apply
```

The first import invocation validates/counts only; the second inserts accounts, password hashes, conversations, messages, memories, uploads and timestamps in one transaction. The source file remains untouched. Duplicate keys/emails or invalid foreign keys abort and roll back the entire import; this is deliberately not a merge tool. Already-PostgreSQL deployments need only the additive schema migration. Old ephemeral `/tmp` data cannot be recovered from terminated function instances; verify what exists before switching traffic.

## Verification

```bash
npm run lint
npm run build
npm test
npx playwright install chromium
npm run test:browser
```

The Node suite uses synthetic provider HTTP response contracts without credentials. It covers primary success, timeout, quota/auth/server/network/HTML/empty/malformed failures, missing keys, fallback, pre-stream fallback, partial stream failure, context, request validation, user isolation and persistence idempotency. Test databases are isolated temporary directories; tests never load `.env.local` or production credentials. Browser tests intercept API requests and test send/retry/history/duplicate behavior against the built UI. Build first. For an installed Chrome, set `CHROME_PATH` to its executable instead of downloading Chromium.

For real HTTP verification against Postman mocks (CLI 1.70+), use two terminals:

```bash
postman simulation run postman/simulations/ai.sim.yaml --port 4900 --output ndjson
SIM_URL=http://127.0.0.1:4900 node --test tests/providers.test.js
```

The fixtures are derived from the official provider response formats; they are locally authored, not owner-published mocks. No authenticated owner workspace was available. Orbit discovery found a Gemini streaming reference but an outdated model example; the vendor docs were used for the actual configuration. Inspect simulation request events to confirm both providers were reached. Nothing is pushed to Postman or deployed publicly. The default test transport fallback is **not** real HTTP evidence.

See [verification results](docs/MIGRATION_RESULTS.md) for checks actually run in this workspace, including sandbox/network limitations.

## Security and troubleshooting

- Secrets and `.env*` are ignored, with `.env.example` the only exception. No AI key is referenced by React. Health exposes no configuration, provider output or credentials. Logs contain only scope/code/status, never prompts, keys, upstream errors or stack traces.
- Gateway rejects cross-origin browser requests; bearer authorization remains required for private CRUD. CORS is not protection against scripts or direct API callers. SQL queries are parameterized and scoped to owners. Invalid/absent JWT configuration cannot mint tokens. Existing bearer tokens remain in localStorage; preserve the CSP and avoid untrusted scripts because XSS could read them.
- Production rate limits are PostgreSQL-backed atomic counters: 10 authentication requests, 20 combined chat/image/file calls, and 120 other API calls per identity per minute. Guest identities use Vercel's forwarded client IP; signed-in identities use user ID. Multi-step large uploads consume several calls. Enable Vercel Firewall rules for volumetric attacks, bot traffic and account creation abuse before a public launch. Database limits alone cannot stop bandwidth floods or attackers rotating identities/IPs. Periodically remove expired `rate_limits` records.
- Limits: 4.25 MiB gateway JSON, 512 KB chat JSON, 4,000 message characters, 12 retained history entries × 2,000 characters, 15,000 characters per attached context source, 30 memory facts, 4,096 maximum generation tokens and 65,536 output characters. Oversized input is rejected or bounded before generation; invalid input does not reach providers. Treat retrieved documents/web text as untrusted data. Generated advice is model output, not trusted application instructions.
- **Configuration error / 503:** add real AI keys; verify PostgreSQL/JWT configuration; migrate SQL schema; redeploy. Missing database configuration intentionally fails closed for data/limited API routes.
- **429:** wait a minute. If the provider quota is exhausted, fallback is attempted once; don't repeatedly retry. The browser offers a manual Retry button where appropriate.
- **Timeout / partial answer:** the interface keeps the original user message and partial text with an error. Retry replaces the failed bot slot. Provider output never becomes raw error text in model history.
- **Large upload fails:** verify the Blob store is private, the token is connected, the ticket has not expired and the file is supported and ≤15 MB. Extraction of damaged/encrypted PDFs or DOCX may fail safely. Small uploads work without Blob.
- **SQL TLS error:** use your provider's pooled URL and CA/TLS instructions. Certificate verification is not disabled to hide errors. Check connection limits if scaling many function instances.
- **`vercel dev` recursion:** restore Development Command to `vite --port $PORT`, and keep `npm run dev` as `vite`.
- **Old backend URL:** remove `VITE_API_BASE_URL` and custom proxy overrides, then rebuild/redeploy. All client requests use `/api/...`.
- **Voice unavailable:** browser speech support/permissions vary. Voice remains a browser integration, not a WebSocket backend requirement.

MIT License.
