// Provider fixtures follow the official Gemini generateContent and Groq chat contracts.
// Only dummy credentials and synthetic conversation text are used in tests.
const http = require('node:http');
async function handler(req,res) {
  let body=req.body;
  if (!body) { const chunks=[]; for await (const c of req) chunks.push(c); try {body=JSON.parse(Buffer.concat(chunks).toString());}catch{body={};} }
  if (req.url === '/health') {res.end('ok');return;}
  if (!req.url.includes('/models/') && !req.url.endsWith('/chat/completions')) {res.writeHead(501);res.end();return;}
  const provider=req.url.includes('/models/')?'gemini':'groq';
  const text=JSON.stringify(body);
  const match=text.match(new RegExp(provider+':(429|401|400|503|timeout|malformed|empty|partial|network|html)'));
  const mode=match?.[1];
  if (/^\d+$/.test(mode||'')) {res.writeHead(Number(mode),{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'RAW_PROVIDER_SECRET_DO_NOT_DISPLAY',status:mode}}));return;}
  if (mode==='network') {req.socket.destroy();return;}
  if (mode==='html') {res.writeHead(502,{'Content-Type':'text/html'});res.end('<html>Upstream gateway secret</html>');return;}
  if (mode==='timeout') await new Promise(r=>setTimeout(r,180));
  const responseText=mode==='empty'?'':`${provider} response`;
  const response=provider==='gemini'?{candidates:[{content:{parts:[{text:responseText}]},finishReason:'STOP'}]}:{choices:[{message:{content:responseText},finish_reason:'stop'}]};
  if (req.url.includes('streamGenerateContent')||body.stream) {
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    if (mode==='malformed') {res.end('data: {invalid\n\n');return;}
    const chunk=provider==='gemini'?{candidates:[{content:{parts:[{text:responseText}]}}]}:{choices:[{delta:{content:responseText}}]};
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    if (mode==='partial') {setTimeout(()=>res.destroy(),40);return;}
    const done=provider==='gemini'?{candidates:[{finishReason:'STOP'}]}:{choices:[{delta:{},finish_reason:'stop'}]};
    res.end(`data: ${JSON.stringify(done)}\n\n`);
  } else {
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(mode==='malformed'?'not-json':JSON.stringify(response));
  }
}
module.exports=handler;
if (require.main === module) http.createServer((req,res)=>handler(req,res).catch(()=>{res.statusCode=500;res.end();})).listen(Number(process.env.PORT||4901),'127.0.0.1');
