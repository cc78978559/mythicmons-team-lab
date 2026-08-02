import assert from "node:assert/strict";
import {auditLineupHypotheses, buildLineupHypothesisCausalPlan, validateLineupHypothesisRegistry, type LineupHypothesisCandidateRow, type LineupHypothesisObservation, type LineupHypothesisRegistry, type ManagerExperimentEvidence} from "../ai/whiteBox/lineupHypothesisWorkbench";

const registry: LineupHypothesisRegistry = {schemaVersion: 1, activationStatus: "shadow-only", hypotheses: [
  {id: "speed-reviewed-v1", title: "Reviewed speed", rationale: "Already tested", stage: "causal-complete", combine: "weighted-geometric-percentile", factors: [{feature: "lineup.speedAdvantageMean", direction: "higher", weight: 1}], scope: ["all-lineups"], guardrails: [{feature: "lineup.strengthFloor", minimumDelta: -5}], causalEvidence: {study: "study", better: 0, neutral: 21, worse: 3, conclusion: "no-clear-benefit"}},
  {id: "pressure-combination-v1", title: "Pressure combination", rationale: "Synthetic positive mechanism", stage: "proposed", combine: "weighted-geometric-percentile", factors: [{feature: "lineup.speedAdvantageMean", direction: "higher", weight: 1}, {feature: "lineup.offensivePressureFloor", direction: "higher", weight: 1}], scope: ["all-lineups"], guardrails: []},
]};
assert.equal(validateLineupHypothesisRegistry(registry), registry);
assert.throws(() => validateLineupHypothesisRegistry({...registry, activationStatus: "active"} as any), /Invalid lineup hypothesis registry/);

