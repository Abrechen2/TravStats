/* Run ONLY inside the disposable audit runtime, with frozen dist mounted read-only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dbUrl = new URL(process.env.DATABASE_URL);
assert.equal(process.platform,'linux');
assert.equal(dbUrl.hostname,'127.0.0.1');
assert.equal(dbUrl.port,'5432');
assert.equal(dbUrl.pathname,'/travstats_block12_restore_audit');
assert.equal(process.env.BACKUP_PATH,'/app/data/audit-backups');
assert.equal(process.env.NODE_ENV,'test');
process.env.JWT_SECRET=crypto.randomBytes(32).toString('hex');
process.env.ENCRYPTION_KEY=crypto.randomBytes(32).toString('hex');
const appRoot='/app/backend';
const fromApp = name=>require(path.join(appRoot,'node_modules',name));
const { prisma }=require(appRoot+'/dist/db.js');
const { createBackup,restoreBackup }=require(appRoot+'/dist/services/backupService.js');
const { BACKED_UP_UPLOAD_DIRS,UPLOADS_ROOT }=require(appRoot+'/dist/config/uploadDirs.js');
const express=fromApp('express');
const { generateToken }=require(appRoot+'/dist/utils/jwt.js');
const backupRouter=require(appRoot+'/dist/routes/backup.js').default;
const { errorHandler }=require(appRoot+'/dist/middleware/errorHandler.js');
const report={commit:'9678e6cd',platform:process.platform,results:[]};
let server;
async function main(){
  assert.equal(await prisma.user.count(),0,'only a new empty audit database may be used');
  assert.equal(UPLOADS_ROOT,'/app/backend/uploads');
  const admin=await prisma.user.create({data:{username:'synthetic-restore-admin',passwordHash:'synthetic-unused',isAdmin:true,isActive:true}});
  const expected=new Map();
  for(const dir of BACKED_UP_UPLOAD_DIRS){
    const filename=path.join(UPLOADS_ROOT,dir,'audit-roundtrip.bin');
    const bytes=Buffer.from(`SYNTHETIC ORIGINAL ${dir}\n`);
    fs.mkdirSync(path.dirname(filename),{recursive:true});
    fs.writeFileSync(filename,bytes); expected.set(filename,bytes);
  }
  const app=express();app.use(express.json());app.use(fromApp('cookie-parser')());
  app.use('/api/v1/backup',backupRouter);app.use(errorHandler);
  server=await new Promise(resolve=>{const srv=app.listen(0,'127.0.0.1',()=>resolve(srv));});
  const base=`http://127.0.0.1:${server.address().port}/api/v1/backup`;
  const cookie=`auth_token=${generateToken(admin.id)}`;
  async function api(suffix,method='GET',body){
    const response=await fetch(base+suffix,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }
  assert.equal((await api('/status')).status,200);
  const backupId=await createBackup({type:'full'});
  const before=await prisma.backup.findUniqueOrThrow({where:{id:backupId}});
  assert.equal(before.status,'completed');
  await prisma.user.update({where:{id:admin.id},data:{username:'synthetic-modified-after-backup'}});
  const later=await prisma.user.create({data:{username:'synthetic-created-after-backup',passwordHash:'synthetic-unused'}});
  for(const filename of expected.keys()) fs.writeFileSync(filename,'SYNTHETIC CHANGED');
  const restored=await api(`/${backupId}/restore`,'POST',{scope:'full',createBackupBefore:false});
  assert.equal(restored.status,200,JSON.stringify(restored));
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:admin.id}})).username,'synthetic-restore-admin');
  assert.equal(await prisma.user.findUnique({where:{id:later.id}}),null);
  for(const [filename,bytes] of expected) assert.deepEqual(fs.readFileSync(filename),bytes);
  report.results.push({name:'full database and seven upload directories round trip',restoreHttp:restored.status,databaseReplaced:true,restoredDirectories:BACKED_UP_UPLOAD_DIRS,nestedUploads:fs.existsSync(path.join(UPLOADS_ROOT,'uploads'))});
  const after=await prisma.backup.findUniqueOrThrow({where:{id:backupId}});
  const status=await api('/status');
  const nextBackup=await api('','POST',{type:'full'});
  const secondRestore=await api(`/${backupId}/restore`,'POST',{scope:'full',createBackupBefore:false});
  report.results.push({name:'backup state after successful restore',before:before.status,after:after.status,statusHttp:status.status,running:status.body.running,newBackupHttp:nextBackup.status,newBackupError:nextBackup.body.error,secondRestoreHttp:secondRestore.status,secondRestoreError:secondRestore.body.error});
  // A deliberately invalid SMALL dump proves statement errors roll back. Only this
  // synthetic database is addressed. No process termination or whole-schema deletion.
  const badDir='/app/data/audit-bad-dump';fs.mkdirSync(badDir,{recursive:true});
  const sqlFile=path.join(badDir,'database.sql');
  fs.writeFileSync(sqlFile,`UPDATE users SET username='synthetic-would-be-partial' WHERE id='${admin.id}';\nSELECT * FROM synthetic_audit_missing_table;\n`);
  const archiveFile=path.join(badDir,'bad.tar.gz');
  await new Promise((resolve,reject)=>{const archive=fromApp('archiver')('tar',{gzip:true});const output=fs.createWriteStream(archiveFile);archive.on('error',reject);output.on('error',reject);output.on('close',resolve);archive.pipe(output);archive.file(sqlFile,{name:'database.sql'});archive.finalize();});
  const bad=await prisma.backup.create({data:{type:'full',status:'completed',backupPath:archiveFile}});
  let rejected=false;
  try{await restoreBackup(bad.id,{scope:'database',createBackupBefore:false});}catch{rejected=true;}
  assert.ok(rejected,'an invalid SQL statement must reject restore');
  const finalName=(await prisma.user.findUniqueOrThrow({where:{id:admin.id}})).username;
  assert.equal(finalName,'synthetic-restore-admin');
  report.results.push({name:'invalid SQL restore is rejected and prior write rolls back',rejected,databaseUnchanged:true});
}
main().catch(error=>{report.error=error.message;process.exitCode=1;}).finally(async()=>{
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await prisma.$disconnect();
  console.log(JSON.stringify(report));
});
