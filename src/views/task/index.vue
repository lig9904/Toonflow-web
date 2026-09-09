<template>
  <div class="task">
    <div class="header">
      <div class="headerInfo fc">
        <span class="title">{{ $t("workbench.task.title") }}</span>
        <span class="sub">{{ $t("workbench.task.subtitle") }}</span>
      </div>
      <t-button @click="getTaskList">
        <template #icon>
          <i-redo :size="20" />
        </template>
        {{ $t("workbench.task.refresh") }}
      </t-button>
    </div>
    <div class="list">
      <div class="search f">
        <t-select :label="$t('workbench.task.project')" v-model="projectId" :options="projectData" @change="onFilterChange" />
        <t-select
          :label="$t('workbench.task.categoryLabel')"
          v-model="taskClass"
          :options="categoryOptions"
          @change="onFilterChange"
          style="margin-left: 20px" />
        <t-select
          :label="$t('workbench.task.stateLabel')"
          v-model="taskState"
          :options="stateOptions"
          @change="onFilterChange"
          style="margin-left: 20px" />
        <t-select label="来源：" v-model="taskSource" :options="sourceOptions" @change="onFilterChange" style="margin-left: 20px" />
      </div>
      <div class="content">
        <t-table :data="taskList" :columns="columns" row-key="id" :loading="pagination.loading" hover stripe @row-click="onRowClick">
          <template #source="{ row }">
            <t-tag size="small" variant="light" :theme="sourceTheme(row.source)">{{ row.sourceLabel }}</t-tag>
          </template>
          <template #state="{ row }">
            <t-tooltip v-if="row.state === '生成失败'" :content="row.reason || $t('workbench.task.noFailReason')" placement="top">
              <span class="stateText stateFail">{{ row.state }}</span>
            </t-tooltip>
            <span v-else class="stateText" :class="stateClass(row.state)">
              {{ row.state }}
            </span>
          </template>
          <template #progress="{ row }">
            <span>{{ progressText(row) }}</span>
          </template>
          <template #artifact="{ row }">
            <span v-if="row.artifacts.length" class="artifactPath" :title="row.artifacts[0].path" @click.stop="openTask(row)">
              {{ row.artifacts.length }} 个产物
            </span>
            <span v-else class="muted">—</span>
          </template>
          <template #startTime="{ row }">
            <span>{{ dayjs(row.startTime).format("YYYY-MM-DD HH:mm:ss") }}</span>
          </template>
        </t-table>
        <t-pagination
          class="paginationWrap"
          v-model:current="pagination.page"
          v-model:pageSize="pagination.limit"
          show-sizer
          :total="pagination.total"
          @page-size-change="getTaskList"
          @current-change="getTaskList" />
      </div>
    </div>
    <t-dialog v-model:visible="detailVisible" header="任务详情" :footer="false" width="720px">
      <div v-if="taskDetail" class="detail">
        <div class="detailMeta">
          <t-tag size="small" variant="light" :theme="sourceTheme(taskDetail.source)">{{ taskDetail.sourceLabel }}</t-tag>
          <span>{{ taskDetail.state }}</span>
          <code>{{ taskDetail.id }}</code>
        </div>
        <div><strong>项目：</strong>{{ taskDetail.projectName }}</div>
        <div><strong>模型：</strong>{{ taskDetail.model || "—" }}</div>
        <div><strong>关联对象：</strong>{{ taskDetail.relatedObjects || "—" }}</div>
        <div><strong>进度：</strong>{{ progressText(taskDetail) }}</div>
        <div v-if="taskDetail.describe"><strong>描述：</strong>{{ taskDetail.describe }}</div>
        <div v-if="taskDetail.waitingQuestion" class="attention"><strong>等待人工：</strong>{{ taskDetail.waitingQuestion }}</div>
        <div v-if="taskDetail.control?.status === 'waiting_human'" class="controlAnswer">
          <strong>答复：</strong>
          <t-textarea v-model="controlAnswer" :autosize="{ minRows: 3, maxRows: 8 }" placeholder="输入答复后点击继续" />
        </div>
        <div v-if="taskDetail.control?.allowedActions.length" class="controlActions">
          <strong>运行控制：</strong>
          <t-button
            v-for="action in taskDetail.control.allowedActions"
            :key="action"
            size="small"
            :theme="action === 'cancel' ? 'danger' : 'primary'"
            variant="outline"
            :loading="controllingAction === action"
            :disabled="Boolean(controllingAction)"
            @click="controlBuiltinTask(taskDetail, action)">
            {{ controlActionLabel(action) }}
          </t-button>
        </div>
        <div v-if="taskDetail.reason" class="failure"><strong>原因：</strong>{{ taskDetail.reason }}</div>
        <div v-if="taskDetail.recovery?.canRecover" class="recoveryActions">
          <strong>人工恢复：</strong>
          <t-button
            v-for="action in taskDetail.recovery.recoveryActions"
            :key="action.action"
            size="small"
            theme="primary"
            variant="outline"
            :loading="recoveringAction === action.action"
            :disabled="Boolean(recoveringAction)"
            @click="recoverTask(taskDetail, action.action)">
            {{ action.label }}
          </t-button>
        </div>
        <div v-if="taskDetail.artifacts.length">
          <strong>产物：</strong>
          <div v-for="artifact in taskDetail.artifacts" :key="`${artifact.kind}:${artifact.path}`" class="artifactDetail">
            <t-tag size="small">{{ artifact.kind }}</t-tag><code>{{ artifact.path }}</code>
          </div>
        </div>
        <div v-if="taskDetail.relatedTasks?.length">
          <strong>关联任务：</strong>
          <div v-for="related in taskDetail.relatedTasks" :key="related.id" class="relatedTask" @click="openTask(related)">
            {{ related.sourceLabel }} · {{ related.state }} · {{ related.relatedObjects }}
          </div>
        </div>
      </div>
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import dayjs from "dayjs";
import axios from "@/utils/axios";
import { createIdempotencyKey } from "@/utils/idempotency";

