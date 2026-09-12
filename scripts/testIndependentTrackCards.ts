import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildTrackCardPresentation, freezeClearVideosMutation, freezeDeleteCardMutation, sameCardMutationScope, singleFlight } from "../src/views/production/components/workbench/generate/utils/trackCards.ts";

const trackSource = readFileSync(new URL("../src/views/production/components/workbench/generate/components/track.vue", import.meta.url), "utf8");
const cardSource = readFileSync(new URL("../src/views/production/components/workbench/generate/utils/trackCards.ts", import.meta.url), "utf8");
const productionSource = readFileSync(new URL("../src/views/production/index.vue", import.meta.url), "utf8");

test("fifteen storyboards produce fifteen independently titled S cards", () => {
  const storyboards = Array.from({ length: 15 }, (_, index) => ({ id: 100 + index, index, version: index + 1, trackId: 200 + index }));
  const tracks = storyboards.map((board) => ({ id: Number(board.trackId), storyboardIds: [board.id], storyboardCount: 1, cardKind: "storyboard" as const, deleteAction: "deleteStoryboard" as const }));
  const cards = tracks.map((track) => buildTrackCardPresentation(track, storyboards));
  assert.equal(cards.length, 15);
  assert.deepEqual(cards.map((card) => card.title), ["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S11", "S12", "S13", "S14", "S15"]);
  assert.ok(cards.every((card) => card.deleteLabel === "删除分镜"));
});

test("titles follow the real storyboard index rather than card array order", () => {
  const storyboards = [{ id: 1, index: 14, version: 7 }, { id: 2, index: 2, version: 8 }];
  assert.equal(buildTrackCardPresentation({ id: 20, storyboardIds: [1], storyboardCount: 1, cardKind: "storyboard", deleteAction: "deleteStoryboard" }, storyboards).title, "S15");
  assert.equal(buildTrackCardPresentation({ id: 21, storyboardIds: [2], storyboardCount: 1, cardKind: "storyboard", deleteAction: "deleteStoryboard" }, storyboards).title, "S03");
});

test("custom empty tracks are labelled and deleted as segments", () => {
  const card = buildTrackCardPresentation({ id: 67, storyboardIds: [], storyboardCount: 0, cardKind: "custom", deleteAction: "deleteTrack" }, []);
  assert.deepEqual(card, { title: "自建片段 T67", kindLabel: "无分镜", deleteLabel: "删除片段" });
});

test("legacy multi-storyboard cards cannot expose one-click deletion", () => {
  const card = buildTrackCardPresentation({ id: 66, storyboardIds: [1, 2, 3], storyboardCount: 3, cardKind: "storyboard", deleteAction: "deleteStoryboard", migrationRequired: true }, []);
  assert.equal(card.title, "历史合并片段 · 3镜");
  assert.equal(card.deleteLabel, undefined);
  assert.match(card.mutationBlockedReason ?? "", /迁移前不能删除/);
});

test("UI wires distinct CAS operations and refreshes both card data and canvas", () => {
  assert.match(cardSource, /deleteStoryboardTrack/);
  assert.match(cardSource, /expectedTrackVersion/);
  assert.match(cardSource, /expectedStoryboardVersion/);
  assert.match(cardSource, /clearTrackVideos/);
  assert.match(cardSource, /expectedVersion/);
  assert.match(trackSource, /emit\("getData"\)/);
  assert.match(trackSource, /refreshProductionFlow/);
  assert.match(productionSource, /provide\("refreshProductionFlow", refFlowData\)/);
  assert.match(trackSource, /NAS 中已保存的媒体文件保留/);
  assert.doesNotMatch(trackSource, /trackList\.value\.splice/);
  assert.match(trackSource, /warnBlockedGeneration\(blockedGenerationTracks\(selectedIds\)\)/);
});

test("archived merged tracks render in a separate read-only dialog", () => {
  assert.match(trackSource, /历史合并片段（\{\{ archivedSharedTracks\.length \}\}）/);
  assert.match(trackSource, /archive\.prompt/);
  assert.match(trackSource, /archive\.videos/);
  assert.doesNotMatch(trackSource, /archivedSharedTracks[^\n]*checkedTrackIds/);
});

test("delete confirmation freezes the original target across list reorder", () => {
  const scope = { projectId: 4, scriptId: 11, sequence: 8 };
  const storyboards = [{ id: 113, index: 0, version: 12 }, { id: 114, index: 1, version: 13 }];
  const cardA = buildTrackCardPresentation({ id: 70, storyboardIds: [113], storyboardCount: 1, cardKind: "storyboard", deleteAction: "deleteStoryboard" }, storyboards);
  const frozen = freezeDeleteCardMutation({ scope, trackId: 70, trackVersion: 21, card: cardA });
  const reorderedTracks = [{ id: 71 }, { id: 70 }];
  assert.equal(reorderedTracks[0].id, 71);
  assert.deepEqual(frozen?.payload, { projectId: 4, scriptId: 11, trackId: 70, storyboardId: 113, expectedTrackVersion: 21, expectedStoryboardVersion: 12 });
});

test("scope changes cancel frozen delete and clear operations", () => {
  const frozenScope = { projectId: 4, scriptId: 11, sequence: 8 };
  assert.equal(sameCardMutationScope(frozenScope, { ...frozenScope }), true);
  assert.equal(sameCardMutationScope(frozenScope, { projectId: 4, scriptId: 12, sequence: 9 }), false);
  assert.equal(sameCardMutationScope(frozenScope, { projectId: 5, scriptId: 11, sequence: 9 }), false);
  assert.equal(freezeClearVideosMutation({ scope: frozenScope, trackId: 70, trackVersion: 21 }).payload.trackId, 70);
});

test("double confirmation shares one request and one result", async () => {
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const submit = singleFlight(async () => { calls += 1; await pending; return "done"; });
  const first = submit();
  const second = submit();
  assert.equal(first, second);
  assert.equal(calls, 1);
  release();
  assert.equal(await second, "done");
  assert.equal(calls, 1);
});

test("confirmation callbacks send frozen mutations instead of rereading an index", () => {
  assert.doesNotMatch(trackSource, /await deleteCard\(index\)/);
  assert.doesNotMatch(trackSource, /await clearTrackVideos\(index\)/);
  assert.match(trackSource, /singleFlight/);
  assert.match(trackSource, /sameCardMutationScope/);
});
