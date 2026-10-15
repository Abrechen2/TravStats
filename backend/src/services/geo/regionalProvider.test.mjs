// Node.js provides these Web API globals to the test runner.
/* global Response, ReadableStream */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegionalRouting, createRegionalSearch, createRegionalElevation} from './regionalProvider.ts';

const release = {origin:'https://geo.example.invalid',datasetId:'berlin-test-1',datasetSha256:'a'.repeat(64),
  dataAsOf:'2026-10-01T00:00:00Z',bounds:[13,52,14,53],timeoutMs:100,maxResponseBytes:2048,
  builtMode:'road',profile:'car',profileSha256:'b'.repeat(64)};
const config = {policy:'own-only',release};
const from = [13.4,52.5], to = [13.5,52.6];
const json = body => new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
const route = {code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[from,to]},distance:1000,duration:120}]};

test('built graph mode and regional bounds are enforced before a request',async()=>{
  let requests=0;
  const client=createRegionalRouting(config,async()=>{requests++;return json(route);});
  await assert.rejects(client.route('foot',from,to),/mode_not_built/);
  await assert.rejects(client.route('road',[0,0],to),/outside_coverage/);
  await assert.rejects(client.route('road',[NaN,52],to),/outside_coverage/);
  assert.equal(requests,0);
});
test('route uses only configured graph, omits credentials and converts units',async()=>{
  const client=createRegionalRouting(config,async(url,options)=>{
    assert.equal(url.origin,release.origin);assert.match(url.pathname,/route\/v1\/car/);
    assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
    assert.deepEqual(options.headers,{Accept:'application/json'});return json(route);
  });
  const result=await client.route('road',from,to);
  assert.equal(result.distanceKm,1);assert.equal(result.drivingMinutes,2);assert.equal(result.datasetId,release.datasetId);
});
test('upstream failures never trigger an external fallback or disclose its error URL',async()=>{
  let calls=0;
  const client=createRegionalRouting(config,async()=>{calls++;throw Error('https://secret.example/token?coordinates=private');});
  await assert.rejects(client.route('road',from,to),e=>e.message==='upstream_unavailable');assert.equal(calls,1);
});
test('disabled capability, credentials, query tokens and oversized regions fail closed',()=>{
  assert.throws(()=>createRegionalRouting({policy:'disabled'}),/disabled/);
  for(const origin of ['http://geo.example','https://user:pass@geo.example','https://geo.example/?token=x'])
    assert.throws(()=>createRegionalRouting({...config,release:{...release,origin}}));
  assert.throws(()=>createRegionalRouting({...config,release:{...release,bounds:[-180,-80,180,80]}}));
});
test('HTTP200 HTML, NoRoute and route geometry leaving region are rejected',async()=>{
  for(const response of [new Response('<html>ok</html>',{headers:{'Content-Type':'text/html'}}),
    json({code:'NoRoute',routes:[]}),json({code:'Ok',routes:[{...route.routes[0],geometry:{type:'LineString',coordinates:[from,[0,0]]}}]})]) {
    await assert.rejects(createRegionalRouting(config,async()=>response).route('road',from,to));
  }
});
test('chunked oversized JSON is rejected even without content-length',async()=>{
  const client=createRegionalRouting(config,async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(3000));c.close();}}),{headers:{'content-type':'application/json'}}));
  await assert.rejects(client.route('road',from,to),/response_too_large/);
});
test('deadline aborts a stalled upstream without retry',async()=>{
  const client=createRegionalRouting(config,async(_url,{signal})=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});
  }));
  await assert.rejects(client.route('road',from,to),/timeout/);
});
test('search filters outside results and applies bbox to the request',async()=>{
  const client=createRegionalSearch(config,async(url)=>{
    assert.equal(url.searchParams.get('bbox'),'13,52,14,53');
    return json({type:'FeatureCollection',features:[from,[0,0]].map(coordinates=>({type:'Feature',geometry:{type:'Point',coordinates}}))});
  });
  assert.equal((await client.search('Berlin')).features.length,1);
});
test('DEM order, data identity and NoData survive; cache is dataset-versioned',async()=>{
  const client=createRegionalElevation({...config,release:{...release,dataset:'srtm-local'}},async(url)=>{
    assert.equal(url.searchParams.get('locations'),'52.5,13.4|52.6,13.5');
    return json({status:'OK',results:[{location:{lng:13.4,lat:52.5},dataset:'srtm-local',elevation:34},
      {location:{lng:13.5,lat:52.6},dataset:'srtm-local',elevation:null}]});
  });
  assert.deepEqual((await client.elevation([from,to])).elevations,[34,null]);
  assert.ok(client.cacheNamespace.includes(release.datasetSha256));
});
test('wrong DEM or swapped locations are not cached as valid elevations',async()=>{
  const client=createRegionalElevation({...config,release:{...release,dataset:'srtm-local'}},async()=>json({status:'OK',results:[{location:{lng:52.5,lat:13.4},dataset:'other',elevation:34}]}));
  await assert.rejects(client.elevation([from]),/invalid_elevation/);
});
