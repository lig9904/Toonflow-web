<template>
  <div class="editVideo">
    <splitpanes class="default-theme content" horizontal :push-other-panes="false">
      <pane size="60">
        <splitpanes :push-other-panes="false">
          <pane size="20" min-size="10">
            <mediaLibrary
              :initial-video-items="initialVideoItems"
              :initial-media-items="initialMediaItems"
              :initial-audio-items="initialAudioItems"
              :initial-image-items="initialImageItems" />
          </pane>
          <pane size="60" min-size="20">
            <div ref="previewWrapperRef" class="previewWrapper">
              <videoPreview ref="videoPreviewRef" :canvas-width="canvasWidth" :canvas-height="canvasHeight" :style="previewStyle" />
            </div>
          </pane>
          <pane size="20" min-size="10">
            <propertyPanel />
          </pane>
        </splitpanes>
      </pane>
      <pane size="40" class="pr">
        <VideoTrack
          class="videoTrack"
          ref="videoTrackRef"
          :operation-buttons="operationButtons"
          :scale-config-buttons="scaleConfigButtons"
          :track-types="trackTypes"
          :clip-configs="clipConfigs"
          :enable-main-track-mode="true"
          :enable-cross-track-drag="true"
          :enable-snap="true"
          :default-scale="1"
          @add-transition="handleAddTransitionFromClick"
          @drop-media="handleDropMedia"
          @transition-added="onTransitionAdded">
          <!-- 自定义操作按钮 -->
          <template #custom-operation-reset>
            <t-button variant="text" size="small" @click="videoTrackRef?.reset()" :title="$t('workbench.production.editVideo.reset')">
              <template #icon><i-refresh size="16" /></template>
              {{ $t("workbench.production.editVideo.reset") }}
            </t-button>
          </template>

          <template #custom-operation-undo>
            <t-button
              variant="text"
              size="small"
              :disabled="!historyStore.canUndo"
              @click="historyStore.undo()"
              :title="$t('workbench.production.editVideo.undo')">
              <template #icon><i-undo size="16" /></template>
              {{ $t("workbench.production.editVideo.undo") }}
            </t-button>
          </template>

          <template #custom-operation-redo>
            <t-button
              variant="text"
              size="small"
              :disabled="!historyStore.canRedo"
              @click="historyStore.redo()"
              :title="$t('workbench.production.editVideo.redo')">
              <template #icon><i-redo size="16" /></template>
              {{ $t("workbench.production.editVideo.redo") }}
            </t-button>
          </template>

          <template #custom-operation-split>
            <t-button
              variant="text"
              size="small"
              :disabled="tracksStore.selectedClipIds.size === 0"
              @click="handleSplit"
              :title="$t('workbench.production.editVideo.split')">
              <template #icon><i-cutting-one size="16" /></template>
              {{ $t("workbench.production.editVideo.split") }}
            </t-button>
          </template>

          <template #custom-operation-delete>
            <t-button variant="text" size="small" @click="handleDeleteClips" :title="$t('workbench.production.editVideo.delete')">
              <template #icon><i-delete size="16" /></template>
              {{ $t("workbench.production.editVideo.delete") }}
            </t-button>
          </template>
          <!-- <template #custom-operation-import>
            <t-button variant="text" size="small" @click="handleImport" :title="$t('workbench.production.editVideo.importProject')">
              <template #icon><i-folder-open size="16" /></template>
              {{ $t("workbench.production.editVideo.import") }}
            </t-button>
          </template> -->
          <template #scale-append>
            <span class="timelineSaveStatus" :class="`is-${autoSaveStatus}`">{{ autoSaveStatusLabel }}</span>
            <t-button theme="danger" @click="handleExport" :loading="isExporting" :title="$t('workbench.production.editVideo.exportProject')">
              <template #icon><i-export size="16" style="margin-right: 4px" /></template>
              {{ isExporting ? $t("workbench.production.editVideo.rendering") : $t("workbench.production.editVideo.exportVideo") }}
            </t-button>
          </template>
        </VideoTrack>
      </pane>
    </splitpanes>
  </div>
</template>

