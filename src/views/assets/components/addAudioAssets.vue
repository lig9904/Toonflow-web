<template>
  <t-dialog
    v-model:visible="guardedVisible"
    :closable="false"
    width="40vw"
    :header="localForm.id ? '编辑' : '新增'"
    :maskClosable="false"
    @close-btn-click="handleCancel"
    @confirm="onConfirm"
    @cancel="handleCancel">
    <div class="data">
      <t-form :data="localForm" :rules="rules" ref="formRef">
        <t-form-item :label="$t('workbench.assets.add.audioName')" name="name">
          <t-input v-model="localForm.name" :disabled="audioSaving" :placeholder="$t('workbench.assets.add.audioNamePh')"></t-input>
        </t-form-item>
        <t-form-item :label="$t('workbench.assets.add.describe')" name="describe">
          <t-textarea v-model="localForm.describe" :disabled="audioSaving" :placeholder="$t('workbench.assets.add.describePh')"></t-textarea>
        </t-form-item>
        <t-form-item :label="$t('workbench.assets.add.sex')" name="remark">
          <t-input v-model="localForm.sex" :disabled="audioSaving" :placeholder="$t('workbench.assets.add.sexPh')"></t-input>
        </t-form-item>
        <t-form-item :label="$t('workbench.assets.add.audioFile')" name="audioFile">
          <div class="audio-list">
            <div v-for="(item, index) in audioItems" :key="index" class="audio-item">
              <div class="audio-upload-row">
                <div class="audio-file-area" @click="triggerFileInput(index)" @dragover.prevent @drop.prevent="(e) => handleDrop(e, index)">
                  <template v-if="item.file">
                    <i-volume-notice size="16" />
                    <span class="audio-filename">{{ item.file.name }}</span>
                  </template>
                  <template v-else-if="item.src">
                    <i-volume-notice size="16" fill="var(--td-success-color)" />
                    <span class="audio-filename audio-filename--existing">{{ item.name }}</span>
                    <t-tag size="small" theme="success" variant="light" style="margin-left: auto; flex-shrink: 0">已上传</t-tag>
                  </template>
                  <template v-else>
                    <i-upload-one size="16" fill="var(--td-brand-color)" />
                    <span class="audio-upload-hint">点击或拖拽上传音频</span>
                  </template>
                  <input
                    :ref="(el) => (fileInputRefs[index] = el as HTMLInputElement)"
                    type="file"
                    accept="audio/*"
                    style="display: none"
                    @change="(e) => handleFileChange(e, index)" />
                </div>
                <t-button theme="danger" variant="outline" shape="circle" size="small" @click="removeAudioItem(index)">
                  <template #icon><i-close size="12" /></template>
                </t-button>
              </div>
              <t-input v-model="item.text" @change="assetsTouched=true" :disabled="audioSaving" placeholder="请输入该音频对应的文本内容" class="audio-text-input" />
              <t-input v-model="item.describe" @change="assetsTouched=true" :disabled="audioSaving" placeholder="请输入该音频的描述" class="audio-text-input" />
            </div>
            <t-button theme="primary" variant="outline" size="small" @click="addAudioItem">
              <template #icon><i-plus /></template>
              添加音频
            </t-button>
          </div>
        </t-form-item>
      </t-form>
    </div>
  </t-dialog>
</template>

<script setup lang="ts">
import axios from "@/utils/axios";
import {persistCreativeForm} from "@/utils/persistCreativeForm";
import userStore from "@/stores/user";
import {registerCreativeDraft,confirmCreativeDrafts} from "@/utils/creativeDrafts";
import projectStore from "@/stores/project";
import { createIdempotencyKey } from "@/utils/idempotency";
const { project } = storeToRefs(projectStore());

