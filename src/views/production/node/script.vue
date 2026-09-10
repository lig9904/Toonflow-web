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
    confirm-btn="完成"
    :cancel-btn="null"
    @confirm="onConfirm"
    @cancel="onCancel"
    @close="onCancel"
    :close-on-overlay-click="false"
    placement="center"
    attach="body">
    <div class="autosaveStatus">{{ saveStatus }}</div>
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
const editContent = ref("");
const dialogVisible = ref(false);

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

const saveStatus = ref("自动保存");
let editor: { id: number; projectId: number; name: string; version: number; workspaceVersion: number } | undefined;
let lastSavedText = "";
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> | undefined;
let saveIntent: { signature: string; key: string } | undefined;
async function openEdit() {
  try {
    const projectId = Number(projectStore().project?.id);
    const response: any = await axios.post("/script/getScrptApi", { projectId, name: "" });
    const row = response.data.find((item: any) => Number(item.id) === productionAgentStore().episodesId);
    if (!row) throw new Error("当前剧集不可用");
    editor = { id: Number(row.id), projectId, name: row.name, version: Number(row.version), workspaceVersion: Number(response.workspaceVersion) };
    editContent.value = row.content;
    lastSavedText = row.content;
    script.value = row.content;
    saveStatus.value = "自动保存";
    dialogVisible.value = true;
  } catch (error: any) { window.$message.error(error?.message || "无法加载剧本版本"); }
}
async function saveDraft(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  if (saving) { await saving; return saveDraft(); }
  if (!editor || editContent.value === lastSavedText) return;
  const text = editContent.value;
  const body = { id: editor.id, projectId: editor.projectId, name: editor.name, content: text, expectedVersion: editor.version, workspaceExpectedVersion: editor.workspaceVersion };
  const signature = JSON.stringify(body);
  if (saveIntent?.signature !== signature) saveIntent = { signature, key: createIdempotencyKey("script-autosave") };
  saveStatus.value = "保存中…";
  saving = axios.post("/script/updateScript", { ...body, idempotencyKey: saveIntent.key }).then(({ data }: any) => {
    editor!.version = Number(data.script.version);
    editor!.workspaceVersion = Number(data.workspaceVersion);
    lastSavedText = text;
    script.value = text;
    saveIntent = undefined;
    saveStatus.value = "已保存";
  }).catch((error: any) => {
    saveStatus.value = `保存失败，草稿已保留：${error?.message || "请稍后重试"}`;
  }).finally(() => { saving = undefined; });
  await saving;
}
watch(editContent, () => {
  if (!dialogVisible.value) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void saveDraft(); }, 700);
});
onBeforeUnmount(() => { if (saveTimer) clearTimeout(saveTimer); });
async function onConfirm() { await saveDraft(); dialogVisible.value = saveStatus.value.startsWith("保存失败"); }
async function onCancel() { await onConfirm(); }

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
