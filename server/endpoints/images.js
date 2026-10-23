import { extractAuthUser } from './lib/auth.js';
import { AppError, sendError, logFailure } from '../../lib/server/errors.js';
import { providerKey, invalid } from '../../lib/server/validation.js';

export async function generateImage(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) throw invalid('Please enter a shorter image prompt.');
  const key = providerKey('IMAGE_API_KEY') || providerKey('GEMINI_API_KEY');
  if (!key) throw new AppError('CONFIGURATION',503,undefined,false);
  try {
    const model = process.env.IMAGE_MODEL || 'gemini-3.1-flash-image';
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':key},
      body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt.trim()}]}],generationConfig:{responseModalities:['TEXT','IMAGE']}}),
      signal:AbortSignal.timeout(25000),
    });
    if (response.ok) {
      const data = await response.json();
      const image = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData;
      if (image?.data && ['image/png','image/jpeg','image/webp'].includes(image.mimeType) && image.data.length < 3500000) return {imageUrl:`data:${image.mimeType};base64,${image.data}`,prompt:prompt.trim(),provider:'gemini-image'};
    }
  } catch(error) { logFailure('images.generate',error); }
  // Preserve the existing external image URL fallback. It is a third-party service,
  // receives the image prompt, and is not covered by text-provider fallback guarantees.
  return {imageUrl:`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.trim())}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random()*1000000)}`,prompt:prompt.trim(),provider:'pollinations'};
}
export default async function handler(req,res) {
  if (req.method !== 'POST') return sendError(res,new AppError('METHOD_NOT_ALLOWED',405,'Please send a POST request.',false));
  if (!extractAuthUser(req)) return sendError(res,new AppError('UNAUTHORIZED',401,'Please sign in to generate images.',false));
  try { return res.status(200).json(await generateImage(req.body?.prompt)); }
  catch(error) { logFailure('images',error); return sendError(res,error); }
}
