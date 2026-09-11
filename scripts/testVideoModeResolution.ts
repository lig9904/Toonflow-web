import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildVideoReferences,
  buildResolvedReferencePreviews,
  captureVideoGenerationSettings,
  defaultReferencePurpose,
  modeIntentForTrack,
  initialReferenceSelection,
  modeIntentSelectValue,
  parseModeIntentValue,
  referenceSignature,
  referenceTypeOrdinals,
  referencesNeedReview,
  restoreReferenceSelection,
  videoModeLabel,
  videoGenerationIntentPayload,
} from "../src/views/production/components/workbench/generate/utils/videoMode.ts";

const generateViewSource = readFileSync(new URL("../src/views/production/components/workbench/generate/index.vue", import.meta.url), "utf8");

test("new tracks default to auto while explicit historical modes remain explicit", () => {
  assert.equal(modeIntentForTrack({}), "auto");
  assert.equal(modeIntentForTrack({ modeIntent: "startEndRequired" }), "startEndRequired");
  assert.deepEqual(parseModeIntentValue('["imageReference:2"]'), ["imageReference:2"]);
  assert.equal(modeIntentSelectValue(["imageReference:2"]), '["imageReference:2"]');
});

test("auto preserves an unlabelled storyboard for set-level resolution and classifies typed assets", () => {
  const references = buildVideoReferences([
    { id: 11, sources: "storyboard", fileType: "image", src: "/11.png" },
    { id: 12, sources: "assets", fileType: "image", assetType: "role", src: "/12.png" },
    { id: 13, sources: "assets", fileType: "image", assetType: "scene", src: "/13.png" },
    { id: 14, sources: "assets", fileType: "video", assetType: "clip", src: "/14.mp4" },
    { id: 15, sources: "assets", fileType: "audio", assetType: "audio", src: "/15.wav" },
  ], "auto", true);
  assert.deepEqual(references.map((item) => item.purpose), [
    undefined,
    "identity_reference",
    "style_reference",
    "motion_reference",
    "audio_reference",
  ]);
  assert.equal(references.some((item) => item.purpose === "last_frame"), false);
});

test("the picker presents one unlabelled storyboard as first frame and several as style references", () => {
  const storyboard = { id: 16, sources: "storyboard", fileType: "image" as const };
  assert.equal(defaultReferencePurpose(storyboard, "auto", 0, 1), "first_frame");
  assert.equal(defaultReferencePurpose(storyboard, "auto", 0, 2), "style_reference");
  assert.equal(defaultReferencePurpose(storyboard, "auto", 1, 2), "style_reference");
  assert.equal(defaultReferencePurpose(storyboard, "startEndRequired", 0, 1), "style_reference");
});

test("only explicit purposes or legacy frame slots identify first and last frames", () => {
  const source = [
    { id: 21, sources: "storyboard", fileType: "image" as const, src: "/21.png" },
    { id: 22, sources: "storyboard", fileType: "image" as const, src: "/22.png" },
  ];
  assert.deepEqual(buildVideoReferences(source, "startEndRequired").map((item) => item.purpose), [undefined, undefined]);
  assert.deepEqual(buildVideoReferences(source, "auto").map((item) => item.purpose), [undefined, undefined]);
  assert.deepEqual(buildVideoReferences([
    { ...source[0], purpose: "first_frame" },
    { ...source[1], slotType: "endImage" },
    { id: 23, sources: "assets", fileType: "image" as const, assetType: "role" as const },
  ], "startEndRequired").map((item) => item.purpose), ["first_frame", "last_frame", "identity_reference"]);
});

