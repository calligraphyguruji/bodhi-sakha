import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const requests = new AsyncLocalStorage();
// Callers provide only fixed event/category labels and numeric metadata.
export function logAI(event, { provider, category, status, durationMs } = {}) {
  console.info(JSON.stringify({ scope: 'ai', event, requestId: requests.getStore()?.requestId, provider, category, status, durationMs }));
}
export function withDiagnostics(handler) {
  return (req, res) => requests.run({ requestId: randomUUID() }, async () => {
    const started = Date.now();
    res.setHeader('X-Request-ID', requests.getStore().requestId);
    logAI('request.received');
    try { return await handler(req, res); }
    finally {
      logAI(res.aiErrorCode || res.statusCode >= 400 ? 'request.failed' : 'request.completed', {
        category: res.aiErrorCode, status: res.statusCode, durationMs: Date.now() - started,
      });
    }
  });
}
