# API contract

All routes share the frontend origin. Send `Content-Type: application/json` on writes. Private routes require `Authorization: Bearer <session token>` (seven-day HS256 JWT). Browser requests from another origin return 403; no CORS allowlist or external backend base URL is needed.

## Chat

`POST /api/chat` accepts:

```json
{
  "message": "Explain this topic",
  "history": [{"sender":"user","text":"Earlier question"},{"sender":"bot","text":"Earlier answer"}],
  "conversationId": "optional-owned-conversation-id",
  "requestId": "stable-client-generated-uuid",
  "attachmentIds": [],
  "fileContext": "optional extracted document data",
  "reasoningMode": false,
  "timeZone": "Asia/Kolkata",
  "stream": "sse"
}
```

`message` is required and nonempty. History contains prior turns, excluding error messages and the current user turn. Current-message duplication from legacy clients is removed where identifiable. Guests omit conversationId; signed-in callers include an owned conversationId for durable writes. requestId is optional for legacy clients but required for reliable caller retries; use it unchanged for the same turn. IDs allow letters/digits/underscore/hyphen, up to 60 characters. At most ten attachment IDs are accepted. Only owned uploaded records can attach to an owned conversation. `timeZone` is an optional valid IANA timezone for local date/time responses.

`stream: false` (default) returns HTTP 200 `{ "reply": "answer" }`. `stream: true` preserves the legacy `text/plain; charset=utf-8` response. `stream: "sse"` returns `text/event-stream`:

```text
event: delta
data: {"text":"answer fragment"}

event: done
data: {"requestId":"stable-client-generated-uuid"}
```

The caller must wait for `done`. After partial output, failures produce an `error` event containing the same structured error body as below; there is no provider switch. Legacy plain-text streams close abnormally on partial failure because that protocol cannot carry a structured error after headers. On a retried completed request, the API returns cached **JSON**, even if SSE was requested. Clients must accept both. Image-generation prompts also return JSON `{reply,imageUrl}` and require authentication.

Before output begins, errors use their HTTP status and this shape:

```json
{
  "success": false,
  "error": {
    "code": "UNAVAILABLE",
    "message": "I’m having trouble connecting to the AI service right now. Please try again in a moment.",
    "retryable": true
  },
  "reply": "I’m having trouble connecting to the AI service right now. Please try again in a moment."
}
```

Codes/status: INVALID_REQUEST 400, UNAUTHORIZED 401, FORBIDDEN 403, NOT_FOUND 404, METHOD_NOT_ALLOWED 405, REQUEST_PENDING 409, PAYLOAD_TOO_LARGE 413, UNSUPPORTED_MEDIA_TYPE 415, RATE_LIMIT 429, CONFIGURATION/UNAVAILABLE/BOTH_UNAVAILABLE 503, TIMEOUT 504. Rate-limit gateway responses include Retry-After: 60. Raw upstream errors are never returned. Retry is manual, bounded by the caller; do not automatically loop on errors.

## Existing resource routes

Success payloads and query/path action variants are retained. The gateway normalizes retained CRUD validation errors to the structured error shape above. Private-resource operations do not accept an arbitrary user ID from the request.

