import assert from "node:assert/strict";
import {diagnoseFormalSemantics, FORMAL_SEMANTIC_DIAGNOSTICS_AUTHORITY, validateFormalSemanticDiagnostics, type FormalSemanticDiagnosticCase} from "../ai/formalSemanticDiagnostics";

const outcomes = ["support", "support", "support", "support", "contradiction", "contradiction", "contradiction", "neutral", "neutral"] as const;
const cases: FormalSemanticDiagnosticCase[] = outcomes.map((outcome, index) => ({
  id: `case-${index}`,
  domainId: "battle-switch-structure",
  environment: index % 2 ? "league-current" : "modern-benchmark",
  clusterId: `cluster-${index}`,
  phase: index < 5 ? "early" : "mid",
  outcome,
  sourceFingerprint: (index + 1).toString(16).padStart(64, "0"),
  features: {
    activeHpDelta: [-.2, .1, -.1, .2, -.15, .15, 0, -.05, .05][index],
    opponentStructureResponseDelta: outcome === "support" ? -.3 + index * .02 : outcome === "contradiction" ? .2 + index * .01 : 0,
    roleCompressionDelta: (index % 3 - 1) * .1,
  },
}));

const diagnostic = diagnoseFormalSemantics({cases, bindings: {freezeSha256: "a".repeat(64), planSha256: "b".repeat(64), resultsSha256: "c".repeat(64), frontierSha256: "d".repeat(64)}, generatedAt: "2026-08-15T00:00:00.000Z"});
validateFormalSemanticDiagnostics(diagnostic);
assert.equal(diagnostic.authority, FORMAL_SEMANTIC_DIAGNOSTICS_AUTHORITY);
assert.equal(diagnostic.excludedValidationFingerprints.length, cases.length);
assert.deepEqual(diagnostic.prohibitedUses, ["stage4-support-count", "stage5-validation", "policy-activation"]);
const domain = diagnostic.domains[0];
assert.deepEqual(domain.outcomes, {support: 4, contradiction: 3, neutral: 2});
assert.equal(domain.singleConditionHints[0].predicates[0].feature, "opponentStructureResponseDelta");
assert.equal(domain.singleConditionHints[0].supportsInside, 4);
assert.equal(domain.singleConditionHints[0].contradictionsInside, 0);

const tampered = structuredClone(diagnostic);
tampered.authority = "validation-only-no-automatic-activation" as typeof tampered.authority;
assert.throws(() => validateFormalSemanticDiagnostics(tampered), /Invalid formal semantic diagnostics envelope/);
console.log("Formal semantic diagnostics smoke passed: 4:3 separation, signed provenance, post-hoc-only authority, and tamper blocking");
