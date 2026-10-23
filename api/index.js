import crypto from 'node:crypto';
import { withDiagnostics } from '../lib/server/diagnostics.js';
import authHandler from '../server/endpoints/auth.js';
import chatHandler from '../server/endpoints/chat.js';
import conversationsHandler from '../server/endpoints/conversations.js';
import filesHandler from '../server/endpoints/files.js';
import imagesHandler from '../server/endpoints/images.js';
import memoryHandler from '../server/endpoints/memory.js';
import { consumeRateLimit } from '../server/endpoints/lib/db.js';
import { extractAuthUser } from '../server/endpoints/lib/auth.js';
import { writeCorsHeaders } from '../server/endpoints/lib/cors.js';
import { AppError, sendError, logFailure } from '../lib/server/errors.js';
import { parseBody, MAX_BODY_BYTES } from '../lib/server/validation.js';

// Plain Vercel Node function. Read the body ourselves to enforce limits consistently.
export const config = { api: { bodyParser: false } };
const routes = { chat: chatHandler, auth: authHandler, conversations: conversationsHandler, files: filesHandler, images: imagesHandler, memory: memoryHandler };

async function handler(req, res) {
  // Normalize retained CRUD validation errors at the shared API boundary.
  const json = res.json.bind(res);
  res.json = value => {
    if (res.statusCode >= 400 && typeof value?.error === 'string') {
      const codes = {400:'INVALID_REQUEST',401:'UNAUTHORIZED',403:'FORBIDDEN',404:'NOT_FOUND',405:'METHOD_NOT_ALLOWED',409:'CONFLICT',413:'PAYLOAD_TOO_LARGE',429:'RATE_LIMIT'};
      const code = codes[res.statusCode] || 'UNAVAILABLE';
      return json({success:false,error:{code,message:value.error,retryable:res.statusCode >= 500 || res.statusCode===429},reply:value.error});
    }
    return json(value);
  };
  try {
    const allowed = writeCorsHeaders(req, res);
    if (!allowed) throw new AppError('FORBIDDEN', 403, 'This request is not allowed.', false);
    if (req.method === 'OPTIONS') return res.status(204).end();
    const url = new URL(req.url, 'http://api.internal');
    const segments = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    const route = segments[1];
    if (url.pathname === '/api' || url.pathname === '/api/health' || (route === 'chat' && req.method === 'GET')) {
      if (req.method !== 'GET') { res.setHeader('Allow','GET'); throw new AppError('METHOD_NOT_ALLOWED',405,'Please send a GET request.',false); }
      return res.status(200).json({ status: 'ok', service: 'Bodhi-Sakha' });
    }
    if (segments[0] !== 'api' || !Object.hasOwn(routes, route)) throw new AppError('NOT_FOUND', 404, 'API route not found.', false);
    if (route === 'chat' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      throw new AppError('METHOD_NOT_ALLOWED', 405, 'Please send a POST request.', false);
    }
    if (req.method !== 'GET' && req.method !== 'DELETE') {
      const type = req.headers?.['content-type'] || '';
      if (!type.toLowerCase().startsWith('application/json')) throw new AppError('UNSUPPORTED_MEDIA_TYPE',415,'Please send JSON.',false);
      if (req.body === undefined && req[Symbol.asyncIterator]) {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += Buffer.byteLength(chunk);
          if (size > MAX_BODY_BYTES) throw new AppError('PAYLOAD_TOO_LARGE',413,'This request is too large.',false);
          chunks.push(Buffer.from(chunk));
        }
        req.body = Buffer.concat(chunks).toString('utf8');
      }
      req.body = parseBody(req.body);
    }
    // Blob completion callbacks are signed/verified by the SDK, and don't spend an IP bucket.
    const callback = route === 'files' && req.body?.type === 'blob.upload-completed';
    if (!callback) {
      const user = extractAuthUser(req);
      const ip = process.env.VERCEL ? (req.headers?.['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown') : (req.socket?.remoteAddress || 'local');
      const identity = user?.id || ip;
      const digest = crypto.createHash('sha256').update(String(identity)).digest('hex');
      const group = route === 'auth' ? 'auth' : ['chat','images','files'].includes(route) ? 'ai' : 'crud';
      if (!await consumeRateLimit(`${group}:${digest}`, group === 'auth' ? 10 : group === 'ai' ? 20 : 120)) {
        res.setHeader('Retry-After','60'); throw new AppError('RATE_LIMIT',429);
      }
    }
    return await routes[route](req, res);
  } catch(error) {
    logFailure('gateway', error);
    if (res.headersSent) return res.end();
    return sendError(res, error);
  }
}

export default withDiagnostics(handler);