<script setup lang="ts">
import mediaLibrary from "./mediaLibrary.vue";
import videoPreview from "./videoPreview.vue";
import propertyPanel from "./propertyPanel.vue";
import axios from "@/utils/axios";
import { createIdempotencyKey } from "@/utils/idempotency";
import { Splitpanes, Pane } from "splitpanes";
import "vue-clip-track/style.css";
import {
  VideoTrack,
  useTracksStore,
  usePlaybackStore,
  useHistoryStore,
  generateId,
  normalizeTime,
  type OperationButton,
  type ScaleConfigButton,
  type TrackTypeConfig,
  type Track,
  type Clip,
  type MediaClip,
} from "vue-clip-track";

import type { MediaItem, AudioItem } from "./utils/mediaData";
import { getDefaultDuration, findOrCreateTrackWithSpace } from "./utils/trackHelper";
import { loadVideoClipThumbnails, loadAudioClipWaveform, loadInitialAudioWaveforms } from "./utils/mediaLoader";
import { findAdjacentClipsAtTime, addTransitionBetweenClips } from "./utils/transitionHelper";
import { getSourceDuration, getTracksTimelineEnd } from "./utils/timeline";

const props = withDefaults(
  defineProps<{
    initialTracks?: Track[];
    initialVideoItems?: MediaItem[];
    initialMediaItems?: MediaItem[];
    initialAudioItems?: AudioItem[];
    initialImageItems?: MediaItem[];
    projectId?: number;
    scriptId?: number;
    initialTimelineVersion?: number;
    initialTimelineSaved?: boolean;
    canvasWidth?: number;
    canvasHeight?: number;
  }>(),
  {
    initialTracks: () => [],
    initialMediaItems: () => [],
    initialAudioItems: () => [],
    initialImageItems: () => [],
    canvasWidth: 1920,
    canvasHeight: 1080,
  },
);

const aspectRatio = computed(() => props.canvasWidth / props.canvasHeight);

// 预览区域自适应尺寸
const previewWrapperRef = ref<HTMLElement>();
const wrapperSize = reactive({ width: 0, height: 0 });
let resizeObserver: ResizeObserver | null = null;

const previewStyle = computed(() => {
  const { width: cw, height: ch } = wrapperSize;
  if (cw <= 0 || ch <= 0) return {};
  const ratio = aspectRatio.value;
  if (cw / ch > ratio) {
    return { height: ch + "px", width: Math.floor(ch * ratio) + "px" };
  }
  return { width: cw + "px", height: Math.floor(cw / ratio) + "px" };
});

const tracksStore = useTracksStore();
const playbackStore = usePlaybackStore();
const historyStore = useHistoryStore();

const operationButtons = ref<OperationButton[]>([
  { type: "custom", key: "reset" },
  { type: "custom", key: "undo" },
  { type: "custom", key: "redo" },
  { type: "custom", key: "split" },
  { type: "custom", key: "delete" },
  { type: "custom", key: "import" },
]);

const scaleConfigButtons = ref<ScaleConfigButton[]>(["snap"]);

const trackTypes = ref<TrackTypeConfig>({
  video: { max: 5 },
  image: { max: 3 },
  audio: { max: 3 },
  subtitle: { max: 2 },
  text: { max: 2 },
  sticker: { max: 2 },
  filter: { max: 1 },
  effect: { max: 2 },
});

const clipConfigs = ref({
  video: {
    backgroundColor: "linear-gradient(45deg, #667eea 0%, #764ba2 100%)",
    borderColor: "#000000",
    height: 60,
    selected: {
      borderColor: "#ff6b6b",
      boxShadow: "0 0 0 3px rgba(255, 107, 107, 0.3)",
    },
  },
  audio: {
    backgroundColor: "linear-gradient(45deg, #f093fb 0%, #f5576c 100%)",
    height: 36,
    selected: {
      borderColor: "#4ecdc4",
    },
  },
  image: {
    backgroundColor: "linear-gradient(45deg, #43e97b 0%, #38f9d7 100%)",
    borderColor: "#43e97b",
    height: 60,
    selected: {
      borderColor: "#ff6b6b",
      boxShadow: "0 0 0 3px rgba(255, 107, 107, 0.3)",
    },
  },
});

