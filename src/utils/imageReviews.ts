import { computed, onScopeDispose, reactive, watch, type Ref } from 'vue';
import axios from './axios';
export interface ImageReview {
  id: string; jobId: number; targetKind: string; targetId: string; artifactPath: string;
  status: 'queued' | 'running' | 'passed' | 'issues' | 'failed' | 'skipped';
  summary: string; findings: Array<{code: string; severity: string; message: string}>;
  stale: boolean; selected: boolean; referenceCoverage: 'complete' | 'partial' | 'none'; reviewedAt: number | null;
}
type Entry = { reviews: ImageReview[]; error: string; users: number; busy: boolean; refreshedAt: number; timer?: ReturnType<typeof setInterval> };
const cache = new Map<string, Entry>();
function scopeKey(projectId?: number, scriptId?: number) {
  return Number.isSafeInteger(projectId) && Number(projectId) > 0 && Number.isSafeInteger(scriptId) && Number(scriptId) > 0 ? `${projectId}:${scriptId}` : '';
}
/** One bounded read per mounted episode, shared across all canvas cards. */
export function useImageReviews(projectId: Ref<number | undefined>, scriptId: Ref<number | undefined>) {
  const key = computed(() => scopeKey(projectId.value, scriptId.value));
  async function refresh(entry: Entry, scope: string) {
    if (entry.busy || !entry.users || document.hidden) return;
    entry.busy = true;
    const [projectId, scriptId] = scope.split(':').map(Number);
    try { const {data} = await axios.post('/production/review/listImageReviews', {projectId, scriptId});
      entry.reviews = Array.isArray(data?.reviews) ? data.reviews : []; entry.error = ''; entry.refreshedAt = Date.now();
    } catch { entry.error = '图片核验结果暂时无法读取'; }
    finally { entry.busy = false; }
  }
  function release(scope: string) {
    const entry = cache.get(scope); if (!entry) return;
    entry.users--; if (entry.users <= 0) { clearInterval(entry.timer); cache.delete(scope); }
  }
  const stop = watch(key, (next, old) => {
    if (old) release(old); if (!next) return;
    let entry = cache.get(next);
    if (!entry) { entry = reactive<Entry>({reviews: [], error: '', users: 0, busy: false, refreshedAt: 0}); cache.set(next, entry); }
    entry.users++;
    if (entry.users === 1) { void refresh(entry, next); entry.timer = setInterval(() => { if (entry!.reviews.some(r => r.status === 'queued' || r.status === 'running') || Date.now() - entry!.refreshedAt >= 30000) void refresh(entry!, next); }, 3000); }
  }, {immediate: true});
  onScopeDispose(() => { stop(); if (key.value) release(key.value); });
  return {reviews: computed(() => cache.get(key.value)?.reviews ?? []), error: computed(() => cache.get(key.value)?.error ?? ''),
    refresh: () => { const entry = cache.get(key.value); if (entry) void refresh(entry, key.value); }};
}
export function reviewMediaPath(value: string) {
  try { const path = new URL(value, 'https://local.invalid').pathname; return decodeURIComponent(path.replace(/^\/oss(?=\/)/, '')); } catch { return value; }
}
