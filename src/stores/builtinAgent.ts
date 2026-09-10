import axios from "@/utils/axios";
import {
  builtinFingerprint,
  builtinRunMessages,
  builtinScopeKey,
  createBuiltinIdempotencyKey,
  dedupeBuiltinRunEvents,
  defaultBuiltinRunLimits,
  isBuiltinRunTerminal,
  builtinProductionPreview,
  type BuiltinAgentType,
  type BuiltinControlAction,
  type BuiltinDisplayMessage,
  type BuiltinRunControlResponse,
  type BuiltinRunEvent,
  type BuiltinRunGetResponse,
  type BuiltinRunListResponse,
  type BuiltinRunScope,
  type BuiltinRunStartResponse,
  type BuiltinRunView,
  type BuiltinRunLimits,
  type BuiltinStartInput,
} from "@/types/builtinAgent";

type StartIntent = { fingerprint: string; idempotencyKey: string };
type PollTimer = ReturnType<typeof setInterval>;

function unwrap<T>(response: unknown): T {
  const value = response as { data?: unknown } | undefined;
  return (value && value.data !== undefined ? value.data : response) as T;
}

function runScope(run: BuiltinRunView): BuiltinRunScope {
  return { agentType: run.agentType, projectId: run.projectId, scriptId: run.scriptId };
}

function isSameScope(left: BuiltinRunScope, right: BuiltinRunScope): boolean {
  return builtinScopeKey(left) === builtinScopeKey(right);
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as Record<string, unknown>;
  const response = value.response && typeof value.response === "object" ? (value.response as Record<string, unknown>) : undefined;
  const status = value.status ?? response?.status;
  return typeof status === "number" ? status : undefined;
}

