const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const backend=path.resolve(__dirname,'../../.tmp/audit-round2-9678e6cd/backend');assert.equal(process.env.NODE_ENV,'test');assert.equal(new URL(process.env.DATABASE_URL).pathname,'/travstats_block12_probe_audit');
require(path.join(backend,'node_modules/tsx/dist/cjs/index.cjs'));
const {suggestVisits}=require(path.join(backend,'src/services/places/visitSuggestions.ts'));const {calculateDistance}=require(path.join(backend,'src/utils/geo.ts'));
const {computePunctuality}=require(path.join(backend,'src/services/punctualityStats.ts'));
const copy=JSON.parse(fs.readFileSync(path.join(backend,'../frontend/src/i18n/resources/de/stats.json'),'utf8'));
const report={commit:'9678e6cd',results:[]};
for(const delayMinutes of [14,15,16]){const actual=computePunctuality([{delayMinutes,airline:'Audit',airlineIata:'XX',depIata:'LAX',arrIata:'SFO'}]);report.results.push({name:'on-time boundary',delayMinutes,onTimeRate:actual.onTimeRate,label:copy.punctuality.onTimeRate});}
for(const shift of [0,-0.1]){const target={itemId:'synthetic-arctic',name:'Synthetic target',lat:69.65,lon:18.99+shift};const anchor={kind:'cruise_port',label:'Synthetic port',lat:69.65,lon:20.01+shift,at:new Date('2020-01-01')};const distance=calculateDistance(target.lat,target.lon,anchor.lat,anchor.lon);assert.ok(distance<40);const result=suggestVisits([target],[anchor]);report.results.push({name:'high latitude grid',shift,distanceKm:distance,targetLon:target.lon,anchorLon:anchor.lon,suggestions:result.length});}
fs.writeFileSync(path.join(__dirname,'block15-helper-probes.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
