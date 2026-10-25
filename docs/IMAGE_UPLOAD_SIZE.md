# 5 MB image upload change

The shared maximum is `MAX_IMAGE_SIZE = 5 * 1024 * 1024` (5,242,880 bytes),
inclusive, for each JPG/JPEG/PNG/WebP original. Larger files return:

> Image size exceeds 5 MB. Please upload an image smaller than 5 MB.

## Root restrictions and repair

The old implementation enforced 2 MiB in the composer and decoder, 2.8 MB in
conversation aggregation, and a separate small-image serialization bound. Raising
only those constants would still exceed Vercel's 4.5 MB request/response ceiling:
a 5 MiB file becomes approximately 7 MB when Base64-encoded.

Current clients upload every image in 1 MiB slices, each sent as a bounded JSON
request. Chunks are checked against the declared size and assembled in the existing
Postgres database. Finalization validates the full original with Sharp and returns
small attachment metadata. Chat sends references; actual bytes are loaded on the
server and forwarded to the vision provider. Reloaded signed-in previews are also
retrieved in bounded chunks. Image originals are not resized or silently compressed.
Three images remain supported independently, including three 5 MiB originals;
the former combined conversation-byte limit has been removed.

Incomplete staging records expire after 15 minutes; completed guest originals
expire after 24 hours. Capabilities use 256-bit random tokens, hashed at rest, with
ownership checks for signed-in uploads. Expired records cannot be accessed and
are pruned on subsequent upload starts. Guests need no account. Signed-in images
persist in the existing private uploaded-files table. Documents retain their
15 MiB limit and existing inline/private Blob upload paths.

## Required release step

Vercel runs `npm run db:migrate && npm run build` before publishing this
client/server pair. This creates the additive `image_uploads` staging table and
blocks publication if migration fails. For a manual deployment outside Vercel,
run `npm run db:migrate` against the target database first.
No existing rows or columns are dropped. The migration can be rerun safely.
No new environment variables, keys or storage services are needed. Actual `.env`
files and provider settings were left unchanged. The old `MAX_IMAGE_BYTES` setting
is intentionally ignored so an existing 2 MiB value cannot silently defeat the
shared 5 MiB requirement. Its obsolete entry was removed only from `.env.example`.

The migration was initially tested in isolated in-memory PostgreSQL using PGlite.
During the production upload-start investigation it was applied successfully to
the configured hosted database, restoring the live upload endpoint. A native local Postgres server
could not initialize because the sandbox blocks shared-memory creation.

## Verification

| Case | Result |
| --- | --- |
| 1 MiB | Accepted; identical bytes reached Gemini and Groq mock payloads |
| 3 MiB | Accepted; identical bytes reached Gemini and Groq mock payloads |
| 4.9 MiB | Accepted; identical bytes reached Gemini and Groq mock payloads |
| Exactly 5 MiB | Accepted; identical bytes reached Gemini and Groq mock payloads |
| 5 MiB + 1 byte | Rejected with HTTP 413 and required message |
| 5.1 MiB | Rejected with HTTP 413 and required message |
| 6 MiB | Rejected with HTTP 413 and required message |
| Multiple 5 MiB originals | Accepted independently; Gemini receives all three |
| Browser API transport | 5 MiB upload split into requests below 1.5 MB; chat uses references |
| Signed-in 5 MiB image retrieval/follow-up | Byte equality, owner checks and bounded responses passed |
| Incomplete/corrupt/conflicting/oversized chunks | Rejected; identical chunk retries accepted |
| Guest capability expiry | Explicit missing-context error |
| Existing text/PDF/document regression coverage | Passed |

`npm test`: **65 passed, 0 failed**. Lint and the Vite production build passed.
Real HTTP provider fixtures: **56 passed, 0 failed** using
`SIM_URL=http://127.0.0.1:4901 node --test tests/api.test.js tests/providers.test.js`. SQL engine checks exercised idempotent schema
creation, chunk insertion/retry/conflict, completion guard, reads and deletion.

