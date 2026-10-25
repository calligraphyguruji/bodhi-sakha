import { logAI } from './diagnostics.js';
export const MESSAGES = {
  VISION_UNAVAILABLE: 'Sorry, I’m having trouble analyzing this image right now. Please try again shortly.',
  IMAGE_CONTEXT_MISSING: 'This image is no longer available. Please attach it again.',
  VISION_LIMIT: 'A conversation supports up to 3 images totaling 2.8 MB. Please start a new chat with fewer or smaller images.',
  UNAVAILABLE: 'I’m having trouble connecting to the AI service right now. Please try again in a moment.',
  NETWORK: 'Unable to connect to the server. Please check your internet connection.',
  TIMEOUT: 'The response is taking longer than expected. Please try again.',
  CONFIGURATION: 'Bodhi-Sakha is temporarily unavailable. Please try again later.',
  BOTH_UNAVAILABLE: 'Both AI services are temporarily unavailable. Please try again shortly.',
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
  res.aiErrorCode = error instanceof AppError ? error.code : 'UNAVAILABLE';
  return res.status(error instanceof AppError ? error.status : 503).json(publicError(error));
}
export function logFailure(_scope, error) {
  // Deliberately exclude error.message, upstream body, URLs, tokens and user text.
  logAI(`${_scope}.failure`, { category: error.category || (error instanceof AppError ? error.code : 'INTERNAL'), status: error instanceof AppError ? error.status : 500 });
}
