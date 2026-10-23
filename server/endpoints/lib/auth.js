import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

import { AppError } from '../../../lib/server/errors.js';

function getSecret() {
  const secret = process.env.JWT_SECRET || process.env.AUTH_SECRET;
  if (!secret || secret.length < 32 || /^(your_|placeholder)/i.test(secret)) {
    throw new AppError('CONFIGURATION', 503, undefined, false);
  }
  return secret;
}
const TOKEN_EXPIRY = '7d';

export function signToken(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: TOKEN_EXPIRY, algorithm: 'HS256' });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, getSecret(), { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

export async function hashPassword(plainText) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plainText, salt);
}

export async function comparePassword(plainText, hash) {
  return bcrypt.compare(plainText, hash);
}

/**
 * Extracts Bearer token from Authorization header or cookie
 */
export function extractAuthUser(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers?.cookie) {
    const cookies = Object.fromEntries(
      req.headers.cookie.split(';').map((c) => {
        const [k, ...v] = c.trim().split('=');
        return [k, v.join('=')];
      })
    );
    token = cookies.token || cookies.auth_token;
  }

  if (!token) return null;
  return verifyToken(token);
}

/**
 * Optional middleware to enforce authentication
 */
export function requireAuth(req, res, next) {
  const user = extractAuthUser(req);
  if (!user) {
    return res.status(401).json({
      error: 'Unauthorized',
      reply: 'Your session has expired or is invalid. Please sign in again.',
    });
  }
  req.user = user;
  if (typeof next === 'function') next();
}