test("manual purposes survive mode changes and text mode does not discard references", () => {
  const source = [
    { id: 31, sources: "assets", fileType: "image" as const, purpose: "identity_reference" as const, src: "/31.png" },
    { id: 32, sources: "assets", fileType: "image" as const, purpose: "style_reference" as const, src: "/32.png" },
  ];
  assert.deepEqual(buildVideoReferences(source, "text", true).map((item) => item.purpose), ["identity_reference", "style_reference"]);
  assert.equal(buildVideoReferences(source, "singleImage", true).length, 2, "the client sends the complete semantic selection without slicing");
});

test("each batch track produces an independent reference snapshot", () => {
  const first = buildVideoReferences([{ id: 41, sources: "storyboard", fileType: "image", src: "/41.png" }], "auto", true);
  const second = buildVideoReferences([
    { id: 42, sources: "assets", fileType: "image", assetType: "role", src: "/42.png" },
    { id: 43, sources: "assets", fileType: "image", assetType: "role", src: "/43.png" },
  ], "auto", true);
  assert.notEqual(referenceSignature(first), referenceSignature(second));
  assert.deepEqual(second.map((item) => item.purpose), ["identity_reference", "identity_reference"]);
});

test("server reference order and purposes restore exactly after a track switch or refresh", () => {
  const restored = restoreReferenceSelection([
    { id: 61, sources: "assets", fileType: "image", src: "/61.png", purpose: "style_reference" },
    { id: 62, sources: "storyboard", fileType: "image", src: "/62.png", purpose: "first_frame" },
    { id: 63, sources: "assets", fileType: "image", src: "/stale.png" },
  ], [
    { id: 62, sources: "storyboard", fileType: "image", purpose: "first_frame" },
    { id: 61, sources: "assets", fileType: "image", purpose: "identity_reference" },
  ]);
  assert.deepEqual(restored.map((item) => [item.id, item.purpose, item.src]), [
    [62, "first_frame", "/62.png"],
    [61, "identity_reference", "/61.png"],
  ]);
});

test("resolved first-tail order controls prompt chips even when the user selected tail first", () => {
  const cupA = { id: 91, sources: "assets" as const, fileType: "audio" as const, src: "/cup-a.png" };
  const cupB = { id: 92, sources: "assets" as const, fileType: "image" as const, src: "/cup-b.png" };
  const previews = buildResolvedReferencePreviews([
    { id: 91, sources: "assets", fileType: "image", purpose: "first_frame" },
    { id: 92, sources: "assets", fileType: "image", purpose: "last_frame" },
  ], [cupB, cupA]);
  assert.deepEqual(previews.map((item) => [item.src, item.type]), [["/cup-a.png", "image"], ["/cup-b.png", "image"]]);
});

test("mixed media keep independent numbering and missing previews keep their slot", () => {
  const previews = buildResolvedReferencePreviews([
    { id: 101, sources: "assets", fileType: "image" },
    { id: 102, sources: "assets", fileType: "video" },
    { id: 103, sources: "assets", fileType: "image" },
    { id: 104, sources: "assets", fileType: "audio" },
    { id: 105, sources: "assets", fileType: "image" },
  ], [
    { id: 104, sources: "assets", src: "/sound.wav" },
    { id: 103, sources: "assets", src: "/second.png" },
    { id: 102, sources: "assets", src: "/motion.mp4" },
    { id: 101, sources: "assets", src: "/first.png" },
  ]);
  assert.deepEqual(previews.map((item) => item.type), ["image", "video", "image", "audio", "image"]);
  assert.deepEqual(referenceTypeOrdinals(previews), [1, 1, 2, 1, 3]);
  assert.deepEqual(previews[4], { type: "image", src: "", missing: true });
});