const videoTrackRef = ref();
const videoPreviewRef = ref<InstanceType<typeof videoPreview>>();
const isExporting = ref(false);
const timelineVersion = ref(props.initialTimelineVersion ?? 0);
const autoSaveStatus = ref<"saved" | "saving" | "pending" | "error">(props.initialTimelineSaved === false ? "pending" : "saved");
const autoSaveStatusLabel = computed(() => ({ saved: "已保存", saving: "保存中", pending: "待保存", error: "保存失败" })[autoSaveStatus.value]);
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let autoSaveInFlight = false;
let autoSaveDirty = false;
let hydratingTimeline = true;
let unmountingTimeline = false;
let saveIntent: { signature: string; key: string } | null = null;

function localDraftKey() {
  const identity = typeof localStorage !== "undefined" ? localStorage.getItem("toonflow.user") : null;
  let userId = "session";
  try { userId = String(JSON.parse(identity ?? "{}").id ?? "session"); } catch { /* use session fallback */ }
  return `toonflow.editTimeline:${userId}:${props.projectId ?? "unknown"}:${props.scriptId ?? "unknown"}`;
}

function saveLocalDraft(timeline: ReturnType<typeof timelinePayload>, baseVersion: number) {
  if (!props.projectId || !props.scriptId || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(localDraftKey(), JSON.stringify({ projectId: props.projectId, scriptId: props.scriptId, baseVersion, timeline, updatedAt: Date.now() }));
  } catch (error) {
    console.error("Failed to persist edit timeline draft:", error);
  }
}

function readLocalDraft(): { baseVersion: number; timeline: { tracks?: unknown[] } } | null {
  if (!props.projectId || !props.scriptId || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(localDraftKey());
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (Number(value?.projectId) !== Number(props.projectId) || Number(value?.scriptId) !== Number(props.scriptId) || !Array.isArray(value?.timeline?.tracks)) return null;
    return { baseVersion: Number(value.baseVersion) || 0, timeline: value.timeline };
  } catch {
    return null;
  }
}

function clearLocalDraftIfCurrent(signature: string) {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(localDraftKey());
    if (!raw) return;
    const value = JSON.parse(raw);
    if (JSON.stringify(value?.timeline ?? {}) === signature) localStorage.removeItem(localDraftKey());
  } catch { /* ignore malformed stale drafts */ }
}

function timelinePayload() {
  return { tracks: JSON.parse(JSON.stringify(tracksStore.tracks)) };
}

async function flushTimelineAutosave() {
  if (!props.projectId || !props.scriptId || hydratingTimeline || !autoSaveDirty || autoSaveInFlight) return;
  autoSaveInFlight = true;
  autoSaveDirty = false;
  autoSaveStatus.value = "saving";
  const timeline = timelinePayload();
  saveLocalDraft(timeline, timelineVersion.value);
  const signature = JSON.stringify(timeline);
  if (!saveIntent || saveIntent.signature !== signature) saveIntent = { signature, key: createIdempotencyKey("edit-timeline") };
  try {
    const response: any = await axios.post("/production/workbench/saveEditTimeline", {
      projectId: props.projectId,
      scriptId: props.scriptId,
      expectedVersion: timelineVersion.value,
      idempotencyKey: saveIntent.key,
      timeline,
    });
    const result = response?.data ?? response;
    timelineVersion.value = Number(result.version ?? timelineVersion.value);
    clearLocalDraftIfCurrent(signature);
    saveIntent = null;
    autoSaveStatus.value = "saved";
  } catch (error: any) {
    autoSaveDirty = true;
    autoSaveStatus.value = "error";
    if (error?.status === 409 || error?.code === "VERSION_CONFLICT") window.$message.error("时间线已被其他成员修改，已保留本地编辑");
    else console.error("Failed to autosave edit timeline:", error);
  } finally {
    autoSaveInFlight = false;
    if (autoSaveDirty && autoSaveStatus.value !== "error") {
      if (unmountingTimeline) void flushTimelineAutosave();
      else scheduleTimelineAutosave();
    }
  }
}

function scheduleTimelineAutosave() {
  if (!props.projectId || !props.scriptId || hydratingTimeline) return;
  autoSaveStatus.value = "pending";
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    void flushTimelineAutosave();
  }, 700);
}

watch(
  () => tracksStore.tracks,
  () => {
    if (hydratingTimeline) return;
    autoSaveDirty = true;
    saveLocalDraft(timelinePayload(), timelineVersion.value);
    scheduleTimelineAutosave();
  },
  { deep: true, flush: "post" },
);

