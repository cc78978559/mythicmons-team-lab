import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {spawnSync} from "node:child_process";
import {buildManagerResearchAgenda, createManagerResearchPolicy, type ResearchHypothesisOption} from "../ai/managerResearchAgenda";
import {createManagerMechanismLedger} from "../ai/managerMechanismLedger";

const root = process.cwd(), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-research-review-"));
try {
  const out = path.join(temporary, "agendas"), study = path.join(temporary, "study"); fs.mkdirSync(out, {recursive: true}); fs.mkdirSync(study, {recursive: true});
  const policy = createManagerResearchPolicy("manager-01"), hypothesis: ResearchHypothesisOption = {id: "test-mechanism-v1", title: "Test mechanism", observationalCandidate: true, causalConclusion: null}, agenda = buildManagerResearchAgenda("manager-01", createManagerMechanismLedger("manager-01"), [hypothesis], 1, policy);
  const policyBytes = zlib.gzipSync(Buffer.from(JSON.stringify([policy]))), agendaBytes = zlib.gzipSync(Buffer.from(JSON.stringify([agenda]))); fs.writeFileSync(path.join(out, "research-policies.json.gz"), policyBytes); fs.writeFileSync(path.join(out, "research-agendas-round-01.json.gz"), agendaBytes);
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({schemaVersion: 1, round: 1, inputs: {researchPolicies: {sha256: sha(policyBytes)}}, archive: {file: "research-agendas-round-01.json.gz", sha256: sha(agendaBytes), bytes: agendaBytes.length}}));
  fs.writeFileSync(path.join(study, "causal-summary.json"), JSON.stringify({hypothesisId: hypothesis.id})); fs.writeFileSync(path.join(study, "causal-manifest.json"), JSON.stringify({items: [{id: "choice-01", status: "complete", managerId: "manager-01", result: {direction: "better", causal: {games: 2, actionDivergences: 2, outcomeChanges: 2}}}]}));
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "managerResearchAgendas.ts"), "review", "--out", out, "--studies", study], {cwd: root, encoding: "utf8"}); assert.equal(result.status, 0, result.stderr || result.stdout);
  const reviewed = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(out, "research-policies.json.gz"))).toString("utf8")); assert.equal(reviewed[0].completedRounds, 1); assert.equal(reviewed[0].modeEvidence["new-causal-test"].attempts, 1); assert.ok(reviewed[0].exploration > .5);
  const report = JSON.parse(fs.readFileSync(path.join(out, "review-round-01.json"), "utf8")); assert.equal(report.executed, 1); assert.equal(report.informationReward.mean, 1); assert.equal(report.exploration.unique, 1); assert.ok(report.detailArchive.file.endsWith("details.json.gz"));
  const details = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(out, report.detailArchive.file))).toString("utf8")); assert.equal(details[0].preferenceRank, 0); assert.equal(details[0].executedMechanismId, hypothesis.id);
  const duplicateOut = path.join(temporary, "duplicate-agendas"), importRegistry = path.join(temporary, "import-registry.json"); fs.mkdirSync(duplicateOut); fs.writeFileSync(path.join(duplicateOut, "research-policies.json.gz"), policyBytes); fs.writeFileSync(path.join(duplicateOut, "research-agendas-round-01.json.gz"), agendaBytes); fs.writeFileSync(path.join(duplicateOut, "manifest.json"), JSON.stringify({schemaVersion: 1, round: 1, inputs: {researchPolicies: {sha256: sha(policyBytes)}}, archive: {file: "research-agendas-round-01.json.gz", sha256: sha(agendaBytes), bytes: agendaBytes.length}})); fs.writeFileSync(importRegistry, JSON.stringify({imports: {[`${hypothesis.id}:choice-01`]: {study: "older/study"}}}));
  const duplicateResult = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "managerResearchAgendas.ts"), "review", "--out", duplicateOut, "--studies", study, "--import-registry", importRegistry], {cwd: root, encoding: "utf8"}); assert.equal(duplicateResult.status, 0, duplicateResult.stderr || duplicateResult.stdout); const duplicateReport = JSON.parse(fs.readFileSync(path.join(duplicateOut, "review-round-01.json"), "utf8")); assert.equal(duplicateReport.executed, 0); assert.equal(duplicateReport.duplicateOutcomesRejected, 1);
  console.log("Manager research review CLI smoke passed: protocol hash, outcome ingestion, policy evolution, and next-round snapshot");
} finally { fs.rmSync(temporary, {recursive: true, force: true}); }
function sha(value: Buffer): string { return crypto.createHash("sha256").update(value).digest("hex"); }
