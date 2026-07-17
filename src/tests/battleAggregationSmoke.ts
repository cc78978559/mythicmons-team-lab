import assert from "node:assert/strict";
import {aggregateBattleCounterfactuals} from "../ai/whiteBox/battleAggregation";
import {aggregateUnifiedBattleEvidence} from "../ai/whiteBox/unifiedAggregation";

const outcome = (winner: string | null) => ({winner, turns: 20, ended: true, timeout: false, stalled: false, errors: []});
const sample = (index: number, incumbent: string | null, whitebox: string | null, prefixVerified = true) => ({seed: `seed-${index % 10}`, caseId: `case-${index}`, sourceVerified: true, prefixVerified, playerId: "p1" as const, incumbent: outcome(incumbent), whitebox: outcome(whitebox)});

const positive = [
  ...Array.from({length: 8}, (_, index) => sample(index, "Team B", "Team A")),
  ...Array.from({length: 2}, (_, index) => sample(index + 8, "Team A", "Team B")),
  ...Array.from({length: 20}, (_, index) => sample(index + 10, "Team A", "Team A")),
];
const aggregate = aggregateBattleCounterfactuals(positive);
assert.equal(aggregate.metrics.decisivePairs, 10);
assert.equal(aggregate.metrics.oneSidedImprovementP, .054688);
assert.equal(aggregate.promotion, "candidate-for-assist");
assert.equal(aggregateUnifiedBattleEvidence("battle-h", positive).activationEligible, true);

const negative = positive.map((entry, index) => sample(index, entry.whitebox.winner, entry.incumbent.winner));
assert.equal(aggregateBattleCounterfactuals(negative).promotion, "reject-hypothesis");
const neutral = Array.from({length: 30}, (_, index) => sample(index, "Team A", "Team A"));
assert.equal(aggregateBattleCounterfactuals(neutral).promotion, "reject-hypothesis");
assert.equal(aggregateBattleCounterfactuals([sample(0, "Team B", "Team A", false)], {minimumSamples: 3, minimumSeeds: 2, minimumDecisivePairs: 2}).promotion, "blocked");

console.log("Battle counterfactual aggregation smoke test passed");
