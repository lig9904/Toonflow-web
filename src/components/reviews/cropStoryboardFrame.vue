<template>
 <t-dialog :visible="!!target" header="裁切首帧局部" :footer="false" :close-on-overlay-click="false" @close="close" width="800px" attach="body">
  <p>仅在原图包含清晰的目标局部时使用裁切。请检查右侧预览；这里不会补画缺失细节，也不会调用生成模型。</p>
  <p v-if="error" class="error">{{error}}</p>
  <div class="compare"><div class="original"><img crossorigin="anonymous" :src="sourceUrl" @load="loaded" ref="sourceImage" alt="原图"/><div v-if="ready" class="selection" :style="{left:x+'%',top:y+'%',width:w+'%',height:h+'%'}" /></div><canvas ref="preview" aria-label="裁切预览" /></div>
  <div class="controls"><label v-for="(label,i) in ['左边界','上边界','宽度','高度']" :key="label">{{label}}（%）<input type="range" min="0" max="100" step="1" :value="[x,y,w,h][i]" :disabled="busy" @input="adjust(i,Number(($event.target as HTMLInputElement).value))" />{{[x,y,w,h][i]}}</label></div>
  <p>{{pixels}} · 裁切后需重新检查视频输入。原图和裁切图同时保存在图片工作流，可重新选用原图。</p>
  <t-button theme="primary" :loading="busy" :disabled="!ready||busy||tooSmall" @click="save">保存并应用裁切图</t-button>
  <t-button :disabled="busy" @click="close">取消</t-button>
 </t-dialog>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue';
