import { AsyncLocalStorage } from 'node:async_hooks';
import { isLocalLlmHost } from './llmEndpoint';
export type LlmRequestPolicy='disabled'|'local_only'|'cloud_allowed';
const policy=new AsyncLocalStorage<LlmRequestPolicy>();
/** A request's policy cannot leak to another concurrent parse or proposal. */
export function withLlmRequestPolicy<T>(value:LlmRequestPolicy,run:()=>T):T{return policy.run(value,run)}
export function permitsLlmTarget(target:{url:string;isCloud?:boolean}):boolean{
 const current=policy.getStore();if(!current||current==='cloud_allowed')return true;if(current==='disabled')return false;
 try{return !(target.isCloud??!isLocalLlmHost(new URL(target.url).hostname))}catch{return false}
}
