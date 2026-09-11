<template>
  <div class="index fc">
    <div v-if="!scopeReady || loadError" role="status" class="scopeNotice">
      {{ loadError || (currentScope ? "正在加载当前剧集的片段…" : "请先选择剧集") }}
      <t-button v-if="loadError" size="small" variant="text" @click="getGenerateData">重新加载</t-button>
    </div>
    <div class="referenceImage">
      <div class="uploadBtn">
        <imageSelect :mode="currentModeIntent" v-model="imageList" :storyboard-list="storyboardList" />
        <t-button v-if="modelParmas.model.startsWith('volcengineSd2:')" size="small" variant="outline" :disabled="!scopeReady || !trustedLocalTargets.length" @click="trustedAssetsVisible = true">火山素材库</t-button>
      </div>
    </div>
    <div class="modelSelect">
      <modeMenu
        v-model="modelParmas"
        :modeOptions="modeOptions"
        :trackId="currentTrack?.id"
        :trackVersion="currentTrack?.version"
        :trackIndex="activeTrackIndex"
        :trackScriptDuration="currentTrackSourceDuration"
        :durationNotice="currentDurationNotice"
        :projectId="project?.id"
        :scriptId="episodesId"
        :modeList="modeList"
        :modeIntent="currentModeIntent"
        :modeSaving="modeSaving"
        :resolving="modeResolving"
        :resolvedMode="currentTrack?.resolvedMode"
        :referenceSummary="currentTrack?.referenceSummary"
        :compatibility="currentTrack?.compatibility"
        @modeChange="modeChange"
        @durationUpdated="handleDurationUpdated" />
    </div>
    <div class="generate ac">
      <div class="prompt" v-if="currentTrack">
        <t-card :title="'#' + (activeTrackIndex + 1) + $t('workbench.generate.generateText')" header-bordered class="videoPrompt">
          <template #actions>
            <t-button size="small" class="genTextbtn" :disabled="!scopeReady || currentPromptPending || currentTrack.state == '生成中'" :loading="currentPromptPending || currentTrack.state == '生成中'" @click="genText">
              {{ $t("workbench.generate.generateText") }}
            </t-button>
          </template>
          <div class="promptData fc">
            <div class="promptInput" @focusout="handlePromptBlur">
              <promptEditor v-model="currentTrack.prompt" :references="references" :placeholder="$t('workbench.generate.promptPlaceholder')" />
            </div>
            <t-alert v-if="currentTrack.referencesNeedReview" theme="warning" title="参考素材已变化，已保留人工提示词，请在生成前核对素材编号与正文。" />
            <details v-if="currentTrack.promptReview && currentTrack.prompt === currentTrack.promptReviewPrompt && currentTrack.promptReviewContext === reviewContextSignature(currentTrack)" class="promptReview">
              <summary>{{ currentTrack.promptReview.status === 'passed' ? '提示词核验完成' : currentTrack.promptReview.status === 'failed' ? '提示词核验未完成' : '提示词核验提示' }}{{ currentTrack.promptReview.revised ? ' · 已作最小修正' : '' }}</summary>
              <p>{{ currentTrack.promptReview.summary }}</p>
              <ul><li v-for="(finding,index) in currentTrack.promptReview.findings" :key="index">{{ finding.message }}</li></ul>
            </details>
          </div>
        </t-card>
      </div>
      <div class="video">
        <videoCard
          v-if="currentTrack"
          :active-track-index="activeTrackIndex"
          v-model:current-track="currentTrack"
          :generating="generateVideoPending"
          @refresh="getGenerateData"
          @generate="generateVideo" />
      </div>
    </div>
    <VolcengineTrustedAssets v-model="trustedAssetsVisible" :project-id="project?.id" :script-id="episodesId" :targets="trustedLocalTargets" />
    <div class="track">
      <newTrack
        v-model:activeTrackIndex="activeTrackIndex"
        v-model="trackList"
        :image-list="imageList"
        @change="trackChange"
        :modelParmas="modelParmas"
        :storyboard-list="storyboardList"
        :clampDuration="clampDuration"
        :sourceDuration="sourceDurationForTrack"
        :resolveDuration="resolveDuration"
        :supportsResolution="supportsResolution"
        :scope-ready="scopeReady"
        :scope-sequence="scopeSequence"
        :prompt-generation-gate="promptGenerationGate"
        :prepare-prompt-generation="preparePromptGeneration"
        :prepare-reference-selection="prepareReferenceSelection"
        :references-for-track="referencesForTrack"
        :review-context-for-generation="reviewContextForGeneration"
        @getData="getGenerateData" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Ref } from "vue";
import newTrack from "./components/track.vue";
import imageSelect from "./components/imageSelect.vue";
import VolcengineTrustedAssets from "@/components/volcengineTrustedAssets.vue";
import type { TrustedLocalTarget } from "@/components/trustedAssets/controller";
import modeMenu from "./components/modeMenu.vue";
import videoCard from "./components/video.vue";
import "@/views/production/components/workbench/type/type";
import axios from "@/utils/axios";
import { resolveVideoDuration, storyboardTrackDuration, videoResolutions, type VideoDurationChoice } from "@/utils/mediaQuality";
import projectStore from "@/stores/project";
import userStore from "@/stores/user";
import { useLocalStorage } from "@vueuse/core";
import promptEditor from "@/components/promptEditor.vue";
import imageListCacheStore from "@/stores/imageListCache";
import { createGenerationIntentStore } from "@/utils/generationIntent";
import { createIdempotencyKey } from "@/utils/idempotency";
import { captureGenerateScope, positiveId, sameGenerateScope, type GenerateScope, type PromptGenerationIntent } from "./utils/scope";
import {
  buildVideoReferences,
  captureVideoGenerationSettings,
  modeIntentForTrack,
  modeIntentSelectValue,
  parseModeIntentValue,
  referenceSignature,
  referencesNeedReview as shouldReviewReferences,
  initialReferenceSelection,
  restoreReferenceSelection,
  videoModeLabel,
  type VideoModeIntent,
  type VideoReference,
} from "./utils/videoMode";

const { project } = storeToRefs(projectStore());
const episodesId = inject<Ref<number>>("episodesId")!;
const activeTrackIndex = ref(0);
const cacheStore = imageListCacheStore();
const generationIntents = createGenerationIntentStore<{ videoId: number; promptReview?: VideoPromptReview | null; modeResolution?: VideoModeResolutionView }>();
const generateVideoPending = ref(false);
const promptMutationIntents = new Map<number, { signature: string; key: string }>();
const promptSavePromises = new Map<number, { signature: string; promise: Promise<boolean> }>();
const promptGenerationIntents = new Map<number, PromptGenerationIntent>();
const promptPending = reactive(new Map<number, { previousJobId?: string; jobId?: string; submitted: boolean }>());
const persistedTrackPrompts = new Map<number, string>();
const promptConflictVersions = new Map<number, number>();
const modeMutationIntents = new Map<number, { signature: string; key: string }>();
const referenceMutationIntents = new Map<number, { signature: string; key: string }>();
const referenceSavePromises = new Map<number, { signature: string; promise: Promise<boolean> }>();
const persistedReferenceSignatures = new Map<number, string>();
const selectionMutationQueues = new Map<number, Promise<unknown>>();
const modeSaving = ref(false);
const modeResolving = ref(false);
let modeResolveSequence = 0;
const durationOverrides = useLocalStorage<Record<string, number>>(`toonflow:video-duration-overrides:${userStore().user?.id}:${project.value?.id}:${episodesId.value}`, {});
const { getCache, setCache, removeCache, initCacheFromTrackList, warmUpUrls, hasUserSelection } = cacheStore;
const { urlMap } = storeToRefs(cacheStore);

