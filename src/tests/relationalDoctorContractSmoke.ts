import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {doctorRelationalTooling} from "../ai/relationalDoctor";
import {buildRelationalCounterfactualCorpus} from "../ai/relationalCounterfactual";
import {managerProgramV3Hash, noviceManagerProgramV3} from "../ai/managerProgramV3";
import {RELATIONAL_SWITCH_FEATURES, relationalKnownMask, type RelationalDecisionCandidateV1} from "../ai/relationalDecision";
import {buildRelationalResearchCycleHistory, buildRelationalStage4Submission, updateRelationalResearchGeneration, type RelationalExperimentV3} from "../ai/relationalValidation";

const started = Date.now(), rssBefore = process.memoryUsage().rss;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "relational-doctor-contract-"));
try {
  const healthyRoot = path.join(temporary, "healthy"), healthy = buildFixture(healthyRoot);
  const healthyResult = inspectReadOnly(healthyRoot);
  assert.equal(healthyResult.healthy, true, JSON.stringify(healthyResult.issues));
  assert.equal(healthyResult.activationReady, false);
  assert.equal(healthyResult.stages.stage2r.healthy, true);
  assert.equal(healthyResult.stages.stage3v3.healthy, true);
  assert.equal(healthyResult.stages.stage4v3.healthy, true);

  const missingRoot = path.join(temporary, "missing"); fs.mkdirSync(missingRoot);
  const missing = inspectReadOnly(missingRoot);
  assert.equal(missing.available, false); assert.equal(missing.activationReady, false);
  assert.ok(missing.issues.some(issue => issue.code === "stage2r-unavailable" && issue.severity === "warning"));

  const tamperedRoot = path.join(temporary, "tampered"); buildFixture(tamperedRoot);
  const summaryFile = path.join(tamperedRoot, "manager-program-v3", "summary.json"), summary = read<any>(summaryFile); summary.untouchedTest.eligibleManagers = 0; write(summaryFile, summary);
  const tampered = inspectReadOnly(tamperedRoot);
  assert.equal(tampered.healthy, false);
  assert.ok(tampered.issues.some(issue => issue.code === "stage3v3-unavailable" && issue.severity === "error"));

  const reusedRoot = path.join(temporary, "cross-stage-reuse"), reused = buildFixture(reusedRoot, true), stage4Root = path.join(reusedRoot, "relational-stage4");
  const stage4 = read<any>(path.join(stage4Root, "submissions.json")), sources = [...new Set<string>(reused.submission.experiments.map(value => value.sourceFingerprint))].sort(), clusters = [...new Set<string>(reused.submission.experiments.map(value => value.familyClusterId))].sort(), archiveFile = "cycles/reused.json";
  write(path.join(stage4Root, archiveFile), stage4);
  const cycleId = hash([stage4.sha256, sources, clusters, 1]), history = buildRelationalResearchCycleHistory([{id: cycleId, archiveFile, archiveSha256: stage4.sha256, sourceFingerprints: sources, familyClusterIds: clusters, programHashes: [reused.programHash], eligible: 1, completedAt: new Date(0).toISOString()}]);
  write(path.join(stage4Root, "cycle-history.json"), history); write(path.join(stage4Root, "generation-state.json"), updateRelationalResearchGeneration(null, "candidate", history.sha256));
  const crossStage = inspectReadOnly(reusedRoot);
  assert.equal(crossStage.healthy, false);
  assert.ok(crossStage.issues.some(issue => issue.code === "stage4-cycle-independence" && /training or prior-cycle/.test(issue.message)));

  const activationRoot = path.join(temporary, "automatic-activation"); buildFixture(activationRoot);
  write(path.join(activationRoot, "relational-canary", "result.json"), {schemaVersion: 2, automaticActivationAllowed: true});
  const automaticActivation = inspectReadOnly(activationRoot);
  assert.equal(automaticActivation.activationReady, false);
  assert.ok(automaticActivation.issues.some(issue => issue.code === "v3-canary-unavailable" && /cannot authorize automatic activation/.test(issue.message)));

  assert.equal(healthy.programHash, managerProgramV3Hash(healthy.program));
  console.log(`Relational doctor contract smoke passed: read-only healthy, missing, tamper, cross-stage reuse, and automatic-activation gates (${Date.now() - started}ms, RSS delta ${process.memoryUsage().rss - rssBefore} bytes)`);
} finally { fs.rmSync(temporary, {recursive: true, force: true}); }

