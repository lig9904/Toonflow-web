import axios from "@/utils/axios";
import projectStore from "@/stores/project";
import settingStore from "@/stores/setting";
import { useChat } from "@/utils/useChat";
import builtinAgentStore from "@/stores/builtinAgent";
import { builtinScopeKey, type BuiltinRunLimits } from "@/types/builtinAgent";

interface PlanData {
  storySkeleton: string;
  adaptationStrategy: string;
  script: { id?: number; name: string; content: string; version?: number; assets?: unknown[] }[];
}

function makeScriptAgentStore(projectId: string) {
  return defineStore(`scriptAgent-${projectId}`, () => {
        const planData = ref<PlanData>({
          storySkeleton: "",
          adaptationStrategy: "",
          script: [],
        });
        const planVersion = ref<number | undefined>(undefined);
        const draftDirty = ref(false);
        const artifactRefreshPending = ref(false);
        const builtinRuns = builtinAgentStore();
        const builtinScope = { agentType: "scriptAgent" as const, projectId: Number(projectId), scriptId: null };

        function unwrapPlanResponse(response: any): { workspace: PlanData; version?: number; id?: number } {
          const outer = response?.data ?? response ?? {};
          const record = outer?.data && typeof outer.data === "object" && !Array.isArray(outer.data) ? outer : response ?? {};
          const workspace = record?.data && typeof record.data === "object" && !Array.isArray(record.data) ? record.data : record;
          const version = Number(record?.version ?? workspace?.version ?? response?.version);
          return {
            workspace: {
              storySkeleton: String(workspace?.storySkeleton ?? ""),
              adaptationStrategy: String(workspace?.adaptationStrategy ?? ""),
              script: Array.isArray(workspace?.script) ? workspace.script : [],
            },
            version: Number.isFinite(version) ? version : undefined,
            id: Number.isFinite(Number(record?.id)) ? Number(record.id) : undefined,
          };
        }

        function applyPlanWorkspace(response: any) {
          const result = unwrapPlanResponse(response);
          planData.value = result.workspace;
          if (result.version !== undefined) planVersion.value = result.version;
          draftDirty.value = false;
          artifactRefreshPending.value = false;
          return result;
        }

        const { connected, messages, chat, stopGenerate, socket, status, disconnect, connect } = useChat({
          url: `${settingStore().baseUrl}/socket/scriptAgent`,
          auth: () => ({
            isolationKey: `${projectId}:scriptAgent`,
            projectId: projectId,
          }),
          manageLifecycle: false,
          xmlTags: [
            { tag: "storySkeleton", keepInMessage: false },
            { tag: "adaptationStrategy", keepInMessage: false },
            { tag: "scriptItem", keepInMessage: false },
          ],
          onXmlTag: (data) => {
            const { tag, value, children, attrs } = data;
            if (tag === "storySkeleton") {
              planData.value.storySkeleton = value;
            } else if (tag === "adaptationStrategy") {
              planData.value.adaptationStrategy = value;
            } else if (tag === "scriptItem") {
              const name = attrs.name ?? "";
              const content = value;
              if (name) {
                const existingIndex = planData.value.script.findIndex((s) => s.name === name);
                if (existingIndex !== -1) {
                  planData.value.script[existingIndex].content = content;
                } else {
                  planData.value.script.push({ name, content });
                }
              }
            }
            // Structured Builtin runs persist their business result on the server. XML
            // is display-only here, so a stream completion cannot double-write or erase
            // a manual draft. Explicit manual edits call setPlanData below.
          },
          autoConnect: false,
        });

        watch(
          socket,
          (s) => {
            if (s) {
              s.on("getPlanData", (_, callback) => {
                callback(planData.value);
              });
            }
          },
          { immediate: true },
        );

        async function refreshPlanData(options: { force?: boolean } = {}) {
          if (draftDirty.value && !options.force) {
            artifactRefreshPending.value = true;
            return false;
          }
          const response = await axios.post("/scriptAgent/getPlanData", { projectId: projectId, agentType: "scriptAgent" });
          applyPlanWorkspace(response);
          return true;
        }

        function markPlanDraftDirty() {
          draftDirty.value = true;
        }

        async function setPlanData(data: Partial<PlanData> = planData.value) {
          const mutationKey = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `script-${Date.now()}`;
          const response = await axios.post("/scriptAgent/setPlanData", {
            projectId: Number(projectId),
            agentType: "scriptAgent",
            expectedVersion: planVersion.value,
            mutationKey,
            data: {
              ...(data.storySkeleton === undefined ? {} : { storySkeleton: data.storySkeleton }),
              ...(data.adaptationStrategy === undefined ? {} : { adaptationStrategy: data.adaptationStrategy }),
              ...(data.script === undefined
                ? {}
                : {
                    script: data.script.map((item) => ({
                      id: item.id,
                      name: item.name,
                      content: item.content,
                      version: item.version,
                      assets: item.assets,
                    })),
                  }),
            },
          });
          applyPlanWorkspace(response);
          return planData.value;
        }

        const thinkLevel = ref(0);

        function updateThinkConfig(value: number) {
          thinkLevel.value = value;
          if (socket.value) {
            socket.value.emit("updateThinkConfig", { think: value > 0, thinlLevel: value });
          }
        }

        watch(
          () => builtinRuns.artifactRevision(builtinScope),
          (revision, previousRevision) => {
            if (revision !== previousRevision && revision > 0) void refreshPlanData();
          },
        );

        async function startBuiltinRun(prompt: string, limits?: Partial<BuiltinRunLimits>) {
          return builtinRuns.startRun({ ...builtinScope, prompt, limits });
        }

        return {
          connected,
          messages,
          chat,
          stopGenerate,
          socket,
          status,
          planData,
          planVersion,
          draftDirty,
          artifactRefreshPending,
          setPlanData,
          refreshPlanData,
          markPlanDraftDirty,
          startBuiltinRun,
          connect,
          disconnect,
          thinkLevel,
          updateThinkConfig,
        };
      });
}

const storeMap = new Map<string, ReturnType<typeof makeScriptAgentStore>>();

function createScriptAgentStore(projectId: string) {
  if (!storeMap.has(projectId)) {
    storeMap.set(projectId, makeScriptAgentStore(projectId));
  }
  return storeMap.get(projectId)!;
}

export default function useScriptAgentStore() {
  const id = projectStore().project?.id;
  if (!id) throw new Error("No project selected");
  return createScriptAgentStore(id)();
}
