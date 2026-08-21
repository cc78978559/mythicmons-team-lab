import assert from "node:assert/strict";
import {buildAutonomousResearchAgenda, createAutonomousResearchState} from "../ai/autonomousResearch";
import {formalMechanismSemanticKey} from "../ai/formalValidation";
import {MANAGER_PROGRAM_V2_LANGUAGE, type ManagerProgramRuleV2, type ManagerProgramSampleV2, type ManagerProgramV2} from "../ai/managerProgramV2";
import {deriveSemanticHypothesisRevisions, validateSemanticRevisionRule} from "../ai/semanticHypothesisRevision";

const parent: ManagerProgramRuleV2 = {
  id: "parent-broad-rule",
  domain: "battle",
  target: "switch",
  predicates: [{feature: "activeHpDelta", operator: "gte", threshold: -.5}, {feature: "positionValue", operator: "lt", threshold: .8}],
  effect: .12,
  support: 180,
  uncertainty: .2,
  authority: "local-value-observational",
  evidenceIds: ["parent-evidence"],
};

const samples: ManagerProgramSampleV2[] = Array.from({length: 240}, (_, index) => {
  const context = (index % 10) / 10, activeHpDelta = ((index * 7) % 20) / 10 - 1, positionValue = ((index * 11) % 20) / 10 - 1;
  return {
    id: `sample-${index}`,
    battleId: `battle-${index}`,
    clusterId: `cluster-${index}`,
    domain: "battle",
    action: "switch",
    features: {activeHpDelta, positionValue, opponentStructureResponseDelta: context, roleCompressionDelta: 1 - context},
    localValueDelta: context >= .5 ? .24 + context * .04 : -.18,
    authority: "local-value-observational",
  };
});

const first = deriveSemanticHypothesisRevisions({parent, samples, seed: "formal-feedback-seed", maxPredicates: 2, limit: 6});
const second = deriveSemanticHypothesisRevisions({parent, samples, seed: "formal-feedback-seed", maxPredicates: 2, limit: 6});
assert.ok(first.length >= 2, `expected multiple semantic revisions, got ${first.length}`);
assert.deepEqual(first, second, "semantic revisions must be deterministic for a signed corpus and seed");
for (const candidate of first) {
  validateSemanticRevisionRule(candidate.rule, parent);
  assert.notEqual(formalMechanismSemanticKey(candidate.rule), formalMechanismSemanticKey(parent));
  assert.ok(candidate.discoverySupport >= 18 && candidate.validationSupport >= 8);
  assert.ok(candidate.discoveryClusters >= 6 && candidate.validationClusters >= 3);
  assert.ok(candidate.discoveryMean > 0 && candidate.validationMean > 0);
}

const child = first[0].rule;
const program: ManagerProgramV2 = {
  schemaVersion: 2,
  language: MANAGER_PROGRAM_V2_LANGUAGE,
  activationStatus: "shadow-only",
  managerId: "manager-semantic",
  revision: 0,
  rules: [child],
  history: [],
  limits: {maxRules: 12, maxPredicates: 2, maxEvaluatedRules: 32},
  evidence: {decisionDossierPolicy: "smoke", positionModelSha256: "1".repeat(64), corpusSignature: "2".repeat(64)},
};
const agenda = buildAutonomousResearchAgenda({program, state: createAutonomousResearchState(program.managerId), round: 1, feasibleCases: {[child.id]: 20}, seed: "agenda-seed"});
assert.equal(agenda.selected?.intent, "revise-formal-boundary");
assert.equal(agenda.selected?.components.formalRevisionPriority, 1);
assert.equal(agenda.selected?.ruleSnapshot.lineage?.parentRuleId, parent.id);
console.log(`Semantic hypothesis revision smoke passed: ${first.length} deterministic children with independent cluster validation and signed lineage`);