type TaskSource = "legacy" | "builtin" | "image" | "video";
interface TaskArtifact { kind: string; path: string; }
interface TaskProgress { current: number; total: number | null; phase: string; }

interface TaskItem {
  id: string;
  source: TaskSource;
  sourceId: string | number;
  projectId: number;
  sourceLabel: string;
  taskClass: string;
  relatedObjects: string;
  model: string;
  projectName: string;
  episode: string;
  state: string;
  startTime: number;
  describe?: string;
  reason?: string;
  waitingQuestion?: string | null;
  progress: TaskProgress;
  artifacts: TaskArtifact[];
  relatedTasks?: TaskItem[];
  recovery?: {
    canRecover: boolean;
    expectedUpdatedAt: number;
    recoveryActions: Array<{ action: "query" | "download"; label: string }>;
  };
  control?: {
    runId: string;
    version: number;
    status: string;
    allowedActions: Array<"pause" | "resume" | "cancel" | "takeover">;
  };
}

const columns = [
  { colKey: "source", title: "来源", width: 110, cell: "source" },
  { colKey: "taskClass", title: $t("workbench.task.col.taskClass"), width: 120, ellipsis: true },
  { colKey: "relatedObjects", title: $t("workbench.task.col.relatedObjects"), width: 120, ellipsis: true },
  { colKey: "model", title: $t("workbench.task.col.model"), width: 280, ellipsis: true },
  { colKey: "describe", title: $t("workbench.task.col.describe"), ellipsis: true },
  { colKey: "reason", title: $t("workbench.task.col.reason"), ellipsis: true },
  { colKey: "state", title: $t("workbench.task.col.state"), width: 100, cell: "state" },
  { colKey: "progress", title: "进度", width: 130, cell: "progress" },
  { colKey: "artifact", title: "产物", width: 90, cell: "artifact" },
  { colKey: "startTime", title: $t("workbench.task.col.startTime"), width: 200, cell: "startTime" },
];

