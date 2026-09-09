import assert from "node:assert/strict";
import test from "node:test";
import { createVendorSaveQueue } from "./vendorSaveQueue.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("same vendor saves serialize and the latest blur wins", async () => {
  const calls: string[] = [];
  const first = deferred();
  const queue = createVendorSaveQueue<{ value: string }>(async (_id, payload) => {
    calls.push(payload.value);
    if (payload.value === "old") await first.promise;
  });
  const oldSave = queue.enqueue("deepseek", { value: "old" });
  const newSave = queue.enqueue("deepseek", { value: "new" });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, ["old"]);
  first.resolve();
  await Promise.all([oldSave, newSave]);
  assert.deepEqual(calls, ["old", "new"]);
});

test("different vendors have independent queues and payloads are cloned", async () => {
  const calls: string[] = [];
  const queue = createVendorSaveQueue<{ inputValues: Record<string, string> }>(async (id, payload) => {
    calls.push(`${id}:${payload.inputValues.key}`);
  });
  const payload = { inputValues: { key: "before" } };
  const a = queue.enqueue("a", payload);
  payload.inputValues.key = "after";
  const b = queue.enqueue("b", { inputValues: { key: "b" } });
  await Promise.all([a, b]);
  assert.deepEqual(calls, ["a:before", "b:b"]);
  assert.equal(queue.isSaving("a"), false);
  assert.equal(queue.isSaving("b"), false);
});
