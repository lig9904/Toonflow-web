<template>
  <div v-if="sameSessionUser" class="prompt-management">
    <header class="page-heading">
      <div><h3>提示词管理</h3><p>共 {{ entries.length }} 项。人工修改先保留为草稿，明确保存后对下一次运行生效。</p></div>
      <button class="secondary" :disabled="loading" @click="loadPrompts">{{ loading ? '读取中…' : '刷新列表' }}</button>
    </header>
    <div v-if="loadError" class="notice error" role="alert">{{ loadError }}</div>
    <div class="management-grid">
      <aside class="prompt-sidebar">
        <input v-model="search" class="search" placeholder="搜索名称、用途或键名" aria-label="搜索提示词" />
        <div class="group-filters" aria-label="提示词分组">
          <button v-for="group in groups" :key="group.key" :class="{ active: groupFilter === group.key }" @click="groupFilter = group.key">{{ group.label }}</button>
        </div>
        <div v-for="group in visibleGroups" :key="group.key" class="prompt-group">
          <h4>{{ group.label }} <span>{{ group.items.length }}</span></h4>
          <button v-for="entry in group.items" :key="entry.key" class="prompt-item" :class="{ selected: selectedKey === entry.key }" @click="selectPrompt(entry.key)">
            <span class="item-title">{{ entry.name }} <span class="item-state" :class="states[entry.key]?.status">{{ shortStatus(entry.key) }}</span></span>
            <span class="item-key">{{ entry.key }}</span>
          </button>
        </div>
        <p v-if="!visibleGroups.length && !loading" class="empty">没有匹配的提示词</p>
      </aside>
      <main v-if="current" class="prompt-editor">
        <div class="editor-heading">
          <div><h3>{{ current.entry.name }}</h3><code>{{ current.entry.key }}</code></div>
          <span class="badge">{{ current.entry.customized ? '自定义版本' : '默认版本' }}</span>
        </div>
        <dl class="metadata">
          <dt>生效来源</dt><dd>{{ current.entry.source }}<span v-if="current.entry.file"> · {{ current.entry.file }}</span></dd>
          <dt>使用位置</dt><dd>{{ current.entry.usedBy.join('、') }}</dd>
          <dt>当前版本</dt><dd><code :title="current.entry.version">{{ shortVersion(current.entry.version) }}</code> · {{ formatDate(current.entry.updatedAt) }}</dd>
        </dl>
        <details class="context-details">
          <summary>必要上下文与不可编辑的执行协议</summary>
          <p>上下文：{{ current.entry.requiredContext.join('、') }}</p>
          <p>正文必需变量：{{ current.entry.requiredVariables.length ? current.entry.requiredVariables.join('、') : '无占位符要求，上下文由调用方注入' }}</p>
          <ul><li v-for="contract in current.entry.codeContracts" :key="contract">{{ contract }}</li></ul>
        </details>
        <div v-if="current.status === 'conflict'" class="notice conflict" role="alert">
          <strong>版本冲突，本地草稿已保留</strong><p>{{ current.error }}</p>
          <p v-if="current.conflictVersion">服务端版本：<code>{{ shortVersion(current.conflictVersion) }}</code></p>
          <div class="button-row"><button class="secondary" @click="resolveConflict(false)">读取服务端并替换本地草稿</button><button class="primary" @click="resolveConflict(true)">保留草稿，基于最新版本保存</button></div>
        </div>
        <div v-else-if="current.error" class="notice error" role="alert">{{ current.error }} <button v-if="current.status === 'error'" class="text-button" @click="controller.save(selectedKey)">重试保存</button></div>
        <label class="editor-label" for="managed-prompt-content">提示词正文 <span>点击“保存正文”后生效</span></label>
        <textarea id="managed-prompt-content" class="content-input" :value="current.draft" :readonly="!current.entry.editable" spellcheck="false" @input="editContent" />
        <div class="save-row" aria-live="polite"><span :class="['save-status', current.status]">{{ statusText }}</span><span>{{ current.draft.length.toLocaleString() }} / 100,000 字符</span></div>
        <div class="button-row actions">
          <button class="primary" :disabled="current.status === 'saving' || current.status === 'conflict' || current.status === 'invalid'" @click="controller.save(selectedKey)">保存正文</button>
          <button class="secondary" :disabled="!canMutate" @click="restoreDefault">恢复默认</button>
          <button class="secondary" :disabled="panelLoading" @click="showHistory">版本历史</button>
          <button class="secondary" :disabled="panelLoading || current.status === 'saving'" @click="showPreview">组合预览</button>
          <button v-if="controller.dirty(selectedKey) && ['invalid', 'pending'].includes(current.status)" class="text-button" @click="controller.edit(selectedKey, current.entry.content)">撤销未保存编辑</button><span v-if="controller.dirty(selectedKey)" class="muted">恢复与回滚需先保存当前草稿</span>
        </div>
        <details class="default-details"><summary>查看当前默认内容</summary><pre>{{ current.entry.defaultContent }}</pre></details>
        <section v-if="panelKey === selectedKey && panel" class="detail-panel">
          <div class="panel-heading"><h4>{{ panel === 'history' ? '版本历史' : '组合预览' }}</h4><button class="text-button" @click="panel = ''">收起</button></div>
          <div v-if="panel === 'preview' && isVideoPrompt" class="preview-config">
            <p class="muted">按已启用模型的真实能力编译。以下为本次预览参数，已选项目会一并载入其风格规范；不会更改生成设置或调用模型。</p>
            <div class="preview-fields">
              <label>视频模型<select aria-label="视频模型" v-model="previewModel" :disabled="modelsLoading" @change="loadPreviewCapabilities"><option value="">{{ modelsLoading ? '读取模型中…' : '选择已启用视频模型' }}</option><option v-for="model in previewModels" :key="model.id + ':' + model.value" :value="model.id + ':' + model.value">{{ model.name }} · {{ model.label }}</option></select></label>
              <label>实际模式<select aria-label="实际模式" v-model="previewMode" :disabled="!previewCapabilities" @change="syncPreviewReferences"><option value="">选择模式</option><option v-for="mode in previewModes" :key="mode.value" :value="mode.value">{{ mode.label }}</option></select></label>
              <label>参考媒体数量<input v-model.number="previewReferenceCount" type="number" :min="referenceBounds.min" :max="referenceBounds.max" step="1" :disabled="!previewMode || referenceBounds.max === 0" /></label>
              <label>示例脚本时长（秒）<input v-model.number="previewScriptDuration" type="number" min="0.1" step="0.1" /></label>
              <label>生成时长（秒）<select v-model.number="previewDuration" :disabled="!previewCapabilities" @change="syncPreviewResolution"><option v-for="duration in previewDurations" :key="duration" :value="duration">{{ duration }}</option></select></label>
              <label>分辨率<select aria-label="分辨率" v-model="previewResolution" :disabled="!previewCapabilities"><option v-for="resolution in previewResolutions" :key="resolution" :value="resolution">{{ resolution }}</option></select></label>
            </div>
            <label class="audio-option"><input v-model="previewAudio" type="checkbox" :disabled="previewCapabilities?.audio !== 'optional'" />生成音频（{{ previewCapabilities?.audio === 'optional' ? '模型可选' : previewCapabilities?.audio === true ? '模型固定开启' : '模型未开启' }}）</label>
            <p v-if="modelError" class="notice error">{{ modelError }}</p>
            <button class="primary" :disabled="!canCompilePreview || panelLoading" @click="compilePreview">编译当前模型与模式</button>
          </div>
          <p v-if="panelLoading">读取中…</p><p v-if="panelError" class="notice error">{{ panelError }}</p>
          <template v-if="panel === 'history' && !panelLoading">
            <p class="muted">回滚会创建新版本并保留历史。最多显示最近 100 条。</p>
            <p v-if="!historyItems.length" class="empty">还没有保存历史</p>
            <div v-for="item in historyItems" :key="item.version" class="history-item">
              <details><summary>{{ historyOperation(item.operation) }} · {{ formatDate(item.createdAt) }} · {{ shortVersion(item.version) }} <span v-if="item.version === current.entry.version">（当前）</span></summary><p class="muted">操作者：{{ item.actor }}</p><pre>{{ item.content }}</pre></details>
              <button class="secondary" :disabled="!canMutate || item.version === current.entry.version" @click="restoreHistory(item.version)">恢复此版本</button>
            </div>
          </template>
          <template v-if="panel === 'preview' && !panelLoading && preview">
            <div class="notice">{{ preview.note || preview.notice || '管理层组合预览，实际运行还需模型、模式、真实资源和执行协议。' }}</div>
            <p v-if="controller.dirty(selectedKey)" class="notice">当前预览使用服务端已保存版本，本地未保存草稿不在其中。</p>
            <p class="muted">{{ preview.previewKind === 'compiled-video-prompt' ? '已编译的视频系统规范' : '管理层内容；尚未提供具体模型、模式与本次运行上下文' }}</p>
            <div v-for="part in preview.parts || []" :key="part.key" class="preview-part"><h5>{{ part.key }} · {{ shortVersion(part.version) }}</h5><pre>{{ part.content }}</pre></div>
            <p v-if="preview.context" class="muted">实际分流：{{ preview.context.actualMode }} · 模型：{{ preview.context.model }} · 脚本 {{ preview.context.scriptDuration }} 秒 / 生成 {{ preview.context.generation.duration }} 秒 · {{ preview.context.generation.resolution }} · 音频 {{ preview.context.generation.audio ? '开启' : '关闭' }}</p>
            <p v-if="preview.versions?.length" class="muted">生效版本：{{ preview.versions.map(item => item.key + '@' + shortVersion(item.version)).join('、') }}</p>
            <pre v-if="!preview.parts?.length">{{ preview.system || preview.content }}</pre>
            <details v-if="preview.reviewSystem"><summary>语义核验规范</summary><pre>{{ preview.reviewSystem }}</pre></details>
            <details v-if="preview.visualManual"><summary>项目视觉风格规范</summary><pre>{{ preview.visualManual }}</pre></details>
            <p v-if="preview.runtimeContextRequired?.length" class="muted">运行仍需：{{ preview.runtimeContextRequired.join('、') }}</p>
          </template>
        </section>
      </main>
      <div v-else class="empty">{{ loading ? '正在读取提示词…' : '选择提示词查看和编辑' }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import axios from "@/utils/axios";
import projectStore from "@/stores/project";
import userStore from "@/stores/user";
import { registerCreativeDraft, confirmCreativeDrafts } from "@/utils/creativeDrafts";
import { getPromptDraftSession, type PromptEntry, type PromptDraft } from "./promptDraftController";
interface HistoryItem { version: string; content: string; actor: string; operation: string; createdAt: string }
interface Preview { reviewSystem?: string; visualManual?: string; versions?: Array<{key: string; version: string}>; context?: { actualMode: string; model: string; scriptDuration: number; generation: { duration: number; resolution: string; audio: boolean } }; previewKind: string; content?: string; system?: string; note?: string; notice?: string; parts?: Array<{ key: string; version: string; content: string }>; runtimeContextRequired?: string[] }
const account = userStore();
const sessionUserId = Number(account.user?.id);
const sameSessionUser = computed(() => Number(account.user?.id) === sessionUserId && sessionUserId > 0);
const { states, controller } = getPromptDraftSession(sessionUserId, {
  autoSave: false,
  currentUserId: () => account.user?.id,
  createStates: () => reactive<Record<string, PromptDraft>>({}),
  write: async (operation, input) => (await axios.post(`/setting/promptManage/${operation}`, input)).data as PromptEntry,
  read: async key => (await axios.post("/setting/promptManage/promptDetail", { key })).data as PromptEntry,
});
const selectedKey = ref("");
const search = ref("");
const groupFilter = ref("all");
const loading = ref(false);
const loadError = ref("");
const panel = ref<"" | "history" | "preview">("");
const panelKey = ref("");
const panelLoading = ref(false);
const panelError = ref("");
const historyItems = ref<HistoryItem[]>([]);
const preview = ref<Preview>();
interface PreviewModel { id: string; label: string; value: string; name: string }
interface PreviewCapabilities { type: string; mode: Array<string | string[]>; audio: boolean | "optional"; durationResolutionMap: Array<{ duration: number[]; resolution: string[] }> }
const previewModels = ref<PreviewModel[]>([]);
const previewModel = ref("");
const previewCapabilities = ref<PreviewCapabilities>();
const previewMode = ref("");
const previewReferenceCount = ref(0);
const previewScriptDuration = ref(4);
const previewDuration = ref(0);
const previewResolution = ref("");
const previewAudio = ref(false);
const modelsLoading = ref(false);
const modelError = ref("");
let capabilitySequence = 0;
const isVideoPrompt = computed(() => current.value?.entry.group === "video" || ["common.videoPromptGeneration", "review.videoPromptReview"].includes(selectedKey.value));
const previewModes = computed(() => (previewCapabilities.value?.mode || []).map(mode => ({ value: JSON.stringify(mode), label: Array.isArray(mode) ? mode.join(" + ") : ({ text: "文生视频", singleImage: "单图首帧", startEndRequired: "首尾帧（必需）", endFrameOptional: "首帧必需、尾帧可选", startFrameOptional: "首帧可选、尾帧必需" } as Record<string,string>)[mode] || mode })));
const previewDurations = computed(() => [...new Set((previewCapabilities.value?.durationResolutionMap || []).flatMap(item => item.duration))].filter(value => Number.isFinite(value) && value > 0).sort((a,b) => a-b));
const previewResolutions = computed(() => [...new Set((previewCapabilities.value?.durationResolutionMap || []).filter(item => item.duration.includes(previewDuration.value)).flatMap(item => item.resolution))]);
const referenceBounds = computed(() => {
  const mode = previewMode.value ? JSON.parse(previewMode.value) : undefined;
  if (mode === "singleImage") return { min: 1, max: 1 };
  if (mode === "startEndRequired") return { min: 2, max: 2 };
  if (mode === "endFrameOptional" || mode === "startFrameOptional") return { min: 1, max: 2 };
  if (Array.isArray(mode)) return { min: 0, max: mode.reduce((sum, item) => sum + (/^(image|video|audio)Reference:\d+$/.test(item) ? Number(item.split(":")[1]) : 0), 0) };
  return { min: 0, max: 0 };
});
const canCompilePreview = computed(() => Boolean(previewModel.value && previewMode.value && previewCapabilities.value && previewDuration.value > 0 && previewResolution.value && previewScriptDuration.value > 0 && Number.isInteger(previewReferenceCount.value) && previewReferenceCount.value >= referenceBounds.value.min && previewReferenceCount.value <= referenceBounds.value.max));
function syncPreviewReferences() { previewReferenceCount.value = referenceBounds.value.min; }
function syncPreviewResolution() { if (!previewResolutions.value.includes(previewResolution.value)) previewResolution.value = previewResolutions.value[0] || ""; }
async function loadPreviewModels() {
  if (previewModels.value.length || modelsLoading.value) return;
  modelsLoading.value = true; modelError.value = "";
  try { const { data } = await axios.post("/modelSelect/getModelList", { type: "video" }); previewModels.value = Array.isArray(data) ? data : []; if (!previewModels.value.length) modelError.value = "未配置已启用的视频模型，可继续查看管理层预览。"; }
  catch (error) { modelError.value = (error as Error)?.message || "无法读取当前视频模型配置。"; }
  finally { modelsLoading.value = false; }
}
async function loadPreviewCapabilities() {
  const model = previewModel.value; const sequence = ++capabilitySequence; previewCapabilities.value = undefined; previewMode.value = ""; previewDuration.value = 0; previewResolution.value = ""; modelError.value = "";
  if (!model) return;
  try {
    const { data } = await axios.post("/modelSelect/getModelDetail", { modelId: model });
    if (disposed || sequence !== capabilitySequence || model !== previewModel.value) return;
    if (!data || data.type !== "video" || !Array.isArray(data.mode) || !Array.isArray(data.durationResolutionMap)) throw new Error("当前模型缺少可用的视频能力配置");
    previewCapabilities.value = data; previewMode.value = previewModes.value[0]?.value || "";
    previewDuration.value = previewDurations.value.find(value => value >= previewScriptDuration.value) || previewDurations.value[0] || 0;
    previewAudio.value = data.audio === true; syncPreviewResolution(); syncPreviewReferences();
  } catch (error) { if (sequence === capabilitySequence) modelError.value = (error as Error)?.message || "读取模型能力失败"; }
}
async function compilePreview() {
  if (!canCompilePreview.value) return;
  const key = selectedKey.value; const sequence = ++panelSequence; panelLoading.value = true; panelError.value = "";
  try {
    const { data } = await axios.post("/setting/promptManage/previewPrompt", { key, ...(Number(projectStore().project?.id) > 0 ? { projectId: Number(projectStore().project?.id) } : {}), model: previewModel.value, mode: JSON.parse(previewMode.value), referenceCount: previewReferenceCount.value, scriptDuration: previewScriptDuration.value, generation: { duration: previewDuration.value, resolution: previewResolution.value, audio: previewAudio.value } });
    if (!disposed && sequence === panelSequence && key === selectedKey.value) preview.value = data;
  } catch (error) { if (sequence === panelSequence) panelError.value = (error as Error)?.message || "组合预览失败"; }
  finally { if (sequence === panelSequence) panelLoading.value = false; }
}

let panelSequence = 0;
let disposed = false;
const groups = [{ key: "all", label: "全部" }, { key: "common", label: "通用" }, { key: "video", label: "视频模式" }, { key: "skill", label: "内置 Skill" }, { key: "review", label: "核验" }];

const entries = computed(() => Object.values(states).map(s => s.entry));
const current = computed(() => states[selectedKey.value]);
const visibleGroups = computed(() => groups.filter(g => g.key !== "all" && (groupFilter.value === "all" || g.key === groupFilter.value)).map(group => ({ ...group, items: entries.value.filter(entry => entry.group === group.key && `${entry.key} ${entry.name} ${entry.usedBy.join(' ')} ${entry.source}`.toLowerCase().includes(search.value.trim().toLowerCase())) })).filter(g => g.items.length));
const canMutate = computed(() => current.value && !controller.dirty(selectedKey.value) && current.value.status === "saved");
const statusText = computed(() => ({ saved: "已保存", pending: "未保存草稿", saving: "保存中…", conflict: "版本冲突，草稿已保留", error: "保存失败，草稿已保留", invalid: "内容未保存" })[current.value?.status ?? "saved"]);
function shortStatus(key: string) { const state = states[key]; return state.status === "saved" ? (state.entry.customized ? "自定义" : "默认") : ({ pending: "待保存", saving: "保存中", conflict: "冲突", error: "失败", invalid: "未保存" })[state.status]; }
function shortVersion(version: string) { return version?.slice(0, 12) || "—"; }
function formatDate(value: string | null) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "初始默认版本"; }
function historyOperation(value: string) { return ({ snapshot: "修改前快照", save: "保存", reset: "恢复默认", restore: "历史回滚" } as Record<string, string>)[value] || value; }
async function selectPrompt(key: string) { if(key!==selectedKey.value && !(await confirmCreativeDrafts({ids:[`prompt-settings:${sessionUserId}`],action:"切换提示词正文"})))return; selectedKey.value = key; panel.value = ""; panelSequence++; panelLoading.value = false; }
function editContent(event: Event) { controller.edit(selectedKey.value, (event.target as HTMLTextAreaElement).value); }
async function loadPrompts() {
  if (loading.value || !sameSessionUser.value) return; if(!(await confirmCreativeDrafts({ids:[`prompt-settings:${sessionUserId}`],action:"刷新提示词"})))return; loading.value = true; loadError.value = "";
  const versionsAtRead = new Map(Object.entries(states).map(([key, state]) => [key, state.entry.version]));
  try {
    const response = await axios.post("/setting/promptManage/listPrompts");
    if (disposed || !sameSessionUser.value) return;
    controller.seed((response.data as PromptEntry[]).filter(entry => !states[entry.key] || states[entry.key].entry.version === versionsAtRead.get(entry.key)));
    if (!selectedKey.value) selectedKey.value = entries.value[0]?.key || "";
  }
  catch (error) { loadError.value = (error as Error)?.message || "读取提示词失败，请重试。"; }
  finally { loading.value = false; }
}
async function resolveConflict(keepDraft: boolean) { const key=selectedKey.value; await controller.resolveConflict(key, keepDraft); if(keepDraft)await controller.save(key); }
async function restoreDefault() { const key = selectedKey.value; await controller.mutate(key, "resetPrompt"); if (key === selectedKey.value) panel.value = ""; }
async function restoreHistory(version: string) { const key = selectedKey.value; await controller.mutate(key, "restorePrompt", version); if (key === selectedKey.value && states[key].status === "saved") await showHistory(); }
async function loadPanel(kind: "history" | "preview") {
  const key = selectedKey.value; const sequence = ++panelSequence; panel.value = kind; panelKey.value = key; panelLoading.value = true; panelError.value = ""; preview.value = undefined; historyItems.value = [];
  try {
    const response = await axios.post(`/setting/promptManage/${kind === "history" ? "promptHistory" : "previewPrompt"}`, { key });
    if (disposed || sequence !== panelSequence || key !== selectedKey.value) return;
    if (kind === "history") historyItems.value = response.data.items || []; else preview.value = response.data;
  } catch (error) { if (sequence === panelSequence) panelError.value = (error as Error)?.message || "读取失败，请重试。"; }
  finally { if (sequence === panelSequence) panelLoading.value = false; }
}
const showHistory = () => loadPanel("history");
const showPreview = () => { if (isVideoPrompt.value) void loadPreviewModels(); return loadPanel("preview"); };
const unregisterCreative=registerCreativeDraft({id:`prompt-settings:${sessionUserId}`,scope:`user:${sessionUserId}:prompt-settings`,label:"提示词正文",isDirty:()=>sameSessionUser.value && controller.hasUnsaved(),save:async()=>{for(const key of Object.keys(states))await controller.save(key);return !controller.hasUnsaved();},discard:async()=>{for(const key of Object.keys(states))if(controller.dirty(key)||states[key].status!=="saved")await controller.resolveConflict(key,false);}});
function beforeUnload(event: BeforeUnloadEvent) { if (controller.hasUnsaved()) { event.preventDefault(); event.returnValue = ""; } }
onMounted(() => { void loadPrompts(); window.addEventListener("beforeunload", beforeUnload); });
onBeforeUnmount(() => { disposed = true; panelSequence++; window.removeEventListener("beforeunload", beforeUnload); controller.dispose(); unregisterCreative(); });
</script>

