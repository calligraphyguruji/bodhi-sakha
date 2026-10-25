import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {MAX_IMAGE_SIZE,IMAGE_SIZE_ERROR} from '../src/utils/uploadLimits.js';
// No API credentials and no database. Intercept all traffic with deterministic fixtures.
const browser = await chromium.launch({headless:true,...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let calls=0; const sent=[]; const uploads=new Map(); const uploadSizes=[];
  await page.route('https://bodhi.test/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/files') {
      const data=route.request().postDataJSON();
      if(url.searchParams.get('action')==='image-start') {
        const id=`file_${crypto.randomUUID()}`,imageToken='a'.repeat(64);
        uploads.set(id,{...data,parts:[]});
        return route.fulfill({json:{id,imageToken}});
      }
      if(url.searchParams.get('action')==='image-chunk') {
        uploadSizes.push(route.request().postData().length);
        uploads.get(data.id).parts[data.index]=data.data;
        return route.fulfill({json:{success:true}});
      }
      if(url.searchParams.get('action')==='image-complete') {
        const file=uploads.get(data.id);
        return route.fulfill({json:{file:{id:data.id,imageToken:data.imageToken,fileName:file.fileName,fileType:file.fileType,fileSize:file.fileSize,extractedText:''}}});
      }
      if(url.searchParams.get('action')==='image-discard') return route.fulfill({json:{success:true}});
    }
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
  await page.waitForFunction(()=>document.querySelectorAll('.user-row').length===2 && !document.querySelector('.typing-row') && [...document.querySelectorAll('.bot-bubble')].filter(el=>el.textContent==='A clear answer.').length===2);
  assert.equal(sent.at(-1).history.filter(h=>h.text==='A clear answer.').length,1);
  assert.equal(sent.at(-1).history.some(h=>h.text.includes('trouble connecting')),false);
  const bytes = await sharp({create:{width:32,height:32,channels:3,background:'#ff9922'}}).png().toBuffer();
  await page.setViewportSize({width:390,height:844});
  const fileInput = page.locator('input[type=file]');
  await fileInput.setInputFiles({name:'diagram.png',mimeType:'image/png',buffer:bytes});
  await page.locator('.attachment-thumbnail').waitFor();
  await page.getByRole('button',{name:'Remove diagram.png'}).click();
  await page.waitForFunction(()=>!document.querySelector('.attachment-thumbnail'));
  assert.equal(await page.locator('.attachment-thumbnail').count(),0);
  await fileInput.setInputFiles([{name:'code.png',mimeType:'image/png',buffer:bytes},{name:'chart.png',mimeType:'image/png',buffer:bytes}]);
  await page.waitForFunction(()=>document.querySelectorAll('.attachment-thumbnail').length===2);
  await input.fill('Explain these images');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.typing-row') && [...document.querySelectorAll('.bot-bubble')].filter(el=>el.textContent==='A clear answer.').length===3);
  assert.equal(await page.locator('.message-attachment-image').count(),2);
  assert.equal(sent.at(-1).attachments.length,2);
  assert.ok(sent.at(-1).attachments.every(a=>a.imageToken && !a.imageData));
  await input.fill('What is its time complexity?');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.typing-row') && [...document.querySelectorAll('.bot-bubble')].filter(el=>el.textContent==='A clear answer.').length===4);
  assert.equal(sent.at(-1).history.find(h=>h.text==='Explain these images').attachments.length,2);
  await page.locator('.composer-wrapper').evaluate((el, encoded)=>{
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],'dropped.png',{type:'image/png'}));
    el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
  },bytes.toString('base64'));
  await page.locator('.attachment-thumbnail').waitFor();
  await page.getByRole('button',{name:'Remove dropped.png'}).click();
  await fileInput.setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(),/Unsupported file/);
  await fileInput.setInputFiles({name:'big.png',mimeType:'image/png',buffer:Buffer.alloc(MAX_IMAGE_SIZE+1)});
  await page.getByText(IMAGE_SIZE_ERROR,{exact:false}).waitFor();
  assert.ok(await page.locator('.composer-wrapper').evaluate(el=>el.getBoundingClientRect().right<=window.innerWidth));
  assert.ok(uploadSizes.every(size=>size<1500000));
  assert.equal(await page.getByText(/Up to 5 MB per image/).count(),1);
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: send, response, friendly error, retry, stable request ID, no duplicate user turn, context preservation, mobile multi-image upload, preview, remove, drag/drop, sent images, follow-up bytes, unsupported/size errors, no uncaught exceptions.');
} finally {await browser.close();}
