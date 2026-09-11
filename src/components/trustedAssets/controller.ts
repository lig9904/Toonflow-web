export type TrustedGroupType = "AIGC" | "LivenessFace";
export type TrustedAssetType = "Image" | "Video" | "Audio";
export interface TrustedLocalTarget { targetKind: "asset" | "storyboard"; targetId: number; name: string; src?: string; mediaType?: "image" | "video" | "audio" }
export interface TrustedTargetScope { projectId: number; scriptId?: number; targetKind: "asset" | "storyboard"; targetId: number }
export interface TrustedBindingItem { remoteProjectName: string; groupType: TrustedGroupType; groupId: string; assetId: string; assetType: TrustedAssetType }
export interface TrustedBinding extends TrustedBindingItem { position?: number; remoteStatus?: string; remoteUpdateTime?: string | number; checkedAt?: string | number; assetUri?: string }
export interface TrustedBindingSnapshot extends TrustedTargetScope { version: number; sourceVersion: number; sourceFileHash: string | null; sourceCurrent: boolean; currentMediaType?: "image" | "video" | "audio"; currentSourceVersion: number; currentSourceFileHash: string | null; items: TrustedBinding[]; reused?: boolean }
export interface TrustedBindingWrite extends TrustedTargetScope { expectedVersion: number; expectedSourceVersion: number; expectedSourceFileHash: string | null; idempotencyKey: string; items: TrustedBindingItem[] }
export interface TrustedRemoteGroup { id: string; name: string; description?: string; groupType: TrustedGroupType; projectName: string }
export interface TrustedRemoteAsset { id: string; groupId: string; name: string; assetType: TrustedAssetType; status: "Active" | "Processing" | "Failed" | string; projectName: string; previewUrl: string | null; assetUri: string; error?: {code: string; message: string} | null }
export interface TrustedPage<T> { items: T[]; nextToken: string | null }
export interface TrustedBindingDraft { snapshot?: TrustedBindingSnapshot; desired: TrustedBindingItem[]; status: "loading" | "saved" | "saving" | "conflict" | "error"; error: string }
export function trustedScopeKey(scope: TrustedTargetScope) { return `${scope.projectId}:${scope.scriptId ?? "project"}:${scope.targetKind}:${scope.targetId}`; }
export function trustedItemKey(item: TrustedBindingItem) { return `${item.remoteProjectName}:${item.groupType}:${item.groupId}:${item.assetId}:${item.assetType}`; }
export function bindingInput(item: TrustedBindingItem): TrustedBindingItem { return { remoteProjectName: item.remoteProjectName, groupType: item.groupType, groupId: item.groupId, assetId: item.assetId, assetType: item.assetType }; }
const signature = (items: TrustedBindingItem[]) => JSON.stringify(items.map(bindingInput));
export function trustedPreviewUrl(value?: string | null) { if (!value) return ""; try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : ""; } catch { return ""; } }
export function createTrustedBindingController(options: {
  states: Record<string, TrustedBindingDraft>;
  read: (scope: TrustedTargetScope) => Promise<TrustedBindingSnapshot>;
  write: (input: TrustedBindingWrite) => Promise<TrustedBindingSnapshot>;
  makeId?: () => string;
}) {
  const states = options.states;
  const flights = new Map<string, Promise<void>>();
  const pending = new Map<string, { input: TrustedBindingWrite; desired: string }>();
  const readSequences = new Map<string, number>();
  const makeId = options.makeId ?? (() => `trusted-assets:${crypto.randomUUID()}`);
  function state(scope: TrustedTargetScope) { const key = trustedScopeKey(scope); return states[key] ?? (states[key] = { desired: [], status: "loading", error: "" }); }
  function dirty(scope: TrustedTargetScope) { const current = state(scope); return signature(current.desired) !== signature(current.snapshot?.items ?? []); }
  function setError(scope: TrustedTargetScope, error: unknown) {
    const current = state(scope); const e = error as { code?: string; status?: number; message?: string };
    const conflict = e?.status === 409 || ["VERSION_CONFLICT", "IDEMPOTENCY_CONFLICT", "SOURCE_CHANGED"].includes(e?.code ?? "");
    current.status = conflict ? "conflict" : "error";
    current.error = e?.code === "CONFIG_REQUIRED" ? "火山新入口的素材库 AK/SK 尚未配置，请完成配置后重试。" : e?.message || "素材绑定操作失败，当前选择已保留。";
    if (conflict) pending.delete(trustedScopeKey(scope));
  }
  async function load(scope: TrustedTargetScope, mode: "initial" | "server" | "keep" = "initial") {
    const key = trustedScopeKey(scope); const current = state(scope);
    if (flights.has(key)) return;
    if (mode === "initial" && (pending.has(key) || current.status === "conflict" || dirty(scope))) return;
    const sequence = (readSequences.get(key) ?? 0) + 1; readSequences.set(key, sequence);
    const before = signature(current.desired); current.status = "loading"; current.error = "";
    try {
      const result = await options.read({ ...scope });
      if (sequence !== readSequences.get(key) || flights.has(key)) return;
      current.snapshot = result; pending.delete(key);
      if (mode !== "keep" && before === signature(current.desired)) current.desired = result.items.map(bindingInput);
      current.status = "saved";
      if (mode === "keep") await save(scope, true);
    } catch (error) { if (sequence === readSequences.get(key)) setError(scope, error); }
  }
  async function perform(scope: TrustedTargetScope, request: { input: TrustedBindingWrite; desired: string }) {
    const key = trustedScopeKey(scope); const current = state(scope); pending.set(key, request); current.status = "saving"; current.error = "";
    try {
      const result = await options.write(request.input); pending.delete(key); current.snapshot = result;
      if (signature(current.desired) === request.desired) current.desired = result.items.map(bindingInput);
      current.status = "saved";
    } catch (error) { setError(scope, error); }
  }
  async function save(scope: TrustedTargetScope, force = false): Promise<void> {
    const key = trustedScopeKey(scope); const current = state(scope);
    const existing = flights.get(key); if (existing) { await existing; if (current.status === "saved" && dirty(scope)) return save(scope); return; }
    if (!current.snapshot || current.status === "loading" || current.status === "conflict") return;
    const retry = pending.get(key);
    if (!retry && !dirty(scope) && !force) return;
    const request = retry ?? { input: { ...scope, expectedVersion: current.snapshot.version, expectedSourceVersion: current.snapshot.currentSourceVersion, expectedSourceFileHash: current.snapshot.currentSourceFileHash, idempotencyKey: makeId(), items: current.desired.map(bindingInput) }, desired: signature(current.desired) };
    readSequences.set(key, (readSequences.get(key) ?? 0) + 1);
    const flight = perform(scope, request); flights.set(key, flight);
    try { await flight; } finally { flights.delete(key); }
    if (current.status === "saved" && dirty(scope)) await save(scope);
  }
  function toggle(scope: TrustedTargetScope, item: TrustedBindingItem) {
    const current = state(scope); if (!current.snapshot || current.status === "loading" || current.snapshot.sourceCurrent === false) return;
    const key = trustedItemKey(item); const found = current.desired.some(value => trustedItemKey(value) === key);
    current.desired = found ? [] : [bindingInput(item)];
    if (current.status !== "conflict") void save(scope);
  }
  function remove(scope: TrustedTargetScope, item: TrustedBindingItem) {
    const current = state(scope); if (!current.snapshot || current.status === "loading") return;
    current.desired = current.desired.filter(value => trustedItemKey(value) !== trustedItemKey(item));
    if (current.status !== "conflict") void save(scope);
  }
  return { state, load, save, toggle, remove, dirty };
}