Browser/mobile Playwright tests were updated for the protocol and the 5 MiB error,
but could not launch: the required bundled browser is absent (installed Chrome
also aborted in this sandbox during the preceding vision work). A subsequent live production test uploaded an exact 5,242,880-byte synthetic C++
screenshot and obtained a grounded response: the provider read the visible
`BODHI-7319` identifier, explained the sum function, and returned O(n) time and
O(1) auxiliary space. The synthetic guest image was discarded afterward. This
verifies real production upload and vision inference; it does not independently
verify a live forced Groq fallback. Local provider tests remain mocked.

Groq has a separate 20 MB encoded-request ceiling. A single 5 MiB original fits;
three maximum originals exceed that provider ceiling. In that case Gemini still
receives all images, while Groq safely declines an oversized fallback without
truncating images or switching to a text model. Current Gemini inline payloads
support 100 MB. Sources: [Vercel function limits](https://vercel.com/docs/functions/limitations),
[Groq vision](https://console.groq.com/docs/vision), and
[Gemini input limits](https://ai.google.dev/gemini-api/docs/file-input-methods).

## Files changed from the preceding vision implementation

| File | Purpose |
| --- | --- |
| `src/utils/uploadLimits.js` | Shared 5 MiB size, chunk size, image count/type and exact error constants |
| `src/components/ChatInput.jsx` | Per-image validation, remove combined cap, display size hint |
| `src/services/aiService.js` | Bounded uploads/downloads, local preview reconstruction, guest discard |
| `src/components/Chatbot.jsx` | Serialize capability references and remove unsent guest uploads |
| `src/services/chatResponse.js` | Updated image-count guidance without obsolete combined-size limit |
| `lib/server/vision.js` | Shared size validation and server-side guest image resolution |
| `lib/server/uploads.js` | Reject oversized originals before staging/direct-upload preparation |
| `lib/server/imageUploads.js` | Upload capabilities, chunk bounds, reassembly and retained guest Blob-path support |
| `lib/server/ai/groq.js` | Guard Groq's encoded provider-payload ceiling independently of upload size |
| `lib/server/errors.js` | Updated image-count guidance |
| `server/endpoints/files.js` | Start/chunk/complete/discard protocol and bounded private reads |
| `server/endpoints/lib/db.js` | Additive staging schema and owner/capability-protected chunk operations |
| `api/index.js` | Separate transfer rate bucket so multiple chunk uploads retain chat capacity |
| `tests/api.test.js` | Exact boundaries, provider bytes, browser API transport, access/failure/expiry checks |
| `postman/simulations/ai.context.md` | Record real HTTP fixture verification and retained runner limitation |
| `tests/browser.mjs` | New upload protocol fixtures, reference assertions and updated size-error check |
| `.env.example` | Remove obsolete configurable size restriction; no actual environment modified |
| `docs/API.md` | New protocol, limits, security, migration and provider constraints |
| `docs/VISION_IMPLEMENTATION_REPORT.md` | Correct outdated size/transport guidance and link to this report |
| `docs/IMAGE_UPLOAD_SIZE.md` | This change and validation report |


## Production upload-start failure (2026-10-25)

The live `/api/files?action=image-start` endpoint returned HTTP 503 with the generic
AI connectivity message before any pixels or provider call. A read-only check of
the configured database confirmed `public.image_uploads` was absent while existing
tables were present; querying it returned PostgreSQL `42P01` (undefined table).
The Vercel build configuration omitted the separately documented migration step.
`vercel.json` now runs the additive/idempotent migration before the frontend build,
so deployment supplies the schema needed by the chunk protocol. No provider keys
or environment values were changed. After applying the migration, the production upload-start request returned HTTP
200 (previously HTTP 503). An exact 5 MiB synthetic screenshot then completed the
whole production pipeline and the AI correctly read and explained its actual
contents. The synthetic upload was removed. The deployment configuration fix was
pushed as commit `74c6077` so future deployments run the required migration
automatically before publishing.
