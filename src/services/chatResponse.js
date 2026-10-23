const messages = {
  UNAVAILABLE: 'I’m having trouble connecting to the AI service right now. Please try again in a moment.',
  NETWORK: 'Unable to connect to the server. Please check your internet connection.',
  TIMEOUT: 'The response is taking longer than expected. Please try again.',
  CONFIGURATION: 'Bodhi-Sakha is temporarily unavailable. Please try again later.',
  BOTH_UNAVAILABLE: 'Both AI services are temporarily unavailable. Please try again shortly.',
  RATE_LIMIT: 'Bodhi-Sakha is receiving too many requests right now. Please wait a moment and try again.',
  UNAUTHORIZED: 'Please sign in again to continue this conversation.',
  NOT_FOUND: 'This conversation is no longer available. Please start a new chat.',
  INVALID_REQUEST: 'Please shorten your message or attachments and try again.',
  PAYLOAD_TOO_LARGE: 'Please shorten your message or attachments and try again.',
  REQUEST_PENDING: 'This message is still being processed. Please wait a moment before retrying.',
};
export class ChatError extends Error {
  constructor(code = 'UNAVAILABLE', retryable = true) {
    super(messages[code] || messages.UNAVAILABLE);
    this.code = code;
    this.retryable = retryable;
  }
}
export function friendlyChatError(error) {
  return error instanceof ChatError ? error : new ChatError(error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK');
}
export async function readChatResponse(response, onDelta) {
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ChatError(data?.error?.code || (response.status === 429 ? 'RATE_LIMIT' : response.status === 404 || !response.headers.get('content-type')?.includes('application/json') ? 'NETWORK' : 'UNAVAILABLE'), data?.error?.retryable !== false);
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    if (!response.headers.get('content-type')?.includes('application/json')) throw new ChatError('NETWORK');
    const data = await response.json().catch(() => null);
    if (typeof data?.reply !== 'string' || !data.reply.trim()) throw new ChatError();
    onDelta(data.reply);
    return data.imageUrl ? data : data.reply;
  }
  if (!response.body) throw new ChatError();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = ''; let text = ''; let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value,{stream:true});
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0,end); buffer = buffer.slice(end+2);
        const event = frame.split('\n').find(l => l.startsWith('event:'))?.slice(6).trim();
        const raw = frame.split('\n').find(l => l.startsWith('data:'))?.slice(5).trim();
        let data;
        try { data = JSON.parse(raw); } catch { throw new ChatError(); }
        if (event === 'error') throw new ChatError(data.error?.code, data.error?.retryable !== false);
        if (event === 'done') completed = true;
        if (event === 'delta' && typeof data.text === 'string') { text += data.text; onDelta(text); }
      }
      if (done) break;
    }
    if (!completed || !text.trim()) throw new ChatError();
    return text;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