function buildFixture(root: string, reuseTrainingCluster = false): ReturnType<typeof fixtureArtifacts> {
  const values = Object.fromEntries(RELATIONAL_SWITCH_FEATURES.map(feature => [feature, .5])) as Record<typeof RELATIONAL_SWITCH_FEATURES[number], number>;
  const candidate: RelationalDecisionCandidateV1 = {id: "switch 2", actionKind: "switch", target: "Fixture", values, knownMask: relationalKnownMask(RELATIONAL_SWITCH_FEATURES)};
  const rows = (["train", "validation", "test"] as const).map((split, index) => ({decisionId: `${split}-decision`, candidateId: candidate.id, familyId: `${split}-family`, clusterId: `${split}-cluster`, environment: index % 2 ? "combined" : "modern", split, candidate, relationValues: {}, incumbentSearchScore: 0, shortUtility: .25, terminalUtility: 1 as const, sourceFingerprint: hash(["source", split]), branchFingerprint: hash(["branch", split])}));
  const teacher = {modelSha256: "a".repeat(64), evaluationSha256: "b".repeat(64), authority: "qualified-stage2" as const, vsLegacyLogLossPercent: 4, bootstrapProbabilityBetterThanLegacy: .95}, corpus = buildRelationalCounterfactualCorpus(rows, teacher);
  writeGzip(path.join(root, "relational-counterfactual-v1", "corpus.columns.json.gz"), corpus);
  const program = noviceManagerProgramV3("manager-doctor", {encoderVersion: corpus.encoderVersion, corpusSignature: corpus.sha256, familySplitSignature: hash(corpus.columns.split)}), programHash = managerProgramV3Hash(program), trainingDataSignature = hash(corpus.columns);
  const programCore = {schemaVersion: 3, activationStatus: "shadow-only", corpusSha256: corpus.sha256, trainingDataSignature, programs: [program]}, programArchiveCoreSha256 = hash(programCore);
  const summaryCore = {trainingDataSignature, shortHorizonTeacher: teacher, programArchiveCoreSha256, promotions: [{managerId: program.managerId, hash: programHash, promotion: {eligible: true}}], untouchedTest: {eligibleManagers: 1}}, summary = {...summaryCore, sha256: hash(summaryCore)};
  write(path.join(root, "manager-program-v3", "summary.json"), summary); writeGzip(path.join(root, "manager-program-v3", "programs.json.gz"), {...programCore, summarySha256: summary.sha256, sha256: hash({...programCore, summarySha256: summary.sha256})});
  const experiments: RelationalExperimentV3[] = [];
  for (let index = 0; index < 4; index += 1) experiments.push(experiment("single-action", index, program, programHash, `single-${index}`));
  for (let index = 0; index < 12; index += 1) experiments.push(experiment("continuation-program", index, program, programHash, reuseTrainingCluster && index === 0 ? "train-cluster" : `continuation-${index}`));
  const submission = buildRelationalStage4Submission({program, ancestorSourceFingerprints: [], ancestorFamilyClusterIds: [], novel: true, supportingManagers: ["manager-a", "manager-b"], experiments}), stage4Core = {schemaVersion: 1, encoderVersion: corpus.encoderVersion, submissions: [submission]};
  write(path.join(root, "relational-stage4", "submissions.json"), {...stage4Core, sha256: hash(stage4Core)});
  return fixtureArtifacts(program, programHash, submission);
}

function experiment(level: RelationalExperimentV3["level"], index: number, program: ReturnType<typeof noviceManagerProgramV3>, programHash: string, cluster: string): RelationalExperimentV3 { return {id: `${level}-${index}`, level, managerId: program.managerId, programHash, sourceFingerprint: hash([level, index]), familyClusterId: cluster, environment: index % 2 ? "combined" : "modern", shortDelta: .1, terminalDelta: 0, applications: 1, evaluations: level === "single-action" ? 1 : 5, technicalFailure: null}; }
function fixtureArtifacts(program: ReturnType<typeof noviceManagerProgramV3>, programHash: string, submission: ReturnType<typeof buildRelationalStage4Submission>) { return {program, programHash, submission}; }
function inspectReadOnly(root: string) { const before = snapshot(root), result = doctorRelationalTooling(root, true); assert.deepEqual(snapshot(root), before, `doctor mutated ${root}`); return result; }
function snapshot(root: string): string[] { const rows: string[] = []; const visit = (directory: string) => { for (const entry of fs.readdirSync(directory, {withFileTypes: true})) { const file = path.join(directory, entry.name); if (entry.isDirectory()) visit(file); else { const stat = fs.statSync(file); rows.push(`${path.relative(root, file).replaceAll("\\", "/")}:${stat.size}:${stat.mtimeMs}:${fileHash(file)}`); } } }; visit(root); return rows.sort(); }
function write(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function writeGzip(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(value))); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function hash(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function fileHash(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
