export const builtinAgentTypes = ["scriptAgent", "productionAgent"] as const;
export type BuiltinAgentType = (typeof builtinAgentTypes)[number];

export const builtinRunStatuses = [
  "queued",
  "running",
  "waiting_human",
  "paused",
  "succeeded",
  "failed",
  "reconciliation_required",
  "cancelled",
] as const;
export type BuiltinRunStatus = (typeof builtinRunStatuses)[number];
export type BuiltinControlAction = "pause" | "resume" | "cancel" | "takeover";

export interface BuiltinRunLimits {
  maxModelCalls: number;
  maxToolSteps: number;
  maxOutputTokens: number;
  maxImageGenerations: number;
  maxVideoGenerations: number;
}

export const defaultBuiltinRunLimits: BuiltinRunLimits = {
  maxModelCalls: 12,
  maxToolSteps: 40,
  maxOutputTokens: 12000,
  maxImageGenerations: 0,
  maxVideoGenerations: 0,
};

export interface BuiltinRunView {
  id: string;
  agentType: BuiltinAgentType;
  projectId: number | null;
  scriptId: number | null;
  requestedBy: number;
  executionUserId?: number;
  prompt: string;
  status: BuiltinRunStatus;
  version: number;
  lastSequence: number;
  currentStep: string | null;
  limits: BuiltinRunLimits;
  modelCalls: number;
  toolSteps: number;
  outputTokens?: number;
  imageGenerations?: number;
  videoGenerations?: number;
  createdAt: number;
  updatedAt: number;
  errorCode: string | null;
  errorMessage: string | null;
  result: unknown;
}

export interface BuiltinRunEvent {
  runId: string;
  sequence: number;
  type: string;
  data: unknown;
  createdAt: number;
}

export interface BuiltinRunScope {
  agentType: BuiltinAgentType;
  projectId: number | null;
  scriptId?: number | null;
}

export interface BuiltinStartInput extends BuiltinRunScope {
  prompt: string;
  limits?: Partial<BuiltinRunLimits>;
}

export interface BuiltinDisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  sequence: number;
  createdAt: number;
  artifact?: BuiltinArtifactView;
}

export type BuiltinArtifactTarget = "novel" | "script" | "assets" | "planning" | "storyboards" | "images" | "videos";

export interface BuiltinArtifactView {
  target: BuiltinArtifactTarget;
  title: string;
  detail: string;
  actionLabel: string;
  selected?: boolean;
}

export interface BuiltinRunListResponse {
  runs: BuiltinRunView[];
}

export interface BuiltinRunGetResponse {
  run: BuiltinRunView;
  events: BuiltinRunEvent[];
  nextSequence: number;
}

export interface BuiltinRunStartResponse {
  run: BuiltinRunView;
  reused: boolean;
}

export interface BuiltinRunControlResponse {
  run: BuiltinRunView;
}

export function builtinScopeKey(scope: BuiltinRunScope): string {
  return `${scope.agentType}:${scope.projectId ?? "project"}:${scope.scriptId ?? "all"}`;
}

export function isBuiltinRunTerminal(status: BuiltinRunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "reconciliation_required" || status === "cancelled";
}

export function stableBuiltinValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableBuiltinValue);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const item = (value as Record<string, unknown>)[key];
        if (item !== undefined) result[key] = stableBuiltinValue(item);
        return result;
      }, {});
  }
  return value;
}

export function builtinFingerprint(value: unknown): string {
  return JSON.stringify(stableBuiltinValue(value));
}

export function dedupeBuiltinRunEvents(existing: BuiltinRunEvent[], incoming: BuiltinRunEvent[]): BuiltinRunEvent[] {
  const bySequence = new Map(existing.map((event) => [event.sequence, event]));
  incoming.forEach((event) => bySequence.set(event.sequence, event));
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
}

