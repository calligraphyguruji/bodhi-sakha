import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
// No API credentials and no database. Intercept all traffic with deterministic fixtures.
const browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let calls=0; const sent=[];
  await page.route('https://bodhi.test/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/chat') {
      calls++;sent.push(route.request().postDataJSON());
      if(calls===1) await new Promise(resolve=>setTimeout(resolve,150));
      if(calls===1) return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'UNAVAILABLE',message:'RAW_SECRET',retryable:true}})});
      return route.fulfill({status:200,contentType:'text/event-stream',body:'event: delta\ndata: {"text":"A clear answer."}\n\nevent: done\ndata: {}\n\n'});
    }
    if(url.pathname.startsWith('/api/'))return route.fulfill({status:401,contentType:'application/json',body:'{}'});
    const localPath=path.join(process.cwd(),'dist',url.pathname==='/'?'index.html':url.pathname);
    try {const body=await fs.readFile(localPath);const ext=path.extname(localPath);return route.fulfill({body,contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2'})[ext]||'application/octet-stream'});} catch {return route.fulfill({status:404,body:''});}
  });
  await page.route('https://**/*',route=>route.request().url().startsWith('https://bodhi.test/')?route.fallback():route.abort());
  await page.goto('https://bodhi.test/');
  const input=page.getByRole('textbox',{name:'Ask AI Assistant'});
  await input.fill('Explain this test topic');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Send message',exact:true}).isDisabled(),true);
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByText('Explain this test topic',{exact:true}).count(),1);
  assert.equal(await page.getByText('RAW_SECRET').count(),0);
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.getByText('A clear answer.',{exact:true}).waitFor();
  assert.equal(await page.getByText('Explain this test topic',{exact:true}).count(),1);
  assert.equal(await page.getByRole('alert').count(),0);
  assert.equal(sent[0].requestId,sent[1].requestId);
  await input.fill('A follow-up question');await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.user-row').length===2 && !document.querySelector('button[aria-label="Send message"]').disabled);
  assert.equal(sent.at(-1).history.filter(h=>h.text==='A clear answer.').length,1);
  assert.equal(sent.at(-1).history.some(h=>h.text.includes('trouble connecting')),false);
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: send, response, friendly error, retry, stable request ID, no duplicate user turn, context preservation, no uncaught exceptions.');
} finally {await browser.close();}
