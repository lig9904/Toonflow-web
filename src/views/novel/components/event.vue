<template>
  <div class="event">
    <t-space>
      <t-button v-if="eventData.length > 0" theme="primary" @click="regenerateEvents">
        <template #icon>
          <i-flash-payment theme="outline" />
        </template>
        {{ $t('workbench.novel.event.regenerate') }}
      </t-button>
      <t-button theme="danger" :disabled="selectedRowKeys.length === 0" @click="handleBatchDelete">
        <template #icon>
          <t-icon name="delete" />
        </template>
        {{ $t('workbench.novel.event.batchDelete') }} {{ selectedRowKeys.length > 0 ? `(${selectedRowKeys.length})` : "" }}
      </t-button>
    </t-space>

    <t-alert v-if="activeRunId" theme="info" style="margin-top: 10px" :message="`事件提取已启动（运行 ${activeRunId.slice(0, 8)}），可稍后刷新查看。`" />

    <div class="data">
      <t-table
        style="margin-top: 10px"
        :columns="columns"
        :data="eventData"
        :max-height="600"
        :selected-row-keys="selectedRowKeys"
        row-key="id"
        hover
        stripe
        size="small"
        :pagination="pagination"
        :loading="loading"
        lazy-load
        table-layout="fixed"
        @select-change="handleSelectChange"
        @page-change="handlePageChange">
        <template #empty>
          <div class="empty c" style="flex-direction: column; gap: 12px">
            <span>{{ $t('workbench.novel.event.noData') }}</span>
            <t-button v-if="!isGenerating" theme="primary" @click="generateEvent">
              <template #icon>
                <i-flash-payment theme="outline" />
              </template>
              {{ $t('workbench.novel.event.generate') }}
            </t-button>
          </div>
        </template>
        <template #loading>
          <div class="t-table--loading-message">
            <span v-if="isGenerating">🎬 {{ $t('workbench.novel.event.generatingHint') }}</span>
            <span v-else>{{ $t('workbench.novel.event.loading') }}</span>
          </div>
        </template>
        <template #chapters="{ row }">
          <span>{{ row.chapters.join("，") }}</span>
        </template>
        <template #createTime="{ row }">
          <span>{{ dayjs(row.createTime).format("YYYY-MM-DD HH:mm:ss") }}</span>
        </template>
        <template #operation="{ row }">
          <t-space :size="0">
            <t-button theme="danger" variant="text" @click="handleDelete(row)">
              <template #icon>
                <t-icon name="delete" />
              </template>
              {{ $t('workbench.novel.event.delete') }}
            </t-button>
          </t-space>
        </template>
      </t-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import axios from "@/utils/axios";
import dayjs from "dayjs";
import projectStore from "@/stores/project";
import { createIdempotencyKey } from "@/utils/idempotency";
const { project } = storeToRefs(projectStore());
// 分页信息
const pagination = ref({
  page: 1,
  pageSize: 10,
  total: 0,
});
// 加载状态
const loading = ref(false);
// 选中行
const selectedRowKeys = ref<Array<string | number>>([]);
// 事件数据
const eventData = ref<{ id: number; eventName: string; chapters: number[]; detail: string; createTime: number; version: number }[]>([]);
//表格表头
const columns = ref<Record<string, unknown>[]>([
  {
    colKey: "row-select",
    type: "multiple",
    width: 50,
    align: "center",
  },
  { colKey: "id", title: $t('workbench.novel.event.col.id'), width: 50, align: "center" },
  { colKey: "eventName", title: $t('workbench.novel.event.col.eventName'), width: 150, align: "center" },
  { colKey: "chapters", title: $t('workbench.novel.event.col.chapters'), width: 150, align: "center" },
  { colKey: "detail", title: $t('workbench.novel.event.col.detail'), width: 400, ellipsis: true },
  { colKey: "createTime", title: $t('workbench.novel.event.col.createTime'), width: 200, align: "center" },
  { colKey: "operation", title: $t('workbench.novel.event.col.operation'), width: 150, align: "center" },
]);
// 生成状态
const isGenerating = ref(false);
const activeRunId = ref("");

