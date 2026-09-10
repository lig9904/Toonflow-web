<template>
  <section class="builtinRunPanel">
    <div class="runHeader">
      <strong>{{ title || "内置 Agent 运行" }}</strong>
      <t-button size="small" variant="text" :loading="loading" @click="reloadRuns">刷新</t-button>
    </div>

    <div v-if="showComposer" class="startRow">
      <t-input v-model="prompt" clearable placeholder="告诉内置 Agent 要完成什么" @enter="start" />
      <t-button theme="primary" :loading="starting" :disabled="!prompt.trim() || starting" @click="start">开始运行</t-button>
    </div>
    <div class="authorizationRow">
      <span>{{ $t("builtinAgent.mediaBudgetLabel") }}</span>
      <label>{{ $t("builtinAgent.imageLabel") }} <t-input-number v-model="imageGenerations" :min="0" :max="100" theme="column" /></label>
      <label>{{ $t("builtinAgent.videoLabel") }} <t-input-number v-model="videoGenerations" :min="0" :max="100" theme="column" /></label>
      <span class="muted">{{ $t("builtinAgent.zeroUnlimitedHint") }}</span>
    </div>

    <div v-if="scopeRuns.length" class="runList">
      <button
        v-for="run in scopeRuns"
        :key="run.id"
        type="button"
        class="runItem"
        :class="{ active: run.id === selectedRun?.id }"
        @click="selectRun(run.id)">
        <span class="runPrompt">{{ run.prompt }}</span>
        <t-tag size="small" :theme="statusTheme(run.status, run)" variant="light">{{ statusLabel(run.status, run) }}</t-tag>
      </button>
    </div>
    <t-empty v-else description="当前范围还没有内置 Agent 运行" />

    <div v-if="selectedRun" class="runDetails">
      <div class="runMeta">
        <t-tag size="small" :theme="statusTheme(selectedRun.status, selectedRun)" variant="light">{{ statusLabel(selectedRun.status, selectedRun) }}</t-tag>
        <span>{{ progressText }}</span>
      </div>
      <div class="usageRow">
        <span>{{ mediaUsageText(selectedRun, "image") }}</span>
        <span>{{ mediaUsageText(selectedRun, "video") }}</span>
        <span>执行者：{{ executionUserLabel }}</span>
      </div>
      <div v-if="builtinUsesIndependentOutput(selectedRun)" class="muted">各步骤独立调用模型 · 文本累计 {{ selectedRun.outputTokens ?? 0 }} tokens</div>
      <div v-if="agentType !== 'productionAgent' && selectedRun.status === 'waiting_human'" class="humanTask">
        <div class="humanQuestion">{{ waitingQuestion || "运行正在等待你的处理" }}</div>
        <div class="answerRow">
          <t-input v-model="answer" clearable placeholder="输入处理结果后继续运行" @enter="submitAnswer" />
          <t-button theme="primary" :disabled="!answer.trim()" :loading="continuingWithAnswer" @click="submitAnswer">提交并继续</t-button>
        </div>
      </div>
      <div v-if="selectedRun.errorMessage" class="runError">{{ selectedRun.errorMessage }}</div>
      <div v-for="(issue, index) in runIssues" :key="index" class="muted">{{ issue }}</div>
      <div class="runControls">
        <t-button v-if="selectedRun.status === 'running' || selectedRun.status === 'queued'" size="small" variant="outline" @click="control('pause')">暂停</t-button>
        <t-button v-if="selectedRun.status === 'paused'" size="small" theme="primary" @click="control('resume')">继续</t-button>
        <t-button v-if="agentType !== 'productionAgent' && (selectedRun.status === 'running' || selectedRun.status === 'paused' || selectedRun.status === 'waiting_human')" size="small" variant="outline" @click="control('takeover')">我来接手</t-button>
        <t-button v-if="!terminal" size="small" theme="danger" variant="text" @click="control('cancel')">取消运行</t-button>
      </div>
    </div>
    <div v-if="error" class="runError">{{ error }}</div>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import builtinAgentStore from "@/stores/builtinAgent";
import userStore from "@/stores/user";
import {
  builtinScopeKey,
  builtinHumanQuestion,
  builtinHasUnlimitedMediaBudget,
  builtinUsesIndependentOutput,
  isBuiltinRunTerminal,
  type BuiltinAgentType,
  type BuiltinControlAction,
  type BuiltinRunScope,
  type BuiltinRunStatus,
  type BuiltinRunView,
  type BuiltinMediaGenerationKind,
  type BuiltinThinkLevel,
} from "@/types/builtinAgent";