test("new inventory placeholders are excluded unless the user selected them or the server persisted them", () => {
  const inventory = [
    { id: 81, sources: "storyboard", fileType: "image" as const, src: "/81.png" },
    { id: 82, sources: "storyboard", fileType: "image" as const, src: "" },
  ];
  const defaults = [{ id: 81, sources: "storyboard" as const, fileType: "image" as const }];
  assert.deepEqual(initialReferenceSelection(inventory, defaults, { referencesInitialized: false, userEditedCache: false }).map((item) => item.id), [81]);
  assert.deepEqual(initialReferenceSelection(inventory, defaults, { referencesInitialized: false, userEditedCache: true }).map((item) => item.id), [81, 82]);
  assert.deepEqual(initialReferenceSelection(inventory, [{ id: 82, sources: "storyboard", fileType: "image" }], { referencesInitialized: true, userEditedCache: false }).map((item) => [item.id, item.src]), [[82, ""]]);
});

test("a changed durable selection revision marks a non-empty prompt for review", () => {
  assert.equal(referencesNeedReview("人工提示词", 4, 5), true);
  assert.equal(referencesNeedReview("人工提示词", 5, 5), false);
  assert.equal(referencesNeedReview("", 4, 5), false);
  assert.equal(referencesNeedReview("旧数据", undefined, 0), false);
});

test("invalid items are rejected while a persisted id survives a temporary missing preview URL", () => {
  const references = buildVideoReferences([
    { id: 0, sources: "assets", fileType: "image", src: "/bad.png" },
    { id: 51, sources: "other", fileType: "image", src: "/bad2.png" },
    { id: 52, sources: "assets", fileType: "image", src: "" },
    { id: "53", sources: "assets", fileType: "image", src: "/53.png" },
  ], "auto");
  assert.deepEqual(references.map((item) => item.id), [52, 53]);
  assert.equal(videoModeLabel(["imageReference:2", "audioReference:1"]), "图片 ×2 + 音频 ×1参考");
});

test("batch per-track idempotency changes with every effective generation setting", () => {
  const base = {
    trackId: 71,
    prompt: "镜头提示词",
    references: [] as const,
    modeIntentRevision: 3,
    model: "provider:model-a",
    resolution: "720p",
    audio: false,
    duration: 4,
  };
  const signature = (overrides: Partial<typeof base>) => JSON.stringify(videoGenerationIntentPayload({ ...base, ...overrides }));
  assert.notEqual(signature({}), signature({ model: "provider:model-b" }));
  assert.notEqual(signature({}), signature({ resolution: "1080p" }));
  assert.notEqual(signature({}), signature({ audio: true }));
  assert.notEqual(signature({}), signature({ duration: 5 }));
});

test("click-time generation settings stay frozen while an asynchronous save is pending", () => {
  const mutable = { model: "model-a", resolution: "720p", audio: false, duration: 4 };
  const snapshot = captureVideoGenerationSettings(mutable);
  mutable.model = "model-b";
  mutable.resolution = "1080p";
  mutable.audio = true;
  mutable.duration = 12;
  assert.deepEqual(snapshot, { model: "model-a", resolution: "720p", audio: false, duration: 4 });
});

test("late reference saves cannot allocate a preview sequence for a no-longer-active track", () => {
  const start = generateViewSource.indexOf("async function resolveCurrentVideoMode()");
  const end = generateViewSource.indexOf("\nwatch(", start);
  const body = generateViewSource.slice(start, end);
  const save = body.indexOf("await saveTrackReferences");
  const activeGuard = body.indexOf("currentTrack.value !== track", save);
  const allocateSequence = body.indexOf("++modeResolveSequence", save);
  assert.ok(save >= 0 && activeGuard > save && allocateSequence > activeGuard);
});

test("single prompt and video actions capture settings before their first reference-save await", () => {
  for (const functionName of ["async function genText()", "async function generateVideo()"] as const) {
    const start = generateViewSource.indexOf(functionName);
    const end = generateViewSource.indexOf("\n}", start) + 2;
    const body = generateViewSource.slice(start, end);
    assert.ok(body.indexOf("captureVideoGenerationSettings") >= 0, functionName);
    assert.ok(body.indexOf("captureVideoGenerationSettings") < body.indexOf("await saveTrackReferences"), functionName);
  }
});
