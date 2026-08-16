import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {buildJointBattleShadowSource, type JointBattleShadowSourceCandidateLabel, type JointBattleShadowSourceEntry} from "../ai/jointBattleShadowCorpus";
import {buildJointBattleDecisionSnapshot, JOINT_BATTLE_FEATURES, jointBattleKnownMask, recommendJointBattleShadow, type JointBattleCandidateV1, type JointBattleDecisionSnapshotV1} from "../ai/relationalBattlePolicy";
import {buildUnifiedDecisionRecord, type UnifiedDecisionRecord} from "../draft/unifiedDecisionRecord";

const token = "build-relational-battle-policy-v1-shadow-corpus", root = fs.mkdtempSync(path.join(os.tmpdir(), "joint-shadow-corpus-")), sourceFile = path.join(root, "source.json"), out = path.join(root, "corpus"), missingOut = path.join(root, "missing");
try {
  const closed = entry("closed", "closed-sheet", "train"), open = entry("open", "open-sheet", "validation"), source = buildJointBattleShadowSource([closed, open], "synthetic-test");
  fs.writeFileSync(sourceFile, `${JSON.stringify(source, null, 2)}\n`, "utf8");
  assert.throws(() => buildJointBattleShadowSource([], "synthetic-test"), /empty/);
  assert.throws(() => buildJointBattleShadowSource([{...closed, labels: closed.labels.slice(0, 1)}], "synthetic-test"), /labels are incomplete/);
  assert.throws(() => buildJointBattleShadowSource([closed, {...open, familyId: closed.familyId}], "synthetic-test"), /family crossed information modes/);

  const beforeReadOnly = tree(root);
  const missingStatus = invoke("status", "--out", missingOut); assert.equal(missingStatus.status, 0); assert.equal(missingStatus.json.available, false); assert.equal(fs.existsSync(missingOut), false);
  const missingDoctor = invoke("doctor", "--out", missingOut); assert.equal(missingDoctor.status, 2); assert.equal(fs.existsSync(missingOut), false);
  const inspected = invoke("inspect", "--input", sourceFile); assert.equal(inspected.status, 0); assert.equal(inspected.json.records, 2); assert.deepEqual(inspected.json.informationModes, {openSheet: 1, closedSheet: 1});
  assert.deepEqual(tree(root), beforeReadOnly, "read-only commands changed the fixture tree");

  const noToken = invoke("build", "--input", sourceFile, "--out", out, "--authority", "synthetic-test"); assert.equal(noToken.status, 2); assert.equal(fs.existsSync(out), false);
  const relative = invoke("build", "--input", "relative.json", "--out", out, "--authority", "synthetic-test", "--execute-token", token); assert.equal(relative.status, 2); assert.equal(fs.existsSync(out), false);
  const wrongAuthority = invoke("build", "--input", sourceFile, "--out", out, "--authority", "signed-research-family-corpus", "--execute-token", token); assert.equal(wrongAuthority.status, 2); assert.equal(fs.existsSync(out), false);

  fs.mkdirSync(out); fs.writeFileSync(path.join(out, ".joint-shadow-corpus.lock"), `${JSON.stringify({schemaVersion: 1, pid: 2147483647})}\n`); fs.writeFileSync(path.join(out, "joint-battle-shadow-corpus.json.orphan.tmp"), "orphan");
  const built = invoke("build", "--input", sourceFile, "--out", out, "--authority", "synthetic-test", "--execute-token", token); assert.equal(built.status, 0, built.stderr); assert.equal(built.json.status, "complete"); assert.equal(built.json.recoveredTemporaryFiles, 1); assert.equal(built.json.formalActivationAllowed, false); assert.equal(built.json.routingAllowed, false);
  assert.equal(fs.existsSync(path.join(out, ".joint-shadow-corpus.lock")), false); assert.equal(fs.readdirSync(out).some(name => name.endsWith(".tmp")), false);
  const cached = invoke("build", "--input", sourceFile, "--out", out, "--authority", "synthetic-test", "--execute-token", token); assert.equal(cached.status, 0); assert.equal(cached.json.status, "cached");

  const beforeChecks = tree(root), status = invoke("status", "--out", out), doctor = invoke("doctor", "--out", out), inspectAgain = invoke("inspect", "--input", sourceFile);
  assert.equal(status.status, 0); assert.equal(doctor.status, 0); assert.equal(inspectAgain.status, 0); assert.deepEqual(tree(root), beforeChecks, "status/doctor/inspect wrote after corpus creation");
  const archiveFile = path.join(out, "joint-battle-shadow-corpus.json"), archive = JSON.parse(fs.readFileSync(archiveFile, "utf8")); archive.routingAllowed = true; fs.writeFileSync(archiveFile, JSON.stringify(archive));
  assert.equal(invoke("doctor", "--out", out).status, 2, "tampered archive passed doctor");

  const tamperedSource = JSON.parse(fs.readFileSync(sourceFile, "utf8")); tamperedSource.entries[0].environment = "changed"; fs.writeFileSync(sourceFile, JSON.stringify(tamperedSource));
  const rejectedInspect = invoke("inspect", "--input", sourceFile); assert.equal(rejectedInspect.status, 2, "tampered source passed inspect");
  console.log("Joint battle shadow corpus CLI smoke passed: explicit execution, zero-write inspection, signed extraction, mode isolation, stale-lock recovery, atomic output, and tamper rejection");
} finally { fs.rmSync(root, {recursive: true, force: true}); }

