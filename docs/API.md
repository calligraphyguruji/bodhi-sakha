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
animation and images above 24 megapixels. Each image is capped at 2 MiB;
`MAX_IMAGE_BYTES` can lower that limit. Documents retain their existing 15 MiB
limit and extraction workflow. No image resizing or lossy compression occurs.

Successful image uploads also return `imageData`, a validated MIME-preserving
base64 data URL used for previews. Signed-in originals are retained in the existing
private `uploaded_files.storage_url` TEXT column, with message metadata containing
only attachment IDs, names and types. No schema change or new storage service is
required. Removing an unsent attachment deletes the signed-in upload. Deleting a
conversation cascades to its uploaded images. Images uploaded and then abandoned
without removal remain ordinary private uploaded-file records.

Guests send `attachments: [{id,fileName,fileType,imageData}]` on the current turn,
and the same attachment fields inside the original user turn of `history` on
follow-ups. These bytes live only in browser memory; reloading a guest chat loses
its image context. Signed-in clients send `attachmentIds`, an owned
`conversationId`, and stable `requestId`; the server resolves images from the
authenticated database records and uses persisted message history. Browser image
bytes are not retransmitted on signed-in follow-ups. Up to three images totaling
2,800,000 decoded bytes may be included across a conversation; exceeding this
returns `VISION_LIMIT` (413) with instructions to start a new chat. The gateway
still caps JSON at 4.25 MiB, below Vercel's 4.5 MB function limit.

`GET /api/files/:id` requires authentication and returns `{imageData}` for an owned
image, with `Cache-Control: private, no-store`. Other users get 404. Conversation
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
