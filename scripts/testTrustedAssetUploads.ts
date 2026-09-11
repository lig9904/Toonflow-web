import assert from 'node:assert/strict';
import test from 'node:test';
import {createDurableOperationController, type DurableOperationState} from '../src/components/trustedAssets/durableOperation.ts';
type Input={projectId:number;targetId:number;groupId:string;expectedSourceVersion:number;expectedSourceFileHash:string;bindOnSuccess:boolean};
type Receipt={id:string;status:string};
const input:Input={projectId:6,targetId:11,groupId:'aigc-group',expectedSourceVersion:3,expectedSourceFileHash:'a'.repeat(64),bindOnSuccess:true};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
test('timeout recovery and duplicate clicks only query the same upload receipt, never repeat the mutation',async()=>{
 const states:Record<string,DurableOperationState<Input,Receipt>>={};let starts=0;const keys:string[]=[];
 const controller=createDurableOperationController({states,makeId:()=> 'stable-upload-id',isTerminal:(receipt:Receipt)=>receipt.status==='active',start:async()=>{starts++;throw new Error('response timeout');},read:async(_input:Input,lookup)=>{keys.push(lookup.idempotencyKey);return {id:'task-a',status:'processing'};}});
 await controller.begin('scope-a',input);assert.equal(states['scope-a'].phase,'uncertain');
 await controller.begin('scope-a',input);await controller.refresh('scope-a');assert.equal(starts,1);assert.deepEqual(keys,['stable-upload-id','stable-upload-id']);assert.equal(states['scope-a'].phase,'tracking');
});
test('in-flight first submission is coalesced and receipt completion cannot replace another scope',async()=>{
 const waiting=deferred<Receipt>();const states:Record<string,DurableOperationState<Input,Receipt>>={};let starts=0;
 const controller=createDurableOperationController({states,makeId:()=>`id-${starts}`,isTerminal:(r:Receipt)=>r.status==='active',start:async(current:Input)=>{starts++;return current.projectId===6?waiting.promise:{id:'other-task',status:'active'};},read:async()=>({id:'read',status:'processing'})});
 const first=controller.begin('scope-a',input);const duplicate=controller.begin('scope-a',input);await controller.begin('scope-b',{...input,projectId:7});waiting.resolve({id:'original-task',status:'processing'});await Promise.all([first,duplicate]);
 assert.equal(starts,2);assert.equal(states['scope-b'].receipt?.id,'other-task');assert.equal(states['scope-b'].phase,'terminal');assert.equal(states['scope-a'].phase,'tracking');
});
test('reopening adopts a durable task and processing never counts as upload-and-bind success',async()=>{
 const states:Record<string,DurableOperationState<Input,Receipt>>={};let starts=0;
 const controller=createDurableOperationController({states,isTerminal:(r:Receipt)=>r.status==='bound',start:async()=>{starts++;return {id:'wrong',status:'bound'};},read:async()=>({id:'saved-task',status:'bound'})});
 controller.adopt('scope-a',input,'saved-key',{id:'saved-task',status:'processing'});assert.equal(states['scope-a'].phase,'tracking');
 await controller.begin('scope-a',input);assert.equal(starts,0);assert.equal(states['scope-a'].receipt?.id,'saved-task');assert.equal(states['scope-a'].phase,'terminal');
});

test('Active alone is not upload-and-bind completion; bind conflicts remain explicit',async()=>{
 const {uploadTerminal,uploadReceiptLabel}=await import('../src/components/trustedAssets/uploadTypes.ts');
 const base={operationId:'task',idempotencyKey:'key',projectId:6,targetKind:'asset' as const,targetId:11,remoteProjectName:'default',groupId:'aigc',assetType:'Image' as const,mode:'uploadAndBind' as const,expectedBindingVersion:2,status:'active' as const,remoteAssetId:'remote',remoteName:'asset',remoteStatus:'Active' as const,bindStatus:'pending' as const,sourceVersion:3,sourceFileHash:'a'.repeat(64),error:null,createdAt:1,updatedAt:2};
 assert.equal(uploadTerminal(base),false);assert.match(uploadReceiptLabel(base),/正在保存绑定/);
 const conflict={...base,bindStatus:'conflict' as const};assert.equal(uploadTerminal(conflict),true);assert.match(uploadReceiptLabel(conflict),/冲突/);assert.doesNotMatch(uploadReceiptLabel(conflict),/已保存/);
 assert.match(uploadReceiptLabel({...base,bindStatus:'bound'}),/绑定已保存/);
 assert.doesNotMatch(uploadReceiptLabel({...base,status:'unrecognized' as any}),/上传完成|绑定已保存/);
});

test('changing the requested group while acceptance is unknown never initiates another upload',async()=>{
 const states:Record<string,DurableOperationState<Input,Receipt>>={};let starts=0;let reads=0;
 const controller=createDurableOperationController({states,isTerminal:(r:Receipt)=>r.status==='active',start:async()=>{starts++;throw new Error('uncertain');},read:async()=>{reads++;throw new Error('receipt not yet found');}});
 await controller.begin('scope-a',input);await controller.begin('scope-a',{...input,groupId:'different-group'});assert.equal(starts,1);assert.equal(reads,1);assert.equal(states['scope-a'].input.groupId,'aigc-group');assert.equal(states['scope-a'].phase,'uncertain');
});
