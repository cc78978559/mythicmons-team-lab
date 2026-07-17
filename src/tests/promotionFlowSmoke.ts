import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const root = process.cwd(), workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-promotion-flow-"));
const source = path.join(workspace, "source"), development = path.join(workspace, "development"), promoted = path.join(workspace, "promoted");
try {
  run(path.join(root, "src", "cli", "draftLeagueV12.ts"), [], {...process.env, V12_OUT: source, V12_SEASONS: "1", V12_MANAGER_LIMIT: "6", V12_PAIRS: "1", V12_POOL_SIZE: "100", V12_AUCTION_LOTS: "10", V12_REGULAR_ROUNDS: "1", V12_MAX_TURNS: "20", V12_MIN_ROSTER: "6", V12_MAX_ROSTER: "6", V12_SEED: "promotion-flow-smoke", V12_EVOLUTION_MODE: "punctuated", V12_EVOLUTION_POLICY: "shadow", V12_EVIDENCE_RETENTION: "compact", V12_EVIDENCE_SAMPLE_RATE: "0"});
  const sourcePath = path.join(source, "dynasty-state.json"), before = fs.readFileSync(sourcePath), sourceState = JSON.parse(before.toString("utf8"));
  run(path.join(root, "src", "cli", "developmentLeague.ts"), ["--source", source, "--out", development, "--seasons", "2", "--parent-limit", "6", "--children-per-parent", "1", "--promotion-slots", "1", "--elimination-slots", "1", "--regular-rounds", "1", "--max-turns", "20"]);
  const promotion = JSON.parse(fs.readFileSync(path.join(development, "development-summary.json"), "utf8")).promoted[0];
  run(path.join(root, "src", "cli", "promoteDevelopmentManager.ts"), ["--major-source", source, "--promotion", path.join(development, "promotion-package.json"), "--replace", "manager-06", "--reason", "retirement", "--out", promoted, "--seasons", "1"]);
  assert.equal(hash(fs.readFileSync(sourcePath)), hash(before), "Promotion flow must not mutate its major-league source");
  const transaction = JSON.parse(fs.readFileSync(path.join(promoted, "promotion-transaction.json"), "utf8"));
  const result = JSON.parse(fs.readFileSync(path.join(promoted, "league", "dynasty-state.json"), "utf8"));
  assert.equal(transaction.authorized, true);
  assert.equal(transaction.reason, "retirement");
  assert.equal(transaction.vacancy, "manager-06");
  assert.equal(transaction.incoming.childId, promotion.childId);
  const replacement = result.managers.find((manager: any) => manager.id === "manager-06");
  assert.equal(replacement.name, promotion.childName);
  assert.equal(replacement.lineage.lineageId, promotion.lineage.lineageId);
  for (const manager of sourceState.managers.filter((entry: any) => entry.id !== "manager-06")) assert.equal(result.managers.find((entry: any) => entry.id === manager.id).lineage.lineageId, manager.lineage.lineageId);
  const rejected = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "promoteDevelopmentManager.ts"), "--major-source", source, "--promotion", path.join(development, "promotion-package.json"), "--replace", "manager-05", "--reason", "automatic", "--out", path.join(workspace, "rejected")], {cwd: root, encoding: "utf8"});
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /retirement or relegation/);
  console.log("Promotion flow smoke passed: explicit vacancy, source immutability, affiliate candidate, and unique top-league replacement");
} finally { fs.rmSync(workspace, {recursive: true, force: true}); }

function run(file: string, args: string[], env = process.env): void { const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), file, ...args], {cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024}); assert.equal(result.status, 0, result.stderr || result.stdout); }
function hash(value: Buffer): string { return crypto.createHash("sha256").update(value).digest("hex"); }
