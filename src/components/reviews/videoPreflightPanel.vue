<template>
  <section class="preflightPanel" aria-label="本地生成检查">
    <div class="header"><strong>本地生成检查</strong><span class="checkSummary">{{ reports.length ? `${reports.length} 个片段 · ${reports.filter(r => !r.preflight.canSubmit).length} 个本地阻断项` : '尚未检查' }}</span><t-button size="small" variant="text" :aria-expanded="expanded" @click="expanded=!expanded">{{ expanded ? '收起检查详情' : '展开检查详情' }}</t-button><t-button size="small" variant="outline" :loading="busy" :disabled="busy" @click="$emit('check')">重新检查当前输入</t-button></div>
    <p class="platformReviewNote">本地检查用于核对参数和素材；内容是否通过审核，以模型平台提交后的结果为准。</p>
    <div v-show="expanded" class="checkDetails">
    <p v-if="!reports.length">{{ stale ? '图片、提示词或参数已变化，需要重新检查。之前的确认已失效。' : '检查会读取当前图片与提示词，不提交视频，不调用生成模型。' }}</p>
    <article v-for="report in reports" :key="report.preflight.trackId">
      <div class="verdict"><b>{{report.preflight.shotLabel}}</b><span :class="report.preflight.canSubmit?'ok':'error'">{{report.preflight.canSubmit ? report.preflight.acknowledged ? '已确认构图差异 · 提交时仍会复查' : '本地检查无阻断项' : report.submissionOutcome==='unknown' ? '提交结果待确认' : '需要处理 · 视频尚未提交'}}</span></div>
      <p v-if="report.preflight.issues.some((i:any)=>/UNREVIEWED|STALE|PENDING|FAILED/.test(i.code))">部分图片尚未完成当前版本的视觉核验，具体状态见下方检查说明。</p>
      <p v-if="!report.preflight.issues.length" class="ok">当前图片与提示词检查没有发现阻断项。</p>
      <div v-for="(issue,index) in actionable(report)" :key="index" class="issue" :class="issue.severity">
        <button v-if="issue.target?.artifactPath" type="button" class="thumb" :aria-label="'查看'+issue.target.referenceLabel" @click="preview=issue"><img :src="mediaUrl(issue.target.artifactPath)" :alt="issue.target.referenceLabel" /></button>
        <div class="body"><b>{{issue.target?.referenceLabel ?? '生成输入'}}{{purpose(issue.target?.purpose)}} · {{title(issue)}}</b>
          <p v-if="issue.expected">镜头要求：{{issue.expected}}</p>
          <p>{{issue.suggestion ?? issue.message}}</p>
          <div class="actions" v-if="issue.target"><t-button size="small" @click="preview=issue">查看对比</t-button><t-button size="small" @click="$emit('locate',issue.target,false)">定位画布</t-button><t-button v-if="issue.target.kind==='storyboard'" size="small" @click="$emit('locate',issue.target,true)">编辑图片</t-button><t-button v-if="issue.target.kind==='storyboard' && issue.target.artifactPath" size="small" @click="cropTarget={...issue.target,projectId,scriptId}">裁切局部</t-button><t-button v-if="issue.target.kind==='storyboard'" size="small" theme="primary" @click="$emit('locate',{...issue.target,regenerate:true},true)">按首帧重生成</t-button></div>
          <details><summary>详细依据</summary><p>{{issue.message}}</p><small>{{issue.code}}{{issue.target?.reviewId ? ' · 核验 '+issue.target.reviewId : ''}}</small></details>
        </div>
      </div>
      <t-button v-if="canAcknowledge(report)" theme="warning" variant="outline" @click="confirmUse(report)">我已查看，继续使用这版图片</t-button>
      <p v-if="report.preflight.acknowledged">不会自动生成视频，请再次点击“生成视频”。换图或修改提示词、参数后，此确认自动失效。</p>
      <details v-if="report.preflight.issues.some((i:any)=>i.severity==='info')"><summary>检查说明</summary><p v-for="(item,index) in report.preflight.issues.filter((i:any)=>i.severity==='info')" :key="index">{{item.message}} <t-button v-if="item.target?.artifactPath" size="small" variant="text" @click="preview=item">查看图片</t-button><t-button v-if="item.target?.kind==='storyboard' && item.target.artifactPath" size="small" variant="text" @click="cropTarget={...item.target,projectId,scriptId}">裁切此图</t-button></p></details>
    </article>
    </div>
    <t-dialog :visible="!!preview" @close="preview=null" :footer="false" header="问题图片与镜头要求" width="760px" attach="body">
      <template v-if="preview"><img class="large" :src="mediaUrl(preview.target?.artifactPath)" :alt="preview.target?.referenceLabel" /><p><b>{{preview.target?.shotLabel}} · {{preview.target?.referenceLabel}}{{purpose(preview.target?.purpose)}}</b></p><p>要求：{{preview.expected || '按当前参考用途检查'}}</p><p>{{preview.message}}</p><p>{{preview.suggestion}}</p><p>修复会打开该分镜的图片编辑界面；不会直接扣费生成或覆盖原图。有可用局部细节时可裁切，否则按起始画面重新生成。</p></template>
    </t-dialog>
  <CropStoryboardFrame :target="cropTarget" @close="cropTarget=null" @saved="$emit('changed')" />
  </section>
