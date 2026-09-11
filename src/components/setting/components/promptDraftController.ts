export interface PromptEntry {
  key: string; id: number | string; name: string; group: string; source: string; usedBy: string[];
  content: string; defaultContent: string; customized: boolean; version: string; updatedAt: string | null;
  editable: boolean; requiredContext: string[]; requiredVariables: string[]; codeContracts: string[]; file?: string;
}
export interface PromptDraft {
  entry: PromptEntry; draft: string; status: "saved" | "pending" | "saving" | "conflict" | "error" | "invalid";
  error: string; conflictVersion?: string;
}
export type PromptMutation = "updatePrompt" | "resetPrompt" | "restorePrompt";
export interface PromptMutationInput { key: string; expectedVersion: string; idempotencyKey: string; content?: string; historyVersion?: string }
interface PendingMutation { operation: PromptMutation; input: PromptMutationInput; draftAtStart: string }
export function createPromptDraftController(options: {
  states: Record<string, PromptDraft>;
  write: (operation: PromptMutation, input: PromptMutationInput) => Promise<PromptEntry>;
  read: (key: string) => Promise<PromptEntry>;
  delay?: number;
  makeId?: () => string;
}) {
  const states = options.states;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const flights = new Map<string, Promise<void>>();
  const uncertain = new Map<string, PendingMutation>();
  const resolving = new Set<string>();
  const makeId = options.makeId ?? (() => `prompt:${crypto.randomUUID()}`);
  const dirty = (key: string) => states[key]?.draft !== states[key]?.entry.content;
  function clearTimer(key: string) { const timer = timers.get(key); if (timer) clearTimeout(timer); timers.delete(key); }
  function schedule(key: string) { clearTimer(key); timers.set(key, setTimeout(() => { timers.delete(key); void save(key); }, options.delay ?? 700)); }
  function seed(entries: PromptEntry[]) {
    for (const entry of entries) {
      const state = states[entry.key];
      if (state && (dirty(entry.key) || flights.has(entry.key) || uncertain.has(entry.key) || state.status === "conflict")) continue;
      states[entry.key] = { entry, draft: entry.content, status: "saved", error: "" };
    }
  }
  function edit(key: string, content: string) {
    const state = states[key]; if (!state) return;
    state.draft = content;
    if (state.status === "conflict" || resolving.has(key)) return;
    if (!content.trim() || content.length > 100000) { clearTimer(key); state.status = "invalid"; state.error = "提示词需为非空文本，且不超过 100000 字符。恢复默认请使用恢复操作。"; return; }
    state.error = "";
    state.status = flights.has(key) ? "saving" : dirty(key) || uncertain.has(key) ? "pending" : "saved";
    if (dirty(key) || uncertain.has(key)) schedule(key); else clearTimer(key);
  }
  function fail(key: string, error: unknown) {
    const state = states[key]; const e = error as { code?: string; currentVersion?: string; status?: number; message?: string };
    if (e?.status === 409 || e?.code === "VERSION_CONFLICT" || e?.code === "IDEMPOTENCY_CONFLICT") {
      uncertain.delete(key); state.status = "conflict"; state.conflictVersion = e.currentVersion;
      state.error = "服务端已有新版本，本地草稿已保留。请选择读取服务端内容，或保留草稿并基于最新版本保存。";
    } else { state.status = "error"; state.error = e?.message || "保存失败，本地草稿仍保留。可重试同一请求。"; }
  }
  async function run(key: string, pending: PendingMutation): Promise<void> {
    const state = states[key]; uncertain.set(key, pending); state.status = "saving"; state.error = "";
    try {
      const entry = await options.write(pending.operation, pending.input);
      uncertain.delete(key); state.entry = entry; state.conflictVersion = undefined;
      // A response belongs to the exact captured draft, never to text typed later.
      if (state.draft === pending.draftAtStart) state.draft = entry.content;
      if (!state.draft.trim() || state.draft.length > 100000) { state.status = "invalid"; state.error = "提示词需为非空文本，且不超过 100000 字符。"; }
      else state.status = dirty(key) ? "pending" : "saved";
    } catch (error) { fail(key, error); }
  }
  async function save(key: string): Promise<void> {
    clearTimer(key); const state = states[key];
    if (!state || resolving.has(key)) return;
    const existing = flights.get(key); if (existing) { await existing; if (states[key].status === "pending") return save(key); return; }
    if (state.status === "conflict") return;
    const retry = uncertain.get(key);
    if (!retry && (!dirty(key) || !state.draft.trim() || state.draft.length > 100000)) return;
    const pending = retry ?? { operation: "updatePrompt" as const, input: { key, content: state.draft, expectedVersion: state.entry.version, idempotencyKey: makeId() }, draftAtStart: state.draft };
    const flight = run(key, pending); flights.set(key, flight);
    try { await flight; } finally { flights.delete(key); }
    if (states[key].status === "pending") schedule(key);
  }
  async function mutate(key: string, operation: "resetPrompt" | "restorePrompt", historyVersion?: string): Promise<void> {
    clearTimer(key); const state = states[key];
    if (!state || dirty(key) || flights.has(key) || uncertain.has(key) || resolving.has(key) || state.status === "conflict") return;
    const pending: PendingMutation = { operation, input: { key, expectedVersion: state.entry.version, idempotencyKey: makeId(), ...(historyVersion ? { historyVersion } : {}) }, draftAtStart: state.draft };
    const flight = run(key, pending); flights.set(key, flight);
    try { await flight; } finally { flights.delete(key); }
    if (state.status === "pending") schedule(key);
  }
  async function resolveConflict(key: string, keepDraft: boolean): Promise<void> {
    if (resolving.has(key) || flights.has(key)) return;
    clearTimer(key); resolving.add(key); const state = states[key]; const draftAtStart = state.draft;
    try {
      const entry = await options.read(key);
      uncertain.delete(key); state.entry = entry; state.conflictVersion = undefined; state.error = "";
      if (!keepDraft && state.draft === draftAtStart) state.draft = entry.content;
      state.status = dirty(key) ? "pending" : "saved";
      if (!state.draft.trim() || state.draft.length > 100000) { state.status = "invalid"; state.error = "提示词需为非空文本，且不超过 100000 字符。"; }
      else if (dirty(key)) schedule(key);
    } catch (error) { state.status = "conflict"; state.error = (error as Error)?.message || "读取最新版本失败，本地草稿仍保留。"; }
    finally { resolving.delete(key); }
  }
  function hasUnsaved() { return Object.keys(states).some(key => dirty(key) || flights.has(key) || uncertain.has(key)); }
  function dispose() { for (const key of timers.keys()) clearTimer(key); }
  return { seed, edit, save, mutate, resolveConflict, dirty, hasUnsaved, dispose };
}

