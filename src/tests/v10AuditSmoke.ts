import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const root = process.cwd();
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-v10-audit-"));

try {
  const first = runAudit("season");
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const result = JSON.parse(first.stdout) as {cached: boolean; fatal: number; seasons: number};
  assert.equal(result.cached, false);
  assert.equal(result.fatal, 0);
  assert.equal(result.seasons, 1);
  const summary = read<any>(path.join(outDir, "audit-summary.json"));
  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.managers, 10);
  assert.ok(fs.existsSync(path.join(outDir, "audit-report.md")));
  const second = runAudit("quick");
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(JSON.parse(second.stdout).cached, true);
  console.log("V10 audit smoke passed: local run, invariant scan, compact report, and signature cache");
} finally {
  fs.rmSync(outDir, {recursive: true, force: true});
}

function runAudit(mode: "quick" | "season") {
  return spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "auditV10.ts"), "--mode", mode, "--seasons", "1", "--out", outDir], {
    cwd: root,
    env: {...process.env, V10_MANAGER_LIMIT: "10", V10_PAIRS: "1", V10_POOL_SIZE: "120", V10_AUCTION_LOTS: "12", V10_REGULAR_ROUNDS: "3", V10_MAX_TURNS: "20", V10_MIN_ROSTER: "6", V10_MAX_ROSTER: "8"},
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
