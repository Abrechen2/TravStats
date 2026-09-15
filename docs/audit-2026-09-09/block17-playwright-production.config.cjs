const path=require('node:path');
const {defineConfig,devices}=require('../../node_modules/@playwright/test');
module.exports=defineConfig({
 testDir:path.resolve(__dirname,'../../.tmp/audit-round2-9678e6cd/e2e'),
 fullyParallel:false,workers:1,retries:0,timeout:20000,
 outputDir:path.join(__dirname,'block17-e2e-production-artifacts'),
 reporter:[['json',{outputFile:path.join(__dirname,'block17-e2e-production.json')}],['line']],
 use:{baseURL:'http://127.0.0.1:13019',locale:'de-DE',timezoneId:'Europe/Berlin',trace:'retain-on-failure',screenshot:'only-on-failure'},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'firefox',use:{...devices['Desktop Firefox']}},{name:'webkit',use:{...devices['Desktop Safari']}}],
});