interface AudioItem {
  id?: number;
  src?: string;
  file: File | null;
  text: string;
  name: string;
  describe: string;
  version?: number;
}
const props = defineProps<{
  formData: {
    id?: number;
    version?: number;
    name: string;
    describe: string;
    sex: string;
    sonAssets?: {
      id?: number;
      src?: string;
      prompt: string;
      name?: string;
  describe?: string;
  version?: number;
    }[];
  };
}>();
const localForm=ref(JSON.parse(JSON.stringify(props.formData)) as typeof props.formData);
const addAssetsShow = defineModel<boolean>({
  default: false,
});
const rules = ref<{}>({
  name: [{ required: true, message: $t("workbench.assets.add.nameRequired"), trigger: "blur" }],
  describe: [{ required: true, message: $t("workbench.assets.add.describeRequired"), trigger: "blur" }],
});
async function handleCancel() {
  if(!(await confirmCreativeDrafts({ids:[draftId],action:"关闭音频素材编辑"})))return;
  addAssetsShow.value = false;
  // 重置音频列表
  audioItems.value = [{ file: null, text: "", name: "", describe: "" }];
}
const formRef = ref();
const emit = defineEmits(["getFilteredData"]);

const audioItems = ref<AudioItem[]>([{ file: null, text: "", name: "", describe: "" }]);
const assetsTouched = ref(false);
const audioSaving=ref(false);
const idempotencyKey = ref("");
watch(addAssetsShow, (visible) => {
  if (visible) {
    localForm.value=JSON.parse(JSON.stringify(props.formData));
    void nextTick(()=>{baseline=signature();});
    idempotencyKey.value = createIdempotencyKey("audio-asset");
    assetsTouched.value = false;
  } else idempotencyKey.value = "";
});
const fileInputRefs = ref<HTMLInputElement[]>([]);

// 初始化音频列表
watch(
  () => localForm.value.sonAssets,
  (newSonAssets) => {
    if (newSonAssets && newSonAssets.length > 0) {
      audioItems.value = newSonAssets.map((asset) => ({
        id: asset.id,
        version:asset.version,
        src: asset.src,
        file: null,
        text: asset.prompt,
        name: asset.name || "",
        describe: asset.describe || "",
      }));
    } else {
      audioItems.value = [{ file: null, text: "", name: "", describe: "" }];
    }
  },
  { immediate: true },
);

function addAudioItem() {
  assetsTouched.value = true;
  audioItems.value.push({ file: null, text: "", name: "", describe: "" });
}

function removeAudioItem(index: number) {
  assetsTouched.value = true;
  audioItems.value.splice(index, 1);
  if (audioItems.value.length === 0) {
    audioItems.value.push({ file: null, text: "", name: "", describe: "" });
  }
}

function triggerFileInput(index: number) {
  fileInputRefs.value[index]?.click();
}

function handleFileChange(e: Event, index: number) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    audioItems.value[index].file = file;
    assetsTouched.value = true;
    audioItems.value[index].src = undefined;
    if (!audioItems.value[index].name) {
      audioItems.value[index].name = file.name;
    }
  }
  input.value = "";
}

