import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {spawnSync} from "node:child_process";
import {verifyHistoricalDynastyCheckpoint} from "../draft/historicalRuntimeCheckpoint";

const root = process.cwd(), workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-official-cycle-"));
const league = path.join(workspace, "league"), development = path.join(workspace, "development"), history = path.join(workspace, "official-history.json");
const env = {...process.env, V12_OUT: league, V12_SEASONS: "1", V12_MANAGER_LIMIT: "6", V12_PAIRS: "1", V12_POOL_SIZE: "100", V12_AUCTION_LOTS: "10", V12_REGULAR_ROUNDS: "1", V12_MAX_TURNS: "20", V12_MIN_ROSTER: "6", V12_MAX_ROSTER: "6", V12_SEED: "official-cycle-smoke", V12_EVOLUTION_MODE: "punctuated", V12_EVOLUTION_POLICY: "shadow", V12_EVIDENCE_RETENTION: "compact", V12_EVIDENCE_SAMPLE_RATE: "0"};
try {
  const missingLeague = path.join(workspace, "missing-league"), missing = execute("src/cli/runOfficialSeasonCycle.ts", ["--major-source", missingLeague, "--development-out", development, "--preflight-only"]);
  assert.notEqual(missing.status, 0); assert.match(missing.stderr, /Formal dynasty state does not exist/); assert.equal(fs.existsSync(missingLeague), false);
  run("src/cli/draftLeagueV12.ts", [], env);
  run("src/cli/buildOfficialHistory.ts", ["--major-source", league, "--out", history]);
  run("src/cli/auditV12.ts", ["--out", league, "--force"]);
  const before = read<any>(path.join(league, "dynasty-state.json"));
  const bottom = before.managers.slice().sort((a: any, b: any) => b.seasons.at(-1).rank - a.seasons.at(-1).rank)[0].id;
  const preflightState = hash(fs.readFileSync(path.join(league, "dynasty-state.json"))), preflight = run("src/cli/runOfficialSeasonCycle.ts", ["--major-source", league, "--development-out", development, "--promotion-slots", "1", "--cycle-id", "preflight-smoke", "--history-ledger", history, "--min-free-gb", "0", "--max-development-output-mb", "1024", "--preflight-only"]), preflightResult = JSON.parse(preflight.stdout);
  assert.equal(preflightResult.ready, true); assert.equal(preflightResult.development.status, "absent"); assert.equal(preflightResult.history.status, "current"); assert.equal(hash(fs.readFileSync(path.join(league, "dynasty-state.json"))), preflightState); assert.equal(fs.existsSync(path.join(league, "season-cycles")), false);
  const blockedState = hash(fs.readFileSync(path.join(league, "dynasty-state.json"))), blocked = execute("src/cli/runOfficialSeasonCycle.ts", ["--major-source", league, "--development-out", development, "--promotion-slots", "1", "--cycle-id", "storage-blocked", "--min-free-gb", "10000", "--max-development-output-mb", "1024"]);
  assert.notEqual(blocked.status, 0); assert.match(blocked.stderr, /free disk .* below the required/); assert.equal(hash(fs.readFileSync(path.join(league, "dynasty-state.json"))), blockedState); assert.equal(fs.existsSync(path.join(league, "season-cycles", "storage-blocked.json")), false);
  const cycleArgs = ["--major-source", league, "--development-out", development, "--promotion-slots", "1", "--cycle-id", "cycle-smoke", "--history-ledger", history, "--min-free-gb", "0", "--max-development-output-mb", "1024"];
  run("src/cli/runOfficialSeasonCycle.ts", cycleArgs);
  const state = read<any>(path.join(league, "dynasty-state.json")), audit = read<any>(path.join(league, "audit-summary.json")), manifest = read<any>(path.join(league, "season-cycles", "cycle-smoke.json"));
  assert.equal(state.completedSeason, 2); assert.equal(audit.completedSeasons, 2); assert.equal(audit.fatalCount, 0); assert.equal(audit.warningCount, 0);
  assert.equal(manifest.status, "complete"); assert.deepEqual(Object.keys(manifest.stages), ["before-audit", "development", "promotion", "development-retention", "season", "after-audit", "history"]);
  assert.ok(fs.existsSync(path.join(development, "development-final-state.json.gz"))); assert.equal(fs.existsSync(path.join(development, "league")), false);
  assert.deepEqual(manifest.storage, {minimumFreeGb: 0, maximumDevelopmentOutputMb: 1024}); assert.ok(manifest.stages.development.evidence.storage.outputMb > 0); assert.ok(manifest.stages.season.evidence.storage.freeGb > 0);
  assert.equal(manifest.stages.season.evidence.globalSeason, 2);
  const historyLedger = read<any>(history); assert.equal(historyLedger.completedGlobalSeason, 2); assert.deepEqual(historyLedger.seasons.map((season: any) => season.globalSeason), [1, 2]);
  const replacement = state.managers.find((manager: any) => manager.id === bottom);
  assert.deepEqual(replacement.seasons.map((season: any) => season.season), [2]);
  const promotedBoundary = verifyHistoricalDynastyCheckpoint(league, 1), promotedState = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(league, ".season-checkpoints", "season-01", promotedBoundary.state.archive))).toString("utf8"));
  assert.deepEqual(promotedState.managers.find((manager: any) => manager.id === bottom).seasons, [], "season-01 historical boundary must include the post-promotion manager state used to start season 2");
  verifyHistoricalDynastyCheckpoint(league, 0); verifyHistoricalDynastyCheckpoint(league, 2);
  const beforeRerun = hash(fs.readFileSync(path.join(league, "dynasty-state.json")));
  const repeated = run("src/cli/runOfficialSeasonCycle.ts", cycleArgs);
  assert.match(repeated.stdout, /"reused": true/); assert.equal(hash(fs.readFileSync(path.join(league, "dynasty-state.json"))), beforeRerun);
  const changedPolicy = execute("src/cli/runOfficialSeasonCycle.ts", cycleArgs.map((value, index) => cycleArgs[index - 1] === "--max-development-output-mb" ? "2048" : value));
  assert.notEqual(changedPolicy.status, 0); assert.match(changedPolicy.stderr, /storage policy differs/); assert.equal(hash(fs.readFileSync(path.join(league, "dynasty-state.json"))), beforeRerun);
  const changedOffset = execute("src/cli/runOfficialSeasonCycle.ts", [...cycleArgs, "--global-season-offset", "9"]);
  assert.notEqual(changedOffset.status, 0); assert.match(changedOffset.stderr, /inputs differ/); assert.equal(hash(fs.readFileSync(path.join(league, "dynasty-state.json"))), beforeRerun);
  const changedDevelopment = execute("src/cli/runOfficialSeasonCycle.ts", [...cycleArgs, "--development-seasons", "2"]);
  assert.notEqual(changedDevelopment.status, 0); assert.match(changedDevelopment.stderr, /configuration differs/); assert.equal(hash(fs.readFileSync(path.join(league, "dynasty-state.json"))), beforeRerun);
  console.log("Official season cycle smoke passed: audited development, atomic promotion, next-season resume, final audit, and idempotent rerun");
} finally { fs.rmSync(workspace, {recursive: true, force: true}); }

function execute(file: string, args: string[], commandEnv = process.env) { return spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, file), ...args], {cwd: root, env: commandEnv, encoding: "utf8", maxBuffer: 64 * 1024 * 1024}); }
function run(file: string, args: string[], commandEnv = process.env): {stdout: string; stderr: string} { const result = execute(file, args, commandEnv); assert.equal(result.status, 0, result.stderr || result.stdout); return {stdout: result.stdout, stderr: result.stderr}; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function hash(value: Buffer): string { return crypto.createHash("sha256").update(value).digest("hex"); }
