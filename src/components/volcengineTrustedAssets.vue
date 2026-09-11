<template>
  <t-dialog v-model:visible="visible" header="火山可信素材库" :footer="false" width="min(1180px, 95vw)" attach="body" :close-on-overlay-click="false" @close="closeDialog">
    <section class="trusted-assets" data-testid="trusted-assets-dialog">
      <p class="intro">可同步火山素材，或将当前 NAS 素材上传至虚拟素材组。真人认证与授权由您在火山官方完成。素材所在的火山项目须与生成 API Key 所属项目一致。</p>
      <div class="target-bar">
        <label>绑定到本地素材<select v-model="selectedTargetKey" aria-label="绑定到本地素材"><option v-for="target in targets" :key="targetKey(target)" :value="targetKey(target)">{{ target.targetKind === 'storyboard' ? '分镜' : '素材' }} · {{ target.name }} (#{{ target.targetId }})</option></select></label>
        <img v-if="activeTarget?.src && expectedAssetType === 'Image'" :src="activeTarget.src" alt="当前本地素材" class="local-preview" /><span v-if="activeTarget" class="target-type">{{ expectedAssetType || '读取媒体类型中' }} · 每项本地素材绑定一个远程素材</span>
      </div>
      <p v-if="!activeScope" class="notice">请先选择当前项目内已有文件的素材或分镜。</p>
      <template v-else>
        <div class="binding-panel" aria-live="polite">
          <div class="binding-heading"><strong>当前绑定</strong><span :class="['binding-status', binding?.status]">{{ bindingStatus }}</span></div>
          <p v-if="binding?.error" class="error" role="alert">{{ binding.error }}</p>
          <div v-if="binding?.status === 'conflict'" class="button-row"><button @click="resolveBinding('server')">读取服务端绑定</button><button class="primary" @click="resolveBinding('keep')">保留当前选择，按最新版本重试</button></div>
          <button v-else-if="binding?.status === 'error'" @click="controller.save(activeScope)">重试绑定请求</button>
          <p v-if="binding?.snapshot && !binding.snapshot.currentSourceFileHash" class="warning">本地素材尚无可读媒体文件；可以解除已有绑定，暂不能新增绑定。</p>
          <p v-if="binding?.snapshot?.sourceCurrent === false" class="warning">本地文件已变化，旧绑定不可直接用于生成。核对当前图片后，可移除旧绑定，或明确重新绑定。</p>
          <div v-for="item in binding?.desired || []" :key="trustedItemKey(item)" class="bound-item">
            <div><span class="pill">{{ item.groupType === 'LivenessFace' ? '真人素材' : 'AIGC' }}</span> {{ item.assetType }} · <code>{{ item.assetId }}</code><span class="pill">{{ bindingRemoteStatus(item) }}</span><small>{{ item.remoteProjectName }} / {{ item.groupId }}</small></div>
            <button :disabled="binding?.status === 'loading'" @click="removeBinding(item)">移除绑定</button>
          </div>
          <p v-if="binding?.snapshot && !binding.desired.length" class="muted">尚未绑定。选择下方 Active 素材后自动保存。</p>
          <button v-if="binding?.snapshot?.sourceCurrent === false && binding.desired.length && binding.snapshot.currentSourceFileHash && binding.status === 'saved'" @click="resolveBinding('keep')">确认以当前本地文件重新绑定所选项</button>
          <small v-if="binding?.snapshot" class="muted">绑定版本 {{ binding.snapshot.version }} · 本地来源版本 {{ binding.snapshot.currentSourceVersion }}</small>
        </div>
        <div class="remote-toolbar">
          <label>火山项目<input v-model="projectNameDraft" placeholder="default" aria-label="火山项目" @keyup.enter="applyRemoteProject" /></label><button @click="applyRemoteProject">读取项目</button>
          <label>素材类型<select v-model="groupType" aria-label="素材类型"><option value="AIGC">AIGC 素材</option><option value="LivenessFace">真人认证素材</option></select></label>
          <button @click="refreshRemote">刷新素材库</button>
        </div>
        <section v-if="groupType === 'AIGC'" class="aigc-upload" data-testid="trusted-aigc-upload">
          <div class="upload-heading"><strong>上传当前本地虚拟素材</strong><span class="muted">来源：当前选中的 NAS 素材</span></div>
          <p class="muted">目标组：{{ selectedGroupName || '请从素材组列表选择' }} · 火山项目 {{ remoteProjectName }}</p>
          <label>素材名称<input v-model="uploadName" aria-label="上传素材名称" maxlength="64" :placeholder="activeTarget?.name || '使用当前素材名称'" /></label>
          <div class="button-row"><button :disabled="!canStartUpload" @click="startUpload('uploadOnly')">上传当前素材到所选组</button><button class="primary" :disabled="!canStartUpload" @click="startUpload('uploadAndBind')">上传并绑定当前素材</button></div>
          <p v-if="uploadOperation?.phase === 'submitting'" role="status">正在提交持久上传任务，请勿重复操作…</p>
          <p v-if="uploadOperation?.error" class="error" role="alert">{{ uploadOperation.error }}</p>
          <div v-if="uploadOperation?.phase === 'uncertain'" class="notice warning">受理情况暂未确认。这里只查询原任务，不会再次上传。<button @click="refreshUploadOperation">查询原上传回执</button></div>
          <button v-if="uploadOperation?.phase === 'terminal' && !uploadOperation.receipt" @click="resetRejectedUpload">请求未被受理，修正后重新选择上传</button>
          <details class="new-group"><summary>新建虚拟素材组</summary><p class="muted">仅创建 AIGC 组。首次使用如需签署服务授权，请先<a href="https://www.volcengine.com/docs/82379/2333565" target="_blank" rel="noopener noreferrer">查看火山官方说明</a>并在控制台完成。</p><div class="button-row"><input v-model="newGroupName" aria-label="新虚拟素材组名称" placeholder="虚拟素材组名称" maxlength="64" /><input v-model="newGroupDescription" aria-label="新虚拟素材组说明" placeholder="说明（可选）" maxlength="256" /><button :disabled="!canCreateGroup" @click="createAigcGroup">创建虚拟素材组</button></div><p v-if="groupOperation?.phase === 'submitting'">正在提交建组请求…</p><p v-if="groupOperation?.error" class="error">{{ groupOperation.error }}</p><button v-if="groupOperation?.phase === 'uncertain'" @click="refreshGroupOperation">查询原建组回执</button><button v-if="groupOperation?.phase === 'terminal' && (!groupOperation.receipt || groupOperation.receipt.status === 'rejected')" @click="resetRejectedGroup">建组未成功，修正后准备重试</button>
            <div v-for="task in visibleGroupTasks" :key="task.operationId" class="task-row"><strong>{{ task.status === 'created' ? '素材组已创建' : task.status === 'rejected' ? '建组未完成' : '建组受理状态待确认' }}</strong><small>{{ task.remoteName }} · {{ task.remoteGroupId || task.operationId }}</small><p v-if="task.error" class="error">{{ task.error.message }}</p><button v-if="task.status === 'submission_unknown'" @click="syncGroupTask(task)">查询建组状态</button></div>
          </details>
          <div class="task-heading"><strong>当前素材的持久上传任务</strong><button :disabled="uploadHistoryLoading" @click="loadUploadHistory">刷新任务</button></div>
          <p v-if="uploadHistoryError" class="error">{{ uploadHistoryError }}</p><p v-if="uploadHistoryLoading && !visibleUploadTasks.length" class="muted">读取任务中…</p>
          <p v-else-if="!visibleUploadTasks.length" class="muted">暂无上传任务。关闭窗口不会取消服务端已受理的任务。</p>
          <article v-for="task in visibleUploadTasks" :key="task.operationId" class="upload-task" :data-upload-task="task.operationId"><strong>{{ uploadReceiptLabel(task) }}</strong><small>{{ task.remoteName }} · {{ task.assetType }} · {{ task.remoteProjectName }} / {{ task.groupId }}</small><small>任务 {{ task.operationId }} · 本地来源版本 {{ task.sourceVersion }}<span v-if="task.remoteAssetId"> · 远程 ID {{ task.remoteAssetId }}</span></small><div class="upload-steps"><span :class="{done: Boolean(task.remoteAssetId)}">提交到火山</span><span :class="{done: task.remoteStatus === 'Active'}">处理为 Active</span><span v-if="task.mode === 'uploadAndBind'" :class="{done: task.bindStatus === 'bound'}">保存绑定</span></div><p v-if="task.error" class="error">{{ task.error.message }}</p><p v-if="task.bindStatus === 'conflict'" class="warning">远程素材已保留，当前绑定未覆盖。读取最新绑定后，可绑定这份已上传素材，无需再次上传。</p><div class="button-row"><button @click="syncUploadTask(task)">查询任务状态</button><button v-if="task.status === 'active' && task.remoteAssetId && task.bindStatus !== 'bound'" :disabled="!canBindUploaded(task)" @click="bindUploaded(task)">绑定这份已上传素材</button><button v-if="task.status === 'failed' || task.status === 'rejected'" @click="prepareUploadRetry(task)">准备按当前素材重新上传</button></div></article>
        </section>
        <p v-else class="notice">真人认证素材只支持同步与绑定。请前往<a href="https://www.volcengine.com/docs/82379/2333565" target="_blank" rel="noopener noreferrer">火山官方说明</a>及<a href="https://console.volcengine.com/ark/" target="_blank" rel="noopener noreferrer">控制台</a>完成认证与授权；此页不提供真人素材自动上传或代授权。</p>
        <div v-if="remoteError" class="notice error" role="alert">{{ remoteError }}</div>
        <div class="library-layout">
          <aside class="group-list">
            <form class="search-row" @submit.prevent="loadGroups(false)"><input v-model="groupSearch" placeholder="搜索素材组名称" aria-label="搜索素材组名称" /><button :disabled="groupsLoading">搜索</button></form>
            <p v-if="groupsLoading && !groups.length" class="muted">正在读取素材组…</p>
            <p v-else-if="!groups.length" class="muted">没有可用素材组</p>
            <button v-for="group in groups" :key="group.id" class="group-item" :class="{selected: selectedGroupId === group.id}" @click="selectedGroupId = group.id"><strong>{{ group.name || group.id }}</strong><small>{{ group.id }}</small><small v-if="group.description">{{ group.description }}</small></button>
            <button v-if="groupsNextToken" class="load-more" :disabled="groupsLoading" @click="loadGroups(true)">加载更多素材组</button>
          </aside>
          <div class="asset-list">
            <form class="search-row" @submit.prevent="loadAssets(false)"><input v-model="assetSearch" placeholder="搜索素材名称" aria-label="搜索素材名称" /><button :disabled="assetsLoading || !selectedGroupId">搜索</button></form>
            <p v-if="!selectedGroupId" class="muted">选择素材组查看远程素材</p><p v-else-if="assetsLoading && !remoteAssets.length" class="muted">正在读取素材…</p><p v-else-if="!remoteAssets.length" class="muted">此素材组下没有匹配项</p>
            <div class="asset-grid">
              <article v-for="asset in remoteAssets" :key="asset.id" class="remote-card" :class="{selected: isSelected(asset), unavailable: !canBind(asset)}" :data-asset-id="asset.id">
                <div class="asset-preview">
                  <img v-if="asset.assetType === 'Image' && trustedPreviewUrl(asset.previewUrl)" :src="trustedPreviewUrl(asset.previewUrl)" :alt="asset.name" referrerpolicy="no-referrer" loading="lazy" />
                  <video v-else-if="asset.assetType === 'Video' && trustedPreviewUrl(asset.previewUrl)" :src="trustedPreviewUrl(asset.previewUrl)" controls preload="none" />
                  <audio v-else-if="asset.assetType === 'Audio' && trustedPreviewUrl(asset.previewUrl)" :src="trustedPreviewUrl(asset.previewUrl)" controls preload="none" />
                  <span v-else>无可用{{ asset.assetType === 'Audio' ? '音频' : asset.assetType === 'Video' ? '视频' : '图片' }}预览</span>
                </div>
                <div class="asset-info"><strong>{{ asset.name || asset.id }}</strong><span :class="['pill', asset.status.toLowerCase()]">{{ remoteStatus(asset.status) }}</span><small>{{ asset.assetType }} · {{ asset.id }}</small><p v-if="asset.error?.message" class="error">{{ asset.error.message }}</p><p v-if="expectedAssetType && asset.assetType !== expectedAssetType" class="muted">与本地 {{ expectedAssetType }} 类型不符</p></div>
                <button :disabled="!canBind(asset)" :class="{primary:isSelected(asset)}" @click="selectAsset(asset)">{{ isSelected(asset) ? '已选中 · 点击移除' : '选中并自动绑定' }}</button>
              </article>
            </div>
            <button v-if="assetsNextToken" class="load-more" :disabled="assetsLoading" @click="loadAssets(true)">加载更多素材</button>
          </div>
        </div>
      </template>
    </section>
  </t-dialog>
</template>
<script setup lang="ts">
import {computed, reactive, ref, watch, onBeforeUnmount} from 'vue';
import {createDurableOperationController, type DurableOperationState} from './trustedAssets/durableOperation';
import {uploadTerminal, uploadReceiptLabel, type TrustedUploadRequest, type TrustedUploadReceipt, type TrustedGroupCreateRequest, type TrustedGroupCreateReceipt} from './trustedAssets/uploadTypes';
import axios from '@/utils/axios';
import {createTrustedBindingController, trustedScopeKey, trustedItemKey, trustedPreviewUrl, type TrustedLocalTarget, type TrustedTargetScope, type TrustedGroupType, type TrustedBindingItem, type TrustedBindingDraft, type TrustedBindingSnapshot, type TrustedRemoteGroup, type TrustedRemoteAsset, type TrustedPage} from './trustedAssets/controller';
const props = defineProps<{projectId?: number | string; scriptId?: number; targets: TrustedLocalTarget[]; initialTargetKey?: string}>();
const visible = defineModel<boolean>({default:false});
const emit = defineEmits<{saved:[snapshot:TrustedBindingSnapshot]}>();
const targetKey = (target:TrustedLocalTarget) => `${target.targetKind}:${target.targetId}`;
const selectedTargetKey = ref('');
const activeTarget = computed(() => props.targets.find(target => targetKey(target) === selectedTargetKey.value));
const activeScope = computed<TrustedTargetScope | undefined>(() => {
  const projectId = Number(props.projectId); const target = activeTarget.value;
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || !target || !Number.isSafeInteger(target.targetId) || target.targetId <= 0) return undefined;
  return {projectId, ...(Number.isSafeInteger(props.scriptId) && Number(props.scriptId) > 0 ? {scriptId:props.scriptId} : {}), targetKind:target.targetKind, targetId:target.targetId};
});
const expectedAssetType = computed(() => { const mediaType=binding.value?.snapshot?.currentMediaType || activeTarget.value?.mediaType; return mediaType === 'audio' ? 'Audio' : mediaType === 'video' ? 'Video' : mediaType === 'image' || activeTarget.value?.targetKind === 'storyboard' ? 'Image' : undefined; });
const states = reactive<Record<string,TrustedBindingDraft>>({});
let disposed = false;
const controller = createTrustedBindingController({states,
  read:async scope => (await axios.post('/production/trustedAssets/getBindings',scope)).data,
  write:async input => { const {data} = await axios.post('/production/trustedAssets/setBindings',input); if (!disposed && visible.value && activeScope.value && trustedScopeKey(input) === trustedScopeKey(activeScope.value)) emit('saved',data); return data; },
});
const binding = computed(() => activeScope.value ? states[trustedScopeKey(activeScope.value)] : undefined);
const bindingStatus = computed(() => ({loading:'读取绑定中…',saved:'已同步',saving:'正在自动保存…',conflict:'版本冲突，选择已保留',error:'绑定未保存'})[binding.value?.status ?? 'loading']);
const groupType = ref<TrustedGroupType>('AIGC');
const remoteProjectName = ref('default');
const projectNameDraft = ref('default');
const groupSearch = ref(''); const assetSearch = ref('');
const groups = ref<TrustedRemoteGroup[]>([]); const remoteAssets = ref<TrustedRemoteAsset[]>([]);
const selectedGroupId = ref(''); const groupsNextToken = ref<string|null>(null); const assetsNextToken = ref<string|null>(null);
const groupsLoading = ref(false); const assetsLoading = ref(false); const remoteError = ref('');
let groupSequence = 0; let assetSequence = 0;
let appliedGroupSearch = ""; let appliedAssetSearch = "";
type UploadOperationInput = TrustedUploadRequest | {projectId:number};
type GroupOperationInput = TrustedGroupCreateRequest | {projectId:number};
const uploadStates = reactive<Record<string,DurableOperationState<UploadOperationInput,TrustedUploadReceipt>>>({});
const groupStates = reactive<Record<string,DurableOperationState<GroupOperationInput,TrustedGroupCreateReceipt>>>({});
const knownRejected = (error:unknown) => ['INVALID_INPUT','CONFIG_REQUIRED','PROJECT_MISMATCH','VERSION_CONFLICT','SESSION_REQUIRED'].includes((error as {code?:string})?.code || '');
const uploadController = createDurableOperationController<UploadOperationInput,TrustedUploadReceipt>({states:uploadStates,isTerminal:uploadTerminal,isRejected:knownRejected,
  start:async input => { if (!('groupId' in input)) throw new Error('缺少明确上传参数'); return (await axios.post('/production/trustedAssets/startUpload',input)).data; },
  read:async (input,lookup) => (await axios.post('/production/trustedAssets/syncUpload',{projectId:input.projectId,...(lookup.receipt?.operationId ? {operationId:lookup.receipt.operationId} : {idempotencyKey:lookup.idempotencyKey})})).data,
});
const groupController = createDurableOperationController<GroupOperationInput,TrustedGroupCreateReceipt>({states:groupStates,isTerminal:receipt=>receipt.status==='created' || receipt.status==='rejected',isRejected:knownRejected,
  start:async input => { if (!('name' in input)) throw new Error('缺少素材组名称'); return (await axios.post('/production/trustedAssets/createGroup',input)).data; },
  read:async (input,lookup) => (await axios.post('/production/trustedAssets/syncGroupCreation',{projectId:input.projectId,...(lookup.receipt?.operationId ? {operationId:lookup.receipt.operationId} : {idempotencyKey:lookup.idempotencyKey})})).data,
});
const uploadName=ref(''); const newGroupName=ref(''); const newGroupDescription=ref('');
const uploadHistory=ref<TrustedUploadReceipt[]>([]); const groupHistory=ref<TrustedGroupCreateReceipt[]>([]);
const uploadHistoryLoading=ref(false); const uploadHistoryError=ref('');
let uploadHistorySequence=0; let uploadPoll:ReturnType<typeof setInterval>|undefined;
const uploadScopeKey=computed(()=>activeScope.value ? trustedScopeKey(activeScope.value) : '');
const groupOperationKey=computed(()=>activeScope.value ? `${activeScope.value.projectId}:${remoteProjectName.value}` : '');
const uploadOperation=computed(()=>uploadStates[uploadScopeKey.value]);
const groupOperation=computed(()=>groupStates[groupOperationKey.value]);
const selectedGroupName=computed(()=>groups.value.find(group=>group.id===selectedGroupId.value)?.name || selectedGroupId.value);
const visibleUploadTasks=computed(()=>[...new Map([...uploadHistory.value,...(uploadOperation.value?.receipt ? [uploadOperation.value.receipt] : [])].map(task=>[task.operationId,task])).values()].sort((a,b)=>b.createdAt-a.createdAt));
const visibleGroupTasks=computed(()=>[...new Map([...groupHistory.value,...(groupOperation.value?.receipt ? [groupOperation.value.receipt] : [])].map(task=>[task.operationId,task])).values()].filter(task=>task.remoteProjectName===remoteProjectName.value).slice(0,5));
const uploadBusy=computed(()=>['submitting','tracking','uncertain'].includes(uploadOperation.value?.phase || '') || visibleUploadTasks.value.some(task=>!uploadTerminal(task)));
const canStartUpload=computed(()=>Boolean(groupType.value==='AIGC' && activeScope.value && selectedGroupId.value && expectedAssetType.value && binding.value?.snapshot?.currentSourceFileHash && binding.value.status==='saved' && !(uploadOperation.value?.phase==='terminal' && !uploadOperation.value.receipt) && !uploadBusy.value && !uploadHistoryLoading.value));
const canCreateGroup=computed(()=>Boolean(groupType.value==='AIGC' && activeScope.value && newGroupName.value.trim() && !(groupOperation.value?.phase==='terminal' && !groupOperation.value.receipt) && !['submitting','tracking','uncertain'].includes(groupOperation.value?.phase || '') && !visibleGroupTasks.value.some(task=>!['created','rejected'].includes(task.status))));
function uploadViewScope(){return JSON.stringify([visible.value,uploadScopeKey.value,remoteProjectName.value,groupType.value]);}
async function startUpload(mode:'uploadOnly'|'uploadAndBind') {
  if(!canStartUpload.value || !activeScope.value || !binding.value?.snapshot || !expectedAssetType.value) return;
  const request:TrustedUploadRequest={...activeScope.value,remoteProjectName:remoteProjectName.value,groupId:selectedGroupId.value,groupType:'AIGC',name:uploadName.value.trim() || activeTarget.value?.name.slice(0,64),assetType:expectedAssetType.value,mode,expectedSourceVersion:binding.value.snapshot.currentSourceVersion,expectedSourceFileHash:binding.value.snapshot.currentSourceFileHash!,expectedBindingVersion:mode==='uploadAndBind' ? binding.value.snapshot.version : null};
  await uploadController.begin(uploadScopeKey.value,request);
}
async function createAigcGroup(){if(!canCreateGroup.value || !activeScope.value)return;await groupController.begin(groupOperationKey.value,{projectId:activeScope.value.projectId,remoteProjectName:remoteProjectName.value,groupType:'AIGC',name:newGroupName.value.trim(),...(newGroupDescription.value.trim()?{description:newGroupDescription.value.trim()}:{})});}
const refreshUploadOperation=()=>uploadController.refresh(uploadScopeKey.value);
const refreshGroupOperation=()=>groupController.refresh(groupOperationKey.value);
function resetRejectedUpload(){uploadController.forgetTerminal(uploadScopeKey.value);}
function resetRejectedGroup(){groupController.forgetTerminal(groupOperationKey.value);}
async function loadUploadHistory(){
  if(!visible.value || groupType.value!=='AIGC' || !activeScope.value)return;
  const scope={...activeScope.value};const view=uploadViewScope();const sequence=++uploadHistorySequence;uploadHistoryLoading.value=true;uploadHistoryError.value='';
  try{
    const [uploads,creations]=await Promise.all([axios.post('/production/trustedAssets/listUploads',scope),axios.post('/production/trustedAssets/listGroupCreations',{projectId:scope.projectId})]);
    if(disposed || sequence!==uploadHistorySequence || view!==uploadViewScope())return;
    uploadHistory.value=uploads.data.items || [];groupHistory.value=creations.data.items || [];
    const running=uploadHistory.value.find(task=>!uploadTerminal(task));
    if(running)uploadController.adopt(trustedScopeKey(scope),{projectId:scope.projectId},running.idempotencyKey,running);
    const creating=groupHistory.value.find(task=>task.remoteProjectName===remoteProjectName.value && !['created','rejected'].includes(task.status));
    if(creating)groupController.adopt(groupOperationKey.value,{projectId:scope.projectId},creating.idempotencyKey,creating);
  }catch(error){if(sequence===uploadHistorySequence && view===uploadViewScope())uploadHistoryError.value=errorMessage(error);}
  finally{if(sequence===uploadHistorySequence)uploadHistoryLoading.value=false;}
}
async function syncUploadTask(task:TrustedUploadReceipt){if(!activeScope.value)return;uploadController.adopt(uploadScopeKey.value,{projectId:activeScope.value.projectId},task.idempotencyKey,task);await refreshUploadOperation();}
async function syncGroupTask(task:TrustedGroupCreateReceipt){if(!activeScope.value)return;groupController.adopt(groupOperationKey.value,{projectId:activeScope.value.projectId},task.idempotencyKey,task);await refreshGroupOperation();}
function prepareUploadRetry(task:TrustedUploadReceipt){
  if(!uploadTerminal(task) || task.status==='active')return;
  uploadController.forgetTerminal(uploadScopeKey.value);
  // This explicit action only prepares the form; the user chooses an upload button again.
  uploadName.value=activeTarget.value?.name.slice(0,64) || '';remoteProjectName.value=task.remoteProjectName;projectNameDraft.value=task.remoteProjectName;
  if(groups.value.some(group=>group.id===task.groupId))selectedGroupId.value=task.groupId;
}
function canBindUploaded(task:TrustedUploadReceipt){const current=binding.value?.snapshot;return Boolean(current && binding.value?.status==='saved' && task.status==='active' && task.remoteAssetId && task.assetType===expectedAssetType.value && task.sourceVersion===current.currentSourceVersion && task.sourceFileHash===current.currentSourceFileHash);}
async function bindUploaded(task:TrustedUploadReceipt){
  if(!activeScope.value)return;
  const scope={...activeScope.value};const key=trustedScopeKey(scope);await controller.load(scope,'server');
  if(!activeScope.value || trustedScopeKey(activeScope.value)!==key || !canBindUploaded(task))return;
  const item:TrustedBindingItem={remoteProjectName:task.remoteProjectName,groupType:'AIGC',groupId:task.groupId,assetId:task.remoteAssetId!,assetType:task.assetType};
  controller.bindCurrentSource(scope,item);
}
const handledUploads=new Set<string>();const handledGroups=new Set<string>();
watch(()=>uploadOperation.value?.receipt,async task=>{
  if(!task || !visible.value || groupType.value!=='AIGC' || !activeScope.value)return;
  const stamp=`${task.operationId}:${task.status}:${task.bindStatus}:${task.updatedAt}`;if(handledUploads.has(stamp))return;handledUploads.add(stamp);
  uploadHistory.value=[task,...uploadHistory.value.filter(item=>item.operationId!==task.operationId)];
  if(task.status==='active') {const scope={...activeScope.value};if(task.bindStatus==='bound')await controller.load(scope);if(selectedGroupId.value===task.groupId && remoteProjectName.value===task.remoteProjectName)void loadAssets(false);}
});
watch(()=>groupOperation.value?.receipt,async task=>{
  if(!task || !visible.value || groupType.value!=='AIGC' || task.status!=='created' || !task.remoteGroupId || handledGroups.has(task.operationId))return;
  handledGroups.add(task.operationId);const view=uploadViewScope();await loadGroups(false);if(view===uploadViewScope())selectedGroupId.value=task.remoteGroupId;
});
watch(()=>[visible.value,uploadScopeKey.value,remoteProjectName.value,groupType.value],()=>{
  ++uploadHistorySequence;uploadHistory.value=[];groupHistory.value=[];uploadHistoryError.value='';uploadHistoryLoading.value=false;
  if(uploadPoll)clearInterval(uploadPoll);uploadPoll=undefined;
  if(visible.value && groupType.value==='AIGC' && activeScope.value){void loadUploadHistory();uploadPoll=setInterval(()=>{if(document.hidden)return;if(uploadOperation.value && uploadOperation.value.phase!=='terminal')void refreshUploadOperation();if(groupOperation.value && groupOperation.value.phase!=='terminal')void refreshGroupOperation();},3000);}
},{immediate:true});

