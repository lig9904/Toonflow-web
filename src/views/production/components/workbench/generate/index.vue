<template>
  <div class="index fc">
    <div class="referenceImage">
      <div class="uploadBtn">
        <imageSelect :mode="modelParmas.mode as VideoMode" v-model="imageList" :storyboard-list="storyboardList" />
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
        @modeChange="modeChange"
        @durationUpdated="handleDurationUpdated" />
    </div>
    <div class="generate ac">
      <div class="prompt" v-if="currentTrack">
        <t-card :title="'#' + (activeTrackIndex + 1) + $t('workbench.generate.generateText')" header-bordered class="videoPrompt">
          <template #actions>
            <t-button size="small" class="genTextbtn" :loading="currentTrack.state == '生成中'" @click="genText">
              {{ $t("workbench.generate.generateText") }}
            </t-button>
          </template>
          <div class="promptData fc">
            <div class="promptInput" @focusout="handlePromptBlur">
              <promptEditor v-model="currentTrack.prompt" :references="references" :placeholder="$t('workbench.generate.promptPlaceholder')" />
            </div>
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
        @getData="getGenerateData" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Ref } from "vue";
import newTrack from "./components/track.vue";
import imageSelect from "./components/imageSelect.vue";
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

const { project } = storeToRefs(projectStore());
const episodesId = inject<Ref<number>>("episodesId")!;
const activeTrackIndex = ref(0);
const cacheStore = imageListCacheStore();
const generationIntents = createGenerationIntentStore<{ videoId: number }>();
const generateVideoPending = ref(false);
const promptMutationIntents = new Map<number, { signature: string; key: string }>();
const promptGenerationIntents = new Map<number, { signature: string; key: string }>();
const persistedTrackPrompts = new Map<number, string>();
const promptConflictVersions = new Map<number, number>();
const durationOverrides = useLocalStorage<Record<string, number>>(`toonflow:video-duration-overrides:${userStore().user?.id}:${project.value?.id}:${episodesId.value}`, {});
const { getCache, setCache, removeCache, initCacheFromTrackList, warmUpUrls } = cacheStore;
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
      currentTrack.value.medias = val as any;
      // 同步写入缓存
      const pid = project.value?.id;
      const sid = episodesId.value;
      const trackId = currentTrack.value.id;
      if (pid != null && sid != null && trackId != null) {
        setCache(pid, sid, trackId, val);
      }
    }
  },
});

function orderReferenceItems(items: UploadItem[]): UploadItem[] {
  // Reference order is semantic: in frame modes it identifies start/end,
  // and in multi-reference modes it determines @图片/@视频/@音频 numbering.
  return [...items];
}

function modeChange(newVal: string) {
  if (newVal == modelParmas.value.mode) return;
  if ((imageList.value.length || currentTrack.value?.prompt) && modelParmas.value.mode) {
    const dialog = DialogPlugin.confirm({
      header: $t("workbench.generate.modeChange"),
      body: $t("workbench.generate.modeChangeConfirm"),
      confirmBtn: $t("settings.generate.modelChnageSure"),
      cancelBtn: $t("settings.memory.msg.cancel"),
      onConfirm: async () => {
        imageList.value = [];
        currentTrack.value.prompt = "";
        dialog.destroy();
        modelParmas.value.mode = newVal;
      },
    });
  } else if (newVal) {
    modelParmas.value.mode = newVal;
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
  return modeOptions.value.mode
    ? modeOptions.value.mode.map((mode) =>
        Array.isArray(mode)
          ? { value: JSON.stringify(mode), label: mode.map((m) => parseRefLabel(m)).join(" + ") + "参考" }
          : { value: mode, label: modeLabelMap[mode] || mode },
      )
    : [];
});
const currentTrack = computed({
  get() {
    return trackList.value[activeTrackIndex.value];
  },
  set(val) {
    trackList.value[activeTrackIndex.value] = val;
  },
});

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
      modelParmas.value.mode = "";
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

      const currentParsed = parseMode(modelParmas.value.mode);
      const modeMatched =
        currentParsed !== null &&
        data.mode.some((m: VideoMode) => {
          if (Array.isArray(m) && Array.isArray(currentParsed)) {
            return JSON.stringify(m) === JSON.stringify(currentParsed);
          }
          return m == currentParsed;
        });
      if (!modeMatched) {
        const newMode = Array.isArray(data.mode[0]) ? JSON.stringify(data.mode[0]) : data.mode[0];
        modeChange(newMode);
      }
    });
  },
  { immediate: true },
);
function parseMode(value: string): VideoMode | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed as ReferenceType[];
  } catch {
    return value as Exclude<VideoMode, ReferenceType[]>;
  }
  return value as Exclude<VideoMode, ReferenceType[]>;
}
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

  return imageList.value
    .filter((item) => item.src)
    .map((item) => ({
      type: getFileTypeByExt(item.src) as "image" | "video" | "audio" | "text",
      src: item.src ?? "",
    }));
});

