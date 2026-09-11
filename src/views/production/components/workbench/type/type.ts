type ReferenceType = "videoReference" | "imageReference" | "audioReference" | "textReference";
type Type = "imageReference" | "startImage" | "endImage" | "videoReference" | "audioReference";
type VideoMode = "singleImage" | "startEndRequired" | "endFrameOptional" | "startFrameOptional" | "text" | ReferenceType[];
type VideoReferencePurpose = "first_frame" | "last_frame" | "identity_reference" | "style_reference" | "motion_reference" | "audio_reference";
type VideoModeIntent = "auto" | VideoMode;

interface UploadItemBase {
  fileType: "image" | "video" | "audio";
  id: number | null;
  src?: string;
  prompt?: string;
  purpose?: VideoReferencePurpose;
  assetType?: "role" | "tool" | "scene" | "clip" | "audio";
}

interface UploadItemStoryboard extends UploadItemBase {
  sources: "storyboard";
  index: number;
}
interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  referenceRatio?: "adaptive";
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}
interface UploadItemAssets extends UploadItemBase {
  sources: "assets";
}

type UploadItem = UploadItemStoryboard | UploadItemAssets;

interface StoryboardItem {
  src: string;
  createTime?: number | null;
  duration?: string | null;
  flowId?: number | null;
  id: number;
  index: number;
  projectId?: number | null;
  prompt?: string | null;
  reason?: string | null;
  scriptId?: number | null;
  state?: string | null;
  trackId?: number | null;
  videoDesc?: string | null;
}

interface VideoPromptReview {
  status: "passed" | "issues" | "failed" | "pending" | "skipped";
  findings: Array<{code: string; severity: string; message: string; shotId?: number}>;
  summary: string; revised: boolean; reviewedAt: number;
}

interface VideoModeResolutionView {
  trackId: number;
  modeIntent: VideoModeIntent;
  modeIntentRevision: number;
  resolvedMode?: VideoMode | null;
  resolvedReferences: Array<{ id: number; sources: "storyboard" | "assets"; fileType?: "image" | "video" | "audio"; purpose: VideoReferencePurpose }>;
  referenceSummary?: { total: number; image: number; video: number; audio: number; purposes: Record<string, number> } | null;
  compatibility: { ok: boolean; code?: string; message?: string };
}

interface TrackItem {
  promptReview?: VideoPromptReview | null;
  promptReviewPrompt?: string;
  promptReviewContext?: string;
  promptGenerationContext?: {
    trackId: number;
    model: string;
    modeIntentRevision: number;
    resolvedMode?: VideoMode;
    generation: { duration: number; resolution: string; audio: boolean };
    references: Array<{ id: number; sources: "storyboard" | "assets"; fileType?: "image" | "video" | "audio"; purpose?: VideoReferencePurpose }>;
  };
  id: number;
  version?: number;
  prompt: string;
  promptJobId?: string | null;
  state: "未生成" | "生成中" | "已完成" | "生成失败";
  reason?: string;
  selectVideoId?: number | null;
  medias: TrackMedia[];
  videoList: VideoItem[];
  duration: number;
  modeIntent?: VideoModeIntent;
  modeIntentRevision?: number;
  promptReferenceRevision?: number;
  references?: Array<{ id: number; sources: "storyboard" | "assets"; fileType?: "image" | "video" | "audio"; purpose?: VideoReferencePurpose }>;
  referencesInitialized?: boolean;
  modeResolution?: VideoModeResolutionView;
  resolvedMode?: VideoMode;
  resolvedReferences?: Array<{ id: number; sources: "storyboard" | "assets"; fileType?: "image" | "video" | "audio"; purpose: VideoReferencePurpose }>;
  referenceSummary?: { total: number; image: number; video: number; audio: number; purposes: Record<string, number> };
  compatibility?: { ok: boolean; code?: string; message?: string };
  referencesNeedReview?: boolean;
}

interface VideoItem {
  id: number;
  jobId?: number;
  downloadRetryable?: boolean;
  src: string;
  state: "未生成" | "生成中" | "已完成" | "生成成功" | "生成失败" | "需人工核对";
  errorReason?: string | null;
}
interface TrackMediaBase {
  src: string;
  id?: number;
  prompt?: string;
  fileType: "image" | "video" | "audio";
  slotType?: Type; // 本地保存时记录的 slot 类型，用于切换轨道时精确还原位置
  purpose?: VideoReferencePurpose;
  assetType?: "role" | "tool" | "scene" | "clip" | "audio";
  index?: number;
}

interface TrackMediaStoryboard extends TrackMediaBase {
  sources: "storyboard";
  index?: number;
}

interface TrackMediaAssets extends TrackMediaBase {
  sources: "assets";
}

interface TrackMediaUnknown extends TrackMediaBase {
  sources?: string;
}

type TrackMedia = TrackMediaStoryboard | TrackMediaAssets | TrackMediaUnknown;

interface HistoryVideoItem {
  errorReason?: string | null;
  src: string;
  id: number;
  duration?: number | string | null;
  projectId?: number | null;
  scriptId?: number | null;
  state?: string | null;
  time?: number | null;
  videoTrackId?: number | null;
  version?: number;
  jobId?: number;
  downloadRetryable?: boolean;
}
interface ModelSetting {
  mode: string;
  model: string;
  resolution: string;
  duration: number;
  audio: boolean;
}
