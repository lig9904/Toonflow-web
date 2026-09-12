import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { confirmCreativeDrafts, confirmClearCreativeDraft, registerCreativeDraft } from "./creativeDrafts";
import userStore from "@/stores/user";
import {acceptGeneratedSaved,discardManualDraft,sameCreativeDraftScope} from "./manualDraftState";
export interface ManualCreativeSnapshot<T, M> { value: T; meta: M }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
/** Human edits remain separate from saved application state until an explicit commit succeeds. */
export function useManualCreativeDraft<T, M>(options: {
  label: string; id: () => string; scope: () => string; initial: T;
  load: () => Promise<ManualCreativeSnapshot<T, M>> | ManualCreativeSnapshot<T, M>;
  commit: (value: T, meta: M) => Promise<ManualCreativeSnapshot<T, M>>;
  onSaved?: (snapshot: ManualCreativeSnapshot<T, M>) => void;
}) {
  const draft = ref(copy(options.initial)) as Ref<T>;
  const baseline = ref(copy(options.initial)) as Ref<T>;
  const active = ref(false), saving = ref(false), status = ref("未修改"), error = ref("");
  let meta: M | undefined, editingId = "", editingScope = "", editingUserId: number | undefined, sequence = 0;
  let inFlight: Promise<boolean> | undefined;
  let latestSaved:ManualCreativeSnapshot<T,M>|undefined;
  let disposed=false;
  const currentScope=()=>({sequence,id:options.id(),scope:options.scope(),userId:userStore().user?.id,disposed});
  const captureScope=()=>({sequence,id:editingId,scope:editingScope,userId:editingUserId});
  const registrationId = `creative-editor:${crypto.randomUUID()}`;
  const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(baseline.value));
  const storageKey = () => `toonflow:manual-draft:${editingUserId}:${editingId}`;
  const persist = () => {
    if (!editingId || meta === undefined) return;
    try {
      if (dirty.value) sessionStorage.setItem(storageKey(), JSON.stringify({ draft: draft.value, baseline: baseline.value, meta, scope: editingScope }));
      else sessionStorage.removeItem(storageKey());
    } catch { /* Keep the in-memory draft if browser storage is unavailable. */ }
  };
  watch(draft, () => { if (active.value) { if (!saving.value) status.value = dirty.value ? "未保存草稿" : "已保存"; persist(); } }, {deep:true,flush:"sync"});
  async function open(): Promise<boolean> {
    if (active.value && dirty.value && !(await confirmCreativeDrafts({ids:[registrationId],action:"打开另一份内容"}))) return false;
    const id = options.id(), scope = options.scope(), request = ++sequence;
    try {
      const saved = await options.load();
      if (disposed || request !== sequence || id !== options.id() || scope!==options.scope()) return false;
      editingId = id; editingScope = scope; editingUserId=userStore().user?.id; latestSaved=copy(saved); baseline.value = copy(saved.value); draft.value = copy(saved.value); meta = copy(saved.meta); error.value = "";
      try {
        const cached = JSON.parse(sessionStorage.getItem(storageKey()) || "null");
        if (cached?.scope === scope && cached.draft !== undefined && cached.meta !== undefined) { draft.value = cached.draft; baseline.value = cached.baseline; meta = cached.meta; }
      } catch { /* Ignore corrupt local draft records. */ }
      active.value = true; status.value = dirty.value ? "已恢复未保存草稿" : "已保存"; return true;
    } catch (reason) { error.value = (reason as Error)?.message || "读取失败"; window.$message.error(error.value); return false; }
  }
  async function save(): Promise<boolean> {
    if (inFlight) return inFlight;
    if (!dirty.value) return true;
    if (meta === undefined || editingId !== options.id() || editingUserId!==userStore().user?.id) { error.value = "编辑对象已变化，草稿已保留"; return false; }
    const value = copy(draft.value), capturedMeta = copy(meta), id = editingId, capturedScope=captureScope();
    saving.value = true; status.value = "保存中…"; error.value = "";
    inFlight = (async () => {
      try {
        if (typeof value === "string" && !value.trim() && typeof baseline.value === "string" && baseline.value.trim()) {
          if (!(await confirmClearCreativeDraft(options.label))) { status.value = "未保存草稿"; return false; }
          if (!sameCreativeDraftScope(capturedScope,currentScope()) || JSON.stringify(value)!==JSON.stringify(draft.value)) return false;
        }
        const saved = await options.commit(value, capturedMeta);
        if (editingId !== id || !sameCreativeDraftScope(capturedScope,currentScope())) return false;
        baseline.value = copy(saved.value); meta = copy(saved.meta);
        // Never assign the saved result over text typed while this request was running.
        const latestVersion=Number((latestSaved?.meta as any)?.version), savedVersion=Number((saved.meta as any)?.version);
        if(!latestSaved || !Number.isFinite(latestVersion) || !Number.isFinite(savedVersion) || savedVersion>=latestVersion)latestSaved=copy(saved);
        options.onSaved?.(latestSaved); persist(); status.value = dirty.value ? "保存完成，仍有新草稿" : "已保存"; return !dirty.value;
      } catch (reason) { if(!sameCreativeDraftScope(capturedScope,currentScope()))return false; error.value = (reason as Error)?.message || "保存失败"; status.value = `保存失败，草稿已保留：${error.value}`; persist(); window.$message.error(error.value); return false; }
      finally { saving.value = false; inFlight = undefined; }
    })();
    return inFlight;
  }
  function receiveSaved(saved:ManualCreativeSnapshot<T,M>) {
    if(meta===undefined || !sameCreativeDraftScope(captureScope(),currentScope()))return;
    const before=meta as any, incoming=saved.meta as any;
    if(before?.projectId!==undefined && incoming?.projectId!==undefined && before.projectId!==incoming.projectId || before?.id!==undefined && incoming?.id!==undefined && before.id!==incoming.id)return;
    if(Number.isFinite(Number((latestSaved?.meta as any)?.version)) && Number.isFinite(Number((saved.meta as any)?.version)) && Number((saved.meta as any).version)<Number((latestSaved!.meta as any).version))return;
    latestSaved=copy(saved);
    const wasDirty=dirty.value;
    if(wasDirty){status.value="后台已保存新结果，本地草稿和原版本已保留";persist();return;}
    const next=acceptGeneratedSaved({draft:draft.value,baseline:baseline.value,meta},saved);
    draft.value=copy(next.draft);baseline.value=copy(next.baseline);meta=copy(next.meta);
    status.value=wasDirty?"后台已保存新结果，本地草稿已保留；保存时需处理版本冲突":"已保存生成结果";persist();
  }
  let observationSequence=0;
  async function observeSaved() {
    if(!active.value)return;const observation=++observationSequence,capturedScope=captureScope();
    const saved=await options.load();if(observation===observationSequence && sameCreativeDraftScope(capturedScope,currentScope()))receiveSaved(saved);
  }
  async function reloadSaved(keepDraft=false) {
    sequence++;const id=editingId,capturedScope=captureScope();const saved=await options.load();if(id!==editingId || !sameCreativeDraftScope(capturedScope,currentScope()))return;
    latestSaved=copy(saved);baseline.value=copy(saved.value);meta=copy(saved.meta);if(!keepDraft)draft.value=copy(saved.value);
    status.value=keepDraft && dirty.value?"已明确采用最新版本为基准，草稿尚未保存":"已载入最新保存内容";error.value="";persist();
  }
  function discard() {
    if(meta===undefined)return;
    const next=discardManualDraft({draft:draft.value,baseline:baseline.value,meta},latestSaved);
    draft.value=copy(next.draft);baseline.value=copy(next.baseline);meta=copy(next.meta);
    if(latestSaved)options.onSaved?.(latestSaved);
    error.value="";status.value="已放弃修改并采用最新已保存内容";persist();
  }
  let closing: Promise<boolean> | undefined;
  function close(): Promise<boolean> {
    // TDialog emits close/cancel/update:visible for the same click; one decision only.
    if (closing) return closing;
    closing = (async () => {
      if (!(await confirmCreativeDrafts({ids:[registrationId],action:"关闭编辑窗口"}))) return false;
      active.value = false; return true;
    })().finally(() => { closing = undefined; });
    return closing;
  }
  const unregister = registerCreativeDraft({id:registrationId,label:options.label,scope:()=>editingScope,isDirty:()=>active.value && dirty.value,save,discard});
  const visible = computed({get:()=>active.value,set:value=>{if(value)active.value=true;else void close();}});
  onBeforeUnmount(()=>{disposed=true;sequence++;persist();unregister();});
  return {draft,visible,dirty,saving,status,error,open,save,discard,close,registrationId,receiveSaved,reloadSaved,baseline,observeSaved};
}
