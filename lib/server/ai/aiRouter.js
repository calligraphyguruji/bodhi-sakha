import { gemini } from './gemini.js';
import { groq } from './groq.js';
import { providerKey } from '../validation.js';
import { logAI } from '../diagnostics.js';
import { AppError } from '../errors.js';
export async function* routeAI(options) {
  const providers = [
    { name: 'gemini', run: gemini, key: providerKey('GEMINI_API_KEY'), model: process.env.GEMINI_MODEL || 'gemini-flash-latest' },
    { name: 'groq', run: groq, key: providerKey('GROQ_API_KEY'), model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b' },
  ];
  for (const provider of providers.filter(p => !p.key)) logAI('provider.skipped', { provider: provider.name, category: `${provider.name.toUpperCase()}_KEY_MISSING` });
  const available = providers.filter(p => p.key);
  if (!available.length) throw new AppError('CONFIGURATION', 503, undefined, false);
  const failures = [];
  const deadline = Date.now() + (options.totalTimeoutMs || 36000);
  for (const provider of available) {
    const attemptStart = Date.now();
    if (failures.length || provider.name === 'groq') logAI('fallback.activated', { provider: provider.name });
    logAI('provider.started', { provider: provider.name });
    let started = false;
    let length = 0;
    try {
      // One attempt per provider. No automatic retries of quotas, auth or invalid requests.
      for await (const text of provider.run({ maxTokens: 2048, temperature: 0.4, ...options, timeoutMs: Math.max(1,Math.min(options.timeoutMs || 18000,deadline-Date.now())), ...provider, model: provider.model.trim().replace(/^models\//, '') })) {
        if (typeof text !== 'string' || !text.trim() && !started) continue;
        length += text.length;
        if (length > 65536) throw new AppError('UNAVAILABLE');
        started = true;
        yield { text, provider: provider.name, model: provider.model };
      }
      if (!started) throw new AppError('UNAVAILABLE');
      logAI('provider.succeeded', { provider: provider.name, status: 200, durationMs: Date.now() - attemptStart });
      return;
    } catch (error) {
      logAI('provider.failed', { provider: provider.name, category: `${provider.name.toUpperCase()}_${error.category || 'PROVIDER_ERROR'}`, status: error.upstreamStatus || error.status || 503, durationMs: Date.now() - attemptStart });
      if (error.code === 'INVALID_REQUEST') throw error;
      if (started) throw error; // Never mix providers after output has been delivered.
      failures.push(error);
    }
  }
  const codes = failures.map(e => e.code);
  if (codes.includes('RATE_LIMIT')) throw new AppError('RATE_LIMIT', 429);
  if (codes.includes('TIMEOUT')) throw new AppError('TIMEOUT', 504);
  if (codes.every(c => c === 'PROVIDER_CONFIGURATION')) throw new AppError('CONFIGURATION', 503, undefined, false);
  throw new AppError(available.length > 1 ? 'BOTH_UNAVAILABLE' : 'UNAVAILABLE');
}
export async function completeAI(options) {
  let text = '';
  for await (const chunk of routeAI({ ...options, stream: false })) text += chunk.text;
  return text;
}
