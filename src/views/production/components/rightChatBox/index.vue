<template>
  <div class="rightChatBox" :style="{ width: boxWidth + 'px' }">
    <div ref="resizeHandleRef" class="resizeHandle"></div>
    <div class="header f ac jb">
      <span class="text">
        <i-dot theme="outline" :fill="connected ? 'green' : 'red'" />
        {{ props.title }}
      </span>
      <div class="close">
        <i-click-to-fold size="18" @click.stop="emit('close')" />
      </div>
    </div>
    <div class="chatBox" v-loading="loadingHistory">
      <BuiltinRunPanel
        ref="builtinRunPanelRef"
        agent-type="productionAgent"
        :project-id="project?.id"
        :script-id="episodesId"
        :think-level="thinkLevel"
        title="制作内置 Agent"
        :show-composer="false" />
      <t-chat-list :clear-history="false">
        <template v-for="message in visibleMessages" :key="message.id">
        <t-chat-message
          v-if="getBuiltinArtifact(message)"
          :message="message"
          :name="(message as any).name"
          :placement="message.role === 'user' ? 'right' : 'left'"
          :variant="message.role === 'user' ? 'base' : 'outline'"
          :status="message.status"
          allowContentSegmentCustom>
          <template #content>
            <div class="builtinArtifactCard">
              <strong>{{ getBuiltinArtifact(message)?.title }}</strong>
              <span>{{ getBuiltinArtifact(message)?.detail }}</span>
              <t-tag v-if="getBuiltinArtifact(message)?.selected === false" size="small" theme="warning" variant="light">待选择</t-tag>
              <t-button size="small" variant="outline" @click="openBuiltinArtifact(getBuiltinArtifact(message)!.target)">
                {{ getBuiltinArtifact(message)?.actionLabel }}
              </t-button>
            </div>
          </template>
        </t-chat-message>
        <t-chat-message
          v-else
          :key="message.id"
          :message="message"
          :name="(message as any).name"
          :placement="message.role === 'user' ? 'right' : 'left'"
          :variant="message.role === 'user' ? 'base' : 'outline'"
          :handleActions="message.role === 'user' ? {} : handleActions"
          :status="message.status"
          allowContentSegmentCustom>
          <!-- <template #actionbar>
            <t-chat-actionbar :action-bar="['replay', 'copy']" />
          </template> -->
        </t-chat-message>
        </template>
      </t-chat-list>
      <t-chat-sender
        class="inputBox"
        :disabled="composerBusy"
        v-model="inputValue"
        :loading="composerBusy"
        :placeholder="$t('workbench.production.chatBox.inputPlaceholder')"
        @send="handleSend"
        @stop="handleStop">
        <template #footer-prefix>
          <div class="ac" style="gap: 5px">
            <t-popup trigger="click" placement="top-left">
              <t-button shape="square" variant="outline" size="small">
                <template #icon>
                  <i-setting-config size="16" />
                </template>
              </t-button>
              <template #content>
                <div class="settingMenu">
                  <div class="settingMenuItem" @click="handleReconnect()">
                    <i-api size="14" />
                    <span>{{ $t("workbench.scriptAgent.reconnect") }}</span>
                  </div>
                  <div class="settingMenuItem" @click="handleClearMemory('message')">
                    <i-delete size="14" />
                    <span>{{ $t("workbench.production.chatBox.clearMessageMemory") }}</span>
                  </div>
                  <div class="settingMenuItem" @click="handleClearMemory('summary')">
                    <i-close size="14" />
                    <span>{{ $t("workbench.production.chatBox.clearSummaryMemory") }}</span>
                  </div>
                  <div class="settingMenuItem danger" @click="handleClearMemory('all')">
                    <i-delete-one size="14" />
                    <span>{{ $t("workbench.production.chatBox.clearAllMemory") }}</span>
                  </div>
                </div>
              </template>
            </t-popup>
            <t-popup trigger="click" placement="top" v-if="showThink">
              <t-button size="small" variant="outline" :theme="thinkThemes[thinkLevel] || 'default'">
                <template #icon>
                  <i-tips size="16" />
                </template>
                {{ thinkLevelOptions[thinkLevel]?.label }}
              </t-button>
              <template #content>
                <div class="settingMenu">
                  <div
                    v-for="opt in thinkLevelOptions"
                    :key="opt.value"
                    class="settingMenuItem"
                    :class="{ active: thinkLevel === opt.value }"
                    @click="productionAgentStore().updateThinkConfig(opt.value)">
                    <span>{{ opt.label }}</span>
                  </div>
                </div>
              </template>
            </t-popup>
          </div>
        </template>
      </t-chat-sender>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMousePressed, useMouse } from "@vueuse/core";
