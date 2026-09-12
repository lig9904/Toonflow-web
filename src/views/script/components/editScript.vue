<template>
  <div class="details">
    <t-dialog :footer="false" v-model:visible="guardedVisible" width="60vw" top="5vh" @confirm="onConfirm">
      <template #header>
        <t-typography-title level="h4" style="margin: 0">{{ $t("workbench.script.edit.title") }}</t-typography-title>
      </template>
      <t-form :data="draftForm" label-align="top" class="detailsForm">
        <t-form-item :label="$t('workbench.script.edit.scriptName')" name="name">
          <t-input v-model="draftForm.name" :maxlength="10" :placeholder="$t('workbench.script.edit.scriptNamePh')" />
        </t-form-item>
        <t-form-item :label="$t('workbench.script.edit.scriptContent')" name="content">
          <div class="fc" style="width: 100%">
            <t-textarea
              v-model="draftForm.content"
              :placeholder="$t('workbench.script.edit.scriptContentPh')"
              :autosize="{ minRows: 20, maxRows: 20 }" />
            <div class="scriptLen">{{ draftForm.content.length }}/{{ otherSetting.scriptEpisodeLength }}</div>
          </div>
        </t-form-item>
        <t-form-item :label="$t('workbench.script.edit.relatedAssets')" name="assets">
          <div class="assets-section">
            <div class="assets-header">
              <t-button size="small" theme="primary" variant="outline" @click="handleSelectAssets">
                <template #icon><i-plus /></template>
                {{ $t("workbench.script.edit.selectAssets") }}
              </t-button>
            </div>
            <div class="assets-list" v-if="selectedAssets.length">
              <t-tag v-for="asset in selectedAssets" :key="asset.id" closable variant="light-outline" @close="removeAsset(asset.id)">
                {{ asset.name }}
              </t-tag>
            </div>
            <div v-else class="assets-empty">{{ $t("workbench.script.edit.noAssets") }}</div>
          </div>
        </t-form-item>
      </t-form>
      <div style="margin-top: 16px; text-align: right">
        <t-button variant="outline" @click="closeDraft">{{ $t("workbench.novel.import.prevStep") }}</t-button>
        <t-button
          theme="primary"
          style="margin-left: 10px"
          :disabled="draftForm.content.length > otherSetting.scriptEpisodeLength"
          @click="onConfirm">
          保存
        </t-button>
      </div>
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import axios from "@/utils/axios";
import { useManualCreativeDraft } from "@/utils/useManualCreativeDraft";
import openAssetsSelector from "@/utils/assetsCheck";
import settingStore from "@/stores/setting";
import { createIdempotencyKey } from "@/utils/idempotency";
import projectStore from "@/stores/project";
const { otherSetting } = storeToRefs(settingStore());
interface ScriptAsset {
  id: number;
  name: string;
}
interface ScriptItem {
  id: number;
  name: string;
  content: string;
  relatedAssets?: ScriptAsset[];
  version?: number;
}

const detailsShow = defineModel<boolean>({
  default: false,
});

const props = defineProps<{
  item: ScriptItem;
  workspaceVersion?: number;
}>();
const { project } = storeToRefs(projectStore());

// ============== Assets ==============
const manual=useManualCreativeDraft<{name:string;content:string;assets:ScriptAsset[]},{id:number;projectId:number;version?:number;workspaceVersion?:number}>({
 label:"剧本正文",initial:{name:"",content:"",assets:[]},id:()=>`script-form:${project.value?.id}:${props.item.id}`,scope:()=>`project:${project.value?.id}:episode:${props.item.id}`,
 load:()=>({value:{name:props.item.name,content:props.item.content,assets:props.item.relatedAssets?.map(item=>({...item}))??[]},meta:{id:props.item.id,projectId:Number(project.value?.id),version:props.item.version,workspaceVersion:props.workspaceVersion}}),
 commit:async(value,meta)=>{const body={id:meta.id,projectId:meta.projectId,name:value.name,content:value.content,...(assetsTouched.value?{assets:value.assets.map(item=>item.id)}:{}),expectedVersion:meta.version,workspaceExpectedVersion:meta.workspaceVersion};const signature=JSON.stringify(body);if(intent?.signature!==signature)intent={signature,key:createIdempotencyKey("script-manual")};const {data}=await axios.post("/script/updateScript",{...body,mutationKey:intent.key});intent=undefined;return {value,meta:{...meta,version:Number(data.script.version),workspaceVersion:Number(data.workspaceVersion)}};},
 onSaved:()=>emit("searchScripts"),
});
let intent:{signature:string;key:string}|undefined;
const draftForm=manual.draft,guardedVisible=manual.visible;
const selectedAssets=computed({get:()=>draftForm.value.assets,set:value=>{draftForm.value.assets=value;}});
const assetsTouched=ref(false);

async function handleSelectAssets() {
  const assets = await openAssetsSelector({ title: $t("workbench.script.edit.msg.selectAssetsTitle"), types: ["role", "tool", "scene"] });
  if (assets.length) {
    assetsTouched.value = true;
    const existing = new Set(selectedAssets.value.map((a) => a.id));
    for (const a of assets) {
      if (!existing.has(a.id)) {
        selectedAssets.value.push({ id: a.id, name: a.name });
      }
    }
  }
}

function removeAsset(id: number) {
  assetsTouched.value = true;
  selectedAssets.value = selectedAssets.value.filter((a) => a.id !== id);
}

const emit = defineEmits(["searchScripts"]);
async function onConfirm(){if(await manual.save()){await manual.close();detailsShow.value=false;}}
async function closeDraft(){if(await manual.close())detailsShow.value=false;}
watch(detailsShow,visible=>{if(visible){assetsTouched.value=false;void manual.open();}},{immediate:true});
watch(guardedVisible,visible=>{if(!visible)detailsShow.value=false;});

</script>

<style lang="scss" scoped>
.details {
  .detailsForm {
    padding: 0 8px;
    .scriptLen {
      text-align: right;
      color: #aaa;
    }
    .assets-section {
      width: 100%;
      .assets-header {
        margin-bottom: 8px;
      }
      .assets-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .assets-empty {
        font-size: 13px;
        color: var(--td-text-color-placeholder);
      }
    }
  }
}
</style>
