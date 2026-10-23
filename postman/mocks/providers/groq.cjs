// Local simulation entry point; shares the documented response fixtures.
const http = require('node:http');
const handler = require('./default.cjs');
http.createServer((req,res)=>handler(req,res).catch(()=>{res.statusCode=500;res.end();})).listen(Number(process.env.PORT),'127.0.0.1');