watch(
  () => props.initialTimelineSaved,
  (saved) => {
    if (saved && !autoSaveDirty && !autoSaveInFlight) autoSaveStatus.value = "saved";
  },
);

watch(
  () => props.initialTimelineVersion,
  (version) => {
    if (!autoSaveDirty && !autoSaveInFlight && Number.isFinite(Number(version))) timelineVersion.value = Number(version);
  },
);

async function handleExport() {
  if (!videoPreviewRef.value) return;
  if (isExporting.value) return;
  isExporting.value = true;
  try {
    await videoPreviewRef.value.exportVideo();
    window.$message.success($t("workbench.production.editVideo.exportSuccess"));
  } catch (error: any) {
    if (error.name === "AbortError") return; // 用户取消保存
    window.$message.error(error.message || $t("workbench.production.editVideo.exportFailed"));
  } finally {
    isExporting.value = false;
  }
}

function handleSplit() {
  const selectedIds = Array.from(tracksStore.selectedClipIds);
  if (selectedIds.length === 0) return;
  const currentTime = playbackStore.currentTime;
  selectedIds.forEach((id) => {
    const clip = tracksStore.getClip(id);
    if (!clip || currentTime <= clip.startTime || currentTime >= clip.endTime) return;
    tracksStore.splitClip(id, currentTime);
  });
  historyStore.pushSnapshot($t("workbench.production.editVideo.splitClip"));
}

function handleDeleteClips() {
  const selectedIds = Array.from(tracksStore.selectedClipIds);
  if (selectedIds.length === 0) return;
  tracksStore.removeClips(selectedIds);
  historyStore.pushSnapshot($t("workbench.production.editVideo.deleteClip"));
}

