import assert from "node:assert/strict";
import test from "node:test";
import { captureGenerateScope, positiveId, sameGenerateScope, validTrackIds } from "../src/views/production/components/workbench/generate/utils/scope.ts";

test("positiveId only accepts safe positive numbers and decimal strings", () => {
  assert.equal(positiveId(21), 21);
  assert.equal(positiveId("021"), 21);
  assert.equal(positiveId(true), undefined);
  assert.equal(positiveId([]), undefined);
  assert.equal(positiveId("1e2"), undefined);
  assert.equal(positiveId(0), undefined);
  assert.equal(positiveId(Number.MAX_SAFE_INTEGER + 1), undefined);
});

test("scope capture rejects unfinished IDs and detects sequence changes", () => {
  const scope = captureGenerateScope("4", 5, 7);
  assert.deepEqual(scope, { projectId: 4, scriptId: 5, sequence: 7 });
  assert.equal(captureGenerateScope(4, undefined, 7), undefined);
  assert.equal(sameGenerateScope(scope, 4, "5", 7), true);
  assert.equal(sameGenerateScope(scope, 4, 5, 8), false);
  assert.equal(sameGenerateScope(scope, 9, 5, 7), false);
});

test("selected IDs are normalized, deduplicated, and limited to loaded tracks", () => {
  assert.deepEqual(validTrackIds(["21", 21, 0, 99], [{ id: 21 }, { id: "22" }]), [21]);
});