const stateOptions = [
  { label: $t("workbench.task.stateAll"), value: "" },
  { label: $t("workbench.task.stateRunning"), value: "进行中" },
  { label: $t("workbench.task.stateCompleted"), value: "已完成" },
  { label: $t("workbench.task.stateFailed"), value: "生成失败" },
  { label: "排队中", value: "排队中" },
  { label: "提交中", value: "提交中" },
  { label: "保存中", value: "保存中" },
  { label: "待人工", value: "待人工" },
  { label: "待核对", value: "待核对" },
  { label: "已暂停", value: "已暂停" },
  { label: "已取消", value: "已取消" },
];
const sourceOptions = [
  { label: $t("workbench.task.stateAll"), value: "" },
  { label: "旧任务", value: "legacy" },
  { label: "内置 Agent", value: "builtin" },
  { label: "图片任务", value: "image" },
  { label: "视频任务", value: "video" },
];

const pagination = ref({ page: 1, limit: 10, total: 0, loading: false });
const categoryOptions = ref<{ label: string; value: string }[]>([]);
const projectData = ref<{ label: string; value: string }[]>([]);
const taskClass = ref("");
const taskState = ref("");
const taskSource = ref("");
const projectId = ref("");
const taskList = ref<TaskItem[]>([]);
const detailVisible = ref(false);
const taskDetail = ref<TaskItem | null>(null);
const recoveringAction = ref<"query" | "download" | null>(null);
const recoveryIntents = new Map<string, string>();
const controlAnswer = ref("");
const controllingAction = ref<"pause" | "resume" | "cancel" | "takeover" | null>(null);

onMounted(() => {
  getTaskList();
  getCategories();
  getProject();
});

function onFilterChange() {
  pagination.value.page = 1;
  getTaskList();
}

async function getCategories() {
  const { data } = await axios.post("/task/getTaskCategories").catch(() => ({ data: [] }));
  categoryOptions.value = [
    { label: $t("workbench.task.stateAll"), value: "" },
    ...data.map((i: any) => ({ label: i.taskClass, value: i.taskClass })),
  ];
}

async function getProject() {
  const { data } = await axios.post("/task/getProject").catch(() => ({ data: [] }));
  projectData.value = [{ label: $t("workbench.task.stateAll"), value: "" }, ...data.map((i: any) => ({ label: i.name, value: String(i.id) }))];
}

async function getTaskList() {
  pagination.value.loading = true;
  try {
    const { data } = await axios.post("/task/getTaskApi", {
      page: pagination.value.page,
      limit: pagination.value.limit,
      taskClass: taskClass.value,
      state: taskState.value,
      source: taskSource.value || undefined,
      projectId: projectId.value ? Number(projectId.value) : null,
    });
    taskList.value = data.data;
    pagination.value.total = data.total;
  } catch {
    window.$message.error($t("workbench.task.fetchFailed"));
  } finally {
    pagination.value.loading = false;
  }
}

function sourceTheme(source: TaskSource) {
  return ({ legacy: "default", builtin: "primary", image: "success", video: "warning" } as const)[source];
}

function stateClass(state: string) {
  if (["进行中", "排队中", "提交中", "保存中"].includes(state)) return "stateRunning";
  if (["待人工", "待核对", "已暂停"].includes(state)) return "stateAttention";
  if (["生成失败", "已取消"].includes(state)) return "stateFail";
  return "stateSuccess";
}

function progressText(task: TaskItem) {
  if (task.progress.total != null) return `${task.progress.current}/${task.progress.total}`;
  return task.progress.current > 0 ? `${task.progress.phase} · ${task.progress.current} 次` : task.progress.phase || "—";
}

function onRowClick(context: any) {
  openTask(context.row as TaskItem);
}

async function openTask(task: TaskItem) {
  try {
    if (taskDetail.value?.id !== task.id) controlAnswer.value = "";
    const { data } = await axios.post("/task/taskDetails", { taskId: task.id });
    taskDetail.value = data;
    detailVisible.value = true;
  } catch {
    window.$message.error($t("workbench.task.fetchFailed"));
  }
}

