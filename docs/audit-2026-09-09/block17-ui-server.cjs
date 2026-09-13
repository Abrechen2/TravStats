// Dedicated loopback test app. No startup schedulers, production data or real provider keys.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),http=require('node:http');
const root=path.resolve(__dirname,'../..'),copy=path.join(root,'.tmp/audit-round2-9678e6cd'),backend=path.join(copy,'backend'),frontend=path.join(copy,'frontend');
const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55439');assert.equal(url.pathname,'/travstats_block17_ui_audit');assert.equal(process.env.NODE_ENV,'test');
process.chdir(backend);process.env.CORS_ORIGIN='http://127.0.0.1:13017';process.env.VITE_API_URL='';
require(path.join(backend,'node_modules/tsx/dist/cjs/index.cjs'));
const {prisma}=require(path.join(backend,'src/db.ts'));let vite,api;
const originalFetch=global.fetch;global.fetch=async(input,...args)=>{const target=new URL(typeof input==='string'?input:input.url??String(input));if(!['127.0.0.1','localhost'].includes(target.hostname))throw Error('Audit blocked external fetch');return originalFetch(input,...args);};
async function close(){if(vite)await vite.close();if(api)await new Promise(r=>api.close(r));await prisma.$disconnect();console.log('AUDIT_UI_CLOSED');}
async function main(){
 const {hashPassword}=require(path.join(backend,'src/utils/password.ts'));const passwordHash=await hashPassword('admin123');
 const user=await prisma.user.upsert({where:{username:'admin'},create:{username:'admin',passwordHash,isAdmin:true,isDemo:true},update:{passwordHash,isAdmin:true,isActive:true,isDemo:true,mustChangePassword:false,twoFactorSecret:null,twoFactorEnabledAt:null}});
 const settings={enabledDomains:['flight','cruise','lodging','poi','tour'],data:{language:'de'},autoUpdateEnabled:false};
 await prisma.userSettings.upsert({where:{userId:user.id},create:{userId:user.id,...settings},update:settings});
 const {updateInstanceSettings}=require(path.join(backend,'src/services/instanceSettingsService.ts'));
 await updateInstanceSettings({instanceName:'TravStats – isolierter UI-Audit',allowRegistration:false,maxUsers:1000});
 const {app}=require(path.join(backend,'src/index.ts'));
 api=http.createServer((req,res)=>{if(req.url==='/__audit/close'&&req.method==='POST'){res.end('closing');setTimeout(()=>close().catch(()=>process.exitCode=1),100);return;}app(req,res);});
 await new Promise((resolve,reject)=>{api.once('error',reject);api.listen(18017,'127.0.0.1',resolve);});
 const {createServer}=await import(require('node:url').pathToFileURL(path.join(frontend,'node_modules/vite/dist/node/index.js')).href);
 vite=await createServer({root:frontend,configFile:path.join(frontend,'vite.config.ts'),server:{host:'127.0.0.1',port:13017,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:18017',changeOrigin:true}}}});await vite.listen();
 console.log('AUDIT_UI_READY: frontend 13017, API 18017, synthetic DB block17');
}
main().catch(async e=>{console.error(e.message);process.exitCode=1;await close();});
