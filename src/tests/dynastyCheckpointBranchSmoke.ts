import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildDynastyCheckpointBranchManifest, loadDynastyCheckpointBranchManifest, materializeDynastyCheckpointBranch, verifyDynastyCheckpointBranch} from "../draft/dynastyCheckpointBranch";
import {persistDynastyState} from "../draft/dynastyStateStore";

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-checkpoint-branch-"));
try {
  const source = path.join(workspace, "source"), branch = path.join(workspace, "branch"), stateFile = path.join(source, "dynasty-state.json");
  fs.mkdirSync(path.join(source, "season-01"), {recursive: true});
  fs.mkdirSync(path.join(source, "config-snapshots", "registry"), {recursive: true});
  fs.writeFileSync(path.join(source, "season-01", "season.json"), "{\"season\":1}\n", "utf8");
  fs.writeFileSync(path.join(source, "season-01", "evolution.json"), "{\"season\":1,\"mode\":\"punctuated\"}\n", "utf8");
  fs.writeFileSync(path.join(source, "config-snapshots", "registry", "registry-manifest.json"), "{\"hash\":\"registry\"}\n", "utf8");
  fs.writeFileSync(path.join(source, "notes.json"), "{\"mutable\":true}\n", "utf8");
  persistDynastyState(stateFile, {version: 12, seed: "checkpoint-smoke", completedSeason: 1, managers: [{id: "m1"}], decisionRecords: [{id: "d1", value: "x".repeat(10_000)}], evolutionArchive: [{id: "e1"}]});

  const expected = buildDynastyCheckpointBranchManifest(source);
  const actual = materializeDynastyCheckpointBranch(source, branch);
  assert.equal(actual.checkpointId, expected.checkpointId);
  assert.equal(actual.completedSeason, 1);
  assert(actual.immutablePrefix.some(entry => entry.file === "season-01/season.json"));
  assert(actual.immutablePrefix.some(entry => entry.file.startsWith(".dynasty-state/decision-records.")));
  assert.equal(fs.existsSync(path.join(branch, "notes.json")), false, "unneeded source bulk must not enter a continuation branch");
  assert.equal(loadDynastyCheckpointBranchManifest(branch).checkpointId, actual.checkpointId);
  verifyDynastyCheckpointBranch(branch, actual, true);

  fs.writeFileSync(path.join(branch, "dynasty-state.json"), "{\"advanced\":true}\n", "utf8");
  verifyDynastyCheckpointBranch(branch, actual);
  assert.notEqual(fs.readFileSync(path.join(source, "dynasty-state.json"), "utf8"), fs.readFileSync(path.join(branch, "dynasty-state.json"), "utf8"));

  const branchSeason = path.join(branch, "season-01", "season.json"), sourceSeason = path.join(source, "season-01", "season.json"), sourceSeasonBytes = fs.readFileSync(sourceSeason);
  fs.writeFileSync(branchSeason, "tampered\n", "utf8");
  assert.deepEqual(fs.readFileSync(sourceSeason), sourceSeasonBytes, "branch prefix writes must not mutate the source checkpoint");
  assert.throws(() => verifyDynastyCheckpointBranch(branch, actual), /checkpoint prefix hash mismatch/);

  const forged = structuredClone(actual);
  forged.completedSeason = 2;
  assert.throws(() => verifyDynastyCheckpointBranch(source, forged), /manifest identity mismatch/);
  assert.throws(() => materializeDynastyCheckpointBranch(source, path.join(source, "nested")), /separate from its source/);
  console.log("Dynasty checkpoint branch smoke passed");
} finally {
  fs.rmSync(workspace, {recursive: true, force: true});
}
