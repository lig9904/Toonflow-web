<template>
  <div class="imageUploadBox ac">
    <!-- 自动/多参考/文本模式都保留完整素材列表，最终采用项由后端解析快照决定。 -->
    <template v-if="mode">
      <div class="uploadBtn referenceWithPurpose c fc" v-for="(item, index) in displayItems" :key="`${item.sources}:${item.id}:${index}`">
        <template v-if="item.src">
          <t-image v-if="item.fileType == 'image'" :src="item.src" fit="contain" class="uploadPreview">
            <template #overlayContent>
              <div class="imageToolsWrap">
                <ImageTools :src="item.src!" position="br" />
              </div>
            </template>
          </t-image>
          <t-tooltip theme="primary" v-else-if="item.fileType == 'audio'" :content="item?.prompt || ''">
            <div class="mediaPreview audioPreview">
              <i-acoustic size="20" />
              <span class="mediaLabel">音频</span>
            </div>
          </t-tooltip>
          <div v-else-if="item.fileType == 'video'" class="mediaPreview videoPreview">
            <video class="uploadPreview" :src="item.src" preload="metadata" muted />
          </div>
        </template>
        <template v-else>
          <t-tooltip theme="primary" :content="item?.prompt ? '音频内容：' + item.prompt : ''">
            <span style="font-size: 20px">文</span>
          </t-tooltip>
        </template>
        <div class="imageTitleWrap" v-if="item.sources == 'storyboard' && item.index != null">
          {{ `P${item.index + 1}` }}
        </div>
        <div class="clearBtn" @click="splitImageItem(item)">
          <i-close size="12" />
        </div>
        <div class="source">
          <t-tag size="small">
            {{ item.sources == "storyboard" ? $t("workbench.generate.storyboard") : $t("workbench.generate.assets") }}
          </t-tag>
        </div>
        <t-select
          class="purposeSelect"
          size="small"
          :value="referencePurpose(item, index)"
          :options="purposeOptions(item)"
          @click.stop
          @change="(value) => setPurposeForItem(item, String(value) as VideoReferencePurpose)" />
      </div>
    </template>
    <template v-if="isFrameMode">
      <div class="uploadBtn c fc" v-for="slot in missingFrameSlots" :key="slot.value" @click="handleMixedAdd(slot.value as 'start' | 'end')">
        <i-plus size="24"></i-plus>
        {{ slot.label }}
      </div>
    </template>
    <div class="uploadBtn c fc" v-if="isShowAddImage" @click="handleMixedAdd()">
      <i-plus size="24"></i-plus>
      {{ $t("workbench.generate.addReference") }}
    </div>

    <!-- 分镜选择弹窗 -->
    <t-dialog
      v-model:visible="storyboardDialogVisible"
      :header="$t('workbench.generate.selectStoryboard')"
      :footer="false"
      width="800px"
      placement="center">
      <div class="storyboardGrid">
        <div class="storyboardItem" v-for="sb in storyboardList" :key="sb.id" @click="pickStoryboard(sb)">
          <div class="imageTitleWrap" v-if="sb?.index != null">
            {{ `P${sb?.index + 1}` }}
          </div>
          <img v-if="sb.src" :src="sb.src" />
          <div v-else class="textBox ac jc">
            <t-tooltip theme="primary" :content="sb?.videoDesc || ''">
              <span style="font-size: 20px">{{ `分镜 ${sb?.index + 1 || ""}` }}</span>
            </t-tooltip>
          </div>
        </div>
      </div>
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import "@/views/production/components/workbench/type/type";
import assetsCheck, { type ClipMediaType } from "@/utils/assetsCheck";
import axios from "@/utils/axios";
import { defaultReferencePurpose, parseModeIntentValue, purposeLabel, type VideoModeIntent, type VideoReferencePurpose } from "../utils/videoMode";

const props = defineProps<{
  mode: VideoModeIntent;
  storyboardList: StoryboardItem[];
}>();
const imageList = defineModel<UploadItem[]>({
  default: () => [],
});
//分镜选择弹窗
const storyboardDialogVisible = ref(false);

const buildLabel = computed(() => {
  const startOptional = props.mode === "startFrameOptional";
  const endOptional = props.mode === "endFrameOptional";
  return [
    { label: startOptional ? "首帧(可选)" : "首帧", value: "start" },
    { label: endOptional ? "尾帧(可选)" : "尾帧", value: "end" },
  ];
});

const isFrameMode = computed(() => ["endFrameOptional", "startFrameOptional", "startEndRequired"].includes(String(props.mode)));
const displayItems = computed(() => {
  if (!isFrameMode.value) return imageList.value;
  const rank = (item: UploadItem) => item.purpose === "first_frame" ? 0 : item.purpose === "last_frame" ? 1 : 2;
  return [...imageList.value].sort((left, right) => rank(left) - rank(right));
});
const missingFrameSlots = computed(() => buildLabel.value.filter((slot) => {
  const purpose = slot.value === "start" ? "first_frame" : "last_frame";
  return !imageList.value.some((item) => item.purpose === purpose);
}));

