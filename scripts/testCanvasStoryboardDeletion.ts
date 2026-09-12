import test from 'node:test';
import assert from 'node:assert/strict';
import {captureCanvasDeletion} from '../src/utils/storyboardDeletion.ts';
const row=(id:number,trackId:number|null=30)=>({id,trackId,trackVersion:trackId==null?null:4,collaboration:{projectId:5,version:8,locked:false}});
test('confirmation snapshot retains ids and both original CAS versions after selection/source changes',()=>{
 const selected=[11,12];const rows=[row(11),row(12,31)];const frozen=captureCanvasDeletion(5,6,selected,rows);
 selected.splice(0,2,99);rows[0].trackVersion=20;rows[0].collaboration.version=21;
 assert.deepEqual(frozen.map(item=>item.storyboardId),[11,12]);assert.equal(frozen[0].expectedTrackVersion,4);assert.equal(frozen[0].expectedStoryboardVersion,8);assert.ok(Object.isFrozen(frozen));assert.ok(Object.isFrozen(frozen[0]));
});
test('orphan deletion explicitly carries null track CAS; a linked row missing track version cannot be deleted',()=>{
 assert.deepEqual(captureCanvasDeletion(5,6,[11],[row(11,null)])[0],{scriptId:6,storyboardId:11,trackId:null,expectedTrackVersion:null,expectedStoryboardVersion:8});
 assert.throws(()=>captureCanvasDeletion(5,6,[11],[{...row(11),trackVersion:null}]),/版本/);
 assert.throws(()=>captureCanvasDeletion(5,6,[11],[{...row(11),trackVersion:undefined}]),/版本/);
});
test('missing locked or cross-project targets reject the entire proposed batch',()=>{
 assert.throws(()=>captureCanvasDeletion(5,6,[11,12],[row(11)]),/已变化/);
 assert.throws(()=>captureCanvasDeletion(5,6,[11,12],[row(11),{...row(12),collaboration:{projectId:5,version:8,locked:true}}]),/锁定/);
 assert.throws(()=>captureCanvasDeletion(5,6,[11],[{...row(11),collaboration:{projectId:9,version:8,locked:false}}]),/项目/);
});
