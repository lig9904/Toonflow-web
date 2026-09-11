<template>
  <t-card class="storyboard">
    <div class="titleBar dragHandle pr">
      <div class="title">{{ $t("workbench.production.node.storyboard.title") }}</div>
      <Handle :id="props.handleIds.target" type="target" :position="Position.Left" style="left: calc(-1 * var(--td-comp-paddingLR-xl))" />
      <Handle :id="props.handleIds.source" type="source" :position="Position.Right" style="right: calc(-1 * var(--td-comp-paddingLR-xl))" />
    </div>
    <div class="content">
      <t-empty v-if="!storyboard.length" style="margin-top: 16px"></t-empty>
      <t-checkbox-group v-model="selectedIds">
        <div class="frameGrid">
          <template v-for="(item, index) in storyboard" :key="item.id">
            <div class="frameItem" @mouseenter="setHoveredFrame(index)" @mouseleave="setHoveredFrame(null)">
              <div class="addBetween addBetween--left" :class="{ expanded: hoveredIndex === index }">
                <t-button
                  theme="primary"
                  variant="outline"
                  shape="circle"
                  @click.stop="editStoryboaryImage(item, [index > 0 ? storyboard[index - 1]?.src || '' : '', item.src || ''], index - 1)">
                  <template #icon><i-plus /></template>
                </t-button>
              </div>

              <div class="frameCard">
                <div
                  class="frameImage"
                  :style="{
                    width: `${200 * gridScale}px`,
                    height: `${200 * gridScale}px`,
                  }">
                  <div class="ac frameCheckbox" :style="{ transform: `scale(${styleMaxSize})` }">
                    <t-checkbox :checked="selectedIds.includes(item.id!)" @click.stop :key="item?.id || index" :value="item.id" />
                    <t-tag class="frameTypeTag" :style="{ backgroundColor: tagColors[index % tagColors.length] }">
                      S{{ String(index + 1).padStart(2, "0") }}
                    </t-tag>
                    <div v-if="getStoryboardStateFor(item.id)" class="frameStateTags">
                      <t-tag size="small" variant="light" theme="primary">{{ reviewStateLabel(getStoryboardStateFor(item.id)?.reviewState) }}</t-tag>
                      <t-tag v-if="getStoryboardStateFor(item.id)?.locked" size="small" variant="light" theme="warning">锁定</t-tag>
                    </div>
                  </div>

                  <t-image
                    v-if="item.src && item.state == '已完成'"
                    :src="item.src"
                    fit="contain"
                    class="frameImg"
                    @click="editStoryboaryImage(item, [item.src])">
                    <template #overlayContent>
                      <div class="imageToolsWrap show">
                        <ImageTools :style="{ transform: `scale(${styleMaxSize})` }" :src="item.src" position="br" />
                      </div>
                    </template>
                  </t-image>
                  <div v-else class="generatingPlaceholder" @click="editStoryboaryImage(item, [])">
                    <t-loading v-if="item.state === '生成中'" size="small" />
                    <t-tooltip v-else-if="item.state == '生成失败'" :content="item?.reason">
                      <span style="color: #ff4d4f">生成失败</span>
                    </t-tooltip>
                    <t-empty v-else size="small" :title="$t('workbench.production.node.storyboard.notGenerated')" />
                  </div>
                  <t-tooltip theme="primary" :content="$t('workbench.production.node.storyboard.deleteNode')">
                    <div class="remove ac" :style="{ transform: `scale(${styleMaxSize})` }" @click.stop="removeFn(item.id!)">
                      <i-delete theme="outline" size="18" fill="#fff" />
                    </div>
                  </t-tooltip>
                  <t-tooltip theme="primary" :content="$t('workbench.production.node.storyboard.editNode')">
                    <div class="editNode ac" :style="{ transform: `scale(${styleMaxSize})` }" @click.stop="openEditInfo(item)">
                      <i-edit theme="outline" size="18" fill="#fff" />
                    </div>
                  </t-tooltip>
                </div>
              </div>
              <ImageReviewBadge :project-id="project?.id" :script-id="episodesId" target-kind="storyboard" :target-id="item.id" :src="item.src" />
              <div class="addBetween addBetween--right" :class="{ expanded: hoveredIndex === index }">
                <t-button
                  theme="primary"
                  variant="outline"
                  shape="circle"
                  @click.stop="
                    editStoryboaryImage(item, [item.src || '', index < (storyboard?.length ?? 0) - 1 ? storyboard[index + 1]?.src || '' : ''], index)
                  ">
                  <template #icon><i-plus /></template>
                </t-button>
              </div>
            </div>
          </template>
        </div>
      </t-checkbox-group>

      <div class="scaleControl">
        <span>{{ $t("workbench.production.node.storyboard.scaleRatio") }}</span>
        <t-input-number v-model="gridScale" :min="0.1" :max="3" :step="0.1" :decimal-places="1" size="small" style="width: 120px" />
      </div>
      <div class="ac" style="gap: 6px; margin-bottom: 6px; flex-wrap: wrap">
        <t-tag theme="primary" variant="light">{{ $t("workbench.production.node.storyboard.selectedCount", { count: selectedIds.length }) }}</t-tag>
        <t-button size="small" :disabled="!storyboard.length" theme="default" variant="outline" @click="selectedIds = []">
          {{ $t("workbench.production.node.storyboard.clearSelection") }}
        </t-button>
        <t-button size="small" :disabled="!storyboard.length" theme="default" variant="outline" @click="selectAll">
          {{ $t("workbench.production.node.storyboard.selectAll") }}
        </t-button>
        <t-button theme="danger" size="small" :disabled="!storyboard.length || !selectedIds.length" @click="handleDeleteSelected">批量删除</t-button>
      </div>
      <div class="ac" style="gap: 10px">
        <t-button block variant="outline" @click="openManualAdd">新增分镜</t-button>
        <t-button block @click="previewAll" :loading="previewLoading" :disabled="!storyboard.some(item => !!item.src) || previewLoading">{{ $t("workbench.production.node.storyboard.gridPreview") }}</t-button>
        <t-button block @click="batchGenerateImage" :disabled="!storyboard.length || !selectedIds.length" :loading="generateLoading">
          {{ $t("workbench.production.node.storyboard.generateImage") }}
        </t-button>

        <!-- <t-button block @click="batchGenerateImage" :disabled="!storyboard.length" :loading="generateLoading">
          {{ $t("workbench.production.node.storyboard.batchGenerateImage") }}
        </t-button> -->
      </div>
    </div>
    <t-dialog v-model:visible="manualAddVisible" header="新增分镜" :confirm-btn="{ content: '保存', loading: manualAdding }" :cancel-btn="'取消'" @confirm="addManualStoryboard">
      <t-form label-align="top">
        <t-form-item label="提示词">
          <t-textarea v-model="manualAddForm.prompt" :autosize="{ minRows: 3, maxRows: 6 }" placeholder="请输入分镜提示词" />
        </t-form-item>
        <t-form-item label="画面描述">
          <t-textarea v-model="manualAddForm.videoDesc" :autosize="{ minRows: 3, maxRows: 6 }" placeholder="请输入画面描述（可选）" />
        </t-form-item>
        <t-form-item label="时长（秒）">
          <t-input-number v-model="manualAddForm.duration" :min="1" :max="60" />
        </t-form-item>
      </t-form>
    </t-dialog>
    <editImage v-model="visible" v-if="visible" :flowData="currentRow" :draft-key="currentRowStoryboardInfo.id == null ? undefined : `storyboard:${currentRowStoryboardInfo.id}`" type="storyboard" @save="save" />
    <t-image-viewer
      v-model:visible="previewVisible"
      v-if="previewVisible"
      :images="previewImages"
      :onClose="closePreview"
      :onDownload="downLoadImage"
      :imageScale="{ max: 10, min: 0.1 }" />
  </t-card>