/** 将 item 设置到首帧或尾帧槽位 */
function setFrameSlot(slot: "start" | "end", item: UploadItem) {
  const purpose = slot === "start" ? "first_frame" : "last_frame";
  const list = [...imageList.value];
  const existingIndex = list.findIndex((candidate) => candidate.purpose === purpose);
  const selected = { ...item, purpose } as UploadItem;
  if (existingIndex >= 0) list[existingIndex] = selected;
  else list.push(selected);
  imageList.value = list;
}

/** 解析模式值（字符串或 JSON 数组） */
function parseMode(value: unknown): VideoModeIntent | null {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed as ReferenceType[];
  } catch {
    return value as Exclude<VideoModeIntent, string[]>;
  }
  return value as Exclude<VideoModeIntent, string[]>;
}

function referencePurpose(item: UploadItem, index: number): VideoReferencePurpose {
  const unlabelledStoryboardCount = imageList.value.filter((candidate) => candidate.sources === "storyboard" && !candidate.purpose).length;
  return defaultReferencePurpose(item, parseModeIntentValue(props.mode), index, unlabelledStoryboardCount);
}

function purposeOptions(item: UploadItem) {
  if (item.fileType === "audio") return [{ value: "audio_reference", label: purposeLabel("audio_reference") }];
  if (item.fileType === "video") return [{ value: "motion_reference", label: purposeLabel("motion_reference") }];
  return (["first_frame", "last_frame", "identity_reference", "style_reference"] as VideoReferencePurpose[])
    .map((value) => ({ value, label: purposeLabel(value) }));
}

function setPurposeForItem(target: UploadItem, purpose: VideoReferencePurpose) {
  imageList.value = imageList.value.map((item) => {
    if (item === target) return { ...item, purpose };
    if ((purpose === "first_frame" || purpose === "last_frame") && item.purpose === purpose) return { ...item, purpose: "identity_reference" };
    return item;
  });
}

//判断是否显示添加参考图
const isShowAddImage = computed(() => {
  const mode = props.mode;
  if (mode == "singleImage" && imageList.value.length >= 1) {
    return false;
  }
  if (mode == "endFrameOptional" || mode == "startEndRequired" || mode == "startFrameOptional") {
    return false;
  }
  // Text mode keeps references visible and editable so switching models/modes
  // never destroys the user's selection, though the backend may resolve none.
  //多参模式默认 true
  return true;
});

/** 根据文件扩展名推断媒体类型 */
function getFileTypeByExt(src: string | undefined): "image" | "video" | "audio" {
  const ext = src?.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "webm", "mov", "avi", "mkv"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "aac", "flac", "m4a"].includes(ext)) return "audio";
  return "image";
}
/** 根据混合模式推导当前允许的 clip 媒体类型 */
const mixedClipMediaTypes = computed<ClipMediaType[]>(() => {
  const mode = parseMode(props.mode);
  if (!Array.isArray(mode)) return [];
  const map: Record<string, ClipMediaType> = { audioReference: "audio", imageReference: "image", videoReference: "video" };
  return mode.filter((m) => m in map).map((m) => map[m]);
});
let currentSlot: "start" | "end" | "" = "";
function handleMixedAdd(slot: "start" | "end" | "" = "") {
  if (!props.mode) return window.$message.error($t("workbench.generate.notSelectMode"));
  currentSlot = slot;
  const multiple = props.mode === "auto" || props.mode === "text" || Array.isArray(parseMode(props.mode));
  const dlg = DialogPlugin.confirm({
    header: $t("workbench.generate.selectSource"),
    confirmBtn: $t("workbench.generate.confirm"),
    cancelBtn: $t("workbench.generate.cancel"),
    onConfirm: async () => {
      dlg.destroy();
      const assets = await assetsCheck({ types: ["role", "tool", "scene", "clip", "audio"], clipMediaTypes: mixedClipMediaTypes.value, multiple });

      if (!assets.length) return;

      const newItems: UploadItem[] = assets.flatMap((asset) => {
        if (asset.type === "audio" && asset?.sonAssets?.length) {
          return asset.sonAssets.map((sub: any) => {
            const fileType = getFileTypeByExt(sub.src);
            const item = {
              fileType,
              sources: "assets",
              src: sub.src,
              id: sub.id,
              prompt: sub.prompt,
              assetType: "audio",
            } as UploadItem;
            return { ...item, purpose: defaultReferencePurpose(item, parseModeIntentValue(props.mode), imageList.value.length) } as UploadItem;
          });
        }
        const fileType = getFileTypeByExt(asset.src);
        const item = {
          fileType,
          sources: "assets",
          src: asset.src,
          id: asset.id,
          prompt: asset.prompt,
          assetType: asset.type,
        } as UploadItem;
        return [{ ...item, purpose: defaultReferencePurpose(item, parseModeIntentValue(props.mode), imageList.value.length) } as UploadItem];
      });
      if (slot === "start" || slot === "end") {
        setFrameSlot(slot, newItems[0]);
      } else if (props.mode === "singleImage") {
        imageList.value = [newItems[0]];
      } else {
        const assetsNotAudioIds = newItems.filter((i) => i.fileType !== "audio");
        const { data } = await axios.post("/production/workbench/getAudioBindAssetsList", {
          assetsIds: assetsNotAudioIds.map((i) => i.id),
        });
        const boundAudio = (data ?? []).map((item: UploadItem) => ({ ...item, purpose: "audio_reference", assetType: "audio" }));
        imageList.value = [...imageList.value, ...newItems, ...boundAudio];
      }
    },
    onCancel: () => {
      dlg.destroy();
      storyboardDialogVisible.value = true;
    },
  });
}
/** 分镜弹窗选中回调 */
function pickStoryboard(sb: StoryboardItem) {
  storyboardDialogVisible.value = false;
  const fileType = "image";
  const newItem = {
    fileType,
    sources: "storyboard",
    src: sb.src,
    id: sb.id,
    prompt: sb.videoDesc ?? undefined,
    index: sb.index,
  } as UploadItem;

  if (currentSlot === "start" || currentSlot === "end") {
    setFrameSlot(currentSlot, newItem);
  } else {
    // Keep generic storyboard references unlabelled. The resolver treats one
    // storyboard as a start frame and several as multimodal/style references.
    imageList.value = [...imageList.value, newItem];
  }
}
function splitImage(index: number) {
  const list = [...imageList.value];
  list.splice(index, 1);
  imageList.value = list;
}
function splitImageItem(target: UploadItem) {
  const index = imageList.value.indexOf(target);
  if (index >= 0) splitImage(index);
}
</script>

