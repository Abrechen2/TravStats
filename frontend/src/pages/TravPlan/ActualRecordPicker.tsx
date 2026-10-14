import { useEffect, useState } from 'react';
import { tripsApi } from '../../lib/api';
import { useTranslation } from '../../hooks/useTranslation';
import type { PlanItem } from '../../lib/api/travplan';
const collections:Record<string,string>={flight:'flights',hotel:'lodgingStays',rail:'railJourneys',bus:'busJourneys',ferry:'ferryJourneys',cruise:'cruises',rental:'rentalBookings'};
export function ActualRecordPicker({tripId,item,onLink,busy}:{tripId:string;item:PlanItem;onLink:(id:string)=>void;busy:boolean}){
 const {t}=useTranslation('travplan'),[rows,setRows]=useState<{id:string;title:string}[]>([]),[selected,setSelected]=useState('');
 useEffect(()=>{let live=true;tripsApi.getById(tripId).then(data=>{const values=(data.trip as unknown as Record<string,unknown>)[collections[item.kind]];if(!Array.isArray(values))return;const options=values.flatMap((value:unknown)=>{if(!value||typeof value!=='object')return [];const row=value as Record<string,unknown>;if(typeof row.id!=='string'||!['flown','historical','completed','returned'].includes(String(row.status)))return[];const label=String(row.flightNumber||row.title||row.name||row.bookingReference||row.id);return[{id:row.id,title:label}]});if(live){setRows(options);setSelected(options[0]?.id||'')}}).catch(()=>{});return()=>{live=false}},[tripId,item.kind]);
 if(!collections[item.kind])return null;
 return <div className="tp-actions"><label>{t('linkActual')}<select className="tp-search" value={selected} onChange={e=>setSelected(e.target.value)}>{rows.map(row=><option value={row.id} key={row.id}>{row.title}</option>)}</select></label><button disabled={busy||!selected} onClick={()=>onLink(selected)}>{t('linkActual')}</button></div>;
}
