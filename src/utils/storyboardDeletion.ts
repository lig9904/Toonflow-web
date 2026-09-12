export interface CanvasDeleteItem {scriptId:number;storyboardId:number;trackId:number|null;expectedTrackVersion:number|null;expectedStoryboardVersion:number}
const positive=(value:unknown)=>typeof value==='number' && Number.isSafeInteger(value) && value>0;
const version=(value:unknown)=>typeof value==='number' && Number.isSafeInteger(value) && value>=0;
/** The confirmation owns an immutable dual-CAS target snapshot, never live checkbox/index state. */
export function captureCanvasDeletion(projectId:number,scriptId:number,selectedIds:readonly number[],rows:readonly any[]):ReadonlyArray<Readonly<CanvasDeleteItem>> {
 if(!positive(projectId)||!positive(scriptId)||!selectedIds.length)throw new Error('删除范围无效');
 const ids=[...new Set(selectedIds)];if(ids.some(id=>!positive(id)))throw new Error('分镜标识无效');
 return Object.freeze(ids.map(storyboardId=>{
  const row=rows.find(item=>Number(item.id)===storyboardId);if(!row)throw new Error(`分镜 ${storyboardId} 已变化，请刷新`);
  if(row.collaboration?.locked)throw new Error(`分镜 ${storyboardId} 已锁定，不能删除`);
  if(row.collaboration?.projectId!=null && Number(row.collaboration.projectId)!==projectId)throw new Error('分镜不属于当前项目');
  const trackId=row.trackId==null?null:Number(row.trackId),expectedTrackVersion=trackId==null?null:row.trackVersion,expectedStoryboardVersion=row.collaboration?.version;
  if(!version(expectedStoryboardVersion)||trackId!=null && (!positive(trackId)||!version(expectedTrackVersion)))throw new Error('分镜或片段版本未完整读取，暂不删除');
  return Object.freeze({scriptId,storyboardId,trackId,expectedTrackVersion,expectedStoryboardVersion});
 }));
}
