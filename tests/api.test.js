import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { providerFetch } from './helpers/providerFetch.js';
process.env.NODE_ENV='test';
process.env.ALLOW_LOCAL_DB='true';
process.env.JWT_SECRET='test-secret-with-at-least-thirty-two-characters';
process.env.BLOB_READ_WRITE_TOKEN='dummy-blob-secret-for-ticket-tests';
process.env.GEMINI_API_KEY='dummy-gemini';
process.env.GROQ_API_KEY='dummy-groq';
process.env.GEMINI_TEST_URL=process.env.SIM_URL ? process.env.SIM_URL+'/gemini' : 'http://providers.test';
process.env.GROQ_TEST_URL=process.env.SIM_URL ? process.env.SIM_URL+'/groq' : 'http://providers.test';
delete process.env.DATABASE_URL;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bodhi-api-'));
process.env.LOCAL_DATA_DIR=dir;
const {default:gateway}=await import('../api/index.js');
const {db}=await import('../server/endpoints/lib/db.js');
const {signToken}=await import('../server/endpoints/lib/auth.js');
const {createUploadTicket,verifyUploadTicket}=await import('../lib/server/uploads.js');
const originalFetch=globalThis.fetch;
const requests=[];
globalThis.fetch=process.env.SIM_URL ? (url,options) => {requests.push({url:new URL(url).pathname,body:JSON.parse(options.body)});return originalFetch(url,options);} : providerFetch(requests);
test.after(()=>{globalThis.fetch=originalFetch;fs.rmSync(dir,{recursive:true,force:true});});
async function call(url,body,{token,method='POST',origin='https://bodhi.test'}={}) {
  const req={url,method,body,headers:{host:'bodhi.test',origin,'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})}};
  const res={statusCode:200,headers:{},text:'',headersSent:false,setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(s){this.statusCode=s;return this;},json(value){this.data=value;return this;},write(value){this.headersSent=true;this.text+=value;},end(){this.ended=true;},destroy(){this.destroyed=true;}};
  await gateway(req,res);return res;
}
test('gateway contract, auth, ownership, persistence and retry',async()=>{
  assert.equal((await call('/api/health',null,{method:'GET'})).statusCode,200);
  assert.equal((await call('/api/missing',{})).statusCode,404);
  assert.equal((await call('/api/chat',{message:'x'},{origin:'https://evil.test'})).statusCode,403);
  assert.equal((await call('/api/chat',{message:''})).statusCode,400);
  assert.equal((await call('/api/chat',{}, {method:'PUT'})).statusCode,405);
  assert.equal((await call('/api/chat','{invalid')).statusCode,400);
  const a=(await call('/api/auth?action=register',{name:'Tester',email:'a@test.example',password:'password123',confirmPassword:'password123'})).data;
  assert.ok(a.token);
  assert.equal((await call('/api/auth?action=login',{email:'a@test.example',password:'wrong'})).statusCode,401);
  const b=await db.createUser({id:'user_b',name:'B',email:'b@test.example',password_hash:'unused'});
  const tokenB=signToken({id:b.id});
  const conv=(await call('/api/conversations',{title:'Preserved history'},{token:a.token})).data.conversation;
  assert.equal((await call(`/api/conversations/${conv.id}`,null,{method:'GET',token:tokenB})).statusCode,404);
  const upload=(await call('/api/files',{fileName:'notes.txt',fileType:'text/plain',fileData:Buffer.from('Document source text').toString('base64')},{token:a.token})).data.file;
  assert.equal((await call('/api/files',{fileName:'notes.txt',fileData:'eA==',conversationId:conv.id},{token:tokenB})).statusCode,404);
  const body={message:'Explain a concept',conversationId:conv.id,requestId:'request_same',attachmentIds:[upload.id],stream:'sse'};
  const reply=await call('/api/chat',body,{token:a.token});
  assert.equal(reply.statusCode,200);assert.match(reply.text,/event: done/);
  assert.match(JSON.stringify(requests.at(-1).body),/Document source text/);
  const providerCalls=requests.length;
  const retry=await call('/api/chat',body,{token:a.token});
  assert.equal(requests.length,providerCalls);
  assert.equal(retry.statusCode,200);
  const saved=(await call(`/api/conversations/${conv.id}`,null,{method:'GET',token:a.token})).data;
  assert.equal(saved.messages.length,2);assert.equal(saved.files.length,1);
  assert.equal(saved.messages[0].content,'Explain a concept');
  assert.equal((await call('/api/chat',{...body,requestId:'other'},{token:tokenB})).statusCode,404);
  assert.equal((await call('/api/conversations/'+conv.id,{}, {method:'PATCH',token:a.token})).statusCode,200);
});
test('SSE partial failure is explicit and provider does not switch',async()=>{
  const start=requests.length;
  const res=await call('/api/chat',{message:'gemini:partial',stream:'sse'});
  assert.match(res.text,/event: delta/);assert.match(res.text,/event: error/);assert.doesNotMatch(res.text,/event: done/);
  assert.equal(requests.length-start,1);
});
test('production fails closed without a durable database',async()=>{
  process.env.NODE_ENV='production';
  const start = requests.length;
  const originalInfo = console.info;
  const logs = [];
  console.info = value => logs.push(JSON.parse(value));
  try {
    const res=await call('/api/chat',{message:'sensitive-question-never-log'});
    assert.equal(res.statusCode,503);assert.equal(res.data.error.code,'CONFIGURATION');
    assert.equal(requests.length,start); // Both AI keys exist, but the gateway fails first.
    assert.ok(logs.some(entry => entry.category === 'DATABASE_URL_MISSING'));
    assert.ok(logs.every(entry => entry.requestId === res.headers['x-request-id']));
    assert.equal(logs.at(-1).event,'request.failed');
    assert.doesNotMatch(JSON.stringify(logs),/sensitive-question|dummy-gemini|dummy-groq/);
  }
  finally {console.info = originalInfo;process.env.NODE_ENV='test';}
});
test('JWT signing has no default secret',()=>{
  const secret=process.env.JWT_SECRET;delete process.env.JWT_SECRET;
  try {assert.throws(()=>signToken({id:'attacker'}));}finally{process.env.JWT_SECRET=secret;}
});
test('upload tickets enforce integrity, session and expiry',()=>{
  const ticket=createUploadTicket({userId:'a',fileName:'test.txt',fileType:'text/plain',fileSize:1024});
  assert.equal(verifyUploadTicket(ticket,'a').fileName,'test.txt');
  assert.throws(()=>verifyUploadTicket(ticket,'b'));
  assert.throws(()=>verifyUploadTicket(ticket+'x','a'));
  const now=Date.now;Date.now=()=>now()+700000;
  try{assert.throws(()=>verifyUploadTicket(ticket,'a'));}finally{Date.now=now;}
});

test('3 MiB inline upload fits the gateway below the Vercel ceiling',async()=>{
  const response=await call('/api/files',{fileName:'large.txt',fileType:'text/plain',fileData:Buffer.alloc(3*1024*1024,65).toString('base64')});
  assert.equal(response.statusCode,200);
  assert.equal(response.data.file.fileSize,3*1024*1024);
  assert.equal(response.data.file.extractedText.length,100000);
});

const {default:sharp} = await import('sharp');
async function visionFile(format='png') {
  const buffer = await sharp({create:{width:24,height:24,channels:3,background:'#e03020'}}).toFormat(format).toBuffer();
  return {fileName:`diagram.${format === 'jpeg' ? 'jpg' : format}`,fileType:`image/${format}`,fileData:`data:image/${format};base64,${buffer.toString('base64')}`};
}
for (const format of ['jpeg','png','webp']) test(`${format} bytes traverse upload → chat → Gemini inlineData`,async()=>{
  const source = await visionFile(format);
  const upload = await call('/api/files',source);
  assert.equal(upload.statusCode,200);
  const file = upload.data.file;
  assert.equal(file.extractedText,'');
  assert.equal(file.imageData,source.fileData);
  requests.length=0;
  const result = await call('/api/chat',{message:'What is in this image?',attachments:[file]});
  assert.equal(result.statusCode,200);
  assert.equal(result.data.reply,'gemini response');
  assert.equal(requests.length,1);
  assert.match(requests[0].url,/gemini-3.8-flash/);
  const part = requests[0].body.contents[0].parts.find(p=>p.inlineData);
  assert.equal(part.inlineData.data,source.fileData.split(',')[1]);
  assert.equal(part.inlineData.mimeType,source.fileType);
});
test('algorithm/code/OCR prompts and multiple images retain bytes and message association on follow-up',async()=>{
  const a=(await call('/api/files',await visionFile())).data.file;
  const b=(await call('/api/files',await visionFile('webp'))).data.file;
  for (const prompt of ['Explain the algorithm diagram and dry run','Explain the C++ code in this screenshot','Read the visible text']) {
    requests.length=0;
    const response=await call('/api/chat',{message:prompt,attachments:[a,b]});
    assert.equal(response.statusCode,200);
    assert.equal(requests[0].body.contents[0].parts.filter(p=>p.inlineData).length,2);
    assert.match(requests[0].body.contents[0].parts[0].text,new RegExp(prompt.replace(/[+]/g,'\\+')));
  }
  requests.length=0;
  await call('/api/chat',{message:'What is its time complexity?',history:[{sender:'user',text:'Explain this algorithm',attachments:[a]},{sender:'bot',text:'A linear scan'}]});
  assert.equal(requests[0].body.contents[0].parts.find(p=>p.inlineData).inlineData.data,a.imageData.split(',')[1]);
  assert.ok(requests[0].body.contents.at(-1).parts[0].text.startsWith('What is its time complexity?'));
});
test('vision fallback uses a vision model and data URL; dual failure is friendly',async()=>{
  const file=(await call('/api/files',await visionFile())).data.file;
  requests.length=0;
  const response=await call('/api/chat',{message:'gemini:422 explain image',attachments:[file]});
  assert.equal(response.data.reply,'groq response');
  assert.equal(requests.length,2);
  const fallback=requests[1].body;
  assert.equal(fallback.model,'qwen/qwen3.8-27b');
  assert.equal(fallback.messages.at(-1).content.find(p=>p.type==='image_url').image_url.url,file.imageData);
  assert.match(fallback.messages.at(-1).content[0].text,/gemini:422 explain image/);
  const failure=await call('/api/chat',{message:'gemini:503 groq:503',attachments:[file],stream:'sse'});
  assert.equal(failure.data.error.code,'VISION_UNAVAILABLE');
  assert.equal(failure.data.reply,'Sorry, I’m having trouble analyzing this image right now. Please try again shortly.');
  process.env.GROQ_VISION_MODEL='openai/gpt-oss-120b';
  try {
    requests.length=0;
    assert.equal((await call('/api/chat',{message:'gemini:503',attachments:[file]})).data.error.code,'VISION_UNAVAILABLE');
    assert.equal(requests.length,1);
  } finally {delete process.env.GROQ_VISION_MODEL;}
});
test('signed-in images persist privately across reload and other users cannot read them',async()=>{
  const user=await db.createUser({id:'vision_user',name:'Vision',email:'vision@test.example',password_hash:'unused'});
  const token=signToken({id:user.id});
  const conv=(await call('/api/conversations',{title:'Images'},{token})).data.conversation;
  const file=(await call('/api/files',await visionFile(),{token})).data.file;
  const turn=await call('/api/chat',{message:'Explain the image',conversationId:conv.id,attachmentIds:[file.id],requestId:'vision_first'},{token});
  assert.equal(turn.statusCode,200);
  const reload=await call(`/api/conversations/${conv.id}`,null,{token,method:'GET'});
  assert.equal(reload.data.messages[0].metadata.attachments[0].id,file.id);
  assert.equal(reload.data.files[0].storage_url,undefined);
  const image=await call(`/api/files/${file.id}`,null,{token,method:'GET'});
  assert.equal(image.data.imageData,file.imageData);
  assert.equal((await call(`/api/files/${file.id}`,null,{method:'GET'})).statusCode,401);
  assert.equal((await call(`/api/files/${file.id}`,null,{token:signToken({id:'user_b'}),method:'GET'})).statusCode,404);
  requests.length=0;
  const followup=await call('/api/chat',{message:'Write its C++ implementation',history:[],conversationId:conv.id,requestId:'vision_followup'},{token});
  assert.equal(followup.statusCode,200);
  assert.ok(requests[0].body.contents[0].parts.some(p=>p.inlineData));
  await db.deleteFile(file.id,user.id);
  assert.equal((await call('/api/chat',{message:'Read it again',conversationId:conv.id,requestId:'vision_missing'},{token})).data.error.code,'IMAGE_CONTEXT_MISSING');
});
test('corrupt, disguised, unsupported and oversized images are rejected before providers',async()=>{
  const source=await visionFile();
  for(const body of [ {...source,fileType:'image/jpeg'}, {...source,fileData:'data:image/png;base64,aW52YWxpZA=='}, {...source,fileData:source.fileData.slice(0,-20)}, {...source,fileName:'attack.svg',fileType:'image/svg+xml'}]) {
    assert.ok((await call('/api/files',body)).statusCode>=400);
  }
  const oversized=await call('/api/files?action=image-start',{fileName:'large.png',fileType:'image/png',fileSize:5*1024*1024+1});
  assert.equal(oversized.statusCode,413);
  assert.equal(oversized.data.reply,'Image size exceeds 5 MB. Please upload an image smaller than 5 MB.');
  const file=(await call('/api/files',source)).data.file;
  assert.equal((await call('/api/chat',{message:'See these',attachments:[file,file,file,file]})).data.error.code,'VISION_LIMIT');
  assert.equal((await call('/api/chat',{message:'See it',attachments:[{id:'file_missing',fileName:'old.png',fileType:'image/png'}]})).data.error.code,'IMAGE_CONTEXT_MISSING');
});

test('PDF extraction and document chat remain available',async()=>{
  const stream='BT /F1 14 Tf 30 100 Td (PDF regression source) Tj ET';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf='%PDF-1.4\n';const offsets=[0];
  for(const [i,obj] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);
  pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const response=await call('/api/files',{fileName:'sample.pdf',fileType:'application/pdf',fileData:Buffer.from(pdf).toString('base64')});
  assert.equal(response.statusCode,200);
  assert.match(response.data.file.extractedText,/PDF regression source/);
  requests.length=0;
  assert.equal((await call('/api/chat',{message:'Summarize the PDF',fileContext:response.data.file.extractedText})).statusCode,200);
  assert.match(JSON.stringify(requests[0].body),/PDF regression source/);
  assert.equal(requests[0].body.contents.some(c=>c.parts.some(p=>p.inlineData)),false);
});
test('text history starts with user and legacy duplicate turns are not repeated',async()=>{
  requests.length=0;
  await call('/api/chat',{message:'Explain a concept',history:[{sender:'bot',text:'Welcome'},{sender:'user',text:'Explain a concept'}]});
  assert.equal(requests[0].body.contents.length,1);
  assert.equal(requests[0].body.contents[0].role,'user');
});

test('earlier images do not intercept unrelated text or image generation requests',async()=>{
  const file=(await call('/api/files',await visionFile())).data.file;
  const history=[{sender:'user',text:'Explain this image',attachments:[file]},{sender:'bot',text:'A red square'}];
  requests.length=0;
  const local=await call('/api/chat',{message:'Hello',history});
  assert.equal(local.statusCode,200);
  assert.match(local.data.reply,/hello|namaste|hi/i);
  assert.equal(requests.length,0);
  const image=await call('/api/chat',{message:'Generate an image of a dog',history});
  assert.equal(image.statusCode,401); // generation's existing sign-in boundary
});

const {MAX_IMAGE_SIZE,IMAGE_CHUNK_SIZE,IMAGE_SIZE_ERROR} = await import('../src/utils/uploadLimits.js');
// A valid PNG with a large ancillary tEXt chunk gives exact byte boundaries,
// without adding invalid trailing bytes or depending on lossy compression size.
async function exactSizeImage(size) {
  const original=await sharp({create:{width:24,height:24,channels:3,background:'#e03020'}}).png().toBuffer();
  const chunk=Buffer.alloc(size-original.length);
  chunk.writeUInt32BE(chunk.length-12,0);chunk.write('tEXt',4);chunk.write('Comment\0',8);
  chunk.fill(65,16,chunk.length-4);
  let crc=0xffffffff;
  for (const byte of chunk.subarray(4,-4)) {
    crc^=byte;
    for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);
  return Buffer.concat([original.subarray(0,-12),chunk,original.subarray(-12)]);
}
async function chunkUpload(buffer, options={}) {
  const start=await call('/api/files?action=image-start',{fileName:'large.png',fileType:'image/png',fileSize:buffer.length},options);
  assert.equal(start.statusCode,200,JSON.stringify(start.data));
  const reference={id:start.data.id,imageToken:start.data.imageToken};
  let largest=0;
  for(let offset=0,index=0;offset<buffer.length;offset+=IMAGE_CHUNK_SIZE,index++) {
    const body={...reference,index,data:buffer.subarray(offset,offset+IMAGE_CHUNK_SIZE).toString('base64')};
    largest=Math.max(largest,Buffer.byteLength(JSON.stringify(body)));
    assert.equal((await call('/api/files?action=image-chunk',body,options)).statusCode,200);
  }
  const complete=await call('/api/files?action=image-complete',reference,options);
  assert.equal(complete.statusCode,200,JSON.stringify(complete.data));
  assert.ok(largest<1500000);
  assert.ok(Buffer.byteLength(JSON.stringify(complete.data))<1024);
  return {file:complete.data.file,reference};
}
for(const [label,size] of [['1 MB',1048576],['3 MB',3145728],['4.9 MB',Math.floor(4.9*1024*1024)],['exactly 5 MB',5242880]]) {
  test(`${label} is accepted and original bytes reach Gemini and Groq over bounded requests`,async()=>{
    const buffer=await exactSizeImage(size);
    const {file}=await chunkUpload(buffer);
    assert.equal(file.fileSize,size);
    assert.equal(file.imageData,undefined);
    requests.length=0;
    const answer=await call('/api/chat',{message:'Explain this image',attachments:[file]});
    assert.equal(answer.data.reply,'gemini response');
    const inline=requests[0].body.contents[0].parts.find(p=>p.inlineData).inlineData;
    assert.deepEqual(Buffer.from(inline.data,'base64'),buffer);
    requests.length=0;
    assert.equal((await call('/api/chat',{message:'gemini:503 explain this image',attachments:[file]})).data.reply,'groq response');
    assert.equal(requests[1].body.model,'qwen/qwen3.8-27b');
    const image=requests[1].body.messages.at(-1).content.find(p=>p.type==='image_url').image_url.url;
    assert.deepEqual(Buffer.from(image.split(',')[1],'base64'),buffer);
  });
}
for (const size of [MAX_IMAGE_SIZE+1,Math.ceil(5.1*1024*1024),6*1024*1024]) test(`${size} byte image is rejected before upload/provider calls`,async()=>{
  requests.length=0;
  const response=await call('/api/files?action=image-start',{fileName:'large.jpg',fileType:'image/jpeg',fileSize:size});
  assert.equal(response.statusCode,413);assert.equal(response.data.reply,IMAGE_SIZE_ERROR);assert.equal(requests.length,0);
});
test('multiple 5 MB originals have independent limits and guest follow-ups use small references',async()=>{
  const original=await exactSizeImage(MAX_IMAGE_SIZE);
  const a=await chunkUpload(original), b=await chunkUpload(original);
  const body={message:'Compare these images',attachments:[a.file,b.file]};
  assert.ok(JSON.stringify(body).length<1500);
  requests.length=0;
  assert.equal((await call('/api/chat',body)).data.reply,'gemini response');
  assert.equal(requests[0].body.contents[0].parts.filter(p=>p.inlineData).length,2);
  requests.length=0;
  assert.equal((await call('/api/chat',{message:'Read the text in the first image',history:[{sender:'user',text:body.message,attachments:[a.file,b.file]},{sender:'bot',text:'Two red squares'}]})).data.reply,'gemini response');
  assert.equal(requests[0].body.contents[0].parts.filter(p=>p.inlineData).length,2);
});
test('chunk transport rejects missing, oversized, conflicting, corrupt, expired and unauthorized data',async()=>{
  const source=await exactSizeImage(1048576);
  const response=await call('/api/files?action=image-start',{fileName:'test.png',fileType:'image/png',fileSize:source.length});
  const ref={id:response.data.id,imageToken:response.data.imageToken};
  assert.equal((await call('/api/files?action=image-complete',ref)).statusCode,400);
  assert.equal((await call('/api/files?action=image-chunk',{...ref,index:1,data:'AAAA'})).statusCode,400);
  assert.equal((await call('/api/files?action=image-chunk',{...ref,index:0,data:Buffer.alloc(IMAGE_CHUNK_SIZE+1).toString('base64')})).statusCode,400);
  assert.equal((await call('/api/files?action=image-chunk',{...ref,index:0,data:source.toString('base64')})).statusCode,200);
  assert.equal((await call('/api/files?action=image-chunk',{...ref,index:0,data:source.toString('base64')})).statusCode,200); // idempotent
  assert.equal((await call('/api/files?action=image-chunk',{...ref,index:0,data:Buffer.alloc(source.length).toString('base64')})).statusCode,400);
  assert.equal((await call('/api/files?action=image-complete',{...ref,imageToken:'a'.repeat(64)})).data.error.code,'IMAGE_CONTEXT_MISSING');
  assert.equal((await call('/api/files?action=image-complete',ref,{token:signToken({id:'user_b'})})).data.error.code,'IMAGE_CONTEXT_MISSING');
  await db.deleteImageUpload(ref.id,(await import('../lib/server/imageUploads.js')).imageTokenHash(ref.imageToken));
  assert.equal((await call('/api/chat',{message:'See image',attachments:[{...ref,fileName:'test.png',fileType:'image/png'}]})).data.error.code,'IMAGE_CONTEXT_MISSING');
  const corrupt=await call('/api/files?action=image-start',{fileName:'bad.png',fileType:'image/png',fileSize:10});
  const bad={id:corrupt.data.id,imageToken:corrupt.data.imageToken};
  await call('/api/files?action=image-chunk',{...bad,index:0,data:Buffer.alloc(10).toString('base64')});
  assert.equal((await call('/api/files?action=image-complete',bad)).data.error.code,'INVALID_FILE');
});
test('signed-in 5 MB image persists and reloads via bounded authenticated responses',async()=>{
  const token=signToken({id:'vision_user'});
  const original=await exactSizeImage(MAX_IMAGE_SIZE);
  const {file}=await chunkUpload(original,{token});
  const chunks=[];
  for(let index=0;index<5;index++) {
    const response=await call(`/api/files/${file.id}?chunk=${index}`,null,{method:'GET',token});
    assert.equal(response.statusCode,200);
    assert.ok(JSON.stringify(response.data).length<1500000);
    chunks.push(Buffer.from(response.data.data,'base64'));
  }
  assert.deepEqual(Buffer.concat(chunks),original);
  assert.equal((await call(`/api/files/${file.id}?chunk=0`,null,{method:'GET',token:signToken({id:'user_b'})})).statusCode,404);
  assert.equal((await call(`/api/files/${file.id}?chunk=5`,null,{method:'GET',token})).statusCode,400);
  const conv=(await call('/api/conversations',{title:'Large image'},{token})).data.conversation;
  assert.equal((await call('/api/chat',{message:'Explain image',attachmentIds:[file.id],conversationId:conv.id},{token})).statusCode,200);
  requests.length=0;
  assert.equal((await call('/api/chat',{message:'What color is it?',conversationId:conv.id},{token})).statusCode,200);
  assert.deepEqual(Buffer.from(requests[0].body.contents[0].parts.find(p=>p.inlineData).inlineData.data,'base64'),original);
});

test('browser API service chunks exact 5 MB files and never serializes large image bytes into chat',async()=>{
  const {AIService}=await import('../src/services/aiService.js');
  const oldReader=globalThis.FileReader, oldStorage=globalThis.localStorage, oldFetch=globalThis.fetch;
  const sizes=[];
  globalThis.localStorage={getItem(){return null;}};
  globalThis.FileReader=class {
    readAsDataURL(blob) {blob.arrayBuffer().then(bytes=>{this.result=`data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(bytes).toString('base64')}`;this.onload();}).catch(error=>this.onerror(error));}
  };
  globalThis.fetch=async(url,options)=>{
    if (!url.startsWith('/api/')) return oldFetch(url,options);
    sizes.push(Buffer.byteLength(options.body || ''));
    const response=await call(url,JSON.parse(options.body),{method:options.method});
    return new Response(JSON.stringify(response.data),{status:response.statusCode,headers:{'Content-Type':'application/json'}});
  };
  try {
    const bytes=await exactSizeImage(MAX_IMAGE_SIZE);
    const uploaded=await AIService.uploadFile({file:new File([bytes],'large.png',{type:'image/png'}),fileName:'large.png',fileType:'image/png'});
    assert.ok(uploaded.imageData);assert.ok(uploaded.imageToken);
    const {imageData,...attachment}=uploaded;
    assert.equal(Buffer.from(imageData.split(',')[1],'base64').length,MAX_IMAGE_SIZE);
    const result=await AIService.sendMessage({message:'Analyze this image',attachments:[attachment],history:[]});
    assert.equal(result.status,200);
    assert.ok(sizes.every(size=>size<1500000));
    const calls=sizes.length;
    for(const size of [MAX_IMAGE_SIZE+1,Math.ceil(5.1*1024*1024),6*1024*1024]) {
      await assert.rejects(AIService.uploadFile({file:new File([Buffer.alloc(size)],'large.png',{type:'image/png'}),fileName:'large.png',fileType:'image/png'}),{message:IMAGE_SIZE_ERROR});
    }
    assert.equal(sizes.length,calls);
  } finally {globalThis.FileReader=oldReader;globalThis.localStorage=oldStorage;globalThis.fetch=oldFetch;}
});
test('three maximum-size images reach Gemini; Groq oversized provider requests fail safely',async()=>{
  const bytes=await exactSizeImage(MAX_IMAGE_SIZE);
  const files=[];
  for(let i=0;i<3;i++) files.push((await chunkUpload(bytes)).file);
  requests.length=0;
  const response=await call('/api/chat',{message:'Compare all three',attachments:files});
  assert.equal(response.statusCode,200);
  assert.equal(requests[0].body.contents[0].parts.filter(p=>p.inlineData).length,3);
  requests.length=0;
  const failed=await call('/api/chat',{message:'gemini:503 compare all three',attachments:files});
  assert.equal(failed.data.error.code,'VISION_UNAVAILABLE');
  assert.equal(requests.length,1); // Groq's known encoded payload ceiling, no pointless oversized call.
});

test('guest image capabilities expire and cannot be reused after the retention window',async()=>{
  const {file}=await chunkUpload(await exactSizeImage(1048576));
  const originalNow=Date.now;
  Date.now=()=>originalNow()+86400001;
  try {
    const expired=await call('/api/chat',{message:'Read image',attachments:[file]});
    assert.equal(expired.data.error.code,'IMAGE_CONTEXT_MISSING');
  } finally {Date.now=originalNow;}
});

test('retained large Blob completion can return a usable guest reference instead of an oversized response',async()=>{
  const {stageValidatedGuestImage}=await import('../lib/server/imageUploads.js');
  const original=await exactSizeImage(MAX_IMAGE_SIZE);
  const reference=await stageValidatedGuestImage(db,original,'blob.png','image/png');
  requests.length=0;
  const result=await call('/api/chat',{message:'Read this image',attachments:[{id:reference.id,imageToken:reference.imageToken,fileName:'blob.png',fileType:'image/png'}]});
  assert.equal(result.data.reply,'gemini response');
  assert.deepEqual(Buffer.from(requests[0].body.contents[0].parts.find(p=>p.inlineData).inlineData.data,'base64'),original);
});
