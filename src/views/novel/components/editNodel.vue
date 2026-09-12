<template>
  <div class="editNodel">
    <t-dialog v-model:visible="guardedVisible" :header="$t('workbench.novel.editDialog.title')" width="50%" top="10vh" placement="center">
      <div class="data" style="overflow-x: hidden">
        <t-form label-width="80px">
          <t-form-item :label="$t('workbench.novel.editDialog.chapterName')">
            <t-input :placeholder="$t('workbench.novel.editDialog.chapterNamePh')" v-model="draftForm.chapter" />
          </t-form-item>
          <t-form-item :label="$t('workbench.novel.editDialog.eventContent')">
            <t-textarea v-model="draftForm.event" :placeholder="$t('workbench.novel.editDialog.eventContentPh')"></t-textarea>
          </t-form-item>
          <t-form-item :label="$t('workbench.novel.editDialog.chapterContent')">
            <t-textarea :placeholder="$t('workbench.novel.editDialog.chapterContentPh')" v-model="draftForm.chapterData" :autosize="{ minRows: 15, maxRows: 15 }" />
          </t-form-item>
        </t-form>
      </div>
      <template #footer>
        <div class="editNodel-footer">
          <t-button @click="closeDraft">{{ $t('workbench.novel.editDialog.cancel') }}</t-button>
          <t-button theme="primary" @click="saveChanges">{{ $t('workbench.novel.editDialog.save') }}</t-button>
        </div>
      </template>
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import axios from "@/utils/axios";
import {useManualCreativeDraft} from "@/utils/useManualCreativeDraft";
import { createIdempotencyKey } from "@/utils/idempotency";
import projectStore from "@/stores/project";
const editNodelShow = defineModel<boolean>();
const { project } = storeToRefs(projectStore());
const props = defineProps<{
  formData: {
    id: number;
    index: number;
    reel: string;
    chapter: string;
    chapterData: string;
    event: string;
    version?: number;
  };
}>();
const emit = defineEmits(["select"]);
let intent:{signature:string;key:string}|undefined;
const manual=useManualCreativeDraft<{chapter:string;chapterData:string;event:string},{projectId:number;id:number;index:number;reel:string;version?:number}>({label:"小说原文与事件",initial:{chapter:"",chapterData:"",event:""},id:()=>`novel:${project.value?.id}:${props.formData.id}`,scope:()=>`project:${project.value?.id}`,
 load:()=>({value:{chapter:props.formData.chapter,chapterData:props.formData.chapterData,event:props.formData.event},meta:{projectId:Number(project.value?.id),id:props.formData.id,index:props.formData.index,reel:props.formData.reel,version:props.formData.version}}),
 commit:async(value,meta)=>{const body={...value,projectId:meta.projectId,id:meta.id,index:meta.index,reel:meta.reel,expectedVersion:meta.version};const signature=JSON.stringify(body);if(intent?.signature!==signature)intent={signature,key:createIdempotencyKey("novel-manual")};const {data}=await axios.post("/novel/updateNovel",{...body,mutationKey:intent.key});intent=undefined;return {value,meta:{...meta,version:Number(data.novel.version)}};},onSaved:()=>emit("select"),
});
const draftForm=manual.draft,guardedVisible=manual.visible;
watch(editNodelShow,visible=>{if(visible)void manual.open();},{immediate:true});
watch(guardedVisible,visible=>{if(!visible)editNodelShow.value=false;});
async function closeDraft(){if(await manual.close())editNodelShow.value=false;}
async function saveChanges(){if(await manual.save()){await manual.close();editNodelShow.value=false;}}

</script>

<style lang="scss" scoped>
.data {
  :deep(.t-form__item) {
    .t-form__controls {
      min-width: 0;
      overflow-x: hidden;
    }
  }

  :deep(.t-textarea__inner) {
    width: 100%;
    box-sizing: border-box;
  }
}

.event-editor {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;

  .event-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 32px;
    align-items: center;
    overflow-x: hidden;
  }

  .event-input {
    width: 100%;
    min-width: 0;
  }
}
</style>
