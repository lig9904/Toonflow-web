export function preflightInputKey(value:unknown):string {
 const clean=(v:any):any=>Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!['idempotencyKey','acknowledgement'].includes(k)).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,clean(x)])):v;
 return JSON.stringify(clean(value));
}
export function acceptPreflightResponse(captured:string,current:string,sequence:number,currentSequence:number,disposed=false):boolean{return !disposed&&captured===current&&sequence===currentSequence;}

export function summarizeVideoPreflight<T extends {preflight:{trackId:number;shotLabel:string;canSubmit:boolean}}>(reports: readonly T[]) {
 const blocked=reports.filter(r=>!r.preflight.canSubmit);
 const passed=reports.filter(r=>r.preflight.canSubmit);
 const labels=blocked.map(r=>r.preflight.shotLabel);
 return {blocked,passed,passedIds:passed.map(r=>r.preflight.trackId),ordered:[...blocked,...passed],
  message:blocked.length ? `${reports.length>1?'批量生成未开始':'视频未提交'}：${labels.slice(0,4).join('、')}${labels.length>4?`等 ${labels.length} 个片段`:''}需要处理；本次未提交任何视频。` : ''};
}
