const fs=require('node:fs'),path=require('node:path');
const report=JSON.parse(fs.readFileSync(path.join(__dirname,'block16-backend-seeded-rerun.json'),'utf8'));
const log=fs.readFileSync(path.join(__dirname,'block15-backend-full.partial.log'),'utf8');
const failures=[...new Set(log.split(/\r?\n/).filter(x=>/^\s+● /.test(x)&&x.includes(' › ')).map(x=>x.replace(/^\s+● /,'').split(' › ').join(' ')))];
const passed=new Set(report.testResults.flatMap(x=>x.assertionResults.filter(y=>y.status==='passed').map(y=>y.fullName)));
const result={uniqueOriginalFailureNames:failures.length,matchedPassed:failures.filter(x=>passed.has(x)).length,unmatched:failures.filter(x=>!passed.has(x)),rerunFiles:report.testResults.length,rerunPass:report.numPassedTests,rerunSuccess:report.success};
fs.writeFileSync(path.join(__dirname,'block17-backend-identity-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
const {chromium,firefox,webkit}=require('../../node_modules/@playwright/test');
console.log(JSON.stringify(Object.fromEntries(Object.entries({chromium,firefox,webkit}).map(([n,b])=>[n,{installed:fs.existsSync(b.executablePath())}]))));