import _ from "lodash";
import axios from "@/utils/axios";
import productionAgentStore from "@/stores/productionAgent";
import BuiltinRunPanel from "@/components/builtinAgent/BuiltinRunPanel.vue";
import builtinAgentStore from "@/stores/builtinAgent";
import { builtinScopeKey, type BuiltinArtifactTarget, type BuiltinArtifactView } from "@/types/builtinAgent";
import type { ChatMessagesData } from "@tdesign-vue-next/chat";
import projectStore from "@/stores/project";
const { project } = storeToRefs(projectStore());
const builtinRunPanelRef = ref<{ startPrompt: (value: string) => Promise<void> } | null>(null);
const { connected, messages, status, episodesId, loadingHistory, thinkLevel } = storeToRefs(productionAgentStore());
const builtinRuns = builtinAgentStore();
const builtinScope = computed(() => ({
  agentType: "productionAgent" as const,
  projectId: project.value?.id == null ? null : Number(project.value.id),
  scriptId: episodesId.value == null ? null : Number(episodesId.value),
}));
const selectedBuiltinRun = computed(() => {
  const id = builtinRuns.selectedRunByScope[builtinScopeKey(builtinScope.value)];
  return id ? builtinRuns.runs[id] : undefined;
});
const composerBusy = computed(() => selectedBuiltinRun.value ? ["queued", "running"].includes(selectedBuiltinRun.value.status) : status.value === "pending" || status.value === "streaming");
type VisibleChatMessage = ChatMessagesData & { artifact?: BuiltinArtifactView };
const visibleMessages = computed<VisibleChatMessage[]>(() => {
  if (!selectedBuiltinRun.value) return messages.value as VisibleChatMessage[];
  return builtinRuns.messagesForRun(selectedBuiltinRun.value.id).map((message) => ({
    id: message.id,
    role: message.role,
    name: message.role === "assistant" ? "内置 Agent" : undefined,
    status: message.role === "system" ? "error" : "complete",
    content: [{ type: "text", status: "complete", data: message.text }],
    artifact: message.artifact,
  })) as VisibleChatMessage[];
});
function getBuiltinArtifact(message: ChatMessagesData): BuiltinArtifactView | undefined {
  return (message as VisibleChatMessage).artifact;
}
const thinkLevelOptions = [
  { label: $t("workbench.scriptAgent.thinkLevel.off"), value: 0 },
  { label: $t("workbench.scriptAgent.thinkLevel.light"), value: 1 },
  { label: $t("workbench.scriptAgent.thinkLevel.deep"), value: 2 },
  { label: $t("workbench.scriptAgent.thinkLevel.extreme"), value: 3 },
];
const thinkThemes = ["default", "success", "warning", "danger"] as const;

const props = defineProps({ title: String });

const emit = defineEmits<{
  close: [];
  navigateArtifact: [target: BuiltinArtifactTarget];
}>();

function openBuiltinArtifact(target: BuiltinArtifactTarget) {
  const runProjectId = selectedBuiltinRun.value?.projectId;
  if (runProjectId != null && Number(project.value?.id) !== runProjectId) {
    const runProject = projectStore().allProject.find((item) => Number(item.id) === runProjectId);
    if (!runProject) {
      window.$message.error("该产物所属项目当前不可用");
      return;
    }
    projectStore().project = runProject;
  }
  emit("navigateArtifact", target);
}

const inputValue = ref("");

function handleSend(text: string) {
  void builtinRunPanelRef.value?.startPrompt(text);
  inputValue.value = "";
}
function handleStop() {
  if (selectedBuiltinRun.value && ["queued", "running"].includes(selectedBuiltinRun.value.status)) {
    void builtinRuns.controlRun(selectedBuiltinRun.value.id, builtinScope.value, "cancel", "用户停止生成").catch(() => undefined);
  } else productionAgentStore().stopGenerate();
}
function handleReconnect() {
  const dialog = DialogPlugin.confirm({
    header: $t("workbench.scriptAgent.msg.reconnect"),
    body: $t("workbench.scriptAgent.msg.notReconnect"),
    confirmBtn: $t("workbench.scriptAgent.msg.keepReconnect"),
    cancelBtn: $t("workbench.scriptAgent.msg.cancel"),
    theme: "warning",
    onConfirm: async () => {
      productionAgentStore().reconnect();
      dialog.destroy();
    },
  });
}

