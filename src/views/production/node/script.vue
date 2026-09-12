<template>
  <t-card class="script">
    <div class="titleBar dragHandle pr">
      <div class="title c">{{ $t("workbench.production.node.script.title") }}</div>
      <t-button size="small" variant="text" @click="openEdit">{{ $t("workbench.production.edit") }}</t-button>
      <Handle :id="props.handleIds.source" type="source" :position="Position.Right" style="right: calc(-1 * var(--td-comp-paddingLR-xl))" />
    </div>
    <div class="content">
      <MdPreview v-model="script" :theme="resolveThemeMode(themeSetting.mode)" />
    </div>
    <Handle :id="props.handleIds.assets" type="source" :position="Position.Bottom" />
  </t-card>

  <t-dialog
    v-model:visible="dialogVisible"
    :header="$t('workbench.production.node.script.editDialog')"
    :width="'90vw'"
    confirm-btn="保存"
    cancel-btn="关闭"
    @confirm="onConfirm"
    @cancel="onCancel"
    @close="onCancel"
    :close-on-overlay-click="false"
    placement="center"
    attach="body">
    <div class="autosaveStatus">{{ saveStatus }}</div>
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
import { Handle, Position } from "@vue-flow/core";
import { MdEditor, MdPreview } from "md-editor-v3";
import type { ToolbarNames } from "md-editor-v3";
import settingStore from "@/stores/setting";
import { resolveThemeMode } from "@/utils/theme";
import productionAgentStore from "@/stores/productionAgent";
import projectStore from "@/stores/project";
import axios from "@/utils/axios";
import { createIdempotencyKey } from "@/utils/idempotency";
const { themeSetting } = storeToRefs(settingStore());

const props = defineProps<{
  id: string;
  handleIds: {
    assets: string;
    source: string;
  };
}>();

const script = defineModel<string>({ required: true });


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

const manual=useManualCreativeDraft<string,{id:number;projectId:number;name:string;version:number;workspaceVersion:number}>({
  label:"剧本",initial:"",id:()=>`script:${projectStore().project?.id}:${productionAgentStore().episodesId}`,scope:()=>`project:${projectStore().project?.id}:episode:${productionAgentStore().episodesId}`,
  load:async()=>{const projectId=Number(projectStore().project?.id);const id=productionAgentStore().episodesId;const response:any=await axios.post("/script/getScrptApi",{projectId,name:""});const row=response.data.find((item:any)=>Number(item.id)===id);if(!row)throw new Error("当前剧集不可用");return {value:row.content,meta:{id:Number(row.id),projectId,name:row.name,version:Number(row.version),workspaceVersion:Number(response.workspaceVersion)}};},
  commit:async(value,meta)=>{const body={id:meta.id,projectId:meta.projectId,name:meta.name,content:value,expectedVersion:meta.version,workspaceExpectedVersion:meta.workspaceVersion};const signature=JSON.stringify(body);if(saveIntent?.signature!==signature)saveIntent={signature,key:createIdempotencyKey("script-manual-save")};const {data}:any=await axios.post("/script/updateScript",{...body,idempotencyKey:saveIntent.key});saveIntent=undefined;return {value,meta:{...meta,version:Number(data.script.version),workspaceVersion:Number(data.workspaceVersion)}};},
  onSaved:(saved)=>{if(productionAgentStore().episodesId===saved.meta.id && Number(projectStore().project?.id)===saved.meta.projectId)script.value=saved.value;},
});
let saveIntent:{signature:string;key:string}|undefined;
const editContent=manual.draft,dialogVisible=manual.visible,saveStatus=manual.status;
watch(()=>script.value,()=>{void manual.observeSaved().catch(()=>undefined);});
function openEdit(){void manual.open();}
async function onConfirm(){if(await manual.save())await manual.close();}
async function onCancel(){await manual.close();}

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
.script {
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
      box-shadow: none;
    }

    :deep(.md-editor-preview-wrapper) {
      padding: 0;
    }
  }
}
</style>
