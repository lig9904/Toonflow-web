<template>
  <div class="videoTrack">
    <t-card bordered :style="{ height: '100%' }">
      <div class="trackMenu f ac jb">
        <div class="left f ac">
          <t-checkbox v-model="checkAll" @change="handleCheckAll">{{ $t("workbench.generate.selectAll") }}</t-checkbox>
          <span class="selectedCount" v-if="checkedTrackIds.length">{{ $t("workbench.generate.selected") }} {{ checkedTrackIds.length }} 段</span>
        </div>
        <div class="right f ac">
          <t-button size="small" variant="outline" :loading="listRefreshing" :disabled="listRefreshing || !scopeReady" @click="emit('refreshList')">刷新片段列表</t-button>
          <t-button v-if="archivedSharedTracks.length" size="small" variant="outline" @click="archiveVisible = true">历史合并片段（{{ archivedSharedTracks.length }}）</t-button>
          <t-button size="small" variant="outline" :disabled="!checkedTrackIds.length" @click="batchDownloadVideo">{{ $t("workbench.generate.batchDownloadVideo") }}</t-button>
          <t-button size="small" variant="outline" :disabled="!scopeReady || !checkedTrackIds.length || hasPendingPrompt || generateTextLoad" @click="batchGenText" :loading="generateTextLoad">
            {{ $t("workbench.generate.batchGenerateText") }}
          </t-button>
          <t-button size="small" variant="outline" :disabled="!scopeReady || !checkedTrackIds.length || generateVideoLoad" @click="batchGenVideo" :loading="generateVideoLoad">
            {{ $t("workbench.generate.batchGenerateVideo") }}
          </t-button>
          <!-- <t-button size="small" variant="outline" @click="importVideo">{{ $t("workbench.generate.importVideo") }}</t-button> -->
        </div>
      </div>
      <div class="itemBox">
        <div
          class="item"
          :class="{ active: index === activeTrackIndex }"
          v-for="(track, index) in trackList"
          :key="track.id"
          @click="changeIndex(index)">
          <t-checkbox
            class="trackCheck"
            :checked="track.id != null && checkedTrackIds.includes(track.id)"
            @click.stop
            @change="(val: boolean) => toggleCheck(track.id, val)" />
          <t-tag class="indexTag" size="small">{{ cardPresentation(track).title }}</t-tag>
          <t-tag class="kindTag" size="small" variant="light">{{ cardPresentation(track).kindLabel }}</t-tag>
          <t-tag class="selectTag" theme="success" size="small" v-if="track.selectVideoId">已选择</t-tag>
          <t-tag class="promptStateTag" size="small" :theme="promptStateTheme(track)">提示词：{{ promptStateLabel(track) }}</t-tag>
          <t-tooltip :content="trackModeSummary(track)">
            <t-tag class="modeTag" size="small" :theme="track.compatibility && !track.compatibility.ok ? 'danger' : 'default'">
              {{ videoModeLabel(track.resolvedMode ?? track.modeIntent ?? 'auto') }}
            </t-tag>
          </t-tooltip>
          <t-tooltip v-if="track.state === '生成失败' && track.reason" :content="track.reason">
            <span class="promptFailureMark">!</span>
          </t-tooltip>
          <!-- 优先展示选中视频的首帧 -->
          <div class="thumbGroup" v-if="track.selectVideoId && getSelectedVideoSrc(track)">
            <img
              v-if="videoCoverMap[getSelectedVideoSrc(track)!]"
              class="thumb selectedVideoThumb"
              :src="videoCoverMap[getSelectedVideoSrc(track)!]"
              draggable="false" />
            <div v-else class="thumb placeholder c">
              <i-video size="24" />
            </div>
          </div>
          <!-- 无选中视频时展示参考素材缩略图 -->
          <div class="thumbGroup" v-else-if="track.medias.some((m) => m.src)">
            <template v-for="(m, i) in track.medias" :key="i">
              <template v-if="m.src">
                <t-image fit="cover" v-if="m.fileType === 'image'" :src="m.src" class="thumb" />
                <div v-else class="thumb placeholder c">
                  <i-volume-notice v-if="m.fileType === 'audio'" size="20" />
                  <i-video v-else size="24" />
                </div>
              </template>
            </template>
          </div>
          <span v-else class="emptyTrack">{{ cardPresentation(track).deleteLabel === '删除片段' ? '自建空片段' : $t("workbench.generate.emptyTrack", { index: index + 1 }) }}</span>
          <t-tooltip v-if="cardPresentation(track).mutationBlockedReason" :content="cardPresentation(track).mutationBlockedReason">
            <span class="mutationBlocked">!</span>
          </t-tooltip>
          <t-button v-if="track.videoList.length && !cardPresentation(track).mutationBlockedReason" class="clearVideosBtn" size="small" variant="text" @click.stop="confirmClearTrackVideos(index)">清空视频</t-button>
          <t-button v-if="cardPresentation(track).deleteLabel === '删除分镜' && !cardPresentation(track).mutationBlockedReason" class="reloadTrackBtn" size="small" variant="text" @click.stop="confirmReloadTrack(index)">重新载入</t-button>
          <t-tooltip v-if="cardPresentation(track).deleteLabel && !cardPresentation(track).mutationBlockedReason" :content="cardPresentation(track).deleteLabel">
            <div class="deleteBtn" :aria-label="cardPresentation(track).deleteLabel" @click.stop="confirmDeleteTrack(index)">
              <i-close size="14" />
            </div>
          </t-tooltip>
        </div>
        <div class="item addItem c" @click="addTrack">
          <i-plus size="36"></i-plus>
        </div>
      </div>
    </t-card>
    <t-dialog v-model:visible="archiveVisible" header="历史合并片段" :footer="false" width="760px">
      <div class="archiveList">
        <t-card v-for="archive in archivedSharedTracks" :key="archive.archiveId" size="small" :title="`原片段 T${archive.sourceTrackId} · ${archiveStoryboardLabels(archive.storyboardIds)}`">
          <p class="archiveMeta">归档于 {{ archiveTime(archive.archivedAt) }} · 引用版本 {{ archive.selectionRevision }} · 视频 {{ archive.videoCount }} 条</p>
          <pre class="archivePrompt">{{ archive.prompt || '原片段没有提示词' }}</pre>
          <div v-if="archive.videos?.length" class="archiveVideos">
            <div v-for="video in archive.videos" :key="video.id" class="archiveVideo">
              <video v-if="video.src" :src="video.src" controls preload="metadata" />
              <span>视频 {{ video.id }} · {{ video.state }}{{ video.errorReason ? ` · ${video.errorReason}` : '' }}</span>
            </div>
          </div>
        </t-card>
      </div>
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import type { Ref } from "vue";
import "@/views/production/components/workbench/type/type";
import axios from "@/utils/axios";
import projectStore from "@/stores/project";
import imageListCacheStore from "@/stores/imageListCache";
import JSZip from "jszip";
import settingStore from "@/stores/setting";
import { createGenerationIntentStore, shouldRetainGenerationIntent } from "@/utils/generationIntent";
import { createIdempotencyKey } from "@/utils/idempotency";
import { captureGenerateScope, positiveId, sameGenerateScope, validTrackIds, type PromptGenerationIntent } from "../utils/scope";
import { captureVideoGenerationSettings, purposeLabel, videoGenerationIntentPayload, videoModeLabel, type VideoReference } from "../utils/videoMode";
import {
  buildTrackCardPresentation,
  canGenerateStoryboardPrompt,
  freezeClearVideosMutation,
  freezeDeleteCardMutation,
  freezeReloadStoryboardMutation,
  sameCardMutationScope,
  singleFlight,
  type CardMutationScope,
  type FrozenCardMutation,
  type TrackCardPresentation,
} from "../utils/trackCards";

