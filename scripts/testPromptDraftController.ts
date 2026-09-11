import assert from "node:assert/strict";
import test from "node:test";
import { createPromptDraftController, type PromptEntry, type PromptDraft, type PromptMutationInput } from "../src/components/setting/components/promptDraftController.ts";
const entry = (key = "common.eventExtraction", content = "default", version = "v1"): PromptEntry => ({ key, id: key, name: key, group: "common", source: "db", usedBy: [], content, defaultContent: "default", customized: content !== "default", version, updatedAt: null, editable: true, requiredContext: [], requiredVariables: [], codeContracts: [] });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function harness(write: Parameters<typeof createPromptDraftController>[0]["write"], read = async (key: string) => entry(key, "server", "v9")) {
  const states: Record<string, PromptDraft> = {}; let id = 0;
  const controller = createPromptDraftController({ states, write, read, delay: 100000, makeId: () => `request-${++id}` });
  controller.seed([entry("a"), entry("b")]);
  return { states, controller };
}
test("serial autosaves retain newer edits and advance CAS version; switching keys preserves drafts", async () => {
  const first = deferred<PromptEntry>(); const writes: PromptMutationInput[] = [];
  const { states, controller } = harness(async (_op, input) => { writes.push(input); return writes.length === 1 ? first.promise : entry(input.key, input.content, "v3"); });
  try {
    controller.edit("a", "draft one"); const saving = controller.save("a");
    controller.edit("a", "draft two"); controller.edit("b", "other draft");
    assert.equal(states.a.status, "saving"); assert.equal(writes.length, 1);
    first.resolve(entry("a", "draft one", "v2")); await saving;
    assert.equal(states.a.draft, "draft two"); assert.equal(states.a.entry.version, "v2"); assert.equal(states.b.draft, "other draft");
    await controller.save("a"); assert.equal(writes[1].expectedVersion, "v2"); assert.equal(writes[1].content, "draft two"); assert.equal(states.a.status, "saved");
  } finally { controller.dispose(); }
});
test("409 preserves local draft and only explicit rebase saves against fresh version", async () => {
  let conflict = true; const writes: PromptMutationInput[] = [];
  const { states, controller } = harness(async (_op, input) => { writes.push(input); if (conflict) throw { status: 409, code: "VERSION_CONFLICT", currentVersion: "v9" }; return entry(input.key, input.content, "v10"); });
  try {
    controller.edit("a", "keep local"); await controller.save("a"); assert.equal(states.a.status, "conflict"); assert.equal(states.a.draft, "keep local");
    controller.edit("a", "newer local"); await controller.save("a"); assert.equal(writes.length, 1);
    await controller.resolveConflict("a", true); conflict = false; await controller.save("a");
    assert.equal(writes[1].expectedVersion, "v9"); assert.equal(writes[1].content, "newer local");
  } finally { controller.dispose(); }
});
test("uncertain network outcome replays same idempotency request before sending newer text", async () => {
  const writes: PromptMutationInput[] = [];
  const { states, controller } = harness(async (_op, input) => { writes.push({ ...input }); if (writes.length === 1) throw new Error("network"); return entry(input.key, input.content, writes.length === 2 ? "v2" : "v3"); });
  try {
    controller.edit("a", "first"); await controller.save("a"); assert.equal(states.a.status, "error");
    controller.edit("a", "second"); await controller.save("a"); assert.deepEqual(writes[1], writes[0]); assert.equal(states.a.draft, "second");
    await controller.save("a"); assert.notEqual(writes[2].idempotencyKey, writes[0].idempotencyKey); assert.equal(writes[2].expectedVersion, "v2"); assert.equal(writes[2].content, "second");
  } finally { controller.dispose(); }
});
test("reset and restore are serialized CAS mutations and do not overwrite text typed in flight", async () => {
  const waiting = deferred<PromptEntry>(); const calls: Array<{ op: string; input: PromptMutationInput }> = [];
  const { states, controller } = harness(async (op, input) => { calls.push({ op, input }); return calls.length === 1 ? waiting.promise : entry(input.key, "historic", "v3"); });
  try {
    const reset = controller.mutate("a", "resetPrompt"); await controller.mutate("a", "restorePrompt", "old-version"); assert.equal(calls.length, 1);
    controller.edit("a", "typed during reset"); waiting.resolve(entry("a", "reset result", "v2")); await reset;
    assert.equal(states.a.draft, "typed during reset"); assert.equal(states.a.entry.version, "v2");
    controller.edit("a", "reset result"); await controller.mutate("a", "restorePrompt", "old-version"); assert.equal(calls[1].input.expectedVersion, "v2"); assert.equal(calls[1].input.historyVersion, "old-version"); assert.equal(states.a.draft, "historic");
  } finally { controller.dispose(); }
});
test("blank drafts never save and list refresh cannot erase dirty/conflicted drafts", async () => {
  let calls = 0; const { states, controller } = harness(async (_op, input) => { calls++; return entry(input.key); });
  try {
    controller.edit("a", "  \n "); await controller.save("a"); assert.equal(calls, 0); assert.equal(states.a.status, "invalid");
    controller.seed([entry("a", "remote", "v7")]); assert.equal(states.a.draft, "  \n ");
  } finally { controller.dispose(); }
});
test("late conflict reload response never erases text typed while reading", async () => {
  const reading = deferred<PromptEntry>(); const { states, controller } = harness(async () => { throw { status: 409 }; }, () => reading.promise);
  try {
    controller.edit("a", "conflicted"); await controller.save("a"); const resolving = controller.resolveConflict("a", false);
    controller.edit("a", "typed while reload"); reading.resolve(entry("a", "remote", "v9")); await resolving;
    assert.equal(states.a.draft, "typed while reload"); assert.equal(states.a.entry.version, "v9");
  } finally { controller.dispose(); }
});
test("debounce coalesces rapid edits into a single save", async () => {
  const states: Record<string, PromptDraft> = {}; const writes: PromptMutationInput[] = [];
  const controller = createPromptDraftController({ states, delay: 15, makeId: () => "debounce-id", read: async key => entry(key), write: async (_op, input) => { writes.push(input); return entry(input.key, input.content, "v2"); } });
  try { controller.seed([entry("a")]); controller.edit("a", "one"); controller.edit("a", "two"); await new Promise(resolve => setTimeout(resolve, 45)); assert.equal(writes.length, 1); assert.equal(writes[0].content, "two"); }
  finally { controller.dispose(); }
});

