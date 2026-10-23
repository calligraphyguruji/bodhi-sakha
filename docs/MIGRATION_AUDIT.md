# Pre-implementation audit — 2026-10-23

Scope: tracked application, API, server, tests, package/build/deployment files; environment **names** only. Codebase graph tools unavailable: source inspection used instead. No existing user edits reported by git.

## Architecture and feature inventory

- React 19 / Vite 8, JavaScript ESM; single chat screen, responsive sidebar, themes, modals, Markdown/LaTeX, speech input/output, local greeting/date/time/creator answers.
- Express `server/server.js` duplicates routing already present in `api/index.js`. Production rewrites already route all APIs through one Vercel function. Development scripts and Vite proxy still require port 5001. `VITE_API_BASE_URL` permits split deployments. No Render/Railway hosting configuration found in tracked files.
- `/api/chat`: Gemini-only multi-model retries, text/plain streaming, bilingual/Hinglish system prompt, deep thinking, educational intent/RAG, DuckDuckGo search, wttr.in weather, file context, personalized memory and message persistence.
- `/api/auth` (register/login/logout/me), `/api/conversations` (list/search/create/detail/rename/pin/archive/delete), `/api/memory` (list/add/delete/clear), `/api/files` (upload/delete), `/api/images` (authenticated image generation). JWT bearer sessions in browser localStorage, bcrypt passwords, PostgreSQL ownership queries.
- Database stores accounts, conversations, messages, memories, extracted file text and image data URLs. Without DATABASE_URL it silently uses `.data/db.json`, or ephemeral `/tmp` on Vercel. Existing local data must be preserved and explicitly imported before a production cutover.
- Images are accepted as attachment metadata, not passed to Gemini vision. Image-generation endpoint/service/rendering exist, but the chat send flow never invokes them. Existing image endpoint uses Imagen 3 and a Pollinations URL fallback; neither is verified live.
- No WebSockets, jobs, background scheduler, or separate upload service found. Auto memory extraction and chat writes are unawaited promises, unsafe once serverless execution ends.

## Findings

1. Critical: hardcoded JWT fallback permits forged sessions when the secret is missing. Auth errors include raw exception details.
2. Critical: ephemeral production JSON store loses accounts/history and diverges between function instances. SQL initialization only runs in Express, not Vercel. TLS certificate verification is disabled.
3. Gemini errors can leak raw diagnostics through GET /api/chat and nonproduction error responses. No Groq fallback, no generation deadline, repeated quota/model discovery calls can exceed function duration.
4. Partial streamed failures end silently; frontend inserts error text as ordinary assistant history, has no retry, duplicates current user context and permits navigation/races while requests stream.
5. Uploads advertise 15 MB / 20 MB JSON despite Vercel's 4.5 MB request/response ceiling. File-to-conversation ownership is not checked on upload. Large base64 responses can also exceed the response limit.
6. CORS duplicates a fixed old deployment origin and allows development origins in production. No persistent rate limiter. Existing JWT localStorage storage remains an XSS-sensitive design choice.
7. Tests call real Gemini with dummy credentials; local database tests use application storage and can modify data. Missing network-isolated failure and frontend retry tests.
8. Express, cors, dotenv, multer and both Google SDKs are installed; multer and Google GenAI are unused. Neon configuration is tooling, not runtime storage.
9. Existing backend-dependent references are local Express/proxy/docs plus configurable client API base. Relative paths already used by default.

## Implementation plan and contract

- Retain JavaScript domain handlers and one `/api/index.js` gateway; remove standalone Express and proxy. `vercel dev` serves frontend and all functions. Preserve existing endpoint shapes and CRUD success bodies.
- `/api/chat` accepts message, bounded prior history, conversationId, requestId, reasoningMode, fileContext, stream. JSON success remains `{reply}`; legacy text/plain stream remains supported. Browser uses SSE (`stream: 'sse'`) with delta/done/error events so partial failures are explicit; never switch providers after a delta is sent.
- Errors use `{success:false,error:{code,message,retryable},reply}`. Gemini first, Groq second; missing keys skipped; one attempt per provider (zero automatic same-provider retries); per-provider abort deadlines.
- Enforce bounded JSON bodies, chat/context/token limits, same-origin checks, sanitized logs, secure JWT configuration. PostgreSQL required in production; explicit opt-in JSON store only for local development/tests. PostgreSQL-backed rate limiting avoids instance-local counters.
- Preserve 15 MB upload capability using private Vercel Blob direct uploads for large files; continue inline small uploads. Signed, short-lived upload tickets constrain pathname/ownership/size and allow guest extraction without publicly sharing files. Store extracted text in PostgreSQL; delete temporary large upload objects after extraction.
- Await durable chat writes; idempotent request IDs avoid persisted duplicates on retries. Use lifecycle-supported background memory extraction. Keep existing local reply behavior and persist local turns for signed-in users.
- Mock provider HTTP contracts, test failure matrix/partial streams and actual frontend retry; run lint/build/tests and Vercel local verification where available. Document all manual infrastructure/secret/data migration requirements honestly.
