/** Materialize travel evidence only after an explicit confirmation. */
import type { Prisma } from '../../prisma';
import { prisma } from '../../db';
import {resolveCountryCode} from '../../shared/geo/countryCode';
import { AppError } from '../../middleware/errorHandler';
import { createFlightSchema } from '../../schemas/flight';
import { buildFlightCreateData } from '../flights/flightCreateData';
import { fxColumnsFor, getBaseCurrency, type FxColumns } from '../fx/snapshot';
import type { PlanState, PlanBooking, PlanItem } from './types';
export type PlanTransaction=Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export interface PreparedExecution {flight?:Prisma.FlightUncheckedCreateInput;fx?:FxColumns}
const refused=()=>new AppError('Review the actual travel record in TravStats first',409,'PLAN_EXECUTION_EDITED');
function actualDate(booking:PlanBooking){const today=new Intl.DateTimeFormat('en-CA',{timeZone:booking.timezone||booking.arrivalTimezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());if((booking.day&&booking.day>today)||(booking.endDay&&booking.endDay>today)||(booking.arrivalDay&&booking.arrivalDay>today))throw new AppError('Future travel cannot be confirmed as experienced',400,'PLAN_EXECUTION_FUTURE')}
export async function prepareExecution(userId:string,tripId:string,state:PlanState,itemId:string):Promise<PreparedExecution>{
 const item=state.items.find(i=>i.id===itemId);if(!item)throw new AppError('Plan item not found',404,'PLAN_ITEM_NOT_FOUND');
 if(['activity','free','transfer'].includes(item.kind))return {};
 if(!['flight','hotel'].includes(item.kind))throw new AppError('Link the corresponding actual record from TravStats',400,'PLAN_EXECUTION_LINK');
 const b=state.bookings.find(x=>x.id===item.bookingId);if(!b)throw new AppError('Reviewed booking required',400,'PLAN_EXECUTION_DETAILS');actualDate(b);
 const fx=await fxColumnsFor({amount:b.amount,currency:b.currency,date:b.day?new Date(b.day+'T00:00:00Z'):new Date()},await getBaseCurrency(userId));
 if(item.kind==='hotel')return {fx};
 const depCode=String(b.details.depIata??b.originPlace??'').trim().toUpperCase(),arrCode=String(b.details.arrIata??b.place).trim().toUpperCase();
 const [departure,arrival]=await Promise.all([prisma.airport.findFirst({where:{iata:depCode},orderBy:{isClosed:'asc'}}),prisma.airport.findFirst({where:{iata:arrCode},orderBy:{isClosed:'asc'}})]);
 if(!departure||!arrival)throw new AppError('Departure and arrival airports must be known',400,'PLAN_EXECUTION_DETAILS');
 const depZone=b.timezone||departure.timezone,arrZone=b.arrivalTimezone||arrival.timezone;
 const data=createFlightSchema.parse({departure:{iata:departure.iata,icao:departure.icao,name:departure.name,lat:departure.lat,lon:departure.lon},arrival:{iata:arrival.iata,icao:arrival.icao,name:arrival.name,lat:arrival.lat,lon:arrival.lon},...(b.day?{departureLocal:b.day+'T'+(b.time||'00:00'),depTimezone:depZone,...(!b.time?{depTimeSemantics:'DATE_ONLY'}:{})}:{}),...(b.arrivalDay?{arrivalLocal:b.arrivalDay+'T'+(b.arrivalTime||'00:00'),arrTimezone:arrZone,...(!b.arrivalTime?{arrTimeSemantics:'DATE_ONLY'}:{})}:{}),flightNumber:typeof b.details.flightNumber==='string'?b.details.flightNumber:undefined,airline:b.provider||undefined,bookingReference:b.reference||undefined,companions:[],price:b.amount??undefined,currency:b.currency,status:'historical',dataSource:'manual',notes:item.note});
 const flight=await buildFlightCreateData(data,{mode:'import',userId,externalRef:'travplan:'+item.id,importBatchId:null,enriched:{departure,arrival},companionNames:[],fx,tripId});
 if((flight.departureTime instanceof Date&&flight.departureTime>new Date())||(flight.arrivalTime instanceof Date&&flight.arrivalTime>new Date()))throw new AppError('Future travel cannot be confirmed',400,'PLAN_EXECUTION_FUTURE');
 return {flight,fx};
}
async function actualBooking(tx:PlanTransaction,userId:string,tripId:string,b:PlanBooking,fx:FxColumns){
 if(b.actualBookingId){const existing=await tx.booking.findFirst({where:{id:b.actualBookingId,userId,tripId}});if(!existing)throw refused();return existing}
 const created=await tx.booking.create({data:{userId,tripId,pnr:b.reference,price:b.amount,currency:b.currency,operator:b.provider||null,...fx}});b.actualBookingId=created.id;return created;
}
async function withdrawBooking(tx:PlanTransaction,userId:string,tripId:string,b:PlanBooking|undefined,version:string|undefined){
 if(!b?.actualBookingId)return;const row=await tx.booking.findFirst({where:{id:b.actualBookingId,userId,tripId}});if(!row){b.actualBookingId=null;return}
 if(version&&row.updatedAt.toISOString()!==version)throw refused();
 const counts=await Promise.all([tx.flight.count({where:{bookingId:row.id}}),tx.lodgingStay.count({where:{bookingId:row.id}}),tx.cruise.count({where:{bookingId:row.id}}),tx.railJourney.count({where:{bookingId:row.id}}),tx.busJourney.count({where:{bookingId:row.id}}),tx.ferryJourney.count({where:{bookingId:row.id}})]);
 if(counts.every(n=>n===0)){await tx.booking.delete({where:{id:row.id}});b.actualBookingId=null}
}
export async function synchronizeExecution(tx:PlanTransaction,userId:string,tripId:string,before:PlanState,next:PlanState,prepared:Map<string,PreparedExecution>){
 for(const item of next.items){if(item.source?.kind.startsWith("linkedActual:"))continue;const old=before.items.find(i=>i.id===item.id);if(old?.execution===item.execution)continue;
  const b=next.bookings.find(x=>x.id===item.bookingId),ready=prepared.get(item.id);
  if(item.execution==='confirmed'){
   if(['activity','free','transfer'].includes(item.kind)){
    if(!item.day)throw new AppError('An actual date is required',400,'PLAN_EXECUTION_DATE');if(item.day>new Date().toISOString().slice(0,10))throw new AppError('Future experiences cannot be confirmed',400,'PLAN_EXECUTION_FUTURE');
    const date=new Date(item.day+'T00:00:00Z'),journal=await tx.tripJournalEntry.create({data:{tripId,date,day:date,title:item.title,body:item.note||item.title}});item.source={kind:'planJournal',id:journal.id,version:journal.updatedAt.toISOString()};
   }else if(item.kind==='flight'&&ready?.flight&&ready.fx&&b){
    const booking=await actualBooking(tx,userId,tripId,b,ready.fx),created=await tx.flight.create({data:{...ready.flight,bookingId:booking.id}});item.source={kind:'planFlight',id:created.id,version:created.updatedAt.toISOString(),bookingVersion:booking.updatedAt.toISOString()};
   }else if(item.kind==='hotel'&&ready?.fx&&b){
    const detail=b.details.lodging&&typeof b.details.lodging==='object'?b.details.lodging as Record<string,unknown>:b.details;
    let lodging=await tx.lodging.findFirst({where:{userId,name:b.title,city:typeof detail.city==='string'?detail.city:null}}),createdAux=false;
    if(!lodging){lodging=await tx.lodging.create({data:{userId,name:b.title,city:typeof detail.city==='string'?detail.city:null,country:typeof detail.country==='string'?detail.country:null,isoCountryCode:typeof detail.country==='string'?resolveCountryCode(detail.country):null,address:typeof detail.address==='string'?detail.address:null,visited:true}});createdAux=true}
    const booking=await actualBooking(tx,userId,tripId,b,ready.fx),created=await tx.lodgingStay.create({data:{userId,tripId,lodgingId:lodging.id,bookingId:booking.id,checkIn:b.day?new Date(b.day+'T00:00:00Z'):null,checkOut:b.endDay?new Date(b.endDay+'T00:00:00Z'):null,checkInDate:b.day?new Date(b.day+'T00:00:00Z'):null,checkOutDate:b.endDay?new Date(b.endDay+'T00:00:00Z'):null,datePrecision:b.day?'DAY':'NONE',status:'completed',bookingReference:b.reference,totalPrice:b.amount,currency:b.currency,totalPriceBase:ready.fx.priceBase,fxRate:ready.fx.fxRate,fxRateDate:ready.fx.fxRateDate,fxBaseCurrency:ready.fx.fxBaseCurrency,fxSource:ready.fx.fxSource,dataSource:'manual',externalRef:'travplan:'+item.id}});
    item.source={kind:'planHotel',id:created.id,version:created.updatedAt.toISOString(),bookingVersion:booking.updatedAt.toISOString(),auxId:lodging.id,auxVersion:lodging.updatedAt.toISOString(),createdAux};
   }else throw new AppError('Link an actual transport record first',400,'PLAN_EXECUTION_LINK');
  }else if(old?.source?.kind==='planJournal'){
   const journal=await tx.tripJournalEntry.findFirst({where:{id:old.source.id,tripId},include:{photos:true}});if(journal&&(journal.updatedAt.toISOString()!==old.source.version||journal.photos.length))throw refused();await tx.tripJournalEntry.deleteMany({where:{id:old.source.id,tripId}});item.source=null;
  }else if(old?.source?.kind==='planFlight'){
   const flight=await tx.flight.findFirst({where:{id:old.source.id,userId}});if(flight&&(flight.tripId!==tripId||flight.updatedAt.toISOString()!==old.source.version))throw refused();await tx.flight.deleteMany({where:{id:old.source.id,userId,tripId}});item.source=null;
   const booking=next.bookings.find(x=>x.id===old.bookingId);if(booking&&!booking.actualBookingId)booking.actualBookingId=before.bookings.find(x=>x.id===old.bookingId)?.actualBookingId??null;await withdrawBooking(tx,userId,tripId,booking,old.source.bookingVersion);
  }else if(old?.source?.kind==='planHotel'){
   const stay=await tx.lodgingStay.findFirst({where:{id:old.source.id,userId}});if(stay&&(stay.tripId!==tripId||stay.updatedAt.toISOString()!==old.source.version))throw refused();await tx.lodgingStay.deleteMany({where:{id:old.source.id,userId,tripId}});item.source=null;
   if(old.source.createdAux&&old.source.auxId&&await tx.lodgingStay.count({where:{lodgingId:old.source.auxId}})===0){const lodging=await tx.lodging.findFirst({where:{id:old.source.auxId,userId},include:{photos:true}});if(lodging&&(lodging.updatedAt.toISOString()!==old.source.auxVersion||lodging.photos.length))throw refused();await tx.lodging.deleteMany({where:{id:old.source.auxId,userId}})}
   const booking=next.bookings.find(x=>x.id===old.bookingId);if(booking&&!booking.actualBookingId)booking.actualBookingId=before.bookings.find(x=>x.id===old.bookingId)?.actualBookingId??null;await withdrawBooking(tx,userId,tripId,booking,old.source.bookingVersion);
  }
 }
}
