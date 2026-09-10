import assert from "node:assert/strict";
import { getSourceDuration, getTimelineDuration, getTracksTimelineEnd } from "./timeline.ts";

assert.equal(getTimelineDuration("video", { generatedDuration: 4, plannedDuration: 2 }), 2);
assert.equal(getSourceDuration({ generatedDuration: 4, plannedDuration: 2 }), 4);
assert.equal(getTimelineDuration("video", { duration: 4, durationKind: "source" }), 5);
assert.equal(
  getTracksTimelineEnd([
    { clips: [{ startTime: 0, endTime: 2 }, { startTime: 2, endTime: 5 }] },
    { clips: [{ startTime: 0, endTime: 60 }] },
  ]),
  60,
);

const plannedShots = [2, 3, 4, 3, 3, 4, 3, 3, 4, 3, 3, 4, 3, 4, 4, 3, 3, 4];
let cursor = 0;
const plannedTrack = plannedShots.map((shot) => {
  const clip = { startTime: cursor, endTime: cursor + shot };
  cursor += shot;
  assert.equal(getTimelineDuration("video", { generatedDuration: 4, plannedDuration: shot }), shot);
  assert.equal(getSourceDuration({ generatedDuration: 4, plannedDuration: shot }), 4);
  return clip;
});
assert.equal(plannedShots.length, 18);
assert.equal(cursor, 60);
assert.equal(getTracksTimelineEnd([{ clips: plannedTrack }]), 60);

console.log("editVideo timeline tests passed");