const modeOptions = ref<VideoModel>({
  name: "",
  modelName: "",
  durationResolutionMap: [],
  audio: false,
  type: "video",
  mode: [],
}); // 当前模型配置

const trackList = ref<TrackItem[]>([]); // 轨道列表
const scopeSequence = ref(0);
const disposed = ref(false);
const loadedScope = ref<GenerateScope>();
const loadError = ref("");
let loadSequence = 0;
const currentScope = computed(() => captureGenerateScope(project.value?.id, episodesId.value, scopeSequence.value));
const scopeReady = computed(() => {
  const current = currentScope.value;
  const loaded = loadedScope.value;
  return current != null && loaded != null && current.sequence === loaded.sequence && current.projectId === loaded.projectId && current.scriptId === loaded.scriptId;
});

const modelParmas = useLocalStorage<ModelSetting>(`toonflow:video-settings:${userStore().user?.id}:${project.value?.id}:${episodesId.value}`, {
  mode: "",
  model: "",
  resolution: "480p",
  duration: 8,
  audio: false,
});

const storyboardList = ref<StoryboardItem[]>([]); // 分镜列表

const imageList = computed({
  get(): UploadItem[] {
    // 触发对 urlMap 的依赖追踪，当 warmUpUrls 更新 urlMap 后自动重新计算
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    urlMap.value;
    const trackId = currentTrack.value?.id;
    const pid = project.value?.id;
    const sid = episodesId.value;
    // 优先从缓存读取
    if (pid != null && sid != null && trackId != null) {
      const cached = getCache(pid, sid, trackId);

      if (cached?.length) return orderReferenceItems(cached);
    }
    const medias = currentTrack.value?.medias;
    if (!medias?.length) return [];
    return orderReferenceItems(medias as UploadItem[]);
  },
  set(val: UploadItem[]) {
    if (currentTrack.value) {
      const track = currentTrack.value;
      const before = referenceSignature(buildVideoReferences(track.medias as UploadItem[], modeIntentFor(track)));
      const after = referenceSignature(buildVideoReferences(val, modeIntentFor(track)));
      if (before !== after && track.prompt) track.referencesNeedReview = true;
      currentTrack.value.medias = val as any;
      // 同步写入缓存
      const pid = project.value?.id;
      const sid = episodesId.value;
      const trackId = currentTrack.value.id;
      if (pid != null && sid != null && trackId != null) {
        setCache(pid, sid, trackId, val, { userEdited: true });
      }
      const scope = currentScope.value;
      if (scope) void saveTrackReferences(track, scope);
    }
  },
});

const trustedAssetsVisible = ref(false);
const trustedLocalTargets = computed<TrustedLocalTarget[]>(() => {
  if (!scopeReady.value) return [];
  const selected: TrustedLocalTarget[] = imageList.value.filter(item => positiveId(item.id) && item.src && ['assets','storyboard'].includes(item.sources)).map(item => ({
    targetKind: item.sources === 'storyboard' ? 'storyboard' : 'asset', targetId: Number(item.id),
    name: item.sources === 'storyboard' ? `分镜 P${item.index + 1}` : (item.prompt?.slice(0, 45) || `已选素材 ${item.id}`), src: item.src, mediaType: item.fileType,
  }));
  const boards: TrustedLocalTarget[] = storyboardList.value.filter(item => item.src && positiveId(item.id)).map(item => ({targetKind:'storyboard',targetId:Number(item.id),name:`分镜 P${item.index + 1}`,src:item.src,mediaType:'image'}));
  return [...new Map([...selected,...boards].map(item => [`${item.targetKind}:${item.targetId}`,item])).values()];
});
watch(() => [project.value?.id, episodesId.value], () => { trustedAssetsVisible.value = false; });

function orderReferenceItems(items: UploadItem[]): UploadItem[] {
  // Reference order is semantic: in frame modes it identifies start/end,
  // and in multi-reference modes it determines @图片/@视频/@音频 numbering.
  return [...items];
}

function modeIntentFor(track: TrackItem): VideoModeIntent {
  return modeIntentForTrack(track);
}

function referencesForTrack(track: TrackItem, requireSrc = false): VideoReference[] {
  const active = positiveId(currentTrack.value?.id) === positiveId(track.id);
  const raw = (active ? imageList.value : track.medias) as UploadItem[];
  return buildVideoReferences(raw, modeIntentFor(track), requireSrc);
}

function enqueueSelectionMutation<T>(trackId: number, task: () => Promise<T>): Promise<T> {
  const previous = selectionMutationQueues.get(trackId) ?? Promise.resolve();
  const running = previous.catch(() => undefined).then(task);
  const marker = running.then(() => undefined, () => undefined);
  selectionMutationQueues.set(trackId, marker);
  void marker.finally(() => { if (selectionMutationQueues.get(trackId) === marker) selectionMutationQueues.delete(trackId); });
  return running;
}