type DraftControllerOptions = Parameters<typeof createPromptDraftController>[0];
type DraftSession = { states: Record<string, PromptDraft>; controller: ReturnType<typeof createPromptDraftController> };
const promptDraftSessions = new Map<number, DraftSession>();
/** Page-memory only: no credentials or prompt contents are written to browser storage. */
export function getPromptDraftSession(userId: number, options: Omit<DraftControllerOptions, "states"> & {
  currentUserId: () => number | undefined;
  createStates?: () => Record<string, PromptDraft>;
}): DraftSession {
  const validUser = Number.isSafeInteger(userId) && userId > 0;
  const cached = validUser ? promptDraftSessions.get(userId) : undefined;
  if (cached) return cached;
  const states = options.createStates?.() ?? {};
  function requireSameUser() {
    if (!validUser || options.currentUserId() !== userId) throw Object.assign(new Error("登录用户已变化，草稿已按原用户保留；重新打开提示词管理后再保存。"), { status: 401 });
  }
  const controller = createPromptDraftController({
    ...options, states,
    write: async (operation, input) => { requireSameUser(); return options.write(operation, input); },
    read: async key => { requireSameUser(); return options.read(key); },
  });
  const session = { states, controller };
  if (validUser) promptDraftSessions.set(userId, session);
  return session;
}
