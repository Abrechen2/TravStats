const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const backend=path.resolve(__dirname,'../../.tmp/audit-round2-9678e6cd/backend');
const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55439');assert.equal(url.pathname,'/travstats_block12_probe_audit');assert.equal(process.env.NODE_ENV,'test');
require(path.join(backend,'node_modules/tsx/dist/cjs/index.cjs'));const {prisma}=require(path.join(backend,'src/db.ts'));const {findOrCreateAirport}=require(path.join(backend,'src/services/airportLookup.ts'));
const report={commit:'9678e6cd'};const oldFetch=global.fetch;let calls=0,release;const gate=new Promise(r=>release=r);
async function main(){let code;for(let i=0;i<26;i++){const c='QZ'+String.fromCharCode(65+i);if(!await prisma.airport.findFirst({where:{iata:c}})){code=c;break;}}assert.ok(code);
 global.fetch=async()=>{calls++;if(calls===2)release();await gate;return new Response(JSON.stringify({iata:code,name:'Synthetic race airport',latitude:'52.5',longitude:'13.4',country:'Germany'}),{status:200,headers:{'content-type':'application/json'}});};
 const outcomes=await Promise.allSettled([findOrCreateAirport(code),findOrCreateAirport(code)]);
 report.concurrent=outcomes.map(r=>r.status==='fulfilled'?{status:r.status,hasAirport:!!r.value}:{status:r.status,errorCode:r.reason.code});report.providerStubCalls=calls;report.storedRows=await prisma.airport.count({where:{iata:code}});report.laterLookupSucceeds=!!await findOrCreateAirport(code);
}
main().catch(e=>{report.error=e.message;process.exitCode=1;}).finally(async()=>{global.fetch=oldFetch;await prisma.$disconnect();fs.writeFileSync(path.join(__dirname,'block16-airport-race.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));});
