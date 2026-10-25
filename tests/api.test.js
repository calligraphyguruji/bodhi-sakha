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
  const oversized=await call('/api/files',{fileName:'large.png',fileType:'image/png',fileData:Buffer.alloc(2100000).toString('base64')});
  assert.equal(oversized.statusCode,413);
  assert.match(oversized.data.reply,/Images must be no larger/);
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
