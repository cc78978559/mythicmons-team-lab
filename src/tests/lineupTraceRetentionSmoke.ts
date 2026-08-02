import assert from "node:assert/strict";
import {shouldRetainFullLineupTrace} from "../ai/whiteBox/lineupTraceRetention";

assert.equal(shouldRetainFullLineupTrace("lineup:a", {}), false);
assert.equal(shouldRetainFullLineupTrace("lineup:a", {V4_WHITEBOX_FULL_LINEUP_TRACE: "true"}), true);
assert.equal(shouldRetainFullLineupTrace("lineup:b", {V4_WHITEBOX_FULL_LINEUP_TARGETS: "lineup:a, lineup:b"}), true);
assert.equal(shouldRetainFullLineupTrace("lineup:c", {V4_WHITEBOX_FULL_LINEUP_TARGETS: "lineup:a,lineup:b"}), false);
console.log("Lineup trace retention smoke passed: global and targeted full-candidate retention");
