export function preflightInputKey(value:unknown):string {
 const clean=(v:any):any=>Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!['idempotencyKey','acknowledgement'].includes(k)).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,clean(x)])):v;
 return JSON.stringify(clean(value));
}
export function acceptPreflightResponse(captured:string,current:string,sequence:number,currentSequence:number,disposed=false):boolean{return !disposed&&captured===current&&sequence===currentSequence;}