const rows: LineupHypothesisObservation[] = [];
for (let season = 1; season <= 3; season++) for (let index = 0; index < 30; index++) {
  const left = `manager-${String(index + 1).padStart(2, "0")}`, right = `manager-${String((index + 1) % 30 + 1).padStart(2, "0")}`, leftWins = (index + season) % 2 === 0;
  const winner = leftWins ? left : right, loser = leftWins ? right : left, seriesId = `round-${index}`;
  rows.push({seriesId, season, managerId: winner, outcome: "win", diagnostics: {"lineup.speedAdvantageMean": season + index / 100 + .4, "lineup.offensivePressureFloor": 5 + season + .4}});
  rows.push({seriesId, season, managerId: loser, outcome: "loss", diagnostics: {"lineup.speedAdvantageMean": season + index / 100, "lineup.offensivePressureFloor": 5 + season}});
}
const audit = auditLineupHypotheses(rows, registry, 1000);
const proposed = audit.findings.find(finding => finding.id === "pressure-combination-v1")!;
const reviewed = audit.findings.find(finding => finding.id === "speed-reviewed-v1")!;
assert.equal(audit.activationStatus, "shadow-only"); assert.equal(audit.metrics.managers, 30); assert.equal(audit.metrics.seasons, 3);
assert.equal(audit.metrics.decisivePairs, 90, "same series ids in different seasons must remain distinct");
assert.equal(proposed.observationalCandidate, true); assert.equal(proposed.auditStage, "observational-candidate");
assert.equal(reviewed.auditStage, "causal-complete"); assert.equal(reviewed.causalConclusion, "no-clear-benefit");
assert.match(reviewed.nextAction, /do not reactivate/);
const planRows: LineupHypothesisCandidateRow[] = [];
for (let season = 1; season <= 3; season++) for (const outcome of ["win", "loss"] as const) for (let index = 0; index < 6; index++) {
  const managerId = `plan-${season}-${outcome}-${index}`, baseline = season + index / 10;
  planRows.push({season, outcome, managerId, seriesId: `series-${season}-${outcome}-${index}`, incumbentId: `${managerId}-incumbent`, candidates: [
    {id: `${managerId}-incumbent`, diagnostics: {"lineup.speedAdvantageMean": baseline, "lineup.offensivePressureFloor": baseline + 4}},
    {id: `${managerId}-candidate`, diagnostics: {"lineup.speedAdvantageMean": baseline + 1, "lineup.offensivePressureFloor": baseline + 5}},
  ]});
}
const plan = buildLineupHypothesisCausalPlan(planRows, registry.hypotheses[1], 6, .01);
assert.equal(plan.selected.length, 6); assert.equal(plan.coverage.managers, 6); assert.deepEqual(plan.coverage.sourceOutcomes, {win: 3, loss: 3});
assert.equal(plan.opportunityPolicy, "balanced-manager-unique-v1");
const evidence = new Map(planRows.map(row => [row.managerId, {mechanismAttempts: row.managerId.endsWith("-5") ? 0 : 2, totalAttempts: row.managerId.endsWith("-5") ? 0 : 4}]));
const fairPlan = buildLineupHypothesisCausalPlan(planRows, registry.hypotheses[1], 6, .01, evidence);
assert.equal(fairPlan.opportunityPolicy, "personal-evidence-fairness-v1"); assert.equal(fairPlan.opportunityCoverage?.selectedWithoutMechanismEvidence, 6); assert.equal(Object.keys(fairPlan.opportunityEvidence ?? {}).length, 36); assert.deepEqual(fairPlan.coverage.seasons, {"1": 2, "2": 2, "3": 2}); assert.ok(fairPlan.selected.every(choice => choice.managerId.endsWith("-5")), "eligible managers without evidence must receive the bounded experiment opportunities first");
const preferences = new Map(planRows.map(row => [row.managerId, {mechanismAttempts: row.managerId.endsWith("-4") ? 3 : 0, totalAttempts: row.managerId.endsWith("-4") ? 6 : 0, researchPreferenceRank: row.managerId.endsWith("-4") ? 0 : 1}]));
const preferencePlan = buildLineupHypothesisCausalPlan(planRows, registry.hypotheses[1], 6, .01, preferences); assert.equal(preferencePlan.opportunityCoverage?.selectedFirstChoiceRequests, 6); assert.ok(preferencePlan.selected.every(choice => choice.managerId.endsWith("-4")), "first-choice research requests must outrank lower-choice requests without breaking strata");
assert.throws(() => buildLineupHypothesisCausalPlan(planRows, registry.hypotheses[0], 6), /already has causal evidence/);
const replicationEvidence = new Map<string, ManagerExperimentEvidence>(planRows.map(row => [row.managerId, {mechanismAttempts: 1, totalAttempts: 2, researchPreferenceRank: row.managerId.endsWith("-4") ? 0 : 64}]));
const reviewedPressure = {...registry.hypotheses[1], stage: "causal-complete" as const, causalEvidence: {study: "reviewed-pressure", better: 1, neutral: 4, worse: 1, conclusion: "no-clear-benefit"}};
const replicationPlan = buildLineupHypothesisCausalPlan(planRows, reviewedPressure, 6, .01, replicationEvidence, {allowReviewedReplication: true, maximumResearchPreferenceRank: 0}); assert.equal(replicationPlan.selected.length, 6); assert.ok(replicationPlan.selected.every(choice => choice.managerId.endsWith("-4")));
const localReplicationPlan = buildLineupHypothesisCausalPlan(planRows, reviewedPressure, 5, .01, replicationEvidence, {allowReviewedReplication: true, maximumResearchPreferenceRank: 0}); assert.equal(localReplicationPlan.selected.length, 5); assert.equal(localReplicationPlan.causalScope, "personal-local-replication"); assert.equal(new Set(localReplicationPlan.selected.map(choice => `${choice.season}:${choice.sourceOutcome}`)).size, 5);
assert.throws(() => buildLineupHypothesisCausalPlan(planRows, registry.hypotheses[1], 5, .01), /multiple of six/);
const duplicateBlockedEvidence = new Map(replicationEvidence), blocked = replicationPlan.selected[0]; duplicateBlockedEvidence.set(blocked.managerId, {...duplicateBlockedEvidence.get(blocked.managerId)!, priorChoiceIds: [blocked.id]}); assert.throws(() => buildLineupHypothesisCausalPlan(planRows, reviewedPressure, 6, .01, duplicateBlockedEvidence, {allowReviewedReplication: true, maximumResearchPreferenceRank: 0}), /Only 5\/6/);
assert.throws(() => buildLineupHypothesisCausalPlan(planRows, registry.hypotheses[1], 6, .01, preferences, {allowReviewedReplication: true}), /requires causal-complete/);
console.log("Lineup hypothesis workbench smoke passed: registry, conditional factors, residual screen, FDR, causal precedence, and fair opportunity allocation");
