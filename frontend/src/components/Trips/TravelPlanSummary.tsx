import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../../hooks/useTranslation';
import { travplanApi,type PlanView } from '../../lib/api/travplan';
export function TravelPlanSummary({tripId}:{tripId:string}){
 const {t}=useTranslation('travplan'),[plan,setPlan]=useState<PlanView|null>(null);
 useEffect(()=>{let live=true;travplanApi.get(tripId).then(p=>{if(live)setPlan(p)}).catch(()=>{});return()=>{live=false}},[tripId]);
 if(!plan)return null;
 return <section style={{padding:20,border:'1px solid var(--ts-border)',borderRadius:18,margin:'20px 0',background:'var(--ts-tile)'}}><h2 style={{fontSize:20,color:'#7cb8ff'}}>TravPlan · {t(plan.state.status==='ready'?'readyStatus':'planningStatus')}</h2><p>{plan.state.destination} · {plan.state.startDay} – {plan.state.endDay}</p><p style={{color:'var(--ts-muted)',margin:'10px 0'}}>{t('noAutoCount')}</p><Link to={'/plan/'+tripId+'/overview'} style={{color:'#7cb8ff'}}>{t('continue')}</Link></section>;
}
