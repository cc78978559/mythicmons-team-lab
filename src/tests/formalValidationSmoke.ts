import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {sha256 as canonicalSha} from "../showdown/evidenceEpoch";
import {evaluateFormalValidation, exactOneSidedBinomial, formalMechanismKey, hasExactFormalValidationIntegrity, isValidFormalMaxTurnAdjudication, type FormalValidationCaseResult} from "../ai/formalValidation";
import {loadFormalValidationPortfolio, verifyFormalValidationPortfolio} from "../ai/formalValidationPortfolio";

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
assert.equal(isValidFormalMaxTurnAdjudication({timeout: true, winner: null, adjudication: {rule: "remaining-pokemon-then-hp", reason: "exact-tie"}}), true);
assert.equal(isValidFormalMaxTurnAdjudication({timeout: true, winner: null, adjudication: {rule: "remaining-pokemon-then-hp", reason: "missing-score"}}), false);
assert.equal(
  formalMechanismKey({target: "switch", effect: -0.1, predicates: [{feature: "hpLate", operator: "lt"}, {feature: "positionValue", operator: "gte"}]}),
  formalMechanismKey({target: "switch", effect: -0.2, predicates: [{feature: "positionValue", operator: "gte"}, {feature: "hpLate", operator: "lt"}]}),
);
assert.notEqual(
  formalMechanismKey({target: "switch", effect: -0.1, predicates: [{feature: "positionValue", operator: "gte"}]}),
  formalMechanismKey({target: "switch", effect: -0.1, predicates: [{feature: "positionValue", operator: "lt"}]}),
);
const portfolioRoot = fs.mkdtempSync(path.join(os.tmpdir(), "formal-portfolio-"));
try {
  const mechanismKey = formalMechanismKey({target: "switch", effect: -.1, predicates: [{feature: "positionValue", operator: "lt"}]});
  writeGeneration(path.join(portfolioRoot, "archive", "generation-001"), "rejected", mechanismKey, 12, 3, 7, 2);
  writeGeneration(portfolioRoot, "inconclusive", mechanismKey, 12, 4, 3, 5);
  const portfolio = loadFormalValidationPortfolio(portfolioRoot); verifyFormalValidationPortfolio(portfolio);
  assert.equal(portfolio.metrics.generations, 2); assert.equal(portfolio.metrics.sourceBattles, 24); assert.equal(portfolio.feedback[mechanismKey]?.disposition, "rejected"); assert.equal(portfolio.feedback[mechanismKey]?.cases, 24);
} finally { fs.rmSync(portfolioRoot, {recursive: true, force: true}); }
console.log("Formal validation smoke passed: cross-environment coverage, exact sign test, Holm correction, and integrity blocking");

function writeGeneration(directory: string, disposition: "rejected" | "inconclusive", mechanismKey: string, cases: number, supports: number, contradictions: number, neutral: number): void {
  fs.mkdirSync(directory, {recursive: true}); const domainId = `battle-${mechanismKey}`;
  const freezeCore = {schemaVersion: 1, domains: [{id: domainId, mechanismKey}]}, freeze = {...freezeCore, sha256: canonicalSha(freezeCore)};
  const summaryCore = {schemaVersion: 1, freezeSha256: freeze.sha256, sources: {battles: 12}, experiments: {completed: 12}, domains: [{domainId, disposition, cases, supports, contradictions, neutral, reasons: disposition === "rejected" ? ["contradicted"] : ["too few decisive cases"]}]}, summary = {...summaryCore, sha256: canonicalSha(summaryCore)};
  fs.writeFileSync(path.join(directory, "freeze.json"), `${JSON.stringify(freeze)}\n`); fs.writeFileSync(path.join(directory, "summary.json"), `${JSON.stringify(summary)}\n`);
}
