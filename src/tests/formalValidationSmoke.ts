import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {sha256 as canonicalSha} from "../showdown/evidenceEpoch";
import {evaluateFormalValidation, exactOneSidedBinomial, formalMechanismKey, formalMechanismSemanticKey, hasExactFormalValidationIntegrity, isValidFormalMaxTurnAdjudication, type FormalValidationCaseResult} from "../ai/formalValidation";
import {loadFormalValidationPortfolio, verifyFormalValidationPortfolio} from "../ai/formalValidationPortfolio";

const result = (id: string, domainId: string, environment: string, direction: "better" | "neutral" | "worse"): FormalValidationCaseResult => ({id, domainId, managerId: "manager-01", ruleId: "rule-1", environment, clusterId: `${environment}:${id}`, phase: "mid", direction, expectedDirection: "better", trajectoryChanged: direction !== "neutral", winnerChanged: direction !== "neutral", sourceVerified: true, prefixVerified: true, interventionVerified: true});
const gate = {targetCases: 12, minimumCasesPerEnvironment: 6, targetClusters: 12, minimumClustersPerEnvironment: 6, maximumCasesPerCluster: 1, minimumDecisiveCases: 4, familywiseAlpha: .1};
const strong = Array.from({length: 12}, (_, index) => result(`s${index}`, "switch", index < 6 ? "balanced" : "pressure", index < 10 ? "better" : "neutral"));
const weak = Array.from({length: 12}, (_, index) => result(`w${index}`, "status", index < 6 ? "balanced" : "pressure", index % 3 === 0 ? "better" : index % 3 === 1 ? "worse" : "neutral"));
const rows = evaluateFormalValidation(["switch", "status"], [...strong, ...weak], ["balanced", "pressure"], gate);
assert.equal(rows.find(row => row.domainId === "switch")?.disposition, "limited-canary-eligible");
assert.equal(rows.find(row => row.domainId === "status")?.disposition, "rejected");
assert.equal(exactOneSidedBinomial(4, 4), .0625);
const broken = strong.map((row, index) => index ? row : {...row, prefixVerified: false});
assert.equal(hasExactFormalValidationIntegrity(broken[0]), false); assert.equal(hasExactFormalValidationIntegrity(strong[0]), true);
assert.equal(evaluateFormalValidation(["switch"], broken, ["balanced", "pressure"], gate)[0].disposition, "blocked");
const duplicated = strong.map(row => ({...row, clusterId: `${row.environment}:pair-1`}));
assert.equal(evaluateFormalValidation(["switch"], duplicated, ["balanced", "pressure"], {...gate, targetClusters: 2, minimumClustersPerEnvironment: 1, maximumCasesPerCluster: 3})[0].disposition, "blocked", "Over-budget matchup clusters must block formal evidence");
const trajectoryOnly = strong.map(row => ({...row, winnerChanged: false}));
assert.equal(evaluateFormalValidation(["switch"], trajectoryOnly, ["balanced", "pressure"], gate)[0].disposition, "inconclusive", "Turn-count drift must not become formal outcome evidence");
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
assert.notEqual(
  formalMechanismSemanticKey({target: "switch", effect: -.1, predicates: [{feature: "positionValue", operator: "lt", threshold: 0}]}),
  formalMechanismSemanticKey({target: "switch", effect: -.1, predicates: [{feature: "positionValue", operator: "lt", threshold: -.2}]}),
  "A materially revised boundary must receive a new semantic identity",
);
const portfolioRoot = fs.mkdtempSync(path.join(os.tmpdir(), "formal-portfolio-"));
try {
  const mechanismKey = formalMechanismKey({target: "switch", effect: -.1, predicates: [{feature: "positionValue", operator: "lt"}]});
  writeGeneration(path.join(portfolioRoot, "archive", "generation-z-old"), "rejected", mechanismKey, 12, 3, 7, 2, "2026-01-01T00:00:00.000Z");
  writeGeneration(path.join(portfolioRoot, "archive", "generation-a-new"), "limited-canary-eligible", mechanismKey, 12, 9, 1, 2, "2026-02-01T00:00:00.000Z");
  writeGeneration(path.join(portfolioRoot, "archive", "generation-failed"), "rejected", mechanismKey, 12, 0, 2, 10, "2026-02-15T00:00:00.000Z", false);
  writeGeneration(portfolioRoot, "inconclusive", mechanismKey, 12, 4, 3, 5);
  const portfolio = loadFormalValidationPortfolio(portfolioRoot); verifyFormalValidationPortfolio(portfolio);
  assert.equal(portfolio.metrics.generations, 3); assert.equal(portfolio.metrics.retainedGenerations, 4); assert.equal(portfolio.metrics.failedGenerations, 1); assert.equal(portfolio.metrics.sourceBattles, 36); assert.equal(portfolio.metrics.retainedSourceBattles, 48); assert.equal(portfolio.feedback[mechanismKey]?.disposition, "limited-canary-eligible"); assert.equal(portfolio.feedback[mechanismKey]?.cases, 36);
  const damaged = path.join(portfolioRoot, "archive", "generation-damaged"); fs.mkdirSync(damaged); fs.writeFileSync(path.join(damaged, "archive-manifest.json"), `${JSON.stringify({schemaVersion: 1, state: "complete", archivedAt: "2026-03-01T00:00:00.000Z", planned: ["freeze.json", "summary.json"], moved: ["freeze.json"]})}\n`); assert.throws(() => loadFormalValidationPortfolio(portfolioRoot), /Invalid formal-validation archive manifest/);
} finally { fs.rmSync(portfolioRoot, {recursive: true, force: true}); }
console.log("Formal validation smoke passed: cross-environment coverage, exact sign test, Holm correction, and integrity blocking");

function writeGeneration(directory: string, disposition: "limited-canary-eligible" | "rejected" | "inconclusive", mechanismKey: string, cases: number, supports: number, contradictions: number, neutral: number, archivedAt?: string, completed = true): void {
  fs.mkdirSync(directory, {recursive: true}); const domainId = `battle-${mechanismKey}`;
  const freezeCore = {schemaVersion: 1, domains: [{id: domainId, mechanismKey}]}, freeze = {...freezeCore, sha256: canonicalSha(freezeCore)};
  const summaryCore = {schemaVersion: 1, freezeSha256: freeze.sha256, formalValidationCompleted: completed, audit: {healthy: completed, issues: completed ? [] : [{severity: "error", code: "technical-failures"}]}, sources: {battles: 12}, experiments: {completed: 12}, domains: [{domainId, disposition, cases, supports, contradictions, neutral, reasons: disposition === "rejected" ? ["contradicted"] : ["too few decisive cases"]}]}, summary = {...summaryCore, sha256: canonicalSha(summaryCore)};
  fs.writeFileSync(path.join(directory, "freeze.json"), `${JSON.stringify(freeze)}\n`); fs.writeFileSync(path.join(directory, "summary.json"), `${JSON.stringify(summary)}\n`);
  if (archivedAt) fs.writeFileSync(path.join(directory, "archive-manifest.json"), `${JSON.stringify({schemaVersion: 1, state: "complete", archivedAt, planned: ["freeze.json", "summary.json"], moved: ["freeze.json", "summary.json"]})}\n`);
}
