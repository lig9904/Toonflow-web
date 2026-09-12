import test from 'node:test';import assert from 'node:assert/strict';import {isResolvedReviewInput} from '../src/utils/videoReviewInput.ts';
test('missing mode never poisons job-state polling while resolved inputs remain reviewable',()=>{
 assert.equal(isResolvedReviewInput({resolvedMode:null,generation:{duration:4}}),false);
 assert.equal(isResolvedReviewInput({resolvedMode:undefined}),false);
 assert.equal(isResolvedReviewInput({resolvedMode:[],generation:{duration:4}}),false);
 assert.equal(isResolvedReviewInput({resolvedMode:'text',generation:{duration:NaN}}),false);
 assert.equal(isResolvedReviewInput({resolvedMode:['imageReference:9','audioReference:3'],generation:{duration:4}}),true);
 assert.equal(isResolvedReviewInput({mode:'singleImage'}),true);
});