// 处理分页变化
function handlePageChange(pageInfo: { current: number; pageSize: number }) {
  pagination.value.page = pageInfo.current;
  pagination.value.pageSize = pageInfo.pageSize;
  getEvents();
}
// 获取小说事件列表
async function getEvents() {
  loading.value = true;
  try {
    const { data } = await axios.post("/novel/event/getEvent", {
      projectId: project.value?.id,
      page: pagination.value.page,
      limit: pagination.value.pageSize,
    });
    eventData.value = data.list;
    pagination.value.total = data.total;
  } catch (e) {
    window.$message.error((e as any).message);
    console.error("获取小说原文列表失败:", e);
  } finally {
    loading.value = false;
  }
}
// 处理删除事件
function handleDelete(row: Record<string, unknown>) {
  if (!Number.isSafeInteger(Number(row.version)) || Number(row.version) < 0) {
    window.$message.error("事件版本尚未加载，请刷新后重试");
    return getEvents();
  }
  const dialog = DialogPlugin.confirm({
    header: $t('workbench.novel.event.msg.deleteHeader'),
    body: $t('workbench.novel.event.msg.deleteBody'),
    onConfirm: async () => {
      try {
        await axios.post("/novel/event/deletEvent", {
          id: row.id,
          projectId: Number(project.value?.id),
          expectedVersion: Number(row.version),
          idempotencyKey: createIdempotencyKey("novel-event-delete"),
        });
        getEvents();
        window.$message.success($t('workbench.novel.event.msg.deleteSuccess'));
        dialog.destroy();
      } catch (error) {
        window.$message.error((error as Error).message);
      }
    },
  });
}

// 开始生成事件
async function generateEvent() {
  isGenerating.value = true;
  loading.value = true;
  try {
    const { data: chapters } = await axios.post("/novel/getNovelData", { projectId: Number(project.value?.id) });
    if (!Array.isArray(chapters) || !chapters.length) {
      window.$message.warning("请先导入原文章节");
      return;
    }
    const { data } = await axios.post("/novel/event/generateEvents", {
      projectId: Number(project.value?.id),
      novelIds: chapters.map((chapter: any) => Number(chapter.id)),
      expectedVersions: Object.fromEntries(chapters.map((chapter: any) => [String(chapter.id), Number(chapter.version)])),
      concurrentCount: 2,
      idempotencyKey: createIdempotencyKey("novel-events"),
    });
    activeRunId.value = String(data?.run?.id ?? "");
    getEvents();
    window.$message.success("事件提取已开始，可稍后刷新查看");
  } catch (e) {
    window.$message.error((e as Error).message);
    getEvents();
  } finally {
    isGenerating.value = false;
    loading.value = false;
  }
}
// 重新生成事件
function regenerateEvents() {
  console.log("重新生成事件");
  eventData.value = [];
  generateEvent();
}
onMounted(() => {
  getEvents();
});
//处理选择变化
function handleSelectChange(value: Array<string | number>, context: { selectedRowData: any[] }) {
  selectedRowKeys.value = value.filter(Boolean);
}
// 批量删除
function handleBatchDelete() {
  if (selectedRowKeys.value.length === 0) return;
  const selected = eventData.value.filter((row) => selectedRowKeys.value.includes(row.id));
  if (selected.length !== selectedRowKeys.value.length || selected.some((row) => !Number.isSafeInteger(row.version))) {
    window.$message.error("事件版本尚未加载，请刷新后重试");
    return getEvents();
  }
  const dialog = DialogPlugin.confirm({
    header: $t('workbench.novel.event.msg.batchDeleteHeader'),
    body: $t('workbench.novel.event.msg.batchDeleteBody', { count: selectedRowKeys.value.length }),
    onConfirm: async () => {
      try {
        await axios.post("/novel/event/batchDeleteEvent", {
          projectId: Number(project.value?.id),
          items: selected.map((row) => ({ id: row.id, expectedVersion: row.version })),
          idempotencyKey: createIdempotencyKey("novel-event-delete"),
        });
        selectedRowKeys.value = [];
        getEvents();
        window.$message.success($t('workbench.novel.event.msg.batchDeleteSuccess'));
        dialog.destroy();
      } catch (error) {
        window.$message.error((error as Error).message);
      }
    },
  });
}
</script>

<style lang="scss" scoped>
.event {
  margin-top: 20px;
  .data {
    margin-top: 10px;
  }
}
</style>
