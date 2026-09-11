import test from 'node:test';
import assert from 'node:assert/strict';
import {requiresThinking,updateTextModel} from '../src/utils/textModelCapabilities.ts';
test('required thinking is immutable while editing labels preserves model limits and metadata',()=>{
 const model={name:'GLM',modelName:'glm-5-3-flash',type:'text' as const,think:true,thinkingMode:'required' as const,maxOutputTokens:128000,contextWindow:1000000,vendor:'glm'};
 const changed=updateTextModel(model,{name:'New label',modelName:model.modelName,think:false});
 assert.equal(requiresThinking(changed),true);assert.equal(changed.think,true);assert.equal(changed.name,'New label');assert.equal(changed.maxOutputTokens,128000);assert.equal(changed.contextWindow,1000000);
});
test('optional thinking stays configurable and another model does not inherit required metadata',()=>{
 const model={name:'Optional',modelName:'optional',type:'text' as const,think:true,thinkingMode:'optional' as const};
 assert.equal(updateTextModel(model,{name:'Optional',modelName:'optional',think:false}).think,false);
 const other=updateTextModel({...model,thinkingMode:'required'},{name:'Custom',modelName:'custom',think:false});
 assert.equal(other.thinkingMode,undefined);assert.equal(other.think,false);
});
