import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const root = process.cwd(), workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-shadow-program-"));
const source = path.join(workspace, "source"), out = path.join(workspace, "counterfactual");
try {
  const league = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV12.ts")], {
    cwd: root,
    env: {...process.env, V12_OUT: source, V12_SEASONS: "2", V12_MANAGER_LIMIT: "6", V12_PAIRS: "1", V12_POOL_SIZE: "100", V12_AUCTION_LOTS: "10", V12_REGULAR_ROUNDS: "1", V12_MAX_TURNS: "20", V12_MIN_ROSTER: "6", V12_MAX_ROSTER: "6", V12_SEED: "program-semantic-probe", V12_EVOLUTION_MODE: "punctuated", V12_EVOLUTION_POLICY: "shadow", V12_EVOLUTION_SHOCK: "1", V12_EVIDENCE_RETENTION: "compact", V12_EVIDENCE_SAMPLE_RATE: "0"},
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(league.status, 0, league.stderr || league.stdout);
  const candidatePackage = read<any>(path.join(source, "season-02", "evolution-shadow-candidates.json"));
  assert.equal(candidatePackage.schemaVersion, 1);
  assert(candidatePackage.candidates.some((candidate: any) => candidate.programBehaviorDistance > 0 && candidate.programOpportunity?.distance > 0 && candidate.profile?.strategyProgram));

  const experiment = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "counterfactualShadowProgram.ts"), "--source", source, "--out", out], {cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
  assert.equal(experiment.status, 0, experiment.stderr || experiment.stdout);
  const summary = read<any>(path.join(out, "counterfactual-summary.json"));
  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.prefixVerified, true);
  assert.equal(summary.seed, "program-semantic-probe");
  assert.equal(summary.sourceVerified, true);
  assert(summary.isolatedDifference.behaviorDistance > 0);
  assert(summary.isolatedDifference.opportunityDistance > 0);
  assert(summary.isolatedDifference.choicePotential > 0);
  assert(summary.isolatedDifference.operatorMutations.some((mutation: string) => mutation.startsWith("program.")));
  assert(summary.decisionEffects.programSignalsCompared >= summary.decisionEffects.programSignalDifferences);
  assert(summary.decisionEffects.battleCompared > 0);
  assert.notEqual(summary.isolatedDifference.parentProgramHash, summary.isolatedDifference.candidateProgramHash);
  assert.equal(typeof summary.delta.points, "number");
  assert.equal(read<any>(path.join(out, "control", "dynasty-state.json")).managers.find((manager: any) => manager.id === summary.isolatedDifference.managerId).lineage.lineageId.startsWith("program-s"), false);
  assert.equal(read<any>(path.join(out, "experiment", "dynasty-state.json")).managers.find((manager: any) => manager.id === summary.isolatedDifference.managerId).lineage.lineageId.startsWith("program-s"), true);
  console.log("Shadow program candidate and isolated counterfactual smoke passed");
} finally {
  fs.rmSync(workspace, {recursive: true, force: true});
}

function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
