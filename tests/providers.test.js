import test from 'node:test';
import assert from 'node:assert/strict';
import { providerFetch } from './helpers/providerFetch.js';
import { routeAI, completeAI } from '../lib/server/ai/aiRouter.js';
import { validateChat, parseBody } from '../lib/server/validation.js';
import { readChatResponse, friendlyChatError } from '../src/services/chatResponse.js';

process.env.NODE_ENV='test';
process.env.GEMINI_API_KEY='dummy-gemini';
process.env.GROQ_API_KEY='dummy-groq';
const requests=[];
const originalFetch=globalThis.fetch;
if (!process.env.SIM_URL) globalThis.fetch=providerFetch(requests);
const base=process.env.SIM_URL || 'http://provider.test';
process.env.GEMINI_TEST_URL=base+(process.env.SIM_URL?'/gemini':'');
process.env.GROQ_TEST_URL=base+(process.env.SIM_URL?'/groq':'');
test.after(()=>{globalThis.fetch=originalFetch;});
function options(text='Explain a concept') {return {system:'Bodhisakha multilingual personality',messages:[{role:'user',content:'prior question'},{role:'assistant',content:'prior answer'},{role:'user',content:text}],timeoutMs:text.includes(':timeout')?80:1000};}

test('Gemini success preserves primary routing and context',async()=>{
  requests.length=0;
  assert.equal(await completeAI(options()),'gemini response');
  if(!process.env.SIM_URL){assert.equal(requests.length,1);assert.equal(requests[0].body.contents[1].role,'model');assert.equal(requests[0].body.contents[0].parts[0].text,'prior question');}
});
for(const failure of ['timeout','429','401','400','404','503','network','html','empty','malformed']) {
  test(`Gemini ${failure} automatically falls back to Groq once`,async()=>{
    requests.length=0;
    assert.equal(await completeAI(options(`gemini:${failure}`)),'groq response');
    if(!process.env.SIM_URL) {assert.equal(requests.length,2);assert.equal(requests[1].body.model,'openai/gpt-oss-120b');}
  });
}
test('missing Gemini skips directly to Groq',async()=>{delete process.env.GEMINI_API_KEY;try{assert.equal(await completeAI(options()),'groq response');}finally{process.env.GEMINI_API_KEY='dummy-gemini';}});
test('missing Groq permits Gemini success',async()=>{delete process.env.GROQ_API_KEY;try{assert.equal(await completeAI(options()),'gemini response');}finally{process.env.GROQ_API_KEY='dummy-groq';}});
test('both keys missing gives configuration error',async()=>{delete process.env.GEMINI_API_KEY;delete process.env.GROQ_API_KEY;try{await assert.rejects(completeAI(options()),{code:'CONFIGURATION'});}finally{process.env.GEMINI_API_KEY='dummy-gemini';process.env.GROQ_API_KEY='dummy-groq';}});
for(const [scenario,code] of [['gemini:503 groq:503','BOTH_UNAVAILABLE'],['gemini:429 groq:429','RATE_LIMIT'],['gemini:timeout groq:timeout','TIMEOUT'],['gemini:401 groq:401','CONFIGURATION'],['gemini:503 groq:malformed','BOTH_UNAVAILABLE']]) {
  test(`both fail: ${scenario}`,async()=>{await assert.rejects(completeAI(options(scenario)),{code});});
}
test('streaming fallback before output works',async()=>{let text='';for await(const c of routeAI({...options('gemini:503'),stream:true}))text+=c.text;assert.equal(text,'groq response');});
test('partial output never switches provider',async()=>{
  requests.length=0;let text='';
  await assert.rejects(async()=>{for await(const c of routeAI({...options('gemini:partial'),stream:true}))text+=c.text;});
  assert.equal(text,'gemini response');
  if(!process.env.SIM_URL)assert.equal(requests.length,1);
});
test('invalid requests and body limits reject',()=>{
  for(const body of [{message:''},{message:23},{message:'x',history:'bad'},{message:'x',reasoningMode:'true'},{message:'x',fileContext:'x'.repeat(100001)}])assert.throws(()=>validateChat(body));
  assert.throws(()=>parseBody('{broken'));
  assert.throws(()=>parseBody({message:'x'.repeat(500)},100));
});
test('frontend refuses raw provider errors',async()=>{
  await assert.rejects(readChatResponse(new Response(JSON.stringify({error:{message:'RAW_PROVIDER_SECRET'}}),{status:500}),()=>{}),error=>!error.message.includes('SECRET'));
  assert.match(friendlyChatError(new TypeError('fetch failed')).message,/internet connection/);
});
test('frontend detects truncated SSE and retains partial response',async()=>{
  let text='';
  await assert.rejects(readChatResponse(new Response('event: delta\ndata: {"text":"Partial"}\n\n',{headers:{'Content-Type':'text/event-stream'}}),value=>{text=value;}));
  assert.equal(text,'Partial');
});

test('invalid upstream request does not spend a fallback attempt',async()=>{
  requests.length=0;
  await assert.rejects(completeAI(options('gemini:422')),{code:'INVALID_REQUEST',status:400});
  if(!process.env.SIM_URL) assert.equal(requests.length,1);
});
test('frontend handles missing API route and HTML routing failures',async()=>{
  for(const status of [404,502,200]) await assert.rejects(readChatResponse(new Response('<html>routing failure</html>',{status}),()=>{}),{code:'NETWORK'});
});
