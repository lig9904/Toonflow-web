<template>
  <t-dialog
    body="String"
    :header="false"
    :footer="false"
    :closeBtn="false"
    v-model:visible="visible"
    attach="body"
    placement="center"
    mode="full-screen"
    dialogClassName="noFooter"
    class="fullscreenDialog">
    <div class="closure">
      <i-close-small theme="outline" size="24" fill="#4a4a4a" @click="requestClose" />
    </div>
    <div class="topMenu f ac">
      <t-tooltip :content="$t('workbench.production.wb.quickPreview')" placement="bottom" theme="light" destroyOnClose :showArrow="false">
        <div class="item fc c" :class="{ active: activeMenu === 'preview' }" @click="changeMenu('preview')">
          <i-blackboard class="icon" />
        </div>
      </t-tooltip>
      <t-tooltip :content="$t('workbench.production.wb.videoGeneration')" placement="bottom" theme="light" destroyOnClose :showArrow="false">
        <div class="item fc c" :class="{ active: activeMenu === 'generate' }" @click="changeMenu('generate')">
          <i-playback-progress class="icon" />
        </div>
      </t-tooltip>
      <t-tooltip :content="$t('workbench.production.wb.videoEditing')" placement="bottom" theme="light" destroyOnClose :showArrow="false">
        <div class="item fc c" :class="{ active: activeMenu === 'editVideo' }" @click="changeMenu('editVideo')">
          <i-editing class="icon" />
        </div>
      </t-tooltip>
    </div>
    <div class="content">
      <preview v-if="activeMenu === 'preview'" />
      <generate v-if="activeMenu === 'generate'" @importVideo="handleBatchDownload" v-model="extractLines" />
      <editVideo
        v-if="activeMenu === 'editVideo'"
        :initial-tracks="mockTracks"
        :initial-video-items="initialVideoItems"
        :initial-media-items="mockMediaItems"
        :initial-audio-items="mockAudioItems"
        :initial-image-items="mockImageItems"
        :project-id="Number(project?.id) || undefined"
        :script-id="episodesId"
        :initial-timeline-version="editTimelineVersion"
        :initial-timeline-saved="editTimelineSaved"
        :canvas-width="canvasWidth"
        :canvas-height="canvasHeight"
        ref="editVideoRef" />
    </div>
    <div v-if="importLoading || preparingEditor" class="importLoadingMask">
      <div class="importLoadingContent">
        <t-loading size="large" :text="preparingEditor ? '正在加载剪辑素材和已保存的时间线' : $t('workbench.production.wb.importingLoading')" />
      </div>
    </div>
  </t-dialog>
</template>

<script setup lang="ts">
import { inject, provide, type Ref } from "vue";
import axios from "@/utils/axios";
import { createIdempotencyKey } from "@/utils/idempotency";
import preview from "./preview.vue";
import generate from "./generate/index.vue";
import editVideo from "./editVideo/index.vue";
import { generateId, type Track } from "vue-clip-track";
import type { MediaItem, AudioItem } from "./editVideo/utils/mediaData";
import projectStore from "@/stores/project";
import { confirmCreativeDrafts, hasCreativeDrafts } from "@/utils/creativeDrafts";
const { project } = storeToRefs(projectStore());

const visible = defineModel("visible", {
  type: Boolean,
  default: false,
});
const activeMenu = ref("preview");
let approvedClose = false;
function workbenchDraftScope() { return `project:${Number(project.value?.id)}:episode:${Number(episodesId.value)}`; }
async function confirmWorkbenchDrafts(action: string) { return confirmCreativeDrafts({ scope: workbenchDraftScope(), action }); }
async function requestClose() {
  if (!(await confirmWorkbenchDrafts("关闭视频工作台"))) return;
  approvedClose = true;
  visible.value = false;
}
watch(visible, (next, previous) => {
  if (next || !previous) return;
  if (approvedClose) { approvedClose = false; return; }
  if (!hasCreativeDrafts({ scope: workbenchDraftScope() })) return;
  visible.value = true;
  void requestClose();
});

const navigateCanvasImage=inject<(target:any,repair:boolean)=>Promise<void>>("navigateCanvasImage");
provide("locateVideoImage",async(target:any,repair:boolean)=>{
 if(target.projectId!==Number(project.value?.id)||target.scriptId!==episodesId.value)return;
 if(!await confirmWorkbenchDrafts("定位并处理问题图片"))return;
 approvedClose=true;visible.value=false;
 await nextTick();await navigateCanvasImage?.(target,repair);
});

// 画布尺寸配置
const canvasWidth = ref(1920);
const canvasHeight = ref(1080);

onMounted(() => {
  const size = project.value?.videoRatio;
  if (size == "16:9") {
    canvasWidth.value = 1920;
    canvasHeight.value = 1080;
  } else if (size == "1:1") {
    canvasWidth.value = 1080;
    canvasHeight.value = 1080;
  } else if (size == "9:16") {
    canvasWidth.value = 1080;
    canvasHeight.value = 1920;
  }
});

