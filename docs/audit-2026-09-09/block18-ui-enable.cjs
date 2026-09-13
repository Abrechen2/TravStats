const assert=require('node:assert/strict'),path=require('node:path');const backend=path.resolve(__dirname,'../../.tmp/audit-round2-9678e6cd/backend');
const u=new URL(process.env.DATABASE_URL);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55439');assert.equal(u.pathname,'/travstats_block17_ui_audit');assert.equal(process.env.NODE_ENV,'test');
require(path.join(backend,'node_modules/tsx/dist/cjs/index.cjs'));const {prisma}=require(path.join(backend,'src/db.ts'));const {updateInstanceSettings}=require(path.join(backend,'src/services/instanceSettingsService.ts'));
updateInstanceSettings({betaFeaturesEnabled:true}).then(()=>console.log('Beta UI features enabled in synthetic audit DB only')).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
