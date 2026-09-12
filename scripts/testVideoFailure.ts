import test from 'node:test';
import assert from 'node:assert/strict';
import {explainVideoFailure as explain} from '../src/utils/videoFailure.ts';
test('input text moderation explains content index without claiming the flagged word',()=>{
 const result=explain("上游拒绝视频任务 HTTP 400 InputTextSensitiveContentDetected: input text 'content[0]' may contain sensitive information. Request id: example");
 assert.equal(result.title,'提示词未通过平台内容审核');assert.match(result.reason,/不是图片1/);assert.match(result.reason,/没有指出具体词句/);assert.equal(result.editPrompt,true);
});
test('reference and output moderation have different explanations',()=>{
 for(const medium of ['Image','Video','Audio'])assert.equal(explain(`Input${medium}SensitiveContentDetected`).title,'参考素材未通过平台内容审核');
 assert.equal(explain('OutputVideoSensitiveContentDetected').title,'生成结果未通过平台内容审核');
});
test('uncertain submission and existing download must not encourage regeneration',()=>{
 assert.match(explain('HTTP 500','需人工核对').action,/不要连续提交/);
 assert.match(explain('InputTextSensitiveContentDetected','需人工核对',true).action,/无需重新生成/);
});
test('known operational failures use actionable Chinese, unknown remains honest',()=>{
 for(const [raw,title] of [['InsufficientBalance','平台可用额度不足'],['HTTP 401','模型接口的密钥或权限需要检查'],['HTTP 429','模型平台暂时限制了请求量'],['InvalidParameter','生成参数不符合模型要求'],['HTTP 503','模型平台暂时服务异常'],['unexpected response','本次视频处理未完成']])assert.equal(explain(raw).title,title);
});
