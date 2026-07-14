import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const root = process.cwd();
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-v9-smoke-"));

try {
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV9.ts")], {
    cwd: root,
    env: {
      ...process.env,
      V9_SEASONS: "2",
      V9_MANAGER_LIMIT: "10",
      V9_PAIRS: "1",
      V9_POOL_SIZE: "120",
      V9_AUCTION_LOTS: "12",
      V9_REGULAR_ROUNDS: "6",
      V9_MAX_TURNS: "20",
      V9_SEED: "v9-smoke",
      V9_OUT: outDir,
      V9_MIN_ROSTER: "6",
      V9_MAX_ROSTER: "8",
      V9_MIDSEASON_GRANT: "8",
    },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const state = read<any>(path.join(outDir, "dynasty-state.json"));
  assert.equal(state.version, 9);
  assert.equal(state.completedSeason, 2);
  assert.equal(state.settings.auctionMode, "portfolio");
  assert.equal(state.settings.contractModel, "market-arbitration");
  assert.equal(state.settings.learningModel, "counterfactual");
  for (const season of [1, 2]) {
    const dir = path.join(outDir, `season-${String(season).padStart(2, "0")}`);
    const health = read<any>(path.join(dir, "health.json"));
    assert.equal(health.season, season);
    const ledger = read<any>(path.join(dir, "decision-ledger.json")).records;
    const auctions = ledger.filter((record: any) => record.stage === "auction");
    assert.ok(auctions.length > 0 && auctions.every((record: any) => record.context.mode === "portfolio"));
    for (const manager of fs.readdirSync(path.join(dir, "rosters"))) {
      const roster = read<any>(path.join(dir, "rosters", manager, "roster.json"));
      assert.ok(roster.members.length >= 6 && roster.members.length <= 8);
    }
  }
  assert.ok(fs.existsSync(path.join(outDir, "health-report.md")));
  console.log("V9 smoke passed: portfolio market, flexible rosters, health monitor, and two-season resume state");
} finally {
  fs.rmSync(outDir, {recursive: true, force: true});
}

function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