test("closing during save failure and reopening retains draft, expected version and the same idempotency request", async () => {
  const { getPromptDraftSession } = await import("../src/components/setting/components/promptDraftController.ts");
  const waiting = deferred<PromptEntry>(); const writes: PromptMutationInput[] = [];
  const options = { currentUserId: () => 701, delay: 100000, makeId: () => "close-reopen-request", read: async (key: string) => entry(key), write: async (_operation: string, input: PromptMutationInput) => { writes.push({ ...input }); if (writes.length === 1) return waiting.promise; return entry(input.key, input.content, "v2"); } };
  const original = getPromptDraftSession(701, options); original.controller.seed([entry("a")]); original.controller.edit("a", "must survive close");
  const saving = original.controller.save("a"); original.controller.dispose(); waiting.reject(new Error("failed after unmount")); await saving;
  const reopened = getPromptDraftSession(701, options);
  try {
    assert.equal(reopened.controller, original.controller); assert.equal(reopened.states.a.draft, "must survive close"); assert.equal(reopened.states.a.entry.version, "v1"); assert.equal(reopened.states.a.status, "error");
    reopened.controller.seed([entry("a", "fresh server", "v9")]); assert.equal(reopened.states.a.draft, "must survive close");
    await reopened.controller.save("a"); assert.deepEqual(writes[1], writes[0]); assert.equal(reopened.states.a.status, "saved");
  } finally { reopened.controller.dispose(); }
});

test("page draft caches are isolated by user and delayed writes cannot run as another user", async () => {
  const { getPromptDraftSession } = await import("../src/components/setting/components/promptDraftController.ts");
  let currentUserId = 801; let writes = 0;
  const options = { currentUserId: () => currentUserId, delay: 100000, makeId: () => "user-isolation-request", read: async (key: string) => entry(key), write: async (_operation: string, input: PromptMutationInput) => { writes++; return entry(input.key, input.content, "v2"); } };
  const first = getPromptDraftSession(801, options); first.controller.seed([entry("a")]); first.controller.edit("a", "first user's draft");
  currentUserId = 802; const second = getPromptDraftSession(802, options); second.controller.seed([entry("a")]);
  try {
    assert.notEqual(first.controller, second.controller); assert.equal(second.states.a.draft, "default");
    await first.controller.save("a"); assert.equal(writes, 0); assert.equal(first.states.a.draft, "first user's draft");
    currentUserId = 801; await first.controller.save("a"); assert.equal(writes, 1);
  } finally { first.controller.dispose(); second.controller.dispose(); }
});
