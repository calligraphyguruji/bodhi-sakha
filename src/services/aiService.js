import {MAX_IMAGE_SIZE, IMAGE_CHUNK_SIZE, IMAGE_SIZE_ERROR, isImageFile} from '../utils/uploadLimits.js';
import { ChatError } from './chatResponse.js';

/**
 * Centralized AI & Backend API Service
 * Encapsulates all backend HTTP communications.
 */

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function readDataURL(file) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error('Unable to read this image.'));
    reader.readAsDataURL(file);
  });
}
async function imageUploadRequest(action,body) {
  const res=await fetch(`/api/files?action=${action}`,{method:'POST',headers:getAuthHeaders(),body:JSON.stringify(body)});
  const result=await res.json();
  if (!res.ok) throw new Error(result?.error?.message || 'Unable to upload this image.');
  return result;
}

export const AIService = {
  // --- AUTHENTICATION ---
  async register(name, email, password, confirmPassword) {
    const res = await fetch(`/api/auth?action=register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, confirmPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || (typeof data.error === 'string' ? data.error : null) || 'Registration failed');
    return data;
  },

  async login(email, password) {
    const res = await fetch(`/api/auth?action=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || (typeof data.error === 'string' ? data.error : null) || 'Login failed');
    return data;
  },

  async getMe() {
    const res = await fetch(`/api/auth?action=me`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.user || null;
  },

  // --- CONVERSATIONS ---
  async getConversations(search = '') {
    const q = search ? `?search=${encodeURIComponent(search)}` : '';
    const res = await fetch(`/api/conversations${q}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to load conversations');
    const data = await res.json();
    return data.conversations || [];
  },

  async getConversation(id) {
    const res = await fetch(`/api/conversations/${id}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to load conversation');
    return res.json();
  },

  async createConversation(title = 'New Chat') {
    const res = await fetch(`/api/conversations`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ title }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ChatError(data?.error?.code || 'UNAVAILABLE',data?.error?.retryable !== false);
    return data.conversation;
  },

  async updateConversation(id, updates) {
    const res = await fetch(`/api/conversations/${id}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error('Failed to update conversation');
    return res.json();
  },

  async deleteConversation(id) {
    const res = await fetch(`/api/conversations/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to delete conversation');
    return res.json();
  },

  // --- CHAT STREAMING & MESSAGES ---
  async sendMessage({ message, history, conversationId, requestId, attachmentIds = [], attachments = [], reasoningMode = false, fileContext = '', signal }) {
    return fetch(`/api/chat`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        message,
        history,
        conversationId,
        requestId,
        attachmentIds,
        attachments,
        reasoningMode,
        fileContext,
        stream: 'sse',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
      signal,
    });
  },

  // --- FILE UPLOAD ---
  async uploadFile({ fileName, fileType, fileData, file, conversationId }) {
    if (file && isImageFile(fileName,fileType)) {
      if (file.size>MAX_IMAGE_SIZE) throw new Error(IMAGE_SIZE_ERROR);
      const upload=await imageUploadRequest('image-start',{fileName,fileType,fileSize:file.size,conversationId});
      const reference={id:upload.id,imageToken:upload.imageToken};
      try {
        for (let offset=0,index=0;offset<file.size;offset+=IMAGE_CHUNK_SIZE,index++) {
          const data=(await readDataURL(file.slice(offset,offset+IMAGE_CHUNK_SIZE))).split(',')[1];
          await imageUploadRequest('image-chunk',{...reference,index,data});
        }
        const result=await imageUploadRequest('image-complete',reference);
        return {...result.file,imageData:await readDataURL(file)};
      } catch (error) {
        await imageUploadRequest('image-discard',reference).catch(()=>{});
        throw error;
      }
    }
    if (file && file.size > 3 * 1024 * 1024) {
      const prepared = await fetch('/api/files?action=prepare', {method:'POST', headers:getAuthHeaders(), body:JSON.stringify({fileName,fileType,fileSize:file.size,conversationId})});
      const data = await prepared.json();
      if (!prepared.ok) throw new Error(data?.error?.message || 'Unable to prepare this upload.');
      const { upload } = await import('@vercel/blob/client');
      await upload(data.pathname,file,{access:'private',handleUploadUrl:'/api/files',clientPayload:data.ticket,headers:getAuthHeaders()});
      const completed = await fetch('/api/files?action=complete',{method:'POST',headers:getAuthHeaders(),body:JSON.stringify({ticket:data.ticket})});
      const result = await completed.json();
      if (!completed.ok) throw new Error(result?.error?.message || 'Unable to process this file.');
      return result.file;
    }
    const res = await fetch(`/api/files`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ fileName, fileType, fileData, conversationId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || (typeof data.error === 'string' ? data.error : null) || 'Upload failed');
    return data.file;
  },

  async deleteFile(id, imageToken) {
    if (imageToken) return imageUploadRequest('image-discard',{id,imageToken});
    const res = await fetch(`/api/files/${encodeURIComponent(id)}`,{method:'DELETE',headers:getAuthHeaders()});
    if (!res.ok) throw new Error('Unable to remove the uploaded file. Please try again.');
  },

  async getFileImage(id, signal) {
    const chunks=[];
    let type, count=1;
    for (let index=0;index<count;index++) {
      const res=await fetch(`/api/files/${encodeURIComponent(id)}?chunk=${index}`,{headers:getAuthHeaders(),signal});
      if (!res.ok) throw new Error('Image unavailable. Please attach it again.');
      const result=await res.json();
      count=result.chunkCount; type=result.fileType;
      if (!Number.isInteger(count) || count<1 || count>Math.ceil(MAX_IMAGE_SIZE/IMAGE_CHUNK_SIZE) || !['image/jpeg','image/png','image/webp'].includes(type) || typeof result.data!=='string') throw new Error('Invalid image response.');
      chunks.push(Uint8Array.from(atob(result.data),c=>c.charCodeAt(0)));
    }
    return readDataURL(new Blob(chunks,{type}));
  },

  // --- IMAGE GENERATION ---
  async generateImage(prompt) {
    const res = await fetch(`/api/images`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || (typeof data.error === 'string' ? data.error : null) || 'Failed to generate image');
    return data;
  },

  // --- USER MEMORY ---
  async getMemories() {
    const res = await fetch(`/api/memory`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch memories');
    const data = await res.json();
    return data.memories || [];
  },

  async addMemory(memory_key, memory_value, importance = 1) {
    const res = await fetch(`/api/memory`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ memory_key, memory_value, importance }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || (typeof data.error === 'string' ? data.error : null) || 'Failed to add memory');
    return data.memory;
  },

  async deleteMemory(id) {
    const res = await fetch(`/api/memory/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to delete memory');
    return res.json();
  },

  async clearAllMemories() {
    const res = await fetch(`/api/memory?clearAll=true`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to clear memories');
    return res.json();
  },
};
