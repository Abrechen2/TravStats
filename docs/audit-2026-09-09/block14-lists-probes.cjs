/* Actual list APIs; own synthetic catalog and users; address enrichment stubbed. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const backend=path.resolve(__dirname,'../../.tmp/audit-round2-9678e6cd/backend');
const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55439');assert.equal(url.pathname,'/travstats_block12_probe_audit');assert.equal(process.env.NODE_ENV,'test');
require(path.join(backend,'node_modules/tsx/dist/cjs/index.cjs'));
const oldLoad=Module._load;let addressCalls=0;
Module._load=function(name,parent,isMain){if(name.endsWith('/places/addressBackfill'))return {completePlaceAddress:async()=>{addressCalls++;}};return oldLoad.apply(this,arguments);};
const fromBackend=name=>require(path.join(backend,'node_modules',name));
const {prisma}=require(path.join(backend,'src/db.ts'));const {generateToken}=require(path.join(backend,'src/utils/jwt.ts'));
const express=fromBackend('express'),request=fromBackend('supertest');
const lists=require(path.join(backend,'src/routes/placeLists.ts')).default,curated=require(path.join(backend,'src/routes/placeLists/curated.ts')).default,places=require(path.join(backend,'src/routes/places.ts')).default;
const {errorHandler}=require(path.join(backend,'src/middleware/errorHandler.ts'));
const report={commit:'9678e6cd',results:[]};let fetchAttempts=0;const oldFetch=global.fetch;global.fetch=async()=>{fetchAttempts++;throw new Error('External fetch prohibited');};
async function main(){
 const user=await prisma.user.create({data:{username:'block14-lists-'+Date.now(),passwordHash:'synthetic-unused'}}),other=await prisma.user.create({data:{username:'block14-other-'+Date.now(),passwordHash:'synthetic-unused'}});
 const cookie=`auth_token=${generateToken(user.id)}`,otherCookie=`auth_token=${generateToken(other.id)}`;
 const app=express();app.use(express.json());app.use(fromBackend('cookie-parser')());app.use('/api/v1/place-lists/curated',curated);app.use('/api/v1/place-lists',lists);app.use('/api/v1/places',places);app.use(errorHandler);
 const base='/api/v1/place-lists',key='audit-list-'+Date.now(),itemId=key+':synthetic';
 await prisma.curatedList.create({data:{key,name:'Synthetic audit list',items:{create:{id:itemId,name:'Synthetic audit landmark',lat:52,lon:13,isoCountryCode:'DE',country:'Deutschland'}}}});
 const tick=await request(app).post(`${base}/curated/items/${itemId}/tick`).set('Cookie',cookie).send({visitedAt:'2020-01-02T00:00:00Z'});assert.equal(tick.status,201);
 const placeId=tick.body.data.id;
 const initial=(await request(app).get(base).set('Cookie',cookie)).body.data.find(l=>l.curatedKey===key);assert.equal(initial.placeCount,1);assert.equal(initial.visitedCount,1);
 const removed=await request(app).delete(`${base}/curated/${key}/subscribe`).set('Cookie',cookie);assert.equal(removed.status,200);
 assert.ok(await prisma.place.findUnique({where:{id:placeId}}));assert.equal(await prisma.placeVisit.count({where:{placeId}}),1);
 const subscribed=await request(app).post(`${base}/curated/${key}/subscribe`).set('Cookie',cookie).send({});assert.equal(subscribed.status,201);
 const restored=(await request(app).get(base).set('Cookie',cookie)).body.data.find(l=>l.curatedKey===key);
 const progress=await request(app).get(`${base}/curated/${key}/progress`).set('Cookie',cookie);assert.equal(progress.status,200);
 const detail=await request(app).get(`${base}/${restored.id}`).set('Cookie',cookie);assert.equal(detail.status,200);
 report.results.push({name:'unsubscribe and resubscribe',initial:{placeCount:initial.placeCount,visitedCount:initial.visitedCount},after:{placeCount:restored.placeCount,visitedCount:restored.visitedCount,curatedItemCount:restored.curatedItemCount,progressTicked:progress.body.data.tickedCount,listEntryCount:detail.body.data.entries.length},placeRetained:true,visitsRetained:1});
 const retick=await request(app).post(`${base}/curated/items/${itemId}/tick`).set('Cookie',cookie).send({});assert.equal(retick.status,201);
 const afterRetick=(await request(app).get(base).set('Cookie',cookie)).body.data.find(l=>l.id===restored.id);assert.equal(afterRetick.visitedCount,1);
 report.results.push({name:'explicit retick repairs membership',visitedCount:afterRetick.visitedCount});
 const refusals=[];
 for(const [method,target,payload] of [['get',`${base}/${restored.id}`],['patch',`${base}/${restored.id}`,{color:'#123456'}],['delete',`${base}/${restored.id}`]]){let req=request(app)[method](target).set('Cookie',otherCookie);if(payload)req=req.send(payload);const res=await req;assert.equal(res.status,404);refusals.push({method,status:res.status});}
 const ownList=await request(app).post(base).set('Cookie',otherCookie).send({name:'Other list'});assert.equal(ownList.status,201);
 const foreign=await request(app).post(`${base}/${ownList.body.data.id}/entries`).set('Cookie',otherCookie).send({placeId});assert.equal(foreign.status,404);
 report.results.push({name:'list ownership controls',refusals,foreignPlaceAdd:foreign.status});
 report.addressEnrichmentStubs=addressCalls;report.externalFetchAttempts=fetchAttempts;
}
main().catch(error=>{report.error=error.message;process.exitCode=1;}).finally(async()=>{Module._load=oldLoad;global.fetch=oldFetch;await prisma.$disconnect();fs.writeFileSync(path.join(__dirname,'block14-lists-probes.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));});
