<template>
  <t-dialog
    v-model:visible="guardedVisible"
    :header="$t('components.editMdPreivew.title')"
    :width="'90vw'"
    :confirm-btn="$t('components.editMdPreivew.confirm')"
    :cancel-btn="$t('components.editMdPreivew.cancel')"
    @confirm="onConfirm"
    @cancel="onCancel"
    @close="onCancel"
    :close-on-overlay-click="false"
    placement="center"
    attach="body">
    <MdEditor
      v-model="editContent"
      :theme="resolvedTheme"
      :toolbars="toolbars"
      :footers="[]"
      style="height: 72vh"
      @onUploadImg="() => {}"
      @drop.prevent
      @paste="onPaste" />
  </t-dialog>
</template>

<script setup lang="ts">
import { MdEditor } from "md-editor-v3";
import {useManualCreativeDraft} from "@/utils/useManualCreativeDraft";
import type { ToolbarNames } from "md-editor-v3";
import { useTheme } from "@/utils/theme";
const { resolvedTheme } = useTheme();

const props = defineProps<{
  content: string;
  draftKey?: string;
  scope?: string;
  version?:number;
  commit?:(value:string,expectedVersion:number)=>Promise<{content:string;version:number}>;
}>();

const dialogVisible = defineModel({
  default: false,
});
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
const emit=defineEmits<{save:[string]}>();
const manual=useManualCreativeDraft<string,{version:number}>({label:"创作Markdown正文",initial:"",id:()=>props.draftKey??"markdown-editor",scope:()=>props.scope??"workspace",load:()=>({value:props.content,meta:{version:Number(props.version??0)}}),commit:async(value,meta)=>{if(props.commit){const saved=await props.commit(value,meta.version);return {value:saved.content,meta:{version:saved.version}};}emit("save",value);return {value,meta};}});
const editContent=manual.draft,guardedVisible=manual.visible;
watch(dialogVisible,visible=>{if(visible)void manual.open();},{immediate:true});
watch(guardedVisible,visible=>{if(!visible)dialogVisible.value=false;});
async function onConfirm(){if(await manual.save()){await manual.close();dialogVisible.value=false;}}
async function onCancel(){if(await manual.close())dialogVisible.value=false;}

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

<style lang="scss" scoped></style>