function saveTrackReferences(track: TrackItem, scope: GenerateScope): Promise<boolean> {
  const trackId = positiveId(track.id);
  if (trackId == null || !sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return Promise.resolve(false);
  const references = referencesForTrack(track);
  const signature = referenceSignature(references);
  if (track.referencesInitialized && persistedReferenceSignatures.get(trackId) === signature) return Promise.resolve(true);
  const existing = referenceSavePromises.get(trackId);
  if (existing?.signature === signature) return existing.promise;
  const promise = enqueueSelectionMutation(trackId, async () => {
    if (!sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return false;
    const expectedRevision = Number(track.modeIntentRevision ?? 0);
    const payload = { projectId: scope.projectId, scriptId: scope.scriptId, trackId, references, expectedRevision };
    const mutationSignature = JSON.stringify(payload);
    const previous = referenceMutationIntents.get(trackId);
    const intent = previous?.signature === mutationSignature ? previous : { signature: mutationSignature, key: createIdempotencyKey("video-references") };
    referenceMutationIntents.set(trackId, intent);
    try {
      const raw: any = await axios.post("/production/workbench/setVideoReferences", { ...payload, idempotencyKey: intent.key });
      const response = raw?.data ?? raw;
      if (!sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return false;
      track.modeIntent = response.modeIntent ?? track.modeIntent;
      track.modeIntentRevision = Number.isSafeInteger(Number(response.revision)) ? Number(response.revision) : expectedRevision;
      const persistedReferences = response.references ?? references;
      track.references = persistedReferences;
      track.referencesInitialized = true;
      track.medias = restoreReferenceSelection(track.medias, persistedReferences) as TrackMedia[];
      setCache(scope.projectId, scope.scriptId, trackId, track.medias);
      persistedReferenceSignatures.set(trackId, referenceSignature(persistedReferences));
      track.referencesNeedReview = track.referencesNeedReview || shouldReviewReferences(track.prompt, track.promptReferenceRevision, track.modeIntentRevision);
      referenceMutationIntents.delete(trackId);
      return true;
    } catch (error: any) {
      if (Number(error?.status) < 500) referenceMutationIntents.delete(trackId);
      window.$message.error(error?.message ?? "参考素材保存失败");
      return false;
    }
  });
  referenceSavePromises.set(trackId, { signature, promise });
  void promise.finally(() => { if (referenceSavePromises.get(trackId)?.promise === promise) referenceSavePromises.delete(trackId); });
  return promise;
}

function reviewInputForTrack(track: TrackItem) {
  if (track.promptGenerationContext) return track.promptGenerationContext;
  const active = positiveId(currentTrack.value?.id) === positiveId(track.id);
  const duration = active ? modelParmas.value.duration : (resolveDuration(sourceDurationForTrack(track)).duration ?? sourceDurationForTrack(track));
  return { trackId: track.id, model: modelParmas.value.model, modeIntentRevision: track.modeIntentRevision ?? 0, resolvedMode: track.resolvedMode, generation: { duration, resolution: modelParmas.value.resolution, audio: Boolean(modelParmas.value.audio) }, references: referencesForTrack(track) };
}
function applyModeResolution(track: TrackItem, resolution: VideoModeResolutionView | null | undefined) {
  if (!resolution) return;
  track.modeResolution = resolution;
  track.modeIntent = resolution.modeIntent ?? track.modeIntent;
  track.modeIntentRevision = Number(resolution.modeIntentRevision ?? track.modeIntentRevision ?? 0);
  track.resolvedMode = resolution.resolvedMode ?? undefined;
  track.resolvedReferences = resolution.resolvedReferences ?? [];
  track.referenceSummary = resolution.referenceSummary ?? undefined;
  track.compatibility = resolution.compatibility;
}
function reviewContextSignature(track: TrackItem): string { return JSON.stringify(reviewInputForTrack(track)); }
function reviewContextForGeneration(track: TrackItem, input: {
  model: string;
  modeIntentRevision: number;
  references: VideoReference[];
  generation: { duration: number; resolution: string; audio: boolean };
}): string {
  return JSON.stringify({ trackId: track.id, model: input.model, modeIntentRevision: input.modeIntentRevision, resolvedMode: track.resolvedMode, generation: input.generation, references: input.references });
}

async function modeChange(newVal: string) {
  const scope = currentScope.value;
  const track = currentTrack.value;
  const trackId = positiveId(track?.id);
  if (!scope || !track || trackId == null || modeSaving.value) return;
  const next = parseModeIntentValue(newVal);
  if (modeIntentSelectValue(next) === modeIntentSelectValue(modeIntentFor(track))) return;
  modeSaving.value = true;
  try {
    const referencesSaved = await saveTrackReferences(track, scope);
    if (!referencesSaved) return;
    const mutation = await enqueueSelectionMutation(trackId, async () => {
      const expectedRevision = Number(track.modeIntentRevision ?? 0);
      const payload = { projectId: scope.projectId, scriptId: scope.scriptId, trackId, modeIntent: next, expectedRevision };
      const signature = JSON.stringify(payload);
      const previous = modeMutationIntents.get(trackId);
      const intent = previous?.signature === signature ? previous : { signature, key: createIdempotencyKey("video-mode") };
      modeMutationIntents.set(trackId, intent);
      const rawResponse: any = await axios.post("/production/workbench/setVideoModeIntent", { ...payload, idempotencyKey: intent.key });
      return { rawResponse, expectedRevision };
    });
    const { rawResponse, expectedRevision } = mutation;
    const response = rawResponse?.data ?? rawResponse;
    if (!sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return;
    track.modeIntent = response.modeIntent ?? next;
    track.modeIntentRevision = Number.isSafeInteger(Number(response.revision)) ? Number(response.revision) : expectedRevision;
    if (Array.isArray(response.references)) {
      track.references = response.references;
      track.referencesInitialized = true;
      track.medias = restoreReferenceSelection(track.medias, response.references) as TrackMedia[];
      setCache(scope.projectId, scope.scriptId, trackId, track.medias);
      persistedReferenceSignatures.set(trackId, referenceSignature(response.references));
    }
    if (track.prompt) track.referencesNeedReview = true;
    if (currentTrack.value === track) modelParmas.value.mode = modeIntentSelectValue(track.modeIntent);
    modeMutationIntents.delete(trackId);
    if (currentTrack.value === track) await resolveCurrentVideoMode();
  } catch (error: any) {
    window.$message.error(error?.message ?? "视频模式保存失败");
    if (Number(error?.status) < 500) modeMutationIntents.delete(trackId);
  } finally {
    modeSaving.value = false;
  }
}
const modeList = computed(() => {
  const modeLabelMap: Record<string, string> = {
    singleImage: "单图",
    startEndRequired: "首尾帧",
    endFrameOptional: "尾帧可选",
    startFrameOptional: "首帧可选",
    text: "文本生视频",
    videoReference: "视频",
    imageReference: "图片",
    audioReference: "音频",
    textReference: "文本",
  };
  function parseRefLabel(m: string): string {
    const match = m.match(/^(videoReference|imageReference|audioReference|textReference):(\d+)$/);
    if (match) {
      const base = modeLabelMap[match[1]] || match[1];
      return `${base} ×${match[2]}`;
    }
    return modeLabelMap[m] || m;
  }
  const choices = modeOptions.value.mode
    ? modeOptions.value.mode.map((mode) =>
        Array.isArray(mode)
          ? { value: JSON.stringify(mode), label: mode.map((m) => parseRefLabel(m)).join(" + ") + "参考" }
          : { value: mode, label: modeLabelMap[mode] || mode },
      )
    : [];
  const currentValue = modeIntentSelectValue(currentModeIntent.value);
  if (currentValue !== "auto" && !choices.some((choice) => choice.value === currentValue)) {
    choices.unshift({ value: currentValue, label: `${videoModeLabel(currentModeIntent.value)}（当前人工选择）` });
  }
  return [{ value: "auto", label: "自动匹配" }, ...choices];
});
const currentTrack = computed({
  get() {
    return trackList.value[activeTrackIndex.value];
  },
  set(val) {
    trackList.value[activeTrackIndex.value] = val;
  },
});
const currentModeIntent = computed<VideoModeIntent>(() => currentTrack.value ? modeIntentFor(currentTrack.value) : "auto");

async function resolveCurrentVideoMode() {
  const scope = currentScope.value;
  const track = currentTrack.value;
  const trackId = positiveId(track?.id);
  if (!scope || !scopeReady.value || !track || trackId == null || !modelParmas.value.model) return;
  if (!(await saveTrackReferences(track, scope))) return;
  if (currentTrack.value !== track || !sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return;
  const references = referencesForTrack(track);
  const requestSignature = JSON.stringify({
    projectId: scope.projectId,
    scriptId: scope.scriptId,
    trackId,
    model: modelParmas.value.model,
    references,
    modeIntentRevision: track.modeIntentRevision ?? 0,
  });
  const sequence = ++modeResolveSequence;
  modeResolving.value = true;
  try {
    const raw: any = await axios.post("/production/workbench/resolveVideoMode", JSON.parse(requestSignature));
    const response = raw?.data ?? raw;
    if (sequence !== modeResolveSequence || currentTrack.value !== track || !sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return;
    track.modeIntent = response.modeIntent ?? track.modeIntent;
    track.modeIntentRevision = Number(response.modeIntentRevision ?? track.modeIntentRevision ?? 0);
    const previousResolved = track.resolvedReferences ? referenceSignature(track.resolvedReferences) : undefined;
    const nextResolved = response.resolvedReferences ?? [];
    applyModeResolution(track, response);
    if (previousResolved != null && previousResolved !== referenceSignature(nextResolved) && track.prompt) track.referencesNeedReview = true;
    track.referenceSummary = response.referenceSummary;
    track.compatibility = response.compatibility ?? { ok: true };
  } catch (error: any) {
    if (sequence !== modeResolveSequence || currentTrack.value !== track || !sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return;
    track.resolvedMode = undefined;
    track.resolvedReferences = undefined;
    track.referenceSummary = undefined;
    track.compatibility = { ok: false, code: error?.code, message: error?.message ?? "当前模型与所选模式或素材不兼容" };
  } finally {
    if (sequence === modeResolveSequence) modeResolving.value = false;
  }
}

watch(
  () => {
    const track = currentTrack.value;
    return track ? JSON.stringify({ id: track.id, model: modelParmas.value.model, revision: track.modeIntentRevision, references: referencesForTrack(track) }) : "";
  },
  () => { void resolveCurrentVideoMode(); },
);

const promptGenerationGate = {
  begin(ids: readonly number[], previousJobIds: ReadonlyMap<number, string | null> = new Map()): boolean {
    const unique = [...new Set(ids)];
    if (!unique.length || unique.some((id) => promptPending.has(id))) return false;
    unique.forEach((id) => {
      const previousJobId = previousJobIds.get(id);
      promptPending.set(id, { previousJobId: previousJobId ?? undefined, submitted: false });
    });
    return true;
  },
  markSubmitted(id: number): void {
    const pending = promptPending.get(id);
    if (pending) pending.submitted = true;
  },
  noteJob(id: number, jobId: unknown): void {
    const pending = promptPending.get(id);
    if (pending && typeof jobId === "string" && jobId) pending.jobId = jobId;
  },
  isPending(id: number): boolean { return promptPending.has(id); },
  pendingInfo(id: number) { return promptPending.get(id); },
  getIntent(id: number) { return promptGenerationIntents.get(id); },
  setIntent(id: number, intent: PromptGenerationIntent) { promptGenerationIntents.set(id, intent); },
  finish(id: number, retainIntent = false): void {
    promptPending.delete(id);
    if (!retainIntent) promptGenerationIntents.delete(id);
  },
  clear(): void {
    promptPending.clear();
    promptGenerationIntents.clear();
  },
};
const currentPromptPending = computed(() => {
  const id = positiveId(currentTrack.value?.id);
  return id != null && promptGenerationGate.isPending(id);
});

watch(
  () => [project.value?.id, episodesId.value],
  () => {
    scopeSequence.value += 1;
    loadSequence += 1;
    loadedScope.value = undefined;
    loadError.value = "";
    activeTrackIndex.value = 0;
    trackList.value = [];
    storyboardList.value = [];
    persistedTrackPrompts.clear();
    promptConflictVersions.clear();
    promptMutationIntents.clear();
    promptSavePromises.clear();
    promptGenerationGate.clear();
    persistedReferenceSignatures.clear();
    referenceMutationIntents.clear();
    referenceSavePromises.clear();
    selectionMutationQueues.clear();
    const nextScope = captureGenerateScope(project.value?.id, episodesId.value, scopeSequence.value);
    if (nextScope && !disposed.value) void getGenerateData();
  },
  { immediate: true },
);

/** 将时长限制在模型支持的范围内 */
function clampDuration(trackDuration: number): number {
  return resolveDuration(trackDuration).duration ?? trackDuration;
}

function resolveDuration(trackDuration: number): VideoDurationChoice {
  return resolveVideoDuration(modeOptions.value, trackDuration);
}

function supportsResolution(duration: number): boolean {
  const choice = resolveDuration(duration);
  return choice.duration != null && videoResolutions(modeOptions.value, choice.duration).includes(modelParmas.value.resolution);
}

function sourceDurationForTrack(track: TrackItem | undefined): number {
  if (!track) return 0;
  return storyboardTrackDuration(storyboardList.value, track.id, track.duration);
}

function durationOverrideKey(track: TrackItem | undefined): string | undefined {
  if (!track?.id || !modelParmas.value.model) return undefined;
  return `${modelParmas.value.model}:${track.id}`;
}

const currentTrackSourceDuration = computed(() => sourceDurationForTrack(currentTrack.value));
const currentDurationChoice = computed(() => resolveDuration(currentTrackSourceDuration.value));
const currentDurationNotice = computed(() => {
  const source = currentTrackSourceDuration.value;
  const choice = currentDurationChoice.value;
  if (!source) return "";
  if (choice.resolution === "unavailable") return "当前模型未提供可用的视频时长，请重新选择模型";
  if (choice.resolution === "exceeds_maximum") return `脚本 ${source}s 超出当前模型最大时长，请拆分分镜或选择支持更长时长的模型`;
  if (modelParmas.value.duration !== choice.duration) return `脚本 ${source}s，当前片段手动生成 ${modelParmas.value.duration}s（仅影响当前片段）`;
  if (choice.resolution === "exact") return "";
  return `脚本 ${source}s，当前片段生成 ${choice.duration}s（按模型支持值向上匹配）`;
});

function syncCurrentDuration() {
  if (!currentTrack.value || currentTrackSourceDuration.value <= 0) return;
  const choice = currentDurationChoice.value;
  const override = durationOverrideKey(currentTrack.value);
  const candidate = override ? durationOverrides.value[override] : undefined;
  if (choice.duration != null && candidate != null && candidate >= choice.duration && resolveDuration(candidate).duration === candidate) {
    modelParmas.value.duration = candidate;
    return;
  }
  if (override) delete durationOverrides.value[override];
  modelParmas.value.duration = choice.duration ?? currentTrackSourceDuration.value;
}

watch(
  () => modelParmas.value.model,
  (val) => {
    if (!val) {
      modeOptions.value = {
        name: "",
        modelName: "",
        durationResolutionMap: [],
        audio: false,
        type: "video",
        mode: [],
      };
      return;
    }
    axios.post("/modelSelect/getModelDetail", { modelId: val }).then(({ data }) => {
      if (modelParmas.value.model !== val || data?.type !== "video") return;
      modeOptions.value = data;
      if (data.audio === true || data.audio === "true") modelParmas.value.audio = true;
      else if (data.audio === false || data.audio === "false") modelParmas.value.audio = false;
      const drMap = data.durationResolutionMap;
      if (Array.isArray(drMap) && drMap.length > 0) {

        syncCurrentDuration();
        const resolutions = videoResolutions(data, modelParmas.value.duration);
        if (!resolutions.includes(modelParmas.value.resolution)) modelParmas.value.resolution = resolutions[0] ?? "";
      }

      // Keep an explicit per-track intent even when this model cannot satisfy
      // it. resolveVideoMode supplies the actionable incompatibility message.
      void resolveCurrentVideoMode();
    });
  },
  { immediate: true },
);
/** uploadBox 作为 promptEditor 的引用预览 */
const references = computed(() => {
  function getFileTypeByExt(src: string | undefined): "image" | "video" | "audio" {
    if (!src) return "image";
    // 去掉 query 和 hash 部分
    const cleanSrc = src.split("?")[0].split("#")[0];
    const ext = cleanSrc.split(".").pop()?.toLowerCase() ?? "";

    if (["mp4", "webm", "mov", "avi", "mkv"].includes(ext)) return "video";
    if (["mp3", "wav", "ogg", "aac", "flac", "m4a"].includes(ext)) return "audio";
    return "image";
  }

  const resolved = currentTrack.value?.resolvedReferences;
  const resolvedKeys = resolved ? new Set(resolved.map((item) => `${item.sources}:${item.id}`)) : undefined;
  return imageList.value
    .filter((item) => !resolvedKeys || resolvedKeys.has(`${item.sources}:${item.id}`))
    .filter((item) => item.src)
    .map((item) => ({
      type: getFileTypeByExt(item.src) as "image" | "video" | "audio" | "text",
      src: item.src ?? "",
    }));
});

async function getGenerateData() {
  const scope = currentScope.value;
  if (!scope || disposed.value) return;
  const requestSequence = ++loadSequence;
  loadError.value = "";
  try {
    await loadGenerateData(scope, requestSequence);
  } catch {
    if (requestSequence !== loadSequence || !sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return;
    loadedScope.value = undefined;
    loadError.value = "片段数据加载失败，请重新加载后再生成。";
  }
}

async function loadGenerateData(scope: GenerateScope, requestSequence: number) {
  const previousTrackId = positiveId(currentTrack.value?.id);
  const { data } = await axios.post("/production/workbench/getGenerateData", {
    projectId: scope.projectId,
    scriptId: scope.scriptId,
  });
  if (requestSequence !== loadSequence || !sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return;

  if (!Array.isArray(data?.storyboardList) || !Array.isArray(data?.trackList) || data.trackList.some((track: TrackItem) => positiveId(track.id) == null)) throw new Error("片段数据格式无效");
  const storyboardData = data.storyboardList;
  const trackData: TrackItem[] = data.trackList.map((track: TrackItem) => ({
    ...track,
    id: positiveId(track.id)!,
    modeIntent: modeIntentForTrack(track),
    modeIntentRevision: Number.isSafeInteger(Number(track.modeIntentRevision)) ? Number(track.modeIntentRevision) : 0,
    promptReviewPrompt: track.prompt,
    referencesNeedReview: shouldReviewReferences(track.prompt, track.promptReferenceRevision, track.modeIntentRevision),
  }));
  trackData.forEach((track) => applyModeResolution(track, track.modeResolution));
  // A server-initialized selection is authoritative across refreshes and
  // collaborators. Legacy tracks may still use the local cache until their
  // first explicit reference save migrates them.
  trackData.forEach((track) => {
    const trackId = positiveId(track.id);
    if (trackId == null) return;
    if (Array.isArray(track.references)) {
      const userEditedCache = hasUserSelection(scope.projectId, scope.scriptId, trackId);
      track.medias = initialReferenceSelection(track.medias, track.references, { referencesInitialized: Boolean(track.referencesInitialized), userEditedCache }) as TrackMedia[];
      if (track.referencesInitialized || !userEditedCache) setCache(scope.projectId, scope.scriptId, trackId, track.medias);
      if (track.referencesInitialized) persistedReferenceSignatures.set(trackId, referenceSignature(track.references));
    }
  });
  // 优先使用本地缓存，没有缓存则用后端数据并写入缓存
  initCacheFromTrackList(scope.projectId, scope.scriptId, trackData);
  await warmUpUrls(scope.projectId, scope.scriptId);
  if (requestSequence !== loadSequence || !sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return;
  // 将本地缓存回写到 trackList，确保优先使用缓存数据（src 已解析为完整 URL）
  trackData.forEach((track: TrackItem) => {
    const trackId = track.id;
    if (trackId == null) return;
    const cached = getCache(scope.projectId, scope.scriptId, trackId);
    if (cached?.length) track.medias = cached as unknown as TrackMedia[];
  });
  if (requestSequence !== loadSequence || !sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return;
  storyboardList.value = storyboardData;
  trackList.value = [...trackData];
  const nextIndex = previousTrackId == null ? -1 : trackList.value.findIndex((track) => positiveId(track.id) === previousTrackId);
  activeTrackIndex.value = nextIndex >= 0 ? nextIndex : Math.min(activeTrackIndex.value, Math.max(0, trackList.value.length - 1));
  loadedScope.value = scope;
  persistedTrackPrompts.clear();
  promptConflictVersions.clear();
  trackList.value.forEach((track) => {
    const trackId = positiveId(track.id);
    if (trackId != null) persistedTrackPrompts.set(trackId, track.prompt ?? "");
  });
  syncCurrentDuration();
  if (currentTrack.value) modelParmas.value.mode = modeIntentSelectValue(modeIntentFor(currentTrack.value));
  void resolveCurrentVideoMode();
}
/** 提示词失焦时保存到后端 */
function handleDurationUpdated(update: { trackId: number; version: number }) {
  const track = trackList.value.find((item) => item.id === update.trackId);
  if (track && Number.isSafeInteger(update.version)) track.version = update.version;
  if (track && currentTrack.value?.id === track.id) {
    const auto = resolveDuration(sourceDurationForTrack(track));
    const key = durationOverrideKey(track);
    if (key && auto.duration != null && modelParmas.value.duration > auto.duration && resolveDuration(modelParmas.value.duration).duration === modelParmas.value.duration) durationOverrides.value[key] = modelParmas.value.duration;
    else if (key) delete durationOverrides.value[key];
  }
}

function saveTrackPrompt(track: TrackItem, scope: GenerateScope): Promise<boolean> {
  if (!sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return Promise.resolve(false);
  const trackId = positiveId(track.id);
  if (trackId == null || !Number.isSafeInteger(track.version) || track.version! < 0) {
    window.$message.error("轨道版本尚未加载，请刷新后重试");
    return Promise.resolve(false);
  }
  const prompt = track.prompt ?? "";
  if (persistedTrackPrompts.get(trackId) === prompt && !promptMutationIntents.has(trackId)) return Promise.resolve(true);
  if (promptConflictVersions.get(trackId) === track.version) {
    window.$message.error("轨道版本已冲突，已保留当前提示词，请先刷新");
    return Promise.resolve(false);
  }
  const payload = {
    id: trackId,
    projectId: scope.projectId,
    scriptId: scope.scriptId,
    prompt,
    expectedVersion: track.version,
    modeIntentRevision: track.modeIntentRevision ?? 0,
  };
  const signature = JSON.stringify(payload);
  const existing = promptSavePromises.get(trackId);
  if (existing?.signature === signature) return existing.promise;
  const previous = promptMutationIntents.get(trackId);
  const intent = previous?.signature === signature ? previous : { signature, key: createIdempotencyKey("track-prompt") };
  promptMutationIntents.set(trackId, intent);
  const promise = (async () => {
    try {
      const response: any = await axios.post("/production/workbench/updateVideoPrompt", { ...payload, idempotencyKey: intent.key });
      if (!sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return false;
      const target = trackList.value.find((item) => positiveId(item.id) === trackId);
      if (target !== track) return false;
      if (track.version === payload.expectedVersion && Number.isSafeInteger(Number(response.version))) track.version = Number(response.version);
      persistedTrackPrompts.set(trackId, prompt);
      track.promptReferenceRevision = track.modeIntentRevision ?? 0;
      track.referencesNeedReview = false;
      promptConflictVersions.delete(trackId);
      promptMutationIntents.delete(trackId);
      return true;
    } catch (error: any) {
      if (!sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return false;
      const status = Number(error?.status);
      if (status === 409) {
        promptConflictVersions.set(trackId, Number(payload.expectedVersion));
        window.$message.error("轨道已被其他成员修改，已保留当前提示词，请刷新后再确认");
      } else window.$message.error(error?.message ?? "轨道提示词保存失败");
      if (Number.isSafeInteger(status) && status < 500) promptMutationIntents.delete(trackId);
      return false;
    }
  })();
  promptSavePromises.set(trackId, { signature, promise });
  void promise.finally(() => {
    if (promptSavePromises.get(trackId)?.promise === promise) promptSavePromises.delete(trackId);
  });
  return promise;
}

async function handlePromptBlur() {
  const scope = currentScope.value;
  const track = trackList.value[activeTrackIndex.value];
  if (!scope || !track || track.id == null) return;
  await saveTrackPrompt(track, scope);
}

async function preparePromptGeneration(trackIds: readonly number[], scope: GenerateScope): Promise<boolean> {
  if (!sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return false;
  const tracks = trackList.value.filter((track) => {
    const id = positiveId(track.id);
    return id != null && trackIds.includes(id);
  });
  const referenceResults = await Promise.all(tracks.map((track) => saveTrackReferences(track, scope)));
  if (!referenceResults.every(Boolean)) return false;
  const results = await Promise.all(tracks.map((track) => saveTrackPrompt(track, scope)));
  return results.length === trackIds.length && results.every(Boolean) && sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value);
}

async function prepareReferenceSelection(trackIds: readonly number[], scope: GenerateScope): Promise<boolean> {
  if (!sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return false;
  const tracks = trackList.value.filter((track) => {
    const id = positiveId(track.id);
    return id != null && trackIds.includes(id);
  });
  const results = await Promise.all(tracks.map((track) => saveTrackReferences(track, scope)));
  return results.length === trackIds.length && results.every(Boolean) && sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value);
}

/** 单个轨道生成提示词 */
async function genText() {
  const scope = currentScope.value;
  const track = currentTrack.value;
  const currentTrackId = positiveId(track?.id);
  if (!scope || !scopeReady.value || !track || currentTrackId == null || track.state === "生成中") return;
  const generationSnapshot = captureVideoGenerationSettings(modelParmas.value);
  if (!(await saveTrackReferences(track, scope))) return;
  if (track.compatibility && !track.compatibility.ok) return window.$message.error(track.compatibility.message ?? "当前模型与所选模式或素材不兼容");
  const previousJobId = typeof track.promptJobId === "string" ? track.promptJobId : undefined;
  if (!promptGenerationGate.begin([currentTrackId], new Map([[currentTrackId, previousJobId ?? null]]))) return;
  const references = referencesForTrack(track);
  const saved = await saveTrackPrompt(track, scope);
  if (!sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return;
  if (!saved) {
    promptGenerationGate.finish(currentTrackId);
    return;
  }
  track.state = "生成中";
  track.promptJobId = null;
  const promptPayload = { projectId: scope.projectId, scriptId: scope.scriptId, trackId: currentTrackId, references, model: generationSnapshot.model, modeIntentRevision: track.modeIntentRevision ?? 0, generation: {duration: generationSnapshot.duration, resolution: generationSnapshot.resolution, audio: generationSnapshot.audio}, expectedVersion: track.version };
  track.promptGenerationContext = { trackId: currentTrackId, model: promptPayload.model, modeIntentRevision: promptPayload.modeIntentRevision, resolvedMode: track.resolvedMode, generation: promptPayload.generation, references };
  const promptSignature = JSON.stringify(promptPayload);
  const previousIntent = promptGenerationIntents.get(currentTrackId);
  const promptIntent = previousIntent?.signature === promptSignature ? previousIntent : { signature: promptSignature, key: createIdempotencyKey("video-prompt"), startedAt: Date.now() };
  promptGenerationIntents.set(currentTrackId, promptIntent);
  try {
    promptGenerationGate.markSubmitted(currentTrackId);
    const response: any = await axios.post("/production/workbench/generateVideoPrompt", { ...promptPayload, idempotencyKey: promptIntent.key });
    const { data } = response;
    if (!sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return;
    const target = trackList.value.find((item) => item.id === currentTrackId);
    if (target !== track) return;
    applyModeResolution(track, response.modeResolution ?? data?.modeResolution);
    if (data && typeof data === "object" && (data.state === "running" || data.state === "queued")) {
      promptIntent.jobId = data.jobId ?? undefined;
      promptGenerationGate.noteJob(currentTrackId, promptIntent.jobId);
      track.promptJobId = promptIntent.jobId ?? null;
      return;
    }
    track.prompt = data;
    track.state = "已完成";
    if (Number.isSafeInteger(response.version) && response.version >= Number(track.version ?? 0)) track.version = response.version;
    persistedTrackPrompts.set(currentTrackId, data ?? "");
    track.promptReferenceRevision = track.modeIntentRevision ?? 0;
    track.referencesNeedReview = false;
    track.promptGenerationContext = undefined;
    promptGenerationGate.finish(currentTrackId);
  } catch (e) {
    if (!sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return;
    track.state = "生成失败";
    track.promptGenerationContext = undefined;
    window.$message.error((e as Error)?.message ?? "提示词生成失败");
    const status = Number((e as any)?.status ?? (e as any)?.response?.status);
    promptGenerationGate.finish(currentTrackId, !(Number.isSafeInteger(status) && status < 500));
  }
}
function trackChange(prevIndex?: number) {
  // 切换前：将旧轨道的 imageList 保存到缓存
  if (prevIndex != null) {
    const prevTrack = trackList.value[prevIndex];
    const pid = project.value?.id;
    const sid = episodesId.value;
    if (pid != null && sid != null && prevTrack?.id != null) {
      setCache(pid, sid, prevTrack.id, prevTrack.medias as unknown as UploadItem[]);
    }
  }
  // 切换后：从缓存恢复当前轨道的 imageList
  const pid = project.value?.id;
  const sid = episodesId.value;
  const curTrack = trackList.value[activeTrackIndex.value];
  if (pid != null && sid != null && curTrack?.id != null) {
    const cached = getCache(pid, sid, curTrack.id);
    if (cached) {
      curTrack.medias = cached as unknown as TrackMedia[];
    }
  }
  // imageList follows the active track. Mode changes never discard references.
  if (curTrack) modelParmas.value.mode = modeIntentSelectValue(modeIntentFor(curTrack));
  syncCurrentDuration();
  void resolveCurrentVideoMode();
}
/** 监听当前轨道的 medias 变化，实时同步到缓存 */
watch(
  () => currentTrack.value?.medias,
  (medias) => {
    if (!medias) return;
    const pid = project.value?.id;
    const sid = episodesId.value;
    const trackId = currentTrack.value?.id;
    if (pid != null && sid != null && trackId != null) {
      setCache(pid, sid, trackId, medias as unknown as UploadItem[]);
    }
  },
  { deep: true },
);

onMounted(() => {
  if (!modelParmas.value.model) modelParmas.value.model = project.value?.videoModel || "";
  if (!modelParmas.value.mode) modelParmas.value.mode = "auto";
  if (hasGenerateVideoIds.value && hasGenerateVideoIds.value.length) {
    startPoll();
  }
});
/** 单个轨道生成视频 */
async function generateVideo() {
  const dlg = DialogPlugin.confirm({
    header: $t("workbench.generate.generateConfirm"),
    body: $t("workbench.generate.generateConfirmBody"),
    onConfirm: async () => {
      dlg.destroy();
      if (generateVideoPending.value) return;
      const track = currentTrack.value;
      const scopeSnapshot = currentScope.value;
      if (!track || !scopeSnapshot) return;
      const generationSnapshot = captureVideoGenerationSettings(modelParmas.value);
      const sourceDuration = currentTrackSourceDuration.value;
      const durationChoice = resolveDuration(sourceDuration);
      if (durationChoice.duration == null) {
        window.$message.warning(`当前片段脚本时长 ${sourceDuration}s 超出模型支持范围，请拆分分镜或选择支持更长时长的模型`);
        return;
      }
      const selectedDuration = resolveDuration(generationSnapshot.duration);
      if (selectedDuration.duration !== generationSnapshot.duration || generationSnapshot.duration < durationChoice.duration! || !supportsResolution(generationSnapshot.duration)) {
        window.$message.warning("当前片段的时长或清晰度不是模型支持的组合，请从顶部下拉重新选择");
        return;
      }
      if (track.compatibility && !track.compatibility.ok) {
        window.$message.error(track.compatibility.message ?? "当前模型与所选模式或素材不兼容");
        return;
      }
      if (!(await saveTrackReferences(track, scopeSnapshot))) return;
      if (!sameGenerateScope(scopeSnapshot, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return;
      const requestData = {
        projectId: project.value?.id,
        scriptId: episodesId.value,
        references: referencesForTrack(track),
        prompt: track.prompt,
        model: generationSnapshot.model,
        modeIntentRevision: track.modeIntentRevision ?? 0,
        resolution: generationSnapshot.resolution,
        // A manually selected supported value applies to this active track only.
        duration: generationSnapshot.duration,
        audio: generationSnapshot.audio,
        trackId: track.id,
      };
      const scope = `single:${String(project.value?.id ?? "")}:${String(episodesId.value ?? "")}:${String(track.id)}`;
      generateVideoPending.value = true;
      try {
        const { videoId, promptReview, modeResolution } = await generationIntents.run(scope, requestData, async (idempotencyKey) => {
          const { data } = await axios.post("/production/workbench/generateVideo", { ...requestData, idempotencyKey });
          return { videoId: data.videoId, promptReview: data.promptReview, modeResolution: data.modeResolution };
        });
        applyModeResolution(track, modeResolution);
        track.promptReview = promptReview ?? null;
        track.promptReviewPrompt = track.prompt;
        track.promptReviewContext = reviewContextForGeneration(track, {
          model: requestData.model,
          modeIntentRevision: requestData.modeIntentRevision,
          references: requestData.references,
          generation: { duration: requestData.duration, resolution: requestData.resolution, audio: requestData.audio },
        });
        window.$message.success($t("workbench.generate.generateStarted"));
        track.videoList.push({
          id: videoId,
          state: "生成中",
          src: "",
        });
      } catch (e) {
        window.$message.error((e as any)?.message ?? "视频发起生成请求失败");
      } finally {
        generateVideoPending.value = false;
      }
    },
    onCancel: () => dlg.destroy(),
  });
}
let pollTimer: NodeJS.Timeout | null = null;
let promptPollTimer: NodeJS.Timeout | null = null;
function startPoll() {
  if (pollTimer !== null) return;
  pollTimer = setInterval(() => getVideoList(), 3000);
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
const hasGenerateVideoIds = computed(() => {
  return trackList.value
    .map((track) => {
      return track.videoList.filter((i) => i.state == "生成中").map((i) => i.id);
    })
    .flatMap((i) => i);
});
const hasGeneratePromptIds = computed(() => {
  // Poll every loaded track so a prompt job started by another session is
  // reflected here even when this tab never observed its queued state.
  return trackList.value.map((track) => positiveId(track.id)).filter((id): id is number => id != null);
});
/** 查询所有视频列表，并检测生成完成/失败状态 */
async function getVideoList() {
  const scope = currentScope.value;
  const videoIds = hasGenerateVideoIds.value.map((id) => positiveId(id)).filter((id): id is number => id != null);
  if (!scope || !scopeReady.value || disposed.value || !videoIds.length) return;
  const { data } = await axios.post("/production/workbench/checkVideoStateList", {
    projectId: scope.projectId,
    scriptId: scope.scriptId,
    videoIds,
  });
  if (!sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return;
  if (data && data.length) {
    data.forEach((item: { id: number; state: "生成中" | "未生成" | "已完成" | "生成失败"; src?: string; errorReason?: string }) => {
      for (const track of trackList.value) {
        const findData = track.videoList.find((i) => i.id == item.id);
        if (findData) {
          findData.state = item.state;
          findData.src = item?.src ?? "";
          findData.errorReason = item?.errorReason ?? "";
          break;
        }
      }
    });
  }
}
function startPromptPoll() {
  if (promptPollTimer !== null) return;
  promptPollTimer = setInterval(() => { void getTrackPromptList().catch(() => undefined); }, 3000);
}

function stopPromptPoll() {
  if (promptPollTimer) {
    clearInterval(promptPollTimer);
    promptPollTimer = null;
  }
}
/** 查询所有视频列表，并检测生成完成/失败状态 */
let promptPollInFlight = false;
async function getTrackPromptList() {
  const scope = currentScope.value;
  if (promptPollInFlight || !scope || !scopeReady.value || disposed.value || !hasGeneratePromptIds.value.length) return;
  const requestedIds = new Set(hasGeneratePromptIds.value);
  const jobIds = trackList.value.filter((track) => track.state === "生成中" && track.promptJobId).map((track) => track.promptJobId!);
  promptPollInFlight = true;
  try {
    const { data } = await axios.post("/production/workbench/checkVideoPrompt", {
      projectId: scope.projectId,
      scriptId: scope.scriptId,
      trackIds: [...requestedIds],
      jobIds,
      reviewInputs: trackList.value.map(reviewInputForTrack),
    });
    if (!sameGenerateScope(scope, project.value?.id, episodesId.value, scopeSequence.value, disposed.value)) return;
    if (Array.isArray(data)) {
      const returnedIds = new Set<number>();
      data.forEach((item: { id: number; jobId?: string; idempotencyKey?: string; state: "生成中" | "未生成" | "已完成" | "生成失败"; prompt?: string; reason?: string; version?: number; promptReferenceRevision?: number; promptReview?: VideoPromptReview | null }) => {
        const findData = trackList.value.find((t) => t.id == item.id);
        returnedIds.add(Number(item.id));
        if (findData) {
          const findId = positiveId(findData.id);
          if (findId == null) return;
          const remoteVersion = Number(item.version);
          const localVersion = Number(findData.version ?? 0);
          // A save may have completed while this read was in flight.
          if (Number.isSafeInteger(remoteVersion) && remoteVersion < localVersion) return;
          const previousState = findData.state;
          const previousJobId = findData.promptJobId;
          const localDraft = findData.prompt !== (persistedTrackPrompts.get(findId) ?? "");
          const pending = promptPending.get(findId);
          const submittedIntent = promptGenerationIntents.get(findId);
          if (pending?.submitted && item.jobId && item.idempotencyKey === submittedIntent?.key) pending.jobId = item.jobId;
          if (pending && (!pending.submitted || !pending.jobId || pending.jobId !== item.jobId)) return;
          if (item.jobId) findData.promptJobId = item.jobId;
          const completedReviewContext = findData.promptGenerationContext ?? reviewInputForTrack(findData);
          findData.promptReview = item.promptReview ?? null;
          findData.promptReviewPrompt = item.prompt;
          findData.promptReviewContext = item.promptReview ? JSON.stringify(completedReviewContext) : undefined;
          const terminal = item.state === "已完成" || item.state === "生成失败";
          if (findData.state !== item.state) findData.state = item.state;
          if ((item.state === "已完成" || item.state === "生成中") && !localDraft && item.prompt !== findData.prompt) findData.prompt = item?.prompt ?? "";
          const remoteVersionChanged = Number.isSafeInteger(remoteVersion) && remoteVersion >= 0 && findData.version !== remoteVersion;
          if (item.prompt != null && (item.state === "已完成" || item.state === "生成失败") && !localDraft) persistedTrackPrompts.set(findId, item.prompt);
          if (Number.isSafeInteger(Number(item.promptReferenceRevision))) {
            findData.promptReferenceRevision = Number(item.promptReferenceRevision);
            findData.referencesNeedReview = shouldReviewReferences(findData.prompt, findData.promptReferenceRevision, findData.modeIntentRevision);
          }
          if (remoteVersionChanged && localDraft) {
            // Keep the local draft anchored to its original version. Advancing it
            // would let the next blur overwrite a newer remote edit.
            promptConflictVersions.set(findData.id, localVersion);
          } else if (remoteVersionChanged) findData.version = remoteVersion;
          if (findData.reason !== (item?.reason ?? "")) findData.reason = item?.reason ?? "";
          if (terminal && (pending || (submittedIntent && item.idempotencyKey === submittedIntent.key))) promptGenerationGate.finish(findId);
          if (terminal) findData.promptGenerationContext = undefined;
          if (item.state === "生成失败" && (previousState !== "生成失败" || previousJobId !== item.jobId) && (item.jobId || previousState === "生成中")) {
            window.$message.error(`提示词生成失败，${item.reason ?? "未知原因"}`);
          }
        }
      });
      const deletedIds = [...requestedIds].filter((id) => !returnedIds.has(Number(id)));
      if (deletedIds.length) {
        const deleted = new Set(deletedIds.map(Number));
        trackList.value = trackList.value.filter((track) => !deleted.has(Number(track.id)));
        deletedIds.forEach((id) => {
          if (promptGenerationGate.isPending(id)) return;
          persistedTrackPrompts.delete(id);
          promptMutationIntents.delete(id);
          promptGenerationIntents.delete(id);
        });
        if (activeTrackIndex.value >= trackList.value.length) activeTrackIndex.value = Math.max(0, trackList.value.length - 1);
      }
    }
  } finally { promptPollInFlight = false; }
}
watch(
  () => hasGenerateVideoIds.value,
  (newVal) => {
    if (newVal && newVal.length > 0) {
      startPoll();
    } else {
      stopPoll();
    }
  },
);
watch(
  () => hasGeneratePromptIds.value,
  (newVal) => {
    if (newVal && newVal.length > 0) {
      startPromptPoll();
    } else {
      stopPromptPoll();
    }
  },
);
onUnmounted(() => {
  disposed.value = true;
  stopPoll();
  stopPromptPoll();
});
</script>

<style lang="scss" scoped>
.scopeNotice {
  color: var(--td-text-color-secondary);
  padding: 8px 0;
}
.index {
  height: calc(100vh - 120px);
  gap: 16px;
  overflow-y: auto;
  .referenceImage {
  }
  .modelSelect {
  }
  .generate {
    flex: 1;
    min-height: 0;
    width: 100%;
    gap: 5px;
    .prompt {
      width: 50%;
      height: 100%;
      min-height: 0;
      .videoPrompt {
        width: 100%;
        height: 100%;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        :deep(.t-card__body) {
          flex: 1;
          min-height: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .promptData {
          width: 100%;
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          .promptInput {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
          }
        }
      }
    }
    .video {
      width: 50%;
      height: 100%;
      min-height: 0;
    }
  }
  .track {
  }
}
</style>

<style scoped>.promptReview{padding:8px 12px;font-size:13px;color:#56616e;max-height:180px;overflow:auto}.promptReview summary{cursor:pointer;color:#0052d9}.promptReview li{margin:6px 0}</style>