const { otherSetting } = storeToRefs(settingStore());
const generationIntents = createGenerationIntentStore();
const batchRequestIntents = createGenerationIntentStore<Array<{ videoId: number; trackId: number; jobId?: string; reused?: boolean; promptReview?: VideoPromptReview | null; modeResolution?: VideoModeResolutionView }>>();
const { project } = storeToRefs(projectStore());
const { removeCache, invalidateUrls } = imageListCacheStore();
const episodesId = inject<Ref<number>>("episodesId")!;
const refreshProductionFlow = inject<() => Promise<void>>("refreshProductionFlow", async () => undefined);
const props = defineProps<{
  modelParmas: ModelSetting;
  imageList: UploadItem[];
  storyboardList: Array<{ id: number; index: number; version?: number; trackId?: number | string | null; duration?: number | string | null }>;
  archivedSharedTracks: ArchivedSharedTrack[];
  listRefreshing: boolean;
  clampDuration: (trackDuration: number) => number;
  sourceDuration: (track: TrackItem | undefined) => number;
  resolveDuration: (trackDuration: number) => { requested: number; duration?: number; resolution: string };
  supportsResolution: (duration: number) => boolean;
  scopeReady: boolean;
  scopeSequence: number;
  promptGenerationGate: {
    begin: (ids: readonly number[], previousJobIds?: ReadonlyMap<number, string | null>) => boolean;
    markSubmitted: (id: number) => void;
    noteJob: (id: number, jobId: unknown) => void;
    isPending: (id: number) => boolean;
    getIntent: (id: number) => PromptGenerationIntent | undefined;
    setIntent: (id: number, intent: PromptGenerationIntent) => void;
    finish: (id: number, retainIntent?: boolean) => void;
  };
  preparePromptGeneration: (ids: readonly number[], scope: { projectId: number; scriptId: number; sequence: number }) => Promise<boolean>;
  prepareReferenceSelection: (ids: readonly number[], scope: { projectId: number; scriptId: number; sequence: number }) => Promise<boolean>;
  prepareTrackDraft: (track: TrackItem, scope: { projectId: number; scriptId: number; sequence: number }, action: string) => Promise<boolean>;
  beforeTrackChange: (previousIndex: number, nextIndex: number) => Promise<boolean>;
  referencesForTrack: (track: TrackItem, requireSrc?: boolean) => VideoReference[];
  reviewContextForGeneration: (track: TrackItem, input: { model: string; modeIntentRevision: number; references: VideoReference[]; generation: { duration: number; resolution: string; audio: boolean } }) => string;
}>();
const activeTrackIndex = defineModel("activeTrackIndex", {
  default: 0,
});
const checkedTrackIds = ref<number[]>([]); // 已勾选的轨道 id
const trackList = defineModel<TrackItem[]>({
  default: () => [],
});
const emit = defineEmits<{
  getData: [];
  change: [prevIndex: number];
  saveImageList: [trackId: number];
  refreshList: [];
}>();
const checkAll = ref(false); // 全选状态
const workspaceMutationIntents = new Map<string, { signature: string; key: string }>();
const createTrackIntent = ref<{ signature: string; key: string }>();
const archiveVisible = ref(false);
const reloadPreparingTrackIds = new Set<number>();
const disposed = ref(false);
const trackChangePending = ref(false);
let batchSequence = 0;
const hasPendingPrompt = computed(() => checkedTrackIds.value.some((id) => props.promptGenerationGate.isPending(id)));

function trackModeSummary(track: TrackItem): string {
  if (track.compatibility && !track.compatibility.ok) return track.compatibility.message ?? "当前模型与该片段的模式或素材不兼容";
  const summary = track.referenceSummary;
  if (!summary) return `模式：${videoModeLabel(track.resolvedMode ?? track.modeIntent ?? "auto")}`;
  const purposes = Object.entries(summary.purposes ?? {}).filter(([, count]) => count > 0)
    .map(([purpose, count]) => `${purposeLabel(purpose as any) || purpose}×${count}`).join("、");
  return `模式：${videoModeLabel(track.resolvedMode ?? track.modeIntent ?? "auto")}；参考 ${summary.total} 项${purposes ? `（${purposes}）` : ""}`;
}
function cardPresentation(track: TrackItem): TrackCardPresentation {
  return buildTrackCardPresentation(track, props.storyboardList);
}
function blockedGenerationTracks(ids: readonly number[]): TrackItem[] {
  return trackList.value.filter((track) => ids.includes(track.id) && (track.migrationRequired || Boolean(track.mutationBlockedReason)));
}
function warnBlockedGeneration(tracks: readonly TrackItem[]): boolean {
  if (!tracks.length) return false;
  window.$message.warning(tracks[0].mutationBlockedReason || "历史合并片段必须先拆分为一镜一片段，当前不能生成");
  return true;
}
function archiveStoryboardLabels(ids: number[]): string {
  const labels = ids.map((id) => props.storyboardList.find((item) => item.id === id)).filter(Boolean)
    .map((item) => `S${String(Number(item!.index) + 1).padStart(2, "0")}`);
  return labels.length ? labels.join("、") : `${ids.length}个分镜`;
}
function archiveTime(value: number): string {
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? "未知时间" : date.toLocaleString();
}

