# Image understanding audit and implementation

Date: 2026-10-25. Changes are local; production has not been redeployed.

## Root cause and audit evidence

The image attachment button worked, but the application had no multimodal path:

1. `ChatInput` read small files as data URLs and posted their bytes to `/api/files`. Files above 3 MiB used the existing private temporary Blob upload path.
2. `server/endpoints/files.js` converted an image into the literal `[Image Attachment: filename (MIME)]`. It stored only that placeholder and metadata, returned no image data, and discarded original bytes (including deleting temporary Blob objects after extraction).
3. `Chatbot` reduced history to `{sender,text}` and built `fileContext` from extracted text. Image names/placeholder strings were the only visual context sent to `/api/chat`.
4. Chat validation reduced history to text. The chat handler constructed `{role,content:string}` messages. Both Gemini and Groq adapters sent text only.
5. Groq used `openai/gpt-oss-120b`, a text fallback; there was no separate vision routing or conversion.
6. User messages and composer attachments displayed file chips rather than thumbnails. There was no drop handler.
7. The existing same-origin gateway, server-only secrets, timeout/streaming safeguards, private database ownership checks, rate limits, Vercel rewrites and 60-second function duration can support vision without replacing the architecture.

The selected primary model alone was not the root cause: no model could see bytes that the pipeline discarded. Changing only the prompt or denial message would leave the defect intact.

Graph discovery tools were not exposed in this session. Investigation used source reads/searches instead; no graph coverage or complete graph audit is claimed. The audit followed upload, documents, chat serialization/validation/routing, persistence/auth, provider adapters/HTTP behavior, prompts, frontend rendering, tests, configuration and deployment paths. Orbit discovery supplied an incomplete text-only Groq contract, so official provider documentation supplied the multimodal fields and current model capabilities.

## Implemented pipeline

Browser selection or drop → `/api/files` JSON base64 upload → full image decoding/type/size validation → preview plus original bytes → `/api/chat` → owned attachment resolution and message-associated history → Gemini multimodal parts → one Groq vision fallback before output if needed → existing SSE/JSON response and rendering.

- JPEG, PNG and WebP MIME types and original bytes are preserved. Sharp is the single added runtime dependency, needed to decode pixels and reject corrupt/disguised images rather than merely checking extensions or header bytes.
- Gemini defaults to the current stable Flash vision model `gemini-3.8-flash`, using the existing REST `generateContent`/`streamGenerateContent` integration and `inlineData` parts. Low thinking is selected for this model within the existing response budget.
- Groq vision defaults to `qwen/qwen3.8-27b`; its image parts use base64 data URLs. Only a verified image-capable model can be selected from the allowlist. `GROQ_MODEL` remains independent for text chat. Unknown vision overrides skip Groq rather than submitting images to a text model.
- Both-provider failure returns the requested friendly image-analysis error. Provider output is never combined after streaming starts. Raw provider errors, secrets and pixels are not logged.
- Images are associated with their original user messages. Signed-in follow-ups use server-loaded history and authenticated attachment IDs, including after reload. Guests retain bytes in message state and send them in history. Necessary image bytes are resent to stateless providers; signed-in browser requests do not resend them.
- Signed-in originals use the existing private database TEXT field, with no new storage account or migration. Thumbnails reload through an authenticated, ownership-checked endpoint with no-store headers. Conversation list responses exclude image bytes. Removing unsent uploads deletes their records; conversation deletion removes associated uploads. Abandoned uploads not removed by the user remain private uploaded-file records.
- Document extraction remains separate. PDF regression tests exercise real extraction and subsequent text context. Unrelated text, weather/current-information and image-generation routing remains available after image turns.

