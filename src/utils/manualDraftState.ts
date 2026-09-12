export interface ManualDraftState<T,M> {draft:T;baseline:T;meta:M}
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
export function recoverManualDraft<T,M>(server:{value:T;meta:M},cached?:ManualDraftState<T,M>|null):ManualDraftState<T,M>{
 return cached ? copy(cached) : {draft:copy(server.value),baseline:copy(server.value),meta:copy(server.meta)};
}
export function acceptGeneratedSaved<T,M>(state:ManualDraftState<T,M>,saved:{value:T;meta:M}):ManualDraftState<T,M>{
 if(JSON.stringify(state.draft)!==JSON.stringify(state.baseline))return state;
 return recoverManualDraft(saved);
}
export function discardManualDraft<T,M>(state:ManualDraftState<T,M>,latest?:{value:T;meta:M}):ManualDraftState<T,M>{
 return latest ? recoverManualDraft(latest) : {draft:copy(state.baseline),baseline:copy(state.baseline),meta:copy(state.meta)};
}
export interface CreativeDraftScope {sequence:number;id:string;scope:string;userId?:number;disposed?:boolean}
export function sameCreativeDraftScope(captured:CreativeDraftScope,current:CreativeDraftScope):boolean {
 return !current.disposed && captured.sequence===current.sequence && captured.id===current.id && captured.scope===current.scope && captured.userId===current.userId;
}
