const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');
const backend=path.resolve(__dirname,'../../.tmp/audit-round2-9678e6cd/backend');
const url=new URL(process.env.DATABASE_URL);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55439');assert.equal(url.pathname,'/travstats_block12_probe_audit');assert.equal(process.env.NODE_ENV,'test');
require(path.join(backend,'node_modules/tsx/dist/cjs/index.cjs'));
const {prisma}=require(path.join(backend,'src/db.ts'));
const mode=process.argv[2];assert.ok(['fairness','invalid'].includes(mode));
const report={commit:'9678e6cd',mode,results:[]};
async function main(){
  const user=await prisma.user.create({data:{username:'block12-geo-'+mode+'-'+Date.now(),passwordHash:'synthetic-unused'}});
  if(mode==='fairness'){
    let targetHits=0;let calls=0;
    const originalLoad=Module._load;
    Module._load=function(request,parent,...rest){
      if(parent?.filename.replaceAll('\\','/').endsWith('/services/lodging/geocodeBackfill.ts')){
        if(request==='../geo/photon')return {searchPlaces:async query=>{calls++;if(query.includes('Resolvable Tail')){targetHits++;return [{name:'Resolvable Tail',lat:52,lon:13,type:'hotel'}];}return [];}};
        if(request==='../geo/nominatim')return {geocodeAddress:async()=>null,reverseGeocode:async()=>null};
        if(request==='../geo/googlePlaces')return {findLodgingPlace:async()=>null};
      }
      return originalLoad.call(this,request,parent,...rest);
    };
    const {backfillMissingCoordinates}=require(path.join(backend,'src/services/lodging/geocodeBackfill.ts'));
    Module._load=originalLoad;
    await prisma.lodging.createMany({data:Array.from({length:500},(_,i)=>({userId:user.id,name:`Unresolvable ${i}`,type:'hotel',createdAt:new Date(Date.UTC(2020,0,1)+i*1000)}))});
    const batch=await prisma.importBatch.create({data:{userId:user.id,domain:'lodging',source:'csv'}});
    const tail=await prisma.lodging.create({data:{userId:user.id,name:'Resolvable Tail',type:'hotel',batchId:batch.id,createdAt:new Date('2026-01-01')}});
    const passes=[];for(let i=0;i<3;i++)passes.push(await backfillMissingCoordinates(user.id));
    assert.equal(targetHits,0);assert.equal(calls,1500);
    const before=await prisma.lodging.findUniqueOrThrow({where:{id:tail.id}});assert.equal(before.lat,null);
    const control=await backfillMissingCoordinates(user.id,batch.id);
    const after=await prisma.lodging.findUniqueOrThrow({where:{id:tail.id}});assert.equal(after.lat,52);
    report.results.push({name:'500 unresolved oldest rows starve row 501',providerBoundary:'deterministic stubs; actual selection and Prisma writes',passes,unscopedTargetRequests:0,totalUnscopedRequests:1500,tailBefore:before.lat,scopedControl:control,tailAfter:after.lat});
  }else{
    process.env.PHOTON_URL='http://127.0.0.1:1';process.env.NOMINATIM_URL='http://127.0.0.1:1';
    let fixture='photon-range';let calls=0;
    const oldFetch=global.fetch;
    global.fetch=async(input)=>{calls++;const parsed=new URL(String(input));
      if(parsed.pathname.includes('/api'))return new Response(JSON.stringify({features:fixture==='photon-range'?[{properties:{name:'Invalid Photon',osm_value:'hotel'},geometry:{coordinates:[222,99]}}]:[]}));
      return new Response(JSON.stringify(fixture==='nominatim-null'?[{lat:null,lon:''}]:[{lat:'-99',lon:'222'}]));};
    try{
      const {backfillMissingCoordinates}=require(path.join(backend,'src/services/lodging/geocodeBackfill.ts'));
      for(const variant of ['photon-range','nominatim-null','nominatim-range']){
        fixture=variant;
        const batch=await prisma.importBatch.create({data:{userId:user.id,domain:'lodging',source:'csv'}});
        const row=await prisma.lodging.create({data:{userId:user.id,name:'Invalid '+variant,type:'hotel',batchId:batch.id}});
        const result=await backfillMissingCoordinates(user.id,batch.id);
        const stored=await prisma.lodging.findUniqueOrThrow({where:{id:row.id}});
        report.results.push({variant,result,lat:stored.lat,lon:stored.lon});
      }
      assert.ok(calls>0);report.fetchCalls=calls;
    }finally{global.fetch=oldFetch;}
  }
}
main().catch(error=>{report.error=error.message;process.exitCode=1;}).finally(async()=>{await prisma.$disconnect();fs.writeFileSync(path.join(__dirname,`block12-geo-${mode}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report));});
