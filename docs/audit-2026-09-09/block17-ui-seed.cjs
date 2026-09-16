const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');const backend=path.resolve(__dirname,'../../.tmp/audit-round2-9678e6cd/backend');
const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55439');assert.equal(url.pathname,'/travstats_block17_ui_audit');assert.equal(process.env.NODE_ENV,'test');
require(path.join(backend,'node_modules/tsx/dist/cjs/index.cjs'));const {prisma}=require(path.join(backend,'src/db.ts'));const {hashPassword}=require(path.join(backend,'src/utils/password.ts'));
const result={};async function main(){
 const u=await prisma.user.create({data:{username:'audit-ui-17',passwordHash:await hashPassword('Synthetic-UI-Only-2026'),isAdmin:true,isDemo:true}});result.userId=u.id;
 await prisma.userSettings.create({data:{userId:u.id,enabledDomains:['flight','cruise','lodging','poi','tour'],data:{language:'de'},autoUpdateEnabled:false}});
 const trip=await prisma.trip.create({data:{userId:u.id,name:'Audit: Singapur und Europa',startDate:new Date('2025-06-01'),endDate:new Date('2025-06-20'),status:'completed'}});result.tripId=trip.id;
 for(const [i,dep,arr,date,status] of [[0,'FRA','SIN','2025-06-01T10:00:00Z','flown'],[1,'SIN','FRA','2025-06-10T12:00:00Z','flown'],[2,'FRA','JFK','2027-01-03T10:00:00Z','scheduled']]){
  const a=await prisma.airport.findFirstOrThrow({where:{iata:dep,isClosed:false}}),b=await prisma.airport.findFirstOrThrow({where:{iata:arr,isClosed:false}});
  const f=await prisma.flight.create({data:{userId:u.id,tripId:status==='flown'?trip.id:null,depIata:dep,depIcao:a.icao,depName:a.name,depLat:a.lat,depLon:a.lon,arrIata:arr,arrIcao:b.icao,arrName:b.name,arrLat:b.lat,arrLon:b.lon,airline:'Lufthansa',flightNumber:'LH'+(700+i),aircraft:'Airbus A350',departureTime:new Date(date),arrivalTime:new Date(Date.parse(date)+12*3600000),status,depTimeSemantics:'UTC',arrTimeSemantics:'UTC',gate:'A1',price:500,currency:'EUR'}});
  if(i===0){result.flightId=f.id;const snapshot={airline:f.airline,aircraft:f.aircraft,gate:f.gate,depIata:dep,arrIata:arr,departureTime:f.departureTime.toISOString(),arrivalTime:f.arrivalTime.toISOString()};const p=await prisma.pendingFlightUpdate.create({data:{flightId:f.id,userId:u.id,originalData:snapshot,proposedData:{...snapshot,gate:'B2'},changes:[{field:'gate',oldValue:'A1',newValue:'B2',type:'changed'}],apiSource:'aviationstack',fetchedAt:new Date(),expiresAt:new Date('2099-01-01')}});result.pendingId=p.id;}
 }
 const hotel=await prisma.lodging.create({data:{userId:u.id,name:'Audit Hotel Singapore',type:'hotel',city:'Singapore',country:'Singapore',isoCountryCode:'SG',lat:1.29,lon:103.85,visited:true}});result.lodgingId=hotel.id;
 await prisma.lodgingStay.create({data:{userId:u.id,lodgingId:hotel.id,tripId:trip.id,checkIn:new Date('2025-06-02'),checkOut:new Date('2025-06-10'),nights:8,status:'completed',totalPrice:800,currency:'EUR',datePrecision:'DAY'}});
 const place=await prisma.place.create({data:{userId:u.id,name:'Audit Gardens Singapore',lat:1.2816,lon:103.8636,city:'Singapore',country:'Singapore',isoCountryCode:'SG',visited:true,category:'landmark'}});result.placeId=place.id;
 await prisma.placeVisit.create({data:{userId:u.id,placeId:place.id,tripId:trip.id,visitedAt:new Date('2025-06-04')}});
 const cruise=await prisma.cruise.create({data:{userId:u.id,shipNameOverride:'Audit Schiff',routeName:'Synthetische Mittelmeerreise',startDate:new Date('2025-08-01'),endDate:new Date('2025-08-08'),status:'completed',price:900,currency:'EUR'}});result.cruiseId=cruise.id;
 fs.writeFileSync(path.join(__dirname,'block17-ui-fixtures.json'),JSON.stringify(result,null,2));console.log('Synthetic UI fixtures created in block17 DB');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
