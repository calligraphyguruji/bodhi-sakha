import { AppError } from './errors.js';
import { validateAttachments } from './vision.js';
export const MAX_BODY_BYTES = Math.floor(4.25 * 1024 * 1024);
export function invalid(message = 'Please provide a valid question.') {
  return new AppError('INVALID_REQUEST', 400, message, false);
}
export function parseBody(body, limit = MAX_BODY_BYTES) {
  if (body === undefined) return {};
  let raw;
  try { raw = typeof body === 'string' ? body : JSON.stringify(body); } catch { throw invalid(); }
  if (Buffer.byteLength(raw || '') > limit) throw new AppError('PAYLOAD_TOO_LARGE', 413, 'This request is too large. Please shorten it and try again.', false);
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { throw invalid('Please send valid JSON.'); } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid();
  return body;
}
export function validateChat(body) {
  const { message, history = [], fileContext = '', conversationId, requestId, reasoningMode = false, stream = false, attachmentIds = [], attachments = [], timeZone } = body;
  if (typeof message !== 'string' || !message.trim()) throw invalid();
  if (message.length > 4000) throw new AppError('PAYLOAD_TOO_LARGE', 413, 'Please keep your message under 4000 characters.', false);
  if (!Array.isArray(history) || history.length > 100 || history.some(h => !h || !['bot', 'user'].includes(h.sender) || typeof h.text !== 'string' || h.text.length > 65536)) throw invalid('Please shorten the conversation context.');
  if (typeof fileContext !== 'string' || fileContext.length > 100000) throw invalid('Please attach fewer documents.');
  if (typeof reasoningMode !== 'boolean' || ![true, false, 'sse'].includes(stream)) throw invalid();
  for (const value of [conversationId, requestId]) {
    if (value != null && (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(value))) throw invalid();
  }
  if (!Array.isArray(attachmentIds) || attachmentIds.length > 10 || attachmentIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id))) throw invalid();
  if (timeZone !== undefined) {
    if (typeof timeZone !== 'string' || timeZone.length > 100) throw invalid();
    try {new Intl.DateTimeFormat('en-US',{timeZone});} catch {throw invalid();}
  }
  return { attachments: validateAttachments(attachments), timeZone, attachmentIds, message: message.trim(), history: history.map(h => ({ sender: h.sender, text: h.text.trim().slice(0, 2000), attachments: h.sender === 'user' ? validateAttachments(h.attachments) : [] })), fileContext: fileContext.slice(0, 15000), conversationId, requestId, reasoningMode, stream };
}
export function providerKey(name, env = process.env) {
  const key = (env[name] || '').trim().replace(/^["']|["']$/g, '');
  return !key || /^(your_|YOUR_|undefined|null|placeholder)/i.test(key) ? '' : key;
}