</template>
<script setup lang="ts">
import {ref,watch} from 'vue';
import CropStoryboardFrame from './cropStoryboardFrame.vue';
import {DialogPlugin} from 'tdesign-vue-next';
import settingStore from '@/stores/setting';
const props=defineProps<{reports:any[];busy:boolean;stale:boolean;projectId?:number;scriptId?:number}>();
const emit=defineEmits<{check:[];changed:[];locate:[target:any,repair:boolean];acknowledge:[report:any]}>();
const preview=ref<any>(null),cropTarget=ref<any>(null);
const expanded=ref(false);
watch(()=>props.reports,reports=>{if(reports.some(r=>!r.preflight.canSubmit))expanded.value=true;});
function mediaUrl(path?:string){if(!path)return '';if(/^https?:\/\//.test(path))return path;return new URL(path.startsWith('/oss/')?path:`/oss/${path.replace(/^\//,'')}`,settingStore().baseUrl||location.origin).href;}
const purpose=(p?:string)=>({'first_frame':'（首帧）','last_frame':'（尾帧）','identity_reference':'（角色参考）','style_reference':'（场景／风格参考）'}[p??'']??'');
const title=(i:any)=>/FRAMING|SHOT_SIZE/i.test(i.code)?'图片构图与镜头要求不一致':i.severity==='error'?'当前输入需要处理':i.severity==='warning'?'建议核对':'检查说明';
const actionable=(r:any)=>r.preflight.issues.filter((i:any)=>i.severity!=='info');
const canAcknowledge=(r:any)=>!r.preflight.canSubmit&&r.preflight.issues.some((i:any)=>i.severity==='error')&&r.preflight.issues.filter((i:any)=>i.severity==='error').every((i:any)=>i.overridable===true);
function confirmUse(report:any){const dialog=DialogPlugin.confirm({header:'确认继续使用当前图片',body:'你已查看图片与镜头的构图差异，并决定保留当前版本。本次确认不启动生成，且仅适用于当前图片、提示词和参数。',confirmBtn:'确认保留此版本',onConfirm:()=>{emit('acknowledge',report);dialog.destroy();},onClose:()=>dialog.destroy()});}
defineExpose({showReference:(ref:any)=>{const issue=props.reports.flatMap(r=>r.preflight.issues).find((i:any)=>i.target?.id===ref.id&&(i.target.kind==='storyboard'?'storyboard':'assets')===ref.sources);if(issue)preview.value=issue;}});
</script>
<style scoped>
.platformReviewNote{margin:6px 0 0;color:var(--td-text-color-secondary);font-size:12px}
.checkSummary{margin-right:auto;color:var(--td-text-color-secondary);font-size:12px}.checkDetails{max-height:clamp(100px,24vh,220px);overflow-y:auto;overscroll-behavior:contain;padding-right:6px}.checkDetails:empty{display:none}

.preflightPanel{border:1px solid var(--td-component-border);border-radius:8px;padding:14px;margin:0;background:var(--td-bg-color-container);font-size:14px}.header,.verdict,.actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.header{justify-content:space-between}.issue{display:flex;gap:12px;padding:12px 0;border-top:1px solid var(--td-component-border)}.thumb{flex:0 0 92px;width:92px;height:92px;border:2px solid currentColor;border-radius:6px;padding:0;cursor:pointer;overflow:hidden}.thumb img{width:100%;height:100%;object-fit:contain}.error{color:var(--td-error-color)}.warning{color:var(--td-warning-color)}.ok{color:var(--td-success-color)}.body{min-width:0;flex:1}.body p{color:var(--td-text-color-primary);margin:6px 0}details{margin-top:8px}small{overflow-wrap:anywhere}.large{display:block;max-width:100%;max-height:55vh;object-fit:contain;margin:auto}article+article{margin-top:16px;border-top:1px solid var(--td-component-border);padding-top:12px}
</style>
