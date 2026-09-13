const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {chromium}=require('../../node_modules/@playwright/test');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'block17-ui-fixtures.json'),'utf8'));const report={commit:'9678e6cd',views:[],errors:[],blockedExternalHosts:[],pending:[]};
const output=path.join(__dirname,'block17-ui-images');fs.mkdirSync(output,{recursive:true});
async function main(){const browser=await chromium.launch({headless:true});try{
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},locale:'de-DE',timezoneId:'Europe/Berlin'});const blocked=new Set();
 await ctx.route('**/*',r=>{const u=new URL(r.request().url());if(u.protocol.startsWith('http')&&u.hostname!=='127.0.0.1'){blocked.add(u.hostname);return r.abort();}return r.continue();});
 const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push({path:new URL(page.url()).pathname,message:e.message}));
 await page.goto('http://127.0.0.1:13017/login');await page.locator('#username').fill('audit-ui-17');await page.locator('#password').fill('Synthetic-UI-Only-2026');await page.locator('button[type=submit]').click();await page.waitForURL('**/dashboard');
 const routes=['/dashboard','/dashboard/flight','/dashboard/cruise','/dashboard/lodging','/dashboard/poi','/dashboard/tour','/flights','/flights/'+fixture.flightId,'/cruises','/cruises/'+fixture.cruiseId,'/lodging','/lodging/'+fixture.lodgingId,'/places','/places/'+fixture.placeId,'/places/lists','/trips','/trips/'+fixture.tripId,'/stats','/passport','/achievements','/pending-updates','/settings','/admin'];
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===320?568:900});for(let i=0;i<routes.length;i++){
   const route=routes[i];await page.goto('http://127.0.0.1:13017'+route);await page.locator('nav').first().waitFor({state:'attached',timeout:15000});await page.waitForTimeout(2300);
   const layout=await page.evaluate(()=>({path:location.pathname,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,headings:[...document.querySelectorAll('h1,h2')].filter(e=>e.getClientRects().length).map(e=>e.textContent),buttons:[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>e.getAttribute('aria-label')||e.textContent.trim()).filter(Boolean).slice(-24),bodyText:document.body.innerText.slice(-280)}));
   const image=String(width)+'-'+String(i).padStart(2,'0')+'.png';await page.screenshot({path:path.join(output,image),fullPage:false});report.views.push({...layout,image});
   fs.writeFileSync(path.join(__dirname,'block17-ui-browser.json'),JSON.stringify(report,null,2));
 }console.log('UI viewport completed: '+width);}
 report.blockedExternalHosts=[...blocked];await ctx.close();
}finally{await browser.close();}}
main().catch(e=>{report.error=e.message;process.exitCode=1;}).finally(()=>{fs.writeFileSync(path.join(__dirname,'block17-ui-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({views:report.views.length,errors:report.errors,error:report.error}));});