| Route | Methods and inputs | Success |
| --- | --- | --- |
| `/api/health` | GET, no credentials | `{status:"ok",service:"Bodhi-Sakha"}`; liveness only, no upstream calls |
| `/api/chat` | GET | Same minimal liveness response |
| `/api/auth?action=register` or `/api/auth/register` | POST `{name,email,password,confirmPassword}` | 201 `{token,user}` |
| `/api/auth?action=login` or `/api/auth/login` | POST `{email,password}` | 200 `{token,user}` |
| `/api/auth?action=me` or `/api/auth/me` | GET, authenticated | `{user}` |
| `/api/auth?action=logout` or `/api/auth/logout` | POST | `{ok:true}`; client deletes token, no server session/revocation store |
| `/api/conversations` | GET `?search=...`; POST `{title}` | `{conversations}`; 201 `{conversation}` |
| `/api/conversations/:id` | GET; PATCH/PUT `{title,pinned,archived}`; DELETE | `{conversation,messages,files}`; `{conversation}`; `{success:true}` |
| `/api/memory` | GET; POST `{memory_key,memory_value,importance:1..3}`; DELETE `?clearAll=true` | `{memories}`; 201 `{memory}`; `{success:true,cleared:true}` |
| `/api/memory/:id` | DELETE | `{success:true}` |
| `/api/files` | POST `{fileName,fileType,fileData,conversationId?}`; fileData is base64/data URL, small files only | 200 guest / 201 signed-in `{file:{id,fileName,fileType,fileSize,hasText,extractedText}}` |
| `/api/files/:id` | DELETE, authenticated | `{success:true}` |
| `/api/files?action=prepare` | POST `{fileName,fileType,fileSize,conversationId?}`, maximum 15 MB | `{ticket,pathname}`; ticket expires in ten minutes |
| `/api/files` | POST Blob SDK token/completion protocol with ticket as clientPayload | SDK-managed response; signed callback validation |
| `/api/files?action=complete` | POST `{ticket}` after private direct upload | Same processed `{file}` response as inline upload |
| `/api/images` | POST `{prompt}`, authenticated | `{imageUrl,prompt,provider}`; text provider fallback does not apply |

Large-upload tokens constrain path and size; arbitrary URLs are never accepted for server downloads. Finalization checks session ownership again. Extraction text is capped at 100,000 characters and chat document context at 15,000 per source. The original document is not retained as permanent file storage. Keep Blob temporary-object lifecycle cleanup enabled for abandoned uploads.

Resource collections currently retain the existing unpaginated API contract. Large histories, especially repeated generated image data URLs, may exceed function response limits; test representative account sizes before release. Authentication uses localStorage bearer tokens as in the existing app; logout is client-side token removal rather than immediate server revocation.

Every gateway response includes a server-generated `X-Request-ID`. Runtime Logs correlate this ID with request outcome, provider attempts, fallback activation, status and duration. Internal auth/model/database categories are never sent in the response. Invalid provider requests return 400 without fallback; provider authentication, retired model, quota, timeout and service failures can fall back before any output.

## Image understanding

Upload JPEG, PNG or WebP through `/api/files`. The server decodes all pixels using
Sharp, checks the actual format against the claimed MIME, rejects corruption,
animation and images above 24 megapixels. Each image is capped at exactly 5 MiB
(5,242,880 bytes), inclusive, using the shared `MAX_IMAGE_SIZE` constant. Documents retain their existing 15 MiB
limit and extraction workflow. No image resizing or lossy compression occurs.

Successful image uploads also return `imageData`, a validated MIME-preserving
base64 data URL used for previews. Signed-in originals are retained in the existing
private `uploaded_files.storage_url` TEXT column, with message metadata containing
only attachment IDs, names and types. No schema change or new storage service is
required. Removing an unsent attachment deletes the signed-in upload. Deleting a
conversation cascades to its uploaded images. Images uploaded and then abandoned
without removal remain ordinary private uploaded-file records.

Guests send `attachments: [{id,fileName,fileType,imageToken}]` on the current turn,
and the same references inside the original user turn of `history` on follow-ups.
Temporary guest bytes expire after 24 hours; guest chat state still disappears on reload. Signed-in clients send `attachmentIds`, an owned
`conversationId`, and stable `requestId`; the server resolves images from the
authenticated database records and uses persisted message history. Browser image
bytes are not retransmitted on signed-in follow-ups. Up to three images, each up to 5 MiB, may be included across a conversation;
exceeding the image count returns `VISION_LIMIT` (413) with instructions to start a new chat. The gateway
still caps JSON at 4.25 MiB, below Vercel's 4.5 MB function limit.

`GET /api/files/:id?chunk=N` requires authentication and returns
`{data,fileType,chunkCount}` for one 1 MiB binary slice encoded as Base64,
with `Cache-Control: private, no-store`. The client reconstructs the preview.
The legacy whole-image response remains available only for files up to 3 MiB. Other users get 404. Conversation
responses exclude stored image bytes; thumbnails load through this private route.
Missing, deleted or legacy images return `IMAGE_CONTEXT_MISSING` (422), asking the
user to reattach. Previously discarded originals cannot be recovered.

