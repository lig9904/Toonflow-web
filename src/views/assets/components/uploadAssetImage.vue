<template>
  <t-dialog v-model:visible="visible" :header="target.id ? `上传图片 · ${target.name}` : `上传图片新建${typeName}`" width="640px" :mask-closable="false" :close-on-esc-keydown="false" :confirm-btn="{content:'上传并使用',loading:saving,disabled:reading||saving||!draft.base64}" :cancel-btn="{content:'取消',disabled:saving}" :close-btn="!saving" @confirm="confirm" @cancel="close" @close-btn-click="close">
    <p>{{ target.id ? '确认后将使用新图片，旧图片保留在历史版本中；资产设定和提示词保持不变。' : '直接上传已有图片，不需要调用模型。名称必填，设定和提示词可以稍后补充。' }}</p>
    <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" :disabled="reading||saving" @change="chooseFile" />
    <p class="hint">支持 PNG、JPEG、WebP，图片保存到本地媒体存储。</p>
    <img v-if="draft.base64" :src="draft.base64" :alt="draft.fileName" class="preview" />
    <t-form v-if="!target.id" :data="draft" label-align="top">
      <t-form-item label="名称" required-mark><t-input v-model="draft.name" :disabled="saving" /></t-form-item>
      <t-form-item label="设定（可选）"><t-textarea v-model="draft.describe" :disabled="saving" /></t-form-item>
    </t-form>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
  </t-dialog>
</template>
<script setup lang="ts">
import {ref,computed,onMounted,watch,onBeforeUnmount} from 'vue';
import axios from '@/utils/axios';
import projectStore from '@/stores/project';
import {useManualCreativeDraft} from '@/utils/useManualCreativeDraft';
import {createIdempotencyKey} from '@/utils/idempotency';
const props=defineProps<{target:{projectId:number;id?:number;name?:string;type:'role'|'tool'|'scene'}}>();// Captured when opening: switching tabs must not retarget an upload.
const emit=defineEmits<{close:[];saved:[value:{created:boolean;name:string;type:string;projectId:number}]}>();
const typeName=computed(()=>({role:'角色',tool:'道具',scene:'场景'}[props.target.type]));
const reading=ref(false),fileInput=ref<HTMLInputElement>();
let disposed=false,readSequence=0,intent:{body:string;key:string}|undefined;
const manual=useManualCreativeDraft({
 label:'上传资产图片',id:()=>`asset-upload:${props.target.projectId}:${props.target.type}:${props.target.id??'new'}`,scope:()=>`project:${projectStore().project?.id}`,
 initial:{name:'',describe:'',base64:'',fileName:''},
 load:async()=>{const target={...props.target};let version=0;if(target.id){const {data}=await axios.post('/assets/getImage',{projectId:target.projectId,assetsId:target.id});version=Number(data.version);}return {value:{name:target.name??'',describe:'',base64:'',fileName:''},meta:{...target,version}};},
 commit:async(value,meta)=>{
  if(Number(projectStore().project?.id)!==meta.projectId)throw new Error('项目已切换，请返回原项目完成上传');
  if(!value.base64)throw new Error('请先选择图片');
  if(!meta.id&&!value.name.trim())throw new Error('请输入资产名称');
  const body=meta.id?{projectId:meta.projectId,id:meta.id,expectedVersion:meta.version,type:meta.type,base64:value.base64}:{projectId:meta.projectId,type:meta.type,name:value.name.trim(),describe:value.describe,base64:value.base64};
  const signature=JSON.stringify(body);if(intent?.body!==signature)intent={body:signature,key:createIdempotencyKey('asset-image-upload')};
  const {data}=await axios.post(meta.id?'/assets/saveAssets':'/assets/uploadImage',{...body,idempotencyKey:intent.key});intent=undefined;
  return {value,meta:{...meta,version:Number(data.version??data.asset?.version??meta.version)}};
 },onSaved:({value,meta})=>{window.$message.success('图片已上传并设为当前资产图片');emit('saved',{created:!meta.id,name:value.name,type:meta.type,projectId:meta.projectId});},
});
const {draft,visible,saving,error}=manual;
onMounted(()=>manual.open());
watch(visible,value=>{if(!value)emit('close');});
onBeforeUnmount(()=>{disposed=true;readSequence++;});
async function close(){if(!saving.value)await manual.close();}
async function confirm(){if(!reading.value&&await manual.save())await manual.close();}
async function chooseFile(event:Event){
 const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file)return;input.value='';
 const sequence=++readSequence;reading.value=true;error.value='';
 try{
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('请选择 PNG、JPEG 或 WebP 图片');
  const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('读取图片失败，请重新选择'));reader.readAsDataURL(file);});
  await new Promise<void>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve();image.onerror=()=>reject(new Error('图片无法打开，请检查文件'));image.src=base64;});
  if(disposed||sequence!==readSequence)return;
  draft.value.base64=base64;draft.value.fileName=file.name;if(!draft.value.name.trim())draft.value.name=file.name.replace(/\.[^.]+$/,'');
 }catch(reason){if(!disposed&&sequence===readSequence)error.value=(reason as Error).message;}
 finally{if(sequence===readSequence)reading.value=false;}
}
</script>
<style scoped>
.preview{display:block;max-width:100%;width:auto;max-height:240px;object-fit:contain;margin:12px auto}.hint{font-size:12px;color:var(--td-text-color-secondary)}.error{color:var(--td-error-color)}
</style>
