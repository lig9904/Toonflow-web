type VideoCapability = { durationResolutionMap?: Array<{ duration: number[]; resolution: string[] }> };
export function videoDurations(model: VideoCapability): number[] {
  return [...new Set((model.durationResolutionMap ?? []).flatMap((row) => row.duration))].sort((a, b) => a - b);
}
export function videoResolutions(model: VideoCapability, duration: number): string[] {
  return [...new Set((model.durationResolutionMap ?? []).filter((row) => row.duration.includes(duration)).flatMap((row) => row.resolution))];
}
export function nearestVideoDuration(model: VideoCapability, duration: number): number {
  return videoDurations(model).sort((a, b) => Math.abs(a - duration) - Math.abs(b - duration) || a - b)[0] ?? duration;
}
