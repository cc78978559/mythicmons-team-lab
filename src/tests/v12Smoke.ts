import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {auditV12Output, auditV12Signature, auditV12SignatureIncremental} from "../draft/v12Audit";
import {strategyProgramHash, validateStrategyProgram} from "../draft/strategyProgram";
import {loadDynastyState} from "../draft/dynastyStateStore";

const root = process.cwd();
const output = path.join(root, "output", "test-v12-smoke");
const registrySource = path.join(root, "output", "test-v12-registry-source");
fs.rmSync(output, {recursive: true, force: true});
fs.rmSync(registrySource, {recursive: true, force: true});
fs.cpSync(path.join(root, "data", "draft"), registrySource, {recursive: true});
runSeason(false, "1");

const state = loadDynastyState<any>(path.join(output, "dynasty-state.json"));
assert.equal(state.version, 12);
assert.equal(state.completedSeason, 1);
assert.equal(state.settings.tacticalMemoryBehaviorPolicy, "cumulative");
assert.equal(state.settings.tacticalMemoryConfidenceFloor, .15);
assertResumeRejectsChangedMemoryPolicy();
assert.equal(state.leaguePool + state.managers.reduce((sum: number, manager: any) => sum + manager.cash, 0), state.moneySupply);
for (const manager of state.managers) validateStrategyProgram(manager.currentProfile.strategyProgram);
for (const manager of state.managers) {
  assert.equal(manager.currentProfile.tacticalMemoryExperiment.schemaVersion, 1);
  assert.equal(manager.currentProfile.tacticalMemoryExperiment.startedSeason, 1);
  assert.deepEqual(manager.currentProfile.tacticalMemoryExperiment.cumulative, manager.currentProfile.tacticalMemory);
}
assert(new Set(state.managers.map((manager: any) => strategyProgramHash(manager.pendingProfile.strategyProgram))).size > 1);
assert(state.decisionRecords.some((record: any) => record.decision.includes("配置证据更新") && record.context?.updates?.length));

let evidenceUses = 0;
for (let season = 1; season <= 1; season += 1) {
  const seasonRoot = path.join(output, `season-${String(season).padStart(2, "0")}`);
  const result = read<any>(path.join(seasonRoot, "season.json"));
  assert.deepEqual(result.validity, {schemaVersion: 1, valid: true, battleLineupSize: 6});
  const ledger = read<any>(path.join(seasonRoot, "decision-ledger.json"));
  const opportunities = read<any>(path.join(seasonRoot, "program-opportunities.json"));
  assert.equal(opportunities.schemaVersion, 2);
  const decisionGroups = opportunities.managers.flatMap((manager: any) => manager.decisions ?? []);
  assert(decisionGroups.length > 0);
  assert(decisionGroups.every((decision: any) => decision.candidates.length >= 2 && decision.candidates.length <= 8 && decision.selectedIds.every((id: string) => decision.candidates.some((candidate: any) => candidate.id === id))));
  assert(decisionGroups.some((decision: any) => decision.entrypoint === "configure"));
  const lineups = ledger.records.filter((record: any) => record.stage === "lineup");
  assert(lineups.length > 0);
  assert(lineups.every((record: any) => Array.isArray(record.selected) && record.selected.length === 6));
  for (const rosterFile of findFiles(path.join(seasonRoot, "rosters"), "roster.json")) {
    const roster = read<any>(rosterFile);
    assert(roster.members.length >= 6 && roster.members.length <= 10);
    evidenceUses += roster.members.reduce((sum: number, member: any) => sum + Object.values(member.configurationEvidence?.moves ?? {}).reduce((moveSum: number, evidence: any) => moveSum + Number(evidence.uses ?? 0), 0), 0);
  }
  const archives = findFiles(seasonRoot, ".gz", true);
  assert(archives.length > 0);
  assert.equal(findFiles(seasonRoot, "raw.log").length, 0);
  assert.equal(findFiles(seasonRoot, "public.log").length, 0);
}
assert(evidenceUses > 0);

