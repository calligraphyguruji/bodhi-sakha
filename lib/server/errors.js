export const MESSAGES = {
  UNAVAILABLE: 'Sorry, Bodhi-Sakha is temporarily unable to respond. Please try again in a few moments.',
  NETWORK: 'Unable to connect right now. Please check your internet connection and try again.',
  TIMEOUT: 'Bodhi-Sakha is taking longer than expected. Please try again.',
  CONFIGURATION: 'Bodhi-Sakha is temporarily unavailable due to a configuration issue. Please try again later.',
  RATE_LIMIT: 'Bodhi-Sakha is receiving too many requests right now. Please wait a moment and try again.',
};
export class AppError extends Error {
  constructor(code, status = 503, message = MESSAGES[code] || MESSAGES.UNAVAILABLE, retryable = true) {
    super(message);
    Object.assign(this, { code, status, retryable });
  }
}
export function publicError(error) {
  const safe = error instanceof AppError ? error : new AppError('UNAVAILABLE');
  return { success: false, error: { code: safe.code, message: safe.message, retryable: safe.retryable }, reply: safe.message };
}
export function sendError(res, error) {
  return res.status(error instanceof AppError ? error.status : 503).json(publicError(error));
}
export function logFailure(scope, error) {
  // Deliberately exclude error.message, upstream body, URLs, tokens and user text.
  console.warn(JSON.stringify({ scope, code: error instanceof AppError ? error.code : 'INTERNAL', status: error instanceof AppError ? error.status : 500 }));
}