</template>

<script setup lang="ts">
import ImageReviewBadge from "@/components/reviews/imageReviewBadge.vue";
import { useLocalStorage } from "@vueuse/core";
import editImage from "../components/editImage/index.vue";
import { LoadingPlugin } from "tdesign-vue-next";
import { Handle, Position, type Edge } from "@vue-flow/core";
import axios from "@/utils/axios";
import type { AssetItem, Storyboard } from "../utils/flowBuilder";
import projectStore from "@/stores/project";
import productionAgentStore from "@/stores/productionAgent";
import {
  editStoryboardInfo,
  getProductionStateErrorMessage,
  getProductionStateErrorStatus,
  getStoryboardState,
  setStoryboardLock,
  setStoryboardReviewState,
  updateStoryboardUrl,
  type StoryboardReviewState,
  type StoryboardState,
  type StoryboardStateResponse,
} from "@/utils/productionState";
const { project } = storeToRefs(projectStore());
const productionAgent = productionAgentStore();
const { episodesId } = storeToRefs(productionAgent);

const props = defineProps<{
  id: string;
  handleIds: {
    target: string;
    source: string;
  };
  assetsData: AssetItem[];
}>();

const storyboard = defineModel<Storyboard[]>({ required: true });

const visible = ref(false);
const manualAddVisible = ref(false);
const manualAdding = ref(false);
const manualAddForm = reactive({ prompt: "", videoDesc: "", duration: 5 });
const previewVisible = ref(false);
const previewLoading = ref(false);
const previewImages = ref<string[]>([]);
const gridScale = useLocalStorage("storyboardGridScale", 1);

