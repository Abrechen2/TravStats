const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const backend=path.resolve(__dirname,'../../.tmp/audit-round2-9678e6cd/backend');
const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55439');assert.equal(url.pathname,'/travstats_block12_probe_audit');assert.equal(process.env.NODE_ENV,'test');
require(path.join(backend,'node_modules/tsx/dist/cjs/index.cjs'));const fromBackend=name=>require(path.join(backend,'node_modules',name));const {prisma}=require(path.join(backend,'src/db.ts'));const {generateToken}=require(path.join(backend,'src/utils/jwt.ts'));
const express=fromBackend('express'),request=fromBackend('supertest');const {errorHandler}=require(path.join(backend,'src/middleware/errorHandler.ts'));const {resolveStayTiming}=require(path.join(backend,'src/shared/lodgingTiming.ts'));
const app=express();app.use(express.json());app.use(fromBackend('cookie-parser')());app.use('/api/v1/stats',require(path.join(backend,'src/routes/stats.ts')).default);app.use('/api/v1/lodging',require(path.join(backend,'src/routes/lodging.ts')).default);app.use('/api/v1/places',require(path.join(backend,'src/routes/places.ts')).default);app.use(errorHandler);
const report={commit:'9678e6cd',results:[]};let fetchAttempts=0;const oldFetch=global.fetch;global.fetch=async()=>{fetchAttempts++;throw new Error('External fetch prohibited');};
async function newUser(label){const u=await prisma.user.create({data:{username:'block15-'+label+'-'+Date.now(),passwordHash:'synthetic-unused'}});return {...u,cookie:`auth_token=${generateToken(u.id)}`};}
async function main(){
 for(const c of [{name:'MONTH placeholder span',datePrecision:'MONTH',checkIn:'2025-05-01',checkOut:'2025-06-01',nights:3},{name:'DAY exact control',datePrecision:'DAY',checkIn:'2025-05-01',checkOut:'2025-05-04',nights:3},{name:'checkout only',datePrecision:'DAY',checkIn:null,checkOut:'2025-05-04',nights:null}]){
  const u=await newUser('stay'),l=await prisma.lodging.create({data:{userId:u.id,name:'Synthetic precision hotel',country:'Deutschland',isoCountryCode:'DE',city:'Berlin',visited:true}});
  const created=await request(app).post(`/api/v1/lodging/${l.id}/stays`).set('Cookie',u.cookie).send(c);assert.equal(created.status,201,JSON.stringify(created.body));
  const stay=await prisma.lodgingStay.findUniqueOrThrow({where:{id:created.body.data.id}}),timing=resolveStayTiming(stay);
  const all=await request(app).get('/api/v1/stats/summary').set('Cookie',u.cookie),year=await request(app).get('/api/v1/stats/summary').query({year:2025}).set('Cookie',u.cookie),passport=await request(app).get('/api/v1/stats/passport').set('Cookie',u.cookie);for(const r of [all,year,passport])assert.equal(r.status,200);
  const de=passport.body.countries.find(c=>c.code==='DE');assert.ok(de);
  report.results.push({name:c.name,httpCreate:created.status,storedPrecision:stay.datePrecision,storedNights:stay.nights,timing:{walkable:timing.walkable,nights:timing.nights},daysAwayAll:all.body.daysAway.lodging,daysAwayYear:year.body.daysAway.lodging,passportDaysPresent:de.daysPresent,passportNights:de.lodging.nights});
 }
 const u=await newUser('future');const place=await prisma.place.create({data:{userId:u.id,name:'Synthetic known place',lat:52,lon:13,address:'Synthetic Road 1',city:'Berlin',country:'Deutschland',isoCountryCode:'DE',visited:true}});
 const before=await request(app).get('/api/v1/stats/passport').set('Cookie',u.cookie);assert.equal(before.status,200);
 const visit=await request(app).post(`/api/v1/places/${place.id}/visits`).set('Cookie',u.cookie).send({visitedAt:'2099-01-02'});assert.equal(visit.status,201,JSON.stringify(visit.body));
 const after=await request(app).get('/api/v1/stats/passport').set('Cookie',u.cookie),detail=await request(app).get('/api/v1/stats/countries/DE').set('Cookie',u.cookie),placeGet=await request(app).get(`/api/v1/places/${place.id}`).set('Cookie',u.cookie);for(const r of [after,detail,placeGet])assert.equal(r.status,200);
 const de=after.body.countries.find(c=>c.code==='DE'),previous=before.body.countries.find(c=>c.code==='DE');report.results.push({name:'future visit as past country evidence',before:{firstYear:previous.firstYear,daysPresent:previous.daysPresent,hasUndatedEvidence:previous.hasUndatedEvidence},after:{firstYear:de.firstYear,daysPresent:de.daysPresent,hasUndatedEvidence:de.hasUndatedEvidence},detailDates:detail.body.timeline.map(t=>t.date),placeCounts:{visitCount:placeGet.body.data.visitCount,plannedVisitCount:placeGet.body.data.plannedVisitCount}});
 for (const mixed of [false,true]) {
  const u=await newUser(mixed?'mixed-track':'track');
  await prisma.countryDay.createMany({data:['2020-06-01','2025-06-01'].map(date=>({userId:u.id,date:new Date(date+'T00:00:00Z'),countryCode:'DE',source:'dawarich',pointCount:20,airportPointCount:0,spanKm:5}))});
  if(mixed){const p=await prisma.place.create({data:{userId:u.id,name:'Synthetic middle-year visit',lat:52,lon:13,address:'Synthetic Road 1',city:'Berlin',country:'Deutschland',isoCountryCode:'DE',visited:true}});const visit=await request(app).post(`/api/v1/places/${p.id}/visits`).set('Cookie',u.cookie).send({visitedAt:'2023-06-01'});assert.equal(visit.status,201,JSON.stringify(visit.body));}
  const passport=await request(app).get('/api/v1/stats/passport').set('Cookie',u.cookie),detail=await request(app).get('/api/v1/stats/countries/DE').set('Cookie',u.cookie);for(const r of [passport,detail])assert.equal(r.status,200,JSON.stringify(r.body));
  const de=passport.body.countries.find(c=>c.code==='DE');assert.ok(de);
  report.results.push({name:mixed?'track span with middle-year place':'track-only multi-year span',passport:{firstYear:de.firstYear,lastYear:de.lastYear,daysPresent:de.daysPresent,kinds:de.kinds},detail:{firstYear:detail.body.firstYear,lastYear:detail.body.lastYear,trackDays:detail.body.trackDays}});
 }
 report.externalFetchAttempts=fetchAttempts;
}
main().catch(e=>{report.error=e.message;process.exitCode=1;}).finally(async()=>{global.fetch=oldFetch;await prisma.$disconnect();fs.writeFileSync(path.join(__dirname,'block15-loader-probes.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));});
