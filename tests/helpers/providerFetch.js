import handler from '../../postman/mocks/providers/default.cjs';
// Sandbox fallback: exercises serialized HTTP request/response contracts and abort
// handling without opening sockets. Use SIM_URL for real Postman HTTP verification.
export function providerFetch(requests) {
  return (url,options) => new Promise((resolve,reject)=>{
    const body = JSON.parse(options.body);
    const pathname = new URL(url).pathname + new URL(url).search;
    requests.push({url:pathname,body});
    let streamController;
    let settled=false;
    let ended=false;
    let status=200;
    let headers={};
    const encoder=new TextEncoder();
    const stream=new ReadableStream({start(c){streamController=c;}});
    const remove=()=>options.signal?.removeEventListener('abort',abort);
    const abort=()=>{if(!ended){ended=true;streamController.error(new DOMException('Aborted','AbortError'));}if(!settled){settled=true;reject(new DOMException('Aborted','AbortError'));}remove();};
    const start=()=>{if(!settled){settled=true;resolve(new Response(stream,{status,headers}));}};
    const res={
      writeHead(s,h={}){status=s;headers=h;start();},
      write(text){start();if(!ended)streamController.enqueue(encoder.encode(text));},
      end(text){if(text)this.write(text);start();if(!ended){ended=true;streamController.close();}remove();},
      destroy(){start();if(!ended){ended=true;streamController.error(new TypeError('Connection terminated'));}remove();},
    };
    options.signal?.addEventListener('abort',abort,{once:true});
    if(options.signal?.aborted){abort();return;}
    handler({url:pathname,body,socket:{destroy(){if(!settled){settled=true;reject(new TypeError('fetch failed'));}else res.destroy();remove();}}},res).catch(reject);
  });
}
