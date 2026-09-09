import assert from "node:assert/strict";
import test from "node:test";
import { createGenerationIntentStore, fingerprintGenerationPayload } from "./generationIntent.ts";

test("same payload retains its key after an unknown failure and duplicate calls share a promise", async () => {
  const store = createGenerationIntentStore<string>();
  let calls = 0;
  let release: ((value: string) => void) | undefined;
  const pending = new Promise<string>((resolve) => (release = resolve));
  const payload = { prompt: "a", uploadData: [{ id: 1, sources: "storyboard" }] };
  const first = store.run("single:1", payload, async (key) => {
    calls++;
    assert.equal(typeof key, "string");
    return pending;
  });
  const duplicate = store.run("single:1", payload, async () => "duplicate");
  assert.strictEqual(first, duplicate);
  assert.equal(calls, 1);
  release!("ok");
  await assert.doesNotReject(first);
});

test("different payloads get different keys and success starts a new intent", async () => {
  const store = createGenerationIntentStore<string>();
  const firstPayload = { prompt: "a" };
  let firstKey = "";
  await store.run("single:1", firstPayload, async (key) => {
    firstKey = key;
    return "ok";
  });
  let newKey = "";
  await store.run("single:1", firstPayload, async (key) => {
    newKey = key;
    return "ok";
  });
  assert.notEqual(firstKey, newKey);

  const changed = store.getOrCreate("single:1", { prompt: "b" });
  assert.notEqual(newKey, changed.key);
  assert.notEqual(fingerprintGenerationPayload(firstPayload), changed.fingerprint);
});

test("409 keeps a key, while explicit 4xx clears it and batch track scopes remain independent", async () => {
  const store = createGenerationIntentStore<string>();
  const payload = { trackId: 1, prompt: "a" };
  const first = store.getOrCreate("batch-track:1", payload);
  await assert.rejects(store.run("batch-track:1", payload, async () => Promise.reject({ status: 409 })));
  const afterConflict = store.getOrCreate("batch-track:1", payload);
  assert.equal(first.key, afterConflict.key);
  await assert.rejects(store.run("batch-track:1", payload, async () => Promise.reject({ status: 400 })));
  const afterValidationFailure = store.getOrCreate("batch-track:1", payload);
  assert.notEqual(first.key, afterValidationFailure.key);

  const second = store.getOrCreate("batch-track:2", { trackId: 2, prompt: "a" });
  assert.notEqual(afterValidationFailure.key, second.key);
});
