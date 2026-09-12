<template>
  <div class="skillManagement">
    <aside class="sidebarPanel">
      <t-input v-model="keyword" clearable :placeholder="$t('setting.skillManagement.search')" />
      <div class="treeWrap">
        <t-tree v-if="treeData.length" activable hover line expand-on-click-node :data="treeData" :actived="activedKeys" @active="onTreeActive">
          <template #icon="{ node }">
            <i-folder-open v-if="!node.data.isFile" theme="outline" size="16" />
            <i-file-text v-else-if="node.data.isRoot" theme="outline" size="16" fill="red" />
            <i-file-text v-else theme="outline" size="16" />
          </template>
        </t-tree>
        <t-empty v-else :description="$t('setting.skillManagement.empty')" />
      </div>
    </aside>

    <section class="viewPanel">
      <div v-if="activeEntry" class="viewHeader">
        <span class="fileName">{{ activeEntry }}</span>
        <t-button v-if="!managedDraft" size="small" theme="primary" variant="outline" @click="openEditDialog">{{ $t("setting.skillManagement.edit") }}</t-button>
      </div>

      <div v-if="activeEntry && managedDraft" class="managed-editor">
        <p class="managed-note">此内置 Skill 与提示词管理使用同一生效版本。人工修改为草稿，明确保存后对下一次运行生效。</p>
        <p class="managed-meta">{{ managedDraft.entry.customized ? '自定义' : '默认' }} · 版本 {{ managedDraft.entry.version.slice(0, 12) }} · {{ managedDraft.entry.key }}</p>
        <div v-if="managedDraft.status === 'conflict'" class="managed-error">
          <p>{{ managedDraft.error }}</p>
          <t-button size="small" variant="outline" @click="managedController.resolveConflict(managedKey, false)">读取服务端并替换草稿</t-button>
          <t-button size="small" theme="primary" @click="resolveManagedConflict">保留草稿，基于最新版本保存</t-button>
        </div>
        <p v-else-if="managedDraft.error" class="managed-error">{{ managedDraft.error }} <t-button v-if="managedDraft.status === 'error'" size="small" variant="text" @click="managedController.save(managedKey)">重试</t-button></p>
        <textarea class="managed-content" :value="managedDraft.draft" aria-label="内置 Skill 提示词正文" spellcheck="false" @input="editManaged" />
        <div class="managed-meta">{{ managedStatus }} · {{ managedDraft.draft.length }} 字符 <t-button size="small" theme="primary" :disabled="managedDraft.status === 'conflict' || managedDraft.status === 'invalid' || managedDraft.status === 'saving'" @click="managedController.save(managedKey)">保存正文</t-button></div>
        <details><summary>必要上下文与执行协议</summary><p>{{ managedDraft.entry.requiredContext.join('、') }}</p><p v-for="item in managedDraft.entry.codeContracts" :key="item">{{ item }}</p></details>
      </div>
      <div v-else-if="activeEntry" class="previewWrap">
        <MdPreview :theme="resolvedTheme" :modelValue="content" :toolbars="[]" preview-only preview-theme="github" code-theme="atom" />
      </div>

      <t-empty v-else :description="$t('setting.skillManagement.selectOnTheLeft')" />
    </section>

    <t-dialog
      placement="center"
      v-model:visible="guardedEditVisible"
      :header="$t('setting.skillManagement.edit') + ` ${activeEntry}`"
      width="80vw"
      :confirm-btn="$t('common.save')"
      :confirm-on-enter="false"
      :on-confirm="onSave"
      :loading="isSaving">
      <MdEditor :theme="resolvedTheme" v-model="draft" :toolbars="mdToolbars" preview-theme="github" code-theme="atom" style="height: 72vh" />
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref } from "vue";
import { getPromptDraftSession, type PromptEntry, type PromptDraft } from "./promptDraftController";
import { MdEditor, MdPreview } from "md-editor-v3";
import type { ToolbarNames } from "md-editor-v3";
import { useTheme } from "@/utils/theme";
const { resolvedTheme } = useTheme();
import type { TreeNodeModel, TreeNodeValue, TreeOptionData } from "tdesign-vue-next";
import axios from "@/utils/axios";
import userStore from "@/stores/user";
import {registerCreativeDraft,confirmCreativeDrafts} from "@/utils/creativeDrafts";