function handleDrop(e: DragEvent, index: number) {
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith("audio/")) {
    audioItems.value[index].file = file;
    assetsTouched.value = true;
    if (!audioItems.value[index].name) {
      audioItems.value[index].name = file.name;
    }
  } else if (file) {
    window.$message.warning($t("workbench.assets.add.pleaseUploadAudio"));
  }
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function onConfirm() {
  if(audioSaving.value)return Promise.resolve();audioSaving.value=true;
  return formRef.value?.validate().then(async (result: any) => {
    if (result == true) {
      const assetsItem = (
        await Promise.all(
          audioItems.value.map(async (item) => {
            if (item.id != null && item.src) {
              return {
                id: item.id,
                src: item.src,
                prompt: item.text || "",
                name: item.name || item.src.split("/").pop() || "",
                describe: item.describe || "",
              };
            }
            if (item.file) {
              return {
                base64: await fileToBase64(item.file),
                prompt: item.text || "",
                name: item.name || item.file.name,
                describe: item.describe || "",
              };
            }
            return null;
          }),
        )
      ).filter(
        (
          item,
        ): item is
          | { id: number; src: string; prompt: string; name: string; describe: string }
          | { base64: string; prompt: string; name: string; describe: string } => !!item,
      );

      const payload = {
        name: localForm.value.name,
        describe: localForm.value.sex + "|" + localForm.value.describe,
        projectId: Number(project.value?.id ?? 0),
        assetsItem,
      };
      if (localForm.value.id) {
        await axios
          .post(`/assets/updateAudioAssets`, {
            id: localForm.value.id,
            projectId: Number(project.value?.id ?? 0),
            expectedVersion: localForm.value.version,
            name:payload.name,describe:payload.describe,
            ...(assetsTouched.value ? { assetsItem: assetsItem.map((item: any) => item.id == null ? item : { ...item, expectedVersion: audioItems.value.find((audio) => audio.id === item.id)?.version }) } : {}),
            idempotencyKey: idempotencyKey.value,
          })
          .then(() => {
            window.$message.success($t("workbench.assets.add.updateSuccess"));
            emit("getFilteredData");
            addAssetsShow.value = false;
          });
      } else {
        await axios.post(`/assets/addAudioAssets`, { ...payload, idempotencyKey: idempotencyKey.value }).then(() => {
          window.$message.success($t("workbench.assets.add.addSuccess"));
          emit("getFilteredData");
          addAssetsShow.value = false;
        });
      }
    }
  }).catch((error:any)=>window.$message.error(error?.message??"保存失败，草稿已保留")).finally(()=>{audioSaving.value=false;});
}
const draftId=`audio-form:${crypto.randomUUID()}`;
const signature=()=>JSON.stringify({name:localForm.value.name,describe:localForm.value.describe,sex:localForm.value.sex,items:audioItems.value.map(item=>({...item,file:item.file?{name:item.file.name,size:item.file.size}:null}))});
let baseline=signature();
const unregisterDraft=registerCreativeDraft({id:draftId,label:"音频素材设定与文本",scope:()=>`project:${project.value?.id}`,isDirty:()=>addAssetsShow.value && signature()!==baseline,save:async()=>{await onConfirm();return !addAssetsShow.value;},discard:()=>{baseline=signature();addAssetsShow.value=false;}});
const guardedVisible=computed({get:()=>addAssetsShow.value,set:value=>{if(value)addAssetsShow.value=true;else void handleCancel();}});
onBeforeUnmount(unregisterDraft);
persistCreativeForm({key:()=>`toonflow:audio-body:${userStore().user?.id}:${project.value?.id}:${props.formData.id??0}`,active:()=>Boolean(addAssetsShow.value),read:()=>({form:localForm.value,items:audioItems.value.map(item=>({...item,file:null})),baseline,touched:assetsTouched.value}),restore:value=>{localForm.value=value.form;audioItems.value=value.items;baseline=value.baseline;assetsTouched.value=value.touched;}});
</script>

<style lang="scss" scoped>
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

.audio-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;

  .audio-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    border: 1px solid var(--td-border-level-1-color);
    border-radius: 6px;
    background: var(--td-bg-color-secondarycontainer);

    .audio-upload-row {
      display: flex;
      align-items: center;
      gap: 8px;

      .audio-file-area {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border: 1px dashed var(--td-component-border);
        border-radius: 4px;
        cursor: pointer;
        min-height: 34px;
        transition: border-color 0.2s;

        &:hover {
          border-color: var(--td-brand-color);
          background: var(--td-bg-color-secondarycontainer-hover);
        }

        .audio-filename {
          font-size: 13px;
          color: var(--td-text-color-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 200px;
          flex: 1;

          &--existing {
            color: var(--td-success-color);
          }
        }

        .audio-upload-hint {
          font-size: 12px;
          color: var(--td-text-color-placeholder);
        }
      }
    }

    .audio-text-input {
      width: 100%;
    }
  }
}
</style>