const audit = auditV12Output(output);
assert.equal(audit.fatalCount, 0, JSON.stringify(audit.issues));
assert.equal(audit.warningCount, 0, JSON.stringify(audit.issues));
const health = read<any>(path.join(output, "season-01", "health.json"));
assert.equal(health.auctionMode, "portfolio");
assert.equal(health.auctionTieRate, 0);
assert.ok(!health.warnings.includes("auction-tie-dominance"));
assert.equal(health.programSpecies, audit.metrics.uniquePrograms);
assert.equal(health.behaviorSpecies, audit.metrics.uniqueProgramBehaviors);
assert.equal(audit.metrics.invalidLineups, 0);
assert.equal(audit.metrics.battleFiles, audit.metrics.expectedBattleFiles);
assert.equal(audit.metrics.battleInventoryMismatches, 0);
assert.equal(audit.metrics.healthWarnings, health.warnings.length);
assert.equal(audit.metrics.financialViolations, 0);
assert(audit.metrics.configurationUpdates > 0);
assert.equal(audit.metrics.uniqueProgramBehaviors, 1);
assert.equal(audit.metrics.nonZeroProgramBehaviors, 0);
assert.equal(audit.metrics.programOpportunityFiles, 1);
assert(audit.metrics.programOpportunityObservations > audit.metrics.programOpportunitySamples);
assert.equal(audit.metrics.invalidProgramOpportunities, 0);
const brief = read<any>(path.join(output, "season-01", "season-brief.json"));
const tokenBudget = read<any>(path.join(output, "season-01", "token-budget.json"));
assert.equal(brief.season, 1);
assert(tokenBudget.briefCharacters <= 8_000);
assert(tokenBudget.estimatedStandardReportTotal <= 3_000);
const signature = auditV12Signature(output, 1);
  const firstIncremental = auditV12SignatureIncremental(output, 1);
  assert.equal(firstIncremental.signature, signature);
  assert.equal(firstIncremental.hashedFiles, firstIncremental.files);
  const cachedIncremental = auditV12SignatureIncremental(output, 1, firstIncremental.cache);
  assert.equal(cachedIncremental.signature, signature);
  assert.equal(cachedIncremental.hashedFiles, 0);
  const syntheticNextSeason = path.join(output, "season-02");
  fs.mkdirSync(syntheticNextSeason);
  fs.writeFileSync(path.join(syntheticNextSeason, "new-season-marker.json"), "{}\n", "utf8");
  const grownIncremental = auditV12SignatureIncremental(output, 2, firstIncremental.cache);
  assert.equal(grownIncremental.hashedFiles, 1, "A new season must reuse prior-season hashes and read only new files");
  assert.notEqual(grownIncremental.signature, signature);
  fs.rmSync(syntheticNextSeason, {recursive: true});
  const rosterFile = findFiles(path.join(output, "season-01", "rosters"), "roster.json")[0];
  const originalTime = fs.statSync(rosterFile).mtimeMs;
  fs.utimesSync(rosterFile, new Date(), new Date(originalTime + 2000));
  assert.equal(auditV12Signature(output, 1), signature, "Audit signature must ignore metadata-only timestamp drift");
  const metadataRefresh = auditV12SignatureIncremental(output, 1, firstIncremental.cache);
  assert.equal(metadataRefresh.signature, signature);
  assert.equal(metadataRefresh.hashedFiles, 1);
  const originalRoster = fs.readFileSync(rosterFile);
  fs.appendFileSync(rosterFile, "\n");
  assert.notEqual(auditV12Signature(output, 1), signature, "Audit signature must detect content changes");
  fs.writeFileSync(rosterFile, originalRoster);
  assert.equal(auditV12Signature(output, 1), signature, "Restoring exact content must restore the signature");
  const endFile = findFiles(path.join(output, "season-01", "battles"), "end.json")[0], hiddenEnd = `${endFile}.hidden`;
  fs.renameSync(endFile, hiddenEnd);
  const missingBattleAudit = auditV12Output(output);
  assert(missingBattleAudit.issues.some(entry => entry.code === "battle-inventory-mismatch"), "Audit must reconcile archived and present battles");
  fs.renameSync(hiddenEnd, endFile);
