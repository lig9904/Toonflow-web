export interface GenerateScope {
  projectId: number;
  scriptId: number;
  sequence: number;
}

export function positiveId(value: unknown): number | undefined {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

export function captureGenerateScope(projectId: unknown, scriptId: unknown, sequence: number): GenerateScope | undefined {
  const pid = positiveId(projectId);
  const sid = positiveId(scriptId);
  return pid == null || sid == null ? undefined : { projectId: pid, scriptId: sid, sequence };
}

export function sameGenerateScope(scope: GenerateScope | undefined, projectId: unknown, scriptId: unknown, sequence: number, disposed = false): boolean {
  if (!scope || disposed) return false;
  return scope.sequence === sequence && scope.projectId === positiveId(projectId) && scope.scriptId === positiveId(scriptId);
}

export function validTrackIds(ids: readonly unknown[], tracks: readonly { id?: unknown }[]): number[] {
  const available = new Set(tracks.map((track) => positiveId(track.id)).filter((id): id is number => id != null));
  return [...new Set(ids.map(positiveId).filter((id): id is number => id != null && available.has(id)))];
}

export interface PromptGenerationIntent { signature: string; key: string; startedAt: number; jobId?: string; }
