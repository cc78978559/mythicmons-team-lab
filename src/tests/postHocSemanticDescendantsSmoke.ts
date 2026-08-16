import assert from "node:assert/strict";
import {diagnoseFormalSemantics} from "../ai/formalSemanticDiagnostics";
import {assessPostHocDiagnosticSeed, assignManagerSemanticDescendants, classifySemanticResearchEvidence, derivePostHocSemanticDescendants, selectManagerSemanticDescendant} from "../ai/postHocSemanticDescendants";
import {MANAGER_PROGRAM_V2_LANGUAGE, type ManagerProgramRuleV2, type ManagerProgramSampleV2, type ManagerProgramV2} from "../ai/managerProgramV2";

const hash = (digit: string) => digit.repeat(64);
const parent: ManagerProgramRuleV2 = {id: "parent-switch", domain: "battle", target: "switch", predicates: [{feature: "activeStatusDelta", operator: "gte", threshold: 0}, {feature: "opponentStructureResponseDelta", operator: "lt", threshold: 0}], effect: .15, support: 90, uncertainty: .2, authority: "local-value-observational", evidenceIds: ["parent"]};
const cases = Array.from({length: 24}, (_, index) => ({id: `formal-${index}`, domainId: "focus-domain", environment: index % 2 ? "league" : "modern", clusterId: `formal-cluster-${index}`, phase: (index < 12 ? "early" : index < 20 ? "mid" : "late") as "early" | "mid" | "late", outcome: (index < 4 ? "support" : index < 7 ? "contradiction" : "neutral") as "support" | "contradiction" | "neutral", sourceFingerprint: hash(((index % 9) + 1).toString()), features: {boostDelta: index < 4 ? -.2 : index < 7 ? .25 : (index % 5 - 2) / 10, hpDelta: index < 4 ? .15 : index < 7 ? -.5 : (index % 7 - 3) / 10, opponentStructureResponseDelta: -.1, activeStatusDelta: .2}}));
const diagnostic = diagnoseFormalSemantics({cases, bindings: {freezeSha256: hash("a"), planSha256: hash("b"), resultsSha256: hash("c"), frontierSha256: hash("d")}, generatedAt: "2026-08-15T00:00:00.000Z"});
assert.equal(assessPostHocDiagnosticSeed(diagnostic.domains[0]).eligible, true);
const samples: ManagerProgramSampleV2[] = Array.from({length: 480}, (_, index) => { const boostDelta = (index % 20 - 10) / 20, hpDelta = ((index * 7) % 24 - 12) / 12, favorable = boostDelta < .1 && hpDelta >= -.35; return {id: `independent-${index}`, battleId: `battle-${index}`, clusterId: `independent-cluster-${index}`, domain: "battle", action: "switch", features: {boostDelta, hpDelta, opponentStructureResponseDelta: ((index * 11) % 20 - 10) / 20, activeStatusDelta: (index % 3) / 3}, localValueDelta: favorable ? .24 : -.16, authority: "local-value-observational"}; });
const first = derivePostHocSemanticDescendants({parent, diagnostic, domain: diagnostic.domains[0], samples, seed: "independent-seed", limit: 16}), second = derivePostHocSemanticDescendants({parent, diagnostic, domain: diagnostic.domains[0], samples, seed: "independent-seed", limit: 16});
assert.ok(first.length > 1, `expected independently estimated descendants, got ${first.length}`);
assert.deepEqual(first, second);
for (const child of first) {
  assert.equal(child.rule.lineage?.hypothesisSeed?.authority, "post-hoc-hypothesis-generation-only");
  assert.equal(child.rule.lineage?.hypothesisSeed?.diagnosticSha256, diagnostic.sha256);
  assert.ok(child.rule.evidenceIds.every(id => id.startsWith("independent-")), "formal cases must not become child evidence");
  assert.ok(child.independentDiscoveryClusters >= 6 && child.independentValidationClusters >= 3);
}
const program = (managerId: string, feature: string): ManagerProgramV2 => ({schemaVersion: 2, language: MANAGER_PROGRAM_V2_LANGUAGE, activationStatus: "shadow-only", managerId, revision: 0, rules: [{...parent, id: `${managerId}-preference`, predicates: [{feature, operator: "gte", threshold: 0}]}], history: [], limits: {maxRules: 12, maxPredicates: 2, maxEvaluatedRules: 32}, evidence: {decisionDossierPolicy: "smoke", positionModelSha256: hash("e"), corpusSignature: hash("f")}});
assert.ok(selectManagerSemanticDescendant(program("manager-a", "boostDelta"), first.map(value => value.rule), "choice"));
assert.ok(selectManagerSemanticDescendant(program("manager-b", "hpDelta"), first.map(value => value.rule), "choice"));
const allocation = assignManagerSemanticDescendants(Array.from({length: 8}, (_, index) => program(`allocated-${index}`, index % 2 ? "boostDelta" : "hpDelta")), first.map(value => value.rule), "allocation");
assert.equal(allocation.size, 8); assert.equal(new Set([...allocation.values()].map(rule => rule.id)).size, 8, "scarce research slots should cover distinct viable children before duplication");
assert.equal(classifySemanticResearchEvidence({supports: 0, contradictions: 0, neutral: 2, managers: 2, supportingManagers: 0, independentSources: 2}), "explore");
assert.equal(classifySemanticResearchEvidence({supports: 1, contradictions: 0, neutral: 1, managers: 1, supportingManagers: 1, independentSources: 2}), "replicate");
assert.equal(classifySemanticResearchEvidence({supports: 2, contradictions: 0, neutral: 2, managers: 2, supportingManagers: 1, independentSources: 4}), "replicate");
assert.equal(classifySemanticResearchEvidence({supports: 2, contradictions: 0, neutral: 2, managers: 2, supportingManagers: 2, independentSources: 4}), "stage5-screen");
assert.equal(classifySemanticResearchEvidence({supports: 1, contradictions: 2, neutral: 0, managers: 2, supportingManagers: 1, independentSources: 3}), "retire");
const weakCases = cases.map((value, index) => ({...value, outcome: (index === 0 ? "support" : index < 3 ? "contradiction" : "neutral") as "support" | "contradiction" | "neutral"}));
const weakDiagnostic = diagnoseFormalSemantics({cases: weakCases, bindings: {freezeSha256: hash("1"), planSha256: hash("2"), resultsSha256: hash("3"), frontierSha256: hash("4")}, generatedAt: "2026-08-15T00:00:00.000Z"});
const weakReadiness = assessPostHocDiagnosticSeed(weakDiagnostic.domains[0]);
assert.equal(weakReadiness.eligible, false); assert.deepEqual(weakReadiness.reasons.sort(), ["insufficient-decisive-counterexamples", "insufficient-support-shape"]);
assert.equal(derivePostHocSemanticDescendants({parent, diagnostic: weakDiagnostic, domain: weakDiagnostic.domains[0], samples, seed: "weak-seed"}).length, 0, "low-information diagnostics must remain dormant instead of spawning fitted descendants");
console.log(`Post-hoc semantic descendants smoke passed: ${first.length} independently fitted children, manager selection, isolation, and progressive gates`);