function errorMessage(error:unknown) { const e = error as {code?:string;message?:string}; return e?.code === 'CONFIG_REQUIRED' ? '火山新入口的素材库需要单独配置 AK/SK。配置完成后可重试；无需填写 TOS。' : e?.message || '火山素材库暂时无法读取，请重试。'; }
function currentRemoteScope() { return JSON.stringify([visible.value,activeScope.value,remoteProjectName.value,groupType.value]); }
async function loadGroups(more=false) {
  if (!visible.value || !activeScope.value || (more && (groupsLoading.value || !groupsNextToken.value))) return;
  const sequence=++groupSequence; const scope=currentRemoteScope(); const projectId=activeScope.value.projectId; groupsLoading.value=true; remoteError.value='';
  if (!more) { appliedGroupSearch=groupSearch.value.trim(); groups.value=[]; groupsNextToken.value=null; selectedGroupId.value=''; remoteAssets.value=[]; assetsNextToken.value=null; ++assetSequence; }
  try {
    const {data} = await axios.post('/production/trustedAssets/groups',{projectId,projectName:remoteProjectName.value,groupType:groupType.value,name:appliedGroupSearch || undefined,maxResults:30,...(more ? {nextToken:groupsNextToken.value} : {})});
    if (disposed || sequence!==groupSequence || scope!==currentRemoteScope()) return;
    const page=data as TrustedPage<TrustedRemoteGroup>; groups.value=more ? [...new Map([...groups.value,...page.items].map(item=>[item.id,item])).values()] : page.items; groupsNextToken.value=page.nextToken;
    if (!selectedGroupId.value && groups.value.length) selectedGroupId.value=groups.value[0].id;
  } catch(error) { if(sequence===groupSequence && scope===currentRemoteScope()) remoteError.value=errorMessage(error); }
  finally { if(sequence===groupSequence) groupsLoading.value=false; }
}
async function loadAssets(more=false) {
  if (!visible.value || !activeScope.value || !selectedGroupId.value || (more && (assetsLoading.value || !assetsNextToken.value))) return;
  const sequence=++assetSequence; const scope=currentRemoteScope(); const groupId=selectedGroupId.value; const projectId=activeScope.value.projectId; assetsLoading.value=true; remoteError.value='';
  if (!more) { appliedAssetSearch=assetSearch.value.trim(); remoteAssets.value=[]; assetsNextToken.value=null; }
  try {
    const {data}=await axios.post('/production/trustedAssets/assets',{projectId,projectName:remoteProjectName.value,groupType:groupType.value,groupIds:[groupId],name:appliedAssetSearch || undefined,maxResults:24,...(more ? {nextToken:assetsNextToken.value} : {})});
    if(disposed || sequence!==assetSequence || scope!==currentRemoteScope() || groupId!==selectedGroupId.value) return;
    const page=data as TrustedPage<TrustedRemoteAsset>; remoteAssets.value=more ? [...new Map([...remoteAssets.value,...page.items].map(item=>[item.id,item])).values()] : page.items; assetsNextToken.value=page.nextToken;
  } catch(error) { if(sequence===assetSequence && scope===currentRemoteScope()) remoteError.value=errorMessage(error); }
  finally { if(sequence===assetSequence) assetsLoading.value=false; }
}
function remoteItem(asset:TrustedRemoteAsset):TrustedBindingItem { return {remoteProjectName:remoteProjectName.value,groupType:groupType.value,groupId:asset.groupId,assetId:asset.id,assetType:asset.assetType}; }
function isSelected(asset:TrustedRemoteAsset) { return binding.value?.desired.some(item=>trustedItemKey(item)===trustedItemKey(remoteItem(asset))) ?? false; }
function canBind(asset:TrustedRemoteAsset) { return Boolean(binding.value?.snapshot && !['loading','conflict'].includes(binding.value.status) && binding.value.snapshot.sourceCurrent && binding.value.snapshot.currentSourceFileHash && asset.status==='Active' && asset.assetType===expectedAssetType.value); }
function selectAsset(asset:TrustedRemoteAsset) { if(activeScope.value && canBind(asset)) controller.toggle(activeScope.value,remoteItem(asset)); }
function removeBinding(item:TrustedBindingItem) { if(activeScope.value) controller.remove(activeScope.value,item); }
function resolveBinding(mode:'server'|'keep') { if(activeScope.value) void controller.load(activeScope.value,mode); }
function bindingRemoteStatus(item:TrustedBindingItem) { const saved=binding.value?.snapshot?.items.find(value=>trustedItemKey(value)===trustedItemKey(item)); return saved ? remoteStatus(saved.remoteStatus || "") : "待保存"; }
function remoteStatus(status:string) { return ({Active:'Active · 可用',Processing:'Processing · 处理中',Failed:'Failed · 失败'} as Record<string,string>)[status] || '不可用'; }
function applyRemoteProject() { const next=projectNameDraft.value.trim() || 'default'; if(next===remoteProjectName.value) void loadGroups(false); else remoteProjectName.value=next; }
function refreshRemote() { void loadGroups(false); }
function closeDialog() { visible.value=false; }
watch(() => [visible.value,props.projectId,props.scriptId,props.initialTargetKey,props.targets.map(target=>`${targetKey(target)}:${target.src ?? ''}`).join('|')],()=>{
  if(!visible.value) { ++groupSequence; ++assetSequence; return; }
  if(!props.targets.some(target=>targetKey(target)===selectedTargetKey.value)) selectedTargetKey.value=props.initialTargetKey && props.targets.some(target=>targetKey(target)===props.initialTargetKey) ? props.initialTargetKey : props.targets[0] ? targetKey(props.targets[0]) : '';
  if(activeScope.value) void controller.load(activeScope.value);
},{immediate:true});
watch(()=>[visible.value,activeScope.value ? trustedScopeKey(activeScope.value) : '',remoteProjectName.value,groupType.value],()=>{
  ++groupSequence; ++assetSequence; groupsLoading.value=false; assetsLoading.value=false; groups.value=[]; remoteAssets.value=[]; selectedGroupId.value=''; remoteError.value='';
  if(visible.value && activeScope.value) { void controller.load(activeScope.value); void loadGroups(false); }
},{immediate:true});
watch(selectedGroupId,()=>{++assetSequence;assetsLoading.value=false;remoteAssets.value=[];assetsNextToken.value=null;if(selectedGroupId.value) void loadAssets(false);});
onBeforeUnmount(()=>{disposed=true;++groupSequence;++assetSequence;++uploadHistorySequence;if(uploadPoll)clearInterval(uploadPoll);});
</script>
<style scoped>
.aigc-upload{padding:14px;border:1px solid var(--td-component-border);border-radius:8px;margin:14px 0}.upload-heading,.task-heading{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:10px}.aigc-upload .button-row{margin:10px 0}.new-group{margin:16px 0;padding:10px;border:1px solid var(--td-component-border);border-radius:6px}.new-group summary{cursor:pointer}.task-row,.upload-task{padding:10px 0;border-top:1px solid var(--td-component-border)}.task-row small,.upload-task small{display:block;margin-top:5px;overflow-wrap:anywhere;color:var(--td-text-color-secondary)}.upload-steps{display:flex;gap:8px;margin:10px 0;flex-wrap:wrap}.upload-steps span{padding:4px 8px;border-radius:4px;background:var(--td-bg-color-secondarycontainer);font-size:12px;color:var(--td-text-color-secondary)}.upload-steps .done{color:var(--td-success-color)}.aigc-upload a{color:var(--td-brand-color)}
.trusted-assets{font-size:13px;color:var(--td-text-color-primary);max-height:78vh;overflow:auto;padding:2px 4px}.intro,.muted{color:var(--td-text-color-secondary);line-height:1.7}.intro{margin:0 0 15px}.target-bar,.remote-toolbar,.button-row,.binding-heading{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.target-bar{margin-bottom:14px}.local-preview{width:66px;height:50px;object-fit:contain;border:1px solid var(--td-component-border);border-radius:5px}.target-type{font-size:12px;color:var(--td-text-color-secondary)}label{font-size:12px}input,select,button{font:inherit;border:1px solid var(--td-component-border);border-radius:6px;padding:7px 9px;background:var(--td-bg-color-container);color:inherit}label input,label select{margin-left:8px}button{cursor:pointer}button:disabled{opacity:.5;cursor:not-allowed}.primary{background:var(--td-brand-color);border-color:var(--td-brand-color);color:white}.binding-panel{padding:12px;border:1px solid var(--td-component-border);border-radius:8px;margin-bottom:14px;background:var(--td-bg-color-secondarycontainer)}.binding-heading{justify-content:space-between}.binding-status{font-size:12px}.binding-status.saved{color:var(--td-success-color)}.binding-status.saving,.warning{color:var(--td-warning-color)}.error,.binding-status.error,.binding-status.conflict{color:var(--td-error-color)}.bound-item{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:10px 0}.bound-item small{display:block;margin-top:4px;color:var(--td-text-color-secondary)}.notice{border:1px solid var(--td-component-border);padding:12px;border-radius:6px}.remote-toolbar{margin:12px 0}.library-layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:16px}.group-list{border-right:1px solid var(--td-component-border);padding-right:12px}.search-row{display:flex;gap:6px;margin-bottom:12px}.search-row input{min-width:0;flex:1}.group-item{display:block;width:100%;text-align:left;margin-bottom:7px;padding:10px}.group-item small{display:block;color:var(--td-text-color-secondary);overflow-wrap:anywhere;margin-top:4px}.group-item.selected{background:var(--td-brand-color-light);border-color:var(--td-brand-color)}.asset-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.remote-card{border:1px solid var(--td-component-border);border-radius:8px;overflow:hidden;display:flex;flex-direction:column;gap:8px;padding-bottom:9px}.remote-card.selected{border:2px solid var(--td-brand-color)}.remote-card>button{margin:0 8px;font-size:12px}.asset-preview{height:130px;background:var(--td-bg-color-secondarycontainer);display:flex;align-items:center;justify-content:center;color:var(--td-text-color-placeholder);font-size:12px}.asset-preview img,.asset-preview video{width:100%;height:100%;object-fit:contain}.asset-preview audio{width:100%}.asset-info{padding:0 9px;flex:1;overflow-wrap:anywhere}.asset-info strong,.asset-info small{display:block;margin-bottom:5px}.asset-info strong{font-size:13px}.asset-info small{color:var(--td-text-color-secondary);font-size:11px}.asset-info p{font-size:12px;margin:5px 0}.pill{display:inline-block;font-size:10px;padding:2px 5px;background:var(--td-bg-color-component);border-radius:4px;margin-bottom:5px}.pill.active{color:var(--td-success-color)}.pill.processing{color:var(--td-warning-color)}.pill.failed{color:var(--td-error-color)}.load-more{display:block;margin:14px auto}code{overflow-wrap:anywhere}@media(max-width:900px){.asset-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.library-layout{grid-template-columns:190px minmax(0,1fr)}}@media(max-width:650px){.library-layout{grid-template-columns:1fr}.group-list{max-height:180px;overflow:auto;border-right:0}.target-bar select{max-width:230px}}
</style>