import axios from '@/utils/axios';
import settingStore from '@/stores/setting';
import projectStore from '@/stores/project';
import productionAgentStore from '@/stores/productionAgent';
import {getStoryboardState,updateStoryboardUrl} from '@/utils/productionState';
import {reviewMediaPath} from '@/utils/imageReviews';
import {createIdempotencyKey} from '@/utils/idempotency';
import {confirmCreativeDrafts,registerCreativeDraft} from '@/utils/creativeDrafts';
const props=defineProps<{target:any|null}>();const emit=defineEmits<{close:[];saved:[]}>();
const loadedUrl=ref('');
const sourceImage=ref<HTMLImageElement>(),preview=ref<HTMLCanvasElement>(),ready=ref(false),busy=ref(false),error=ref('');
const x=ref(0),y=ref(0),w=ref(100),h=ref(100),width=ref(0),height=ref(0);let baselineVersion=0,sequence=0,disposed=false,attempt:any,stateReady=false;
const dirty=computed(()=>x.value!==0||y.value!==0||w.value!==100||h.value!==100);
const sourceUrl=computed(()=>loadedUrl.value||(props.target?.artifactPath?new URL('/oss/'+props.target.artifactPath.replace(/^\/?oss\//,'').replace(/^\//,''),settingStore().baseUrl||location.origin).href:''));
const crop=computed(()=>({left:Math.round(width.value*x.value/100),top:Math.round(height.value*y.value/100),width:Math.max(1,Math.floor(width.value*w.value/100)),height:Math.max(1,Math.floor(height.value*h.value/100))}));
const tooSmall=computed(()=>crop.value.width<64||crop.value.height<64);
const pixels=computed(()=>`${crop.value.width} × ${crop.value.height} 像素${tooSmall.value?'，范围太小，请扩大选区':''}`);
function current(target:any,seq:number){return !disposed&&sequence===seq&&props.target===target&&Number(projectStore().project?.id)===target.projectId&&productionAgentStore().episodesId===target.scriptId;}
watch(()=>props.target,async target=>{const seq=++sequence;if(loadedUrl.value)URL.revokeObjectURL(loadedUrl.value);loadedUrl.value='';ready.value=false;stateReady=false;error.value='';x.value=y.value=0;w.value=h.value=100;attempt=undefined;if(!target)return;try{const state=await getStoryboardState(target.projectId,target.id);if(!current(target,seq))return;if(reviewMediaPath(String(state.storyboard.src??state.storyboard.filePath??''))!==reviewMediaPath(target.artifactPath))throw Error('原图已变化，请重新检查后裁切');baselineVersion=state.state.version;const response=await fetch(sourceUrl.value,{credentials:'include',cache:'no-store'});if(!response.ok)throw Error('无法读取原始图片');const blob=await response.blob();if(target.artifactHash){const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');if(hash!==target.artifactHash)throw Error('原图内容已变化，请重新检查后裁切');}if(!current(target,seq))return;loadedUrl.value=URL.createObjectURL(blob);stateReady=true;await nextTick();if(sourceImage.value?.complete)loaded();}catch(e:any){error.value=e.message??'无法读取当前分镜';}},{immediate:true});
function loaded(){const image=sourceImage.value;if(!stateReady||!image?.naturalWidth||error.value)return;width.value=image.naturalWidth;height.value=image.naturalHeight;ready.value=true;draw();}
function draw(){if(!ready.value||!preview.value||!sourceImage.value)return;const c=crop.value;const canvas=preview.value;canvas.width=c.width;canvas.height=c.height;canvas.getContext('2d')!.drawImage(sourceImage.value,c.left,c.top,c.width,c.height,0,0,c.width,c.height);}
function adjust(index:number,value:number){if(index===0)x.value=Math.min(value,95);if(index===1)y.value=Math.min(value,95);if(index===2)w.value=Math.max(5,value);if(index===3)h.value=Math.max(5,value);w.value=Math.min(w.value,100-x.value);h.value=Math.min(h.value,100-y.value);draw();}
async function save():Promise<boolean>{const target=props.target,seq=sequence;if(!target||!ready.value||busy.value||tooSmall.value)return false;busy.value=true;error.value='';try{
 if(!current(target,seq))return false;const bytes=preview.value!.toDataURL('image/png');const signature=JSON.stringify({id:target.id,version:baselineVersion,crop:crop.value});if(attempt?.signature!==signature)attempt={signature,key:createIdempotencyKey('crop-frame')};const frozen=attempt;
 if(!frozen.upload){const r=await axios.post('/production/editImage/uploadImage',{projectId:target.projectId,scriptId:target.scriptId,base64Data:bytes,idempotencyKey:frozen.key+'-upload'});frozen.upload=r.data;}
 if(!current(target,seq))return false;
 if(!frozen.flow){const r=await axios.post('/production/editImage/saveImageFlow',{projectId:target.projectId,scriptId:target.scriptId,expectedVersion:0,idempotencyKey:frozen.key+'-flow',nodes:[{id:'original-frame',type:'upload',position:{x:0,y:0},data:{image:target.artifactPath}},{id:'cropped-frame',type:'upload',position:{x:350,y:0},data:{image:frozen.upload.filePath}}],edges:[]});frozen.flow=r.data;}
 if(!current(target,seq))return false;
 const state=await getStoryboardState(target.projectId,target.id);if(!current(target,seq))return false;
 if(reviewMediaPath(String(state.storyboard.src??state.storyboard.filePath??''))!==reviewMediaPath(frozen.upload.filePath))await updateStoryboardUrl(target.projectId,target.id,baselineVersion,frozen.upload.filePath,frozen.flow.flowId);
 if(!current(target,seq))return false;x.value=y.value=0;w.value=h.value=100;emit('saved');emit('close');return true;
 }catch(e:any){if(current(target,seq))error.value=e.message??'保存失败，裁切预览仍保留';return false;}finally{busy.value=false;}}
const id='crop-draft:'+crypto.randomUUID();const unregister=registerCreativeDraft({id,label:'首帧裁切',scope:()=>`project:${props.target?.projectId}:episode:${props.target?.scriptId}`,isDirty:()=>!!props.target&&dirty.value,save,discard:()=>{x.value=y.value=0;w.value=h.value=100;emit('close');}});
async function close(){if(busy.value)return;if(await confirmCreativeDrafts({ids:[id],action:'关闭裁切窗口'}))emit('close');}
onBeforeUnmount(()=>{disposed=true;sequence++;if(loadedUrl.value)URL.revokeObjectURL(loadedUrl.value);unregister();});
</script>
<style scoped>
.compare{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}.original{position:relative}.original img{display:block;width:100%}.selection{position:absolute;border:2px solid #ffb000;box-sizing:border-box;pointer-events:none}.compare canvas{width:100%;max-height:55vh;object-fit:contain;background:#ddd}.controls{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}.controls label{display:flex;gap:8px;align-items:center}.controls input{min-width:0;flex:1}.error{color:var(--td-error-color)}
</style>
