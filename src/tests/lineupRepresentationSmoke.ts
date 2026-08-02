import assert from "node:assert/strict";
import {evaluateWhiteBoxDecision, summarizeWhiteBoxShadow} from "../ai/whiteBox/decision";
import {buildLineupWhiteBoxCandidate, whiteBoxCandidateTotal, type WhiteBoxLineupMember} from "../ai/whiteBox/lineup";

const traits = {risk: 0, stars: 0, synergy: 0, counter: 0, value: 0, flexibility: 0};
const balanced = buildLineupWhiteBoxCandidate({
  id: "balanced",
  members: members(
    [["hazards"], ["removal"], ["recovery"], ["pivot"], ["physical"], ["special"]],
    [[1, 0, 0], [1, 0, 0], [0, 1, 0], [0, 1, 0], [0, 0, 1], [0, 0, 1]],
  ),
  traits,
  roleTargets: {},
});
const concentrated = buildLineupWhiteBoxCandidate({
  id: "concentrated",
  members: members(
    [["hazards"], ["hazards", "removal"], ["recovery"], ["pivot"], ["physical"], ["special"]],
    [[1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0]],
  ),
  traits,
  roleTargets: {},
});

assert.equal(whiteBoxCandidateTotal(balanced), whiteBoxCandidateTotal(concentrated), "diagnostics must not alter candidate utility");
assert.equal(balanced.rational.find(entry => entry.id === "lineup.structure")?.value, concentrated.rational.find(entry => entry.id === "lineup.structure")?.value);
assert.equal(balanced.rational.find(entry => entry.id === "lineup.coverage")?.value, concentrated.rational.find(entry => entry.id === "lineup.coverage")?.value);
assert.equal(balanced.diagnostics?.["lineup.opponentUnansweredCount"], 0);
assert.equal(concentrated.diagnostics?.["lineup.opponentUnansweredCount"], 2);
assert.equal(balanced.diagnostics?.["lineup.opponentMinimumAnswerDepth"], 2);
assert.equal(concentrated.diagnostics?.["lineup.opponentMinimumAnswerDepth"], 0);
assert.equal(balanced.diagnostics?.["lineup.structuralSinglePoints"], 4);
assert.equal(concentrated.diagnostics?.["lineup.structuralSinglePoints"], 3);
assert.equal(concentrated.diagnostics?.["lineup.structuralRedundancy"], 1);
assert.equal(balanced.diagnostics?.["lineup.representationVersion"], 5);
assert.equal(balanced.diagnostics?.["lineup.roleHazardsCount"], 1);
assert.equal(concentrated.diagnostics?.["lineup.roleHazardsCount"], 2);
assert.equal(balanced.diagnostics?.["lineup.rolePriorityCount"], 0);
assert.equal(balanced.diagnostics?.["lineup.speedFloor"], 80);
assert.equal(balanced.diagnostics?.["lineup.offensivePressureFloor"], 1);
assert.equal(concentrated.diagnostics?.["lineup.offensivePressureFloor"], .25);
assert.equal(balanced.diagnostics?.["lineup.defensiveRedundancyFloor"], .6);
assert.equal(concentrated.diagnostics?.["lineup.defensiveRedundancyFloor"], .2);
assert.equal(balanced.diagnostics?.["lineup.physicalPressureFloor"], .25);
assert.equal(balanced.diagnostics?.["lineup.priorityPressureFloor"], 0);
assert.equal(balanced.diagnostics?.["lineup.roleRecoverySafetyFloor"], .2);

const trace = evaluateWhiteBoxDecision({
  decisionId: "lineup:representation-v2",
  candidates: [balanced, concentrated],
  reasonableBand: 0,
  styleContributionLimit: 0,
});
assert.equal(trace.selected, "balanced", "a score tie must remain governed by the existing deterministic tie-break");
assert.equal(trace.candidates.find(candidate => candidate.id === "concentrated")?.diagnostics?.["lineup.opponentUnansweredCount"], 2);
assert.equal(summarizeWhiteBoxShadow(trace, "concentrated").candidates.find(candidate => candidate.id === "balanced")?.diagnostics?.["lineup.opponentMinimumAnswerDepth"], 2);
assert.throws(() => evaluateWhiteBoxDecision({
  decisionId: "lineup:invalid-diagnostic",
  candidates: [{id: "invalid", rational: [], diagnostics: {"lineup.bad": Number.NaN}}],
  reasonableBand: 0,
  styleContributionLimit: 0,
}), /Non-finite diagnostic/);

console.log("Lineup representation v5 smoke test passed");

function members(roles: readonly string[][], vectors: readonly number[][]): WhiteBoxLineupMember[] {
  return roles.map((memberRoles, index) => ({
    id: `member-${index}`,
    strength: 200,
    market: 10,
    roles: memberRoles,
    risk: 0,
    opponentCoverage: vectors[index].reduce((total, value) => total + value, 0),
    opponentCoverageVector: vectors[index],
    speed: 80 + index * 5,
    speedAdvantage: index / 6,
    offensivePressureVector: vectors[index].map(value => value ? 1 : .25),
    physicalPressureVector: vectors[index].map(value => memberRoles.includes("physical") ? value ? 1 : .25 : 0),
    specialPressureVector: vectors[index].map(value => memberRoles.includes("special") ? value ? 1 : .25 : 0),
    priorityPressureVector: vectors[index].map(() => 0),
    defensiveSafetyVector: vectors[index].map(value => value ? .6 : .2),
    historicalMatchup: 0,
    tacticalMemory: 0,
  }));
}
