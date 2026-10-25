import crypto from 'node:crypto';
import {AppError} from './errors.js';
import {validateFile} from './uploads.js';
import {MAX_IMAGE_SIZE, IMAGE_CHUNK_SIZE, IMAGE_SIZE_ERROR, isImageFile} from '../../src/utils/uploadLimits.js';
const invalid = message => new AppError('INVALID_REQUEST',400,message,false);
export const imageTokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
export async function readImageUpload(db,id,token,userId) {
  if (typeof id!=='string' || !/^file_[a-f0-9-]{36}$/.test(id) || typeof token!=='string' || !/^[a-f0-9]{64}$/.test(token)) throw invalid('Invalid image upload reference.');
  const item=await db.getImageUpload(id,imageTokenHash(token));
  if (!item || (item.user_id || null)!==(userId || null)) throw new AppError('IMAGE_CONTEXT_MISSING',422,'This image is unavailable or expired. Please attach it again.',false);
  return item;
}
export async function startImageUpload(db,body,userId) {
  validateFile(body);
  if (!isImageFile(body.fileName,body.fileType) || !Number.isInteger(body.fileSize) || body.fileSize<=0) throw invalid('Please select a supported image.');
  if (body.fileSize>MAX_IMAGE_SIZE) throw new AppError('PAYLOAD_TOO_LARGE',413,IMAGE_SIZE_ERROR,false);
  const id='file_'+crypto.randomUUID(), imageToken=crypto.randomBytes(32).toString('hex');
  await db.createImageUpload({id,token_hash:imageTokenHash(imageToken),user_id:userId || null,conversation_id:body.conversationId || null,file_name:body.fileName,file_type:body.fileType || '',file_size:body.fileSize,expires_at:new Date(Date.now()+900000).toISOString()});
  return {id,imageToken,chunkSize:IMAGE_CHUNK_SIZE};
}
export async function saveImageChunk(db,item,body) {
  const count=Math.ceil(item.file_size/IMAGE_CHUNK_SIZE);
  if (!Number.isInteger(body.index) || body.index<0 || body.index>=count || typeof body.data!=='string' || body.data.length>Math.ceil(IMAGE_CHUNK_SIZE/3)*4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data)) throw invalid('Invalid image chunk.');
  const bytes=Buffer.from(body.data,'base64');
  const expected=Math.min(IMAGE_CHUNK_SIZE,item.file_size-body.index*IMAGE_CHUNK_SIZE);
  if (bytes.length!==expected || bytes.toString('base64')!==body.data) throw invalid('Image chunk size does not match the upload.');
  if (!await db.putImageChunk(item.id,item.token_hash,body.index,body.data)) throw invalid('This image chunk cannot be changed. Please attach the image again.');
}
export function uploadedImageBuffer(item) {
  const count=Math.ceil(item.file_size/IMAGE_CHUNK_SIZE);
  const chunks=Array.from({length:count},(_,i)=>item.chunks[i]);
  if (chunks.some(c=>typeof c!=='string')) throw invalid('Image upload is incomplete. Please try again.');
  const buffer=Buffer.concat(chunks.map(c=>Buffer.from(c,'base64')));
  if (buffer.length!==item.file_size || buffer.length>MAX_IMAGE_SIZE) throw invalid('Image upload size does not match.');
  return buffer;
}

// Preserve guest originals finalized through the retained large-document/Blob path.
export async function stageValidatedGuestImage(db,buffer,fileName,fileType) {
  const reference=await startImageUpload(db,{fileName,fileType,fileSize:buffer.length},null);
  const item=await readImageUpload(db,reference.id,reference.imageToken,null);
  for(let offset=0,index=0;offset<buffer.length;offset+=IMAGE_CHUNK_SIZE,index++) {
    await saveImageChunk(db,item,{index,data:buffer.subarray(offset,offset+IMAGE_CHUNK_SIZE).toString('base64')});
  }
  await db.finishImageUpload(reference.id,item.token_hash,fileType);
  return reference;
}
