import assert from "node:assert/strict";
import {buildLineupSpeedCausalPlan, type LineupSpeedCausalChoice} from "../ai/whiteBox/lineupSpeedCausalPlan";

const choices: LineupSpeedCausalChoice[] = [];
for (let manager = 0; manager < 30; manager++) for (const season of [22, 23, 24]) for (const sourceOutcome of ["win", "loss"] as const) choices.push({
  id: `${manager}:${season}:${sourceOutcome}`,
  decisionId: `lineup:series-${manager}-${season}-${sourceOutcome}:manager-${manager}`,
  season,
  managerId: `manager-${manager}`,
  sourceOutcome,
  incumbentId: `old-${manager}`,
  candidateId: `new-${manager}`,
  deltas: {speedAdvantageMean: .1, strengthFloor: 0, roleTagBreadth: 0},
});
const plan = buildLineupSpeedCausalPlan(choices, 24);
assert.equal(plan.selected.length, 24);
assert.equal(plan.coverage.managers, 24);
assert.deepEqual(plan.coverage.seasons, {"22": 8, "23": 8, "24": 8});
assert.deepEqual(plan.coverage.sourceOutcomes, {win: 12, loss: 12});
assert.throws(() => buildLineupSpeedCausalPlan(choices.map(choice => ({...choice, deltas: {...choice.deltas, speedAdvantageMean: 0}})), 24));
console.log("Lineup speed causal plan smoke passed: manager uniqueness, season balance, outcome balance, and guardrails");
