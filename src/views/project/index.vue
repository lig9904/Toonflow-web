<template>
  <div class="project">
    <div class="header">
      <div class="fc">
        <span class="title">{{ $t("workbench.project.title") }}</span>
        <span class="sub">{{ $t("workbench.project.subtitle") }}</span>
      </div>
      <t-button
        class="addBtn"
        @click="
          editProjectData = null;
          dialogShow = true;
        ">
        <template #icon><i-plus class="addIcon" :size="20" /></template>
        {{ $t("workbench.project.newProject") }}
      </t-button>
    </div>
    <div class="list">
      <t-card hoverShadow class="card" v-for="project in allProject" :key="project.id" @click="openProject(project.id)">
        <div class="jb ac">
          <div class="title">
            {{ project.name }}
          </div>
          <div>
            <t-tag shape="round">
              {{ project.projectType == "novel" ? $t(`workbench.project.type.novel`) : $t(`workbench.project.type.script`) }}
            </t-tag>
          </div>
        </div>
        <t-tag shape="round" v-if="project.artStyle" style="align-self: flex-start">{{ project.artStyle }}</t-tag>
        <div class="intro">
          {{ project.intro }}
        </div>
        <div class="bottomMenu f ac jb">
          <div class="time">
            <span>{{ dayjs(project?.createTime).format("YYYY-MM-DD HH:mm:ss") }}</span>
          </div>
          <div class="actionBtns f ac">
            <div class="editBtn" @click.stop="openEdit(project)">
              <i-edit :size="18" />
            </div>
            <div class="removeBtn" @click.stop="delProjcer(project)">
              <i-delete :size="18" />
            </div>
          </div>
        </div>
      </t-card>
    </div>
  </div>
  <projectDialog v-model="dialogShow" :projectData="editProjectData" @add="addProjectFn" @edit="editProjectFn" />
</template>

<script setup lang="ts">
import projectDialog from "./components/projectDialog.vue";
import dayjs from "dayjs";
import axios from "@/utils/axios";
import projectStore from "@/stores/project";
import imageListCacheStore from "@/stores/imageListCache";
import builtinAgentStore from "@/stores/builtinAgent";
import { createIdempotencyKey } from "@/utils/idempotency";

const { clearProjectCache } = imageListCacheStore();
const { allProject, project } = storeToRefs(projectStore());

const dialogShow = ref(false);
const editProjectData = ref<{
  id: string;
  name: string;
  intro: string;
  type: string;
  artStyle: string | null;
  videoRatio: string | null;
  imageModel: string;
  videoModel: string;
  projectType: string;
  imageQuality: "1K" | "2K" | "4K" | "";
  mode: string;
  directorManual: string;
  version?: number;
} | null>(null);

async function getAllProject() {
  axios.post("/project/getProject").then(({ data }) => {
    allProject.value = Array.isArray(data) ? data : Array.isArray(data?.projects) ? data.projects : [];
  });
}

onMounted(() => {
  project.value = null;
  getAllProject();
});

const router = useRouter();

async function openProject(projectId: string | undefined) {
  const item = allProject.value.find((p) => p.id === projectId);

  if (!item) return window.$message.error($t("workbench.project.msg.notFound"));

  if (!item.imageModel || !item.videoModel) {
    window.$message.warning($t("workbench.project.msg.modelProviderDisabled"));
    return openEdit(item);
  }

  try {
    if (item.imageModel) {
      await axios.post("/modelSelect/getModelDetail", {
        modelId: item.imageModel,
      });
    }
    if (item.videoModel) {
      await axios.post("/modelSelect/getModelDetail", {
        modelId: item.videoModel,
      });
    }
  } catch {
    window.$message.warning($t("workbench.project.msg.modelProviderDisabled"));
    return openEdit(item);
  }

  project.value = item;
  if (item.projectType === "novel") router.push(`/novel`);
  else if (item.projectType === "script") router.push(`/script`);
}

function openEdit(item: {
  id: string;
  name: string;
  intro: string;
  type: string;
  artStyle: string | null;
  directorManual: string;
  videoRatio: string | null;
  imageModel: string;
  videoModel: string;
  imageQuality: "1K" | "2K" | "4K" | "";
  projectType: string;
  mode: string;
  version?: number;
}) {
  editProjectData.value = {
    ...item,
  };
  dialogShow.value = true;
}

