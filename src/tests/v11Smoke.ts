import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";

const root = process.cwd();
const output = path.join(root, "output", "test-v11-smoke");
fs.rmSync(output, {recursive: true, force: true});

const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV11.ts")], {
  cwd: root,
  env: {...process.env, V11_OUT: output, V11_SEASONS: "1", V11_MANAGER_LIMIT: "6", V11_PAIRS: "1", V11_POOL_SIZE: "100", V11_AUCTION_LOTS: "10", V11_REGULAR_ROUNDS: "5", V11_MAX_TURNS: "100", V11_MIN_ROSTER: "6", V11_MAX_ROSTER: "6", V11_SEED: "automated-v11-smoke", V11_EVOLUTION_MODE: "generational"},
  encoding: "utf8",
});
assert.equal(result.status, 0, result.stderr || result.stdout);

const state = read<any>(path.join(output, "dynasty-state.json"));
const pool = read<any[]>(path.join(output, "season-01", "season-pool.json"));
const rosters = fs.readdirSync(path.join(output, "season-01", "rosters")).flatMap(manager => read<any>(path.join(output, "season-01", "rosters", manager, "roster.json")).members);
const contracts = state.managers.flatMap((manager: any) => manager.contracts);
const assets = Object.values(state.assets) as any[];
const economy = read<any>(path.join(output, "season-01", "economy.json"));

assert.equal(state.version, 11);
assert.equal(Math.max(...pool.map(candidate => candidate.debutGeneration)), 1);
assert(pool.some(candidate => candidate.economicClass === "background"));
assert(pool.some(candidate => candidate.economicClass === "unique"));
assert(rosters.every(member => member.economicClass !== "background" || (member.method === "registration" && member.price === 0 && !member.contract)));
assert([...groupCount(rosters.filter(member => member.economicClass === "background").map(member => member.family)).values()].some(count => count > 1));
assert(contracts.every((contract: any) => contract.assetClass !== "background"));
assert(assets.every(asset => asset.economicClass !== "background"));
assert.equal(economy.conserved, true);
assert.equal(economy.distributedLiquidity, 0);
assert(rosters.filter(member => member.configurationSource === "ai").every(member => Object.values(member.configuredSet.evs ?? {}).reduce((sum: number, value) => sum + Number(value), 0) <= 510));
assert(state.managers.every((manager: any) => Object.keys(manager.currentProfile.configurationMemory.moves).length > 0));
assert(state.managers.every((manager: any) => manager.pendingProfile?.genome?.configuration && manager.pendingProfile?.genome?.systems && manager.pendingProfile?.genome?.organization));

console.log("V11 dual-ecosystem smoke test passed");

function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function groupCount(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}