Gemini receives text plus `{inlineData:{mimeType,data}}` parts in the original user
turn, using the current stable Flash vision model `gemini-3.8-flash` by default.
Groq fallback uses `qwen/qwen3.8-27b` and OpenAI-compatible `image_url` content parts
containing data URLs. `GROQ_MODEL` continues to control text-only fallback;
`GROQ_VISION_MODEL` must be in the verified vision allowlist. An unknown override
skips Groq vision. Provider account access is still required. These defaults were
verified against [Gemini model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash),
[Gemini REST parts](https://ai.google.dev/api/generate-content#Part), and
[Groq vision documentation](https://console.groq.com/docs/vision) on 2026-10-25.

Vision failures before output, including invalid upstream multimodal requests,
can trigger one fallback attempt; text-only invalid requests retain the existing
no-fallback behavior. After output starts the server never mixes providers.
`VISION_UNAVAILABLE` (503) returns: “Sorry, I’m having trouble analyzing this image
right now. Please try again shortly.” Image contents and secrets are never logged.
Images are treated as untrusted data, and response instructions require grounded
observations and explicit uncertainty for unreadable content.


### Bounded image upload protocol (5 MiB per original)

Run `npm run db:migrate` against the deployment database before releasing this
protocol. The additive `image_uploads` staging table uses the existing `DATABASE_URL`.
No new credentials, paid storage service, or persistent backend is needed. Existing
provider keys and environment files remain unchanged; the legacy `MAX_IMAGE_BYTES`
setting is no longer consulted because the frontend and backend share one fixed limit.

Every image selected by the current client uses these JSON requests to `/api/files`:

1. `POST ?action=image-start` with `{fileName,fileType,fileSize,conversationId?}`.
   Returns `{id,imageToken,chunkSize}`. Size is checked before staging data.
2. `POST ?action=image-chunk` with `{id,imageToken,index,data}`. Each `data` is an
   independently Base64-encoded slice of up to 1 MiB; each JSON body is below 1.5 MB.
   The server enforces expected byte length and canonical Base64. Identical retries
   are allowed; changing a chunk or adding data after completion is rejected.
3. `POST ?action=image-complete` with `{id,imageToken}`. All slices are required;
   reassembled bytes are decoded, validated and stored before returning small file
   metadata. Signed-in originals move to `uploaded_files`; guests retain a temporary
   capability-protected reference. No large image data URL is returned.
4. `POST ?action=image-discard` with `{id,imageToken}` removes an abandoned/guest upload.

Capability tokens contain 256 random bits, are stored as SHA-256 hashes and are
bound to the authenticated owner (or anonymous upload). Incomplete uploads expire
in 15 minutes; completed guest images expire in 24 hours. Expired records cannot
be read, and are physically pruned when another upload starts. Do not put tokens
in URLs or logs. Serverless instances share chunks through Postgres, not `/tmp`.
Chunk writes and private chunk reads use a separate 120/minute transfer bucket;
starting/completing uploads and chat retain the existing AI rate limit.

The browser retains local previews but serializes only image references. Original
bytes are recovered server-side and sent to Gemini or Groq. Multiple uploads have
independent 5 MiB limits; there is no former combined conversation-byte cap. Groq's
separate 20 MB encoded-request ceiling still applies: if three large images exceed
it, that fallback returns a safe vision error, never drops an image or uses a text
model. Gemini's current inline request allowance is 100 MB. See the current
[Gemini file input limits](https://ai.google.dev/gemini-api/docs/file-input-methods)
and [Groq vision limits](https://console.groq.com/docs/vision).

Oversized originals return HTTP 413 with: “Image size exceeds 5 MB. Please upload
an image smaller than 5 MB.” Exactly 5,242,880 bytes is accepted. PDF and document
uploads retain their original inline/private Blob paths and 15 MiB limit.
