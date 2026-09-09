import axios from "@/utils/axios";
import projectStore from "@/stores/project";
import settingStore from "@/stores/setting";
import { useChat } from "@/utils/useChat";
import type { FlowData, Storyboard } from "@/views/production/utils/flowBuilder";
import {
  getProductionStateErrorMessage,
  getProductionStateErrorStatus,
  getStoryboardState,
  type StoryboardStateResponse,
} from "@/utils/productionState";
import type { ChatMessagesData } from "@tdesign-vue-next/chat";
import { useThrottleFn } from "@vueuse/core";
import builtinAgentStore from "@/stores/builtinAgent";
import type { BuiltinRunLimits } from "@/types/builtinAgent";

function makeProductionAgentStore(projectId: string) {
  return defineStore(`productionAgent-${projectId}`, () => {
    const defMsg: ChatMessagesData[] = [
      {
        id: "welcome",
        role: "assistant",
        content: [
          { type: "text", status: "complete", data: $t("workbench.production.chatBox.welcomeMessage") },
          {
            type: "suggestion",
            status: "complete",
            data: [{ title: $t("workbench.production.chatBox.startMakingVideo"), prompt: $t("workbench.production.chatBox.startMakingVideoPrompt") }],
          },
        ],
      },
    ];
    onMounted(() => {
      if (messages.value.length <= 0) messages.value = [...defMsg, ...messages.value];
    });

    const flowData = ref<FlowData>({
      script: "", // 剧本
      scriptPlan: "", //导演计划
      storyboardTable: "", //分镜表
      assets: [], // 衍生资产
      storyboard: [], //分镜面板
      workbench: {
        videoList: [],
      }, // 工作台数据
    });

    const episodesId = ref<number>();
    const planningVersion = ref<number>();
    const planningEpisodeId = ref<number>();
    const storyboardEditingIds = ref<number[]>([]);
    const builtinRuns = builtinAgentStore();
    let flowLoadSequence = 0;
    type PendingFlowSave = { scriptId: number; expectedPlanningVersion: number; loadSequence: number; snapshot: FlowData };
    let pendingFlowSave: PendingFlowSave | null = null;
    const readPendingFlowSave = (): PendingFlowSave | null => pendingFlowSave;
    let flowSavePromise: Promise<void> | null = null;

    watch(episodesId, (nextEpisodeId, previousEpisodeId) => {
      if (previousEpisodeId == null || nextEpisodeId === previousEpisodeId) return;
      flowLoadSequence++;
      planningVersion.value = undefined;
      planningEpisodeId.value = undefined;
      pendingFlowSave = null;
    });

    const { connected, messages, chat, stopGenerate, socket, status, reconnect, connect, disconnect } = useChat({
      url: `${settingStore().baseUrl}/socket/productionAgent`,
      auth: () => ({
        isolationKey: `${projectId}:productionAgent:${episodesId.value}`,
        projectId: Number(projectId),
        scriptId: episodesId.value,
      }),
      manageLifecycle: false,
      autoConnect: false,
      xmlTags: [
        { tag: "script", keepInMessage: false },
        { tag: "scriptPlan", keepInMessage: false },
        { tag: "storyboardTable", keepInMessage: false },
        { tag: "storyboardItem", keepInMessage: false },
      ],
      onXmlTag: async (data) => {
        const { tag, value, children, attrs, status } = data;
        if (tag === "script") {
          flowData.value.script = value ?? "";
        } else if (tag === "scriptPlan") {
          flowData.value.scriptPlan = value ?? "";
        } else if (tag === "storyboardTable") {
          flowData.value.storyboardTable = value ?? "";
        }
        // else if (tag === "storyboardItem") {
        //   if (status === "complete") {
        //     const prompt = attrs.prompt ?? "";
        //     const duration = Number(attrs.duration) || 0;
        //     const track = attrs.track || "";
        //     const shouldGenerateImage =
        //       (typeof attrs.shouldGenerateImage == "boolean" && attrs.shouldGenerateImage) ||
        //       String(attrs.shouldGenerateImage).toLowerCase() == "true"
        //         ? 1
        //         : 0;

        //     const videoDesc = attrs?.videoDesc ?? "";
        //     const existingIndex = flowData.value.storyboard.findIndex(
        //       (s) => s.prompt == prompt && s.duration == duration && videoDesc == s.videoDesc,
        //     );
        //     if (existingIndex !== -1) {
        //       // 已存在则更新 content，保留 id
        //       flowData.value.storyboard[existingIndex].prompt = prompt;
        //     } else {
        //       // 不存在则追加新条目
        //       flowData.value.storyboard.push({
        //         prompt: prompt || "",
        //         duration: Number(duration) || 0,
        //         state: "未生成" as "未生成" | "生成中" | "已完成" | "生成失败",
        //         src: null,
        //         associateAssetsIds: JSON.parse(attrs.associateAssetsIds) || [],
        //         videoDesc: videoDesc,
        //         shouldGenerateImage: shouldGenerateImage,
        //       });
        //       await addStoryboardInfo([
        //         {
        //           prompt: prompt || "",
        //           duration: Number(duration) || 0,
        //           track: track || "",
        //           state: "未生成" as "未生成" | "生成中" | "已完成" | "生成失败",
        //           src: null,
        //           videoDesc,
        //           shouldGenerateImage,
        //           associateAssetsIds: JSON.parse(attrs.associateAssetsIds) || [],
        //         },
        //       ]);
        //     }
        //   }
        // }
        if (status == "complete") {
          throttledFn();
        }
      },
    });

    // 实际的节流方法
    const throttledFn = useThrottleFn(
      () => {
        setFlowData(episodesId.value);
      },
      500,
      true,
      true,
    );
    // 注册 getPlanData 事件（无需依赖组件生命周期）
    watch(
      socket,
      (s) => {
        if (s) {
          s.on("connect", () => {
            getHistory();
          });
          s.on("productionStateChanged", (event: { projectId: number | string; scriptId: number | string; storyboardId?: number | string | null }) => {
            if (Number(event?.projectId) !== Number(projectId) || Number(event?.scriptId) !== Number(episodesId.value)) return;
            const storyboardId = Number(event?.storyboardId);
            if (event?.storyboardId != null && event?.storyboardId !== "" && Number.isFinite(storyboardId)) void refreshStoryboard(storyboardId, Number(event.scriptId));
            else void refreshStoryboardWorkflow(Number(event.scriptId));
          });
          s.on("getFlowData", (_, callback) => {
            const returnData = JSON.parse(JSON.stringify(flowData.value));
            returnData.assets.forEach((item: any) => {
              delete item.prompt;
              delete item.flowId;
              delete item.src;
              if (item.derive && item.derive.length) {
                item.derive.forEach((deriveItem: any) => {
                  delete deriveItem.prompt;
                  delete deriveItem.flowId;
                  delete deriveItem.src;
                });
              }
            });
            returnData.storyboard.forEach((item: any) => {
              delete item.prompt;
              delete item.src;
              delete item.flowId;
            });
            callback(returnData);
          });
          s.on("addDeriveAsset", async (data, callback) => {
            const assets = flowData.value.assets.find((a) => a.id === data.assetsId);
            if (!assets) return callback({ success: false, message: $t("storyboard.assets.notExist") });
            const deriveAssetList = assets.derive || [];
            const item = deriveAssetList.find((d) => d.id === data.id);
            if (item) {
              if (!item) return callback({ success: false, message: $t("storyboard.assets.notDerivativeExist") });
              item.name = data.name;
              item.type = assets.type;
              callback({ success: true, message: $t("storyboard.assets.derivativeUpdateSuccess") });
            } else {
              deriveAssetList.push({
                assetsId: data.assetsId,
                id: data.id,
                name: data.name,
                type: assets.type,
                desc: data.describe,
                prompt: "",
                state: "未生成" as "未生成" | "生成中" | "已完成" | "生成失败",
                src: "",
              });
              callback({ success: true, message: $t("storyboard.assets.derivativeAddSuccess") });
            }
          });
          s.on("delDeriveAsset", async (data, callback) => {
            const assets = flowData.value.assets.find((a) => a.id === data.assetsId);
            if (!assets) return callback({ success: false, message: $t("storyboard.assets.notExist") });
            const deriveAssetList = assets.derive || [];
            const index = deriveAssetList.findIndex((d) => d.id === data.id);
            if (index === -1) return callback({ success: false, message: $t("storyboard.assets.notDerivativeExist") });
            deriveAssetList.splice(index, 1);
            callback({ success: true, message: $t("storyboard.assets.derivativeDelSuccess") });
          });
          s.on("generateDeriveAsset", async (data, callback) => {
            const assetsData = await batchGenerateAssets(data.ids);
            callback({ success: true, message: assetsData });
          });
          s.on("generateStoryboard", async (data, callback) => {
            const storyData = await batchGenerateStoryboard(data.ids);
            callback({ success: true, message: storyData });
          });
          s.on("addStoryboard", async (data, callback) => {
            const insertVal = {
              prompt: data.prompt || "",
              duration: Number(data.duration) || 0,
              track: data.track || "",
              state: "未生成" as "未生成" | "生成中" | "已完成" | "生成失败",
              src: null,
              videoDesc: data.videoDesc,
              shouldGenerateImage:
                (typeof data.shouldGenerateImage == "boolean" && data.shouldGenerateImage) || String(data.shouldGenerateImage).toLowerCase() == "true"
                  ? 1
                  : 0,
              associateAssetsIds: data.associateAssetsIds || [],
            };
            flowData.value.storyboard.push(insertVal);
            await addStoryboardInfo([insertVal]);
            throttledFn();
            callback({ success: true, message: $t("storyboard.assets.derivativeAddSuccess") });
          });
        }
      },
      { immediate: true },
    );

    function cloneFlowData(data: FlowData): FlowData {
      return JSON.parse(JSON.stringify(data)) as FlowData;
    }

    function applyStoryboardVersions(versions: Record<number, number> | undefined) {
      if (!versions) return;
      flowData.value.storyboard.forEach((item) => {
        if (item.id == null || versions[item.id] == null) return;
        const version = Number(versions[item.id]);
        if (!Number.isFinite(version)) return;
        item.version = version;
        item.collaboration = {
          ...(item.collaboration ?? {
            entityType: "storyboard",
            entityId: item.id,
            projectId,
            reviewState: "draft" as const,
            locked: false,
            lockedBy: null,
            updatedBy: null,
            updatedAt: null,
          }),
          entityId: item.id,
          projectId,
          version,
        };
      });
    }

    async function flushFlowSaves(): Promise<void> {
      while (pendingFlowSave) {
        const save = pendingFlowSave;
        pendingFlowSave = null;
        const isCurrentEpisode =
          save.scriptId === episodesId.value && save.scriptId === planningEpisodeId.value && save.loadSequence === flowLoadSequence;
        if (!isCurrentEpisode || planningVersion.value == null) {
          if (isCurrentEpisode) window.$message.warning("规划版本尚未读取，暂不保存");
          continue;
        }
        const expectedPlanningVersion = save.expectedPlanningVersion === planningVersion.value ? save.expectedPlanningVersion : planningVersion.value;
        try {
          const response = await axios.post("/production/saveFlowData", {
            projectId: Number(projectId),
            data: save.snapshot,
            episodesId: save.scriptId ?? episodesId.value,
            expectedPlanningVersion,
          });
          const data = response?.data ?? response;
          const nextVersion = Number(data?.planningVersion);
          if (!Number.isFinite(nextVersion)) {
            throw new Error("保存响应缺少 planningVersion");
          }
          if (save.scriptId === episodesId.value && save.scriptId === planningEpisodeId.value && save.loadSequence === flowLoadSequence) {
            planningVersion.value = nextVersion;
            applyStoryboardVersions(data?.storyboardVersions);
          }
        } catch (error) {
          const status = getProductionStateErrorStatus(error);
          if (status === 409) {
            window.$message.warning("规划已被其他会话修改，本地草稿已保留；请重新载入后再合并");
          } else {
            window.$message.error(getProductionStateErrorMessage(error, "规划保存失败"));
          }
          // A conflicting snapshot must never be retried against a newly fetched version.
          const queuedSave = readPendingFlowSave();
          if (queuedSave?.scriptId === save.scriptId && queuedSave.loadSequence === save.loadSequence) {
            pendingFlowSave = null;
          }
        }
      }
    }

    async function setFlowData(scriptId?: number): Promise<void> {
      const saveScriptId = scriptId ?? episodesId.value;
      if (saveScriptId == null || planningVersion.value == null || planningEpisodeId.value !== saveScriptId) {
        window.$message.warning("规划版本尚未读取，暂不保存");
        return;
      }
      pendingFlowSave = {
        scriptId: saveScriptId,
        expectedPlanningVersion: planningVersion.value,
        loadSequence: flowLoadSequence,
        snapshot: cloneFlowData(flowData.value),
      };
      if (!flowSavePromise) {
        flowSavePromise = flushFlowSaves().finally(() => {
          flowSavePromise = null;
          if (pendingFlowSave && planningVersion.value != null) void setFlowData(pendingFlowSave.scriptId);
        });
      }
      await flowSavePromise;
    }

    async function requestFlowData(scriptId: number): Promise<{ data: FlowData; planningVersion?: number }> {
      const { data } = await axios.post("/production/getFlowData", {
        projectId: Number(projectId),
        episodesId: scriptId,
      });
      const nextPlanningVersion = Number(data?.planningVersion);
      const { planningVersion: _planningVersion, ...nextFlowData } = data ?? {};
      return { data: nextFlowData as FlowData, planningVersion: Number.isFinite(nextPlanningVersion) ? nextPlanningVersion : undefined };
    }

    async function getFlowData() {
      const scriptId = episodesId.value;
      if (scriptId == null) return;
      const requestSequence = ++flowLoadSequence;
      const result = await requestFlowData(scriptId);
      if (requestSequence !== flowLoadSequence || episodesId.value !== scriptId) return;
      planningVersion.value = result.planningVersion;
      planningEpisodeId.value = scriptId;
      flowData.value = result.data;
    }

    function mergeStoryboardWorkflow(serverData: FlowData) {
      const localStoryboard = new Map(flowData.value.storyboard.filter((item) => item.id != null).map((item) => [item.id!, item]));
      const serverIds = new Set(serverData.storyboard.filter((item) => item.id != null).map((item) => item.id!));
      serverData.storyboard.forEach((serverItem) => {
        if (serverItem.id == null) return;
        const localItem = localStoryboard.get(serverItem.id);
        if (localItem && storyboardEditingIds.value.includes(serverItem.id)) return;
        if (localItem) Object.assign(localItem, serverItem);
        else flowData.value.storyboard.push(serverItem);
      });
      flowData.value.storyboard = flowData.value.storyboard.filter(
        (item) => item.id == null || serverIds.has(item.id) || storyboardEditingIds.value.includes(item.id),
      );
      flowData.value.assets = serverData.assets;
    }

    async function refreshStoryboardWorkflow(scriptId = episodesId.value) {
      if (scriptId == null || scriptId !== episodesId.value) return;
      const requestSequence = flowLoadSequence;
      try {
        const result = await requestFlowData(scriptId);
        if (requestSequence !== flowLoadSequence || episodesId.value !== scriptId) return;
        mergeStoryboardWorkflow(result.data);
      } catch (error) {
        console.error("[productionStateChanged] refresh workflow failed", error);
      }
    }

    watch(
      () => builtinRuns.artifactRevision({ agentType: "productionAgent", projectId: Number(projectId), scriptId: episodesId.value ?? null }),
      (revision, previousRevision) => {
        if (revision !== previousRevision && revision > 0 && episodesId.value != null) void refreshStoryboardWorkflow(episodesId.value);
      },
    );

    function setStoryboardEditing(id: number, editing: boolean) {
      if (editing) {
        if (!storyboardEditingIds.value.includes(id)) storyboardEditingIds.value.push(id);
      } else {
        storyboardEditingIds.value = storyboardEditingIds.value.filter((itemId) => itemId !== id);
      }
    }

    async function refreshStoryboard(id: number, scriptId = episodesId.value): Promise<StoryboardStateResponse | undefined> {
      if (scriptId == null || scriptId !== episodesId.value) return undefined;
      const requestSequence = flowLoadSequence;
      if (storyboardEditingIds.value.includes(id)) return undefined;
      try {
        const response = await getStoryboardState(projectId, id);
        if (requestSequence !== flowLoadSequence || episodesId.value !== scriptId) return undefined;
        const stateFields = {
          collaboration: response.state,
          version: response.state.version,
          reviewState: response.state.reviewState,
          locked: response.state.locked,
          lockedBy: response.state.lockedBy,
          updatedBy: response.state.updatedBy,
          updatedAt: response.state.updatedAt,
        };
        const target = flowData.value.storyboard.find((item) => item.id === id);
        if (target) Object.assign(target, response.storyboard, stateFields);
        else flowData.value.storyboard.push({ ...response.storyboard, ...stateFields } as Storyboard);
        return response;
      } catch (error) {
        if (getProductionStateErrorStatus(error) === 404) {
          flowData.value.storyboard = flowData.value.storyboard.filter((item) => item.id !== id || storyboardEditingIds.value.includes(id));
          return undefined;
        }
        console.error("[productionStateChanged] refresh storyboard failed", error);
        return undefined;
      }
    }
    async function batchGenerateStoryboard(allIds: number[], compulsory: boolean = false) {
      try {
        const { data } = await axios.post("/production/storyboard/batchGenerateImage", {
          scriptId: episodesId.value,
          projectId: Number(projectId),
          storyboardIds: allIds,
          concurrentCount: settingStore().otherSetting.assetsBatchGenereateSize,
          compulsory,
        });
        if (data) {
          if (flowData.value.storyboard.length === 0) {
            flowData.value.storyboard = data;
            return data;
          } else {
            flowData.value.storyboard.forEach((item) => {
              const findData = data.find((i: any) => i.id == item.id);
              if (findData) {
                item.state = findData.state;
                item.src = findData.src;
              }
            });
          }
        }
        return data;
      } catch (e) {
        throw e;
      }
    }
    async function batchGenerateAssets(allIds: number[]) {
      try {
        const { data } = await axios.post("/production/assets/batchGenerateAssetsImage", {
          assetIds: allIds,
          projectId: Number(projectId),
          scriptId: episodesId.value,
          concurrentCount: settingStore().otherSetting.assetsBatchGenereateSize,
        });
        if (data) {
          data.forEach((record: { id: number; state: "未生成" | "生成中" | "已完成" | "生成失败"; src: string }) => {
            flowData.value.assets.forEach((asset) => {
              if (asset.derive) {
                asset.derive.forEach((derive) => {
                  if (derive.id === record.id) {
                    derive.state = record.state;
                    derive.src = record.src;
                  }
                });
              }
            });
          });
        }
        return data;
      } catch (e) {
        throw e;
      }
    }
    const assetsNotStateImageIds = computed(() => {
      const ids: number[] = [];
      flowData.value.assets.forEach((asset) => {
        if (asset.derive) {
          asset.derive.forEach((derive) => {
            if (derive.state == ("生成中" as "未生成" | "生成中" | "已完成" | "生成失败")) {
              ids.push(derive.id);
            }
          });
        }
      });
      return ids;
    });
    const storyboardNotStateImageIds = computed(() => {
      const ids: number[] = [];
      flowData.value.storyboard.forEach((asset) => {
        if (asset.state == "生成中" && asset.id) {
          ids.push(asset.id);
        }
      });
      return ids;
    });
    // ---- 资产图片轮询 ----
    let assetsPollingTimer: number | null = null;
    let assetsPollingInFlight = false;

    async function pollAssetsImages() {
      const ids = assetsNotStateImageIds.value;
      if (ids.length === 0 || assetsPollingInFlight) return;
      assetsPollingInFlight = true;
      try {
        const { data } = await axios.post("/production/assets/pollingImage", {
          ids: ids,
        });
        if (!data || data.length === 0) return;
        const records = data as Array<{ id: number; state: string; src?: string; errorReason?: string; prompt?: string }>;
        records.forEach((record) => {
          flowData.value.assets.forEach((asset) => {
            if (!asset.derive) return;
            asset.derive.forEach((derive) => {
              if (derive.id === record.id) {
                derive.state = record.state as "未生成" | "生成中" | "已完成" | "生成失败";
                if (record.src) derive.src = record.src;
                derive.errorReason = record?.errorReason ?? "";
                derive.prompt = record?.prompt ?? "";
              }
            });
          });
        });
      } catch (e) {
        console.error("[assetsPolling] error", e);
      } finally {
        assetsPollingInFlight = false;
      }
    }

    function startAssetsPolling() {
      if (assetsPollingTimer) return;
      assetsPollingTimer = window.setInterval(async () => {
        if (assetsNotStateImageIds.value.length === 0) {
          stopAssetsPolling();
          return;
        }
        await pollAssetsImages();
      }, 5000);
      // 立即执行一次
      pollAssetsImages();
    }

    function stopAssetsPolling() {
      if (assetsPollingTimer) {
        clearInterval(assetsPollingTimer);
        assetsPollingTimer = null;
      }
    }

    watch(
      () => assetsNotStateImageIds.value,
      (ids) => {
        if (ids.length > 0) {
          startAssetsPolling();
        } else {
          stopAssetsPolling();
        }
      },
    );

    // ---- 分镜图片轮询 ----
    let storyboardPollingTimer: number | null = null;
    let storyboardPollingInFlight = false;

    async function pollStoryboardImages() {
      const ids = storyboardNotStateImageIds.value;
      if (ids.length === 0 || storyboardPollingInFlight) return;
      storyboardPollingInFlight = true;
      try {
        const { data } = await axios.post("/production/storyboard/pollingImage", {
          ids: ids,
        });
        if (!data || data.length === 0) return;
        const records = data as Array<{ id: number; state: string; src?: string; reason?: string }>;
        records.forEach((record) => {
          const item = flowData.value.storyboard.find((s) => s.id === record.id);
          if (item) {
            item.state = record.state as "未生成" | "生成中" | "已完成" | "生成失败";
            if (record.src) item.src = record.src;
            item.reason = record?.reason ?? "";
          }
        });
      } catch (e) {
        console.error("[storyboardPolling] error", e);
      } finally {
        storyboardPollingInFlight = false;
      }
    }

    function startStoryboardPolling() {
      if (storyboardPollingTimer) return;
      storyboardPollingTimer = window.setInterval(async () => {
        if (storyboardNotStateImageIds.value.length === 0) {
          stopStoryboardPolling();
          return;
        }
        await pollStoryboardImages();
      }, 5000);
      // 立即执行一次
      pollStoryboardImages();
    }

    function stopStoryboardPolling() {
      if (storyboardPollingTimer) {
        clearInterval(storyboardPollingTimer);
        storyboardPollingTimer = null;
      }
    }

    watch(
      () => storyboardNotStateImageIds.value,
      (ids) => {
        if (ids.length > 0) {
          startStoryboardPolling();
        } else {
          stopStoryboardPolling();
        }
      },
    );

    function updateContext() {
      if (episodesId.value! < 0) return;
      const ctx = {
        isolationKey: `${projectId}:productionAgent:${episodesId.value}`,
        projectId: Number(projectId),
        scriptId: episodesId.value,
      };
      if (!connected.value) connect();
      socket.value!.emit("updateContext", ctx);
    }
    async function addStoryboardInfo(items: any[]) {
      const { data } = await axios.post("/production/storyboard/batchAddStoryboardInfo", {
        scriptId: episodesId.value,
        data: items,
        projectId: Number(projectId),
      });

      flowData.value.storyboard.forEach((item) => {
        const updated = data.find((d: Storyboard) => d.prompt == item.prompt && d.duration == item.duration && d.videoDesc == item.videoDesc);
        if (updated) {
          item.id = updated.id;
          item.trackId = updated.trackId;
          item.src = updated.src;
          item.state = updated.state;
          item.associateAssetsIds = updated.associateAssetsIds;
          if (updated.collaboration) {
            item.collaboration = updated.collaboration;
            item.version = updated.collaboration.version;
            item.reviewState = updated.collaboration.reviewState;
            item.locked = updated.collaboration.locked;
            item.lockedBy = updated.collaboration.lockedBy;
            item.updatedBy = updated.collaboration.updatedBy;
            item.updatedAt = updated.collaboration.updatedAt;
          }
        }
      });
    }

    const loadingHistory = ref(false);
    async function getHistory() {
      loadingHistory.value = true;
      const { data } = await axios.post(`/agents/getMemory`, {
        projectId: Number(projectId),
        episodesId: episodesId.value,
        agentType: "productionAgent",
      });
      messages.value = [];
      messages.value = [...defMsg, ...data];
      loadingHistory.value = false;
    }

    const thinkLevel = ref(0);

    function updateThinkConfig(value: number) {
      thinkLevel.value = value;
      if (socket.value) {
        socket.value.emit("updateThinkConfig", { think: value > 0, thinlLevel: value });
      }
    }

    async function startBuiltinRun(prompt: string, limits?: Partial<BuiltinRunLimits>) {
      return builtinRuns.startRun({ agentType: "productionAgent", projectId: Number(projectId), scriptId: episodesId.value ?? null, prompt, limits });
    }

    return {
      connected,
      messages,
      chat,
      stopGenerate,
      socket,
      status,
      flowData,
      planningVersion,
      setFlowData,
      getFlowData,
      refreshStoryboard,
      setStoryboardEditing,
      episodesId,
      stopAssetsPolling,
      stopStoryboardPolling,
      updateContext,
      getHistory,
      loadingHistory,
      batchGenerateStoryboard,
      reconnect,
      thinkLevel,
      updateThinkConfig,
      startBuiltinRun,
    };
  });
}

const storeMap = new Map<string, ReturnType<typeof makeProductionAgentStore>>();

function createProductionAgentStore(projectId: string) {
  if (!storeMap.has(projectId)) {
    storeMap.set(projectId, makeProductionAgentStore(projectId));
  }
  return storeMap.get(projectId)!;
}

export default function useProductionAgentStore() {
  const id = projectStore().project?.id;
  if (!id) throw new Error("No project selected");
  return createProductionAgentStore(id)();
}