const props = defineProps<{
  agentType: BuiltinAgentType;
  projectId: number | string | null | undefined;
  scriptId?: number | string | null;
  title?: string;
  showComposer?: boolean;
  thinkLevel?: number;
}>();

const store = builtinAgentStore();
const prompt = ref("");
const starting = ref(false);
const imageGenerations = ref(0);
const videoGenerations = ref(0);
const answer = ref("");
const continuingWithAnswer = ref(false);
const scope = computed<BuiltinRunScope>(() => ({
  agentType: props.agentType,
  projectId: props.projectId == null ? null : Number(props.projectId),
  scriptId: props.scriptId == null ? null : Number(props.scriptId),
}));
const scopeKey = computed(() => builtinScopeKey(scope.value));
const scopeRuns = computed(() => store.runsForScope(scope.value));
const selectedRun = computed(() => {
  const selectedId = store.selectedRunByScope[scopeKey.value];
  return (selectedId ? store.runs[selectedId] : undefined) ?? scopeRuns.value[0];
});
const waitingQuestion = computed(() => {
  if (!selectedRun.value) return "";
  const events = store.eventsByRun[selectedRun.value.id] ?? [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "run.status") {
      const question = builtinHumanQuestion(event.data);
      if (question) return question;
    }
  }
  return "";
});
const progressText = computed(() => {
  const run = selectedRun.value;
  if (!run) return "";
  return `模型调用 ${run.modelCalls}/${run.limits.maxModelCalls} · 操作 ${run.toolSteps}/${run.limits.maxToolSteps}`;
});
const executionUserLabel = computed(() => {
  const executionUserId = selectedRun.value?.executionUserId ?? selectedRun.value?.requestedBy;
  const current = userStore().user;
  if (current?.id === executionUserId) return current.name || "当前用户";
  return executionUserId == null ? "未分配" : `成员 ${executionUserId}`;
});
const loading = computed(() => Boolean(store.loading[scopeKey.value]));
const error = computed(() => store.errors[scopeKey.value]);
const terminal = computed(() => Boolean(selectedRun.value && isBuiltinRunTerminal(selectedRun.value.status)));
const runIssues = computed(() => {
  const result = selectedRun.value?.result as { issues?: Array<{ message?: string }> } | null;
  return Array.isArray(result?.issues) ? result.issues.map((issue) => issue.message).filter(Boolean).slice(0, 20) : [];
});
const showComposer = computed(() => props.showComposer !== false);

function mediaUsageText(run: BuiltinRunView, kind: BuiltinMediaGenerationKind): string {
  const label = kind === "image" ? $t("builtinAgent.imageLabel") : $t("builtinAgent.videoLabel");
  const used = kind === "image" ? run.imageGenerations ?? 0 : run.videoGenerations ?? 0;
  if (builtinHasUnlimitedMediaBudget(run, kind)) return `${label} ${used}/${$t("builtinAgent.unlimitedLabel")}`;
  const limit = kind === "image" ? run.limits.maxImageGenerations : run.limits.maxVideoGenerations;
  return `${label} ${used}/${limit}`;
}

function statusLabel(status: BuiltinRunStatus, run?: BuiltinRunView): string {
  const outcome = (run?.result as { outcome?: string } | null)?.outcome;
  if (outcome === "not_executed") return "未执行";
  if (status === "succeeded" && outcome === "partial") return "已结束（部分未完成）";
  return {
    queued: "待执行",
    running: "进行中",
    waiting_human: "等待人工",
    paused: "已暂停",
    succeeded: "已完成",
    failed: "失败",
    reconciliation_required: "需核对",
    cancelled: "已取消",
  }[status];
}

function statusTheme(status: BuiltinRunStatus, run?: BuiltinRunView): "default" | "primary" | "success" | "warning" | "danger" {
  if ((run?.result as { outcome?: string } | null)?.outcome === "partial") return "warning";
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "reconciliation_required" || status === "cancelled") return "danger";
  if (status === "waiting_human" || status === "paused") return "warning";
  if (status === "running") return "primary";
  return "default";
}

async function reloadRuns() {
  try {
    const runs = await store.listRuns(scope.value);
    runs.forEach((run) => {
      if (isBuiltinRunTerminal(run.status)) void store.getRun(run.id).catch(() => undefined);
      else store.startPolling(run.id);
    });
  } catch {
    // The panel exposes the store error while preserving the current run snapshot.
  }
}

