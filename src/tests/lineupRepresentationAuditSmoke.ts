import assert from "node:assert/strict";
import {auditLineupRepresentation, type LineupRepresentationObservation} from "../ai/whiteBox/lineupRepresentationAudit";

const observations: LineupRepresentationObservation[] = Array.from({length: 24}, (_, index) => ({
  season: index % 4 + 1,
  managerId: `manager-${index}`,
  trace: {
    comparison: {incumbent: "old", shadow: "new"},
    candidates: [
      {id: "old", diagnostics: {"lineup.representationVersion": 2, "lineup.depth": 1, "lineup.gaps": 2, "lineup.floor": 100, "lineup.spread": 5}},
      {id: "new", diagnostics: {"lineup.representationVersion": 2, "lineup.depth": 2, "lineup.gaps": 1, "lineup.floor": 101, "lineup.spread": index % 2 ? 4 : 6}},
    ],
  },
}));
const ready = auditLineupRepresentation(observations, {minimumTraces: 20, minimumManagers: 20, minimumSeasons: 4, minimumContrasts: 20, minimumVariableFeatures: 4});
assert.equal(ready.conclusion, "ready-for-outcome-linkage");
assert.equal(ready.metrics.variableFeatures, 4);
assert.equal(ready.features.find(feature => feature.feature === "lineup.depth")?.nonZero, 24);
assert(!ready.features.some(feature => feature.feature === "lineup.representationVersion"));
const absent = auditLineupRepresentation([{season: 1, managerId: "manager", trace: {comparison: {incumbent: "old", shadow: "old"}, candidates: [{id: "old"}]}}]);
assert.equal(absent.conclusion, "no-v2-telemetry");
assert.throws(() => auditLineupRepresentation([{season: 0, managerId: "", trace: {}}]));
console.log("Lineup representation audit smoke passed: coverage, variance, readiness, and no-telemetry states");