function controlActionLabel(action: "pause" | "resume" | "cancel" | "takeover") {
  return ({ pause: "暂停", resume: "继续", cancel: "取消运行", takeover: "人工接手" } as const)[action];
}

function httpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { status?: unknown; response?: { status?: unknown } };
  const status = value.status ?? value.response?.status;
  return typeof status === "number" ? status : undefined;
}

async function controlBuiltinTask(task: TaskItem, action: "pause" | "resume" | "cancel" | "takeover") {
  const control = task.control;
  if (!control || !control.allowedActions.includes(action)) return;
  if (control.status === "waiting_human" && action === "resume" && !controlAnswer.value.trim()) {
    window.$message.warning("请先填写对待人工问题的答复");
    return;
  }
  controllingAction.value = action;
  try {
    await axios.post("/builtinAgent/control", {
      runId: control.runId,
      expectedVersion: control.version,
      action,
      ...(control.status === "waiting_human" && action === "resume" ? { answer: controlAnswer.value.trim() } : {}),
    });
    if (action === "cancel") window.$message.success("内置运行已取消；已经受理的上游媒体任务仍按其实际状态处理");
    else window.$message.success(`${controlActionLabel(action)}成功`);
    controlAnswer.value = "";
    await getTaskList();
    await openTask(task);
  } catch (error: any) {
    if (httpStatus(error) === 409) {
      await getTaskList();
      await openTask(task);
      window.$message.warning("运行版本已变化，详情已刷新；当前答复已保留");
    } else window.$message.error(error.message ?? "内置运行控制失败");
  } finally {
    controllingAction.value = null;
  }
}

async function recoverTask(task: TaskItem, action: "query" | "download") {
  if ((task.source !== "image" && task.source !== "video") || !task.recovery?.canRecover) return;
  const signature = `${task.id}:${task.recovery.expectedUpdatedAt}:${action}`;
  const idempotencyKey = recoveryIntents.get(signature) ?? createIdempotencyKey("media-recover");
  recoveryIntents.set(signature, idempotencyKey);
  recoveringAction.value = action;
  try {
    await axios.post("/mediaJobs/recover", {
      projectId: task.projectId,
      source: task.source,
      jobId: Number(task.sourceId),
      expectedUpdatedAt: task.recovery.expectedUpdatedAt,
      idempotencyKey,
      action,
    });
    recoveryIntents.delete(signature);
    window.$message.success(action === "query" ? "已继续查询原任务" : "已重新保存已有结果");
    await getTaskList();
    await openTask(task);
  } catch (error: any) {
    window.$message.error(error.message ?? "媒体任务恢复失败，原任务数据已保留");
  } finally {
    recoveringAction.value = null;
  }
}
</script>

<style lang="scss" scoped>
.task {
  .header {
    padding-top: 32px;
    margin-bottom: 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    .title {
      font-size: 32px;
      font-weight: 600;
    }
    .sub {
      opacity: 0.5;
    }
  }
  .stateText {
    font-weight: bold;
  }
  .stateFail {
    color: #ff4d4f;
    cursor: pointer;
  }
  .stateRunning {
    color: #1890ff;
  }
  .stateSuccess {
    color: #52c41a;
  }
  .stateAttention {
    color: #d48806;
  }
  .artifactPath,
  .relatedTask {
    color: var(--td-brand-color);
    cursor: pointer;
  }
  .muted {
    opacity: 0.45;
  }
  .detail {
    display: grid;
    gap: 12px;
    overflow-wrap: anywhere;
  }
  .detailMeta,
  .artifactDetail {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .attention {
    color: #d48806;
  }
  .failure {
    color: #cf1322;
  }
  .recoveryActions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .controlActions,
  .controlAnswer {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .controlAnswer {
    align-items: flex-start;
  }
  .relatedTask {
    padding: 6px 0;
  }
  .paginationWrap {
    margin-top: 10px;
  }
}
</style>
