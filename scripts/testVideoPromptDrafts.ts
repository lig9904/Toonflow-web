import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { freezeReloadStoryboardMutation } from "../src/views/production/components/workbench/generate/utils/trackCards.ts";
import { createVideoPromptDraft, normalizeVideoPromptDraft, rebaseVideoPromptDraft, videoPromptDraftConflicts } from "../src/views/production/components/workbench/generate/utils/videoPromptDraft.ts";

const generateSource = readFileSync(new URL("../src/views/production/components/workbench/generate/index.vue", import.meta.url), "utf8");
const trackSource = readFileSync(new URL("../src/views/production/components/workbench/generate/components/track.vue", import.meta.url), "utf8");
const workbenchSource = readFileSync(new URL("../src/views/production/components/workbench/index.vue", import.meta.url), "utf8");
const productionSource = readFileSync(new URL("../src/views/production/index.vue", import.meta.url), "utf8");

function functionBody(source: string, name: string, nextName: string): string {
  const start = source.indexOf(name);
  const end = source.indexOf(nextName, start + name.length);
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end);
}

test("video prompt editing is explicit-save and never blur-save", () => {
  assert.match(generateSource, /保存提示词/);
  assert.match(generateSource, /未保存草稿/);
  assert.doesNotMatch(generateSource, /@focusout="handlePromptBlur"/);
  assert.doesNotMatch(generateSource, /function handlePromptBlur/);
  assert.match(generateSource, /toonflow:video-prompt-drafts/);
});

test("prompt and video generation resolve dirty drafts without silently saving", () => {
  const genText = functionBody(generateSource, "async function genText()", "function trackChange");
  assert.match(genText, /resolveTrackDraft\(track, scope, "重新生成提示词"\)/);
  assert.doesNotMatch(genText, /saveTrackPrompt\(/);
  const generateVideo = functionBody(generateSource, "async function generateVideo()", "let pollTimer");
  assert.match(generateVideo, /resolveTrackDraft\(track, scopeSnapshot, "生成视频"\)/);
  assert.doesNotMatch(generateVideo, /saveTrackPrompt\(/);
});

test("refresh, track switch, workbench close, tabs, episodes and routes share creative draft guards", () => {
  assert.match(generateSource, /registerCreativeDraft/);
  assert.match(generateSource, /confirmCreativeDrafts/);
  assert.match(trackSource, /beforeTrackChange/);
  assert.match(workbenchSource, /confirmWorkbenchDrafts\("关闭视频工作台"\)/);
  assert.match(workbenchSource, /confirmWorkbenchDrafts\("切换工作台功能"\)/);
  assert.match(productionSource, /confirmCreativeDrafts\(\{ scope: currentScope, action: "切换剧集" \}\)/);
  assert.match(productionSource, /confirmCreativeDrafts\(\{ scope: currentScope, action: "刷新制作画布" \}\)/);
});

test("AI completion preserves a draft typed while the request is running", () => {
  assert.match(generateSource, /const localDraft = isPromptDirty\(track\)/);
  assert.match(generateSource, /if \(!localDraft\) track\.prompt = data/);
  assert.match(generateSource, /if \(pending && \(!pending\.submitted/);
});

test("reload freezes track, board and selection revisions and never accepts client references", () => {
  const mutation = freezeReloadStoryboardMutation({
    scope: { projectId: 4, scriptId: 11, sequence: 9 },
    trackId: 70,
    trackVersion: 8,
    storyboardId: 113,
    storyboardVersion: 12,
    modeIntentRevision: 5,
  });
  assert.deepEqual(mutation.payload, {
    projectId: 4,
    scriptId: 11,
    trackId: 70,
    storyboardId: 113,
    expectedTrackVersion: 8,
    expectedStoryboardVersion: 12,
    expectedModeIntentRevision: 5,
  });
  assert.equal("references" in mutation.payload, false);
  assert.match(trackSource, /invalidateUrls/);
  assert.match(trackSource, /removeCache\(frozen\.scope\.projectId, frozen\.scope\.scriptId, frozen\.mutation\.trackId\)/);
});

test("a reopened draft keeps its old CAS baseline after the server changes", () => {
  const original = createVideoPromptDraft("本地未保存修改", { version: 4, modeIntentRevision: 2, savedPrompt: "原正文" });
  const reopened = normalizeVideoPromptDraft(JSON.parse(JSON.stringify(original)))!;
  const serverAfterAi = { version: 5, modeIntentRevision: 3, savedPrompt: "AI更新正文" };
  assert.equal(reopened.baseVersion, 4);
  assert.equal(reopened.baseModeIntentRevision, 2);
  assert.equal(videoPromptDraftConflicts(reopened, serverAfterAi), true);
  const explicitlyConfirmed = rebaseVideoPromptDraft(reopened, serverAfterAi);
  assert.deepEqual(explicitlyConfirmed, { text: "本地未保存修改", baseVersion: 5, baseModeIntentRevision: 3, baseSavedPrompt: "AI更新正文" });
});

test("legacy string drafts restore with an unknown baseline and require comparison", () => {
  const legacy = normalizeVideoPromptDraft("旧版草稿")!;
  assert.equal(legacy.text, "旧版草稿");
  assert.equal(legacy.baselineUnknown, true);
  assert.equal(videoPromptDraftConflicts(legacy, { version: 1, modeIntentRevision: 0, savedPrompt: "服务端" }), true);
});

test("same text after reference reload still requires one explicit acknowledgement save", () => {
  assert.match(generateSource, /currentPromptDirty\.value \|\| Boolean\(currentTrack\.value\?\.referencesNeedReview\)/);
  assert.match(generateSource, /保存并确认参考/);
  assert.match(generateSource, /!textDirty && !track\.referencesNeedReview/);
  assert.match(generateSource, /track\.referencesNeedReview = false/);
  assert.match(generateSource, /参考素材已变化，请先点击“保存并确认参考”/);
});
