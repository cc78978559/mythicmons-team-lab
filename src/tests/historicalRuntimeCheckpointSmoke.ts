import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {materializeHistoricalReplayCheckpoint, resolveHistoricalReplayCheckpoint, verifyHistoricalDynastyCheckpoint} from "../draft/historicalRuntimeCheckpoint";
import {auditV12Output} from "../draft/v12Audit";

const project = process.cwd(), workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-historical-runtime-")), source = path.join(workspace, "source"), replayRoot = path.join(workspace, "replay");
const common = {V12_SEED: "historical-runtime-smoke", V12_MANAGER_LIMIT: "6", V12_PAIRS: "1", V12_POOL_SIZE: "100", V12_AUCTION_LOTS: "10", V12_REGULAR_ROUNDS: "1", V12_MAX_TURNS: "20", V12_MIN_ROSTER: "6", V12_MAX_ROSTER: "6", V12_EVOLUTION_MODE: "punctuated", V12_EVOLUTION_POLICY: "shadow", V12_EVIDENCE_RETENTION: "compact", V12_EVIDENCE_SAMPLE_RATE: "0"};
try {
  run(path.join(project, "src", "cli", "draftLeagueV12.ts"), project, {...common, V12_OUT: source, V12_SEASONS: "1", V12_RESUME: "false"});
  const before = verifyHistoricalDynastyCheckpoint(source, 0), after = verifyHistoricalDynastyCheckpoint(source, 1);
  assert.equal(before.completedSeason, 0); assert.equal(after.completedSeason, 1);
  assert.equal(before.runtime.runtimeId, after.runtime.runtimeId, "one code version must be stored once");
  assert.equal(fs.readdirSync(path.join(source, ".runtime-bundles")).length, 1);
  const resolved = resolveHistoricalReplayCheckpoint(source, 1), materialized = materializeHistoricalReplayCheckpoint(source, 1, replayRoot);
  assert.equal(resolved.runtimeId, materialized.runtimeId);
  assert.equal(read<any>(path.join(replayRoot, "dynasty-state.json")).completedSeason, 0);
  assert(fs.existsSync(path.join(materialized.registrySource, "registry-manifest.json")));

  const final = read<any>(path.join(source, "dynasty-state.json")), settings = final.settings;
  run(path.join(materialized.runtimeWorkspace, "src", "cli", "draftLeagueV12.ts"), materialized.runtimeWorkspace, {...common, NODE_PATH: materialized.nodePath, V12_OUT: replayRoot, V12_SEASONS: "1", V12_RESUME: "true", V12_REGISTRY_SOURCE: materialized.registrySource, V12_REGISTRY_REVISION: final.registry.revision, V12_AUCTION_MODE: String(settings.auctionMode ?? "sequential")});
  assert.deepEqual(essential(read(path.join(replayRoot, "season-01", "season.json"))), essential(read(path.join(source, "season-01", "season.json"))), "historical runtime replay must reproduce its source season");

  const archive = path.join(source, ".season-checkpoints", "season-00", before.state.archive), original = fs.readFileSync(archive);
  fs.writeFileSync(archive, Buffer.concat([original, Buffer.from("tamper")]));
  assert.throws(() => verifyHistoricalDynastyCheckpoint(source, 0), /archive hash mismatch/);
  assert(auditV12Output(source).issues.some(issue => issue.code === "invalid-historical-checkpoint" && issue.severity === "fatal"));
  console.log("Historical runtime checkpoint and exact replay smoke passed");
} finally { fs.rmSync(workspace, {recursive: true, force: true}); }

function run(script: string, cwd: string, env: Record<string, string>): void { const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), script], {cwd, env: {...process.env, ...env}, encoding: "utf8", maxBuffer: 64 * 1024 * 1024}); assert.equal(result.status, 0, result.stderr || result.stdout); }
function read<T = any>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function essential(value: any): any { return {season: value.season, champion: value.champion, standings: value.standings, transactions: value.transactions, validity: value.validity}; }
