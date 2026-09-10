import assert from "node:assert/strict";
import { videoDurations, videoResolutions, nearestVideoDuration, resolveVideoDuration, storyboardTrackDuration } from "../src/utils/mediaQuality.ts";
import {
  builtinFingerprint,
  builtinHumanQuestion,
  builtinUsesIndependentOutput,
  builtinProductionPreview,
  builtinArtifactView,
  builtinImageUrl,
  builtinHasUnlimitedMediaBudget,
  builtinMediaGenerationAllowed,
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
const generatedArtifact = builtinArtifactView({ kind: "image", targetKind: "asset", targetId: 16, jobId: 72, selected: false, path: "/7/assets/new.jpg" });
assert.equal(generatedArtifact.jobId, 72); assert.equal(generatedArtifact.targetId, 16);
assert.equal(generatedArtifact.actionLabel, "查看生成图");
assert.equal(builtinImageUrl(generatedArtifact, "/api", "https://app.test:6443/#/production"), "https://app.test:6443/oss/7/assets/new.jpg");
assert.equal(builtinImageUrl({ ...generatedArtifact, path: "/7/../private.jpg" }, "/api", "https://app.test/"), undefined);
assert.equal(builtinImageUrl({ ...generatedArtifact, path: "https://other.test/image.jpg" }, "/api", "https://app.test/"), undefined);
const videoModel = { durationResolutionMap: [{ duration: [3, 5], resolution: ["720p", "1080p"] }, { duration: [10], resolution: ["720p"] }] };
assert.deepEqual(videoDurations(videoModel), [3, 5, 10]);
assert.deepEqual(videoResolutions(videoModel, 10), ["720p"]);
assert.deepEqual(videoResolutions(videoModel, 8), []);
assert.equal(nearestVideoDuration(videoModel, 8), 10);
assert.deepEqual(resolveVideoDuration(videoModel, 4), { requested: 4, duration: 5, resolution: "rounded_up" });
assert.deepEqual(resolveVideoDuration(videoModel, 12), { requested: 12, resolution: "exceeds_maximum" });
assert.equal(storyboardTrackDuration([{ trackId: 1, duration: "1.5" }, { trackId: 1, duration: 1.5 }, { trackId: 2, duration: 9 }], 1), 3);
const previewRun = { ...run, agentType: "productionAgent" as const, status: "running" as const };
const previewEvent: BuiltinRunEvent = { ...event(1, ""), type: "artifact.preview", data: { target: "scriptPlan", text: "Draft" } };
assert.deepEqual(builtinProductionPreview(previewRun, [previewEvent], "scriptPlan"), { text: "Draft" });
assert.equal(builtinProductionPreview({ ...previewRun, status: "failed" }, [previewEvent], "scriptPlan"), undefined);
assert.equal(builtinProductionPreview(previewRun, [previewEvent, { ...event(2, ""), type: "artifact.saved", data: { kind: "productionPlanning" } }], "scriptPlan"), undefined);
assert.equal(builtinProductionPreview(previewRun, [previewEvent], "storyboardTable"), undefined);
assert.equal(builtinUsesIndependentOutput({ ...run, agentType: "productionAgent", intent: { outputBudgetMode: "model_per_call" } }), true);
assert.equal(builtinUsesIndependentOutput({ ...run, agentType: "productionAgent" }), false);
assert.equal(builtinUsesIndependentOutput({ ...run, intent: { outputBudgetMode: "model_per_call" } }), false);
assert.equal(builtinHasUnlimitedMediaBudget({ ...run, intent: { mediaBudgetMode: "zero_unlimited" } }, "image"), false, "positive image limits stay bounded");
assert.equal(builtinHasUnlimitedMediaBudget({ ...run, limits: { ...run.limits, maxImageGenerations: 0 }, intent: { mediaBudgetMode: "zero_unlimited" } }, "image"), true);
assert.equal(builtinMediaGenerationAllowed({ ...run, limits: { ...run.limits, maxImageGenerations: 0 }, intent: { mediaBudgetMode: "zero_unlimited" } }, "image"), true);
assert.equal(builtinMediaGenerationAllowed({ ...run, limits: { ...run.limits, maxImageGenerations: 0 }, intent: undefined }, "image"), false, "legacy zero limits remain denied");
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
  "分镜图片已生成。图片已保存，未覆盖当前画布内容",
]);
assert.equal(mapped[0].role, "user", "run prompt is restored as the user message");
assert.equal(mapped.at(-1)?.artifact?.selected, false, "late unselected output stays explicitly pending selection");
assert.equal(mapped.at(-1)?.artifact?.target, "images", "storyboard image opens the storyboard resource");
const assetMapped = builtinRunMessages(run, [{ ...event(7, "ignored"), type: "artifact.saved", data: { kind: "image", targetKind: "asset", targetId: 9, selected: false } }]);
assert.equal(assetMapped.at(-1)?.artifact?.target, "assets", "asset image opens the asset center");
assert(!mapped.some((message) => message.text.includes("script.sources")), "internal step keys never enter the product chat");
assert.equal(builtinRunMessages(run, replay).length, 2, "reloading replayed events does not duplicate chat history");

console.log("builtin agent contract checks passed");