const pinnedHash = read<any>(path.join(output, "dynasty-state.json")).registry.hash;
const sourceFile = path.join(registrySource, "g1-six-team.json"), sourceValue = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
fs.writeFileSync(sourceFile, `${JSON.stringify(sourceValue)}\n`, "utf8");
runSeason(true, "1");
assert.equal(read<any>(path.join(output, "dynasty-state.json")).registry.hash, pinnedHash);
runSeason(true, "1", true);
const adopted = loadDynastyState<any>(path.join(output, "dynasty-state.json"));
assert.notEqual(adopted.registry.hash, pinnedHash);
assert(adopted.decisionRecords.some((record: any) => record.decision.includes("采用新的魔改配置版本")));
const fullAudit = runAudit("--mode", "full");
assert.equal(fullAudit.status, 0, fullAudit.stderr || fullAudit.stdout);
assert.equal(JSON.parse(fullAudit.stdout).cached, false);
const quickAudit = runAudit("--mode", "quick");
assert.equal(quickAudit.status, 0, quickAudit.stderr || quickAudit.stdout);
const quickResult = JSON.parse(quickAudit.stdout);
assert.equal(quickResult.cached, true);
assert.equal(quickResult.signature.hashedFiles, 0);
fs.rmSync(registrySource, {recursive: true, force: true});
console.log("V12 self-programming league smoke test passed");

function runSeason(resume: boolean, seasons: string, adopt = false): void {
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV12.ts")], {
    cwd: root,
    env: {...process.env, V12_OUT: output, V12_SEASONS: seasons, V12_RESUME: String(resume), V12_ADOPT_REGISTRY: String(adopt), V12_REGISTRY_SOURCE: registrySource, V12_REGISTRY_REVISION: adopt ? "adopted-smoke" : "initial-smoke", V12_MANAGER_LIMIT: "6", V12_PAIRS: "1", V12_POOL_SIZE: "100", V12_AUCTION_LOTS: "10", V12_REGULAR_ROUNDS: "2", V12_MAX_TURNS: "80", V12_MIN_ROSTER: "6", V12_MAX_ROSTER: "6", V12_SEED: "automated-v12-smoke", V12_EVOLUTION_MODE: "generational"},
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
function assertResumeRejectsChangedMemoryPolicy(): void {
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV12.ts")], {
    cwd: root,
    env: {...process.env, V12_OUT: output, V12_SEASONS: "1", V12_RESUME: "true", V12_REGISTRY_SOURCE: registrySource, V12_REGISTRY_REVISION: "initial-smoke", V12_MANAGER_LIMIT: "6", V12_PAIRS: "1", V12_POOL_SIZE: "100", V12_AUCTION_LOTS: "10", V12_REGULAR_ROUNDS: "2", V12_MAX_TURNS: "80", V12_MIN_ROSTER: "6", V12_MAX_ROSTER: "6", V12_SEED: "automated-v12-smoke", V12_EVOLUTION_MODE: "generational", V12_TACTICAL_MEMORY_CONFIDENCE_FLOOR: "0"},
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.notEqual(result.status, 0, "a saved journey must reject a different tactical-memory policy");
  assert.match(result.stderr || result.stdout, /settings do not match/);
}
function runAudit(...auditArgs: string[]) {
  return spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "auditV12.ts"), "--out", output, ...auditArgs], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}
function findFiles(directory: string, suffix: string, matchSuffix = false): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...findFiles(target, suffix, matchSuffix));
    else if (matchSuffix ? entry.name.endsWith(suffix) : entry.name === suffix) files.push(target);
  }
  return files;
}
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