// ============ 演示数据（可替换为在线资源地址） ============

/** 资源库 - 分镜视频 */
const initialVideoItems = ref<MediaItem[]>([]);

/** 资源库 - 视频素材 */
const mockMediaItems = ref<MediaItem[]>([]);

/** 资源库 - 音频素材 */
const mockAudioItems = ref<AudioItem[]>([]);

/** 资源库 - 图片素材 */
const mockImageItems = ref<MediaItem[]>([]);

const extractLines = ref(false);
const importLoading = ref(false);

onMounted(() => {
  editFootage();
});
type MediaType = "image" | "video" | "audio" | "unknown";
type ImportVideoItem = {
  trackId: number;
  videoId: number;
  src: string;
  duration: number;
};

function getMediaType(src?: string): MediaType {
  if (!src) return "unknown";
  const ext = src.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) return "image";
  if (["mp4", "webm", "ogg", "mov", "avi", "mkv"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "aac", "flac", "m4a"].includes(ext)) return "audio";
  return "unknown";
}
//切换菜单
const preparingEditor = ref(false);
let menuRequestSequence = 0;
async function changeMenu(type: string) {
  if (activeMenu.value === type) return;
  if (activeMenu.value === "generate" && !(await confirmWorkbenchDrafts("切换工作台功能"))) return;
  const request = ++menuRequestSequence;
  if (type !== "editVideo") {
    ++footageLoadSequence;
    preparingEditor.value = false;
    activeMenu.value = type;
    return;
  }
  preparingEditor.value = true;
  try {
    // The editor hydrates its store on mount. Mount only after the persisted
    // draft and media have loaded so a late response cannot leave it empty.
    const ready = await editFootage();
    if (request !== menuRequestSequence) return;
    if (ready) activeMenu.value = type;
    else window.$message.error("剪辑数据加载失败，请重试");
  } finally {
    if (request === menuRequestSequence) preparingEditor.value = false;
  }
}
const episodesId = inject<Ref<number>>("episodesId")!;
//查询剪辑素材
async function editFootage(): Promise<boolean> {
  const sequence = ++footageLoadSequence;
  const projectId = Number(project.value?.id);
  const scriptId = Number(episodesId.value ?? 0);
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || !Number.isSafeInteger(scriptId) || scriptId <= 0) return false;
  try {
    const [materialResponse, timelineResponse] = await Promise.all([
      axios.post("/assets/getMaterialData", { projectId, scriptId }),
      axios.post("/production/workbench/getEditTimeline", { projectId, scriptId }),
    ]);
    if (sequence !== footageLoadSequence) return false;
    const data = (materialResponse as any).data ?? materialResponse;
    const saved = (timelineResponse as any).data ?? timelineResponse;
    const materialRows = Array.isArray(data?.data) ? data.data : [];
    const videoGroups = Array.isArray(data?.video) ? data.video : [];
    const videoList = materialRows.filter((item: any) => getMediaType(item.filePath) === "video");
    const audioList = materialRows.filter((item: any) => getMediaType(item.filePath) === "audio");
    const imageList = materialRows.filter((item: any) => getMediaType(item.filePath) === "image");
    initialVideoItems.value = videoGroups.flatMap((item: any, index: number) =>
      Array.isArray(item.video)
        ? item.video.map((subItem: any, subIndex: number) => ({
            id: `video-${subItem.id}`,
            type: "video",
            name: "#" + $t("workbench.production.wb.storyboardVideoName", { storyboard: index + 1, id: subIndex + 1 }),
            duration: subItem.sourceDuration || 0,
            sourceDuration: subItem.sourceDuration || 0,
            plannedDuration: item.plannedDuration || 0,
            sourceRef: subItem.sourceRef,
            icon: "🎬",
            color: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            url: subItem.filePath,
            selected: item.videoId == subItem.id,
          }))
        : [],
    ) as any;
    mockMediaItems.value = videoList.map((item: any) => ({
      id: `video-${item.id}`, type: "video", name: item.name, duration: item.duration || 0,
      icon: "🎥", color: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", url: item.filePath, loading: true,
    }));
    mockAudioItems.value = audioList.map((item: any) => ({ id: `audio-${item.id}`, type: "audio", name: item.name, duration: item.duration || 0, url: item.filePath, loading: true }));
    mockImageItems.value = imageList.map((item: any) => ({
      id: `image-${item.id}`, type: "image", name: item.name, duration: item.duration || 5,
      icon: "🖼️", color: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)", url: item.filePath, loading: true,
    }));

    // A saved draft is authoritative. Initial storyboard assembly happens
    // only once, when no persisted timeline exists yet.
    if (saved?.exists && Array.isArray(saved.timeline?.tracks)) {
      mockTracks.value = saved.timeline.tracks as Track[];
      editTimelineVersion.value = Number(saved.version) || 0;
      editTimelineSaved.value = true;
    } else {
      mockTracks.value = createTimelineTracks(videoGroups);
      editTimelineVersion.value = 0;
      editTimelineSaved.value = false;
      const hasInitialClips = mockTracks.value.some((track) => track.clips.length > 0);
      if (!hasInitialClips) return true;
      try {
        const initialSave: any = await axios.post("/production/workbench/saveEditTimeline", {
          projectId,
          scriptId,
          expectedVersion: 0,
          idempotencyKey: createIdempotencyKey("edit-timeline-initial"),
          timeline: { tracks: mockTracks.value },
        });
        const savedInitial = initialSave?.data ?? initialSave;
        editTimelineVersion.value = Number(savedInitial.version) || 0;
        editTimelineSaved.value = true;
      } catch (error) {
        console.error("Failed to persist initial edit timeline:", error);
      }
    }
    return true;
  } catch (error) {
    console.error("Failed to load edit timeline:", error);
    return false;
  }
}

