import { logFailure, sendError, AppError } from '../../lib/server/errors.js';
import crypto from 'crypto';
import { db } from './lib/db.js';
import { hashPassword, comparePassword, signToken, extractAuthUser } from './lib/auth.js';
import { writeCorsHeaders } from './lib/cors.js';

export default async function handler(req, res) {
  const isAllowedOrigin = writeCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(isAllowedOrigin ? 200 : 403).end();
  }

  if (!isAllowedOrigin) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  // Parse path or action query parameter
  // Handles /api/auth?action=register or /api/auth/register
  const url = new URL(req.url, 'http://api.internal');
  const pathname = url.pathname.replace(/\/+$/, '');
  const actionParam = url.searchParams.get('action');

  let action = 'me';
  if (actionParam) {
    action = actionParam;
  } else if (pathname.endsWith('/register')) {
    action = 'register';
  } else if (pathname.endsWith('/login')) {
    action = 'login';
  } else if (pathname.endsWith('/logout')) {
    action = 'logout';
  } else if (pathname.endsWith('/me') || pathname.endsWith('/auth')) {
    action = 'me';
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  try {
    // 1. REGISTER
    if (action === 'register' && req.method === 'POST') {
      const { name, email, password, confirmPassword } = body;

      if (typeof name !== 'string' || !name.trim() || name.length > 255) {
        return res.status(400).json({ error: 'Name is required' });
      }
      if (typeof email !== 'string' || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return res.status(400).json({ error: 'Valid email address is required' });
      }
      if (typeof password !== 'string' || password.length < 6 || Buffer.byteLength(password) > 72) {
        return res.status(400).json({ error: 'Password must contain at least 6 characters and at most 72 UTF-8 bytes' });
      }
      if (confirmPassword && password !== confirmPassword) {
        return res.status(400).json({ error: 'Passwords do not match' });
      }

      signToken({ configurationCheck: true });
      const existing = await db.findUserByEmail(email);
      if (existing) {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }

      const passwordHash = await hashPassword(password);
      const userId = 'usr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const user = await db.createUser({
        id: userId,
        name: name.trim(),
        email: email.trim(),
        password_hash: passwordHash,
        avatar_url: null,
      });

      const token = signToken({ id: user.id, email: user.email, name: user.name });
      return res.status(201).json({
        token,
        user: { id: user.id, name: user.name, email: user.email, avatar_url: user.avatar_url },
      });
    }

    // 2. LOGIN
    if (action === 'login' && req.method === 'POST') {
      const { email, password } = body;
      if (typeof email !== 'string' || typeof password !== 'string' || email.length > 255 || Buffer.byteLength(password) > 72) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const user = await db.findUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const valid = await comparePassword(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = signToken({ id: user.id, email: user.email, name: user.name });
      return res.status(200).json({
        token,
        user: { id: user.id, name: user.name, email: user.email, avatar_url: user.avatar_url },
      });
    }

    // 3. LOGOUT
    if (action === 'logout' && req.method === 'POST') {
      return res.status(200).json({ ok: true });
    }

    // 4. ME / SESSION
    if (action === 'me' && req.method === 'GET') {
      const payload = extractAuthUser(req);
      if (!payload) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const user = await db.findUserById(payload.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      return res.status(200).json({ user });
    }

    return res.status(404).json({ error: `Unknown auth action: ${action}` });
  } catch (err) {
    if (err instanceof AppError) return sendError(res, err);
    logFailure('auth', err);
    return res.status(500).json({
      error: 'Authentication service error. Please try again.',
    });
  }
}