function entry(id: string, informationMode: "open-sheet" | "closed-sheet", split: "train" | "validation"): JointBattleShadowSourceEntry { const snapshot = jointSnapshot(informationMode), recommendation = recommendJointBattleShadow(snapshot), record = decisionRecord(id, snapshot, recommendation); return {record, familyId: `${id}-family`, familyClusterId: `${id}-cluster`, environment: "synthetic-fixture", split, sourceFingerprint: hash([id, "source"]), labels: snapshot.candidates.map(candidate => label(id, candidate.id))}; }
function jointSnapshot(informationMode: "open-sheet" | "closed-sheet"): JointBattleDecisionSnapshotV1 { const candidates = [candidate("move tackle", "move"), candidate("switch 2", "switch")]; return buildJointBattleDecisionSnapshot({informationMode, turn: 4, playerId: "p1", nodes: candidates.map(value => ({id: `candidate:${value.id}`, kind: "candidate", publicLabel: value.id})), edges: [], candidates, legacyFallback: {candidateId: "move tackle", source: "legacy-search", mandatoryWhenAllCandidatesVetoed: true}, modeAuxiliary: {label: "fixture", confidence: .5, authority: "diagnostic-only", routingAllowed: false}}); }
function candidate(id: string, actionKind: "move" | "switch"): JointBattleCandidateV1 { const values = Object.fromEntries(JOINT_BATTLE_FEATURES.map(feature => [feature, 0])) as JointBattleCandidateV1["values"]; Object.assign(values, {shortValue: .5, longValue: .4, uncertainty: .2, terminalRisk: .1}); return {id, actionKind, target: id, legal: true, values, knownMask: jointBattleKnownMask(["shortValue", "longValue", "uncertainty", "terminalRisk"])}; }
function decisionRecord(id: string, snapshot: JointBattleDecisionSnapshotV1, recommendation: ReturnType<typeof recommendJointBattleShadow>): UnifiedDecisionRecord { const open = snapshot.informationMode === "open-sheet"; return buildUnifiedDecisionRecord({decisionId: `${id}:p1:1`, domain: "battle", actor: "p1", ordinal: 1, policy: {id: "legacy-search", version: "fixture"}, information: {mode: snapshot.informationMode, timing: "contemporaneous", activationEligible: true, sources: ["own-private-request", "public-battle-protocol", ...(open ? ["declared-open-team-sheet"] : [])]}, observation: {turn: 4}, options: snapshot.candidates.map(value => ({id: value.id, score: value.values.shortValue})), selected: snapshot.legacyFallback.candidateId, provenance: {jointRelationalSnapshot: snapshot, jointBattleShadow: recommendation}}); }
function label(id: string, candidateId: string): JointBattleShadowSourceCandidateLabel { return {candidateId, shortUtility: .4, terminalUtility: 1, uncertainty: .2, terminalRisk: .1, branchFingerprint: hash([id, candidateId])}; }
function hash(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function invoke(...args: string[]): {status: number | null; json: any; stderr: string} { const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(process.cwd(), "src", "cli", "jointBattleShadowCorpus.ts"), ...args], {cwd: process.cwd(), encoding: "utf8", maxBuffer: 8 * 1024 * 1024}), raw = result.status === 0 ? result.stdout : result.stderr; let json: any = {}; try { json = JSON.parse(raw); } catch {} return {status: result.status, json, stderr: result.stderr}; }
function tree(directory: string): Array<{file: string; size: number; mtimeMs: number; sha256: string}> { const rows: Array<{file: string; size: number; mtimeMs: number; sha256: string}> = []; const visit = (current: string) => { for (const entry of fs.readdirSync(current, {withFileTypes: true})) { const file = path.join(current, entry.name); if (entry.isDirectory()) visit(file); else { const stat = fs.statSync(file); rows.push({file: path.relative(directory, file), size: stat.size, mtimeMs: stat.mtimeMs, sha256: hash(fs.readFileSync(file).toString("base64"))}); } } }; visit(directory); return rows.sort((a, b) => a.file.localeCompare(b.file)); }
