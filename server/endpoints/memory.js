import { logFailure, sendError, AppError } from '../../lib/server/errors.js';
import { extractAuthUser } from './lib/auth.js';
import { db } from './lib/db.js';
import { writeCorsHeaders } from './lib/cors.js';

export default async function handler(req, res) {
  const isAllowedOrigin = writeCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(isAllowedOrigin ? 200 : 403).end();
  }

  if (!isAllowedOrigin) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  const user = extractAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const url = new URL(req.url, 'http://api.internal');
  const pathname = url.pathname.replace(/\/+$/, '');
  const idMatch = pathname.match(/\/api\/memory\/([^/?]+)/);
  const memoryId = idMatch ? idMatch[1] : url.searchParams.get('id');

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  try {
    // 1. GET ALL USER MEMORIES
    if (req.method === 'GET') {
      const memories = await db.getUserMemory(user.id);
      return res.status(200).json({ memories });
    }

    // 2. ADD / UPDATE A MEMORY
    if (req.method === 'POST') {
      const { memory_key, memory_value, importance = 1 } = body;
      if (typeof memory_key !== 'string' || !memory_key.trim() || memory_key.length > 128 || typeof memory_value !== 'string' || !memory_value.trim() || memory_value.length > 2000 || !Number.isInteger(Number(importance)) || Number(importance) < 1 || Number(importance) > 3) {
        return res.status(400).json({ error: 'memory_key and memory_value are required' });
      }
      const memId = 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const mem = await db.setMemory({
        id: memId,
        user_id: user.id,
        memory_key: memory_key.trim(),
        memory_value: memory_value.trim(),
        importance: Number(importance) || 1,
      });
      return res.status(201).json({ memory: mem });
    }

    // 3. DELETE SPECIFIC MEMORY OR CLEAR ALL
    if (req.method === 'DELETE') {
      if (memoryId) {
        await db.deleteMemory(memoryId, user.id);
        return res.status(200).json({ success: true });
      }
      // If query param ?clearAll=true
      if (url.searchParams.get('clearAll') === 'true') {
        await db.clearUserMemory(user.id);
        return res.status(200).json({ success: true, cleared: true });
      }
      return res.status(400).json({ error: 'Specify memory id to delete or ?clearAll=true' });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    if (err instanceof AppError) return sendError(res, err);
    logFailure('memory', err);
    return res.status(500).json({ error: 'Server error managing memory' });
  }
}
