const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const backend=path.resolve(__dirname,'../../.tmp/audit-current-39715ec5/backend');const url=new URL(process.env.DATABASE_URL);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55439');assert.equal(url.pathname,'/travstats_block12_probe_audit');assert.equal(process.env.NODE_ENV,'test');
require(path.join(backend,'node_modules/tsx/dist/cjs/index.cjs'));const dep=n=>require(path.join(backend,'node_modules',n));const {prisma}=require(path.join(backend,'src/db.ts'));const {generateToken}=require(path.join(backend,'src/utils/jwt.ts'));const {stayStartsAt}=require(path.join(backend,'src/utils/stayInstant.ts'));
const app=dep('express')();app.use(dep('cookie-parser')());app.use('/upcoming',require(path.join(backend,'src/routes/upcoming.ts')).default);app.use(require(path.join(backend,'src/middleware/errorHandler.ts')).errorHandler);const request=dep('supertest');
const report={commit:'39715ec5',results:[]};const RealDate=Date;let frozen;
function freeze(instant){frozen=Date.parse(instant);global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[frozen]));}static now(){return frozen;}};}
async function main(){
 const u=await prisma.user.create({data:{username:'block18-upcoming-'+Date.now(),passwordHash:'unused-synthetic'}});await prisma.userSettings.create({data:{userId:u.id,enabledDomains:['lodging'],data:{}}});
 freeze('2026-06-02T02:00:00Z');const cookie='auth_token='+generateToken(u.id);
 const hotel=await prisma.lodging.create({data:{userId:u.id,name:'Audit Los Angeles',type:'hotel',lat:34.05,lon:-118.24}});
 const stay=await prisma.lodgingStay.create({data:{userId:u.id,lodgingId:hotel.id,checkIn:new Date('2026-06-01T00:00:00Z'),checkOut:new Date('2026-06-03T00:00:00Z'),checkInTime:'22:30',status:'planned',datePrecision:'DAY'}});
 const instant=stayStartsAt({checkIn:stay.checkIn,checkInTime:stay.checkInTime,lat:hotel.lat,lon:hotel.lon});assert.equal(instant.toISOString(),'2026-06-02T05:30:00.000Z');
 const r=await request(app).get('/upcoming').set('Cookie',cookie);assert.equal(r.status,200);assert.equal(r.body.data.entries.length,0);report.results.push({name:'previous local day excluded',now:new Date().toISOString(),actualUpcomingInstant:instant.toISOString(),httpStatus:r.status,returnedEntries:r.body.data.entries.length});
 await prisma.lodgingStay.update({where:{id:stay.id},data:{checkIn:new Date('2026-06-02T00:00:00Z')}});const control=await request(app).get('/upcoming').set('Cookie',cookie);assert.equal(control.status,200);assert.equal(control.body.data.entries.length,1);report.results.push({name:'same UTC day positive control',httpStatus:control.status,returnedEntries:control.body.data.entries.length});
}
main().catch(e=>{report.error=e.message;process.exitCode=1;}).finally(async()=>{global.Date=RealDate;await prisma.$disconnect();fs.writeFileSync(path.join(__dirname,'block18-upcoming-probe.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));});