export default defineStore("builtinAgent", () => {
  const runs = ref<Record<string, BuiltinRunView>>({});
  const runsByScope = ref<Record<string, string[]>>({});
  const eventsByRun = ref<Record<string, BuiltinRunEvent[]>>({});
  const messagesByRun = ref<Record<string, BuiltinDisplayMessage[]>>({});
  const selectedRunByScope = ref<Record<string, string | undefined>>({});
  const artifactRevisionByScope = ref<Record<string, number>>({});
  const loading = ref<Record<string, boolean>>({});
  const errors = ref<Record<string, string | undefined>>({});

  // An uncertain network response keeps its key. A later explicit retry with the same
  // scope and prompt therefore replays the server's idempotent start request.
  const startIntents = new Map<string, StartIntent>();
  const pollers = new Map<string, PollTimer>();
  const pollInFlight = new Set<string>();

  function setRun(run: BuiltinRunView) {
    const previous = runs.value[run.id];
    if (previous && Number.isFinite(previous.version) && Number.isFinite(run.version) && run.version < previous.version) return;
    runs.value[run.id] = run;
    const scopeKey = builtinScopeKey(runScope(run));
    const current = runsByScope.value[scopeKey] ?? [];
    if (!current.includes(run.id)) runsByScope.value[scopeKey] = [...current, run.id];
    if (!selectedRunByScope.value[scopeKey] || !runs.value[selectedRunByScope.value[scopeKey]!]) selectedRunByScope.value[scopeKey] = run.id;
    messagesByRun.value[run.id] = builtinRunMessages(run, eventsByRun.value[run.id] ?? []);
  }

  function mergeEvents(run: BuiltinRunView, incoming: BuiltinRunEvent[]) {
    const current = eventsByRun.value[run.id] ?? [];
    const seen = new Set(current.map((event) => event.sequence));
    const fresh = incoming.filter((event) => !seen.has(event.sequence)).sort((a, b) => a.sequence - b.sequence);
    if (fresh.length) {
      eventsByRun.value[run.id] = dedupeBuiltinRunEvents(current, fresh);
      fresh.forEach((event) => {
        if (event.type === "artifact.saved") {
          const key = builtinScopeKey(runScope(run));
          artifactRevisionByScope.value[key] = (artifactRevisionByScope.value[key] ?? 0) + 1;
        }
      });
      messagesByRun.value[run.id] = builtinRunMessages(run, eventsByRun.value[run.id]);
    }
  }

  function normalizeList(response: unknown): BuiltinRunListResponse {
    const data = unwrap<BuiltinRunListResponse>(response);
    return { runs: Array.isArray(data?.runs) ? data.runs : [] };
  }

  function normalizeGet(response: unknown): BuiltinRunGetResponse {
    const data = unwrap<BuiltinRunGetResponse>(response);
    return { run: data.run, events: Array.isArray(data.events) ? data.events : [], nextSequence: Number(data.nextSequence) || 0 };
  }

  function activeRunForScope(scope: BuiltinRunScope): BuiltinRunView | undefined {
    const ids = runsByScope.value[builtinScopeKey(scope)] ?? [];
    return ids.map((id) => runs.value[id]).find((run) => run && !isBuiltinRunTerminal(run.status));
  }

  async function listRuns(scope: BuiltinRunScope, limit = 20): Promise<BuiltinRunView[]> {
    const key = builtinScopeKey(scope);
    loading.value[key] = true;
    errors.value[key] = undefined;
    try {
      const response = await axios.post("/builtinAgent/list", {
        projectId: scope.projectId,
        ...(scope.scriptId == null ? {} : { scriptId: scope.scriptId }),
        limit,
      });
      const data = normalizeList(response);
      data.runs.forEach(setRun);
      const available = runsForScope(scope);
      const selected = selectedRunByScope.value[key];
      if (!selected || !available.some((run) => run.id === selected)) selectedRunByScope.value[key] = available[0]?.id;
      return data.runs;
    } catch (error) {
      errors.value[key] = error instanceof Error ? error.message : "运行列表读取失败";
      throw error;
    } finally {
      loading.value[key] = false;
    }
  }

  async function getRun(runId: string, afterSequence?: number): Promise<BuiltinRunView | undefined> {
    if (pollInFlight.has(runId)) return runs.value[runId];
    pollInFlight.add(runId);
    try {
      const currentSequence = afterSequence ?? (eventsByRun.value[runId]?.at(-1)?.sequence ?? 0);
      const response = await axios.post("/builtinAgent/get", { runId, afterSequence: currentSequence });
      const data = normalizeGet(response);
      if (!data.run) return runs.value[runId];
      setRun(data.run);
      mergeEvents(data.run, data.events);
      if (isBuiltinRunTerminal(data.run.status)) {
        if ((eventsByRun.value[runId]?.at(-1)?.sequence ?? 0) >= data.run.lastSequence) stopPolling(runId);
        else startPolling(runId);
      }
      return data.run;
    } catch (error) {
      const run = runs.value[runId];
      if (run) errors.value[builtinScopeKey(runScope(run))] = error instanceof Error ? error.message : "运行状态读取失败";
      throw error;
    } finally {
      pollInFlight.delete(runId);
    }
  }

  function startPolling(runId: string, intervalMs = 1500) {
    if (pollers.has(runId)) return;
    void getRun(runId).catch(() => undefined);
    pollers.set(
      runId,
      setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        void getRun(runId).catch(() => undefined);
      }, intervalMs),
    );
  }

  function stopPolling(runId: string) {
    const timer = pollers.get(runId);
    if (!timer) return;
    clearInterval(timer);
    pollers.delete(runId);
  }

  function stopPollingForScope(scopeKey: string) {
    (runsByScope.value[scopeKey] ?? []).forEach((runId) => stopPolling(runId));
  }

  async function startRun(input: BuiltinStartInput): Promise<BuiltinRunView> {
    const scope = { agentType: input.agentType, projectId: input.projectId, scriptId: input.scriptId } satisfies BuiltinRunScope;
    const scopeKey = builtinScopeKey(scope);
    const limits = { ...defaultBuiltinRunLimits, ...(input.limits ?? {}) };
    const requestLimits: Partial<BuiltinRunLimits> = { ...limits };
    if (input.agentType === "productionAgent" && input.limits?.maxOutputTokens === undefined) delete requestLimits.maxOutputTokens;
    const request = {
      scope,
      prompt: input.prompt,
      limits: requestLimits,
      ...(input.thinkLevel === undefined ? {} : { thinkLevel: input.thinkLevel }),
    };
    const fingerprint = builtinFingerprint(request);
    let intent = startIntents.get(scopeKey);
    if (!intent || intent.fingerprint !== fingerprint) {
      intent = { fingerprint, idempotencyKey: createBuiltinIdempotencyKey() };
      startIntents.set(scopeKey, intent);
    }
    loading.value[scopeKey] = true;
    errors.value[scopeKey] = undefined;
    try {
      const response = await axios.post("/builtinAgent/start", {
        agentType: input.agentType,
        projectId: input.projectId,
        ...(input.scriptId == null ? {} : { scriptId: input.scriptId }),
        prompt: input.prompt,
        idempotencyKey: intent.idempotencyKey,
        limits: requestLimits,
        ...(input.thinkLevel === undefined ? {} : { thinkLevel: input.thinkLevel }),
      });
      const data = unwrap<BuiltinRunStartResponse>(response);
      if (!data?.run) throw new Error("启动响应缺少运行记录");
      startIntents.delete(scopeKey);
      setRun(data.run);
      selectedRunByScope.value[scopeKey] = data.run.id;
      startPolling(data.run.id);
      return data.run;
    } catch (error) {
      // Keep the intent on all uncertain outcomes, including timeout/5xx/409.
      errors.value[scopeKey] = error instanceof Error ? error.message : "启动内置 Agent 失败";
      throw error;
    } finally {
      loading.value[scopeKey] = false;
    }
  }

  async function controlRun(
    runId: string,
    scope: BuiltinRunScope,
    action: BuiltinControlAction,
    reason?: string,
    answer?: string,
  ): Promise<BuiltinRunView> {
    const run = runs.value[runId];
    if (!run) throw new Error("运行尚未加载，无法控制");
    if (!isSameScope(scope, runScope(run))) throw new Error("当前页面范围与运行范围不一致");
    let response: unknown;
    try {
      response = await axios.post("/builtinAgent/control", {
        runId,
        expectedVersion: run.version,
        action,
        ...(reason ? { reason } : {}),
        ...(answer ? { answer } : {}),
      });
    } catch (error) {
      if (errorStatus(error) === 409) void getRun(runId).catch(() => undefined);
      throw error;
    }
    const data = unwrap<BuiltinRunControlResponse>(response);
    if (!data?.run) throw new Error("控制响应缺少运行记录");
    setRun(data.run);
    if (isBuiltinRunTerminal(data.run.status)) stopPolling(runId);
    else startPolling(runId);
    return data.run;
  }

  function runsForScope(scope: BuiltinRunScope): BuiltinRunView[] {
    return (runsByScope.value[builtinScopeKey(scope)] ?? [])
      .map((id) => runs.value[id])
      .filter(Boolean)
      .sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt);
  }

  function messagesForRun(runId: string): BuiltinDisplayMessage[] {
    return messagesByRun.value[runId] ?? [];
  }

  function artifactRevision(scope: BuiltinRunScope): number {
    return artifactRevisionByScope.value[builtinScopeKey(scope)] ?? 0;
  }

  function canvasPreview(scope: BuiltinRunScope, target: "scriptPlan" | "storyboardTable") {
    for (const run of runsForScope(scope)) {
      const preview = builtinProductionPreview(run, eventsByRun.value[run.id] ?? [], target);
      if (preview) return preview;
    }
    return undefined;
  }

  function hasActiveRun(scope: BuiltinRunScope): boolean {
    return Boolean(activeRunForScope(scope));
  }

  function hasRun(scope: BuiltinRunScope): boolean {
    return (runsByScope.value[builtinScopeKey(scope)] ?? []).length > 0;
  }

  function clearError(scope: BuiltinRunScope) {
    errors.value[builtinScopeKey(scope)] = undefined;
  }

  function clear() {
    pollers.forEach((timer) => clearInterval(timer));
    pollers.clear();
    pollInFlight.clear();
    startIntents.clear();
    runs.value = {};
    runsByScope.value = {};
    eventsByRun.value = {};
    messagesByRun.value = {};
    selectedRunByScope.value = {};
    artifactRevisionByScope.value = {};
    loading.value = {};
    errors.value = {};
  }

  return {
    runs,
    runsByScope,
    eventsByRun,
    selectedRunByScope,
    loading,
    errors,
    startRun,
    listRuns,
    getRun,
    startPolling,
    stopPolling,
    stopPollingForScope,
    controlRun,
    runsForScope,
    messagesForRun,
    artifactRevision,
    canvasPreview,
    hasActiveRun,
    hasRun,
    clearError,
    clear,
  };
});

export { errorStatus };
