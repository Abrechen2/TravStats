/* Real POI routes/services and synthetic data in the frozen audit copy. */
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const backend=path.resolve(__dirname,'../../.tmp/audit-round2-9678e6cd/backend');
const dbUrl=new URL(process.env.DATABASE_URL);
assert.equal(dbUrl.hostname,'127.0.0.1');assert.equal(dbUrl.port,'55439');assert.equal(dbUrl.pathname,'/travstats_block12_probe_audit');assert.equal(process.env.NODE_ENV,'test');
require(path.join(backend,'node_modules/tsx/dist/cjs/index.cjs'));
const fromBackend=name=>require(path.join(backend,'node_modules',name));
const {prisma}=require(path.join(backend,'src/db.ts'));const {generateToken}=require(path.join(backend,'src/utils/jwt.ts'));
const express=fromBackend('express');const request=fromBackend('supertest');
const places=require(path.join(backend,'src/routes/places.ts')).default;
const photos=require(path.join(backend,'src/routes/places/visitPhotos.ts')).default;
const {errorHandler}=require(path.join(backend,'src/middleware/errorHandler.ts'));
const {getPlacePhotoDir}=require(path.join(backend,'src/middleware/upload.ts'));
const {placeImportCommitSchema}=require(path.join(backend,'src/schemas/placeImport.ts'));
const {previewPlaceImport}=require(path.join(backend,'src/services/places/placeImportPreview.ts'));
const {commitPlaceImport}=require(path.join(backend,'src/services/places/placeImportCommit.ts'));
const {calculatePlaceStats}=require(path.join(backend,'src/utils/placeStats.ts'));
const report={commit:'9678e6cd',results:[]};
const oldFetch=global.fetch;let blockedFetch=0;
global.fetch=async()=>{blockedFetch++;throw new Error('External fetch prohibited in this audit probe');};
async function main(){
  const user=await prisma.user.create({data:{username:'block13-poi-'+Date.now(),passwordHash:'synthetic-unused'}});
  const other=await prisma.user.create({data:{username:'block13-other-'+Date.now(),passwordHash:'synthetic-unused'}});
  const cookie=`auth_token=${generateToken(user.id)}`;const otherCookie=`auth_token=${generateToken(other.id)}`;
  const app=express();app.use(express.json());app.use(fromBackend('cookie-parser')());app.use('/api/v1/places',photos);app.use('/api/v1/places',places);app.use(errorHandler);
  const makePlace=name=>prisma.place.create({data:{userId:user.id,name,lat:52,lon:13,visited:true,category:'landmark'}});
  const a=await makePlace('A lesser');const z=await makePlace('Z greater');
  await prisma.placeVisit.create({data:{userId:user.id,placeId:a.id,visitedAt:new Date('2020-01-01')}});
  for(let i=0;i<3;i++)await prisma.placeVisit.create({data:{userId:user.id,placeId:z.id,visitedAt:new Date(Date.UTC(2025,0,1+i))}});
  for(const sortBy of ['visitCount','lastVisit']){
    const one=await request(app).get('/api/v1/places').query({sortBy,sortOrder:'desc',limit:1}).set('Cookie',cookie);
    const all=await request(app).get('/api/v1/places').query({sortBy,sortOrder:'desc',limit:2}).set('Cookie',cookie);
    assert.equal(one.status,200);assert.equal(all.status,200);assert.equal(one.body.meta.total,2);
    assert.equal(all.body.data[0].id,z.id);
    report.results.push({name:'derived sort before/after paging',sortBy,firstWithLimit1:one.body.data[0].name,firstWithLimit2:all.body.data[0].name,total:one.body.meta.total});
  }
  const rows=[{sourceRowIndex:0,name:'Imported past',lat:52,lon:13,address:'Synthetic Road 1',city:'Berlin',country:'Deutschland',visitedAt:'2020-01-02',externalRef:'csv:synthetic-past'},
    {sourceRowIndex:1,name:'Imported future',lat:52,lon:13,address:'Synthetic Road 2',city:'Berlin',country:'Deutschland',visitedAt:'2099-01-02',externalRef:'csv:synthetic-future'}];
  const validated=placeImportCommitSchema.parse({source:'csv',fileName:'synthetic-poi.csv',rows});
  const preview=await previewPlaceImport(user.id,validated.rows);
  const result=await commitPlaceImport(user.id,validated.source,validated.fileName,validated.rows);
  assert.equal(result.created,2);assert.deepEqual(result.failed,[]);
  const imported=await prisma.place.findMany({where:{userId:user.id,batchId:result.batchId},include:{visits:true},orderBy:{name:'asc'}});
  const stats=calculatePlaceStats(imported);
  const countryFilter=await request(app).get('/api/v1/places').query({country:'DE',q:'Imported'}).set('Cookie',cookie);
  assert.equal(countryFilter.status,200);
  report.results.push({name:'POI import date and country preservation',preview:preview.rows.map(r=>({name:r.name,visitedAt:r.visitedAt,action:r.action,flags:r.flags})),created:result.created,
    stored:imported.map(p=>({name:p.name,visited:p.visited,visitRows:p.visits.length,country:p.country,isoCountryCode:p.isoCountryCode})),
    stats:{places:stats.placesCount,visits:stats.placeVisitsCount,countries:stats.placeCountries.size},countryFilterTotal:countryFilter.body.meta.total});
  const control=await request(app).post('/api/v1/places').set('Cookie',cookie).send({name:'Manual country control',lat:52,lon:13,address:'Synthetic Road 3',city:'Berlin',country:'Deutschland',visited:true});
  assert.equal(control.status,201);assert.equal(control.body.data.isoCountryCode,'DE');
  report.results.push({name:'manual country positive control',status:201,isoCountryCode:control.body.data.isoCountryCode});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOioAAAAASUVORK5CYII=','base64');
  for(const scope of ['photo','visit','place']){
    const place=await makePlace('Delete '+scope);
    const visit=await prisma.placeVisit.create({data:{userId:user.id,placeId:place.id,visitedAt:new Date('2020-01-01')}});
    const upload=await request(app).post(`/api/v1/places/visits/${visit.id}/photos`).set('Cookie',cookie).attach('photos',png,{filename:'synthetic.png',contentType:'image/png'});
    assert.equal(upload.status,201,JSON.stringify(upload.body));
    const photoId=upload.body.data[0].id;const photo=await prisma.placeVisitPhoto.findUniqueOrThrow({where:{id:photoId}});
    const filename=path.join(getPlacePhotoDir(),path.basename(photo.filename));assert.ok(filename.startsWith(backend+path.sep));assert.ok(fs.existsSync(filename));
    const beforeGet=await request(app).get(upload.body.data[0].url).set('Cookie',cookie);assert.equal(beforeGet.status,200);
    const refused=await request(app).delete(`/api/v1/places/visits/${visit.id}/photos/${photoId}`).set('Cookie',otherCookie);
    assert.equal(refused.status,404);assert.ok(fs.existsSync(filename));
    const target=scope==='photo'?`/visits/${visit.id}/photos/${photoId}`:scope==='visit'?`/visits/${visit.id}`:`/${place.id}`;
    const removed=await request(app).delete('/api/v1/places'+target).set('Cookie',cookie);assert.ok([200,204].includes(removed.status));
    const afterGet=await request(app).get(upload.body.data[0].url).set('Cookie',cookie);
    const rowExists=(await prisma.placeVisitPhoto.findUnique({where:{id:photoId}}))!==null;
    const fileExists=fs.existsSync(filename);
    if(scope==='photo'){assert.equal(rowExists,false);assert.equal(fileExists,false);}
    report.results.push({name:'photo lifecycle',deleted:scope,uploadHttp:upload.status,getBeforeHttp:beforeGet.status,otherUserDeleteHttp:refused.status,deleteHttp:removed.status,photoRowExists:rowExists,fileStillExists:fileExists,getAfterHttp:afterGet.status});
  }
  report.blockedExternalFetches=blockedFetch;
}
main().catch(error=>{report.error=error.message;process.exitCode=1;}).finally(async()=>{global.fetch=oldFetch;await prisma.$disconnect();fs.writeFileSync(path.join(__dirname,'block13-poi-probes.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));});
