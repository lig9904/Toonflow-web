import test from 'node:test';
import assert from 'node:assert/strict';
import { canGenerateStoryboardPrompt, shouldNotifyPromptFailure } from '../src/views/production/components/workbench/generate/utils/trackCards.ts';
test('blank custom tracks and image references without a source storyboard cannot request storyboard prompts',()=>{
 assert.equal(canGenerateStoryboardPrompt({id:55,cardKind:'custom',storyboardIds:[],storyboardCount:0,deleteAction:'deleteTrack'},[]),false);
 assert.equal(canGenerateStoryboardPrompt({id:72,cardKind:'storyboard',storyboardIds:[23],storyboardCount:1},[{id:23,index:2}]),true);
 assert.equal(canGenerateStoryboardPrompt({id:72,cardKind:'storyboard',storyboardIds:[23],storyboardCount:1},[]),false);
});
test('loading an old failure must never announce the current successful shot as failed',()=>{
 assert.equal(shouldNotifyPromptFailure({state:'生成失败',previousState:'未生成',jobId:'old-T55'}),false);
 assert.equal(shouldNotifyPromptFailure({state:'生成失败',jobId:'old-T55',submitted:true,ownedJobId:'new-S03'}),false);
});
test('only a matching newly failed task emits one attributed notification',()=>{
 assert.equal(shouldNotifyPromptFailure({state:'生成失败',previousState:'生成中',jobId:'new',submitted:true,ownedJobId:'new'}),true);
 assert.equal(shouldNotifyPromptFailure({state:'生成失败',previousState:'生成失败',previousJobId:'new',jobId:'new',submitted:true,ownedJobId:'new'}),false);
 assert.equal(shouldNotifyPromptFailure({state:'已完成',previousState:'生成中',jobId:'new',submitted:true,ownedJobId:'new'}),false);
});
