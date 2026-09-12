export interface VideoFailureExplanation { title: string; reason: string; action: string; editPrompt?: boolean }
/** Explain provider failures without inventing a flagged word or promising a retry is safe. */
export function explainVideoFailure(raw: string, state?: string, downloadRetryable = false): VideoFailureExplanation {
  if(downloadRetryable)return {title:'视频下载尚未完成',reason:'平台已有生成结果，但保存到本地时遇到了问题。',action:'点击“重试下载”继续获取原视频，无需重新生成。'};
  if(state==='需人工核对'||/提交结果不确定|提交结果待确认|RECONCILIATION_REQUIRED/i.test(raw))return {title:'视频提交结果暂时无法确认',reason:'系统尚未确认平台是否已接收任务。',action:'先刷新任务状态；不要连续提交，以免重复生成。仍未恢复时，可提供技术详情协助排查。'};
  if(/InputTextSensitiveContentDetected/i.test(raw))return {title:'提示词未通过平台内容审核',reason:'平台拒绝了输入文字，但没有指出具体词句。content[0] 指整段文字提示词，不是图片1或第1个分镜。',action:'请检查并调整提示词中不适合生成的内容，保存后再试。如认为是误判，可使用技术详情中的请求编号联系平台。',editPrompt:true};
  if(/Input(?:Image|Video|Audio)SensitiveContentDetected/i.test(raw))return {title:'参考素材未通过平台内容审核',reason:'平台拒绝了输入的图片、视频或音频；当前错误未必能定位到具体哪一项。',action:'请检查参考素材并移除或替换不适合的内容，再重新提交。'};
  if(/Output.*SensitiveContentDetected|OutputContentFiltered/i.test(raw))return {title:'生成结果未通过平台内容审核',reason:'平台对生成结果进行了拦截，本次没有可使用的视频。',action:'请检查提示词和参考素材，调整内容后再试；相同输入再次提交仍可能失败。',editPrompt:true};
  if(/Insufficient(?:Balance|Quota|Funds)|余额不足|欠费|预占额度/i.test(raw))return {title:'平台可用额度不足',reason:'模型平台返回余额或可用额度不足。',action:'请到对应平台核对余额、预占金额或套餐额度，补足后再试。'};
  if(/HTTP\s*(401|403)\b|InvalidApiKey|AuthenticationError|Unauthorized|AccessDenied/i.test(raw))return {title:'模型接口的密钥或权限需要检查',reason:'平台未允许当前账号调用该接口。',action:'请在模型服务中核对 API 密钥、请求地址，以及该模型是否已开通权限。'};
  if(/HTTP\s*429\b|RateLimit|TooManyRequests/i.test(raw))return {title:'模型平台暂时限制了请求量',reason:'当前请求触发了平台的频率或并发限制。',action:'稍后再试，或减少同时生成的片段数量。'};
  if(/InvalidParameter|invalid_parameter|UNSUPPORTED_VIDEO_SETTINGS/i.test(raw))return {title:'生成参数不符合模型要求',reason:'平台拒绝了本次生成参数。',action:'请核对当前模型支持的时长、分辨率、生成方式和参考素材。技术详情保留平台返回的具体参数信息。'};
  if(/HTTP\s*5\d\d\b/.test(raw))return {title:'模型平台暂时服务异常',reason:'模型平台返回了服务错误。',action:'先刷新任务状态，确认失败后再重试；如果持续发生，请提供技术详情排查。'};
  return {title:'本次视频处理未完成',reason:'暂时无法从平台返回的信息确定具体原因。',action:'请展开技术详情查看原始错误；可将详情提供给管理员排查。先核对任务状态，避免重复提交。'};
}