function editProjectFn(data: {
  id: string;
  name: string;
  intro: string;
  type: string;
  artStyle: string;
  directorManual: string;
  videoRatio: string;
  imageModel: string;
  videoModel: string;
  imageQuality: "1K" | "2K" | "4K" | "";
  mode: string;
  expectedVersion?: number;
  mutationKey?: string;
}) {
  axios
    .post("/project/editProject", data)
    .then(() => {
      window.$message.success($t("workbench.project.msg.editSuccess"));
      dialogShow.value = false;
      getAllProject();
    })
    .catch((e) => {
      window.$message.error(e.message ?? $t("workbench.project.msg.editFailed"));
    });
}

async function addProjectFn(data: {
  projectType: string;
  name: string;
  intro: string;
  type: string;
  artStyle: string;
  directorManual: string;
  videoRatio: string;
  imageModel: string;
  videoModel: string;
  imageQuality: string;
  mode: string;
  creativePrompt?: string;
  startBuiltinAgent?: boolean;
  idempotencyKey?: string;
}) {
  const { creativePrompt, startBuiltinAgent, idempotencyKey, ...projectPayload } = data;
  let response: any;
  try {
    response = await axios.post("/project/addProject", { ...projectPayload, idempotencyKey });
  } catch (e: any) {
    window.$message.error(e.message ?? $t("workbench.project.msg.addFailed"));
    return;
  }

  const projectIdValue = response?.data?.projectId;
  const projectId = Number(projectIdValue);
  if (!Number.isFinite(projectId)) {
    window.$message.error("项目创建响应缺少 projectId，未启动内置 Agent");
    return;
  }
  if (startBuiltinAgent) {
    try {
      await builtinAgentStore().startRun({
        agentType: "scriptAgent",
        projectId,
        scriptId: null,
        prompt: creativePrompt?.trim() || projectPayload.intro,
        limits: { maxImageGenerations: 0, maxVideoGenerations: 0 },
      });
      window.$message.success("项目创建成功，已交给内置 Agent");
    } catch (e: any) {
      window.$message.warning(`项目已创建，但内置 Agent 启动失败：${e.message ?? "请稍后在项目页重试"}`);
    }
  } else {
    window.$message.success($t("workbench.project.msg.addSuccess"));
  }
  dialogShow.value = false;
  await getAllProject();
}

function delProjcer(target: (typeof allProject.value)[number]) {
  if (!Number.isSafeInteger(target.version) || Number(target.version) < 0) {
    window.$message.error("项目版本尚未加载，请刷新后重试");
    return getAllProject();
  }
  const projectId = target.id;
  const dialog = DialogPlugin.confirm({
    header: $t("workbench.project.msg.deleteHeader"),
    body: $t("workbench.project.msg.deleteBody"),
    confirmBtn: $t("workbench.project.msg.deleteConfirm"),
    cancelBtn: $t("workbench.project.msg.deleteCancel"),
    onConfirm: () => {
      axios
        .post("/project/delProject", {
          id: Number(projectId),
          expectedVersion: Number(target.version),
          idempotencyKey: createIdempotencyKey("project-delete"),
        })
        .then(() => {
          clearProjectCache(projectId!);
          window.$message.success($t("workbench.project.msg.deleteSuccess"));
          getAllProject();
        })
        .catch((e) => {
          window.$message.error(e.message ?? $t("workbench.project.msg.deleteFailed"));
        })
        .finally(() => {
          dialog.destroy();
        });
    },
  });
}
</script>

<style lang="scss" scoped>
.project {
  .header {
    padding-top: 32px;
    margin-bottom: 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    .title {
      font-size: 32px;
      font-weight: 600;
      color: var(--td-text-color-primary);
    }
    .sub {
      opacity: 0.5;
      color: var(--td-text-color-secondary);
    }
  }
  .list {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    .card {
      width: 100%;
      height: 100%;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      .title {
        font-size: 20px;
        font-weight: bold;
        margin-bottom: 8px;
      }
      .intro {
        height: 100%;
        margin-top: 5px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .bottomMenu {
        margin-top: 32px;
        .time {
          opacity: 0.5;
        }
        .actionBtns {
          gap: 12px;
        }
        .editBtn {
          cursor: pointer;
          &:hover {
            color: var(--td-brand-color);
          }
        }
        .removeBtn {
          cursor: pointer;
          &:hover {
            color: red;
          }
        }
      }
    }
  }
}
:deep(.t-col) {
  height: auto !important;
}
:deep(.t-card__body) {
  display: flex;
  flex-direction: column;
  flex: 1;
}
</style>
