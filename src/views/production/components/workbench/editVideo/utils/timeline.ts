/**
 * Timeline and source durations are different values.
 *
 * A generated video can be four seconds long while the storyboard asks for a
 * two second shot.  Callers should pass `timelineDuration` (or
 * `plannedDuration`) when that distinction is known.  `duration` remains a
 * backwards compatible fallback for older media-library entries.
 */
export interface TimelineMediaData {
  duration?: number;
  sourceDuration?: number;
  generatedDuration?: number;
  mediaDuration?: number;
  timelineDuration?: number;
  plannedDuration?: number;
  shotDuration?: number;
  finalDuration?: number;
  durationKind?: "source" | "timeline";
}

const DEFAULT_DURATIONS: Record<string, number> = {
  video: 5,
  image: 5,
  audio: 30,
  subtitle: 3,
  text: 3,
  sticker: 3,
  filter: 3,
  effect: 3,
  transition: 3,
};

function positiveFinite(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function firstPositive(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = positiveFinite(value);
    if (number !== undefined) return number;
  }
  return undefined;
}

/** Resolve the duration of the source media, when it is known. */
export function getSourceDuration(mediaData: TimelineMediaData, fallback?: number): number {
  return (
    firstPositive(mediaData.sourceDuration, mediaData.generatedDuration, mediaData.mediaDuration, mediaData.duration) ??
    positiveFinite(fallback) ??
    0
  );
}

/** Resolve the duration occupied by the clip on the edit timeline. */
export function getTimelineDuration(mediaType: string, mediaData: TimelineMediaData): number {
  const planned = firstPositive(
    mediaData.timelineDuration,
    mediaData.plannedDuration,
    mediaData.shotDuration,
    mediaData.finalDuration,
  );
  if (planned !== undefined) return planned;

  // Legacy entries only had `duration`.  Treat it as a timeline duration
  // unless the producer explicitly marked it as source-only.
  if (mediaData.durationKind !== "source") {
    const legacy = positiveFinite(mediaData.duration);
    if (legacy !== undefined) return legacy;
  }

  return DEFAULT_DURATIONS[mediaType] ?? 3;
}

/** Return the largest end time of valid clips in visible or hidden tracks. */
export function getTracksTimelineEnd(tracks: Array<{ clips?: Array<{ startTime?: number; endTime?: number }> }>): number {
  let end = 0;
  for (const track of tracks) {
    for (const clip of track.clips ?? []) {
      const start = positiveFinite(clip.startTime) ?? 0;
      const clipEnd = positiveFinite(clip.endTime);
      if (clipEnd !== undefined && clipEnd > start) end = Math.max(end, clipEnd);
    }
  }
  return end;
}