function createDemoTracks(): Track[] {
  const createTrack = (type: Track["type"], name: string, order: number, isMain: boolean = false): Track => ({
    id: generateId("track-"),
    type,
    name,
    visible: true,
    locked: false,
    clips: [],
    order,
    ...(isMain && { isMain }),
  });
  return [
    createTrack("video", "主轨道", 0, true),
    createTrack("audio", "音频", 2),
    createTrack("subtitle", "字幕", 3),
    createTrack("filter", "滤镜", 4),
  ];
}

const mockTracks = ref<Track[]>(createDemoTracks());
const editTimelineVersion = ref(0);
const editTimelineSaved = ref(false);
let footageLoadSequence = 0;

function createTimelineTracks(videoGroups: any[]): Track[] {
  const tracks = createDemoTracks();
  const mainTrack = tracks.find((track) => track.type === "video" && track.isMain);
  if (!mainTrack) return tracks;
  let cursor = 0;
  for (const [groupIndex, group] of videoGroups.entries()) {
    const videos = Array.isArray(group?.video) ? group.video : [];
    const selected = videos.find((video: any) => Number(video.id) === Number(group.videoId)) ?? videos[0];
    if (!selected?.filePath) continue;
    const plannedDuration = Number(group.plannedDuration ?? selected.plannedDuration ?? group.duration);
    if (!Number.isFinite(plannedDuration) || plannedDuration <= 0) continue;
    const sourceDuration = Number(selected.sourceDuration) > 0 ? Number(selected.sourceDuration) : 0;
    const clipDuration = plannedDuration;
    mainTrack.clips.push({
      id: `storyboard-video-${group.trackId ?? group.id ?? groupIndex}`,
      trackId: mainTrack.id,
      type: "video",
      name: `#${groupIndex + 1}`,
      startTime: cursor,
      endTime: cursor + clipDuration,
      sourceUrl: selected.filePath,
      originalDuration: sourceDuration || plannedDuration,
      sourceDuration,
      plannedDuration,
      sourceShortfall: sourceDuration > 0 && sourceDuration < plannedDuration,
      trimStart: 0,
      trimEnd: clipDuration,
      playbackRate: 1,
      volume: 1,
      thumbnails: [],
      selected: false,
      sourceRef: selected.sourceRef ?? {
        projectId: Number(project.value?.id),
        scriptId: Number(episodesId.value),
        trackId: Number(group.trackId ?? group.id),
        videoId: Number(selected.id),
        version: Number(group.trackVersion ?? group.version ?? 0),
      },
    } as any);
    cursor += clipDuration;
  }
  return tracks;
}

//导入到剪辑台
function handleBatchDownload(value: ImportVideoItem[]) {}
</script>

<style lang="scss" scoped>
:deep(.t-dialog__body) {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  position: relative;
}
.fullscreenDialog {
  .importLoadingMask {
    position: absolute;
    inset: 0;
    background: var(--td-mask-active);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(4px);
    .importLoadingContent {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }
  }
  .closure {
    position: absolute;
    top: var(--td-comp-paddingTB-xl);
    right: var(--td-comp-paddingLR-xxl);
    z-index: 9999;
    cursor: pointer;
    margin-top: 20px;
  }
  .topMenu {
    padding-bottom: 16px;
    width: fit-content;
    margin-top: 10px;
    .item {
      margin-right: 4px;
      cursor: pointer;
      width: 50px;
      height: 50px;
      .icon {
        font-size: 24px;
      }
      .title {
        font-size: 10px;
        white-space: nowrap;
      }
      &:hover {
        background-color: var(--td-bg-color-container-hover);
        border-radius: 16px;
      }
    }
    .active {
      background-color: var(--td-brand-color) !important;
      border-radius: 16px;
      color: #fff;
    }
  }
  .content {
    flex: 1;
    overflow: hidden;
  }
  .editImage {
    width: 100%;
    height: 75vh;
  }
}
</style>
