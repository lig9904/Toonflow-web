export interface VideoPromptDraftRecord {
  text: string;
  baseVersion: number | null;
  baseModeIntentRevision: number | null;
  baseSavedPrompt: string;
  baselineUnknown?: boolean;
}

export interface VideoPromptServerBaseline {
  version: number;
  modeIntentRevision: number;
  savedPrompt: string;
}

export function normalizeVideoPromptDraft(value: unknown): VideoPromptDraftRecord | undefined {
  if (typeof value === "string") {
    return { text: value, baseVersion: null, baseModeIntentRevision: null, baseSavedPrompt: "", baselineUnknown: true };
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<VideoPromptDraftRecord>;
  if (typeof record.text !== "string") return undefined;
  return {
    text: record.text,
    baseVersion: Number.isSafeInteger(record.baseVersion) ? Number(record.baseVersion) : null,
    baseModeIntentRevision: Number.isSafeInteger(record.baseModeIntentRevision) ? Number(record.baseModeIntentRevision) : null,
    baseSavedPrompt: typeof record.baseSavedPrompt === "string" ? record.baseSavedPrompt : "",
    ...(record.baselineUnknown ? { baselineUnknown: true } : {}),
  };
}

export function createVideoPromptDraft(text: string, baseline: VideoPromptServerBaseline): VideoPromptDraftRecord {
  return { text, baseVersion: baseline.version, baseModeIntentRevision: baseline.modeIntentRevision, baseSavedPrompt: baseline.savedPrompt };
}

export function videoPromptDraftConflicts(record: VideoPromptDraftRecord, baseline: VideoPromptServerBaseline): boolean {
  return record.baselineUnknown === true
    || record.baseVersion !== baseline.version
    || record.baseModeIntentRevision !== baseline.modeIntentRevision
    || record.baseSavedPrompt !== baseline.savedPrompt;
}

export function rebaseVideoPromptDraft(record: VideoPromptDraftRecord, baseline: VideoPromptServerBaseline): VideoPromptDraftRecord {
  return createVideoPromptDraft(record.text, baseline);
}
