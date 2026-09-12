/** Only a receipt from our own unbroken save chain may advance a queued request. */
export function nextQueuedPlanningVersion(queuedBase: number, savedBase: number, savedVersion: number, currentVersion: number | undefined): number {
  return currentVersion === savedBase && queuedBase === savedBase && savedVersion >= savedBase ? savedVersion : queuedBase;
}