<style lang="scss" scoped>
.imageUploadBox {
  gap: 8px;
  overflow-x: auto;
  flex-wrap: nowrap;
  padding-bottom: 6px;
  &::-webkit-scrollbar {
    height: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background: #696969;
    border-radius: 4px;
  }
  &::-webkit-scrollbar-track {
    background-color: var(--td-bg-color-secondarycontainer);
    border-radius: 4px;
  }
  .imageTitleWrap {
    z-index: 999;
    position: absolute;
    left: 4px;
    top: 4px;
    padding: 0 5px;
    font-size: 11px;
    line-height: 18px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    border-radius: 4px;
    backdrop-filter: blur(4px);
    user-select: none;
    white-space: nowrap;
  }
  .uploadBtn {
    width: 80px;
    min-width: 80px;
    height: 80px;
    flex-shrink: 0;
    position: relative;
    border: 1px dashed var(--td-component-border);
    border-radius: 8px;
    margin-bottom: 28px;
    &:hover {
      border-color: var(--td-text-color);
      cursor: pointer;
    }

    .uploadPreview {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 8px;
      position: relative;
      .imageToolsWrap {
        height: 100%;
        transform: scale(0.6);
        transform-origin: bottom right;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
      }
      &:hover {
        .imageToolsWrap {
          opacity: 1;
          pointer-events: auto;
        }
      }
    }
    .mediaPreview {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      gap: 4px;
      .mediaLabel {
        font-size: 11px;
        color: var(--td-text-color-secondary);
      }
      &.audioPreview {
        background: var(--td-bg-color-secondarycontainer);
        color: var(--td-brand-color);
      }
      &.videoPreview {
        background: #000;
        overflow: hidden;
      }
    }
    .clearBtn {
      z-index: 999999999999999;
      position: absolute;
      top: 2px;
      right: 2px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.6);
      color: #fff;
      display: none;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      &:hover {
        background: rgba(0, 0, 0, 0.85);
      }
    }
    &:hover .clearBtn {
      display: flex;
    }
    .source {
      position: absolute;
      bottom: 2px;
      right: 2px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.6);
      color: #fff;
      display: none;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      &:hover {
        background: rgba(0, 0, 0, 0.85);
      }
    }
    &:hover .source {
      display: flex;
    }
  }
  .referenceWithPurpose {
    width: 116px;
    min-width: 116px;
  }
  .purposeSelect {
    position: absolute;
    left: 0;
    top: 84px;
    width: 116px;
    z-index: 3;
  }
  .storyboardGrid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    max-height: 60vh;
    overflow-y: auto;
    padding: 4px;
    .storyboardItem {
      cursor: pointer;
      position: relative;
      border-radius: 8px;
      overflow: hidden;
      border: 2px solid transparent;
      transition:
        border-color 0.2s,
        box-shadow 0.2s;
      &:hover {
        border-color: var(--td-brand-color);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
      }
      img {
        width: 100%;
        aspect-ratio: 16/9;
        object-fit: cover;
        display: block;
      }
      .textBox {
        aspect-ratio: 16/9;
        width: 100%;
        text-align: center;
        border: 1px solid #ccc;
      }
    }
  }
}
</style>
