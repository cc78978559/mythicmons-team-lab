import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const root = process.cwd();
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-punctuated-cf-"));
const source = path.join(workspace, "source");
const output = path.join(workspace, "counterfactual");

try {
  const baseline = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV12.ts")], {
    cwd: root,
    env: {...process.env, V12_OUT: source, V12_SEASONS: "2", V12_MANAGER_LIMIT: "6", V12_PAIRS: "1", V12_POOL_SIZE: "100", V12_AUCTION_LOTS: "10", V12_REGULAR_ROUNDS: "1", V12_MAX_TURNS: "20", V12_MIN_ROSTER: "6", V12_MAX_ROSTER: "6", V12_SEED: "punctuated-counterfactual-smoke", V12_EVOLUTION_MODE: "punctuated", V12_EVOLUTION_POLICY: "active", V12_EVOLUTION_SHOCK: "1", V12_EVIDENCE_RETENTION: "compact", V12_EVIDENCE_SAMPLE_RATE: "0"},
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(baseline.status, 0, baseline.stderr || baseline.stdout);
  const sourceState = read<any>(path.join(source, "dynasty-state.json"));
  assert(sourceState.managers.some((manager: any) => manager.pendingLineage?.birthSeason === 3));

  const counterfactual = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "counterfactualPunctuatedEvolution.ts"), "--source", source, "--out", output], {cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
  assert.equal(counterfactual.status, 0, counterfactual.stderr || counterfactual.stdout);
  const summary = read<any>(path.join(output, "counterfactual-summary.json"));
  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.prefixVerifiedThroughSeason, 2);
  assert.equal(summary.isolatedDifferenceVerified, true);
  assert.notEqual(summary.comparison.experiment.lineageId, summary.comparison.control.lineageId);
  assert.equal(typeof summary.comparison.delta.points, "number");
  assert.equal(typeof summary.comparison.delta.rankImprovement, "number");
  const control = read<any>(path.join(output, "control", "dynasty-state.json"));
  assert.equal(control.decisionRecords.filter((record: any) => record.decision?.includes("隔离反事实抑制新生谱系")).length, 1);
  console.log("Punctuated evolution isolated counterfactual smoke passed");
} finally {
  fs.rmSync(workspace, {recursive: true, force: true});
}

function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