export function createBuiltinIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `builtin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Convert event data to plain text; templates and raw HTML are never rendered. */
export function builtinEventText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.message === "string") return record.message;
    if (typeof record.reason === "string") return record.reason;
    try {
      return JSON.stringify(stableBuiltinValue(data));
    } catch {
      return "";
    }
  }
  return data == null ? "" : String(data);
}

export function builtinHumanQuestion(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  for (const key of ["question", "prompt", "message", "text"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return "";
}

function eventRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

function positiveIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter((item) => Number.isSafeInteger(item) && item > 0);
}

export function builtinArtifactView(data: unknown): BuiltinArtifactView {
  const record = eventRecord(data);
  const kind = typeof record.kind === "string" ? record.kind : "artifact";
  const ids = positiveIds(record.ids);
  const created = positiveIds(record.createdIds);
  const updated = positiveIds(record.updatedIds);
  const selected = record.selected !== false;
  if (kind === "scriptWorkspace") {
    return { target: "script", title: "剧本已保存", detail: ids.length ? `共 ${ids.length} 集` : "剧本工作区已更新", actionLabel: "查看剧本" };
  }
  if (kind === "novelEvents") {
    const novelIds = positiveIds(record.novelIds);
    return { target: "novel", title: "原文事件已保存", detail: novelIds.length ? `共 ${novelIds.length} 章` : "事件提取结果已更新", actionLabel: "查看原文事件" };
  }
  if (kind === "assets") {
    const changes = [created.length ? `新增 ${created.length} 项` : "", updated.length ? `更新 ${updated.length} 项` : ""].filter(Boolean).join("，");
    return { target: "assets", title: "素材已保存", detail: changes || (ids.length ? `共 ${ids.length} 项` : "素材库已更新"), actionLabel: "查看素材" };
  }
  if (kind === "productionPlanning") {
    return { target: "planning", title: "制作规划已保存", detail: record.version == null ? "当前剧集的制作规划已更新" : `版本 ${String(record.version)}`, actionLabel: "查看制作规划" };
  }
  if (kind === "storyboards") {
    return { target: "storyboards", title: "分镜已保存", detail: ids.length ? `共 ${ids.length} 个分镜` : "分镜内容已更新", actionLabel: "查看分镜" };
  }
  if (kind === "image") {
    const target = record.targetKind === "asset" ? "素材" : "分镜";
    return {
      target: record.targetKind === "asset" ? "assets" : "images",
      title: `${target}图片已生成`,
      detail: selected ? "已应用到当前内容" : "待选择，尚未应用到当前内容",
      actionLabel: record.targetKind === "asset" ? "查看素材" : "查看分镜",
      selected,
    };
  }
  if (kind === "video") {
    return { target: "videos", title: "视频已生成", detail: selected ? "已应用到当前轨道" : "待选择，尚未应用到当前轨道", actionLabel: "查看视频", selected };
  }
  return { target: "planning", title: "内容已保存", detail: "当前项目内容已更新", actionLabel: "查看制作内容" };
}

function messageIdentity(event: BuiltinRunEvent): string | undefined {
  const record = eventRecord(event.data);
  for (const key of ["messageId", "message_id", "id"]) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return undefined;
}

/** Maps a durable run snapshot to the main Chat timeline. Replaying the same events is idempotent. */
export function builtinRunMessages(run: BuiltinRunView, events: BuiltinRunEvent[]): BuiltinDisplayMessage[] {
  const ordered = dedupeBuiltinRunEvents([], events.filter((event) => event.runId === run.id));
  const result: BuiltinDisplayMessage[] = [{
    id: `builtin:${run.id}:prompt`,
    role: "user",
    text: run.prompt,
    sequence: 0,
    createdAt: run.createdAt,
  }];
  const openByIdentity = new Map<string, BuiltinDisplayMessage>();
  let anonymousOpen: BuiltinDisplayMessage | undefined;
  for (const event of ordered) {
    if (event.type === "message.delta" || event.type === "message.completed") {
      const text = builtinEventText(event.data);
      const identity = messageIdentity(event);
      let message = identity ? openByIdentity.get(identity) : anonymousOpen;
      if (!message) {
        message = { id: `builtin:${run.id}:message:${identity ?? event.sequence}`, role: "assistant", text: "", sequence: event.sequence, createdAt: event.createdAt };
        result.push(message);
        if (identity) openByIdentity.set(identity, message);
        else anonymousOpen = message;
      }
      if (event.type === "message.delta") message.text += text;
      else {
        if (text) message.text = text;
        message.sequence = event.sequence;
        message.createdAt = event.createdAt;
        if (identity) openByIdentity.delete(identity);
        else anonymousOpen = undefined;
      }
      continue;
    }
    if (event.type === "artifact.saved") {
      const artifact = builtinArtifactView(event.data);
      result.push({
        id: `builtin:${run.id}:artifact:${event.sequence}`,
        role: "assistant",
        text: `${artifact.title}。${artifact.detail}`,
        artifact,
        sequence: event.sequence,
        createdAt: event.createdAt,
      });
      continue;
    }
    if (event.type === "run.error") {
      const text = builtinEventText(event.data) || run.errorMessage || "运行失败";
      result.push({ id: `builtin:${run.id}:error:${event.sequence}`, role: "system", text, sequence: event.sequence, createdAt: event.createdAt });
    }
  }
  const seenAssistantText = new Set<string>();
  return result.filter((message) => {
    const text = message.text.trim();
    if (!text && !message.artifact) return false;
    if (message.role !== "assistant" || message.artifact || !text) return true;
    if (seenAssistantText.has(text)) return false;
    seenAssistantText.add(text);
    return true;
  });
}