// 处理从资源库拖拽媒体到轨道
async function handleDropMedia(mediaData: any, trackId: string, startTime: number) {
  try {
    if (mediaData.type === "transition") {
      handleDropTransition(mediaData, trackId, startTime);
      return;
    }

    const duration = getDefaultDuration(mediaData.type, mediaData);
    const { track } = findOrCreateTrackWithSpace(tracksStore, mediaData.type, startTime, duration, trackId);
    if (!track) return;

    // Timeline metadata intentionally extends vue-clip-track's Clip shape;
    // keep it local to the editor and do not widen the shared package types.
    let clip: any = {
      id: generateId("clip-"),
      trackId: track.id,
      startTime: normalizeTime(startTime),
      selected: false,
    };

    if (mediaData.type === "video") {
      const sourceUrl = mediaData.sourceUrl || mediaData.url || mediaData.id;
      const sourceDuration = getSourceDuration(mediaData, duration);
      clip = {
        ...clip,
        type: "video",
        name: mediaData.name,
        endTime: normalizeTime(startTime + duration),
        sourceUrl,
        // `originalDuration` describes the generated source. The timeline
        // interval above describes the planned shot duration.
        originalDuration: sourceDuration,
        trimStart: 0,
        trimEnd: Math.min(duration, sourceDuration),
        playbackRate: 1,
        thumbnails: mediaData.thumbnails || [],
        sourceDuration,
        plannedDuration: duration,
        sourceRef: mediaData.sourceRef || {
          id: mediaData.videoId ?? mediaData.assetId ?? mediaData.id,
          trackId: mediaData.videoTrackId ?? mediaData.trackId,
          version: mediaData.videoVersion ?? mediaData.version,
        },
      } as Partial<MediaClip>;

      tracksStore.addClip(track.id, clip as Clip);
      historyStore.pushSnapshot($t("workbench.production.editVideo.addClip", { name: mediaData.name }));

      if (!mediaData.thumbnails || mediaData.thumbnails.length === 0) {
        loadVideoClipThumbnails(tracksStore, clip.id!, sourceUrl);
      }
      return;
    } else if (mediaData.type === "image") {
      const sourceUrl = mediaData.sourceUrl || mediaData.url || mediaData.id;
      clip = {
        ...clip,
        type: "image" as any,
        name: mediaData.name,
        endTime: normalizeTime(startTime + duration),
        sourceUrl,
        originalDuration: duration,
        trimStart: 0,
        trimEnd: duration,
        playbackRate: 1,
        thumbnails: mediaData.thumbnail ? [mediaData.thumbnail] : [],
        plannedDuration: duration,
      };

      tracksStore.addClip(track.id, clip as Clip);
      historyStore.pushSnapshot($t("workbench.production.editVideo.addClip", { name: mediaData.name }));
      return;
    } else if (mediaData.type === "audio") {
      const sourceUrl = mediaData.sourceUrl || mediaData.url || mediaData.id;
      const sourceDuration = getSourceDuration(mediaData, duration);
      clip = {
        ...clip,
        type: "audio",
        name: mediaData.name,
        endTime: normalizeTime(startTime + duration),
        sourceUrl,
        originalDuration: sourceDuration,
        trimStart: 0,
        trimEnd: Math.min(duration, sourceDuration),
        playbackRate: 1,
        volume: 1,
        waveformData: mediaData.waveformData || [],
        sourceDuration,
        plannedDuration: duration,
        sourceRef: mediaData.sourceRef || {
          id: mediaData.audioId ?? mediaData.assetId ?? mediaData.id,
          trackId: mediaData.audioTrackId ?? mediaData.trackId,
          version: mediaData.audioVersion ?? mediaData.version,
        },
      } as Partial<MediaClip>;

      tracksStore.addClip(track.id, clip as Clip);
      historyStore.pushSnapshot($t("workbench.production.editVideo.addClip", { name: mediaData.name }));

      if (!mediaData.waveformData || mediaData.waveformData.length === 0) {
        loadAudioClipWaveform(tracksStore, clip.id!, sourceUrl);
      }
      return;
    } else if (mediaData.type === "subtitle") {
      clip = {
        ...clip,
        type: "subtitle",
        name: mediaData.name,
        endTime: normalizeTime(startTime + duration),
        text: $t("workbench.production.editVideo.sampleSubtitle"),
      };
    } else if (mediaData.type === "text") {
      clip = {
        ...clip,
        type: "text",
        name: mediaData.name,
        endTime: normalizeTime(startTime + duration),
        text: $t("workbench.production.editVideo.customText"),
      };
    } else if (mediaData.type === "sticker") {
      clip = { ...clip, type: "sticker", name: mediaData.name, endTime: normalizeTime(startTime + duration), sourceUrl: mediaData.id };
    } else if (mediaData.type === "filter") {
      clip = {
        ...clip,
        type: "filter",
        name: mediaData.name,
        endTime: normalizeTime(startTime + duration),
        filterType: mediaData.filterType || mediaData.id,
        filterValue: mediaData.filterValue ?? 1,
      };
    } else if (mediaData.type === "effect") {
      clip = {
        ...clip,
        type: "effect",
        name: mediaData.name,
        endTime: normalizeTime(startTime + duration),
        effectType: mediaData.effectType || mediaData.id,
        effectDuration: duration,
      };
    }

    tracksStore.addClip(track.id, clip as Clip);
    historyStore.pushSnapshot($t("workbench.production.editVideo.addClip", { name: mediaData.name }));
  } catch (error: any) {
    alert(error.message);
  }
}

// 处理转场拖拽
function handleDropTransition(transitionData: any, trackId: string, dropTime: number) {
  const track = tracksStore.tracks.find((t) => t.id === trackId);
  if (!track) return;

  const clips = track.clips.filter((c) => c.type !== "transition").sort((a, b) => a.startTime - b.startTime);
  if (clips.length === 0) {
    window.$message.warning($t("workbench.production.editVideo.transitionBetweenClips"));
    return;
  }

  const result = findAdjacentClipsAtTime(clips, dropTime);
  if (!result) {
    window.$message.warning($t("workbench.production.editVideo.transitionBetweenClips"));
    return;
  }

  applyTransition(result.beforeClip.id, result.afterClip.id, transitionData.subType);
}

function handleAddTransitionFromClick(beforeClipId: string, afterClipId: string) {
  applyTransition(beforeClipId, afterClipId, "fade");
}

// 添加转场并触发后续事件
function applyTransition(beforeClipId: string, afterClipId: string, transitionType: string = "fade") {
  const result = addTransitionBetweenClips(tracksStore, historyStore, beforeClipId, afterClipId, transitionType);
  if (result) {
    if (videoTrackRef.value) {
      videoTrackRef.value.emitTransitionAdded(result.transitionClip, result.beforeClip.id, result.afterClip.id);
    }
  }
}

