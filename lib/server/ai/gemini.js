import { providerRequest } from './http.js';
export function gemini({ key, model, system, messages, maxTokens, temperature, stream, timeoutMs }) {
  const base = process.env.NODE_ENV === 'test' && process.env.GEMINI_TEST_URL ? process.env.GEMINI_TEST_URL : 'https://generativelanguage.googleapis.com/v1beta';
  const url = `${base}/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
  const contents = [];
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'model' : 'user';
    const parts = [{text:message.content}, ...(message.images || []).flatMap(image => [{text:`Image: ${image.fileName}`},{inlineData:{mimeType:image.mimeType,data:image.data}}])];
    if (contents.at(-1)?.role === role) contents.at(-1).parts.push(...parts);
    else contents.push({role,parts});
  }
  return providerRequest(url, { 'x-goog-api-key': key }, {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature, ...(model === 'gemini-3.8-flash' ? {thinkingConfig:{thinkingLevel:'low'}} : {}) },
  }, timeoutMs, value => ({
    text: (value.candidates?.[0]?.content?.parts || []).filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join(''),
    done: Boolean(value.candidates?.[0]?.finishReason),
  }));
}