const mdToolbars: ToolbarNames[] = [
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

interface TreeItem {
  label: string;
  value: string;
  children?: TreeItem[];
  isFile?: boolean;
  isRoot?: boolean;
}

const entries = ref<string[]>([]);
const activeEntry = ref("");
const keyword = ref("");
const content = ref("");
const draft = ref("");
const editVisible = ref(false);
const isSaving = ref(false);
const managedKey = ref("");
const managedUserId=Number(userStore().user?.id);
const managedPaths = new Map<string, string>();
let loadSequence = 0;
const {states:managedStates,controller:managedController}=getPromptDraftSession(managedUserId,{autoSave:false,currentUserId:()=>userStore().user?.id,createStates:()=>reactive<Record<string,PromptDraft>>({}),write:async(operation,input)=>(await axios.post(`/setting/promptManage/${operation}`,input)).data,read:async key=>(await axios.post("/setting/promptManage/promptDetail",{key})).data});
const unregisterManaged=registerCreativeDraft({id:`skill-settings:${managedUserId}`,scope:`user:${managedUserId}:prompt-settings`,label:"Skill 正文",isDirty:()=>managedController.hasUnsaved(),save:async()=>{for(const key of Object.keys(managedStates))await managedController.save(key);return !managedController.hasUnsaved();},discard:async()=>{for(const key of Object.keys(managedStates))if(managedController.dirty(key))await managedController.resolveConflict(key,false);}});

const managedDraft = computed(() => managedStates[managedKey.value]);
const managedStatus = computed(() => ({ saved: "已保存", saving: "保存中…", pending: "未保存草稿", conflict: "版本冲突，草稿保留", error: "保存失败，草稿保留", invalid: "内容未保存" })[managedDraft.value?.status ?? "saved"]);
function editManaged(event: Event) { managedController.edit(managedKey.value, (event.target as HTMLTextAreaElement).value); }
function beforeUnload(event: BeforeUnloadEvent) { if (managedController.hasUnsaved()) { event.preventDefault(); event.returnValue = ""; } }


const activedKeys = computed(() => (activeEntry.value ? [activeEntry.value] : []));

const filteredEntries = computed(() => {
  let result = entries.value.filter((e) => e.endsWith(".md"));
  if (!keyword.value) return result;
  const kw = keyword.value.toLowerCase();
  return result.filter((e) => e.toLowerCase().includes(kw));
});

const treeData = computed<TreeItem[]>(() => {
  const dirMap = new Map<string, TreeItem>();
  const rootItems: TreeItem[] = [];

  for (const filePath of filteredEntries.value) {
    const parts = filePath.split("/").filter(Boolean);
    let parentChildren = rootItems;
    let cur = "";

    for (let i = 0; i < parts.length; i++) {
      cur = cur ? `${cur}/${parts[i]}` : parts[i];
      const isFile = i === parts.length - 1;

      if (isFile) {
        if (!parentChildren.some((c) => c.value === cur)) {
          parentChildren.push({ label: parts[i], value: cur, isFile: true, isRoot: parts.length === 1 });
        }
      } else {
        let dir = dirMap.get(cur);
        if (!dir) {
          dir = { label: parts[i], value: cur, isFile: false, children: [] };
          dirMap.set(cur, dir);
          parentChildren.push(dir);
        }
        parentChildren = dir.children!;
      }
    }
  }

  const sortItems = (items: TreeItem[]) => {
    items.sort((a, b) => {
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
      return a.label.localeCompare(b.label);
    });
    items.forEach((item) => item.children && sortItems(item.children));
  };
  sortItems(rootItems);

  return rootItems;
});

async function fetchList() {
  try {
    const { data } = await axios.post("/setting/skillManagement/getSkillList");
    entries.value = Array.isArray(data) ? data : [];
  } catch (e) {
    console.error(e);
  }
}

async function loadContent(path: string) {
  const sequence = ++loadSequence;
  managedKey.value = "";
  content.value = "";
  try {
    const { data } = await axios.post("/setting/skillManagement/getSkillContent", { path });
    if (sequence !== loadSequence || path !== activeEntry.value) return;
    if (data?.managedKey) {
      managedPaths.set(data.managedKey, path);
      managedController.seed([data as PromptEntry]);
      managedKey.value = data.managedKey;
    } else content.value = typeof data === "string" ? data : data?.content || "";
  } catch (e) {
    if (sequence === loadSequence) content.value = (e as Error)?.message || "读取 Skill 失败";
  }
}

async function onTreeActive(value: TreeNodeValue[], context: { node: TreeNodeModel<TreeOptionData> }) {
  const key = value[value.length - 1];
  const path = typeof key === "string" ? key : String(key || "");
  const node = context.node.data as TreeItem | undefined;
  if (!path || !node?.isFile || path === activeEntry.value) return;
  if(!(await confirmCreativeDrafts({scope:`user:${managedUserId}:prompt-settings`,action:"切换Skill正文"})))return;
  activeEntry.value = path;
  await loadContent(path);
}

let editingPath="",baseline="";
const nativeDraftId=`native-skill:${managedUserId}`;
function openEditDialog(){editingPath=activeEntry.value;baseline=content.value;draft.value=content.value;editVisible.value=true;}
async function onSave(){
 if(!editingPath || isSaving.value)return false;isSaving.value=true;const path=editingPath,text=draft.value;
 try{const latest=(await axios.post("/setting/skillManagement/getSkillContent",{path})).data;const current=typeof latest==="string"?latest:latest.content;if(current!==baseline)throw new Error("Skill已被更新，本地草稿保留，请重新载入后再核对");await axios.post("/setting/skillManagement/saveSkillContent",{path,content:text});if(editingPath!==path)return false;baseline=text;if(activeEntry.value===path)content.value=text;if(draft.value===text)editVisible.value=false;return draft.value===baseline;}
 catch(error){window.$message.error((error as Error)?.message??"保存失败，草稿保留");return false;}
 finally{isSaving.value=false;}
}
const unregisterNative=registerCreativeDraft({id:nativeDraftId,label:"Skill文件正文",scope:`user:${managedUserId}:prompt-settings`,isDirty:()=>editVisible.value && draft.value!==baseline,save:onSave,discard:()=>{draft.value=baseline;editVisible.value=false;}});
const guardedEditVisible=computed({get:()=>editVisible.value,set:value=>{if(value)editVisible.value=true;else void confirmCreativeDrafts({ids:[nativeDraftId],action:"关闭Skill编辑"}).then(ok=>{if(ok)editVisible.value=false;});}});
async function resolveManagedConflict(){const key=managedKey.value;await managedController.resolveConflict(key,true);await managedController.save(key);}

onMounted(() => { void fetchList(); window.addEventListener("beforeunload", beforeUnload); });
onBeforeUnmount(() => { loadSequence++; window.removeEventListener("beforeunload", beforeUnload); managedController.dispose(); unregisterManaged(); unregisterNative(); });
</script>

<style lang="scss" scoped>
.managed-editor { padding: 16px; overflow: auto; display: flex; flex-direction: column; gap: 12px; min-height: 500px; }
.managed-note, .managed-meta { color: var(--td-text-color-secondary); font-size: 12px; line-height: 1.8; margin: 0; }
.managed-error { color: var(--td-error-color); font-size: 12px; line-height: 1.8; }
.managed-content { width: 100%; min-height: 480px; box-sizing: border-box; resize: vertical; background: var(--td-bg-color-container); color: var(--td-text-color-primary); border: 1px solid var(--td-component-border); border-radius: 6px; padding: 12px; font: 13px/1.8 ui-monospace, monospace; }
.managed-editor details { font-size: 12px; line-height: 1.8; summary { cursor: pointer; } }
.skillManagement {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 12px;
  height: 100%;

  .sidebarPanel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--td-component-stroke);
    border-radius: 8px;
    overflow: hidden;
    min-height: 0;

    .treeWrap {
      flex: 1;
      overflow: auto;
      user-select: none;
    }
  }

  .viewPanel {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--td-component-stroke);
    border-radius: 8px;
    overflow: hidden;

    .viewHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-bottom: 1px solid var(--td-component-stroke);

      .fileName {
        font-size: 14px;
        font-weight: 600;
        word-break: break-all;
      }
    }

    .previewWrap {
      flex: 1;
      overflow: auto;
      padding: 12px 16px;
    }
  }
}
</style>
