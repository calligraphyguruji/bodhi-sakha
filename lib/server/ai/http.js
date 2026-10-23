import { AppError } from '../errors.js';
export function upstreamError(status) {
  return new AppError(status === 429 ? 'RATE_LIMIT' : [400, 401, 403, 404].includes(status) ? 'PROVIDER_CONFIGURATION' : 'UNAVAILABLE', status === 429 ? 429 : 503);
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
    if (!res.ok) { await res.body?.cancel(); throw upstreamError(res.status); }
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
    if (controller.signal.aborted) throw new AppError('TIMEOUT', 504);
    if (error instanceof AppError) throw error;
    throw new AppError('UNAVAILABLE');
  } finally { clearTimeout(timer); controller.abort(); }
}
