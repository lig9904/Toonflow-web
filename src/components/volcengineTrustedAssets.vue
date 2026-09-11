<template>
  <t-dialog v-model:visible="visible" header="火山可信素材库" :footer="false" width="min(1180px, 95vw)" attach="body" :close-on-overlay-click="false" @close="closeDialog">
    <section class="trusted-assets" data-testid="trusted-assets-dialog">
      <p class="intro">使用火山新入口的已创建素材。真人认证及授权请先在火山控制台完成；此处仅建立绑定，不上传、授权或删除官方素材。</p>
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
onBeforeUnmount(()=>{disposed=true;++groupSequence;++assetSequence;});
</script>
<style scoped>
.trusted-assets{font-size:13px;color:var(--td-text-color-primary);max-height:78vh;overflow:auto;padding:2px 4px}.intro,.muted{color:var(--td-text-color-secondary);line-height:1.7}.intro{margin:0 0 15px}.target-bar,.remote-toolbar,.button-row,.binding-heading{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.target-bar{margin-bottom:14px}.local-preview{width:66px;height:50px;object-fit:contain;border:1px solid var(--td-component-border);border-radius:5px}.target-type{font-size:12px;color:var(--td-text-color-secondary)}label{font-size:12px}input,select,button{font:inherit;border:1px solid var(--td-component-border);border-radius:6px;padding:7px 9px;background:var(--td-bg-color-container);color:inherit}label input,label select{margin-left:8px}button{cursor:pointer}button:disabled{opacity:.5;cursor:not-allowed}.primary{background:var(--td-brand-color);border-color:var(--td-brand-color);color:white}.binding-panel{padding:12px;border:1px solid var(--td-component-border);border-radius:8px;margin-bottom:14px;background:var(--td-bg-color-secondarycontainer)}.binding-heading{justify-content:space-between}.binding-status{font-size:12px}.binding-status.saved{color:var(--td-success-color)}.binding-status.saving,.warning{color:var(--td-warning-color)}.error,.binding-status.error,.binding-status.conflict{color:var(--td-error-color)}.bound-item{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:10px 0}.bound-item small{display:block;margin-top:4px;color:var(--td-text-color-secondary)}.notice{border:1px solid var(--td-component-border);padding:12px;border-radius:6px}.remote-toolbar{margin:12px 0}.library-layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:16px}.group-list{border-right:1px solid var(--td-component-border);padding-right:12px}.search-row{display:flex;gap:6px;margin-bottom:12px}.search-row input{min-width:0;flex:1}.group-item{display:block;width:100%;text-align:left;margin-bottom:7px;padding:10px}.group-item small{display:block;color:var(--td-text-color-secondary);overflow-wrap:anywhere;margin-top:4px}.group-item.selected{background:var(--td-brand-color-light);border-color:var(--td-brand-color)}.asset-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.remote-card{border:1px solid var(--td-component-border);border-radius:8px;overflow:hidden;display:flex;flex-direction:column;gap:8px;padding-bottom:9px}.remote-card.selected{border:2px solid var(--td-brand-color)}.remote-card>button{margin:0 8px;font-size:12px}.asset-preview{height:130px;background:var(--td-bg-color-secondarycontainer);display:flex;align-items:center;justify-content:center;color:var(--td-text-color-placeholder);font-size:12px}.asset-preview img,.asset-preview video{width:100%;height:100%;object-fit:contain}.asset-preview audio{width:100%}.asset-info{padding:0 9px;flex:1;overflow-wrap:anywhere}.asset-info strong,.asset-info small{display:block;margin-bottom:5px}.asset-info strong{font-size:13px}.asset-info small{color:var(--td-text-color-secondary);font-size:11px}.asset-info p{font-size:12px;margin:5px 0}.pill{display:inline-block;font-size:10px;padding:2px 5px;background:var(--td-bg-color-component);border-radius:4px;margin-bottom:5px}.pill.active{color:var(--td-success-color)}.pill.processing{color:var(--td-warning-color)}.pill.failed{color:var(--td-error-color)}.load-more{display:block;margin:14px auto}code{overflow-wrap:anywhere}@media(max-width:900px){.asset-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.library-layout{grid-template-columns:190px minmax(0,1fr)}}@media(max-width:650px){.library-layout{grid-template-columns:1fr}.group-list{max-height:180px;overflow:auto;border-right:0}.target-bar select{max-width:230px}}
</style>
