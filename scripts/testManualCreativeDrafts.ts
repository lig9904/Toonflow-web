import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverManualDraft,acceptGeneratedSaved} from '../src/utils/manualDraftState.ts';
test('restoring a local draft preserves its original base version instead of rebasing onto a newer AI save',()=>{
 const restored=recoverManualDraft({value:'new AI saved',meta:{version:9}}, {draft:'human draft',baseline:'old saved',meta:{version:3}});
 assert.deepEqual(restored,{draft:'human draft',baseline:'old saved',meta:{version:3}});
});
test('typing in a cloned form never changes the saved source consumed by the application',()=>{
 const server={value:{name:'role',prompt:'saved prompt'},meta:{version:2}};
 const state=recoverManualDraft(server);state.draft.prompt='human draft';
 assert.equal(server.value.prompt,'saved prompt');assert.equal(state.baseline.prompt,'saved prompt');
});
test('AI result arriving while dirty leaves human content and base metadata intact',()=>{
 const state={draft:'new human words',baseline:'old saved',meta:{version:2}};
 const next=acceptGeneratedSaved(state,{value:'late AI result',meta:{version:3}});
 assert.equal(next.draft,'new human words');assert.equal(next.meta.version,2);assert.equal(next.baseline,'old saved');
});
test('a clean editor follows the newly saved AI result',()=>{
 const next=acceptGeneratedSaved({draft:'old',baseline:'old',meta:{version:2}},{value:'AI saved',meta:{version:3}});
 assert.deepEqual(next,{draft:'AI saved',baseline:'AI saved',meta:{version:3}});
});

test('discard after an AI save adopts latest saved text and version instead of the original baseline',async()=>{
 const {discardManualDraft}=await import('../src/utils/manualDraftState.ts');
 const original={draft:'human edit',baseline:'old saved',meta:{version:2}};
 const ai={value:'new AI saved',meta:{version:3}};
 const dirty=acceptGeneratedSaved(original,ai);assert.equal(dirty.meta.version,2);
 const discarded=discardManualDraft(dirty,ai);
 assert.deepEqual(discarded,{draft:'new AI saved',baseline:'new AI saved',meta:{version:3}});
});

test('late save receipt after switching scope cannot invoke the saved-state callback',async()=>{
 const {sameCreativeDraftScope}=await import('../src/utils/manualDraftState.ts');
 const captured={sequence:1,id:'script:11',scope:'project:4:episode:11',userId:7};
 let current={...captured};let onSavedCalls=0;let resolve!:()=>void;
 const response=new Promise<void>(done=>{resolve=done;});
 const save=response.then(()=>{if(sameCreativeDraftScope(captured,current))onSavedCalls++;});
 current={sequence:2,id:'script:12',scope:'project:4:episode:12',userId:7};resolve();await save;assert.equal(onSavedCalls,0);
});
test('unmounted or changed-user editors reject late acknowledgements even when record id is unchanged',async()=>{
 const {sameCreativeDraftScope}=await import('../src/utils/manualDraftState.ts');
 const captured={sequence:3,id:'asset:8',scope:'project:4',userId:7};
 assert.equal(sameCreativeDraftScope(captured,{...captured,disposed:true}),false);
 assert.equal(sameCreativeDraftScope(captured,{...captured,userId:9}),false);
 assert.equal(sameCreativeDraftScope(captured,{...captured,sequence:4}),false);
});