watch(
  () => props.scopeSequence,
  () => {
    batchSequence += 1;
    checkedTrackIds.value = [];
    checkAll.value = false;
  },
);

function retainMutationIntent(error: any): boolean {
  const status = Number(error?.status);
  return !Number.isSafeInteger(status) || status >= 500;
}

/** 视频封面缓存 src -> dataURL */
const videoCoverMap = ref<Record<string, string>>({});

/** 获取轨道选中视频的 src */
function getSelectedVideoSrc(track: TrackItem): string | null {
  if (!track.selectVideoId) return null;
  const video = track.videoList?.find((v) => v.id === track.selectVideoId);
  return video?.src || null;
}

/** 截取视频首帧封面 */
function captureVideoCover(src: string) {
  if (!src || videoCoverMap.value[src]) return;

  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.muted = true;
  video.src = src;
  video.addEventListener(
    "seeked",
    () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 160;
        canvas.height = video.videoHeight || 90;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          videoCoverMap.value[src] = canvas.toDataURL("image/jpeg", 0.7);
        }
      } catch {}
      video.src = "";
    },
    { once: true },
  );
  video.addEventListener(
    "loadeddata",
    () => {
      video.currentTime = 0;
    },
    { once: true },
  );
  video.addEventListener(
    "error",
    () => {
      video.src = "";
    },
    { once: true },
  );
  video.load();
}

async function changeIndex(index: number) {
  if (activeTrackIndex.value == index || trackChangePending.value) return;
  const prevIndex = activeTrackIndex.value;
  trackChangePending.value = true;
  const allowed = await props.beforeTrackChange(prevIndex, index);
  trackChangePending.value = false;
  if (!allowed || activeTrackIndex.value !== prevIndex) return;
  activeTrackIndex.value = index;
  emit("change", prevIndex);
}

function promptStateLabel(track: TrackItem): string {
  if (track.state === "生成中") return "生成中";
  if (track.state === "生成失败") return track.prompt?.trim() ? "本次失败 · 原文保留" : "生成失败";
  if (track.state === "已完成" || track.prompt?.trim()) return "已完成";
  return canGenerateStoryboardPrompt(track, props.storyboardList) ? "待生成" : "需手工填写";
}

function promptStateTheme(track: TrackItem): "default" | "primary" | "success" | "danger" {
  if (track.state === "生成中") return "primary";
  if (track.state === "生成失败") return "danger";
  if (track.state === "已完成" || track.prompt?.trim()) return "success";
  return "default";
}
function mutationIntent(action: string, trackId: number, payload: object) {
  const scope = `${action}:${trackId}`;
  const signature = JSON.stringify(payload);
  const existing = workspaceMutationIntents.get(scope);
  const intent = existing?.signature === signature ? existing : { signature, key: createIdempotencyKey(action) };
  workspaceMutationIntents.set(scope, intent);
  return { scope, intent };
}

function currentCardMutationScope(): CardMutationScope | undefined {
  return captureGenerateScope(project.value?.id, episodesId.value, props.scopeSequence);
}

async function refreshAfterMutation(scope: CardMutationScope) {
  if (!sameCardMutationScope(scope, currentCardMutationScope())) return;
  emit("getData");
  try { await refreshProductionFlow(); }
  catch { window.$message.warning("操作已成功，画布刷新失败，请点击页面刷新按钮"); }
}

function freezeDeleteTarget(scope: CardMutationScope, track: TrackItem, card: TrackCardPresentation): { scope: CardMutationScope; mutation: FrozenCardMutation; key: string; label: "删除分镜" | "删除片段"; title: string } | undefined {
  if (!card.deleteLabel || card.mutationBlockedReason) {
    window.$message.error(card.mutationBlockedReason ?? "当前片段不能删除");
    return undefined;
  }
  if (!Number.isSafeInteger(track.version) || track.version! < 0) {
    window.$message.error("轨道版本尚未加载，请刷新后重试");
    return undefined;
  }
  const mutation = freezeDeleteCardMutation({ scope, trackId: track.id, trackVersion: Number(track.version), card });
  if (!mutation) {
    window.$message.error(card.deleteLabel === "删除分镜" ? "分镜版本尚未加载，请刷新后重试" : "当前片段不能删除");
    return undefined;
  }
  const { intent } = mutationIntent(mutation.action, mutation.trackId, mutation.payload);
  return Object.freeze({ scope, mutation, key: intent.key, label: card.deleteLabel, title: card.title });
}

