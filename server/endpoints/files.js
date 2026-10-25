import crypto from 'node:crypto';
import {IMAGE_CHUNK_SIZE} from '../../src/utils/uploadLimits.js';
import {startImageUpload,readImageUpload,saveImageChunk,uploadedImageBuffer,stageValidatedGuestImage} from '../../lib/server/imageUploads.js';
import { validateImage } from '../../lib/server/vision.js';
import { get, del } from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';
import { extractText } from 'unpdf';
import mammoth from 'mammoth';
import { extractAuthUser } from './lib/auth.js';
import { db } from './lib/db.js';
import { AppError, sendError, logFailure } from '../../lib/server/errors.js';
import { invalid } from '../../lib/server/validation.js';
import { MAX_FILE_SIZE, validateFile, createUploadTicket, verifyUploadTicket } from '../../lib/server/uploads.js';

/**
 * Extracts plain text from various file formats
 */
async function parseFileContent(buffer, mimeType, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();

  // 1. Plain text formats
  if (
    mimeType.startsWith('text/') ||
    ['txt', 'md', 'csv', 'json', 'js', 'py', 'ts', 'html'].includes(ext)
  ) {
    const text = buffer.toString('utf-8');
    if (ext === 'json') {
      try {
        const parsed = JSON.parse(text);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return text;
      }
    }
    return text;
  }

  // 2. PDF extraction (serverless-native via unpdf)
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    try {
      const { text } = await extractText(new Uint8Array(buffer));
      return (Array.isArray(text) ? text.join('\n') : (text || '')).trim();
    } catch (e) {
      logFailure('pdf.extract', e);
      throw new AppError('INVALID_FILE',422,'Unable to read this PDF. Please try another file.',false);
    }
  }

  // 3. Word Document DOCX
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    } catch (e) {
      logFailure('docx.extract', e);
      throw new AppError('INVALID_FILE',422,'Unable to read this document. Please try another file.',false);
    }
  }

  return buffer.toString('utf-8').slice(0, 10000);
}

