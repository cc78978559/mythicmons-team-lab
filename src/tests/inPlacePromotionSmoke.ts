import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const root = process.cwd(), workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-in-place-promotion-"));
const league = path.join(workspace, "league"), development = path.join(workspace, "development");
const baseEnv = {...process.env, V12_OUT: league, V12_SEASONS: "1", V12_MANAGER_LIMIT: "6", V12_PAIRS: "1", V12_POOL_SIZE: "100", V12_AUCTION_LOTS: "10", V12_REGULAR_ROUNDS: "1", V12_MAX_TURNS: "20", V12_MIN_ROSTER: "6", V12_MAX_ROSTER: "6", V12_SEED: "in-place-promotion-smoke", V12_EVOLUTION_MODE: "punctuated", V12_EVOLUTION_POLICY: "shadow", V12_EVIDENCE_RETENTION: "compact", V12_EVIDENCE_SAMPLE_RATE: "0"};
try {
  run("src/cli/draftLeagueV12.ts", [], baseEnv);
  run("src/cli/auditV12.ts", ["--out", league, "--force"]);
  run("src/cli/developmentLeague.ts", ["--source", league, "--out", development, "--seasons", "2", "--parent-limit", "6", "--children-per-parent", "1", "--promotion-slots", "2", "--elimination-slots", "2", "--regular-rounds", "1", "--max-turns", "20"]);

  const statePath = path.join(league, "dynasty-state.json"), beforeBytes = fs.readFileSync(statePath), before = JSON.parse(beforeBytes.toString("utf8"));
  const bottom = before.managers.map((manager: any) => ({manager, rank: manager.seasons.at(-1).rank})).sort((a: any, b: any) => b.rank - a.rank || a.manager.id.localeCompare(b.manager.id)).slice(0, 2).map((entry: any) => entry.manager.id);
  const untouchedBefore = before.managers.filter((manager: any) => !bottom.includes(manager.id));
  const globalBefore = pickGlobal(before);
  run("src/cli/applyDevelopmentPromotion.ts", ["--major-source", league, "--promotion", path.join(development, "promotion-package.json"), "--auto-bottom", "2", "--transaction-id", "smoke-rollback"]);

  const first = JSON.parse(fs.readFileSync(statePath, "utf8")), manifestPath = path.join(league, "promotion-transactions", "smoke-rollback", "transaction.json"), manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(first.completedSeason, before.completedSeason, "Promotion must preserve the season boundary");
  assert.deepEqual(pickGlobal(first), globalBefore, "Promotion must preserve the complete club and league economy");
  assert.deepEqual(first.managers.filter((manager: any) => !bottom.includes(manager.id)), untouchedBefore, "Non-relegated managers must be byte-equivalent objects");
  assert.equal(manifest.status, "committed");
  assert.equal(manifest.selectionPolicy.type, "automatic-bottom-standings");
  for (const id of bottom) {
    const oldManager = before.managers.find((manager: any) => manager.id === id), incoming = first.managers.find((manager: any) => manager.id === id);
    assert.notEqual(incoming.lineage.lineageId, oldManager.lineage.lineageId);
    assert.deepEqual(incoming.contracts, oldManager.contracts);
    assert.equal(incoming.cash, oldManager.cash);
    assert.equal(incoming.deadMoneyCurrent, oldManager.deadMoneyCurrent);
    assert.equal(incoming.titles, 0); assert.equal(incoming.totalPoints, 0); assert.deepEqual(incoming.seasons, []);
    assert.equal(first.punctuatedEvolution[id].pressure, 0);
  }

  run("src/cli/applyDevelopmentPromotion.ts", ["--rollback", manifestPath]);
  assert.equal(hash(fs.readFileSync(statePath)), hash(beforeBytes), "Rollback must restore the exact pre-promotion state");

  run("src/cli/applyDevelopmentPromotion.ts", ["--major-source", league, "--promotion", path.join(development, "promotion-package.json"), "--auto-bottom", "2", "--transaction-id", "smoke-commit"]);
  run("src/cli/draftLeagueV12.ts", [], {...baseEnv, V12_SEASONS: "2", V12_RESUME: "true", V12_ALLOW_CODE_UPGRADE: "true"});
  run("src/cli/auditV12.ts", ["--out", league, "--force"]);
  const resumed = JSON.parse(fs.readFileSync(statePath, "utf8")), audit = JSON.parse(fs.readFileSync(path.join(league, "audit-summary.json"), "utf8"));
  assert.equal(resumed.completedSeason, 2);
  assert.equal(audit.fatalCount, 0); assert.equal(audit.warningCount, 0); assert.equal(audit.metrics.moneyConserved, true);
  for (const id of bottom) assert.deepEqual(resumed.managers.find((manager: any) => manager.id === id).seasons.map((season: any) => season.season), [2], "Incoming career must start in the following season");
  const staleRollback = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src/cli/applyDevelopmentPromotion.ts"), "--rollback", path.join(league, "promotion-transactions", "smoke-commit", "transaction.json")], {cwd: root, encoding: "utf8"});
  assert.notEqual(staleRollback.status, 0, "Rollback must be refused after a newer season changes the state");
  assert.match(staleRollback.stderr, /state has changed since promotion/);
  console.log("In-place promotion smoke passed: automatic relegation, club continuity, exact rollback, and next-season resume");
} finally { fs.rmSync(workspace, {recursive: true, force: true}); }

function pickGlobal(state: any): unknown { return {settings: state.settings, market: state.market, assets: state.assets, leaguePool: state.leaguePool, moneySupply: state.moneySupply, evolutionArchive: state.evolutionArchive}; }
function run(file: string, args: string[], env = process.env): void { const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, file), ...args], {cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024}); assert.equal(result.status, 0, result.stderr || result.stdout); }
function hash(value: Buffer): string { return crypto.createHash("sha256").update(value).digest("hex"); }
