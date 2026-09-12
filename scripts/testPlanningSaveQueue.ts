import test from "node:test";
import assert from "node:assert/strict";
import {nextQueuedPlanningVersion} from "../src/utils/planningSaveQueue.ts";
test("own consecutive generated saves advance from their own receipt",()=>{assert.equal(nextQueuedPlanningVersion(3,3,4,3),4);});
test("manual or external saved version must not silently rebase a stale queued snapshot",()=>{assert.equal(nextQueuedPlanningVersion(3,3,4,9),3);assert.equal(nextQueuedPlanningVersion(2,3,4,3),2);});
test("a no-op order save and missing current scope cannot manufacture a new base",()=>{assert.equal(nextQueuedPlanningVersion(3,3,3,3),3);assert.equal(nextQueuedPlanningVersion(3,3,4,undefined),3);});
