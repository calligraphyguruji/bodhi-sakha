import { providerRequest } from './http.js';
export function gemini({ key, model, system, messages, maxTokens, temperature, stream, timeoutMs }) {
  const base = process.env.NODE_ENV === 'test' && process.env.GEMINI_TEST_URL ? process.env.GEMINI_TEST_URL : 'https://generativelanguage.googleapis.com/v1beta';
  const url = `${base}/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
  const contents = [];
  for (const message of messages) {
    const role = message.role === 'assistant' ? 'model' : 'user';
    if (contents.at(-1)?.role === role) contents.at(-1).parts[0].text += '\n\n' + message.content;
    else contents.push({role,parts:[{text:message.content}]});
  }
  return providerRequest(url, { 'x-goog-api-key': key }, {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature },
  }, timeoutMs, value => ({
    text: (value.candidates?.[0]?.content?.parts || []).filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join(''),
    done: Boolean(value.candidates?.[0]?.finishReason),
  }));
}