function onTransitionAdded(transitionClip: any, beforeClipId: string, afterClipId: string) {
  window.$message.success($t("workbench.production.editVideo.transitionAdded", { name: transitionClip.name }));
  playbackStore.seekTo(transitionClip.startTime);
}

function restoreLocalDraftIfSafe() {
  const draft = readLocalDraft();
  if (!draft) return;
  if (draft.baseVersion < timelineVersion.value) {
    autoSaveStatus.value = "error";
    window.$message.warning("发现旧版本地时间线草稿，服务器版本较新，未自动覆盖服务器内容");
    return;
  }
  tracksStore.reset();
  for (const track of draft.timeline.tracks ?? []) tracksStore.addTrack(track as Track);
  timelineVersion.value = draft.baseVersion;
  autoSaveDirty = true;
  autoSaveStatus.value = "pending";
}

// 初始化轨道数据
async function initializeTracks() {
  tracksStore.reset();

  if (props.initialTracks.length > 0) {
    props.initialTracks.forEach((track) => {
      tracksStore.addTrack(track);
    });
  }
  restoreLocalDraftIfSafe();

  // The old editor seeded a five-minute duration. That value became the
  // playback range even when the actual project was a 60-second timeline.
  // Derive it from the supplied plan and use 60 seconds only for an empty
  // demo timeline.
  const plannedDuration = getTracksTimelineEnd(props.initialTracks);
  playbackStore.setDuration(plannedDuration > 0 ? plannedDuration : 60);
  playbackStore.seekTo(0);
  historyStore.initialize();
  await loadInitialAudioWaveforms(tracksStore);
  nextTick(() => {
    hydratingTimeline = false;
  });
}

onMounted(async () => {
  await initializeTracks();

  if (previewWrapperRef.value) {
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        wrapperSize.width = entry.contentRect.width;
        wrapperSize.height = entry.contentRect.height;
      }
    });
    resizeObserver.observe(previewWrapperRef.value);
  }
});

onBeforeUnmount(() => {
  unmountingTimeline = true;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  if (autoSaveDirty) saveLocalDraft(timelinePayload(), timelineVersion.value);
  void flushTimelineAutosave();
});

onUnmounted(() => {
  playbackStore.pause();
  resizeObserver?.disconnect();
});
</script>

<style lang="scss" scoped>
.editVideo {
  .content {
    height: calc(100vh - var(--td-comp-paddingTB-xl) * 2 - 50px - 16px);
  }

  .previewWrapper {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: var(--td-bg-color-secondarycontainer);
    border: 1px solid var(--td-border-level-1-color);
    border-radius: 10px;
  }
  .videoTrack {
    height: 100%;
    border: 1px solid var(--td-border-level-1-color);
    border-radius: 10px;
  }

  .timelineSaveStatus {
    margin-right: 8px;
    font-size: 12px;
    color: var(--td-text-color-secondary);
  }

  .timelineSaveStatus.is-error {
    color: var(--td-error-color);
  }
}
:deep(.ruler__cursor-handle) {
  &:hover {
    filter: none !important;
  }
}
:deep(.splitpanes__pane) {
  background-color: transparent !important;
}
:deep(.splitpanes__splitter) {
  border: none !important;
  margin: 0px !important;
}
:deep(.tools-bar__select) {
  display: none !important;
}
:deep(.video-track) {
  --color-primary: var(--td-text-color-primary);
  --color-bg-dark: var(--td-bg-color-component);
  --color-bg-medium: var(--td-bg-color-secondarycontainer);
  --color-text-primary: var(--td-text-color-primary);
  .ruler {
    background-color: var(--td-bg-color-container);
    .ruler__placeholder {
      background-color: var(--td-bg-color-secondarycontainer);
    }
  }
  .track-control {
    background-color: var(--td-bg-color-container);
  }
  .tools-bar {
    background-color: var(--td-bg-color-container);
  }
  .tools-bar__time {
    background-color: var(--td-bg-color-secondarycontainer);
  }
  .tools-bar__btn {
    background-color: var(--td-brand-color-active);
    &:hover {
      background-color: var(--td-bg-color-container-hover);
      box-shadow: none;
    }
  }

  .tracks__scrollbar {
    background-color: var(--td-bg-color-container);
  }
}
</style>
