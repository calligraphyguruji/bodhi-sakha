// Browser API calls share the frontend origin. No cross-origin credentials are needed.
export function writeCorsHeaders(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const origin = req.headers?.origin;
  if (!origin) return true; // non-browser clients still require auth for private data
  try {
    const parsed = new URL(origin);
    return ['https:', 'http:'].includes(parsed.protocol) && parsed.host === req.headers?.host;
  } catch { return false; }
}
