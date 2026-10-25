# Bodhi AI provider simulation

## Purpose

Exercises Gemini and Groq adapters against the repository's local protocol fixtures.
See `ai.sim.yaml` and `../mocks/providers/default.cjs` for routing and failure controls.

## Execution

Start with `postman simulation run postman/simulations/ai.sim.yaml --port 4900 --output ndjson --no-history`.
Once listening, run `SIM_URL=http://127.0.0.1:4900 node --test tests/api.test.js tests/providers.test.js`.
Stop the simulation with Ctrl+C.

## Assumptions

- Responses are synthetic; they prove payloads, routing and errors, never recognition accuracy or provider account access. (observed 2026-10-25)
- The API tests use an isolated temporary local database, dummy credentials, and synthetic images; no production data is sent. (observed 2026-10-25)

## Observations

<!-- begin:observations -->
2026-10-25 (5 MB update): Direct fixture HTTP run passed 56 API/provider tests, including 1/3/4.9/5 MiB original-byte equality, Gemini failures to Groq vision, and independent multiple-image limits. Both provider paths served traffic. The existing Postman-runner startup limitation remains; no successful Postman simulation run is claimed.
2026-10-25: Direct HTTP execution of the same mock handler served both Gemini and Groq adapter paths, including multimodal failure/fallback tests. Neither Postman simulation member served traffic because its runner did not start.
<!-- end:observations -->

## What didn't work

- 2026-10-25: Postman CLI 1.75.0 exited with `Error: Mock server failed to serve the request.` both with and without `--no-history`; no listening/request events were produced. Cause not determined. Direct fixture server (`node postman/mocks/providers/default.cjs`, port 4901) worked; `SIM_URL=http://127.0.0.1:4901 node --test tests/api.test.js tests/providers.test.js` passed. Do not describe that as a successful Postman simulation run.
