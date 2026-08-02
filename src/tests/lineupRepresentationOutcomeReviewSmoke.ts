import assert from "node:assert/strict";
import {reviewLineupRepresentationOutcomes, screenResidualLineupOutcomes, type LineupRepresentationOutcomePair, type LineupRepresentationResidualRow} from "../ai/whiteBox/lineupRepresentationOutcomeReview";

const pairs: LineupRepresentationOutcomePair[] = Array.from({length: 15}, (_, index) => ({
  id: `series-${index}`,
  season: index % 3 + 1,
  managers: [`manager-${index * 2}`, `manager-${index * 2 + 1}`],
  featureDeltas: {"lineup.signal": 1, "lineup.noise": index % 2 ? 1 : -1, "lineup.inactive": 0},
}));
const review = reviewLineupRepresentationOutcomes(pairs, pairs);
assert.equal(review.conclusion, "candidate-associations-found");
assert.equal(review.features.find(feature => feature.feature === "lineup.signal")?.candidateForCausalStudy, true);
assert.equal(review.features.find(feature => feature.feature === "lineup.noise")?.candidateForCausalStudy, false);
assert.equal(review.features.find(feature => feature.feature === "lineup.inactive")?.orientation, "none");
assert.throws(() => reviewLineupRepresentationOutcomes(pairs, [...pairs.slice(0, 2), {...pairs[2], managers: pairs[0].managers}]));
const residualRows: LineupRepresentationResidualRow[] = Array.from({length: 4}, (_, round) =>
  Array.from({length: 30}, (_, index) => {
    const left = `manager-${index}`, right = `manager-${(index + round + 1) % 30}`;
    const signal = (index + round) % 2 ? 1 : -1;
    return {id: `residual-${round}-${index}`, season: round % 3 + 1, leftManager: left, rightManager: right, outcome: signal as 1 | -1, leftFeatures: {signal}, rightFeatures: {signal: -signal}};
  }),
).flat();
const residual = screenResidualLineupOutcomes(residualRows, 200);
assert.equal(residual.features.find(feature => feature.feature === "signal")?.candidateForCausalStudy, true);
assert.deepEqual(residual, screenResidualLineupOutcomes(residualRows, 200), "permutation screen must be deterministic");
console.log("Lineup representation outcome review smoke passed: independent managers, exact signs, FDR, and saturation");
