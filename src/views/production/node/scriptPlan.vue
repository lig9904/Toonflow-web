<template>
  <t-card class="scriptPlan">
    <div class="titleBar dragHandle pr">
      <div class="title c">{{ $t("workbench.production.node.scriptPlan.title") }}</div>
      <t-tag v-if="preview" theme="primary" variant="light">正在生成 · 未保存</t-tag>
      <t-button size="small" variant="text" :disabled="!!preview" @click="openEdit">{{ $t("workbench.production.edit") }}</t-button>
      <Handle :id="props.handleIds.target" type="target" :position="Position.Left" style="left: calc(-1 * var(--td-comp-paddingLR-xl))" />
      <Handle :id="props.handleIds.source" type="source" :position="Position.Right" style="right: calc(-1 * var(--td-comp-paddingLR-xl))" />
    </div>
    <div class="content">
      <t-empty v-if="!preview?.text && !scriptPlan" style="margin-top: 16px"></t-empty>
      <MdPreview v-else :model-value="preview?.text ?? scriptPlan" :theme="resolveThemeMode(themeSetting.mode)" />
    </div>
  </t-card>

  <t-dialog
    v-model:visible="dialogVisible"
    :header="$t('workbench.production.node.scriptPlan.editDialog')"
    :width="'90vw'"
    confirm-btn="保存"
    cancel-btn="关闭"
    @confirm="onConfirm"
    @cancel="onCancel"
    @close="onCancel"
    :close-on-overlay-click="false"
    placement="center"
    attach="body">
    <div class="autosaveStatus">{{ saveLabel }}</div>
    <div v-if="manual.error.value" class="draftConflict"><t-button size="small" @click="manual.reloadSaved(true)">保留草稿，明确采用最新版本为保存基准</t-button><details><summary>当前保存基准内容</summary><pre>{{ manual.baseline.value }}</pre></details></div>
    <MdEditor
      v-model="editContent"
      :theme="resolveThemeMode(themeSetting.mode)"
      :toolbars="toolbars"
      :footers="[]"
      style="height: 72vh"
      @onUploadImg="() => {}"
      @drop.prevent
      @paste="onPaste" />
  </t-dialog>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useManualCreativeDraft } from "@/utils/useManualCreativeDraft";
import projectStore from "@/stores/project";
import axios from "@/utils/axios";
import { Handle, Position } from "@vue-flow/core";
import { MdEditor, MdPreview } from "md-editor-v3";
import type { ToolbarNames } from "md-editor-v3";
import productionAgentStore from "@/stores/productionAgent";
import settingStore from "@/stores/setting";
import { resolveThemeMode } from "@/utils/theme";
const { themeSetting } = storeToRefs(settingStore());

const props = defineProps<{
  id: string;
  preview?: { text: string };
  handleIds: {
    target: string;
    source: string;
  };
}>();

const scriptPlan = defineModel<string>({ required: true });
const editorStore = productionAgentStore();
const manual = useManualCreativeDraft<string, { projectId:number; scriptId:number; version:number; base:string; snapshot:{scriptPlan:string;storyboardTable:string} }>({
  label: "导演计划", initial: "", id: () => `production:${projectStore().project?.id}:${editorStore.episodesId}:scriptPlan`,
  scope: () => `project:${projectStore().project?.id}:episode:${editorStore.episodesId}`,
  load: async () => {
    const projectId=Number(projectStore().project?.id),scriptId=editorStore.episodesId;
    if(scriptId==null)throw new Error("当前剧集尚未读取");
    const {data}=await axios.post("/production/getFlowData",{projectId,episodesId:scriptId});
    const snapshot={scriptPlan:String(data.scriptPlan ?? ""),storyboardTable:String(data.storyboardTable ?? "")};
    return {value:snapshot.scriptPlan,meta:{projectId,scriptId,version:Number(data.planningVersion),base:snapshot.scriptPlan,snapshot}};
  },
  commit: async (value, meta) => {
    if (Number(projectStore().project?.id)!==meta.projectId || editorStore.episodesId!==meta.scriptId || scriptPlan.value!==meta.base) throw new Error("已保存内容或编辑对象已更新，草稿已保留；请重新核对后保存");
    const snapshot = {...meta.snapshot,scriptPlan:value};
    const response:any=await axios.post("/production/saveFlowData",{projectId:meta.projectId,episodesId:meta.scriptId,expectedPlanningVersion:meta.version,saveIntent:"manual",field:"scriptPlan",allowClear:!value.trim(),data:snapshot});
    const version=Number(response.data?.planningVersion); if(!Number.isFinite(version))throw new Error("保存响应缺少版本");
    return {value,meta:{...meta,version,base:value,snapshot}};
  },
  onSaved: (saved) => { if(editorStore.episodesId===saved.meta.scriptId && Number(projectStore().project?.id)===saved.meta.projectId) { scriptPlan.value=saved.value; editorStore.planningVersion=saved.meta.version; } },
});
const editContent=manual.draft, dialogVisible=manual.visible, saveLabel=manual.status;

const toolbars: ToolbarNames[] = [
  "bold",
  "underline",
  "italic",
  "strikeThrough",
  "-",
  "title",
  "sub",
  "sup",
  "quote",
  "unorderedList",
  "orderedList",
  "task",
  "-",
  "codeRow",
  "code",
  "table",
  "-",
  "revoke",
  "next",
  "=",
  "preview",
];

watch(()=>scriptPlan.value,()=>{void manual.observeSaved().catch(()=>undefined);});
function openEdit() { void manual.open(); }
async function onConfirm() { if(await manual.save()) await manual.close(); }
async function onCancel() { await manual.close(); }

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/") || item.type.startsWith("video/")) {
      e.preventDefault();
      return;
    }
  }
}
</script>

<style lang="scss" scoped>
.scriptPlan {
  max-width: 100vw;
  width: fit-content;
  min-width: 200px;
  user-select: text;
  cursor: default;

  .titleBar {
    cursor: grab;
    user-select: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .title {
    background-color: #000;
    width: fit-content;
    padding: 5px 10px;
    color: #fff;
    border-radius: 8px 0;
    font-size: 16px;
  }

  .content {
    margin-top: 8px;

    :deep(.md-editor) {
      border: none;
    }
  }
}
</style>
