<template>
  <div class="modeMenu">
    <div class="left f ac">
      <div class="model">
        <modelSelect v-model="modelParmas.model" type="video" size="small" />
      </div>
      <t-select size="small" class="mode" :value="modeIntentValue" :loading="modeSaving" :onChange="handleBeforeChange">
        <t-option v-for="(item, index) in modeList" :key="index" :value="item.value" :label="item.label"></t-option>
      </t-select>
      <t-tag v-if="resolving" size="small" variant="light">正在匹配模式…</t-tag>
      <t-tag v-else-if="resolvedMode" size="small" variant="light" theme="success">解析：{{ videoModeLabel(resolvedMode) }}</t-tag>
      <t-tooltip v-if="referenceSummaryText" :content="referenceSummaryText">
        <t-tag size="small" variant="outline">{{ referenceSummaryText }}</t-tag>
      </t-tooltip>
      <t-tooltip v-if="compatibility && !compatibility.ok" :content="compatibility.message || '当前模型与所选模式或素材不兼容'">
        <t-tag size="small" theme="danger">模式不兼容</t-tag>
      </t-tooltip>
      <t-tag v-if="followsReferenceRatio" size="small" variant="light" theme="warning">画幅跟随参考图</t-tag>
      <t-button
        size="small"
        variant="outline"
        :theme="modelParmas.audio ? 'success' : 'danger'"
        class="audio"
        :title="modelParmas.audio ? '音频已开启' : '音频关闭（按当前选择生成无声视频）'"
        :disabled="modeOptions.audio !== 'optional'"
        @click="modelParmas.audio = !modelParmas.audio">
        <template #icon>
          <i-volume-notice v-if="modelParmas.audio" size="16" />
          <i-volume-mute v-else size="16" />
        </template>
      </t-button>
      <div class="status">
        <t-popup
          trigger="click"
          placement="bottom-left"
          overlay-class-name="resDurPickerPopup"
          :overlay-inner-style="{ padding: '16px', borderRadius: '8px' }">
          <t-tag class="btn" variant="outline" :title="durationNotice || undefined">
            {{ modelParmas.resolution }}·{{ modelParmas.duration }}s · #{{ trackIndex + 1 }} 脚本{{ trackScriptDuration }}s
          </t-tag>
          <template #content>
            <div class="resolutionDurationPicker">
              <div class="durationContext" :class="{ warning: Boolean(durationNotice) }">
                {{ durationNotice || `当前片段 #${trackIndex + 1}：脚本 ${trackScriptDuration}s，生成 ${modelParmas.duration}s` }}
              </div>
              <div class="durationContext muted">手动选择仅影响当前片段；批量生成按每个片段自己的脚本时长匹配。</div>
              <div
                v-if="availableResolutions.length"
                class="pickerSection">
                <div class="pickerLabel">{{ $t("workbench.generate.resolution") }}</div>
                <div class="pickerOptions">
                  <div
                    v-for="res in availableResolutions"
                    :key="res"
                    class="pickerOption"
                    :class="{ active: modelParmas.resolution == res }"
                    @click="modelParmas.resolution = res">
                    {{ res }}
                  </div>
                </div>
              </div>
              <div
                v-if="availableDurations.length"
                class="pickerSection">
                <div class="pickerLabel">{{ $t("workbench.generate.duration") }}</div>
                <div class="pickerOptions">
                  <div
                    v-for="dur in availableDurations"
                    :key="dur"
                    class="pickerOption"
                    :class="{ active: modelParmas.duration == dur }"
                    @click="updateDuration(dur)">
                    {{ dur }}s
                  </div>
                </div>
              </div>
            </div>
          </template>
        </t-popup>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import "@/views/production/components/workbench/type/type";
import axios from "@/utils/axios";
import { videoDurations, videoResolutions } from "@/utils/mediaQuality";
import { createIdempotencyKey } from "@/utils/idempotency";
import type { SelectOption, SelectValue } from "tdesign-vue-next";
import { modeIntentSelectValue, purposeLabel, videoModeLabel, type VideoModeIntent } from "../utils/videoMode";

const props = defineProps<{
  modeOptions: VideoModel;
  modeList: { value: string; label: string }[];
  modeIntent: VideoModeIntent;
  modeSaving?: boolean;
  resolving?: boolean;
  resolvedMode?: VideoMode;
  referenceSummary?: { total: number; image: number; video: number; audio: number; purposes: Record<string, number> };
  compatibility?: { ok: boolean; code?: string; message?: string };
  trackId: number | undefined;
  trackVersion: number | undefined;
  trackIndex: number;
  trackScriptDuration: number;
  durationNotice?: string;
  projectId: number | string | undefined;
  scriptId: number | undefined;
}>();
const modelParmas = defineModel<ModelSetting>({
  default: {
    mode: "",
    model: "",
    resolution: "480p",
    duration: 8,
    audio: false,
  },
});
const availableDurations = computed(() => videoDurations(props.modeOptions).filter((duration) => duration >= props.trackScriptDuration));
const modeIntentValue = computed(() => modeIntentSelectValue(props.modeIntent));
const followsReferenceRatio = computed(() => props.modeOptions.referenceRatio === "adaptive"
  && ["singleImage", "startFrameOptional", "endFrameOptional", "startEndRequired"].includes(String(props.resolvedMode ?? props.modeIntent)));
