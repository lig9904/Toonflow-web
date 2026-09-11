import assert from 'node:assert/strict';
import test from 'node:test';
import {createTrustedBindingController, trustedScopeKey, trustedPreviewUrl, type TrustedBindingDraft, type TrustedBindingItem, type TrustedBindingSnapshot, type TrustedBindingWrite, type TrustedTargetScope} from '../src/components/trustedAssets/controller.ts';
const scope:TrustedTargetScope={projectId:6,scriptId:7,targetKind:'asset',targetId:11};
const item=(assetId:string):TrustedBindingItem=>({remoteProjectName:'default',groupType:'AIGC',groupId:'group-a',assetId,assetType:'Image'});
const snapshot=(target=scope,version=0,items:TrustedBindingItem[]=[]):TrustedBindingSnapshot=>({...target,version,sourceVersion:4,sourceFileHash:'a'.repeat(64),currentSourceVersion:4,currentSourceFileHash:'a'.repeat(64),sourceCurrent:true,items});
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(error:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function harness(write:(input:TrustedBindingWrite)=>Promise<TrustedBindingSnapshot>,read=async(target:TrustedTargetScope)=>snapshot(target)) {const states:Record<string,TrustedBindingDraft>={};let id=0;const controller=createTrustedBindingController({states,write,read,makeId:()=>`trusted-test-${++id}`});return {states,controller};}
test('selection replaces instead of merges; serial autosave keeps the latest selection with CAS and source fingerprint',async()=>{
 const first=deferred<TrustedBindingSnapshot>();const calls:TrustedBindingWrite[]=[];
 const {controller}=harness(async input=>{calls.push(input);return calls.length===1?first.promise:snapshot(scope,2,input.items);});
 await controller.load(scope);controller.toggle(scope,item('remote-a'));controller.toggle(scope,item('remote-b'));
 assert.equal(calls.length,1);assert.equal(calls[0].expectedVersion,0);assert.equal(calls[0].expectedSourceVersion,4);assert.equal(calls[0].expectedSourceFileHash,'a'.repeat(64));
 first.resolve(snapshot(scope,1,[item('remote-a')]));await tick();await controller.save(scope);
 assert.equal(calls.length,2);assert.equal(calls[1].expectedVersion,1);assert.deepEqual(calls[1].items,[item('remote-b')]);assert.deepEqual(controller.state(scope).desired,[item('remote-b')]);
});
test('late responses from an old project/target only update their own cached state',async()=>{
 const old=deferred<TrustedBindingSnapshot>();const next={...scope,projectId:8,targetId:33};
 const {states,controller}=harness(async input=>snapshot(input,1,input.items),async target=>target.projectId===6?old.promise:snapshot(target,9,[item('new-scope')]));
 const loading=controller.load(scope);await controller.load(next);old.resolve(snapshot(scope,2,[item('old-scope')]));await loading;
 assert.deepEqual(states[trustedScopeKey(next)].desired,[item('new-scope')]);assert.equal(states[trustedScopeKey(next)].snapshot?.version,9);
});
test('409 preserves intended binding until explicit fresh-server or keep-selection resolution',async()=>{
 let fail=true;const calls:TrustedBindingWrite[]=[];let reads=0;
 const {controller}=harness(async input=>{calls.push(input);if(fail)throw {status:409,code:'VERSION_CONFLICT',message:'changed'};return snapshot(scope,10,input.items);},async target=>snapshot(target,reads++?9:0,[item('server')]));
 await controller.load(scope);controller.toggle(scope,item('wanted'));await tick();assert.equal(controller.state(scope).status,'conflict');assert.deepEqual(controller.state(scope).desired,[item('wanted')]);
 await controller.save(scope);assert.equal(calls.length,1);fail=false;await controller.load(scope,'keep');assert.equal(calls[1].expectedVersion,9);assert.deepEqual(calls[1].items,[item('wanted')]);
});
test('uncertain save retries the same idempotency key and body before subsequent selection',async()=>{
 const calls:TrustedBindingWrite[]=[];const {controller}=harness(async input=>{calls.push(structuredClone(input));if(calls.length===1)throw new Error('timeout after possible success');return snapshot(scope,calls.length,input.items);});
 await controller.load(scope);controller.toggle(scope,item('a'));await tick();assert.equal(controller.state(scope).status,'error');
 controller.toggle(scope,item('b'));await tick();await controller.save(scope);assert.deepEqual(calls[1],calls[0]);assert.deepEqual(calls[2].items,[item('b')]);assert.notEqual(calls[2].idempotencyKey,calls[0].idempotencyKey);
});
test('source change prevents casual reuse; explicit rebind sends fresh current source version/hash',async()=>{
 const calls:TrustedBindingWrite[]=[];const changed={...snapshot(scope,3,[item('a')]),sourceCurrent:false,currentSourceVersion:9,currentSourceFileHash:'b'.repeat(64)};
 const {controller}=harness(async input=>{calls.push(input);return {...changed,version:4,sourceCurrent:true,items:input.items};},async()=>changed);
 await controller.load(scope);controller.toggle(scope,item('b'));assert.equal(calls.length,0);await controller.load(scope,'keep');assert.equal(calls.length,1);assert.equal(calls[0].expectedSourceVersion,9);assert.equal(calls[0].expectedSourceFileHash,'b'.repeat(64));
});
test('remove writes an empty binding set and unsafe preview schemes never enter media elements',async()=>{
 const calls:TrustedBindingWrite[]=[];const {controller}=harness(async input=>{calls.push(input);return snapshot(scope,2,input.items);},async()=>snapshot(scope,1,[item('a')]));
 await controller.load(scope);controller.remove(scope,item('a'));await tick();assert.deepEqual(calls[0].items,[]);
 assert.equal(trustedPreviewUrl('javascript:alert(1)'),'');assert.equal(trustedPreviewUrl('file:///etc/passwd'),'');assert.equal(trustedPreviewUrl('asset://remote-a'),'');assert.equal(trustedPreviewUrl('https://example.test/a.png'),'https://example.test/a.png');
});
