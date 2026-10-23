import { providerKey } from './validation.js';

// No values are returned: safe to run locally or in a deployment environment.
export function configurationIssues(env = process.env) {
  const issues = [];
  for (const name of ['DATABASE_URL']) {
    if (!env[name]?.trim()) issues.push(`${name}_MISSING`);
  }
  const authSecret = providerKey('JWT_SECRET', env) || providerKey('AUTH_SECRET', env);
  if (!authSecret) issues.push('JWT_SECRET_MISSING');
  else if (authSecret.length < 32) issues.push('JWT_SECRET_TOO_SHORT');
  if (!providerKey('GEMINI_API_KEY', env) && !providerKey('GROQ_API_KEY', env)) issues.push('AI_KEYS_MISSING');
  if (['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'].includes(env.GROQ_MODEL?.trim())) issues.push('GROQ_MODEL_RETIRED');
  return issues;
}
