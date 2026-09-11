export const VIDEO_REFERENCE_PURPOSES = [
  "first_frame",
  "last_frame",
  "identity_reference",
  "style_reference",
  "motion_reference",
  "audio_reference",
] as const;

export type VideoReferencePurpose = (typeof VIDEO_REFERENCE_PURPOSES)[number];
export type VideoModeIntent = "auto" | string | string[];

export interface VideoReferenceInput {
  id?: unknown;
  sources?: unknown;
  fileType?: "image" | "video" | "audio";
  purpose?: VideoReferencePurpose;
  assetType?: "role" | "tool" | "scene" | "clip" | "audio";
  slotType?: "imageReference" | "startImage" | "endImage" | "videoReference" | "audioReference";
  src?: string;
}

export interface VideoReference {
  id: number;
  sources: "storyboard" | "assets";
  fileType?: "image" | "video" | "audio";
  purpose?: VideoReferencePurpose;
}

export function parseModeIntentValue(value: unknown): VideoModeIntent {
  if (Array.isArray(value)) return value.map(String);
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "auto";
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // A scalar mode is already the persisted wire value.
  }
  return text;
}

export function modeIntentSelectValue(value: unknown): string {
  const parsed = parseModeIntentValue(value);
  return Array.isArray(parsed) ? JSON.stringify(parsed) : parsed;
}

export function modeIntentForTrack(track: { modeIntent?: unknown }): VideoModeIntent {
  if (track.modeIntent != null && track.modeIntent !== "") return parseModeIntentValue(track.modeIntent);
  return "auto";
}

function safePositiveId(value: unknown): number | undefined {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export function defaultReferencePurpose(
  item: VideoReferenceInput,
  modeIntent: VideoModeIntent,
  semanticIndex: number,
  unlabelledStoryboardCount = 1,
): VideoReferencePurpose {
  if (item.purpose && VIDEO_REFERENCE_PURPOSES.includes(item.purpose)) return item.purpose;
  const mode = Array.isArray(modeIntent) ? "multiReference" : modeIntent;
  if (item.slotType === "startImage") return "first_frame";
  if (item.slotType === "endImage") return "last_frame";
  if (item.fileType === "audio" || item.assetType === "audio") return "audio_reference";
  if (item.fileType === "video") return "motion_reference";
  if (item.assetType === "scene") return "style_reference";
  if (item.assetType === "role" || item.assetType === "tool") return "identity_reference";
  if (mode === "singleImage" && semanticIndex === 0) return "first_frame";
  if (item.sources === "storyboard") {
    const loneFrameMode = mode === "auto" || mode === "singleImage";
    return loneFrameMode && unlabelledStoryboardCount === 1 && semanticIndex === 0 ? "first_frame" : "style_reference";
  }
  return "identity_reference";
}

export function buildVideoReferences(
  items: readonly VideoReferenceInput[],
  modeIntent: VideoModeIntent,
  requireSrc = false,
): VideoReference[] {
  const references: VideoReference[] = [];
  for (const item of items) {
    const id = safePositiveId(item.id);
    if (id == null || (item.sources !== "storyboard" && item.sources !== "assets")) continue;
    if (requireSrc && !item.src) continue;
    const purpose = item.purpose
      ?? (item.slotType === "startImage" ? "first_frame" : item.slotType === "endImage" ? "last_frame" : undefined)
      ?? (item.sources === "assets" ? defaultReferencePurpose(item, modeIntent, references.length) : undefined);
    references.push({
      id,
      sources: item.sources,
      fileType: item.fileType,
      ...(purpose ? { purpose } : {}),
    });
  }
  return references;
}

export function referenceSignature(references: readonly VideoReference[]): string {
  return JSON.stringify(references.map(({ id, sources, fileType, purpose }) => ({ id, sources, fileType, purpose })));
}

export function restoreReferenceSelection(
  items: readonly VideoReferenceInput[],
  references: readonly VideoReference[],
): VideoReferenceInput[] {
  const pools = new Map<string, VideoReferenceInput[]>();
  for (const item of items) {
    const key = `${item.sources}:${String(item.id)}`;
    pools.set(key, [...(pools.get(key) ?? []), item]);
  }
  return references.map((reference) => {
    const key = `${reference.sources}:${reference.id}`;
    const item = pools.get(key)?.shift();
    return { ...(item ?? { src: "" }), ...reference };
  });
}

export function initialReferenceSelection(
  inventory: readonly VideoReferenceInput[],
  serverReferences: readonly VideoReference[],
  options: { referencesInitialized: boolean; userEditedCache: boolean },
): VideoReferenceInput[] {
  if (!options.referencesInitialized && options.userEditedCache) return [...inventory];
  return restoreReferenceSelection(inventory, serverReferences);
}

export function referencesNeedReview(prompt: unknown, promptReferenceRevision: unknown, selectionRevision: unknown): boolean {
  if (typeof prompt !== "string" || !prompt.trim()) return false;
  const promptRevision = Number(promptReferenceRevision);
  const currentRevision = Number(selectionRevision);
  return Number.isSafeInteger(promptRevision) && Number.isSafeInteger(currentRevision) && promptRevision !== currentRevision;
}

export function videoGenerationIntentPayload(input: {
  trackId: number;
  prompt: string;
  references: readonly VideoReference[];
  modeIntentRevision: number;
  model: string;
  resolution: string;
  audio: boolean;
  duration: number;
}) {
  return {
    trackId: input.trackId,
    prompt: input.prompt,
    references: input.references,
    modeIntentRevision: input.modeIntentRevision,
    model: input.model,
    resolution: input.resolution,
    audio: input.audio,
    duration: input.duration,
  };
}

export function captureVideoGenerationSettings(input: {
  model: unknown;
  resolution: unknown;
  audio: unknown;
  duration: unknown;
}) {
  return Object.freeze({
    model: String(input.model ?? ""),
    resolution: String(input.resolution ?? ""),
    audio: Boolean(input.audio),
    duration: Number(input.duration),
  });
}


export function videoModeLabel(mode: unknown): string {
  const labels: Record<string, string> = {
    auto: "自动匹配",
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
  const parsed = parseModeIntentValue(mode);
  if (Array.isArray(parsed)) return `${parsed.map((part) => videoModeLabel(part)).join(" + ")}参考`;
  const match = parsed.match(/^(videoReference|imageReference|audioReference|textReference):(\d+)$/);
  return match ? `${labels[match[1]] ?? match[1]} ×${match[2]}` : (labels[parsed] ?? parsed);
}

export function purposeLabel(purpose: VideoReferencePurpose): string {
  return {
    first_frame: "首帧",
    last_frame: "尾帧",
    identity_reference: "角色/物体参考",
    style_reference: "场景/风格参考",
    motion_reference: "动作参考",
    audio_reference: "音频参考",
  }[purpose];
}
