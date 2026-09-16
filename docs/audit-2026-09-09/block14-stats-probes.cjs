/* Actual authenticated statistics endpoints on synthetic audit data only. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const backend=path.resolve(__dirname,'../../.tmp/audit-round2-9678e6cd/backend');const url=new URL(process.env.DATABASE_URL);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55439');assert.equal(url.pathname,'/travstats_block12_probe_audit');assert.equal(process.env.NODE_ENV,'test');
require(path.join(backend,'node_modules/tsx/dist/cjs/index.cjs'));const fromBackend=name=>require(path.join(backend,'node_modules',name));
const {prisma}=require(path.join(backend,'src/db.ts'));const {generateToken}=require(path.join(backend,'src/utils/jwt.ts'));
const express=fromBackend('express'),request=fromBackend('supertest'),stats=require(path.join(backend,'src/routes/stats.ts')).default;
const {errorHandler}=require(path.join(backend,'src/middleware/errorHandler.ts'));const report={commit:'9678e6cd',results:[]};
const originalFetch=global.fetch;let fetchAttempts=0;global.fetch=async()=>{fetchAttempts++;throw new Error('No external fetch in this probe');};
async function main(){
 const airports=[{iata:'BKK',icao:'VTBS',name:'Audit Bangkok timezone fixture',lat:13.69,lon:100.7501,country:'Thailand',timezone:'Asia/Bangkok'},{iata:'LAX',icao:'KLAX',name:'Audit Los Angeles timezone fixture',lat:33.9425,lon:-118.4081,country:'United States',timezone:'America/Los_Angeles'},{iata:'SIN',icao:'WSSS',name:'Audit Singapore timezone fixture',lat:1.3644,lon:103.9915,country:'Singapore',timezone:'Asia/Singapore'}];
 for(const a of airports)await prisma.airport.upsert({where:{airports_iata_is_closed_key:{iata:a.iata,isClosed:false}},create:a,update:a});
 const app=express();app.use(express.json());app.use(fromBackend('cookie-parser')());app.use('/api/v1/stats',stats);app.use(errorHandler);
 const cases=[{name:'east local new year',dep:'BKK',at:'2024-12-31T18:30:00Z',year:2025,expected:1},{name:'west local previous year',dep:'LAX',at:'2025-01-01T04:30:00Z',year:2025,expected:0},{name:'midyear control',dep:'BKK',at:'2025-06-01T10:00:00Z',year:2025,expected:1}];
 for(const c of cases){
  const user=await prisma.user.create({data:{username:'block14-stats-'+Date.now()+'-'+c.dep,passwordHash:'synthetic-unused'}}),cookie=`auth_token=${generateToken(user.id)}`,a=airports.find(a=>a.iata===c.dep);
  await prisma.flight.create({data:{userId:user.id,depIata:a.iata,depIcao:a.icao,arrIata:'SIN',arrIcao:'WSSS',depLat:a.lat,depLon:a.lon,arrLat:1.3644,arrLon:103.9915,status:'flown',departureTime:new Date(c.at),arrivalTime:new Date(Date.parse(c.at)+7200000),depTimeSemantics:'UTC',arrTimeSemantics:'UTC'}});
  const summary=await request(app).get('/api/v1/stats/summary').query({year:c.year,compareYear:c.year-1}).set('Cookie',cookie);assert.equal(summary.status,200);
  const series=await request(app).get('/api/v1/stats/timeseries').query({domain:'flight',window:'year',year:c.year}).set('Cookie',cookie);assert.equal(series.status,200);assert.equal(series.body.current.count,c.expected);
  const wrapped=await request(app).get('/api/v1/stats/wrapped').query({year:c.year}).set('Cookie',cookie);assert.equal(wrapped.status,200);
  report.results.push({name:c.name,departureUtc:c.at,timezone:a.timezone,year:c.year,expectedLocalYearCount:c.expected,summaryCount:summary.body.current.totalFlights,summaryPrevious:summary.body.compare.totalFlights,seriesCount:series.body.current.count,seriesPrevious:series.body.previous.count,wrappedCount:wrapped.body.flights,wrappedAvailableYears:wrapped.body.availableYears});
 }
 const flightBase={depIata:'LAX',depIcao:'KLAX',arrIata:'SFO',arrIcao:'KSFO',depLat:33.9425,depLon:-118.4081,arrLat:37.6213,arrLon:-122.379,status:'flown',depTimeSemantics:'UTC',arrTimeSemantics:'UTC'};
 const newUser=async label=>{const u=await prisma.user.create({data:{username:'block14-'+label+'-'+Date.now(),passwordHash:'synthetic-unused'}});return {...u,cookie:`auth_token=${generateToken(u.id)}`};};
 const hullUser=await newUser('hull');
 for(const [status,at] of [['flown','2025-06-01'],['cancelled','2025-06-02'],['scheduled','2099-06-03']])await prisma.flight.create({data:{...flightBase,userId:hullUser.id,status,aircraftRegistration:'N-AUDIT',departureTime:new Date(at+'T16:00:00Z'),arrivalTime:new Date(at+'T17:00:00Z')}});
 const ranking=await request(app).get('/api/v1/stats/aircraft').set('Cookie',hullUser.cookie),profile=await request(app).get('/api/v1/stats/aircraft/N-AUDIT').set('Cookie',hullUser.cookie);assert.equal(ranking.status,200);assert.equal(profile.status,200);
 assert.equal(ranking.body.aircraft[0].count,1);
 report.results.push({name:'aircraft ranking versus profile',rankingCount:ranking.body.aircraft[0].count,profileCount:profile.body.flightCount,rankingDistanceKm:ranking.body.aircraft[0].totalDistanceKm,profileDistanceKm:profile.body.totalDistanceKm,profileStatuses:profile.body.flights.map(f=>f.status),profileLastDate:profile.body.lastFlightDate});
 for(const c of [{name:'local afternoon crosses UTC midnight',departure:'2025-06-01T23:30:00Z',arrival:'2025-06-02T00:30:00Z',localDeparture:'2025-06-01 16:30',localArrival:'2025-06-01 17:30',expected:0},{name:'local midnight remains same UTC date',departure:'2025-06-02T06:30:00Z',arrival:'2025-06-02T07:30:00Z',localDeparture:'2025-06-01 23:30',localArrival:'2025-06-02 00:30',expected:1}]){
  const u=await newUser('nights');await prisma.flight.create({data:{...flightBase,userId:u.id,departureTime:new Date(c.departure),arrivalTime:new Date(c.arrival)}});
  const account=await request(app).get('/api/v1/stats/travel-account').set('Cookie',u.cookie);assert.equal(account.status,200);
  report.results.push({name:c.name,timezone:'America/Los_Angeles',localDeparture:c.localDeparture,localArrival:c.localArrival,expectedAirNights:c.expected,actualAirNights:account.body.account.years.reduce((n,y)=>n+y.airNights,0),years:account.body.account.years});
 }
 const costUser=await newUser('tripcost'),trip=await prisma.trip.create({data:{userId:costUser.id,name:'Synthetic cost trip',startDate:new Date('2025-06-01'),endDate:new Date('2025-06-04'),status:'completed'}});
 const booking=await prisma.booking.create({data:{userId:costUser.id,tripId:trip.id,price:300,currency:'EUR'}});
 for(const day of [1,2])await prisma.flight.create({data:{...flightBase,userId:costUser.id,tripId:trip.id,bookingId:booking.id,price:null,currency:'EUR',departureTime:new Date(`2025-06-0${day}T16:00:00Z`),arrivalTime:new Date(`2025-06-0${day}T17:00:00Z`)}});
 await prisma.flight.create({data:{...flightBase,userId:costUser.id,tripId:trip.id,price:100,taxes:20,fees:10,currency:'EUR',departureTime:new Date('2025-06-03T16:00:00Z'),arrivalTime:new Date('2025-06-03T17:00:00Z')}});
 const costSummary=await request(app).get('/api/v1/stats/summary').set('Cookie',costUser.cookie),costTrip=await request(app).get('/api/v1/stats/travel-account').set('Cookie',costUser.cookie);assert.equal(costSummary.status,200);assert.equal(costTrip.status,200);assert.equal(costSummary.body.totalCost,430);
 report.results.push({name:'trip cost booking and taxes parity',bookingPrice:300,ownPrice:100,taxes:20,fees:10,summaryTotal:costSummary.body.totalCost,tripSpend:costTrip.body.trips.trips[0].spendByCurrency});
 report.externalFetchAttempts=fetchAttempts;
}
main().catch(error=>{report.error=error.message;process.exitCode=1;}).finally(async()=>{global.fetch=originalFetch;await prisma.$disconnect();fs.writeFileSync(path.join(__dirname,'block14-stats-probes.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));});
