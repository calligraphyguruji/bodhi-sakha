import crypto from 'node:crypto';
import {MAX_IMAGE_SIZE, IMAGE_SIZE_ERROR, isImageFile} from '../../src/utils/uploadLimits.js';
import { AppError } from './errors.js';
import { invalid } from './validation.js';
export const MAX_FILE_SIZE = 15 * 1024 * 1024;
export function validateFile({ fileName, fileType, fileSize }) {
  if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > 255 || !/\.(pdf|docx|txt|csv|json|png|jpg|jpeg|webp)$/i.test(fileName)) throw invalid('Please choose a PDF, DOCX, text, CSV, JSON or supported image file.');
  if (fileType !== undefined && (typeof fileType !== 'string' || fileType.length > 100)) throw invalid('Invalid file type.');
  if (fileSize > MAX_IMAGE_SIZE && isImageFile(fileName,fileType)) throw new AppError('PAYLOAD_TOO_LARGE',413,IMAGE_SIZE_ERROR,false);
  if (fileSize !== undefined && (!Number.isInteger(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_SIZE)) throw new AppError('PAYLOAD_TOO_LARGE',413,'Files must be no larger than 15 MB.',false);
}
function secret() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new AppError('CONFIGURATION',503, 'Large file uploads are temporarily unavailable. Please try a file smaller than 3 MB.',false);
  return process.env.BLOB_READ_WRITE_TOKEN;
}
export function createUploadTicket(data) {
  const payload = Buffer.from(JSON.stringify({ ...data, pathname: `temporary/${crypto.randomUUID()}`, expires: Date.now()+600000 })).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256',secret()).update(payload).digest('base64url')}`;
}
export function verifyUploadTicket(ticket, userId) {
  if (typeof ticket !== 'string' || ticket.length > 4096) throw invalid('Invalid upload ticket.');
  const [payload, signature] = ticket.split('.');
  const expected = crypto.createHmac('sha256',secret()).update(payload || '').digest('base64url');
  if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) throw invalid('Invalid upload ticket.');
  let data;
  try { data = JSON.parse(Buffer.from(payload,'base64url').toString()); } catch { throw invalid('Invalid upload ticket.'); }
  if (data.expires < Date.now() || (data.userId || null) !== (userId || null)) throw new AppError('FORBIDDEN',403,'This upload has expired or belongs to another session.',false);
  return data;
}
