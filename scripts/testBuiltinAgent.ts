import assert from "node:assert/strict";
import {
  builtinFingerprint,
  builtinHumanQuestion,
  builtinUsesIndependentOutput,
  builtinRunMessages,
  builtinScopeKey,
  dedupeBuiltinRunEvents,
  type BuiltinRunEvent,
} from "../src/types/builtinAgent.ts";

const event = (sequence: number, text: string): BuiltinRunEvent => ({
  runId: "run-1",
  sequence,
  type: "message.delta",
  data: { text },
  createdAt: sequence,
});

const run = {
  id: "run-1",
  agentType: "scriptAgent" as const,
  projectId: 7,
  scriptId: null,
  requestedBy: 3,
  executionUserId: 4,
  prompt: "创建测试剧本",
  status: "succeeded" as const,
  version: 5,
  lastSequence: 5,
  currentStep: null,
  limits: { maxModelCalls: 12, maxToolSteps: 40, maxOutputTokens: 12000, maxImageGenerations: 1, maxVideoGenerations: 0 },
  modelCalls: 2,
  toolSteps: 4,
  imageGenerations: 1,
  videoGenerations: 0,
  createdAt: 1,
  updatedAt: 5,
  errorCode: null,
  errorMessage: null,
  result: null,
};

const first = [event(1, "a"), event(2, "b")];
assert.equal(builtinUsesIndependentOutput({ ...run, agentType: "productionAgent", intent: { outputBudgetMode: "model_per_call" } }), true);
assert.equal(builtinUsesIndependentOutput({ ...run, agentType: "productionAgent" }), false);
assert.equal(builtinUsesIndependentOutput({ ...run, intent: { outputBudgetMode: "model_per_call" } }), false);
const replay = dedupeBuiltinRunEvents(first, [event(2, "b"), event(3, "c")]);
assert.deepEqual(replay.map((item) => item.sequence), [1, 2, 3], "replayed event sequences are deduplicated");
assert.equal(builtinHumanQuestion({ question: "请选择第 3 镜" }), "请选择第 3 镜", "waiting question survives event replay");

const sameInputA = builtinFingerprint({ prompt: "draft", scope: { projectId: 7, agentType: "scriptAgent" } });
const sameInputB = builtinFingerprint({ scope: { agentType: "scriptAgent", projectId: 7 }, prompt: "draft" });
assert.equal(sameInputA, sameInputB, "uncertain retries keep the same start fingerprint");
assert.notEqual(
  builtinScopeKey({ agentType: "productionAgent", projectId: 7, scriptId: 1 }),
  builtinScopeKey({ agentType: "productionAgent", projectId: 7, scriptId: 2 }),
  "switching episodes changes the polling scope",
);

const mapped = builtinRunMessages(run, [
  event(1, "第一段"),
  { ...event(2, "完整回复"), type: "message.completed" },
  { ...event(3, "第二条回复"), type: "message.completed" },
  { ...event(6, "第二条回复"), type: "message.completed" },
  { ...event(4, "ignored"), type: "step.started", data: { key: "script.sources:r0" } },
  { ...event(5, "ignored"), type: "artifact.saved", data: { kind: "image", targetKind: "storyboard", targetId: 8, selected: false } },
  event(1, "第一段"),
]);
assert.deepEqual(mapped.map((message) => message.text), [
  "创建测试剧本",
  "完整回复",
  "第二条回复",
  "分镜图片已生成。待选择，尚未应用到当前内容",
]);
assert.equal(mapped[0].role, "user", "run prompt is restored as the user message");
assert.equal(mapped.at(-1)?.artifact?.selected, false, "late unselected output stays explicitly pending selection");
assert.equal(mapped.at(-1)?.artifact?.target, "images", "storyboard image opens the storyboard resource");
const assetMapped = builtinRunMessages(run, [{ ...event(7, "ignored"), type: "artifact.saved", data: { kind: "image", targetKind: "asset", targetId: 9, selected: false } }]);
assert.equal(assetMapped.at(-1)?.artifact?.target, "assets", "asset image opens the asset center");
assert(!mapped.some((message) => message.text.includes("script.sources")), "internal step keys never enter the product chat");
assert.equal(builtinRunMessages(run, replay).length, 2, "reloading replayed events does not duplicate chat history");

console.log("builtin agent contract checks passed");
