import { AppError } from '../errors.js';
export function upstreamError(status, detail = '') {
  let category = 'PROVIDER_ERROR';
  if (status === 429) category = 'RATE_LIMITED';
  else if (status === 401 || status === 403 || /api.?key|authentication/i.test(detail)) category = 'AUTH_FAILED';
  else if (status === 404 || /model.*(?:not.found|not.support|decommission|unavailable)/i.test(detail)) category = 'MODEL_UNAVAILABLE';
  else if (status === 400 || status === 422) category = 'INVALID_REQUEST';
  const code = category === 'RATE_LIMITED' ? 'RATE_LIMIT' : ['AUTH_FAILED','MODEL_UNAVAILABLE'].includes(category) ? 'PROVIDER_CONFIGURATION' : category === 'INVALID_REQUEST' ? 'INVALID_REQUEST' : 'UNAVAILABLE';
  return Object.assign(new AppError(code, code === 'RATE_LIMIT' ? 429 : code === 'INVALID_REQUEST' ? 400 : 503, undefined, code !== 'INVALID_REQUEST'), { category, upstreamStatus: status });
}
export async function* readSSE(body) {
  if (!body) throw new AppError('UNAVAILABLE');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (data) yield data;
      }
      if (buffer.length > 1024 * 1024) throw new AppError('UNAVAILABLE');
      if (done) {
        // An unterminated data frame is a truncated provider response.
        if (buffer.trim() && !buffer.trim().startsWith(':')) throw new AppError('UNAVAILABLE');
        break;
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function* providerRequest(url, headers, body, timeoutMs, parse) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal });
    if (!res.ok) {
      // Inspect only to classify; never log or return the confidential upstream body.
      const detail = (await res.text()).slice(0, 8192);
      throw upstreamError(res.status, detail);
    }
    if (body.stream || url.includes('streamGenerateContent')) {
      let completed = false;
      for await (const data of readSSE(res.body)) {
        if (data === '[DONE]') { completed = true; continue; }
        let value;
        try { value = JSON.parse(data); } catch { throw new AppError('UNAVAILABLE'); }
        const chunk = parse(value);
        if (chunk.done) completed = true;
        if (chunk.text) yield chunk.text;
      }
      if (!completed) throw new AppError('UNAVAILABLE');
    } else {
      const parsed = parse(await res.json());
      if (parsed.text) yield parsed.text;
    }
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new AppError('TIMEOUT', 504), { category: 'TIMEOUT' });
    if (error instanceof AppError) throw error;
    throw Object.assign(new AppError('UNAVAILABLE'), { category: error instanceof SyntaxError ? 'RESPONSE_INVALID' : 'NETWORK_ERROR' });
  } finally { clearTimeout(timer); controller.abort(); }
}
