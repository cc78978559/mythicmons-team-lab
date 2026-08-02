import assert from "node:assert/strict";
import {buildShadowExperimentPlan, compactShadowExperimentQueue} from "../ai/whiteBox/shadowExperimentPlanner";

function candidate(id: string, rational: number, style: number) {
  return {
    id,
    eligible: true,
    reasonable: true,
    rationalScore: rational,
    rawStyleScore: style,
    appliedStyleScore: style,
    finalScore: rational + style,
    contributions: [
      {id: "strength", group: "strength", source: "competence", value: rational, reason: "strength"},
      {id: "style", group: "personality", source: "personality", value: style, reason: "style"},
    ],
  };
}

const boundary = {
  candidateCount: 2,
  reasonableBand: .5,
  styleContributionLimit: 3,
  comparison: {incumbent: "a", shadow: "a", agrees: true},
  candidates: [candidate("a", 10, 0), candidate("b", 9.98, .019)],
  decisionId: "lineup:one",
};
const incomplete = {...boundary, candidateCount: 8, decisionId: "lineup:two"};
const disagreement = {
  ...boundary,
  comparison: {incumbent: "a", shadow: "b", agrees: false},
  candidates: [candidate("b", 10.1, 0), candidate("a", 10, 0)],
  decisionId: "acquire:one",
};
const plan = buildShadowExperimentPlan([
  {domain: "lineup", season: 1, actor: "manager-01", recordId: "one", trace: boundary},
  {domain: "lineup", season: 1, actor: "manager-02", recordId: "two", trace: incomplete},
  {domain: "acquisition", season: 1, actor: "manager-03", recordId: "three", trace: disagreement},
]);
assert.equal(plan.observations, 3);
assert.equal(plan.completeTraces, 2);
assert.equal(plan.boundaryAgreements, 2);
assert.equal(plan.observedDisagreements, 1);
assert.equal(plan.boundedFlips, 2);
assert.equal(plan.replayReady, 2);
assert.equal(plan.blockedByIncompleteTrace, 1);
assert.equal(plan.byDomain.lineup.observations, 2);
assert.equal(plan.byDomain.acquisition.disagreements, 1);
assert.equal(plan.cases.find(entry => entry.decisionId === "lineup:one")?.reasonableBand, .5);
assert.equal(plan.cases.find(entry => entry.decisionId === "lineup:one")?.baselineStyleLimit, 3);
assert.equal(compactShadowExperimentQueue(plan, 2).cases.length, 2);
console.log("Shadow experiment planner smoke passed: boundary flips, retention blockers, readiness, and compact queue");