const hoveredIndex = ref<number | null>(null);
const selectedIds = ref<number[]>([]);

function setHoveredFrame(index: number | null) {
  hoveredIndex.value = index;
}

function selectAll() {
  selectedIds.value = storyboard.value.map((s) => s.id!).filter(Boolean);
}
function handleDeleteSelected() {
  const dialog = DialogPlugin.confirm({
    header: $t("workbench.assets.confirmDeleteHeader"),
    body: $t("workbench.production.node.storyboard.confirmBatchDeleteBody", { index: selectedIds.value.length }),
    confirmBtn: $t("workbench.assets.deleteBtn"),
    cancelBtn: $t("workbench.assets.cancelBtn"),
    theme: "warning",
    onConfirm: async () => {
      try {
        if (!selectedIds.value.length) {
          dialog.destroy();
          return window.$message.error($t("workbench.production.node.storyboard.pleaseSelectImage"));
        }
        const selectedItems = selectedIds.value.map((id) => storyboard.value.find((storyboardItem) => storyboardItem.id === id));
        const writable = await Promise.all(selectedItems.map((item) => (item ? ensureStoryboardWritable(item) : false)));
        if (writable.some((value) => !value)) {
          dialog.destroy();
          return;
        }
        const expectedVersions = Object.fromEntries(
          selectedItems.map((item) => [item!.id!, getStoryboardStateFor(item!.id)?.version]).filter(([, version]) => version != null),
        );
        if (Object.keys(expectedVersions).length !== selectedIds.value.length) {
          dialog.destroy();
          return window.$message.warning("分镜状态尚未读取，暂不能删除");
        }
        await axios.post("/production/storyboard/batchDelete", {
          ids: selectedIds.value,
          projectId: project.value?.id,
          expectedVersions,
        });
        storyboard.value = storyboard.value.filter((i) => !selectedIds.value.includes(i.id!));
        selectedIds.value = [];
        window.$message.success($t("workbench.production.node.storyboard.deleteSuccess"));
      } catch (e) {
        const status = getProductionStateErrorStatus(e);
        if (status === 409 || status === 423 || status === 403) window.$message.warning("分镜状态已变化或被锁定，请重新载入后再操作");
        else window.$message.error(getProductionStateErrorMessage(e, $t("workbench.production.node.storyboard.removeFailed")));
      } finally {
        dialog.destroy();
      }
    },
  });
}
const currentRow = ref<{
  flowId?: number | null;
  resultImages: { src: string; prompt: string }[];
  referanceImages: string[];
}>({
  flowId: null,
  resultImages: [],
  referanceImages: [],
});

const tagColors = ["#5bccb3", "#9c7cfc", "#fbbf24", "#5b9afc", "#e86b6b", "#7cb8fc", "#e8a855", "#34d399"];

