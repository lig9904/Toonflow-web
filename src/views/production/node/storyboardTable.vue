<template>
  <t-card class="storyboardTable">
    <div class="titleBar dragHandle pr">
      <div class="title c">{{ $t("workbench.production.node.storyboardTable.title") }}</div>
      <t-tag v-if="preview" theme="primary" variant="light">正在生成 · 未保存</t-tag>
      <t-button size="small" variant="text" :disabled="!!preview" @click="openEdit">{{ $t("workbench.production.edit") }}</t-button>
      <Handle :id="props.handleIds.target" type="target" :position="Position.Left" style="left: calc(-1 * var(--td-comp-paddingLR-xl))" />
      <Handle :id="props.handleIds.source" type="source" :position="Position.Right" style="right: calc(-1 * var(--td-comp-paddingLR-xl))" />
    </div>
    <div class="storyboardList">
      <t-empty v-if="!preview?.text && !storyboardTable" style="margin-top: 16px"></t-empty>
      <MdPreview v-else :model-value="preview?.text ?? storyboardTable" :theme="resolveThemeMode(themeSetting.mode)" />
    </div>
  </t-card>

  <t-dialog
    v-model:visible="dialogVisible"
    :header="$t('workbench.production.node.storyboardTable.editDialog')"
    :width="'90vw'"
    confirm-btn="完成"
    :cancel-btn="null"
    @confirm="onConfirm"
    @cancel="onCancel"
    @close="onCancel"
    :close-on-overlay-click="false"
    placement="center"
    attach="body">
    <div class="autosaveStatus">{{ saveLabel }}<span v-if="editorStore.flowSaveStatus === 'error'">：{{ editorStore.flowSaveError }}</span></div>
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
const { themeSetting } = storeToRefs(settingStore());

const props = defineProps<{
  id: string;
  preview?: { text: string };
  handleIds: {
    target: string;
    source: string;
  };
}>();

const storyboardTable = defineModel<string>({ required: true });
const editContent = ref("");
const dialogVisible = ref(false);
const editorStore = productionAgentStore();
const saveLabel = computed(() => ({ idle: "自动保存", saving: "保存中…", saved: "已保存", error: "保存失败，草稿已保留" })[editorStore.flowSaveStatus]);
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let editingEpisode: number | undefined;
let editBaseText = "";
async function saveDraft() {
  if (saveTimer) clearTimeout(saveTimer);
  if (editingEpisode !== editorStore.episodesId || editContent.value === storyboardTable.value) return;
  if (storyboardTable.value !== editBaseText) {
    editorStore.flowSaveStatus = "error";
    editorStore.flowSaveError = "内容已被其他成员更新，请合并后再保存；当前编辑草稿已保留";
    return;
  }
  storyboardTable.value = editContent.value;
  editBaseText = editContent.value;
  await editorStore.setFlowData(editingEpisode);
}
watch(editContent, () => {
  if (!dialogVisible.value) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void saveDraft(); }, 700);
});
onBeforeUnmount(() => { if (saveTimer) clearTimeout(saveTimer); void saveDraft(); });

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

function openEdit() {
  editingEpisode = editorStore.episodesId;
  editBaseText = storyboardTable.value;
  editContent.value = storyboardTable.value ?? "";
  dialogVisible.value = true;
}

async function onConfirm() {
  await saveDraft();
  dialogVisible.value = editorStore.flowSaveStatus === "error";
}
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
.storyboardTable {
  max-width: 100vw;
  width: fit-content;
  min-width: 100px;
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

  .storyboardList {
    display: flex;
    flex-direction: column;
    margin-top: 8px;

    :deep(.md-editor) {
      border: none;
      box-shadow: none;
    }

    :deep(.md-editor-preview-wrapper) {
      padding: 0;
    }
  }

  .storyboardItem {
    display: flex;
    align-items: flex-start;
    padding: 12px 0;
    border-bottom: 1px solid var(--td-border-level-1-color, #e7e7e7);

    &:last-child {
      border-bottom: none;
    }
  }

  .itemTag {
    flex-shrink: 0;
    width: 36px;
    height: 22px;
    border-radius: 4px;
    color: #fff;
    font-size: 12px;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 12px;
    margin-top: 2px;
  }

  .itemContent {
    flex: 1;
    min-width: 0;
  }

  .itemHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .itemTags {
    display: flex;
    gap: 5px;
    flex-shrink: 0;
    margin-left: 12px;
  }

  .itemTitle {
    font-size: 14px;
    color: var(--td-text-color-primary, #333);
    line-height: 1.5;
  }

  .itemDetail {
    font-size: 12px;
    color: var(--td-text-color-secondary, #999);
    line-height: 1.4;

    .sep {
      margin: 0 6px;
      color: var(--td-border-level-1-color, #ddd);
    }
  }
}
</style>