async function confirmDeleteTrack(index: number) {
  const scope = currentCardMutationScope();
  const track = trackList.value[index];
  if (!scope || !track) return;
  const card = cardPresentation(track);
  if (!(await props.prepareTrackDraft(track, scope, card.deleteLabel ?? "删除片段"))) return;
  if (!sameCardMutationScope(scope, currentCardMutationScope()) || !trackList.value.includes(track)) return window.$message.warning("片段列表或剧集已变化，本次删除已取消");
  const frozen = freezeDeleteTarget(scope, track, card);
  if (!frozen) return;
  const submit = singleFlight(async () => {
    if (!sameCardMutationScope(frozen.scope, currentCardMutationScope())) {
      window.$message.warning("剧集或项目已切换，本次删除已取消");
      return;
    }
    const intentScope = `${frozen.mutation.action}:${frozen.mutation.trackId}`;
    try {
      await axios.post(frozen.mutation.endpoint, { ...frozen.mutation.payload, idempotencyKey: frozen.key });
      workspaceMutationIntents.delete(intentScope);
      if (!sameCardMutationScope(frozen.scope, currentCardMutationScope())) return;
      checkedTrackIds.value = checkedTrackIds.value.filter((id) => id !== frozen.mutation.trackId);
      removeCache(frozen.scope.projectId, frozen.scope.scriptId, frozen.mutation.trackId);
      window.$message.success(`${frozen.label}成功`);
      await refreshAfterMutation(frozen.scope);
    } catch (error: any) {
      if (!retainMutationIntent(error)) workspaceMutationIntents.delete(intentScope);
      if (sameCardMutationScope(frozen.scope, currentCardMutationScope())) window.$message.error(error?.message ?? `${frozen.label}失败，原内容已保留`);
    }
  });
  const dialog = DialogPlugin.confirm({
    header: frozen.label,
    body: frozen.label === "删除分镜"
      ? `将同步从画布删除 ${frozen.title} 分镜及其视频生成记录；NAS 中已保存的媒体文件保留。`
      : "将删除这个自建片段及其视频生成记录；NAS 中已保存的媒体文件保留。",
    confirmBtn: frozen.label,
    cancelBtn: $t("settings.memory.msg.cancel"),
    onConfirm: async () => {
      try { await submit(); }
      finally { dialog.destroy(); }
    },
  });
}

function freezeClearTarget(scope: CardMutationScope, track: TrackItem): { scope: CardMutationScope; mutation: FrozenCardMutation; key: string } | undefined {
  if (track.migrationRequired || Number(track.storyboardCount ?? track.storyboardIds?.length ?? 0) > 1 || track.mutationBlockedReason) {
    window.$message.error(track.mutationBlockedReason ?? "该历史合并片段完成迁移前不能清空视频");
    return undefined;
  }
  if (!Number.isSafeInteger(track.version) || track.version! < 0) {
    window.$message.error("轨道版本尚未加载，请刷新后重试");
    return undefined;
  }
  const mutation = freezeClearVideosMutation({ scope, trackId: track.id, trackVersion: Number(track.version) });
  const { intent } = mutationIntent(mutation.action, mutation.trackId, mutation.payload);
  return Object.freeze({ scope, mutation, key: intent.key });
}

async function confirmClearTrackVideos(index: number) {
  const scope = currentCardMutationScope();
  const track = trackList.value[index];
  if (!scope || !track) return;
  if (!(await props.prepareTrackDraft(track, scope, "清空视频结果"))) return;
  if (!sameCardMutationScope(scope, currentCardMutationScope()) || !trackList.value.includes(track)) return window.$message.warning("片段列表或剧集已变化，本次清空已取消");
  const frozen = freezeClearTarget(scope, track);
  if (!frozen) return;
  const submit = singleFlight(async () => {
    if (!sameCardMutationScope(frozen.scope, currentCardMutationScope())) {
      window.$message.warning("剧集或项目已切换，本次清空已取消");
      return;
    }
    const intentScope = `${frozen.mutation.action}:${frozen.mutation.trackId}`;
    try {
      await axios.post(frozen.mutation.endpoint, { ...frozen.mutation.payload, idempotencyKey: frozen.key });
      workspaceMutationIntents.delete(intentScope);
      if (!sameCardMutationScope(frozen.scope, currentCardMutationScope())) return;
      window.$message.success("视频结果已清空");
      await refreshAfterMutation(frozen.scope);
    } catch (error: any) {
      if (!retainMutationIntent(error)) workspaceMutationIntents.delete(intentScope);
      if (sameCardMutationScope(frozen.scope, currentCardMutationScope())) window.$message.error(error?.message ?? "清空视频结果失败，原内容已保留");
    }
  });
  const dialog = DialogPlugin.confirm({
    header: "清空视频结果",
    body: "只清空该片段的视频选择与生成记录，保留分镜、分镜图片、提示词和参考素材；NAS 中已保存的媒体文件保留。",
    confirmBtn: "清空视频结果",
    cancelBtn: $t("settings.memory.msg.cancel"),
    onConfirm: async () => {
      try { await submit(); }
      finally { dialog.destroy(); }
    },
  });
}