function closePreview() {
  previewImages.value = [];
}
async function downLoadImage() {
  const loadingInstance = LoadingPlugin(true);
  const allIds = (storyboard.value ?? []).filter((s) => s.src).map((s) => s.id!);
  if (!allIds.length) {
    window.$message.warning($t("workbench.production.node.storyboard.noPreviewImages"));
    loadingInstance?.hide();
    return;
  }
  try {
    const res = await axios.post(
      "/production/storyboard/downPreviewImage",
      {
        storyboardIds: allIds,
        projectId: project.value?.id,
      },
      { responseType: "blob" },
    );
    // 创建下载链接
    const url = URL.createObjectURL(res as unknown as Blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `storyboardImagePreview-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    window.$message.error($t("workbench.production.node.storyboard.imageLoadFailed"));
  } finally {
    loadingInstance?.hide();
  }
}
async function previewAll() {
  if (previewLoading.value) return;
  const allIds = (storyboard.value ?? []).filter((s) => s.src).map((s) => s.id!);
  if (!allIds.length) {
    window.$message.warning($t("workbench.production.node.storyboard.noPreviewImages"));
    return;
  }
  previewLoading.value = true;
  try {
    const { data } = await axios.post("/production/storyboard/previewImage", {
      storyboardIds: allIds,
      projectId: project.value?.id,
    });
    if (typeof data !== "string" || !data.startsWith("data:image/")) throw new Error("尚无可预览的分镜图片");
    previewImages.value = [data];
    previewVisible.value = true;
  } catch (error) {
    previewVisible.value = false;
    previewImages.value = [];
    window.$message.error(getProductionStateErrorMessage(error, $t("workbench.production.node.storyboard.imageLoadFailed")));
  } finally {
    previewLoading.value = false;
  }
}
const currentRowStoryboardInfo = ref<{ id: number | null; insertAfterIndex: number | null }>({
  id: null,
  insertAfterIndex: null,
});
const imageEditExpectedVersion = ref<number>();
const styleMaxSize = computed(() => {
  if (gridScale.value <= 1) return gridScale.value;
  else 1;
});
const generateLoading = ref(false);
const stateById = reactive<Record<number, StoryboardState | undefined>>({});

function getStoryboardStateFor(id: number | undefined): StoryboardState | undefined {
  return id == null ? undefined : stateById[id];
}

function applyStoryboardState(item: Storyboard | undefined, response: StoryboardStateResponse) {
  if (!item || item.id == null) return;
  stateById[item.id] = response.state;
  Object.assign(item, response.storyboard, {
    collaboration: response.state,
    version: response.state.version,
    reviewState: response.state.reviewState,
    locked: response.state.locked,
    lockedBy: response.state.lockedBy,
    updatedBy: response.state.updatedBy,
    updatedAt: response.state.updatedAt,
  });
}

async function loadStoryboardState(item: Storyboard): Promise<StoryboardStateResponse | undefined> {
  if (item.id == null || project.value?.id == null) return undefined;
  try {
    const response = await getStoryboardState(project.value.id, item.id);
    applyStoryboardState(item, response);
    return response;
  } catch (error) {
    window.$message.error(getProductionStateErrorMessage(error, "无法读取分镜状态，已禁用写入"));
    return undefined;
  }
}

async function ensureStoryboardWritable(item: Storyboard): Promise<boolean> {
  const state = getStoryboardStateFor(item.id) ?? (await loadStoryboardState(item))?.state;
  if (!state) {
    window.$message.warning("分镜状态尚未读取，暂不能写入");
    return false;
  }
  if (state.locked) {
    window.$message.warning("分镜已锁定，暂不能写入");
    return false;
  }
  return true;
}

function reviewStateLabel(value: StoryboardReviewState | undefined): string {
  return { draft: "草稿", pending: "待审核", approved: "已通过", revision: "需修改" }[value ?? "draft"];
}
function openManualAdd() {
  manualAddForm.prompt = "";
  manualAddForm.videoDesc = "";
  manualAddForm.duration = 5;
  manualAddVisible.value = true;
}

async function addManualStoryboard() {
  if (manualAdding.value) return;
  const prompt = manualAddForm.prompt.trim();
  const duration = manualAddForm.duration;
  const projectId = project.value?.id;
  const scriptId = episodesId.value;
  if (!prompt) {
    window.$message.warning("请输入分镜提示词");
    return;
  }
  if (!Number.isFinite(duration) || duration < 1 || duration > 60) {
    window.$message.warning("请输入 1 到 60 秒的时长");
    return;
  }
  if (projectId == null || scriptId == null) {
    window.$message.error("当前项目或剧本尚未准备好");
    return;
  }
  manualAdding.value = true;
  try {
    const { data } = await axios.post("/production/storyboard/addStoryboard", {
      projectId,
      scriptId,
      prompt,
      duration,
      videoDesc: manualAddForm.videoDesc.trim(),
      src: null,
    });
    if (project.value?.id === projectId && episodesId.value === scriptId) {
      await productionAgent.refreshStoryboard(data.id, scriptId);
    }
    manualAddVisible.value = false;
    window.$message.success("分镜已新增");
  } catch (error) {
    window.$message.error(getProductionStateErrorMessage(error, "新增分镜失败"));
  } finally {
    manualAdding.value = false;
  }
}

async function batchGenerateImage() {
  if (!selectedIds.value.length) return window.$message.warning("请先选择分镜面板");
  const writable = await Promise.all(
    selectedIds.value.map((id) => {
      const item = storyboard.value.find((storyboardItem) => storyboardItem.id === id);
      return item ? ensureStoryboardWritable(item) : false;
    }),
  );
  if (writable.some((value) => !value)) return;
  generateLoading.value = true;
  try {
    await productionAgent.batchGenerateStoryboard(selectedIds.value, true);
    window.$message.success($t("workbench.production.node.storyboard.batchGenerateSuccess"));
    selectedIds.value = [];
  } catch (e) {
    await productionAgent.getFlowData();
    window.$message.error(getProductionStateErrorMessage(e, $t("workbench.production.node.storyboard.batchGenerateFailed")));
  } finally {
    generateLoading.value = false;
  }
}
async function editStoryboaryImage(item: Storyboard, images: string[], insertAfterIndex: number | null = null) {
  if (insertAfterIndex == null) {
    const state = (await loadStoryboardState(item))?.state;
    if (!state || state.locked) {
      if (state?.locked) window.$message.warning("分镜已锁定，暂不能编辑");
      return;
    }
    imageEditExpectedVersion.value = state.version;
    if (item.id != null) productionAgent.setStoryboardEditing(item.id, true);
  } else {
    imageEditExpectedVersion.value = undefined;
  }
  currentRowStoryboardInfo.value = {
    id: insertAfterIndex == null ? item?.id! : null,
    insertAfterIndex,
  };
  currentRow.value = {
    flowId: item?.flowId ?? null,
    resultImages: [],
    referanceImages: [],
  };

  if (currentRowStoryboardInfo.value.id) {
    let imagesPush: string[] = [];

    if (item.associateAssetsIds && item.associateAssetsIds.length > 0) {
      const assetsImages: string[] = [];
      for (const id of item.associateAssetsIds) {
        // 先查顶层 asset
        const asset = props.assetsData.find((a) => a.id === id);
        if (asset) {
          if (asset.src) assetsImages.push(asset.src);
          continue;
        }
        // 再查 derive
        for (const a of props.assetsData) {
          const derive = a.derive?.find((d) => d.id === id);
          if (derive) {
            if (derive.src) assetsImages.push(derive.src);
            break;
          }
        }
      }
      imagesPush = imagesPush.concat(assetsImages);
    }
    // if (item?.referenceIds && item.referenceIds.length > 0) {
    //   const referenImages = storyboard.value
    //     .filter((s) => item.referenceIds!.includes(s.id))
    //     .map((s) => s.src)
    //     .filter(Boolean) as string[];
    //   imagesPush = imagesPush.concat(referenImages);
    // }
    currentRow.value.referanceImages = imagesPush;
    currentRow.value.resultImages = [{ src: images.length ? images[0] : "", prompt: item.prompt ?? "" }];
  } else {
    currentRow.value.referanceImages = images.filter(Boolean);
  }
  visible.value = true;
}

async function save({ imageUrl, flowId }: { imageUrl: string; flowId: number }) {
  if (!imageUrl) return;

  const { id, insertAfterIndex } = currentRowStoryboardInfo.value;

  // 插入模式：在两张图之间新增一条分镜
  if (id === null && insertAfterIndex !== null) {
    const newFrame: Storyboard = {
      duration: 0,
      prompt: "",
      src: imageUrl,
      videoDesc: "",
      shouldGenerateImage: 1,
      state: "已完成",
    };
    const { data } = await axios.post("/production/storyboard/addStoryboard", {
      ...newFrame,
      projectId: project.value?.id,
      scriptId: episodesId.value,
      flowId,
    });

    const collaboration = data.collaboration as Storyboard["collaboration"] | undefined;
    storyboard.value.splice(insertAfterIndex + 1, 0, {
      ...newFrame,
      id: data.id!,
      flowId,
      collaboration,
      version: collaboration?.version,
      reviewState: collaboration?.reviewState,
      locked: collaboration?.locked,
      lockedBy: collaboration?.lockedBy,
      updatedBy: collaboration?.updatedBy,
      updatedAt: collaboration?.updatedAt,
    });
    productionAgent.setFlowData();
    return;
  }

  // 更新模式：更新对应分镜的 src
  const target = storyboard.value.find((s) => s.id === id);
  const expectedVersion = imageEditExpectedVersion.value;
  const state = target ? getStoryboardStateFor(target.id) : undefined;
  if (!target || expectedVersion == null || !state) {
    window.$message.warning("分镜状态尚未读取，暂不能保存");
    return;
  }
  if (state.locked) {
    window.$message.warning("分镜已锁定，暂不能保存");
    return;
  }
  try {
    const response = await updateStoryboardUrl(project.value!.id, id!, expectedVersion, imageUrl, flowId);
    if (response) applyStoryboardState(target, response);
    else {
      target.src = imageUrl;
      target.state = "已完成";
      target.flowId = flowId;
    }
    await loadStoryboardState(target);
    visible.value = false;
  } catch (error) {
    const status = getProductionStateErrorStatus(error);
    window.$message.error(
      status === 409 || status === 423 || status === 403
        ? "分镜状态已变化或被锁定，请重新载入后再保存"
        : getProductionStateErrorMessage(error, "分镜图片保存失败"),
    );
  }
}

watch(visible, (isVisible) => {
  if (!isVisible && currentRowStoryboardInfo.value.id != null) {
    productionAgent.setStoryboardEditing(currentRowStoryboardInfo.value.id, false);
  }
  if (!isVisible) imageEditExpectedVersion.value = undefined;
});

async function removeFn(id: number) {
  const dialog = DialogPlugin.confirm({
    header: $t("workbench.assets.confirmDeleteHeader"),
    body: $t("workbench.production.node.storyboard.confirmDeleteBody"),
    confirmBtn: $t("workbench.assets.deleteBtn"),
    cancelBtn: $t("workbench.assets.cancelBtn"),
    theme: "warning",
    onConfirm: async () => {
      if (!id) {
        const index = storyboard.value.findIndex((s) => s.id === id);
        if (index !== -1) {
          storyboard.value.splice(index, 1);
        }
        dialog.destroy();
        return;
      }
      try {
        const target = storyboard.value.find((s) => s.id === id);
        if (!target || !(await ensureStoryboardWritable(target))) {
          dialog.destroy();
          return;
        }
        const expectedVersion = getStoryboardStateFor(target.id)?.version;
        if (expectedVersion == null) {
          dialog.destroy();
          return window.$message.warning("分镜状态尚未读取，暂不能删除");
        }
        await axios.post("/production/storyboard/removeFrame", {
          id,
          projectId: project.value?.id,
          expectedVersion,
        });
        const index = storyboard.value.findIndex((s) => s.id === id);
        if (index !== -1) {
          storyboard.value.splice(index, 1);
        }
      } catch (e) {
        const status = getProductionStateErrorStatus(e);
        if (status === 409 || status === 423 || status === 403) window.$message.warning("分镜状态已变化或被锁定，请重新载入后再操作");
        else window.$message.error(getProductionStateErrorMessage(e, $t("workbench.production.node.storyboard.removeFailed")));
      } finally {
        dialog.destroy();
      }
    },
  });
}

async function editInfo(item: Storyboard) {
  if (item.id == null || project.value?.id == null) return;
  productionAgent.setStoryboardEditing(item.id, true);
  const loaded = await loadStoryboardState(item);
  if (!loaded) {
    productionAgent.setStoryboardEditing(item.id, false);
    return;
  }

  const formData = reactive({
    prompt: loaded.storyboard.prompt ?? "",
    videoDesc: loaded.storyboard.videoDesc ?? "",
  });
  const editState = ref(loaded.state);
  const expectedVersion = ref(loaded.state.version);
  const operationLoading = ref(false);
  const operationError = ref("");

  const refreshDialogBody = () =>
    confirmDialog.update({
      body: bodyVNode,
      confirmBtn: { disabled: editState.value.locked || operationLoading.value },
    });
  const setOperationError = (message: string) => {
    operationError.value = message;
    refreshDialogBody();
  };
  const applyResponse = (response: StoryboardStateResponse) => {
    applyStoryboardState(item, response);
    editState.value = response.state;
    expectedVersion.value = response.state.version;
  };

  const reloadBaseline = async () => {
    operationLoading.value = true;
    try {
      const response = await loadStoryboardState(item);
      if (!response) return;
      formData.prompt = response.storyboard.prompt ?? "";
      formData.videoDesc = response.storyboard.videoDesc ?? "";
      editState.value = response.state;
      expectedVersion.value = response.state.version;
      operationError.value = "";
      refreshDialogBody();
    } finally {
      operationLoading.value = false;
      refreshDialogBody();
    }
  };

  const changeReviewState = async (reviewState: StoryboardReviewState) => {
    if (editState.value.locked || operationLoading.value) return;
    operationLoading.value = true;
    try {
      applyResponse(await setStoryboardReviewState(project.value!.id, item.id!, expectedVersion.value, reviewState));
      operationError.value = "";
      refreshDialogBody();
    } catch (error) {
      const status = getProductionStateErrorStatus(error);
      if (status === 409 || status === 423 || status === 403) setOperationError("审核状态已变化或当前无权限，请重新载入");
      else window.$message.error(getProductionStateErrorMessage(error, "审核状态更新失败"));
    } finally {
      operationLoading.value = false;
      refreshDialogBody();
    }
  };

  const changeLock = async (locked: boolean) => {
    if (operationLoading.value) return;
    operationLoading.value = true;
    try {
      applyResponse(await setStoryboardLock(project.value!.id, item.id!, expectedVersion.value, locked));
      operationError.value = "";
      refreshDialogBody();
    } catch (error) {
      const status = getProductionStateErrorStatus(error);
      if (status === 409 || status === 423 || status === 403) setOperationError("锁状态已变化或当前无权限，请重新载入");
      else window.$message.error(getProductionStateErrorMessage(error, "锁状态更新失败"));
    } finally {
      operationLoading.value = false;
      refreshDialogBody();
    }
  };

  const bodyVNode = () =>
    h("div", { class: "storyboardEditInfoForm" }, [
      h("div", { class: "editInfoStateBar" }, [
        h(resolveComponent("t-tag"), { theme: editState.value.locked ? "warning" : "primary", variant: "light" }, () =>
          editState.value.locked ? "已锁定" : `${reviewStateLabel(editState.value.reviewState)} · v${editState.value.version}`,
        ),
        h(resolveComponent("t-button"), {
          size: "small",
          variant: "text",
          loading: operationLoading.value,
          onClick: reloadBaseline,
        }, () => "重新载入"),
      ]),
      operationError.value
        ? h("div", { class: "editInfoConflict" }, operationError.value)
        : null,
      h("div", { class: "editInfoField" }, [
        h("label", { class: "editInfoLabel" }, $t("workbench.production.node.storyboard.prompt")),
        h(resolveComponent("t-textarea"), {
          value: formData.prompt,
          disabled: editState.value.locked || operationLoading.value,
          placeholder: $t("workbench.production.node.storyboard.promptPlaceholder"),
          autosize: { minRows: 3, maxRows: 6 },
          "onUpdate:value": (v: string) => (formData.prompt = v),
        }),
      ]),
      h("div", { class: "editInfoField" }, [
        h("label", { class: "editInfoLabel" }, $t("workbench.production.node.storyboard.videoDesc")),
        h(resolveComponent("t-textarea"), {
          value: formData.videoDesc,
          disabled: editState.value.locked || operationLoading.value,
          placeholder: $t("workbench.production.node.storyboard.videoDescPlaceholder"),
          autosize: { minRows: 3, maxRows: 6 },
          "onUpdate:value": (v: string) => (formData.videoDesc = v),
        }),
      ]),
      h("div", { class: "editInfoActions" }, [
        h(resolveComponent("t-button"), { size: "small", variant: "outline", disabled: editState.value.locked || operationLoading.value, onClick: () => changeReviewState("pending") }, () => "提交审核"),
        h(resolveComponent("t-button"), { size: "small", variant: "outline", disabled: editState.value.locked || operationLoading.value, onClick: () => changeReviewState("approved") }, () => "通过"),
        h(resolveComponent("t-button"), { size: "small", variant: "outline", disabled: editState.value.locked || operationLoading.value, onClick: () => changeReviewState("revision") }, () => "退回修改"),
        h(resolveComponent("t-button"), { size: "small", variant: "outline", loading: operationLoading.value, onClick: () => changeLock(!editState.value.locked) }, () =>
          editState.value.locked ? "解锁" : "锁定",
        ),
      ]),
    ]);

  const confirmDialog = DialogPlugin.confirm({
    header: $t("workbench.production.node.storyboard.editInfo"),
    body: bodyVNode,
    width: 520,
    confirmBtn: {
      content: $t("common.submit"),
      theme: "primary",
      loading: false,
      disabled: editState.value.locked,
    },
    onConfirm: async () => {
      if (editState.value.locked) return;
      let shouldClose = false;
      confirmDialog.update({ confirmBtn: { content: $t("common.submitting"), loading: true } });
      try {
        const response = await editStoryboardInfo(project.value!.id, item.id!, expectedVersion.value, formData.prompt, formData.videoDesc);
        applyResponse(response);
        operationError.value = "";
        productionAgent.setStoryboardEditing(item.id!, false);
        window.$message.success($t("common.editSuccess"));
        shouldClose = true;
      } catch (error) {
        const status = getProductionStateErrorStatus(error);
        if (status === 409 || status === 423 || status === 403) {
          setOperationError(status === 423 ? "分镜已锁定，请重新载入" : "分镜内容已变化或当前无权限，请重新载入");
        } else {
          window.$message.error(getProductionStateErrorMessage(error, $t("common.editFailed")));
        }
      } finally {
        confirmDialog.update({ confirmBtn: { content: $t("common.submit"), loading: false, disabled: editState.value.locked } });
        refreshDialogBody();
        if (shouldClose) confirmDialog.destroy();
      }
    },
    onCancel: () => productionAgent.setStoryboardEditing(item.id!, false),
    onClose: () => productionAgent.setStoryboardEditing(item.id!, false),
  });
}

function openEditInfo(item: Storyboard) {
  void editInfo(item).catch((error) => {
    window.$message.error(getProductionStateErrorMessage(error, "打开分镜编辑失败"));
  });
}
</script>

<style lang="scss" scoped>
.storyboard {
  min-width: 500px;
  max-width: 100vw;
  user-select: text;
  cursor: default;

  .titleBar {
    cursor: grab;
    user-select: none;
  }
  .title {
    background-color: #000;
    width: fit-content;
    padding: 5px 10px;
    color: #fff;
    border-radius: 8px 0;
    font-size: 16px;
  }

  .content {
    margin-top: 12px;
  }

  .frameGrid {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 0;
  }

  .frameItem {
    position: relative;
    display: inline-flex;
    align-items: flex-start;
    margin: 4px;
  }

  .addBetween {
    position: absolute;
    z-index: 10;
    top: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    pointer-events: none;
    span {
      line-height: 1;
      white-space: nowrap;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    &.expanded {
      opacity: 1;
      pointer-events: auto;
    }
    &:hover {
      // background: var(--td-brand-color);
      // color: #fff;
      // transform: scale(1.15);
    }
    &--left {
      transform: translate(calc(-50% - 4px), -50%);
    }
    &--right {
      transform: translate(calc(50% + 4px), -50%);
      right: 0;
    }
  }

  .frameCard {
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition:
      transform 0.2s,
      box-shadow 0.2s;
  }

  .frameImage {
    position: relative;
    border-radius: 8px;
    overflow: hidden;
    flex-shrink: 0;
    transition: opacity 0.2s ease;
    &:hover {
      .remove,
      .editNode {
        opacity: 1;
      }
    }
    .remove {
      position: absolute;
      top: 3px;
      right: 3px;
      z-index: 9999;
      padding: 5px;
      border-radius: 10px;
      background-color: rgba(220, 50, 50, 0.7);
      cursor: pointer;
      opacity: 0;
      transform-origin: top right;
      &:hover {
        background-color: rgba(220, 50, 50, 1);
      }
    }
    .editNode {
      position: absolute;
      bottom: 3px;
      left: 3px;
      z-index: 9999;
      padding: 5px;
      border-radius: 10px;
      background-color: rgba(24, 144, 255, 0.7);
      cursor: pointer;
      transform-origin: bottom left;
      opacity: 0;
      &:hover {
        background-color: rgba(24, 144, 255, 1);
      }
    }
  }

  .generatingPlaceholder {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background-color: var(--td-bg-color-container-hover, #f5f5f5);
    font-size: 12px;
  }

  .frameImg {
    width: 100%;
    height: 100%;
    object-fit: cover;
    .imageToolsWrap {
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }

    &:hover {
      .imageToolsWrap {
        opacity: 1;
        pointer-events: auto;
      }
    }
  }

  .frameCheckbox {
    position: absolute;
    left: 3px;
    top: 3px;
    z-index: 3;
    transform-origin: top left;
  }

  .frameTypeTag {
    color: #fff;
    font-size: 10px;
    font-weight: 600;
    border: none;
    z-index: 2;
    padding: 0 4px;
    line-height: 18px;
    border-radius: 3px;
  }

  .frameStateTags {
    display: flex;
    gap: 3px;
    margin-top: 3px;
  }

  .frameTag {
    position: absolute;
    right: 8px;
    bottom: 8px;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    border: none;
  }

  .scaleControl {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 13px;
    color: var(--td-text-color-primary, #333);
  }

  .frameInfo {
    margin-top: 6px;
    font-size: 12px;
    color: var(--td-text-color-primary, #333);
    line-height: 1.4;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
:deep(.t-image__wrapper) {
  background-color: transparent !important;
}
</style>

<style lang="scss">
.storyboardEditInfoForm {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0;
  .editInfoStateBar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }

  .editInfoActions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .editInfoField {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .editInfoLabel {
    font-size: 13px;
    color: var(--td-text-color-secondary);
  }

  .editInfoField .t-textarea,
  .editInfoField .t-textarea__inner {
    width: 100%;
    box-sizing: border-box;
    border-radius: 6px;
  }

  .editInfoField .t-textarea__inner {
    padding: 8px 10px;
  }

  .editInfoConflict {
    padding: 6px 8px;
    color: var(--td-error-color-7);
    background: var(--td-error-color-1);
    border-radius: 4px;
    font-size: 12px;
  }
}
</style>
