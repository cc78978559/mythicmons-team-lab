import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {spawnSync} from "node:child_process";
import {loadDynastyState} from "../draft/dynastyStateStore";

const root = process.cwd(), workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-in-place-promotion-"));
const league = path.join(workspace, "league"), development = path.join(workspace, "development");
const baseEnv = {...process.env, V12_OUT: league, V12_SEASONS: "1", V12_MANAGER_LIMIT: "6", V12_PAIRS: "1", V12_POOL_SIZE: "100", V12_AUCTION_LOTS: "10", V12_REGULAR_ROUNDS: "1", V12_MAX_TURNS: "20", V12_MIN_ROSTER: "6", V12_MAX_ROSTER: "6", V12_SEED: "in-place-promotion-smoke", V12_EVOLUTION_MODE: "punctuated", V12_EVOLUTION_POLICY: "shadow", V12_EVIDENCE_RETENTION: "compact", V12_EVIDENCE_SAMPLE_RATE: "0"};
try {
  run("src/cli/draftLeagueV12.ts", [], baseEnv);
  run("src/cli/auditV12.ts", ["--out", league, "--force"]);
  run("src/cli/developmentLeague.ts", ["--source", league, "--out", development, "--seasons", "2", "--parent-limit", "6", "--children-per-parent", "1", "--promotion-slots", "2", "--elimination-slots", "2", "--regular-rounds", "1", "--max-turns", "20"]);

  const statePath = path.join(league, "dynasty-state.json"), beforeBytes = fs.readFileSync(statePath), before = loadDynastyState<any>(statePath);
  const promotionManifestPath = path.join(development, "promotion-package.json"), promotionManifest = JSON.parse(fs.readFileSync(promotionManifestPath, "utf8"));
  const promotionPayload = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(development, promotionManifest.archive))).toString("utf8"));
  assert.equal(promotionPayload.schemaVersion, 2);
  assert.equal(promotionPayload.source.stateSha256, hash(beforeBytes));
  assert.equal(promotionPayload.source.completedSeason, 1);

  const auditPath = path.join(league, "audit-summary.json"), tamperedAudit = JSON.parse(fs.readFileSync(auditPath, "utf8")); tamperedAudit.inputSignature = "tampered"; fs.writeFileSync(auditPath, `${JSON.stringify(tamperedAudit, null, 2)}\n`);
  const staleAudit = reject("src/cli/applyDevelopmentPromotion.ts", ["--major-source", league, "--promotion", promotionManifestPath, "--auto-bottom", "2", "--transaction-id", "stale-audit"]);
  assert.match(String(staleAudit.stderr), /audit is not clean or does not match/);
  run("src/cli/auditV12.ts", ["--out", league, "--force"]);

  const foreign = path.join(workspace, "foreign-package"); fs.mkdirSync(foreign);
  promotionPayload.source.majorLeague = path.join(workspace, "another-league");
  const foreignBytes = Buffer.from(`${JSON.stringify(promotionPayload)}\n`), foreignArchive = zlib.gzipSync(foreignBytes);
  fs.writeFileSync(path.join(foreign, "promotion-package.json.gz"), foreignArchive);
  fs.writeFileSync(path.join(foreign, "promotion-package.json"), `${JSON.stringify({...promotionManifest, archive: "promotion-package.json.gz", sha256: hash(foreignBytes), sourceBytes: foreignBytes.length, compressedBytes: foreignArchive.length}, null, 2)}\n`);
  const foreignResult = reject("src/cli/applyDevelopmentPromotion.ts", ["--major-source", league, "--promotion", path.join(foreign, "promotion-package.json"), "--auto-bottom", "2", "--transaction-id", "foreign"]);
  assert.match(String(foreignResult.stderr), /different major-league root/);

  const bottom = before.managers.map((manager: any) => ({manager, rank: manager.seasons.at(-1).rank})).sort((a: any, b: any) => b.rank - a.rank || a.manager.id.localeCompare(b.manager.id)).slice(0, 2).map((entry: any) => entry.manager.id);
  const untouchedBefore = before.managers.filter((manager: any) => !bottom.includes(manager.id));
  const globalBefore = pickGlobal(before);
  run("src/cli/applyDevelopmentPromotion.ts", ["--major-source", league, "--promotion", promotionManifestPath, "--auto-bottom", "2", "--transaction-id", "smoke-rollback"]);

  const firstCore = JSON.parse(fs.readFileSync(statePath, "utf8")), first = loadDynastyState<any>(statePath), manifestPath = path.join(league, "promotion-transactions", "smoke-rollback", "transaction.json"), manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const checkpointPath = path.join(path.dirname(manifestPath), manifest.result.checkpoint.archive), checkpointBytes = fs.readFileSync(checkpointPath), checkpointState = zlib.gunzipSync(checkpointBytes);
  assert.equal(hash(checkpointBytes), manifest.result.checkpoint.archiveSha256);assert.equal(hash(checkpointState), manifest.result.afterSha256);assert.deepEqual(JSON.parse(checkpointState.toString("utf8")), firstCore);
  const simulatedCrash = {...manifest, status: "prepared"}; delete simulatedCrash.committedAt; delete simulatedCrash.result; fs.writeFileSync(manifestPath, `${JSON.stringify(simulatedCrash, null, 2)}\n`);
  const recovered = reject("src/cli/applyDevelopmentPromotion.ts", ["--major-source", league, "--promotion", promotionManifestPath, "--auto-bottom", "2", "--transaction-id", "must-not-run"]);
  assert.match(String(recovered.stderr), /Recovered 1 committed promotion transaction/);
  const recoveredManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(recoveredManifest.status, "committed"); assert.ok(recoveredManifest.recoveredAt);
  assert.equal(recoveredManifest.result.checkpoint.stateSha256, manifest.result.afterSha256);
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

  run("src/cli/developmentLeague.ts", ["--source", league, "--out", development, "--seasons", "2", "--parent-limit", "6", "--children-per-parent", "1", "--promotion-slots", "2", "--elimination-slots", "2", "--regular-rounds", "1", "--max-turns", "20", "--force"]);
  run("src/cli/applyDevelopmentPromotion.ts", ["--major-source", league, "--promotion", promotionManifestPath, "--auto-bottom", "2", "--transaction-id", "smoke-commit"]);
  run("src/cli/draftLeagueV12.ts", [], {...baseEnv, V12_SEASONS: "2", V12_RESUME: "true", V12_ALLOW_CODE_UPGRADE: "true"});
  run("src/cli/auditV12.ts", ["--out", league, "--force"]);
  const resumed = loadDynastyState<any>(statePath), audit = JSON.parse(fs.readFileSync(path.join(league, "audit-summary.json"), "utf8"));
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
function reject(file: string, args: string[]): ReturnType<typeof spawnSync> { const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, file), ...args], {cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024}); assert.notEqual(result.status, 0, "Command should have been rejected"); return result; }
function hash(value: Buffer): string { return crypto.createHash("sha256").update(value).digest("hex"); }
