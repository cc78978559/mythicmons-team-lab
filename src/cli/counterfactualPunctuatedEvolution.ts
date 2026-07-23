import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {loadDynastyState} from "../draft/dynastyStateStore";
import {materializeDynastyCheckpointBranch, verifyDynastyCheckpointBranch, type DynastyCheckpointBranchManifest} from "../draft/dynastyCheckpointBranch";

interface PendingLineage {lineageId: string; birthSeason: number}
interface CareerSeason {season: number; rank: number; points: number; champion: boolean}
interface ManagerState {id: string; name: string; cash: number; titles: number; lineage: {lineageId: string}; pendingLineage?: PendingLineage; seasons: CareerSeason[]}
interface BranchResult {lineageId: string; points: number; rank: number; champion: boolean; titles: number; cash: number}
interface DynastyState {
  seed: string;
  completedSeason: number;
  settings: Record<string, number | string | boolean | undefined>;
  registry?: {revision: string; snapshot: string};
  managers: ManagerState[];
  decisionRecords: Array<{decision?: string; actor?: string; context?: Record<string, unknown>}>;
}

const args = process.argv.slice(2);
const root = process.cwd();
const source = path.resolve(option("--source", "output/draft-league-v12"));
const out = path.resolve(option("--out", "output/punctuated-evolution-counterfactual"));
const sourceState = loadDynastyState<DynastyState>(path.join(source, "dynasty-state.json"));
const sourceShocks = new Set(Array.from({length: sourceState.completedSeason}, (_, index) => {
  const season = index + 1;
  const report = read<{budget?: {environmentalShock?: number}}>(path.join(source, `season-${String(season).padStart(2, "0")}`, "evolution.json"));
  return Number(report.budget?.environmentalShock ?? 0);
}));
if (sourceShocks.size !== 1) throw new Error("Source uses season-varying evolution shocks and cannot be reproduced by the isolated replay runner");
const sourceShock = [...sourceShocks][0] ?? 0;
const requestedManager = option("--manager", "");
const candidates = sourceState.managers.filter(manager => manager.pendingLineage?.birthSeason === sourceState.completedSeason + 1);
const selectedTarget = requestedManager ? candidates.find(manager => manager.id === requestedManager) : candidates[0];
if (!selectedTarget?.pendingLineage) throw new Error(requestedManager ? `Manager ${requestedManager} has no pending lineage for the next season` : "Source has no pending punctuated-evolution lineage");
const target = selectedTarget as ManagerState & {pendingLineage: PendingLineage};
if ((sourceState.settings.evolutionMode ?? "punctuated") !== "punctuated") throw new Error("Source must use punctuated evolution");
prepareOutput();

const activationSeason = target.pendingLineage.birthSeason;
const experimentDir = path.join(out, "experiment");
const controlDir = path.join(out, "control");
const experimentCheckpoint = materializeDynastyCheckpointBranch(source, experimentDir);
const controlCheckpoint = materializeDynastyCheckpointBranch(source, controlDir);
if (experimentCheckpoint.checkpointId !== controlCheckpoint.checkpointId) throw new Error("Counterfactual branches were not created from the same checkpoint");
runBranch(experimentDir, false);
runBranch(controlDir, true);
verifyPrefix(experimentDir, experimentCheckpoint);
verifyPrefix(controlDir, controlCheckpoint);

