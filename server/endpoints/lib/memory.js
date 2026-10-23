import { completeAI } from '../../../lib/server/ai/aiRouter.js';
import { logFailure } from '../../../lib/server/errors.js';

/**
 * Extracts key personal facts or preferences from recent dialogue
 */
export async function extractMemoriesFromConversation(userMessage, botResponse) {

  // Quick heuristic filter to save LLM tokens if user message lacks self-referential words
  const triggerWords = /\b(my|i am|i'm|i live|i prefer|i like|i love|i hate|i learn|i'm learning|call me|i work as|my name is|mera naam|mujhe|seekh raha)\b/i;
  if (!triggerWords.test(userMessage)) {
    return [];
  }

  const prompt = `You are a memory extraction component for an AI assistant.
Analyze this user-assistant interaction and extract long-term preferences, identity, skills, goals, or facts about the user.
Ignore temporary ephemeral instructions (like "write in bullet points for this reply").

User: "${userMessage.replace(/"/g, '\\"')}"
Assistant: "${(botResponse || '').slice(0, 300).replace(/"/g, '\\"')}"

Output JSON array only of items in this exact format:
[
  { "key": "name", "value": "Aman", "importance": 3 },
  { "key": "learning_topic", "value": "C++", "importance": 2 }
]
If nothing long-term should be remembered, return: []
Do not wrap in markdown quotes. Valid JSON only.`;

  try {
    const result = await completeAI({ system: 'Extract personal preferences as JSON only.', messages: [{ role: 'user', content: prompt }], timeoutMs: 1200, maxTokens: 256 });
    const text = result.trim().replace(/^```json|```$/gi, '').trim();
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.filter(m => typeof m.key === 'string' && typeof m.value === 'string').slice(0, 5).map(m => ({ key: m.key.slice(0,128), value: m.value.slice(0,2000), importance: Math.min(3, Math.max(1, Number(m.importance) || 1)) }));
    }
  } catch (err) {
    logFailure('memory.extract', err);
  }
  return [];
}

/**
 * Formats user memories for inclusion in system prompt / context
 */
export function formatMemoriesForPrompt(memories) {
  if (!Array.isArray(memories) || memories.length === 0) return '';
  const lines = memories.map((m) => `- ${m.memory_key}: ${m.memory_value}`);
  return `[USER LONG-TERM MEMORY & PREFERENCES]:\n${lines.join('\n')}\nUse these preferences naturally to personalize your answers without explicitly saying "According to my memory".`;
}
