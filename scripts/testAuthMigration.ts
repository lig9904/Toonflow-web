import assert from "node:assert/strict";
import { isLegacyExchangePath, normalizeSessionUser } from "../src/utils/sessionContract.ts";

assert.equal(isLegacyExchangePath("/api/session/exchange"), true, "exchange may carry a legacy token");
assert.equal(isLegacyExchangePath("/api/team/me"), false, "normal cookie requests never carry a legacy token");
assert.deepEqual(
  normalizeSessionUser({ code: 200, data: { authenticated: true, id: 3, name: "Ada", role: "editor" } }),
  { authenticated: true, id: 3, name: "Ada", role: "editor" },
  "login response is reduced to non-secret metadata",
);
assert.equal(normalizeSessionUser({ code: 200, data: { token: "secret" } }), null, "bearer-only responses are rejected");
console.log("auth migration contract checks passed");
