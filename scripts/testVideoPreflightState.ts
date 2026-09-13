import test from 'node:test';import assert from 'node:assert/strict';
import {preflightInputKey,acceptPreflightResponse} from '../src/utils/videoPreflightState.ts';
test('approval/idempotency are not creative input; reordered refs and changed prompt are different',()=>{const a={prompt:'p',references:[{id:1},{id:2}],duration:4};assert.equal(preflightInputKey(a),preflightInputKey({...a,acknowledgement:'x',idempotencyKey:'y'}));assert.notEqual(preflightInputKey(a),preflightInputKey({...a,prompt:'new'}));assert.notEqual(preflightInputKey(a),preflightInputKey({...a,references:[{id:2},{id:1}]}));});
test('late preflight results never overwrite another scope or newer inspection',()=>{assert.equal(acceptPreflightResponse('a','b',1,1),false);assert.equal(acceptPreflightResponse('a','a',1,2),false);assert.equal(acceptPreflightResponse('a','a',1,1,true),false);assert.equal(acceptPreflightResponse('a','a',1,1),true);});

import {summarizeVideoPreflight} from '../src/utils/videoPreflightState.ts';
test('one blocked shot in an 18-shot batch is shown first; the other 17 remain explicitly selectable',()=>{
 const reports=Array.from({length:18},(_,index)=>({preflight:{trackId:128+index,shotLabel:`S${String(index+1).padStart(2,'0')}`,canSubmit:index!==11}}));
 const summary=summarizeVideoPreflight(reports);
 assert.equal(summary.ordered[0].preflight.shotLabel,'S12');
 assert.equal(summary.passedIds.length,17);assert.ok(!summary.passedIds.includes(139));
 assert.match(summary.message,/批量生成未开始.*S12.*未提交任何视频/);
 assert.equal(reports[0].preflight.shotLabel,'S01');
});
test('all clear, all blocked, and a single blocked shot have truthful batch outcomes',()=>{
 const row=(id:number,canSubmit:boolean)=>({preflight:{trackId:id,shotLabel:`S${id}`,canSubmit}});
 assert.equal(summarizeVideoPreflight([row(1,true),row(2,true)]).message,'');
 assert.deepEqual(summarizeVideoPreflight([row(1,false),row(2,false)]).passedIds,[]);
 assert.match(summarizeVideoPreflight([row(1,false)]).message,/^视频未提交/);
 assert.deepEqual(summarizeVideoPreflight([]).ordered,[]);
});
