type VideoCapability = { durationResolutionMap?: Array<{ duration: number[]; resolution: string[] }> };
export type VideoDurationResolution = "exact" | "rounded_up" | "exceeds_maximum" | "unavailable";
export interface VideoDurationChoice {
  requested: number;
  duration?: number;
  resolution: VideoDurationResolution;
}

export function videoDurations(model: VideoCapability): number[] {
  return [...new Set((model.durationResolutionMap ?? []).flatMap((row) => row.duration))].sort((a, b) => a - b);
}
export function videoResolutions(model: VideoCapability, duration: number): string[] {
  return [...new Set((model.durationResolutionMap ?? []).filter((row) => row.duration.includes(duration)).flatMap((row) => row.resolution))];
}
export function nearestVideoDuration(model: VideoCapability, duration: number): number {
  return resolveVideoDuration(model, duration).duration ?? duration;
}

/** Prefer an exact duration, then the smallest supported duration above the source duration. */
export function resolveVideoDuration(model: VideoCapability, duration: number): VideoDurationChoice {
  const requested = Number(duration);
  const durations = videoDurations(model);
  if (!Number.isFinite(requested) || requested <= 0 || durations.length === 0) return { requested, resolution: "unavailable" };
  const exact = durations.find((value) => value === requested);
  if (exact !== undefined) return { requested, duration: exact, resolution: "exact" };
  const roundedUp = durations.find((value) => value >= requested);
  if (roundedUp !== undefined) return { requested, duration: roundedUp, resolution: "rounded_up" };
  return { requested, resolution: "exceeds_maximum" };
}

/** Sum source storyboard durations for one video track; generated track duration is only a fallback for empty tracks. */
export function storyboardTrackDuration(
  storyboards: Array<{ trackId?: number | string | null; duration?: number | string | null }>,
  trackId: number | string | null | undefined,
  fallback = 0,
): number {
  const id = Number(trackId);
  if (!Number.isSafeInteger(id) || id <= 0) return Number(fallback) || 0;
  const total = storyboards
    .filter((item) => Number(item.trackId) === id)
    .reduce((sum, item) => {
      const duration = Number(item.duration);
      return sum + (Number.isFinite(duration) && duration > 0 ? duration : 0);
    }, 0);
  return total > 0 ? total : Number(fallback) || 0;
}
