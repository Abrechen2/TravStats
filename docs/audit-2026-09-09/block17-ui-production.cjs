// Serve the successfully built, unmodified production frontend on loopback.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../../.tmp/audit-round2-9678e6cd/frontend/dist');
const types={'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp','.ico':'image/x-icon'};
const server=http.createServer((req,res)=>{
 if(req.url==='/__audit/close'&&req.method==='POST'){res.end('closing');setTimeout(()=>server.close(()=>console.log('AUDIT_PRODUCTION_UI_CLOSED')),100);return;}
 if(req.url.startsWith('/api/')){const upstream=http.request({hostname:'127.0.0.1',port:18017,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:18017',origin:'http://127.0.0.1:13017'}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>{res.statusCode=502;res.end();});req.pipe(upstream);return;}
 try{let file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname));if(!file.startsWith(root+path.sep)){file=path.join(root,'index.html');}if(!fs.existsSync(file)||!fs.statSync(file).isFile())file=path.join(root,'index.html');res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');fs.createReadStream(file).pipe(res);}catch{res.statusCode=400;res.end();}
});server.listen(13019,'127.0.0.1',()=>console.log('AUDIT_PRODUCTION_UI_READY 13019'));server.on('error',e=>{console.error(e.message);process.exitCode=1;});
