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
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }

  const url = new URL(req.url, 'http://api.internal');
  const pathname = url.pathname.replace(/\/+$/, '');
  const idMatch = pathname.match(/\/api\/conversations\/([^/?]+)/);
  const conversationId = idMatch ? idMatch[1] : url.searchParams.get('id');

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  try {
    if (body.title !== undefined && (typeof body.title !== 'string' || body.title.length > 255)) throw new AppError('INVALID_REQUEST',400,'Please use a shorter conversation title.',false);
    if (['pinned','archived'].some(k => body[k] !== undefined && typeof body[k] !== 'boolean')) throw new AppError('INVALID_REQUEST',400,'Invalid conversation settings.',false);
    // 1. LIST CONVERSATIONS (with optional search)
    if (req.method === 'GET' && !conversationId) {
      const search = url.searchParams.get('search') || '';
      const conversations = await db.getConversations(user.id, { search });
      return res.status(200).json({ conversations });
    }

    // 2. GET SINGLE CONVERSATION + ITS MESSAGES
    if (req.method === 'GET' && conversationId) {
      const conv = await db.getConversation(conversationId, user.id);
      if (!conv) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      const messages = await db.getMessages(conversationId);
      const files = await db.getConversationFiles(conversationId, user.id);
      return res.status(200).json({ conversation: conv, messages, files });
    }

    // 3. CREATE CONVERSATION
    if (req.method === 'POST' && !conversationId) {
      const newId = 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      const title = body.title?.trim() || 'New Chat';
      const conv = await db.createConversation({ id: newId, user_id: user.id, title });
      return res.status(201).json({ conversation: conv });
    }

    // 4. UPDATE CONVERSATION (Rename / Pin / Archive)
    if ((req.method === 'PATCH' || req.method === 'PUT') && conversationId) {
      const { title, pinned, archived } = body;
      const updated = await db.updateConversation(conversationId, user.id, { title, pinned, archived });
      if (!updated) {
        return res.status(404).json({ error: 'Conversation not found or not owned by user' });
      }
      return res.status(200).json({ conversation: updated });
    }

    // 5. DELETE CONVERSATION
    if (req.method === 'DELETE' && conversationId) {
      await db.deleteConversation(conversationId, user.id);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    if (err instanceof AppError) return sendError(res, err);
    logFailure('conversations', err);
    return res.status(500).json({ error: 'Internal server error processing conversations' });
  }
}