const referenceSummaryText = computed(() => {
  const summary = props.referenceSummary;
  if (!summary) return "";
  const purposes = Object.entries(summary.purposes ?? {})
    .filter(([, count]) => count > 0)
    .map(([purpose, count]) => `${purposeLabel(purpose as any) || purpose}×${count}`)
    .join("、");
  const media = [`图${summary.image}`, `视频${summary.video}`, `音频${summary.audio}`].filter((part) => !part.endsWith("0")).join("、");
  return `参考 ${summary.total} 项${media ? `（${media}）` : ""}${purposes ? ` · ${purposes}` : ""}`;
});
const availableResolutions = computed(() => videoResolutions(props.modeOptions, modelParmas.value.duration));
watch(availableResolutions, (values) => { if (values.length && !values.includes(modelParmas.value.resolution)) modelParmas.value.resolution = values[0]; }, { immediate: true });
const emit = defineEmits<{
  modeChange: [value: string];
  durationUpdated: [value: { trackId: number; version: number }];
}>();
const durationIntent = ref<{ signature: string; key: string }>();
const durationConflict = ref<{ trackId: number; version: number }>();
function handleBeforeChange(newVal: SelectValue<SelectOption>) {
  if (typeof newVal === "string") emit("modeChange", newVal);
}
async function updateDuration(newDuration: number) {
  if (modelParmas.value.duration === newDuration && !durationIntent.value) return;
  modelParmas.value.duration = newDuration;
  if (!props.trackId) return;
  if (!Number.isSafeInteger(props.trackVersion) || props.trackVersion! < 0) {
    window.$message.error("轨道版本尚未加载，请刷新后重试");
    return;
  }
  if (durationConflict.value?.trackId === props.trackId && durationConflict.value.version === props.trackVersion) {
    window.$message.error("轨道版本已冲突，已保留当前时长，请先刷新");
    return;
  }
  const payload = {
    id: props.trackId,
    projectId: props.projectId,
    scriptId: props.scriptId,
    duration: newDuration,
    expectedVersion: props.trackVersion,
  };
  const signature = JSON.stringify(payload);
  if (durationIntent.value?.signature !== signature) durationIntent.value = { signature, key: createIdempotencyKey("track-duration") };
  try {
    const response: any = await axios.post("/production/workbench/updateVideoDuration", { ...payload, idempotencyKey: durationIntent.value.key });
    emit("durationUpdated", { trackId: props.trackId, version: Number(response.version) });
    durationConflict.value = undefined;
    durationIntent.value = undefined;
  } catch (error: any) {
    const status = Number(error?.status);
    if (status === 409) {
      durationConflict.value = { trackId: props.trackId, version: props.trackVersion! };
      window.$message.error("轨道已被其他成员修改，已保留当前时长，请刷新后再确认");
    }
    else window.$message.error(error?.message ?? "轨道时长保存失败");
    if (Number.isSafeInteger(status) && status < 500) durationIntent.value = undefined;
  }
}
</script>

<style lang="scss" scoped>
.modeMenu {
  width: 100%;
  .left {
    flex: 1;
    gap: 8px;
    flex-wrap: wrap;
    .mode {
      width: 280px;
    }
    .status {
      .btn {
        cursor: pointer;
        &:hover {
          background-color: var(--td-bg-color-secondarycontainer);
        }
      }
    }
  }
}
</style>
<style lang="scss">
.resolutionDurationPicker {
  min-width: 240px;
  max-height: min(70vh, 560px);
  overflow-y: auto;
  .durationContext {
    margin-bottom: 10px;
    color: var(--td-text-color-secondary);
    font-size: 12px;
    line-height: 1.5;
    &.warning {
      color: var(--td-error-color-6);
    }
    &.muted {
      color: var(--td-text-color-placeholder);
    }
  }
  .pickerSection {
    margin-bottom: 16px;

    &:last-child {
      margin-bottom: 0;
    }

    .pickerLabel {
      font-size: 13px;
      font-weight: 600;
      color: var(--td-text-color-primary);
      margin-bottom: 10px;
    }

    .pickerOptions {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;

      .pickerOption {
        padding: 6px 0;
        border-radius: 8px;
        border: 1.5px solid var(--td-border-level-1-color);
        font-size: 13px;
        color: var(--td-text-color-primary);
        cursor: pointer;
        transition: all 0.15s;
        user-select: none;
        text-align: center;
        background: var(--td-bg-color-container);

        &:hover {
          border-color: var(--td-border-level-2-color);
        }

        &.active {
          border-color: var(--td-text-color-primary);
          color: var(--td-text-color-primary);
          font-weight: 500;
        }
      }
    }
  }
}
</style>