const experiment = loadDynastyState<DynastyState>(path.join(experimentDir, "dynasty-state.json"));
const control = loadDynastyState<DynastyState>(path.join(controlDir, "dynasty-state.json"));
const experimentManager = requiredManager(experiment, target.id);
const controlManager = requiredManager(control, target.id);
if (experimentManager.lineage.lineageId !== target.pendingLineage.lineageId) throw new Error("Experiment branch did not activate the selected pending lineage");
if (controlManager.lineage.lineageId !== target.lineage.lineageId) throw new Error("Control branch did not retain the parent lineage");
for (const manager of experiment.managers.filter(entry => entry.id !== target.id)) {
  const controlPeer = requiredManager(control, manager.id);
  if (manager.lineage.lineageId !== controlPeer.lineage.lineageId) throw new Error(`Non-target manager ${manager.id} has different current lineages across branches`);
}
if (!control.decisionRecords.some(record => record.actor === target.id && record.decision?.includes("隔离反事实抑制新生谱系") && record.context?.target === `${target.id}@${activationSeason}`)) throw new Error("Control branch has no exact suppression audit record");
const experimentSeason = requiredSeason(experimentManager, activationSeason);
const controlSeason = requiredSeason(controlManager, activationSeason);
const comparison = {
  managerId: target.id,
  managerName: target.name,
  parentLineageId: target.lineage.lineageId,
  descendantLineageId: target.pendingLineage.lineageId,
  activationSeason,
  experiment: branchResult(experimentManager, experimentSeason),
  control: branchResult(controlManager, controlSeason),
  delta: {
    points: experimentSeason.points - controlSeason.points,
    rankImprovement: controlSeason.rank - experimentSeason.rank,
    titles: experimentManager.titles - controlManager.titles,
    cash: experimentManager.cash - controlManager.cash,
  },
};
const summary = {schemaVersion: 1, source, checkpoint: {id: experimentCheckpoint.checkpointId, completedSeason: experimentCheckpoint.completedSeason, immutableFiles: experimentCheckpoint.immutablePrefix.length}, prefixVerifiedThroughSeason: sourceState.completedSeason, isolatedDifferenceVerified: true, isolatedDifference: `${target.id}@${activationSeason}`, comparison};
fs.writeFileSync(path.join(out, "counterfactual-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(out, "counterfactual-report.md"), markdown(summary), "utf8");
console.log(JSON.stringify({prefixVerified: true, isolatedDifference: summary.isolatedDifference, comparison, report: path.join(out, "counterfactual-report.md")}, null, 2));

function runBranch(directory: string, suppress: boolean): void {
  const settings = sourceState.settings;
  const registrySource = sourceState.registry?.snapshot ? path.resolve(directory, sourceState.registry.snapshot) : path.resolve(option("--registry", "data/draft"));
  const env = {
    ...process.env,
    V12_OUT: directory,
    V12_SEED: sourceState.seed,
    V12_SEASONS: String(activationSeason),
    V12_RESUME: "true",
    V12_ALLOW_CODE_UPGRADE: "true",
    V12_MANAGER_LIMIT: String(settings.managerLimit),
    V12_PAIRS: String(settings.pairs),
    V12_POOL_SIZE: String(settings.poolSize),
    V12_AUCTION_LOTS: String(settings.auctionLots),
    V12_REGULAR_ROUNDS: String(settings.regularRounds),
    V12_MAX_TURNS: String(settings.maxTurns),
    V12_MIN_ROSTER: String(settings.minRoster ?? 6),
    V12_MAX_ROSTER: String(settings.maxRoster ?? 10),
    V12_BASE_CASH: String(settings.baseBudget ?? 40),
    V12_REGISTRY_SOURCE: registrySource,
    V12_REGISTRY_REVISION: sourceState.registry?.revision ?? "punctuated-counterfactual",
    V12_EVIDENCE_RETENTION: "compact",
    V12_EVIDENCE_SAMPLE_RATE: "0",
    V12_EVOLUTION_MODE: "punctuated",
    V12_EVOLUTION_SHOCK: String(sourceShock),
    V12_EVOLUTION_MAX_BURSTS: String(settings.evolutionMaxBursts ?? 2),
    V12_EVOLUTION_MIN_CANDIDATES: String(settings.evolutionMinCandidates ?? 4),
    V12_EVOLUTION_MAX_CANDIDATES: String(settings.evolutionMaxCandidates ?? 8),
    V12_EVOLUTION_POLICY: suppress ? "suppress-experiment" : "active",
    V12_EVOLUTION_POLICY_TARGET: suppress ? `${target.id}@${activationSeason}` : "",
  };
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV12.ts")], {cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
  if (result.status !== 0) throw new Error(`${suppress ? "Control" : "Experiment"} evolution branch failed:\n${result.stderr || result.stdout}`);
}

function prepareOutput(): void {
  if (!fs.existsSync(out)) { fs.mkdirSync(out, {recursive: true}); return; }
  if (!args.includes("--force")) throw new Error(`Counterfactual output exists: ${out}; pass --force to replace it`);
  const resolved = path.resolve(out);
  if (path.parse(resolved).root === resolved || resolved === root || resolved === source || source.startsWith(`${resolved}${path.sep}`)) throw new Error(`Unsafe counterfactual target: ${resolved}`);
  fs.rmSync(resolved, {recursive: true, force: true});
  fs.mkdirSync(resolved, {recursive: true});
}

function verifyPrefix(branch: string, manifest: DynastyCheckpointBranchManifest): void { verifyDynastyCheckpointBranch(branch, manifest); }
function requiredManager(state: DynastyState, managerId: string): ManagerState { const manager = state.managers.find(entry => entry.id === managerId); if (!manager) throw new Error(`Branch has no manager ${managerId}`); return manager; }
function requiredSeason(manager: ManagerState, season: number): CareerSeason { const entry = manager.seasons.find(value => value.season === season); if (!entry) throw new Error(`Branch has no season ${season} for ${manager.id}`); return entry; }
function branchResult(manager: ManagerState, season: CareerSeason): BranchResult { return {lineageId: manager.lineage.lineageId, points: season.points, rank: season.rank, champion: season.champion, titles: manager.titles, cash: manager.cash}; }
function markdown(summary: {source: string; prefixVerifiedThroughSeason: number; isolatedDifference: string; comparison: typeof comparison}): string { const c = summary.comparison; return `# Punctuated evolution counterfactual\n\n- Source: \`${summary.source}\`\n- Prefix verified through season: ${summary.prefixVerifiedThroughSeason}\n- Isolated difference: \`${summary.isolatedDifference}\`\n- Parent: \`${c.parentLineageId}\`\n- Descendant: \`${c.descendantLineageId}\`\n\n| Branch | Points | Rank | Champion | Titles | Cash |\n|---|---:|---:|---|---:|---:|\n| Experiment | ${c.experiment.points} | ${c.experiment.rank} | ${c.experiment.champion} | ${c.experiment.titles} | ${c.experiment.cash} |\n| Control | ${c.control.points} | ${c.control.rank} | ${c.control.champion} | ${c.control.titles} | ${c.control.cash} |\n\nPoint delta: **${c.delta.points}**. Rank improvement: **${c.delta.rankImprovement}**.\n`; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
