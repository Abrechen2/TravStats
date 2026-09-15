// Separate UI test server; existing API/helper remains untouched.
const path=require('node:path'),http=require('node:http');
const frontend=path.resolve(__dirname,'../../.tmp/audit-round2-9678e6cd/frontend');process.chdir(frontend);process.env.VITE_API_URL='';
async function main(){const {createServer}=await import(require('node:url').pathToFileURL(path.join(frontend,'node_modules/vite/dist/node/index.js')).href);
const server=await createServer({root:frontend,configFile:path.join(frontend,'vite.config.ts'),cacheDir:path.join(frontend,'.audit-vite-block17'),server:{host:'127.0.0.1',port:13018,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:18017',changeOrigin:true}}},plugins:[{name:'audit-local-close',configureServer(s){s.middlewares.use('/__audit/close',(req,res,next)=>{if(req.method!=='POST')return next();res.end('closing');setTimeout(()=>server.close().then(()=>console.log('AUDIT_VITE_CLOSED')),100);});}}]});await server.listen();console.log('AUDIT_VITE_READY 13018, frontend working directory');}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
