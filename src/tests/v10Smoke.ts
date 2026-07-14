import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const root = process.cwd();
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-v10-smoke-"));

try {
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV10.ts")], {
    cwd: root,
    env: {...process.env, V10_SEASONS: "4", V10_MANAGER_LIMIT: "10", V10_PAIRS: "1", V10_POOL_SIZE: "120", V10_AUCTION_LOTS: "12", V10_REGULAR_ROUNDS: "6", V10_MAX_TURNS: "20", V10_SEED: "v10-smoke", V10_OUT: outDir, V10_MIN_ROSTER: "6", V10_MAX_ROSTER: "8"},
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const state = read<any>(path.join(outDir, "dynasty-state.json"));
  assert.equal(state.version, 10);
  assert.equal(state.completedSeason, 4);
  assert.equal(state.settings.contractModel, "sports-market");
  assert.equal(state.settings.separatePayroll, true);
  assert.equal(state.settings.maxKeepers, 8);
  assert.equal(state.moneySupply, 400);
  assert.equal(state.managers.reduce((sum: number, manager: any) => sum + manager.cash, 0) + state.leaguePool, state.moneySupply);
  assert.ok(state.managers.every((manager: any) => manager.cash <= 60));
  assert.ok(Object.values(state.market).some((entry: any) => Number.isFinite(entry.currentValue)), "Dynamic market values must persist into the dynasty state");
  assert.ok(state.managers.some((manager: any) => manager.contracts.some((contract: any) => contract.status && contract.yearsRemaining >= 0 && contract.guaranteeRate > 0)));
  assert.ok(state.decisionRecords.some((record: any) => /RFA|UFA|唯一资产标签/.test(record.decision)), "The fourth offseason must exercise contract-market decisions");
  for (const season of [1, 2, 3, 4]) {
    const dir = path.join(outDir, `season-${String(season).padStart(2, "0")}`);
    const finance = read<any>(path.join(dir, "financial-health.json"));
    assert.equal(finance.teams.length, 10);
    assert.equal(finance.league.apronViolations, 0);
    assert.deepEqual(finance.rules, {hardApron: 120});
    const economy = read<any>(path.join(dir, "economy.json"));
    assert.equal(economy.conserved, true);
    assert.equal(economy.totalAfter, economy.moneySupply);
    const records = read<any>(path.join(dir, "decision-ledger.json")).records;
    const auctions = records.filter((record: any) => record.stage === "auction");
    assert.ok(auctions.every((record: any) => record.context.pricing === "critical-bid-approximation"));
  }
  console.log("V10 smoke passed: contracts, separate payroll, financial health, RFA market, and four-season state");
} finally {
  fs.rmSync(outDir, {recursive: true, force: true});
}

function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
