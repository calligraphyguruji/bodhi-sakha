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
    "message": "Sorry, Bodhi-Sakha is temporarily unable to respond. Please try again in a few moments.",
    "retryable": true
  },
  "reply": "Sorry, Bodhi-Sakha is temporarily unable to respond. Please try again in a few moments."
}
```

Codes/status: INVALID_REQUEST 400, UNAUTHORIZED 401, FORBIDDEN 403, NOT_FOUND 404, METHOD_NOT_ALLOWED 405, REQUEST_PENDING 409, PAYLOAD_TOO_LARGE 413, UNSUPPORTED_MEDIA_TYPE 415, RATE_LIMIT 429, CONFIGURATION/UNAVAILABLE 503, TIMEOUT 504. Rate-limit gateway responses include Retry-After: 60. Raw upstream errors are never returned. Retry is manual, bounded by the caller; do not automatically loop on errors.

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