async function confirmReloadTrack(index: number) {
  const scope = currentCardMutationScope();
  const track = trackList.value[index];
  if (!scope || !track || reloadPreparingTrackIds.has(track.id)) return;
  const card = cardPresentation(track);
  if (card.deleteLabel !== "删除分镜" || card.mutationBlockedReason || !card.storyboardId || !Number.isSafeInteger(card.storyboardVersion)) {
    window.$message.error(card.mutationBlockedReason ?? "当前卡片不是可重新载入的单镜片段");
    return;
  }
  reloadPreparingTrackIds.add(track.id);
  try {
    if (!(await props.prepareTrackDraft(track, scope, "重新载入分镜参考"))) return;
    if (!sameCardMutationScope(scope, currentCardMutationScope()) || !trackList.value.includes(track)) {
      window.$message.warning("片段列表或剧集已变化，本次重新载入已取消");
      return;
    }
    if (!Number.isSafeInteger(track.version) || !Number.isSafeInteger(track.modeIntentRevision)) {
      window.$message.error("片段选择版本尚未加载，请刷新后重试");
      return;
    }
    const mutation = freezeReloadStoryboardMutation({
      scope,
      trackId: track.id,
      trackVersion: Number(track.version),
      storyboardId: card.storyboardId,
      storyboardVersion: card.storyboardVersion!,
      modeIntentRevision: Number(track.modeIntentRevision),
    });
    const { intent } = mutationIntent(mutation.action, mutation.trackId, mutation.payload);
    const frozen = Object.freeze({ scope, mutation, key: intent.key, title: card.title });
    const submit = singleFlight(async () => {
      if (!sameCardMutationScope(frozen.scope, currentCardMutationScope())) {
        window.$message.warning("剧集或项目已切换，本次重新载入已取消");
        return;
      }
      const intentScope = `${frozen.mutation.action}:${frozen.mutation.trackId}`;
      try {
        const raw: any = await axios.post(frozen.mutation.endpoint, { ...frozen.mutation.payload, idempotencyKey: frozen.key });
        workspaceMutationIntents.delete(intentScope);
        if (!sameCardMutationScope(frozen.scope, currentCardMutationScope())) return;
        const response = raw?.data ?? raw;
        const refreshedReferences = Array.isArray(response?.references) ? response.references : [];
        invalidateUrls([
          { id: Number(frozen.mutation.payload.storyboardId), sources: "storyboard" },
          ...refreshedReferences.map((reference: any) => ({ id: reference.id, sources: reference.sources })),
        ]);
        removeCache(frozen.scope.projectId, frozen.scope.scriptId, frozen.mutation.trackId);
        window.$message.success(`${frozen.title} 已从当前画布重新载入参考素材`);
        await refreshAfterMutation(frozen.scope);
      } catch (error: any) {
        if (!retainMutationIntent(error)) workspaceMutationIntents.delete(intentScope);
        if (sameCardMutationScope(frozen.scope, currentCardMutationScope())) window.$message.error(error?.message ?? "重新载入失败，原参考素材与提示词已保留");
      }
    });
    const dialog = DialogPlugin.confirm({
      header: `重新载入 ${frozen.title}`,
      body: "将从当前画布重新读取该分镜图片及其关联角色、场景、道具和音色，替换手选参考素材；人工提示词、视频选择和历史视频均保留，提示词会标记为需要核对。",
      confirmBtn: "重新载入",
      cancelBtn: $t("settings.memory.msg.cancel"),
      onConfirm: async () => {
        try { await submit(); }
        finally { dialog.destroy(); }
      },
    });
  } finally { reloadPreparingTrackIds.delete(track.id); }
}
async function addTrack() {
  const { data: modelData } = await axios.post("/modelSelect/getModelDetail", { modelId: props.modelParmas.model });
  const drMap = modelData.durationResolutionMap;
  if (!Array.isArray(drMap) || drMap.length === 0 || !drMap[0].duration?.length) return;
  const duration = drMap[0].duration[0];
  const payload = { projectId: project.value?.id, scriptId: episodesId.value ?? 0, duration };
  const signature = JSON.stringify(payload);
  if (createTrackIntent.value?.signature !== signature) createTrackIntent.value = { signature, key: createIdempotencyKey("track-create") };
  try {
    await axios.post("/production/workbench/addTrack", { ...payload, idempotencyKey: createTrackIntent.value.key });
    createTrackIntent.value = undefined;
  } catch (error: any) {
    if (!retainMutationIntent(error)) createTrackIntent.value = undefined;
    window.$message.error(error?.message ?? "轨道创建失败");
    return;
  }
  // await getGenerateData();
  emit("getData");
  activeTrackIndex.value = trackList.value.length - 1;
}
/** 获取 URL 中的文件扩展名 */
function getFileExtension(url: string): string {
  const ext = url.split(".").pop()?.split(/[#?]/)[0];
  return ext || "mp4";
}
/** 批量下载已勾选轨道的选中视频，打包为 zip */
async function batchDownloadVideo(): Promise<void> {
  const zip = new JSZip();
  const selectedTracks = trackList.value.filter((track) => checkedTrackIds.value.includes(track.id));
  const tasks = selectedTracks
    .map((track) => {
      const video = track.videoList.find((v) => v.id === track.selectVideoId);
      if (!video?.src) return null;
      const filename = `分镜${track.id}.${getFileExtension(video.src)}`;
      return fetch(video.src)
        .then((res) => res.blob())
        .then((blob) => zip.file(filename, blob))
        .catch((err) => console.error(`视频下载失败: ${video.src}`, err));
    })
    .filter(Boolean);
  await Promise.all(tasks);
  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `视频批量下载_${Date.now()}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  checkedTrackIds.value = [];
  checkAll.value = false;
}
const generateTextLoad = ref(false);
async function batchGenText() {
  const scope = captureGenerateScope(project.value?.id, episodesId.value, props.scopeSequence);
  if (generateTextLoad.value || !props.scopeReady || !scope || disposed.value) return;
  const requestSequence = ++batchSequence;
  const trackData: any[] = [];
  const requestedIds = validTrackIds(checkedTrackIds.value, trackList.value);
  const skipped = trackList.value.filter(track => requestedIds.includes(track.id) && !canGenerateStoryboardPrompt(track, props.storyboardList));
  const selectedIds = requestedIds.filter(id => !skipped.some(track => track.id === id));
  if (skipped.length) window.$message.warning(`已跳过 ${skipped.length} 个没有独立源分镜的片段：${skipped.map(track => cardPresentation(track).title).join("、")}。可手动填写提示词。`);
  if (warnBlockedGeneration(blockedGenerationTracks(selectedIds))) return;
  const generationSnapshot = captureVideoGenerationSettings(props.modelParmas);
  const durationByTrack = new Map(trackList.value.filter((track) => selectedIds.includes(positiveId(track.id) ?? -1)).map((track) => {
    const sourceDuration = props.sourceDuration(track);
    return [track.id, props.resolveDuration(sourceDuration).duration ?? sourceDuration] as const;
  }));
  checkedTrackIds.value = selectedIds;
  if (!selectedIds.length) {
    generateTextLoad.value = false;
    return;
  }
  const previousJobIds = new Map(selectedIds.map((id) => [id, trackList.value.find((track) => positiveId(track.id) === id)?.promptJobId ?? null]));
  if (!props.promptGenerationGate.begin(selectedIds, previousJobIds)) return;
  generateTextLoad.value = true;
  const prepared = await props.preparePromptGeneration(selectedIds, scope);
  if (!sameGenerateScope(scope, project.value?.id, episodesId.value, props.scopeSequence, disposed.value)) return;
  if (!prepared) {
    selectedIds.forEach((id) => props.promptGenerationGate.finish(id));
    if (!disposed.value && requestSequence === batchSequence) generateTextLoad.value = false;
    return;
  }
  trackList.value.forEach((track) => {
    const trackId = positiveId(track.id);
    if (trackId == null || !selectedIds.includes(trackId)) return;
    const references = props.referencesForTrack(track);
    trackData.push({
      trackId,
      expectedVersion: track.version,
      references,
      modeIntentRevision: track.modeIntentRevision ?? 0,
      idempotencyKey: "pending",
      generation: {duration: durationByTrack.get(track.id) ?? props.sourceDuration(track), resolution: generationSnapshot.resolution, audio: generationSnapshot.audio},
    });
    track.promptGenerationContext = {
      trackId,
      model: generationSnapshot.model,
      modeIntentRevision: track.modeIntentRevision ?? 0,
      resolvedMode: track.resolvedMode,
      generation: { duration: durationByTrack.get(track.id) ?? props.sourceDuration(track), resolution: generationSnapshot.resolution, audio: generationSnapshot.audio },
      references,
    };
    track.state = "生成中";
  });
  trackData.forEach((item) => {
    const track = trackList.value.find((candidate) => positiveId(candidate.id) === item.trackId);
    const signature = JSON.stringify({ projectId: scope.projectId, scriptId: scope.scriptId, model: generationSnapshot.model, trackId: item.trackId, references: item.references, modeIntentRevision: item.modeIntentRevision, generation: item.generation, expectedVersion: track?.version });
    const previous = props.promptGenerationGate.getIntent(item.trackId);
    const intent = previous?.signature === signature ? previous : { signature, key: createIdempotencyKey("batch-video-prompt"), startedAt: Date.now() };
    props.promptGenerationGate.setIntent(item.trackId, intent);
    item.idempotencyKey = intent.key;
  });
  try {
    if (!sameGenerateScope(scope, project.value?.id, episodesId.value, props.scopeSequence, disposed.value)) return;
    selectedIds.forEach((id) => props.promptGenerationGate.markSubmitted(id));
    const { data } = await axios.post("/production/workbench/batchGeneratePrompt", {
      projectId: scope.projectId,
      scriptId: scope.scriptId,
      trackData,
      model: generationSnapshot.model,
      concurrentCount: otherSetting.value.assetsBatchGenereateSize,
    });
    if (!sameGenerateScope(scope, project.value?.id, episodesId.value, props.scopeSequence, disposed.value)) return;
    if (Array.isArray(data)) {
      data.forEach((item: { trackId: number; jobId?: string | null; state?: string; reason?: string | null; modeResolution?: VideoModeResolutionView }) => {
        const track = trackList.value.find((candidate) => positiveId(candidate.id) === item.trackId);
        if (!track) return;
        const trackId = positiveId(track.id);
        if (trackId == null) return;
        const intent = props.promptGenerationGate.getIntent(trackId);
        props.promptGenerationGate.noteJob(trackId, item.jobId);
        if (intent) intent.jobId = item.jobId ?? undefined;
        track.promptJobId = item.jobId ?? null;
        if (item.modeResolution) {
          track.modeResolution = item.modeResolution;
          track.modeIntent = item.modeResolution.modeIntent;
          track.modeIntentRevision = item.modeResolution.modeIntentRevision;
          track.resolvedMode = item.modeResolution.resolvedMode ?? undefined;
          track.resolvedReferences = item.modeResolution.resolvedReferences;
          track.referenceSummary = item.modeResolution.referenceSummary ?? undefined;
          track.compatibility = item.modeResolution.compatibility;
        }
        if (item.state === "failed") {
          track.state = "生成失败";
          track.reason = item.reason ?? "提示词任务预校验失败";
          props.promptGenerationGate.finish(trackId);
          track.promptGenerationContext = undefined;
        }
      });
    }
    const failures = Array.isArray(data) ? data.filter((item:any) => item.state === "failed") : [];
    if (failures.length) window.$message.error(failures.map((item:any) => {
      const track = trackList.value.find(track => track.id === item.trackId);
      return `${track ? cardPresentation(track).title : `片段 T${item.trackId}`}：${item.reason ?? "预校验失败"}`;
    }).join("；"));
    if (!Array.isArray(data) || data.length > failures.length) window.$message.success("已提交可执行片段的提示词生成任务");
    checkedTrackIds.value = [];
    checkAll.value = false;
  } catch (e: any) {
    if (sameGenerateScope(scope, project.value?.id, episodesId.value, props.scopeSequence, disposed.value)) {
      window.$message.error(e?.message ?? "生成提示词失败");
      trackList.value.filter((track) => selectedIds.includes(positiveId(track.id) ?? -1)).forEach((track) => {
        track.state = "生成失败";
        track.reason = e?.message ?? "批量请求失败";
        track.promptGenerationContext = undefined;
      });
      const status = Number(e?.status ?? e?.response?.status);
      selectedIds.forEach((id) => props.promptGenerationGate.finish(id, !(Number.isSafeInteger(status) && status < 500)));
    }
  } finally {
    if (!disposed.value && requestSequence === batchSequence) generateTextLoad.value = false;
  }
}
const generateVideoLoad = ref(false);
/** 批量为已勾选轨道生成视频 */
function batchGenVideo() {
  if (generateVideoLoad.value || !props.scopeReady || disposed.value) return;
  const dlg = DialogPlugin.confirm({
    header: $t("workbench.generate.generateConfirm"),
    body: $t("workbench.generate.generateVideosInBatches"),
    onConfirm: async () => {
      dlg.destroy();
      const scope = captureGenerateScope(project.value?.id, episodesId.value, props.scopeSequence);
      if (!scope || !props.scopeReady || disposed.value) return;

      const selectedIds = validTrackIds(checkedTrackIds.value, trackList.value);
      if (warnBlockedGeneration(blockedGenerationTracks(selectedIds))) return;
      checkedTrackIds.value = selectedIds;
      const checkedTrackData = trackList.value.filter((track) => selectedIds.includes(positiveId(track.id) ?? -1));
      const notHasPrompt = checkedTrackData.filter((i) => !i.prompt);
      if (notHasPrompt.length) return window.$message.warning($t("workbench.generate.skipDataWithEmptyVideoPromptWords"));
      const generationSnapshot = captureVideoGenerationSettings(props.modelParmas);
      const durationPlans = new Map(checkedTrackData.map((track) => {
        const sourceDuration = props.sourceDuration(track);
        return [track.id, {
          sourceDuration,
          durationChoice: props.resolveDuration(sourceDuration),
          resolutionSupported: props.supportsResolution(sourceDuration),
        }] as const;
      }));
      generateVideoLoad.value = true;
      const referencesPrepared = await props.prepareReferenceSelection(selectedIds, scope);
      if (!referencesPrepared || !sameGenerateScope(scope, project.value?.id, episodesId.value, props.scopeSequence, disposed.value)) {
        generateVideoLoad.value = false;
        return;
      }

      const unsupportedTracks: number[] = [];
      const unsupportedQualityTracks: number[] = [];
      const trackData = checkedTrackData.map((track) => {
        const trackId = track.id;
        const references = props.referencesForTrack(track);
        const { sourceDuration, durationChoice, resolutionSupported } = durationPlans.get(track.id)!;
        if (durationChoice.duration == null) unsupportedTracks.push(trackId);
        else if (!resolutionSupported) unsupportedQualityTracks.push(trackId);
        const trackRequest = {
          duration: durationChoice.duration ?? sourceDuration,
          prompt: track.prompt,
          references,
          modeIntentRevision: track.modeIntentRevision ?? 0,
          trackId,
        };
        const intentScope = `batch-track:${scope.projectId}:${scope.scriptId}:${String(trackId)}`;
        const intent = generationIntents.getOrCreate(intentScope, videoGenerationIntentPayload({
          ...trackRequest,
          model: generationSnapshot.model,
          resolution: generationSnapshot.resolution,
          audio: generationSnapshot.audio,
        }));
        return {
          ...trackRequest,
          idempotencyKey: intent.key,
        };
      });
      if (unsupportedTracks.length) {
        window.$message.warning(`片段 ${unsupportedTracks.map((id) => trackList.value.findIndex((track) => track.id === id) + 1).join("、")} 的脚本时长超出模型上限，请拆分分镜或选择支持更长时长的模型`);
        generateVideoLoad.value = false;
        return;
      }
      if (unsupportedQualityTracks.length) {
        window.$message.warning(`片段 ${unsupportedQualityTracks.map((id) => trackList.value.findIndex((track) => track.id === id) + 1).join("、")} 的脚本时长不支持当前清晰度，请从顶部下拉重新选择`);
        generateVideoLoad.value = false;
        return;
      }
      const requestData = {
        projectId: scope.projectId,
        scriptId: scope.scriptId,
        model: generationSnapshot.model,
        resolution: generationSnapshot.resolution,
        audio: generationSnapshot.audio,
        trackData,
      };
      const batchScope = `batch-request:${scope.projectId}:${scope.scriptId}:${checkedTrackData
        .map((track) => track.id)
        .sort((a, b) => a - b)
        .join(",")}`;
      try {
        const data = await batchRequestIntents.run(batchScope, requestData, async () => {
          const response = await axios.post("/production/workbench/batchGenerateVideo", requestData);
          return response.data;
        });
        if (!sameGenerateScope(scope, project.value?.id, episodesId.value, props.scopeSequence, disposed.value)) return;
        checkedTrackData.forEach((track) => {
          const trackId = positiveId(track.id);
          if (trackId == null) return;
          const intentScope = `batch-track:${scope.projectId}:${scope.scriptId}:${String(trackId)}`;
          const payload = trackData.find((item) => item.trackId === track.id);
          if (payload) generationIntents.markSuccess(intentScope, payload.idempotencyKey);
        });
        const videoRecordId: Record<number, number> = {};
        data.forEach((item: { videoId: number; trackId: number; promptReview?: VideoPromptReview | null; modeResolution?: VideoModeResolutionView }) => {
          videoRecordId[item.trackId] = item.videoId;
          const track = checkedTrackData.find((candidate) => candidate.id === item.trackId);
          const payload = trackData.find((candidate) => candidate.trackId === item.trackId);
          if (track && payload) {
            if (item.modeResolution) {
              track.modeResolution = item.modeResolution;
              track.modeIntent = item.modeResolution.modeIntent;
              track.modeIntentRevision = item.modeResolution.modeIntentRevision;
              track.resolvedMode = item.modeResolution.resolvedMode ?? undefined;
              track.resolvedReferences = item.modeResolution.resolvedReferences;
              track.referenceSummary = item.modeResolution.referenceSummary ?? undefined;
              track.compatibility = item.modeResolution.compatibility;
            }
            track.promptReview = item.promptReview ?? null;
            track.promptReviewPrompt = track.prompt;
            track.promptReviewContext = props.reviewContextForGeneration(track, {
              model: generationSnapshot.model,
              modeIntentRevision: payload.modeIntentRevision,
              references: payload.references,
              generation: { duration: payload.duration, resolution: generationSnapshot.resolution, audio: generationSnapshot.audio },
            });
          }
        });
        checkedTrackData.forEach((i) => {
          if (videoRecordId[i.id])
            i.videoList.push({
              id: videoRecordId[i.id],
              state: "生成中",
              src: "",
            });
        });
        checkedTrackIds.value = [];
        window.$message.success($t("workbench.generate.generateStarted"));
      } catch (e) {
        if (!shouldRetainGenerationIntent(e)) {
          checkedTrackData.forEach((track) => {
            const scope = `batch-track:${String(project.value?.id ?? "")}:${String(episodesId.value ?? "")}:${String(track.id)}`;
            const payload = trackData.find((item) => item.trackId === track.id);
            if (payload) generationIntents.clear(scope, payload.idempotencyKey);
          });
        }
        window.$message.error((e as any)?.message ?? $t("workbench.generate.generateError"));
      } finally {
        generateVideoLoad.value = false;
      }
    },
    onCancel: () => dlg.destroy(),
  });
}

/** 全选 / 取消全选轨道 */
function handleCheckAll(val: boolean) {
  const allIds = trackList.value.map((t) => positiveId(t.id)).filter((id): id is number => id != null);
  checkedTrackIds.value = val ? allIds : [];
}

/** 单个勾选轨道 */
function toggleCheck(trackId: number | undefined, val: boolean) {
  if (trackId == null) return;
  if (val) {
    if (!checkedTrackIds.value.includes(trackId)) checkedTrackIds.value.push(trackId);
  } else {
    checkedTrackIds.value = checkedTrackIds.value.filter((id) => id !== trackId);
  }
  const allIds = trackList.value.map((t) => positiveId(t.id)).filter((id): id is number => id != null);
  checkAll.value = allIds.length > 0 && allIds.every((id) => checkedTrackIds.value.includes(id));
}

// 轨道列表变化时，截取选中视频首帧（只监听 selectVideoId 和 videoList 变化，避免深度监听整个 trackList）
watch(
  () => trackList.value.map((track) => track.id),
  (ids) => {
    const available = new Set(ids.map(positiveId).filter((id): id is number => id != null));
    checkedTrackIds.value = checkedTrackIds.value.filter((id) => available.has(id));
    checkAll.value = available.size > 0 && [...available].every((id) => checkedTrackIds.value.includes(id));
  },
  { immediate: true },
);
watch(
  () => trackList.value.map((t) => ({ selectVideoId: t.selectVideoId, videoList: t.videoList })),
  () => {
    trackList.value.forEach((track) => {
      const src = getSelectedVideoSrc(track);
      if (src) captureVideoCover(src);
    });
  },
  { deep: true, immediate: true },
);
onUnmounted(() => {
  disposed.value = true;
});
</script>

<style lang="scss" scoped>
.videoTrack {
  width: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  .trackMenu {
    margin-bottom: 10px;
    .selectedCount {
      font-size: 12px;
      color: var(--td-text-color-secondary);
      margin-left: 8px;
    }
    .right {
      gap: 8px;
    }
  }
  .itemBox {
    height: 150px;
    flex: 1;
    min-height: 0;
    width: 100%;
    display: flex;
    overflow-x: auto;
    gap: 10px;
    padding-bottom: 6px;
    &::-webkit-scrollbar {
      height: 6px;
    }
    &::-webkit-scrollbar-thumb {
      background: #696969;
      border-radius: 3px;
    }
    .item {
      border-radius: 8px;
      flex-shrink: 0;
      width: 200px;
      border: 1px solid var(--td-gray-color-3);
      overflow: hidden;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      &.active {
        border-color: var(--td-brand-color);
        border-width: 2px;
        box-shadow: 0 0 0 3px rgba(var(--td-brand-color-rgb, 0, 82, 217), 0.25);
        background: linear-gradient(180deg, rgba(var(--td-brand-color-rgb, 0, 82, 217), 0.05) 0%, transparent 100%);
      }
      &:hover {
        filter: brightness(90%);
      }
      .indexTag {
        position: absolute;
        bottom: 4px;
        left: 4px;
        z-index: 2;
      }
      .kindTag {
        position: absolute;
        bottom: 30px;
        left: 4px;
        z-index: 2;
      }
      .selectTag {
        position: absolute;
        bottom: 4px;
        right: 4px;
        z-index: 1;
      }
      .promptStateTag {
        position: absolute;
        top: 4px;
        left: 28px;
        z-index: 2;
        pointer-events: none;
      }
      .modeTag {
        position: absolute;
        top: 32px;
        left: 4px;
        z-index: 2;
        pointer-events: none;
        max-width: 188px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .promptFailureMark {
        position: absolute;
        top: 6px;
        right: 6px;
        z-index: 2;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--td-error-color-6);
        color: #fff;
        font-size: 12px;
        line-height: 16px;
        text-align: center;
      }
      .thumbGroup {
        width: 100%;
        height: 100%;
        display: flex;
        .thumb {
          flex: 1;
          min-width: 0;
          height: 100%;
          object-fit: cover;
        }
        .placeholder {
          background: var(--td-bg-color-secondarycontainer);
          color: var(--td-text-color-placeholder);
          font-size: 12px;
        }
      }
      .emptyTrack {
        color: var(--td-text-color-placeholder);
        font-size: 12px;
      }
      .trackCheck {
        position: absolute;
        top: 4px;
        left: 4px;
        z-index: 2;
      }
      .deleteBtn {
        position: absolute;
        top: 4px;
        right: 4px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.5);
        color: #fff;
        display: none;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 1;
        &:hover {
          background: rgba(0, 0, 0, 0.8);
        }
      }
      .mutationBlocked {
        position: absolute;
        top: 32px;
        right: 6px;
        z-index: 3;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: var(--td-warning-color-6);
        color: #fff;
        line-height: 18px;
        text-align: center;
      }
      .clearVideosBtn {
        position: absolute;
        right: 4px;
        bottom: 32px;
        z-index: 3;
        background: rgba(255, 255, 255, 0.88);
      }
      .reloadTrackBtn {
        position: absolute;
        right: 4px;
        bottom: 60px;
        z-index: 3;
        background: rgba(255, 255, 255, 0.88);
      }
      &:hover .deleteBtn {
        display: flex;
      }
    }
    .addItem {
      border: 4px dashed var(--td-component-border);
      cursor: pointer;
    }
    .selectedVideoThumb {
      width: 100%;
      height: 100%;
      object-fit: cover;
      pointer-events: none;
      user-select: none;
      display: block;
    }
  }
  .archiveList {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-height: 68vh;
    overflow-y: auto;
  }
  .archiveMeta {
    color: var(--td-text-color-secondary);
    font-size: 12px;
  }
  .archivePrompt {
    white-space: pre-wrap;
    max-height: 180px;
    overflow: auto;
    padding: 10px;
    border-radius: 6px;
    background: var(--td-bg-color-secondarycontainer);
  }
  .archiveVideos {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 10px;
  }
  .archiveVideo {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    video { width: 100%; max-height: 180px; background: #000; }
  }
}
</style>
