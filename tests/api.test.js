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
process.env.GEMINI_TEST_URL='http://providers.test';
process.env.GROQ_TEST_URL='http://providers.test';
delete process.env.DATABASE_URL;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bodhi-api-'));
process.env.LOCAL_DATA_DIR=dir;
const {default:gateway}=await import('../api/index.js');
const {db}=await import('../server/endpoints/lib/db.js');
const {signToken}=await import('../server/endpoints/lib/auth.js');
const {createUploadTicket,verifyUploadTicket}=await import('../lib/server/uploads.js');
const originalFetch=globalThis.fetch;
const requests=[];
globalThis.fetch=providerFetch(requests);
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
