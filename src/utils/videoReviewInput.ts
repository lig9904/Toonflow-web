/** Invalid mode metadata must not prevent polling the durable job status. */
export function isResolvedReviewInput(input:{model?:unknown;resolvedMode?:unknown;mode?:unknown;generation?:{duration?:unknown}}):boolean{
 const mode=input.resolvedMode ?? input.mode;
 const duration=input.generation?.duration;
 return typeof input.model==='string' && input.model.trim().length>0 && (typeof mode==='string' && mode.length>0 || Array.isArray(mode) && mode.length>0) && (duration===undefined || typeof duration==='number' && Number.isFinite(duration) && duration>0);
}