Official capability/format checks: [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [Gemini REST parts](https://ai.google.dev/api/generate-content#Part), [Groq vision](https://console.groq.com/docs/vision).

## Limits and remaining behavior

- Two MiB per image; optional `MAX_IMAGE_BYTES` can lower this. Three images and 2,800,000 decoded bytes across a conversation, matching the default Groq model's three-image maximum and leaving room below the Vercel request ceiling. Start a new chat to analyze further images.
- Images above 24 megapixels and animated images are rejected. Screenshots are not silently compressed. Large images must be resized by the user.
- Guest image context disappears on reload. Signed-in context persists until deletion. Legacy images must be reuploaded because their original bytes were never retained.
- Missing/deleted image context produces an explicit reattachment error, not invented visual descriptions.
- OCR, code explanation, diagrams, handwriting and recognition quality depend on provider inference and legibility. Mocked tests prove transmission and routing, not perception accuracy.
- Existing unpaginated conversation responses can still become large through text/generated-image history. This work keeps uploaded image originals out of those responses.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | 51 passed, 0 failed |
| Real HTTP fixtures: `SIM_URL=http://127.0.0.1:4901 node --test tests/api.test.js tests/providers.test.js` | 42 passed, 0 failed; includes serverless handler to real provider HTTP adapter calls |
| `npm run lint` | Passed |
| `npm run build` | Passed |
| `git diff --check` | Passed |
| Text-only, document persistence/retry/auth tests | Passed |
| Real PDF extraction and chat context | Passed |
| JPEG/PNG/WebP byte equality and MIME in Gemini payload | Passed |
| Multi-image association and follow-ups | Passed |
| Signed-in reload, private retrieval, cross-user denial, missing context | Passed |
| Gemini invalid request/failure to Groq vision; dual failure; text-only model excluded | Passed |
| Corrupt/disguised/unsupported/oversized image and count validation | Passed |
| Built client checked against configured local secret values | No secret values found |
| Playwright browser/mobile workflow | Added; unable to execute: bundled browser missing, installed Chrome aborts with SIGABRT/EPERM in sandbox |
| Postman CLI simulation | Failed to start mocks; direct HTTP fixture server succeeded; see simulation context |
| Real Gemini/Groq image interpretation | Not performed: no usable provider credentials configured locally |
| Environment preflight with local env files loaded | AI_KEYS_MISSING; database/auth configuration present locally, values not disclosed |
| Type checking | No standalone typecheck script; project is JavaScript/JSX; lint and build passed |
| Vercel production runtime/deployment | Not deployed or verified live; existing serverless route/CSP/config retained |

Automated code review identified three actionable findings: unrelated routing after image turns, combined composer size checks, and browser completion waits. All three were corrected and regression checks added where executable. The follow-up CodeRabbit review completed with zero findings in the tracked files it reviewed. Newly added files were inspected locally and exercised by the tests; they were not listed in CodeRabbit’s reviewed-file output.

Tests ran under local Node 26.5.1. The project still targets Node 24 on Vercel; the hosted Node 24 runtime and Sharp native deployment need a preview smoke test.

## Vercel configuration and release

Existing server-side `GEMINI_API_KEY` and `GROQ_API_KEY` remain required for their providers. Existing `DATABASE_URL` and `JWT_SECRET` remain necessary for production persistence/auth/rate limits. Optional new configuration:

```dotenv
GEMINI_VISION_MODEL=gemini-3.8-flash
GROQ_VISION_MODEL=qwen/qwen3.8-27b
MAX_IMAGE_BYTES=2097152
```

No VITE-prefixed secrets, new backend or paid storage service is introduced. Existing `BLOB_READ_WRITE_TOKEN` is still only needed for large document uploads, not the bounded image workflow. The existing image-generation configuration is unchanged.

The source builds for Vercel. Before declaring production ready, configure/confirm provider access in Vercel, deploy a preview, run the browser suite in an environment that can launch Playwright, and upload a real algorithm/code screenshot through the preview. Verify original-image explanation, follow-up complexity/C++ output, real fallback account availability and Sharp loading in Node 24. Then promote the verified deployment. No production environment was changed during this task.

## Every changed file

| File | Purpose |
| --- | --- |
| `.env.example` | Optional vision model and image-byte-limit configuration |
| `docs/API.md` | Upload, private retrieval, multimodal request/history, limits and errors contract |
| `docs/VISION_IMPLEMENTATION_REPORT.md` | Audit evidence, implementation, verification and release report |
| `lib/server/vision.js` | Image decoding/validation, limits, vision instructions and private history resolution |
| `lib/server/validation.js` | Accept validated attachment fields in chat and history |
| `lib/server/ai/aiRouter.js` | Separate image-capable provider routing and friendly vision failures |
| `lib/server/ai/gemini.js` | Text plus actual inline image parts, preserving same-role multimodal parts |
| `lib/server/ai/groq.js` | OpenAI-compatible multimodal image content |
| `lib/server/errors.js` | Public vision failure/context/limit error messages |
| `server/endpoints/files.js` | Preserve decoded image bytes; authenticated private image retrieval |
| `server/endpoints/chat.js` | Resolve multimodal history and retain unrelated request routing |
| `server/endpoints/conversations.js` | Exclude original image bytes from conversation responses |
| `server/endpoints/lib/db.js` | Owner-scoped file lookup and local conversation-upload cleanup |
| `src/components/ChatInput.jsx` | Drop/select uploads, thumbnails, validation, removal and processing feedback |
| `src/components/AttachmentImage.jsx` | Authenticated thumbnail loading after reload |
| `src/components/ChatMessage.jsx` | Display images on their original user messages |
| `src/components/Chatbot.jsx` | Serialize guest image context/owned IDs, preserve association, delete unsent uploads |
| `src/services/aiService.js` | Attachment transport, private image retrieval and deletion |
| `src/services/chatResponse.js` | Safe image-analysis, missing-context and size-limit feedback |
| `src/App.css` | Small responsive thumbnail/display rules; no redesign |
| `tests/api.test.js` | Multimodal gateway integration, ownership, failures, PDF and routing regression tests; real HTTP mode |
| `tests/browser.mjs` | Mobile image selection/drop/preview/remove/send/history/error coverage and corrected completion waits |
| `postman/simulations/ai.context.md` | Reproducible simulation/HTTP commands and observed runner limitation |
| `package.json` | Add Sharp for actual pixel decoding |
| `package-lock.json` | Lock Sharp and platform binaries |