async function getGenerateData() {
  const { data } = await axios.post("/production/workbench/getGenerateData", {
    projectId: project.value?.id,
    scriptId: episodesId.value ?? 0,
  });

  storyboardList.value = data.storyboardList;
  // 优先使用本地缓存，没有缓存则用后端数据并写入缓存
  const pid = project.value?.id;
  const sid = episodesId.value;
  if (pid != null && sid != null) {
    // 先将没有缓存的轨道写入缓存（保留已有本地编辑）
    initCacheFromTrackList(pid, sid, data.trackList);
    // 批量向后端请求文件路径对应的完整 URL
    await warmUpUrls(pid, sid);
    // 将本地缓存回写到 trackList，确保优先使用缓存数据（src 已解析为完整 URL）
    data.trackList.forEach((track: TrackItem) => {
      if (track.id == null) return;
      const cached = getCache(pid, sid, track.id);
      if (cached?.length) {
        track.medias = cached as unknown as TrackMedia[];
      }
    });
    // 整体赋值触发响应式
    trackList.value = [...data.trackList];
    persistedTrackPrompts.clear();
    promptConflictVersions.clear();
    trackList.value.forEach((track) => persistedTrackPrompts.set(track.id, track.prompt ?? ""));
  }

  syncCurrentDuration();
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

async function handlePromptBlur() {
  const track = trackList.value[activeTrackIndex.value];
  if (track?.id == null) return;
  if (!Number.isSafeInteger(track.version) || track.version! < 0) {
    window.$message.error("轨道版本尚未加载，请刷新后重试");
    return;
  }
  const prompt = track.prompt ?? "";
  if (persistedTrackPrompts.get(track.id) === prompt && !promptMutationIntents.has(track.id)) return;
  if (promptConflictVersions.get(track.id) === track.version) {
    window.$message.error("轨道版本已冲突，已保留当前提示词，请先刷新");
    return;
  }
  const payload = {
    id: track.id,
    projectId: project.value?.id,
    scriptId: episodesId.value,
    prompt,
    expectedVersion: track.version,
  };
  const signature = JSON.stringify(payload);
  const previous = promptMutationIntents.get(track.id);
  const intent = previous?.signature === signature ? previous : { signature, key: createIdempotencyKey("track-prompt") };
  promptMutationIntents.set(track.id, intent);
  try {
    const response: any = await axios.post("/production/workbench/updateVideoPrompt", { ...payload, idempotencyKey: intent.key });
    if (track.version === payload.expectedVersion && Number.isSafeInteger(Number(response.version))) track.version = Number(response.version);
    persistedTrackPrompts.set(track.id, prompt);
    promptConflictVersions.delete(track.id);
    promptMutationIntents.delete(track.id);
  } catch (error: any) {
    const status = Number(error?.status);
    if (status === 409) {
      promptConflictVersions.set(track.id, Number(payload.expectedVersion));
      window.$message.error("轨道已被其他成员修改，已保留当前提示词，请刷新后再确认");
    }
    else window.$message.error(error?.message ?? "轨道提示词保存失败");
    if (Number.isSafeInteger(status) && status < 500) promptMutationIntents.delete(track.id);
  }
}

/** 单个轨道生成提示词 */
async function genText() {
  const track = currentTrack.value;
  if (track.id == null || track.state === "生成中") return;
  let info: { id: number; sources: string; fileType?: string }[] = [];
  const currentTrackId = track.id;
  const rawMedias = (track.medias ?? []) as UploadItem[];
  if (modelParmas.value.mode == "text") {
    info = rawMedias.map(({ id, sources, fileType }) => ({ id: id!, sources, fileType }));
  } else {
    const frameMode = ["startEndRequired", "endFrameOptional", "startFrameOptional"];
    const preSliced = frameMode.includes(modelParmas.value.mode)
      ? rawMedias.slice(0, 2)
      : modelParmas.value.mode === "singleImage"
        ? rawMedias.slice(0, 1)
        : rawMedias;
    const filtered = preSliced
      .filter((item) => typeof item.id === "number" && !isNaN(item.id))
      .map(({ id, sources, fileType }) => ({ id: id!, sources, fileType }));
    if (frameMode.includes(modelParmas.value.mode)) info = filtered.slice(0, 2);
    else if (modelParmas.value.mode === "singleImage") info = filtered.slice(0, 1);
    else info = filtered;
  }
  track.state = "生成中";
  track.promptJobId = null;
  const promptPayload = { projectId: project.value?.id, scriptId: episodesId.value, trackId: currentTrackId, info, model: modelParmas.value.model, mode: modelParmas.value.mode, expectedVersion: track.version };
  const promptSignature = JSON.stringify(promptPayload);
  const previousIntent = promptGenerationIntents.get(currentTrackId);
  const promptIntent = previousIntent?.signature === promptSignature ? previousIntent : { signature: promptSignature, key: createIdempotencyKey("video-prompt") };
  promptGenerationIntents.set(currentTrackId, promptIntent);
  try {
    const { data } = await axios.post("/production/workbench/generateVideoPrompt", { ...promptPayload, idempotencyKey: promptIntent.key });
    if (data && typeof data === "object" && (data.state === "running" || data.state === "queued")) {
      track.promptJobId = data.jobId ?? null;
      return;
    }
    track.prompt = data;
    track.state = "已完成";
    promptGenerationIntents.delete(currentTrackId);
  } catch (e) {
    track.state = "生成失败";
    window.$message.error((e as Error)?.message ?? "提示词生成失败");
    const status = Number((e as any)?.status ?? (e as any)?.response?.status);
    if (Number.isSafeInteger(status) && status < 500) promptGenerationIntents.delete(currentTrackId);
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
  // imageList 是基于 currentTrack.medias 的计算属性，切换轨道后自动切换数据
  if (modelParmas.value.mode == "singleImage" && imageList.value.length > 1) {
    imageList.value = imageList.value.slice(0, 1);
  }
  syncCurrentDuration();
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
  if (!modelParmas.value.mode) modelParmas.value.mode = project.value?.mode || "";
  getGenerateData();
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
      const sourceDuration = currentTrackSourceDuration.value;
      const durationChoice = resolveDuration(sourceDuration);
      if (durationChoice.duration == null) {
        window.$message.warning(`当前片段脚本时长 ${sourceDuration}s 超出模型支持范围，请拆分分镜或选择支持更长时长的模型`);
        return;
      }
      const selectedDuration = resolveDuration(modelParmas.value.duration);
      if (selectedDuration.duration !== modelParmas.value.duration || modelParmas.value.duration < durationChoice.duration! || !supportsResolution(modelParmas.value.duration)) {
        window.$message.warning("当前片段的时长或清晰度不是模型支持的组合，请从顶部下拉重新选择");
        return;
      }
      const requestData = {
        projectId: project.value?.id,
        scriptId: episodesId.value,
        uploadData:
          modelParmas.value.mode === "text"
            ? []
            : (() => {
                const frameMode = ["startEndRequired", "endFrameOptional", "startFrameOptional"];
                const preSliced = frameMode.includes(modelParmas.value.mode)
                  ? imageList.value.slice(0, 2)
                  : modelParmas.value.mode === "singleImage"
                    ? imageList.value.slice(0, 1)
                    : imageList.value;
                const filtered = preSliced
                  .filter((item) => Boolean(item.src) && typeof item.id === "number" && !isNaN(item.id))
                  .map(({ id, sources, fileType }) => ({ id, sources, fileType }));
                if (frameMode.includes(modelParmas.value.mode)) return filtered.slice(0, 2);
                if (modelParmas.value.mode === "singleImage") return filtered.slice(0, 1);
                return filtered;
              })(),
        prompt: track.prompt,
        model: modelParmas.value.model,
        mode: modelParmas.value.mode,
        resolution: modelParmas.value.resolution,
        // A manually selected supported value applies to this active track only.
        duration: modelParmas.value.duration,
        audio: modelParmas.value.audio,
        trackId: track.id,
      };
      const scope = `single:${String(project.value?.id ?? "")}:${String(episodesId.value ?? "")}:${String(track.id)}`;
      generateVideoPending.value = true;
      try {
        const { videoId } = await generationIntents.run(scope, requestData, async (idempotencyKey) => {
          const { data } = await axios.post("/production/workbench/generateVideo", { ...requestData, idempotencyKey });
          return { videoId: data.videoId };
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
  return trackList.value.map((track) => track.id);
});
/** 查询所有视频列表，并检测生成完成/失败状态 */
async function getVideoList() {
  const { data } = await axios.post("/production/workbench/checkVideoStateList", {
    projectId: project.value?.id,
    scriptId: episodesId.value ?? 0,
    videoIds: hasGenerateVideoIds.value,
  });
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
  if (promptPollInFlight || !hasGeneratePromptIds.value.length) return;
  const requestedIds = new Set(hasGeneratePromptIds.value);
  promptPollInFlight = true;
  try {
    const { data } = await axios.post("/production/workbench/checkVideoPrompt", {
      projectId: project.value?.id,
      scriptId: episodesId.value ?? 0,
      trackIds: [...requestedIds],
      jobIds: trackList.value.filter((track) => track.state === "生成中" && track.promptJobId).map((track) => track.promptJobId),
    });
    if (Array.isArray(data)) {
      const returnedIds = new Set<number>();
      data.forEach((item: { id: number; jobId?: string; state: "生成中" | "未生成" | "已完成" | "生成失败"; prompt?: string; reason?: string; version?: number }) => {
        const findData = trackList.value.find((t) => t.id == item.id);
        returnedIds.add(Number(item.id));
        if (findData) {
          const remoteVersion = Number(item.version);
          const localVersion = Number(findData.version ?? 0);
          // A save may have completed while this read was in flight.
          if (Number.isSafeInteger(remoteVersion) && remoteVersion < localVersion) return;
          const previousState = findData.state;
          const previousJobId = findData.promptJobId;
          const localDraft = findData.prompt !== (persistedTrackPrompts.get(findData.id) ?? "");
          if (item.jobId) findData.promptJobId = item.jobId;
          if (findData.state !== item.state) findData.state = item.state;
          if ((item.state === "已完成" || item.state === "生成中") && !localDraft && item.prompt !== findData.prompt) findData.prompt = item?.prompt ?? "";
          const remoteVersionChanged = Number.isSafeInteger(remoteVersion) && remoteVersion >= 0 && findData.version !== remoteVersion;
          if (item.prompt != null && (item.state === "已完成" || item.state === "生成失败") && !localDraft) persistedTrackPrompts.set(findData.id, item.prompt);
          if (remoteVersionChanged && localDraft) {
            // Keep the local draft anchored to its original version. Advancing it
            // would let the next blur overwrite a newer remote edit.
            promptConflictVersions.set(findData.id, localVersion);
          } else if (remoteVersionChanged) findData.version = remoteVersion;
          if (findData.reason !== (item?.reason ?? "")) findData.reason = item?.reason ?? "";
          if (item.state === "已完成" || item.state === "生成失败") {
            const intent = promptGenerationIntents.get(findData.id);
            if (intent) promptGenerationIntents.delete(findData.id);
          }
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
  stopPoll();
  stopPromptPoll();
});
</script>

<style lang="scss" scoped>
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
