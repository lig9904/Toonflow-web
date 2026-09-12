export interface TrackCardInput {
  id: number;
  storyboardIds?: number[];
  storyboardCount?: number;
  cardKind?: "storyboard" | "custom";
  deleteAction?: "deleteStoryboard" | "deleteTrack";
  migrationRequired?: boolean;
  mutationBlockedReason?: string | null;
}

export interface StoryboardCardInput {
  id: number;
  index: number;
  version?: number;
  trackId?: unknown;
}

export interface TrackCardPresentation {
  title: string;
  kindLabel: string;
  deleteLabel?: "删除分镜" | "删除片段";
  storyboardId?: number;
  storyboardVersion?: number;
  mutationBlockedReason?: string;
}

export interface CardMutationScope {
  projectId: number;
  scriptId: number;
  sequence: number;
}

export interface FrozenCardMutation {
  action: "deleteStoryboard" | "deleteTrack" | "clearTrackVideos" | "reloadStoryboardReferences";
  endpoint: string;
  trackId: number;
  payload: Readonly<Record<string, number>>;
}

export function buildTrackCardPresentation(track: TrackCardInput, storyboards: readonly StoryboardCardInput[]): TrackCardPresentation {
  const storyboardIds = [...new Set((track.storyboardIds ?? []).filter((id) => Number.isSafeInteger(id) && id > 0))];
  const storyboardCount = Number.isSafeInteger(track.storyboardCount) ? Number(track.storyboardCount) : storyboardIds.length;
  if (track.migrationRequired || storyboardCount > 1) {
    return {
      title: `历史合并片段 · ${storyboardCount}镜`,
      kindLabel: "等待拆分",
      mutationBlockedReason: track.mutationBlockedReason || "该片段仍关联多个分镜，完成一镜一片段迁移前不能删除",
    };
  }
  if (track.cardKind === "custom" || (storyboardCount === 0 && track.deleteAction === "deleteTrack")) {
    return {
      title: `自建片段 T${track.id}`,
      kindLabel: "无分镜",
      deleteLabel: "删除片段",
      ...(track.mutationBlockedReason ? { mutationBlockedReason: track.mutationBlockedReason } : {}),
    };
  }
  const storyboardId = storyboardIds[0];
  const storyboard = storyboards.find((item) => item.id === storyboardId);
  if (track.cardKind === "storyboard" && storyboardId && storyboard) {
    return {
      title: `S${String(Number(storyboard.index) + 1).padStart(2, "0")}`,
      kindLabel: "分镜",
      deleteLabel: "删除分镜",
      storyboardId,
      storyboardVersion: Number(storyboard.version ?? 0),
      ...(track.mutationBlockedReason ? { mutationBlockedReason: track.mutationBlockedReason } : {}),
    };
  }
  return {
    title: `片段 T${track.id}`,
    kindLabel: "数据待刷新",
    mutationBlockedReason: track.mutationBlockedReason || "片段与分镜关系尚未完整加载，请刷新后重试",
  };
}

export function freezeDeleteCardMutation(input: {
  scope: CardMutationScope;
  trackId: number;
  trackVersion: number;
  card: TrackCardPresentation;
}): FrozenCardMutation | undefined {
  if (input.card.mutationBlockedReason || !input.card.deleteLabel) return undefined;
  if (input.card.deleteLabel === "删除分镜") {
    const storyboardVersion = input.card.storyboardVersion;
    if (!input.card.storyboardId || !Number.isSafeInteger(storyboardVersion)) return undefined;
    return Object.freeze({
      action: "deleteStoryboard" as const,
      endpoint: "/production/workbench/deleteStoryboardTrack",
      trackId: input.trackId,
      payload: Object.freeze({
        projectId: input.scope.projectId,
        scriptId: input.scope.scriptId,
        trackId: input.trackId,
        storyboardId: input.card.storyboardId,
        expectedTrackVersion: input.trackVersion,
        expectedStoryboardVersion: storyboardVersion!,
      }),
    });
  }
  return Object.freeze({
    action: "deleteTrack" as const,
    endpoint: "/production/workbench/deleteTrack",
    trackId: input.trackId,
    payload: Object.freeze({ projectId: input.scope.projectId, scriptId: input.scope.scriptId, id: input.trackId, expectedVersion: input.trackVersion }),
  });
}

export function freezeClearVideosMutation(input: { scope: CardMutationScope; trackId: number; trackVersion: number }): FrozenCardMutation {
  return Object.freeze({
    action: "clearTrackVideos" as const,
    endpoint: "/production/workbench/clearTrackVideos",
    trackId: input.trackId,
    payload: Object.freeze({ projectId: input.scope.projectId, scriptId: input.scope.scriptId, trackId: input.trackId, expectedTrackVersion: input.trackVersion }),
  });
}

export function freezeReloadStoryboardMutation(input: {
  scope: CardMutationScope;
  trackId: number;
  trackVersion: number;
  storyboardId: number;
  storyboardVersion: number;
  modeIntentRevision: number;
}): FrozenCardMutation {
  return Object.freeze({
    action: "reloadStoryboardReferences" as const,
    endpoint: "/production/workbench/reloadStoryboardTrackReferences",
    trackId: input.trackId,
    payload: Object.freeze({
      projectId: input.scope.projectId,
      scriptId: input.scope.scriptId,
      trackId: input.trackId,
      storyboardId: input.storyboardId,
      expectedTrackVersion: input.trackVersion,
      expectedStoryboardVersion: input.storyboardVersion,
      expectedModeIntentRevision: input.modeIntentRevision,
    }),
  });
}

export function sameCardMutationScope(frozen: CardMutationScope, current: CardMutationScope | undefined): boolean {
  return current != null && frozen.projectId === current.projectId && frozen.scriptId === current.scriptId && frozen.sequence === current.sequence;
}

export function singleFlight<T>(task: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | undefined;
  return () => running ??= task();
}
