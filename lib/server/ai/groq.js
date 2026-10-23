import { providerRequest } from './http.js';
export function groq({ key, model, system, messages, maxTokens, temperature, stream, timeoutMs }) {
  const base = process.env.NODE_ENV === 'test' && process.env.GROQ_TEST_URL ? process.env.GROQ_TEST_URL : 'https://api.groq.com/openai/v1';
  return providerRequest(`${base}/chat/completions`, { Authorization: `Bearer ${key}` }, {
    model, messages: [{ role: 'system', content: system }, ...messages], max_completion_tokens: maxTokens, temperature, stream,
  }, timeoutMs, value => ({
    text: value.choices?.[0]?.delta?.content || value.choices?.[0]?.message?.content || '',
    done: Boolean(value.choices?.[0]?.finish_reason),
  }));
}
