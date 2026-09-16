const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const backend=path.resolve(__dirname,'../../.tmp/audit-round2-9678e6cd/backend');const url=new URL(process.env.DATABASE_URL);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55439');assert.equal(url.pathname,'/travstats_block12_probe_audit');assert.equal(process.env.NODE_ENV,'test');
require(path.join(backend,'node_modules/tsx/dist/cjs/index.cjs'));const dep=n=>require(path.join(backend,'node_modules',n));const {prisma}=require(path.join(backend,'src/db.ts'));const {generateToken}=require(path.join(backend,'src/utils/jwt.ts'));
const {createPendingUpdate,calculateChanges,convertApiDataToProposed}=require(path.join(backend,'src/services/flightAutoUpdate.ts'));
const express=dep('express'),request=dep('supertest'),app=express();app.use(express.json());app.use(dep('cookie-parser')());app.use('/pending',require(path.join(backend,'src/routes/pendingUpdates.ts')).default);app.use('/flights',require(path.join(backend,'src/routes/flights.ts')).default);app.use(require(path.join(backend,'src/middleware/errorHandler.ts')).errorHandler);
const report={commit:'9678e6cd',results:[]};let fetches=0;global.fetch=async()=>{fetches++;throw Error('External fetch blocked');};
async function main(){
 const u=await prisma.user.create({data:{username:'block17-pending-'+Date.now(),passwordHash:'synthetic-unused'}}),cookie=`auth_token=${generateToken(u.id)}`;
 const base={userId:u.id,depIata:'BKK',depIcao:'VTBS',arrIata:'SIN',arrIcao:'WSSS',depLat:13.69,depLon:100.7501,arrLat:1.3644,arrLon:103.9915,status:'flown',departureTime:new Date('2025-06-01T10:00:00Z'),arrivalTime:new Date('2025-06-01T12:00:00Z'),depTimeSemantics:'UTC',arrTimeSemantics:'UTC',gate:'A1',aircraft:'A320'};
 const make=async()=>{const f=await prisma.flight.create({data:base});const original=convertApiDataToProposed({},f),proposed={...original,aircraft:'A321',terminal:'2'};const id=await createPendingUpdate(f,proposed,calculateChanges(original,proposed),'aviationstack');assert.ok(id);return {f,id};};
 const stale=await make();const manual=await request(app).put('/flights/'+stale.f.id).set('Cookie',cookie).send({gate:'B9'});assert.equal(manual.status,200);
 const applied=await request(app).post('/pending/'+stale.id+'/apply').set('Cookie',cookie).send({});assert.equal(applied.status,200);
 report.results.push({name:'stale snapshot',manualPutStatus:manual.status,gateBeforeApply:'B9',gateAfterApply:applied.body.flight.gate,aircraftAfterApply:applied.body.flight.aircraft});assert.equal(applied.body.flight.gate,'A1');
 const invalid=await make();const edit=await request(app).put('/pending/'+invalid.id).set('Cookie',cookie).send({editedData:{departureTime:'2025-06-02T10:00:00Z',arrivalTime:'2025-06-01T12:00:00Z'}});assert.equal(edit.status,200);
 const bad=await request(app).post('/pending/'+invalid.id+'/apply').set('Cookie',cookie).send({});assert.equal(bad.status,200);assert.ok(new Date(bad.body.flight.arrivalTime)<new Date(bad.body.flight.departureTime));
 report.results.push({name:'edited reversed chronology',editStatus:edit.status,applyStatus:bad.status,departure:bad.body.flight.departureTime,arrival:bad.body.flight.arrivalTime});
 const twice=await make();const edit1=await request(app).put('/pending/'+twice.id).set('Cookie',cookie).send({editedData:{gate:'C3'}});const edit2=await request(app).put('/pending/'+twice.id).set('Cookie',cookie).send({editedData:{gate:'D4'}});
 report.results.push({name:'repeat edit',firstStatus:edit1.status,secondStatus:edit2.status,persistedStatus:(await prisma.pendingFlightUpdate.findUnique({where:{id:twice.id}})).status});assert.equal(edit1.status,200);assert.equal(edit2.status,500);
 const foreign=await prisma.user.create({data:{username:'block17-pending-foreign-'+Date.now(),passwordHash:'synthetic-unused'}});const stranger=await request(app).post('/pending/'+twice.id+'/apply').set('Cookie',`auth_token=${generateToken(foreign.id)}`).send({});assert.equal(stranger.status,404);report.foreignApplyStatus=stranger.status;report.externalFetchAttempts=fetches;
}
main().catch(e=>{report.error=e.message;process.exitCode=1;}).finally(async()=>{await prisma.$disconnect();fs.writeFileSync(path.join(__dirname,'block17-pending-probes.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));});
