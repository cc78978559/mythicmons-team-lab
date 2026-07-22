import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {hasHistoricalReplayPlan, materializeHistoricalReplayCheckpoint, planHistoricalReplaySegments, verifyHistoricalDynastyCheckpoint} from "../draft/historicalRuntimeCheckpoint";
import {auditV12Output} from "../draft/v12Audit";

const project = process.cwd(), workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-historical-runtime-")), runtimeProject = path.join(workspace, "project"), source = path.join(workspace, "source"), replayRoot = path.join(workspace, "replay");
const common = {NODE_PATH: path.join(project, "node_modules"), V12_REGISTRY_SOURCE: path.join(project, "data", "draft"), V12_SEED: "historical-runtime-smoke", V12_MANAGER_LIMIT: "6", V12_PAIRS: "1", V12_POOL_SIZE: "100", V12_AUCTION_LOTS: "10", V12_REGULAR_ROUNDS: "1", V12_MAX_TURNS: "20", V12_MIN_ROSTER: "6", V12_MAX_ROSTER: "6", V12_EVOLUTION_MODE: "punctuated", V12_EVOLUTION_POLICY: "shadow", V12_EVIDENCE_RETENTION: "compact", V12_EVIDENCE_SAMPLE_RATE: "0"};
try {
  copyRuntimeProject();
  const runtimeScript = path.join(runtimeProject, "src", "cli", "draftLeagueV12.ts");
  run(runtimeScript, runtimeProject, {...common, V12_OUT: source, V12_SEASONS: "1", V12_RESUME: "false"});
  const seasonZero = verifyHistoricalDynastyCheckpoint(source, 0), firstBoundary = verifyHistoricalDynastyCheckpoint(source, 1);
  assert.equal(seasonZero.runtime.runtimeId, firstBoundary.runtime.runtimeId, "one code version must be stored once");

  fs.appendFileSync(path.join(runtimeProject, "src", "cli", "draftLeagueV4.ts"), "\n// historical runtime smoke upgrade\n", "utf8");
  run(runtimeScript, runtimeProject, {...common, V12_OUT: source, V12_SEASONS: "2", V12_RESUME: "true", V12_ALLOW_CODE_UPGRADE: "true"});
  const preservedFirstBoundary = verifyHistoricalDynastyCheckpoint(source, 1), finalBoundary = verifyHistoricalDynastyCheckpoint(source, 2);
  assert.equal(seasonZero.runtime.runtimeId, preservedFirstBoundary.runtime.runtimeId, "the completed first season must retain its original runtime");
  assert.notEqual(preservedFirstBoundary.runtime.runtimeId, finalBoundary.runtime.runtimeId, "the upgraded second season must record a new runtime");
  assert.equal(fs.readdirSync(path.join(source, ".runtime-bundles")).length, 2);

  const segments = planHistoricalReplaySegments(source, 1, 2);
  assert.equal(hasHistoricalReplayPlan(source, 1, 2), true);
  assert.deepEqual(segments.map(segment => [segment.firstSeason, segment.lastSeason]), [[1, 1], [2, 2]]);
  assert.notEqual(segments[0].runtimeId, segments[1].runtimeId);
  const secondCheckpoint = path.join(source, ".season-checkpoints", "season-02", "checkpoint.json"), hiddenSecondCheckpoint = `${secondCheckpoint}.missing`;
  fs.renameSync(secondCheckpoint, hiddenSecondCheckpoint); assert.equal(hasHistoricalReplayPlan(source, 1, 2), false, "the complete follow-up horizon must be available"); fs.renameSync(hiddenSecondCheckpoint, secondCheckpoint);
  const materialized = materializeHistoricalReplayCheckpoint(source, 1, replayRoot);
  assert.equal(materialized.runtimeId, seasonZero.runtime.runtimeId, "season one must use its recorded runtime");
  assert.equal(read<any>(path.join(replayRoot, "dynasty-state.json")).completedSeason, 0);
  assert(fs.existsSync(path.join(materialized.registrySource, "registry-manifest.json")));

  const final = read<any>(path.join(source, "dynasty-state.json")), settings = final.settings;
  for (const segment of segments) run(path.join(segment.runtimeWorkspace, "src", "cli", "draftLeagueV12.ts"), segment.runtimeWorkspace, {...common, NODE_PATH: segment.nodePath, V12_OUT: replayRoot, V12_SEASONS: String(segment.lastSeason), V12_RESUME: "true", V12_ALLOW_CODE_UPGRADE: "true", V12_REGISTRY_SOURCE: materialized.registrySource, V12_REGISTRY_REVISION: final.registry.revision, V12_AUCTION_MODE: String(settings.auctionMode ?? "sequential")});
  for (const season of [1, 2]) assert.deepEqual(essential(read(path.join(replayRoot, `season-${String(season).padStart(2, "0")}`, "season.json"))), essential(read(path.join(source, `season-${String(season).padStart(2, "0")}`, "season.json"))), `segmented historical replay must reproduce source season ${season}`);

  const archive = path.join(source, ".season-checkpoints", "season-00", seasonZero.state.archive), original = fs.readFileSync(archive);
  fs.writeFileSync(archive, Buffer.concat([original, Buffer.from("tamper")]));
  assert.throws(() => verifyHistoricalDynastyCheckpoint(source, 0), /archive hash mismatch/);
  assert(auditV12Output(source).issues.some(issue => issue.code === "invalid-historical-checkpoint" && issue.severity === "fatal"));
  console.log("Segmented historical runtime checkpoint and exact replay smoke passed");
} finally { fs.rmSync(workspace, {recursive: true, force: true}); }

function copyRuntimeProject(): void {
  fs.mkdirSync(runtimeProject, {recursive: true});
  for (const directory of ["src", path.join("benchmarks", "gen9expanded")]) fs.cpSync(path.join(project, directory), path.join(runtimeProject, directory), {recursive: true});
  for (const file of ["package.json", "package-lock.json", "tsconfig.json"]) fs.copyFileSync(path.join(project, file), path.join(runtimeProject, file));
  fs.symlinkSync(path.join(project, "node_modules"), path.join(runtimeProject, "node_modules"), "junction");
}
function run(script: string, cwd: string, env: Record<string, string>): void { const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), script], {cwd, env: {...process.env, ...env}, encoding: "utf8", maxBuffer: 64 * 1024 * 1024}); assert.equal(result.status, 0, result.stderr || result.stdout); }
function read<T = any>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function essential(value: any): any { return {season: value.season, champion: value.champion, standings: value.standings, transactions: value.transactions, validity: value.validity}; }
