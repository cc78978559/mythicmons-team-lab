import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {DRAFT_GENERATIONS, draftGenerationSource} from "../draft/customRegistry";
import {loadDynastyState} from "../draft/dynastyStateStore";

interface SmokeState {
  version: number;
  completedSeason: number;
  fingerprint: {codeHash: string; dataHash: string; dependencyHash: string; pokemonShowdownVersion: string};
  decisionRecords: unknown[];
  managers: Array<{
    id: string;
    contracts: Array<{family: string; pokemon: string; salary: number; years: number; lastSeasonAppearances: number; lastSeasonKos: number}>;
    currentProfile: {matchupMemory?: Record<string, unknown>};
    lineage: {lineageId: string; generation: number; parentLineageIds: string[]};
    lineageHistory: Array<{lineageId: string}>;
    pendingLineage?: {lineageId: string; generation: number; parentLineageIds: string[]; mutations: string[]};
    pendingProfile?: {id: string};
  }>;
}

const root = process.cwd();
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-dynasty-smoke-"));

try {
  const first = runDynasty(false);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const statePath = path.join(outDir, "dynasty-state.json");
  const state = loadDynastyState<SmokeState>(statePath);
  assert.equal(state.version, 8);
  assert.equal(state.completedSeason, 2);
  assert.equal(state.managers.length, 6);
  assert.ok(state.decisionRecords.length > 0);
  for (const hash of [state.fingerprint.codeHash, state.fingerprint.dataHash, state.fingerprint.dependencyHash]) assert.match(hash, /^[a-f0-9]{64}$/);
  assert.ok(state.fingerprint.pokemonShowdownVersion);
  for (const manager of state.managers) {
    assert.ok(manager.contracts.length <= 3);
    assert.ok(manager.contracts.reduce((sum, contract) => sum + contract.salary, 0) <= 70);
    assert.equal(Object.keys(manager.currentProfile.matchupMemory ?? {}).length, 5);
    assert.equal(manager.lineage.generation, 1, "Only a generation that entered a season may become current");
    assert.equal(manager.lineageHistory.length, 2);
    assert.ok(manager.lineage.parentLineageIds.length >= 1);
    assert.equal(manager.pendingLineage?.generation, 2, "The post-season child must remain pending until the next season");
    assert.equal(manager.pendingProfile?.id, manager.id);
  }
  assert.ok(fs.existsSync(path.join(outDir, "season-01", "season.json")));
  assert.ok(fs.existsSync(path.join(outDir, "season-02", "season-review.md")));
  assert.ok(fs.existsSync(path.join(outDir, "season-02", "evolution.json")));
  assertScarcityRules(path.join(outDir, "season-01"));

  const resumed = runDynasty(true);
  assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);
  assert.match(resumed.stdout, /resumed after season 2/);
  const resumedState = loadDynastyState<SmokeState>(statePath);
  assert.equal(resumedState.completedSeason, 2);
  assert.equal(resumedState.decisionRecords.length, state.decisionRecords.length);
  resumedState.fingerprint.dataHash = "0".repeat(64);
  delete (resumedState as any).stateStorage;
  fs.writeFileSync(statePath, `${JSON.stringify(resumedState, null, 2)}\n`, "utf8");
  const rejected = runDynasty(true);
  assert.notEqual(rejected.status, 0, "Resume must reject a changed data fingerprint");
  assert.match(rejected.stderr, /dataHash does not match/);
  resumedState.fingerprint.dataHash = state.fingerprint.dataHash;
  resumedState.managers[0].contracts = ["one", "two", "three"].map(family => ({assetId: `${family}:standard:1`, family, pokemon: family, salary: 30, years: 1, lastSeasonAppearances: 1, lastSeasonKos: 1}));
  fs.writeFileSync(statePath, `${JSON.stringify(resumedState, null, 2)}\n`, "utf8");
  const invalidBudget = runDynasty(true);
  assert.notEqual(invalidBudget.status, 0, "Resume must reject keeper salaries above 70");
  assert.match(invalidBudget.stderr, /exceeds the keeper budget/);

  const legacyV6 = legacyState(state, 6);
  fs.writeFileSync(statePath, `${JSON.stringify(legacyV6, null, 2)}\n`, "utf8");
  const migratedV6 = runDynasty(true);
  assert.equal(migratedV6.status, 0, migratedV6.stderr || migratedV6.stdout);
  const v6Result = loadDynastyState<SmokeState>(statePath);
  assert.equal(v6Result.version, 8);
  assert.ok(v6Result.managers.every(manager => manager.lineage.lineageId.startsWith("founder:")));

  const incompatibleV6 = legacyState(state, 6);
  incompatibleV6.fingerprint.dataHash = "0".repeat(64);
  fs.writeFileSync(statePath, `${JSON.stringify(incompatibleV6, null, 2)}\n`, "utf8");
  const rejectedMigration = runDynasty(true);
  assert.notEqual(rejectedMigration.status, 0, "V6 migration must retain data compatibility checks");
  assert.match(rejectedMigration.stderr, /dataHash does not match/);

  const legacyV5 = legacyState(state, 5);
  delete legacyV5.assets;
  fs.writeFileSync(statePath, `${JSON.stringify(legacyV5, null, 2)}\n`, "utf8");
  const migratedV5 = runDynasty(true, {managerLimit: 7, expandFromV5: true});
  assert.equal(migratedV5.status, 0, migratedV5.stderr || migratedV5.stdout);
  const v5Result = loadDynastyState<SmokeState>(statePath);
  assert.equal(v5Result.version, 8);
  assert.equal(v5Result.managers.length, 7);
  assert.ok(v5Result.managers.every(manager => manager.lineage?.lineageId), "Every incumbent and expansion manager needs a valid lineage");
  console.log("Dynasty smoke passed: seasons, resume, V6 evolution migration, and V5 expansion migration");
} finally {
  fs.rmSync(outDir, {recursive: true, force: true});
}