function selectRun(runId: string) {
  store.selectedRunByScope[scopeKey.value] = runId;
  store.startPolling(runId);
}

async function start() {
  const value = prompt.value.trim();
  if (!value || starting.value) return;
  const selectedThinkLevel = [0, 1, 2, 3].includes(props.thinkLevel ?? -1) ? props.thinkLevel as BuiltinThinkLevel : undefined;
  starting.value = true;
  try {
    await store.startRun({
      ...scope.value,
      prompt: value,
      limits: { maxImageGenerations: imageGenerations.value, maxVideoGenerations: videoGenerations.value },
      ...(selectedThinkLevel === undefined ? {} : { thinkLevel: selectedThinkLevel }),
    });
    prompt.value = "";
  } catch {
    // The retained idempotency intent makes a later explicit retry safe.
  } finally {
    starting.value = false;
  }
}

async function startPrompt(value: string) {
  prompt.value = value.trim();
  await start();
}

defineExpose({ startPrompt });

async function control(action: BuiltinControlAction) {
  const run = selectedRun.value;
  if (!run) return;
  try {
    await store.controlRun(run.id, scope.value, action, action === "takeover" ? "用户在当前项目与剧本范围内接手运行" : undefined);
  } catch {
    // A stale version is refreshed by the next poll; the server remains authoritative.
  }
}

async function submitAnswer() {
  const run = selectedRun.value;
  const value = answer.value.trim();
  if (!run || run.status !== "waiting_human" || !value || continuingWithAnswer.value) return;
  continuingWithAnswer.value = true;
  try {
    await store.controlRun(run.id, scope.value, "resume", undefined, value);
    answer.value = "";
  } catch {
    // The store refreshes a stale version; keep the typed answer for an explicit retry.
  } finally {
    continuingWithAnswer.value = false;
  }
}

watch(
  scopeKey,
  (next, previous) => {
    if (previous && previous !== next) store.stopPollingForScope(previous);
    void reloadRuns();
  },
  { immediate: true },
);
watch(
  () => selectedRun.value?.id,
  () => {
    const limits = selectedRun.value?.limits;
    if (!limits) return;
    imageGenerations.value = Number(limits.maxImageGenerations) || 0;
    videoGenerations.value = Number(limits.maxVideoGenerations) || 0;
  },
  { immediate: true },
);
onUnmounted(() => {
  scopeRuns.value.forEach((run) => store.stopPolling(run.id));
});
</script>

<style scoped lang="scss">
.builtinRunPanel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 9px 10px;
  border-bottom: 1px solid var(--td-border-level-1-color);
  background: var(--td-bg-color-container);
  flex-shrink: 0;
  max-height: 360px;
  overflow: auto;
}
.runHeader,
.startRow,
.authorizationRow,
.runMeta,
.runControls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.authorizationRow {
  color: var(--td-text-color-secondary);
  font-size: 12px;
  flex-wrap: wrap;
  label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  :deep(.t-input-number) {
    width: 92px;
  }
}
.runHeader,
.runMeta {
  justify-content: space-between;
}
.startRow :deep(.t-input) {
  flex: 1;
}
.runList {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.runItem {
  border: 1px solid var(--td-border-level-1-color);
  border-radius: 5px;
  background: transparent;
  color: var(--td-text-color-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: space-between;
  min-height: 28px;
  padding: 3px 7px;
  text-align: left;
  &.active {
    border-color: var(--td-brand-color);
    background: var(--td-brand-color-light);
  }
}
.runPrompt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.runDetails {
  border-top: 1px solid var(--td-border-level-1-color);
  padding-top: 7px;
}
.usageRow {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: 6px;
  color: var(--td-text-color-secondary);
  font-size: 12px;
}
.humanTask {
  border: 1px solid var(--td-warning-color-3);
  border-radius: 5px;
  background: var(--td-warning-color-1);
  padding: 7px;
  margin-top: 6px;
}
.humanQuestion {
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.45;
}
.answerRow {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
.answerRow :deep(.t-input) {
  flex: 1;
}
.runMeta {
  color: var(--td-text-color-secondary);
  font-size: 12px;
}
.runMessages {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 170px;
  overflow: auto;
  margin: 5px 0;
}
.runMessage {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.45;
  &.system {
    color: var(--td-error-color);
  }
}
.runError {
  color: var(--td-error-color);
  font-size: 12px;
  white-space: pre-wrap;
}
.runControls {
  justify-content: flex-end;
}
</style>