export default async function handler(req, res) {
  const user = extractAuthUser(req);
  const url = new URL(req.url, 'http://api.internal');
  const action = url.searchParams.get('action');
  try {
    const body = req.body || {};
    if (req.method === 'POST' && ['image-start','image-chunk','image-complete','image-discard'].includes(action)) {
      if (action === 'image-start') {
        if (body.conversationId && (!user || !await db.getConversation(body.conversationId,user.id))) throw new AppError('NOT_FOUND',404,'Conversation not found.',false);
        return res.status(200).json(await startImageUpload(db,body,user?.id));
      }
      if (action === 'image-complete' && user) {
        const existing=await db.getUploadedFile(body.id,user.id);
        if (existing) return res.status(200).json({file:{id:existing.id,fileName:existing.file_name,fileType:existing.file_type,fileSize:existing.file_size,hasText:false,extractedText:''}});
      }
      const upload=await readImageUpload(db,body.id,body.imageToken,user?.id);
      if (action === 'image-discard') {
        await db.deleteImageUpload(upload.id,upload.token_hash);
        return res.status(200).json({success:true});
      }
      if (action === 'image-chunk') {
        await saveImageChunk(db,upload,body);
        return res.status(200).json({success:true});
      }
      const buffer=uploadedImageBuffer(upload);
      const fileType=await validateImage(buffer,upload.file_type);
      if (upload.conversation_id && !await db.getConversation(upload.conversation_id,user?.id)) throw new AppError('NOT_FOUND',404,'Conversation not found.',false);
      if (user) {
        await db.createUploadedFile({id:upload.id,user_id:user.id,conversation_id:upload.conversation_id,file_name:upload.file_name,file_type:fileType,file_size:buffer.length,storage_url:`data:${fileType};base64,${buffer.toString('base64')}`,extracted_text:''});
        await db.deleteImageUpload(upload.id,upload.token_hash);
      } else await db.finishImageUpload(upload.id,upload.token_hash,fileType);
      return res.status(200).json({file:{id:upload.id,fileName:upload.file_name,fileType,fileSize:buffer.length,hasText:false,extractedText:'',...(!user ? {imageToken:body.imageToken} : {})}});
    }
    if (req.method === 'POST' && body.type?.startsWith('blob.')) {
      const result = await handleUpload({ request: req, body,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          const ticket = verifyUploadTicket(clientPayload, user?.id);
          if (pathname !== ticket.pathname) throw invalid('Invalid upload path.');
          return { maximumSizeInBytes: ticket.fileSize, addRandomSuffix: false, allowOverwrite: false,
            validUntil: ticket.expires, ...(ticket.fileType ? {allowedContentTypes:[ticket.fileType]} : {}) };
        },
      });
      return res.status(200).json(result);
    }
    if (req.method === 'GET') {
      if (!user) throw new AppError('UNAUTHORIZED',401,'Please sign in to view this image.',false);
      const file = await db.getUploadedFile(url.pathname.split('/')[3], user.id);
      if (!file?.storage_url?.startsWith('data:image/')) throw new AppError('NOT_FOUND',404,'Image unavailable. Please attach it again.',false);
      res.setHeader('Cache-Control','private, no-store');
      const chunk=url.searchParams.get('chunk');
      if (chunk !== null) {
        const index=Number(chunk), count=Math.ceil(file.file_size/IMAGE_CHUNK_SIZE);
        if (!/^\d+$/.test(chunk) || !Number.isSafeInteger(index) || index>=count) throw invalid('Invalid image chunk.');
        const bytes=Buffer.from(file.storage_url.split(',')[1],'base64');
        return res.status(200).json({data:bytes.subarray(index*IMAGE_CHUNK_SIZE,(index+1)*IMAGE_CHUNK_SIZE).toString('base64'),fileType:file.file_type,chunkCount:count});
      }
      if (file.file_size>3*1024*1024) throw invalid('Please retrieve this image in chunks.');
      return res.status(200).json({imageData:file.storage_url});
    }
    if (req.method === 'DELETE') {
      if (!user) throw new AppError('UNAUTHORIZED',401,'Please sign in to delete files.',false);
      const id = url.pathname.split('/')[3] || url.searchParams.get('id');
      if (!id) throw invalid('Please specify a file.');
      await db.deleteFile(id,user.id);
      return res.status(200).json({success:true});
    }
    if (req.method !== 'POST') throw new AppError('METHOD_NOT_ALLOWED',405,'Please send a POST request.',false);
    let { fileName, fileType = '', conversationId, fileData } = body;
    let buffer;
    let temporaryPath;
    if (action === 'complete') {
      const ticket = verifyUploadTicket(body.ticket,user?.id);
      ({fileName,fileType,conversationId} = ticket);
      temporaryPath = ticket.pathname;
      const blob = await get(temporaryPath,{access:'private',useCache:false,abortSignal:AbortSignal.timeout(10000)});
      if (!blob || blob.statusCode !== 200) throw invalid('Upload not found. Please attach the file again.');
      const chunks=[]; let size=0;
      for await (const chunk of blob.stream) {
        size += chunk.length;
        if (size > MAX_FILE_SIZE || size > ticket.fileSize) throw invalid('The uploaded file is too large.');
        chunks.push(Buffer.from(chunk));
      }
      buffer = Buffer.concat(chunks);
    } else {
      validateFile(body);
      if (conversationId && (!user || !await db.getConversation(conversationId,user.id))) throw new AppError('NOT_FOUND',404,'Conversation not found.',false);
      if (action === 'prepare') {
        if (!Number.isInteger(body.fileSize)) throw invalid('File size is required.');
        const ticket = createUploadTicket({fileName,fileType,fileSize:body.fileSize,conversationId:conversationId || null,userId:user?.id || null});
        return res.status(200).json({ticket,pathname:verifyUploadTicket(ticket,user?.id).pathname});
      }
      if (typeof fileData !== 'string' || fileData.length > 4200000) throw invalid('Please attach this file using direct upload.');
      const base64 = fileData.replace(/^data:[^;]*;base64,/, '');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || !base64) throw invalid('Invalid file data.');
      buffer = Buffer.from(base64,'base64');
    }
    validateFile({fileName,fileType,fileSize:buffer.length});
    if (conversationId && (!user || !await db.getConversation(conversationId,user.id))) throw new AppError('NOT_FOUND',404,'Conversation not found.',false);
    try {
      const isImage = /\.(png|jpe?g|webp)$/i.test(fileName) || fileType.startsWith('image/');
      if (isImage) fileType = await validateImage(buffer,fileType);
      const imageData = isImage ? `data:${fileType};base64,${buffer.toString('base64')}` : null;
      const extractedText = isImage ? '' : (await parseFileContent(buffer,fileType,fileName)).slice(0,100000);
      let id = 'file_'+crypto.randomUUID();
      let imageToken;
      if (imageData && !user && buffer.length>3*1024*1024) {
        const reference=await stageValidatedGuestImage(db,buffer,fileName,fileType);
        id=reference.id;imageToken=reference.imageToken;
      }
      // Bounded image bytes live in the existing private DB; no public object URLs.
      if (user) await db.createUploadedFile({id,user_id:user.id,conversation_id:conversationId || null,file_name:fileName,file_type:fileType,file_size:buffer.length,storage_url:imageData,extracted_text:extractedText});
      return res.status(user ? 201 : 200).json({file:{id,fileName,fileType,fileSize:buffer.length,hasText:Boolean(extractedText),extractedText,...(imageToken ? {imageToken} : {}),...(imageData && buffer.length<=3*1024*1024 ? {imageData} : {})}});
    } finally {
      if (temporaryPath) await del(temporaryPath).catch(error => logFailure('blob.cleanup',error));
    }
  } catch(error) { logFailure('files',error); return sendError(res,error); }
}
