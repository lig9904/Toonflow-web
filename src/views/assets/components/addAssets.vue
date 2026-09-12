<template>
  <div class="addAssets">
    <t-dialog
      v-model:visible="guardedVisible"
      :closable="false"
      width="40vw"
      :header="props.title"
      :maskClosable="false"
      @close-btn-click="handleCancel"
      @confirm="onConfirm"
      @cancel="handleCancel">
      <div class="data">
        <t-form :data="draftForm" :rules="rules" ref="formRef">
          <t-form-item :label="$t('workbench.assets.add.name')" name="name">
            <t-input v-model="draftForm.name" :placeholder="$t('workbench.assets.add.namePh')"></t-input>
          </t-form-item>
          <t-form-item :label="$t('workbench.assets.add.describe')" name="describe">
            <t-textarea v-model="draftForm.describe" :placeholder="$t('workbench.assets.add.describePh')"></t-textarea>
          </t-form-item>
          <t-form-item :label="$t('workbench.assets.add.remark')" name="remark">
            <t-input v-model="draftForm.remark" :placeholder="$t('workbench.assets.add.remarkPh')"></t-input>
          </t-form-item>
          <t-form-item :label="$t('workbench.assets.add.prompt')" name="prompt" v-if="props.type !== 'clip'">
            <t-textarea
              v-model="draftForm.prompt"
              :autosize="{ minRows: 3, maxRows: 5 }"
              :placeholder="$t('workbench.assets.add.promptPh')"></t-textarea>
          </t-form-item>
        </t-form>
      </div>
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import axios from "@/utils/axios";
import { useManualCreativeDraft } from "@/utils/useManualCreativeDraft";
import projectStore from "@/stores/project";
import { createIdempotencyKey } from "@/utils/idempotency";
const { project } = storeToRefs(projectStore());
const props = defineProps<{
  type: "role" | "tool" | "scene" | "clip" | "audio";
  title: string;
  formData: {
    id: number;
    name: string;
    describe: string;
    remark: string;
    prompt: string;
    version?: number;
  };
}>();
const addAssetsShow = defineModel<boolean>({
  default: false,
});
const rules = ref<{}>({
  name: [{ required: true, message: $t("workbench.assets.add.nameRequired"), trigger: "blur" }],
  describe: [{ required: true, message: $t("workbench.assets.add.describeRequired"), trigger: "blur" }],
});
const formRef = ref();
const emit = defineEmits(["getFilteredData"]);
let intent:{signature:string;key:string}|undefined;
const manual=useManualCreativeDraft<{name:string;describe:string;remark:string;prompt:string},{id:number;projectId:number;version?:number;type:string}>({
 label:"素材设定与提示词",initial:{name:"",describe:"",remark:"",prompt:""},id:()=>`asset-form:${project.value?.id}:${props.formData.id}`,scope:()=>`project:${project.value?.id}`,
 load:()=>({value:{name:props.formData.name,describe:props.formData.describe,remark:props.formData.remark,prompt:props.formData.prompt},meta:{id:props.formData.id,projectId:Number(project.value?.id),version:props.formData.version,type:props.type}}),
 commit:async(value,meta)=>{
  if(!value.name.trim() || !value.describe.trim())throw new Error("请输入素材名称和设定");
  const body={...value,projectId:meta.projectId,...(meta.id?{id:meta.id,expectedVersion:meta.version}:{type:meta.type})};const signature=JSON.stringify(body);if(intent?.signature!==signature)intent={signature,key:createIdempotencyKey("asset-manual")};
  const {data}=await axios.post(meta.id?"/assets/updateAssets":"/assets/addAssets",{...body,idempotencyKey:intent.key});intent=undefined;
  return {value,meta:{...meta,id:Number(data.asset?.id??data.assetId??data.id??meta.id),version:Number(data.asset?.version??data.version??meta.version)}};
 },onSaved:()=>emit("getFilteredData"),
});
const draftForm=manual.draft,guardedVisible=manual.visible;
watch(addAssetsShow,visible=>{if(visible)void manual.open();},{immediate:true});
watch(guardedVisible,visible=>{if(!visible)addAssetsShow.value=false;});
async function handleCancel(){if(await manual.close())addAssetsShow.value=false;}
async function onConfirm(){if(await manual.save()){await manual.close();addAssetsShow.value=false;}}

</script>

<style lang="scss" scoped>
.addAssets {
  .modalHeader {
    background: var(--td-bg-color-container);
    width: 100%;
    :deep(.ant-typography) {
      color: var(--td-text-color-primary);
      margin: 0;
    }

    :deep(.ant-btn-text) {
      color: var(--td-brand-color);

      &:hover {
        background: var(--td-bg-color-component-hover);
        color: var(--td-brand-color-hover);
      }
    }
  }
  .data {
    width: 100%;
  }
}
</style>
