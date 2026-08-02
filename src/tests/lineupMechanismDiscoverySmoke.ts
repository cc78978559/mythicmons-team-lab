import assert from "node:assert/strict";
import {discoverLineupMechanisms, lineupMechanismFeatureValues, type LineupMechanismSample} from "../ai/whiteBox/lineupMechanismDiscovery";

const samples: LineupMechanismSample[] = Array.from({length: 20}, (_, index) => ({
  id: `case-${index}`,
  managerId: `manager-${index}`,
  season: index % 8 + 1,
  direction: index < 10 ? "better" : index < 18 ? "worse" : "neutral",
  featureDeltas: {
    "lineup.signal": index < 10 ? 1 : index < 18 ? -1 : 0,
    "lineup.noise": index % 2 ? 1 : -1,
    "lineup.inactive": 0,
  },
}));
const result = discoverLineupMechanisms(samples);
assert.equal(result.conclusion, "candidate-existing-feature");
assert.equal(result.features.find(feature => feature.feature === "lineup.signal")?.eligible, true);
assert.equal(result.features.find(feature => feature.feature === "lineup.noise")?.eligible, false);
assert.deepEqual(result.metrics.inactiveFeatures, ["lineup.inactive"]);
assert.throws(() => discoverLineupMechanisms([...samples, {...samples[0], id: "duplicate-manager"}]));
assert.deepEqual(
  [...lineupMechanismFeatureValues({
    id: "candidate",
    contributions: [{id: "lineup.strength", value: 1}],
    diagnostics: {"lineup.structuralSinglePoints": 3},
  })],
  [["lineup.strength", 1], ["diagnostic:lineup.structuralSinglePoints", 3]],
);
assert.throws(() => lineupMechanismFeatureValues({id: "bad", diagnostics: {"lineup.bad": Number.NaN}}), /Malformed diagnostic/);
console.log("Lineup mechanism discovery smoke passed: independent managers, exact direction test, FDR adjustment, and inactive features");