//快捷发送
const handleActions = {
  suggestion: (data?: any) => {
    handleSend(data?.content?.prompt ?? "");
  },
};

const memoryTypeLabel: Record<string, string> = {
  message: $t("workbench.production.chatBox.messageMemory"),
  summary: $t("workbench.production.chatBox.summaryMemory"),
  all: $t("workbench.production.chatBox.allMemory"),
};
function handleClearMemory(type: "message" | "summary" | "all") {
  const dialog = DialogPlugin.confirm({
    header: $t("workbench.production.chatBox.confirmClear"),
    body: $t("workbench.production.chatBox.confirmClearBody", { type: memoryTypeLabel[type] }),
    confirmBtn: $t("workbench.production.chatBox.confirmClearBtn"),
    cancelBtn: $t("workbench.production.cancel"),
    theme: "warning",
    onConfirm: async () => {
      await axios.post(`/agents/clearMemory`, { projectId: project.value?.id, agentType: "productionAgent", episodesId: episodesId.value, type });
      window.$message.success($t("workbench.production.chatBox.memoryCleared", { type: memoryTypeLabel[type] }));
      dialog.destroy();
      productionAgentStore().getHistory();
    },
  });
}

const resizeHandleRef = ref<HTMLElement | null>(null);
const boxWidth = ref(400);
const MIN_WIDTH = 400;
const { pressed } = useMousePressed({ target: resizeHandleRef });
const { x } = useMouse();
const dragStartX = ref(0);
const dragStartWidth = ref(400);
watch(pressed, (isPressed) => {
  if (isPressed) {
    dragStartX.value = x.value;
    dragStartWidth.value = boxWidth.value;
  }
});
watchEffect(() => {
  if (pressed.value) {
    const maxWidth = window.innerWidth * 0.8;
    boxWidth.value = Math.min(maxWidth, Math.max(MIN_WIDTH, dragStartWidth.value + (dragStartX.value - x.value)));
  }
});

const showThink = ref(false);
onMounted(async () => {
  const { data } = await axios.post(`/project/getModelDetails`, { key: "productionAgent" });
  if (data && data.think) {
    showThink.value = true;
  }
});
watch(connected, (newVal) => {
  if (status.value != "idle" && newVal) {
    status.value = "idle";
  }
});
</script>

<style lang="scss" scoped>
.rightChatBox {
  position: absolute;
  top: 10px;
  right: 0;
  bottom: 10px;
  display: flex;
  flex-direction: column;
  z-index: 9999;
  min-width: 400px;
  height: calc(100% - 20px);
  margin-right: 5px;
  border-radius: 10px;
  border: 1px solid var(--td-border-level-1-color);
  background-color: var(--td-bg-color-container);
  overflow-y: auto;

  .resizeHandle {
    user-select: none;
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    cursor: col-resize;
    z-index: 10;
    &:hover {
      background-color: var(--td-bg-color-container-hover);
    }
  }
  box-shadow: -4px 2px 10px var(--td-shadow-1);
  .chatBox {
    width: 100%;
    height: calc(100% - 50px);
    display: flex;
    flex-direction: column;
    padding-left: 8px;
    .inputBox {
      padding-right: 8px;
    }
  }
  :deep(.t-chat__list) {
    padding-right: 8px;
  }
  .builtinArtifactCard {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    span { color: var(--td-text-color-secondary); }
  }
  .header {
    height: 40px;
    line-height: 40px;
    padding: 0 10px;
    flex-shrink: 0;
    .text {
      font-size: 18px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
    }
    .close {
      cursor: pointer;
      aspect-ratio: 1/1;
    }
  }
}

.settingMenu {
  padding: 4px 0;
  .settingMenuItem {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 16px;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    &:hover {
      background-color: var(--td-bg-color-container-hover);
    }
    &.danger {
      color: var(--td-error-color);
    }
  }
}
.modelSelCls {
  gap: 5px;
  .paramSelect {
    max-width: 80px;
  }
}
</style>
