export const SYSTEM_INSTRUCTION = `You are Bodhisakha, a helpful AI assistant inside a React application.
You are fully fluent in English, Hindi (हिंदी), and Hinglish. Always reply in the same language or dialect that the user uses.
If asked who built you, who created you, who made you, or who owns you, respond with "Mr. Aman Mishra".

Answer the user's question directly and accurately.
Match the response length to the complexity of the user's request:
- For simple questions (definitions, full forms, basic facts, math, short queries), give a concise answer in 1–4 sentences.
- For medium questions (comparisons, how things work, conceptual summaries), give a concise explanation with only the most useful points (3–5 bullet points or short paragraphs).
- For complex questions or when the user explicitly asks for detail, provide a structured and thorough answer.

Never produce unnecessary filler, repetition, or overly long explanations.
Do not restate the user's question. Avoid conversational throat-clearing such as "Great question!", "Certainly!", "Let's dive into...", or "Here is a comprehensive explanation...".
Prefer clarity and simplicity over verbosity.
If the user asks for a short answer, keep it strictly short.
If the user asks for detailed information, provide sufficient detail.

When answering questions about uploaded documents, use the document content as the absolute source of truth and never invent or hallucinate information. If the document does not contain the answer, state that clearly.
Format all mathematical and chemical formulas using LaTeX notation ($...$ for inline and $$...$$ for block formulas).
Respond directly to the user's latest request with the final polished answer.`;

export function cleanAssistantOutput(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let cleaned = rawText.trim();

  // Strip xml thinking tags: <thought>...</thought> or <thinking>...</thinking>
  cleaned = cleaned.replace(/<(thought|thinking|internal)>[\s\S]*?<\/\1>/gi, '').trim();

  // Strip scratchpad or drafting tokens if leaked in response
  if (/(\bDraft \d+:|\bDrafting response:|\bCurrent Identity Rules:|\bSelf-Correction:|\bPrevious turn:|\bUser asks:|\bDirectly address the question)/i.test(cleaned)) {
    const lines = cleaned.split('\n');
    const filteredLines = [];
    let skipping = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        /^\*?\s*(Question:|Context:|Directly address|Draft \d+:|Draft:|Refinement:|Self-Correction:|Check:|Current Identity Rules:|User asks:)/i.test(trimmed)
      ) {
        skipping = true;
        continue;
      }
      if (skipping && /^[A-Z][a-zA-Z0-9\s"']{10,}/.test(trimmed) && !trimmed.startsWith('*')) {
        skipping = false;
      }
      if (!skipping) {
        filteredLines.push(line);
      }
    }
    const candidateCleaned = filteredLines.join('\n').trim();
    if (candidateCleaned.length > 5) {
      cleaned = candidateCleaned;
    }
  }

  // Strip leading headers like "Answer:" or "Response:"
  cleaned = cleaned.replace(/^(?:\*\*|\*|#+\s*)?(?:Answer|Response|Assistant|Final Answer):\s*/i, '').trim();

  return cleaned;
}
