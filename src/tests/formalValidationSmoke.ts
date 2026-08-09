import assert from "node:assert/strict";
import {evaluateFormalValidation, exactOneSidedBinomial, hasExactFormalValidationIntegrity, type FormalValidationCaseResult} from "../ai/formalValidation";

const result = (id: string, domainId: string, environment: string, direction: "better" | "neutral" | "worse"): FormalValidationCaseResult => ({id, domainId, managerId: "manager-01", ruleId: "rule-1", environment, phase: "mid", direction, expectedDirection: "better", outcomeChanged: direction !== "neutral", sourceVerified: true, prefixVerified: true, interventionVerified: true});
const strong = Array.from({length: 12}, (_, index) => result(`s${index}`, "switch", index < 6 ? "balanced" : "pressure", index < 10 ? "better" : "neutral"));
const weak = Array.from({length: 12}, (_, index) => result(`w${index}`, "status", index < 6 ? "balanced" : "pressure", index % 3 === 0 ? "better" : index % 3 === 1 ? "worse" : "neutral"));
const rows = evaluateFormalValidation(["switch", "status"], [...strong, ...weak], ["balanced", "pressure"], {targetCases: 12, minimumCasesPerEnvironment: 6, minimumDecisiveCases: 4, familywiseAlpha: .1});
assert.equal(rows.find(row => row.domainId === "switch")?.disposition, "limited-canary-eligible");
assert.equal(rows.find(row => row.domainId === "status")?.disposition, "rejected");
assert.equal(exactOneSidedBinomial(4, 4), .0625);
const broken = strong.map((row, index) => index ? row : {...row, prefixVerified: false});
assert.equal(hasExactFormalValidationIntegrity(broken[0]), false); assert.equal(hasExactFormalValidationIntegrity(strong[0]), true);
assert.equal(evaluateFormalValidation(["switch"], broken, ["balanced", "pressure"], {targetCases: 12, minimumCasesPerEnvironment: 6, minimumDecisiveCases: 4, familywiseAlpha: .1})[0].disposition, "blocked");
console.log("Formal validation smoke passed: cross-environment coverage, exact sign test, Holm correction, and integrity blocking");