function assertScarcityRules(seasonDir: string): void {
  const pool = JSON.parse(fs.readFileSync(path.join(seasonDir, "season-pool.json"), "utf8")) as Array<{family: string; source: string; scarcity: string; supplyCap: number}>;
  const byFamily = new Map<string, typeof pool>();
  for (const candidate of pool) byFamily.set(candidate.family, [...(byFamily.get(candidate.family) ?? []), candidate]);
  for (const candidates of byFamily.values()) {
    if (candidates.some(candidate => candidate.scarcity === "legendary" || candidate.scarcity === "unique-custom")) assert.equal(candidates.length, 1);
    if (candidates.some(candidate => candidate.scarcity === "elite-ordinary")) assert.ok(candidates.length <= 3);
  }
  const registeredCustoms = DRAFT_GENERATIONS.reduce((total, generation) => {
    const registry = JSON.parse(fs.readFileSync(draftGenerationSource(generation), "utf8")) as {members: unknown[]};
    return total + registry.members.length;
  }, 0);
  assert.equal(pool.filter(candidate => candidate.scarcity === "unique-custom").length, registeredCustoms);
  const rosterRoot = path.join(seasonDir, "rosters");
  for (const manager of fs.readdirSync(rosterRoot)) {
    const roster = JSON.parse(fs.readFileSync(path.join(rosterRoot, manager, "roster.json"), "utf8")) as {members: Array<{method: string; tier: string}>};
    assert.ok(roster.members.filter(member => member.method === "supplemental").every(member => member.tier === "standard"));
  }
}

function legacyState(state: SmokeState, version: 5 | 6): any {
  const copy = JSON.parse(JSON.stringify(state));
  copy.version = version;
  for (const manager of copy.managers) {
    delete manager.lineage;
    delete manager.lineageHistory;
    delete manager.pendingLineage;
    delete manager.pendingProfile;
    if (version === 5) delete manager.cash;
  }
  return copy;
}

function runDynasty(resume: boolean, options: {managerLimit?: number; expandFromV5?: boolean} = {}): ReturnType<typeof spawnSync> & {stdout: string; stderr: string} {
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV4.ts")], {
    cwd: root,
    env: {
      ...process.env,
      V4_SEASONS: "2",
      V4_MANAGER_LIMIT: String(options.managerLimit ?? 6),
      V4_PAIRS: "1",
      V4_POOL_SIZE: "100",
      V4_AUCTION_LOTS: "10",
      V4_MAX_TURNS: "20",
      V4_SEED: "dynasty-smoke-v2",
      V4_OUT: outDir,
      V4_RESUME: resume ? "true" : "false",
      V4_EXPAND_FROM_V5: options.expandFromV5 ? "true" : "false",
      V4_REGULAR_ROUNDS: "5",
      V4_EVOLUTION_MODE: "generational",
    },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return result as ReturnType<typeof spawnSync> & {stdout: string; stderr: string};
}
