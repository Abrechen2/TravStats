// Real local HTTP receiver; fabricated credentials only. Never print headers or keys.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const backend=path.resolve(__dirname,'../../.tmp/audit-round2-9678e6cd/backend');const url=new URL(process.env.DATABASE_URL);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55439');assert.equal(url.pathname,'/travstats_block12_probe_audit');assert.equal(process.env.NODE_ENV,'test');
require(path.join(backend,'node_modules/tsx/dist/cjs/index.cjs'));const dep=n=>require(path.join(backend,'node_modules',n));
const {prisma}=require(path.join(backend,'src/db.ts'));const {generateToken}=require(path.join(backend,'src/utils/jwt.ts'));const {encryptApiKey}=require(path.join(backend,'src/utils/encryption.ts'));
const express=dep('express'),request=dep('supertest');const app=express();app.use(express.json());app.use(dep('cookie-parser')());app.use('/api/v1/settings',require(path.join(backend,'src/routes/settings/index.ts')).default);app.use(require(path.join(backend,'src/middleware/errorHandler.ts')).errorHandler);
const report={commit:'9678e6cd',results:[]};const keys={immich:crypto.randomBytes(24).toString('hex'),dawarich:crypto.randomBytes(24).toString('hex')};const received=[];
const sink=http.createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname;received.push({path:p,immichMatches:req.headers['x-api-key']===keys.immich,dawarichMatches:req.headers.authorization===`Bearer ${keys.dawarich}`,hasAuth:!!(req.headers['x-api-key']||req.headers.authorization)});res.setHeader('Content-Type','application/json');if(p==='/api/server/version')res.end(JSON.stringify({major:3,minor:0,patch:1}));else if(p==='/api/users/me')res.end(JSON.stringify({id:'synthetic',name:'Synthetic identity'}));else if(p==='/api/v1/health')res.end(JSON.stringify({status:'ok'}));else if(p==='/api/v1/points')res.end('[]');else{res.statusCode=404;res.end('{}');}});
async function main(){await new Promise(resolve=>sink.listen(0,'127.0.0.1',resolve));const receiver=`http://127.0.0.1:${sink.address().port}`;
 const admin=await prisma.adminSettings.findFirst({orderBy:{id:'asc'}});const data={globalImmichBaseUrl:'http://127.0.0.1:1',globalImmichApiKey:encryptApiKey(keys.immich),globalDawarichBaseUrl:'http://127.0.0.1:1',globalDawarichApiKey:encryptApiKey(keys.dawarich)};if(admin)await prisma.adminSettings.update({where:{id:admin.id},data});else await prisma.adminSettings.create({data});
 const u=await prisma.user.create({data:{username:'block16-user-'+Date.now(),passwordHash:'synthetic-unused',isAdmin:false}}),cookie=`auth_token=${generateToken(u.id)}`;
 for(const service of ['immich','dawarich']){
  const before=received.length,unauth=await request(app).post(`/api/v1/settings/${service}/test`).send({baseUrl:receiver});assert.equal(unauth.status,401);assert.equal(received.length,before);
  const response=await request(app).post(`/api/v1/settings/${service}/test`).set('Cookie',cookie).send({baseUrl:receiver});assert.equal(response.status,200);assert.equal(response.body.success,true);
  report.results.push({service,isAdmin:u.isAdmin,suppliedFields:['baseUrl'],unauthenticatedStatus:unauth.status,authenticatedStatus:response.status,testSuccess:response.body.success,received:received.slice(before)});
 }
}
main().catch(e=>{report.error=e.message;process.exitCode=1;}).finally(async()=>{await prisma.$disconnect();await new Promise(resolve=>sink.close(resolve));fs.writeFileSync(path.join(__dirname,'block16-connection-probes.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));});
