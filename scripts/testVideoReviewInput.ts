import test from 'node:test';import assert from 'node:assert/strict';import {isResolvedReviewInput} from '../src/utils/videoReviewInput.ts';
test('missing mode never poisons job-state polling while resolved inputs remain reviewable',()=>{
 assert.equal(isResolvedReviewInput({model:'test:model',resolvedMode:null,generation:{duration:4}}),false);
 assert.equal(isResolvedReviewInput({model:'test:model',resolvedMode:undefined}),false);
 assert.equal(isResolvedReviewInput({model:'test:model',resolvedMode:[],generation:{duration:4}}),false);
 assert.equal(isResolvedReviewInput({model:'test:model',resolvedMode:'text',generation:{duration:NaN}}),false);
 assert.equal(isResolvedReviewInput({model:'test:model',resolvedMode:['imageReference:9','audioReference:3'],generation:{duration:4}}),true);
 assert.equal(isResolvedReviewInput({model:'test:model',mode:'singleImage'}),true);
});

test("an empty model never poisons job status polling",()=>{for(const model of [undefined,null,""," "]){assert.equal(isResolvedReviewInput({model,mode:"text",generation:{duration:4}}),false)}});
