import assert from "node:assert/strict";
import {buildManagerResearchAgenda, createManagerResearchPolicy, reviewManagerResearchRound, summarizeManagerResearchAgendas, type ResearchHypothesisOption} from "../ai/managerResearchAgenda";
import {createManagerMechanismLedger, recordManagerMechanismEvidence} from "../ai/managerMechanismLedger";

const hypotheses: ResearchHypothesisOption[] = [
  {id: "new-safe-speed-v1", title: "New safe speed", observationalCandidate: true, causalConclusion: null},
  {id: "reviewed-pressure-v1", title: "Reviewed pressure", observationalCandidate: false, causalConclusion: "no-clear-benefit"},
  {id: "blocked-depth-v1", title: "Blocked depth", observationalCandidate: false, causalConclusion: null},
];
let positive = createManagerMechanismLedger("manager-01");
positive = recordManagerMechanismEvidence(positive, {evidenceId: "causal:positive-0001", managerId: "manager-01", mechanismId: "reviewed-pressure-v1", season: 1, level: "exact-counterfactual", expressed: true, effect: 1, context: {season: 1}});
const exploitPolicy = createManagerResearchPolicy("manager-01"); exploitPolicy.exploration = .05;
const exploitAgenda = buildManagerResearchAgenda("manager-01", positive, hypotheses, 1, exploitPolicy);
assert.equal(exploitAgenda.selected?.mechanismId, "reviewed-pressure-v1"); assert.equal(exploitAgenda.selected?.intent, "replicate-local-benefit"); assert.equal(exploitAgenda.deferred.find(value => value.mechanismId === "blocked-depth-v1")?.reason, "Public observational gate has not approved causal scheduling");
const explorePolicy = createManagerResearchPolicy("manager-01"); explorePolicy.exploration = .95;
const exploreAgenda = buildManagerResearchAgenda("manager-01", positive, hypotheses, 1, explorePolicy);
assert.equal(exploreAgenda.selected?.mechanismId, "new-safe-speed-v1");

let negative = createManagerMechanismLedger("manager-02");
negative = recordManagerMechanismEvidence(negative, {evidenceId: "causal:negative-0001", managerId: "manager-02", mechanismId: "reviewed-pressure-v1", season: 1, level: "exact-counterfactual", expressed: true, effect: -1, context: {season: 1}});
const negativeAgenda = buildManagerResearchAgenda("manager-02", negative, hypotheses, 1, createManagerResearchPolicy("manager-02")); assert.equal(negativeAgenda.ranked.find(value => value.mechanismId === "reviewed-pressure-v1")?.intent, "map-local-failure");
const summary = summarizeManagerResearchAgendas([exploitAgenda, negativeAgenda]) as any; assert.equal(summary.managers, 2); assert.equal(summary.managersWithRequest, 2);
const reviewedExploration = reviewManagerResearchRound(explorePolicy, exploreAgenda, {managerId: "manager-01", mechanismId: exploreAgenda.selected!.mechanismId, direction: "better", expressionRate: 1, outcomeChangeRate: 1}); assert.equal(reviewedExploration.executed, true); assert.ok(reviewedExploration.policy.exploration > .5); assert.equal(reviewedExploration.policy.completedRounds, 1);
const reviewedReplication = reviewManagerResearchRound(exploitPolicy, exploitAgenda, {managerId: "manager-01", mechanismId: exploitAgenda.selected!.mechanismId, direction: "better", expressionRate: 1, outcomeChangeRate: 1}); assert.ok(reviewedReplication.policy.exploration < .5); assert.equal(reviewedReplication.informationReward, 1);
const lowerChoice = reviewManagerResearchRound(exploitPolicy, exploitAgenda, {managerId: "manager-01", mechanismId: exploitAgenda.ranked[1].mechanismId, direction: "neutral", expressionRate: 1, outcomeChangeRate: 0}); assert.equal(lowerChoice.preferenceRank, 1); assert.equal(lowerChoice.executedMechanismId, exploitAgenda.ranked[1].mechanismId);
const unexecuted = reviewManagerResearchRound(createManagerResearchPolicy("manager-02"), negativeAgenda); assert.equal(unexecuted.executed, false); assert.equal(unexecuted.policy.exploration, .5);
assert.throws(() => buildManagerResearchAgenda("manager-03", positive, hypotheses, 1, createManagerResearchPolicy("manager-03")), /Invalid manager research agenda input/);
console.log("Manager research agenda smoke passed: autonomous exploration, replication, failure mapping, public gates, and shadow isolation");