<style scoped lang="scss">
.prompt-management { color: var(--td-text-color-primary); font-size: 13px; }
.page-heading, .editor-heading, .save-row, .panel-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
h3, h4, h5, p { margin: 0; }
.page-heading { margin-bottom: 18px; h3 { font-size: 19px; margin-bottom: 6px; } p { color: var(--td-text-color-secondary); } }
button { font: inherit; cursor: pointer; border: 1px solid var(--td-component-border); border-radius: 6px; padding: 7px 11px; background: var(--td-bg-color-container); color: inherit; }
button:disabled { opacity: .45; cursor: not-allowed; }
button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--td-brand-color); outline-offset: 2px; }
.primary { background: var(--td-brand-color); color: #fff; border-color: var(--td-brand-color); }
.text-button { border: 0; color: var(--td-brand-color); background: transparent; }
.management-grid { display: grid; grid-template-columns: 270px minmax(0, 1fr); gap: 20px; align-items: start; }
.prompt-sidebar { border: 1px solid var(--td-component-border); border-radius: 9px; padding: 12px; max-height: 78vh; overflow-y: auto; }
.search { width: 100%; box-sizing: border-box; padding: 9px; border: 1px solid var(--td-component-border); border-radius: 6px; background: var(--td-bg-color-container); color: inherit; font: inherit; }
.group-filters { display: flex; gap: 5px; flex-wrap: wrap; margin: 10px 0 16px; button { padding: 5px 7px; font-size: 12px; } .active { color: var(--td-brand-color); background: var(--td-brand-color-light); border-color: var(--td-brand-color); } }
.prompt-group { margin-top: 16px; h4 { font-size: 12px; color: var(--td-text-color-secondary); padding: 0 8px 6px; } h4 span { float: right; } }
.prompt-item { width: 100%; text-align: left; padding: 10px 8px; border: 1px solid transparent; margin-bottom: 3px; display: block; &.selected { background: var(--td-brand-color-light); border-color: var(--td-brand-color); } }
.item-title { display: flex; justify-content: space-between; gap: 8px; font-weight: 600; }
.item-key { display: block; color: var(--td-text-color-placeholder); font-size: 10px; margin-top: 5px; overflow-wrap: anywhere; }
.item-state { font-size: 10px; white-space: nowrap; color: var(--td-text-color-secondary); font-weight: 400; }
.conflict, .error, .invalid { color: var(--td-error-color); }
.pending, .saving { color: var(--td-warning-color); }
.prompt-editor { min-width: 0; }
.editor-heading { align-items: flex-start; h3 { font-size: 18px; margin-bottom: 6px; } code { color: var(--td-text-color-secondary); } }
.badge { white-space: nowrap; border: 1px solid var(--td-component-border); border-radius: 20px; padding: 4px 10px; font-size: 12px; }
.metadata { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 8px 12px; margin: 18px 0; dt { color: var(--td-text-color-secondary); } dd { margin: 0; overflow-wrap: anywhere; } }
.context-details, .default-details { border: 1px solid var(--td-component-border); border-radius: 6px; padding: 10px 12px; margin-bottom: 14px; summary { cursor: pointer; } p, ul { margin: 10px 0 0; line-height: 1.7; overflow-wrap: anywhere; } }
.editor-label { display: flex; justify-content: space-between; margin: 15px 0 8px; span { color: var(--td-text-color-placeholder); font-size: 12px; } }
.content-input { width: 100%; min-height: 390px; resize: vertical; box-sizing: border-box; padding: 15px; background: var(--td-bg-color-container); color: inherit; font: 13px/1.85 ui-monospace, SFMono-Regular, Menlo, monospace; border: 1px solid var(--td-component-border); border-radius: 8px; }
.save-row { margin: 8px 0; font-size: 12px; color: var(--td-text-color-secondary); }
.save-status.saved { color: var(--td-success-color); }
.button-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.actions { margin: 15px 0; }
.muted, .empty { color: var(--td-text-color-secondary); font-size: 12px; line-height: 1.8; }
.empty { padding: 20px 0; }
.notice { border: 1px solid var(--td-component-border); background: var(--td-bg-color-secondarycontainer); padding: 12px; border-radius: 7px; margin: 12px 0; line-height: 1.7; p { margin: 5px 0; } .button-row { margin-top: 10px; } }
.notice.conflict, .notice.error { border-color: var(--td-error-color); }
.detail-panel { border-top: 1px solid var(--td-component-border); margin-top: 20px; padding-top: 14px; }
.history-item { border-bottom: 1px solid var(--td-component-border); padding: 13px 0; display: flex; align-items: flex-start; gap: 12px; details { flex: 1; min-width: 0; } summary { cursor: pointer; line-height: 1.7; } button { white-space: nowrap; } }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.8 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 12px; border-radius: 6px; background: var(--td-bg-color-secondarycontainer); max-height: 500px; overflow-y: auto; }
.preview-config { border: 1px solid var(--td-component-border); padding: 12px; border-radius: 8px; margin: 12px 0; }
.preview-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 12px 0; label { font-size: 12px; } select, input { display: block; box-sizing: border-box; width: 100%; padding: 7px; margin-top: 5px; border: 1px solid var(--td-component-border); border-radius: 5px; color: inherit; background: var(--td-bg-color-container); } }
.audio-option { display: block; margin-bottom: 12px; font-size: 12px; }
.preview-part h5 { margin: 14px 0 6px; font-size: 12px; overflow-wrap: anywhere; }
@media (max-width: 960px) { .management-grid { grid-template-columns: 220px minmax(0, 1fr); gap: 12px; } }
@media (max-width: 720px) { .management-grid { grid-template-columns: 1fr; } .prompt-sidebar { max-height: 260px; } .content-input { min-height: 330px; } .editor-label { flex-wrap: wrap; gap: 6px; } }
</style>
