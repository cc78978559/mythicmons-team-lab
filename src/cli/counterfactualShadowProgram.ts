import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {spawnSync} from "node:child_process";
import {cloneManagerProfile, type ManagerProfile} from "../draft/managerProfiles";
import type {LineageIdentity} from "../draft/naturalEvolution";
import {strategyProgramBehaviorDistance, strategyProgramHash, strategyProgramMutationOperator, type StrategyProgramMutationOperator} from "../draft/strategyProgram";
import {createRegistrySnapshot} from "../draft/registrySnapshot";

interface ManagerState {
  id: string;
  name: string;
  cash: number;
  titles: number;
  currentProfile: ManagerProfile;
  pendingProfile?: ManagerProfile;
  lineage: LineageIdentity;
  pendingLineage?: LineageIdentity;
  seasons: Array<{season: number; rank: number; points: number; champion: boolean}>;
}
interface DynastyState {
  seed: string;
  completedSeason: number;
  settings: Record<string, number | string | boolean | undefined>;
  fingerprint: {registryHash: string};
  registry?: {revision: string; snapshot: string};
  managers: ManagerState[];
}
interface ShadowCandidate {
  managerId: string;
  replacedLineageId: string;
  profile: ManagerProfile;
  lineage: LineageIdentity;
  programBehaviorDistance: number;
  programOpportunity?: {distance: number; choicePotential: number; observedEntrypoints: number; observations: number};
}
interface ShadowPackage {schemaVersion: 1; season: number; seed: string; registryHash: string; strategyProgramOperator?: StrategyProgramMutationOperator; candidates: ShadowCandidate[]}

const args = process.argv.slice(2), root = process.cwd();
const source = path.resolve(option("--source", "output/draft-league-v12"));
const out = path.resolve(option("--out", "output/shadow-program-counterfactual"));
const horizonSeasons = integerOption("--horizon", 2, 1, 3);
const continuationSalt = option("--continuation-salt", "");
const sourceState = read<DynastyState>(path.join(source, "dynasty-state.json"));
const activationSeason = sourceState.completedSeason + 1;
const evaluationSeason = sourceState.completedSeason + horizonSeasons;
const packageFile = path.join(source, `season-${String(sourceState.completedSeason).padStart(2, "0")}`, "evolution-shadow-candidates.json");
const shadow = read<ShadowPackage>(packageFile);
validatePackage();
const operator = strategyProgramMutationOperator(shadow.strategyProgramOperator ?? sourceState.settings.strategyProgramOperator as string | undefined);
const requestedManager = option("--manager", "");
const candidates = shadow.candidates.filter(candidate => strategyProgramBehaviorDistance(requiredManager(sourceState, candidate.managerId).currentProfile.strategyProgram, candidate.profile.strategyProgram) > 0);
const candidate = requireCandidate(requestedManager ? candidates.find(entry => entry.managerId === requestedManager) : candidates[0]);
const sourceManager = requiredManager(sourceState, candidate.managerId);
if (sourceManager.pendingProfile || sourceManager.pendingLineage) throw new Error("Source manager already has a pending lineage");
prepareOutput();
const experimentDir = path.join(out, "experiment"), controlDir = path.join(out, "control");
cloneSource(experimentDir); cloneSource(controlDir);
injectProgramCandidate(experimentDir);
runBranch(experimentDir); runBranch(controlDir);
const experiment = read<DynastyState>(path.join(experimentDir, "dynasty-state.json"));
const control = read<DynastyState>(path.join(controlDir, "dynasty-state.json"));
const experimentManager = requiredManager(experiment, candidate.managerId), controlManager = requiredManager(control, candidate.managerId);
const experimentSeasons = seasonRange(activationSeason, evaluationSeason).map(season => requiredSeason(experimentManager, season)), controlSeasons = seasonRange(activationSeason, evaluationSeason).map(season => requiredSeason(controlManager, season));
const decisionEffects = seasonRange(activationSeason, evaluationSeason).map(season => compareDecisionEffects(experimentDir, controlDir, season, candidate.managerId)).reduce(sumDecisionEffects);
const expectedLineageId = isolatedLineage().lineageId;
if (experimentManager.lineage.lineageId !== expectedLineageId) throw new Error("Experiment did not activate the isolated program lineage");
if (controlManager.lineage.lineageId !== sourceManager.lineage.lineageId) throw new Error("Control did not retain the source lineage");
for (const manager of experiment.managers.filter(entry => entry.id !== candidate.managerId)) if (manager.lineage.lineageId !== requiredManager(control, manager.id).lineage.lineageId) throw new Error(`Non-target lineage diverged for ${manager.id}`);
const summary = {
  schemaVersion: 1,
  source,
  seed: sourceState.seed,
  sourceVerified: true,
  sourceRegistryHash: sourceState.fingerprint.registryHash,
  sourceSeason: sourceState.completedSeason,
  activationSeason,
  evaluationSeason,
  horizonSeasons,
  continuationSalt: continuationSalt || null,
  prefixVerified: verifySourcePrefix(experimentDir) && verifySourcePrefix(controlDir),
  isolatedDifference: {managerId: candidate.managerId, operator, parentProgramHash: strategyProgramHash(sourceManager.currentProfile.strategyProgram!), candidateProgramHash: strategyProgramHash(candidate.profile.strategyProgram!), behaviorDistance: strategyProgramBehaviorDistance(sourceManager.currentProfile.strategyProgram, candidate.profile.strategyProgram), opportunityDistance: candidate.programOpportunity?.distance ?? null, choicePotential: candidate.programOpportunity?.choicePotential ?? null, operatorMutations: candidate.lineage.mutations.filter(mutation => mutation.startsWith("program."))},
  decisionEffects,
  experiment: result(experimentManager, experimentSeasons),
  control: result(controlManager, controlSeasons),
  delta: {points: sum(experimentSeasons.map(season => season.points)) - sum(controlSeasons.map(season => season.points)), rankImprovement: controlSeasons.at(-1)!.rank - experimentSeasons.at(-1)!.rank, titles: experimentManager.titles - controlManager.titles, cash: experimentManager.cash - controlManager.cash},
};
write(path.join(out, "counterfactual-summary.json"), summary);
fs.writeFileSync(path.join(out, "counterfactual-report.md"), markdown(summary), "utf8");
console.log(JSON.stringify({prefixVerified: summary.prefixVerified, isolatedDifference: summary.isolatedDifference, delta: summary.delta, report: path.join(out, "counterfactual-report.md")}, null, 2));

function validatePackage(): void {
  if (shadow.schemaVersion !== 1 || shadow.season !== sourceState.completedSeason || shadow.seed !== sourceState.seed || shadow.registryHash !== sourceState.fingerprint.registryHash) throw new Error("Shadow candidate package does not match the source dynasty");
  if (strategyProgramMutationOperator(shadow.strategyProgramOperator) !== strategyProgramMutationOperator(sourceState.settings.strategyProgramOperator as string | undefined)) throw new Error("Shadow candidate operator does not match the source dynasty");
  for (const candidate of shadow.candidates) {
    const manager = requiredManager(sourceState, candidate.managerId);
    if (candidate.replacedLineageId !== manager.lineage.lineageId || candidate.profile.id !== manager.id || candidate.lineage.birthSeason !== sourceState.completedSeason + 1) throw new Error(`Invalid shadow candidate binding for ${candidate.managerId}`);
  }
}
function requireCandidate(value: ShadowCandidate | undefined): ShadowCandidate {
  if (!value) throw new Error(requestedManager ? `Manager ${requestedManager} has no semantic program shadow candidate` : "Shadow package has no semantic program candidate");
  return value;
}
function injectProgramCandidate(directory: string): void {
  const file = path.join(directory, "dynasty-state.json"), state = read<DynastyState>(file), manager = requiredManager(state, candidate.managerId);
  const profile = cloneManagerProfile(manager.currentProfile);
  profile.strategyProgram = structuredClone(candidate.profile.strategyProgram!);
  manager.pendingProfile = profile;
  manager.pendingLineage = isolatedLineage();
  write(file, state);
}
function isolatedLineage(): LineageIdentity {
  const programHash = strategyProgramHash(candidate.profile.strategyProgram!);
  return {lineageId: `program-s${sourceState.completedSeason + 1}:${candidate.managerId}:${programHash.slice(0, 12)}`, generation: sourceManager.lineage.generation + 1, parentLineageIds: [sourceManager.lineage.lineageId], founderId: sourceManager.lineage.founderId, birthSeason: sourceState.completedSeason + 1, niche: sourceManager.lineage.niche, mutations: [`strategy-program:${programHash}`]};
}
function runBranch(directory: string): void {
  const settings = sourceState.settings, registrySource = registrySourceFor(directory);
  const env = {...process.env, V12_OUT: directory, V12_RESUME: "true", V12_ALLOW_CODE_UPGRADE: "true", V12_SEASONS: String(evaluationSeason), V12_SEED: sourceState.seed, V12_MANAGER_LIMIT: String(settings.managerLimit), V12_PAIRS: String(settings.pairs), V12_POOL_SIZE: String(settings.poolSize), V12_AUCTION_LOTS: String(settings.auctionLots), V12_REGULAR_ROUNDS: String(settings.regularRounds), V12_MAX_TURNS: String(settings.maxTurns), V12_MIN_ROSTER: String(settings.minRoster ?? 6), V12_MAX_ROSTER: String(settings.maxRoster ?? 10), V12_REGISTRY_SOURCE: registrySource, V12_REGISTRY_REVISION: sourceState.registry?.revision ?? "shadow-program-counterfactual", V12_STRATEGY_PROGRAM_OPERATOR: String(settings.strategyProgramOperator ?? "observed-boundary-v1"), V12_EVOLUTION_MODE: String(settings.evolutionMode ?? "punctuated"), V12_EVOLUTION_POLICY: String(settings.evolutionPolicy ?? "shadow"), V12_EVOLUTION_MAX_BURSTS: String(settings.evolutionMaxBursts ?? 2), V12_EVOLUTION_MIN_CANDIDATES: String(settings.evolutionMinCandidates ?? 4), V12_EVOLUTION_MAX_CANDIDATES: String(settings.evolutionMaxCandidates ?? 8), V12_EVIDENCE_RETENTION: "compact", V12_EVIDENCE_SAMPLE_RATE: "1", ...(continuationSalt ? {V12_COUNTERFACTUAL_CONTINUATION: "true", V12_CONTINUATION_SALT: continuationSalt} : {})};
  const run = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV12.ts")], {cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
  if (run.status !== 0) throw new Error(`Counterfactual branch failed:\n${run.stderr || run.stdout}`);
}
function registrySourceFor(directory: string): string {
  const snapshot = sourceState.registry?.snapshot ? path.resolve(directory, sourceState.registry.snapshot) : "";
  if (snapshot && fs.existsSync(path.join(snapshot, "registry-manifest.json"))) return snapshot;
  const current = path.resolve("data/draft"), restored = createRegistrySnapshot(current, path.join(directory, "config-snapshots"), sourceState.registry?.revision);
  if (restored.hash !== sourceState.fingerprint.registryHash) throw new Error("Source registry snapshot is missing and the current registry hash does not match");
  return restored.directory;
}
function cloneSource(target: string): void {
  fs.mkdirSync(target, {recursive: true});
  for (const entry of fs.readdirSync(source, {withFileTypes: true})) {
    if (entry.name === ".run.lock") continue;
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (entry.isDirectory()) linkTree(from, to);
    else fs.copyFileSync(from, to);
  }
}
function linkTree(from: string, to: string): void {
  fs.mkdirSync(to, {recursive: true});
  for (const entry of fs.readdirSync(from, {withFileTypes: true})) {
    const sourceFile = path.join(from, entry.name), targetFile = path.join(to, entry.name);
    if (entry.isDirectory()) linkTree(sourceFile, targetFile);
    else try { fs.linkSync(sourceFile, targetFile); } catch { fs.copyFileSync(sourceFile, targetFile); }
  }
}
function verifySourcePrefix(branch: string): boolean {
  for (let season = 1; season <= sourceState.completedSeason; season += 1) for (const name of ["season.json", "evolution.json"]) if (digestFile(path.join(source, `season-${String(season).padStart(2, "0")}`, name)) !== digestFile(path.join(branch, `season-${String(season).padStart(2, "0")}`, name))) return false;
  return true;
}
function prepareOutput(): void {
  if (fs.existsSync(out)) throw new Error(`Counterfactual output exists: ${out}`);
  if (out === source || source.startsWith(`${out}${path.sep}`) || out.startsWith(`${source}${path.sep}`)) throw new Error("Counterfactual output must be separate from its source");
  fs.mkdirSync(out, {recursive: true});
}
function requiredManager(state: DynastyState, id: string): ManagerState { const manager = state.managers.find(entry => entry.id === id); if (!manager) throw new Error(`Missing manager ${id}`); return manager; }
function requiredSeason(manager: ManagerState, season: number) { const value = manager.seasons.find(entry => entry.season === season); if (!value) throw new Error(`Missing season ${season} for ${manager.id}`); return value; }
function result(manager: ManagerState, seasons: Array<ReturnType<typeof requiredSeason>>) { const final = seasons.at(-1)!; return {lineageId: manager.lineage.lineageId, points: sum(seasons.map(season => season.points)), rank: final.rank, champion: final.champion, titles: manager.titles, cash: manager.cash}; }
function compareDecisionEffects(experimentRoot: string, controlRoot: string, season: number, managerId: string) {
  const seasonName = `season-${String(season).padStart(2, "0")}`;
  const experimentLedger = targetLedger(path.join(experimentRoot, seasonName, "decision-ledger.json"), managerId), controlLedger = targetLedger(path.join(controlRoot, seasonName, "decision-ledger.json"), managerId);
  const experimentSelections = ledgerSelections(experimentLedger), controlSelections = ledgerSelections(controlLedger), ledgerKeys = new Set([...experimentSelections.keys(), ...controlSelections.keys()]);
  let ledgerCompared = 0, ledgerSelectionDifferences = 0, ledgerRecordSetDifferences = 0;
  for (const key of ledgerKeys) { const left = experimentSelections.get(key), right = controlSelections.get(key); if (left === undefined || right === undefined) ledgerRecordSetDifferences += 1; else { ledgerCompared += 1; if (left !== right) ledgerSelectionDifferences += 1; } }
  const experimentSignals = programSignals(experimentLedger), controlSignals = programSignals(controlLedger), signalLength = Math.min(experimentSignals.length, controlSignals.length);
  let programSignalDifferences = Math.abs(experimentSignals.length - controlSignals.length);
  for (let index = 0; index < signalLength; index += 1) if (Math.abs(experimentSignals[index] - controlSignals[index]) > 1e-9) programSignalDifferences += 1;
  const experimentBattle = battleSelections(path.join(experimentRoot, seasonName, "battles"), managerId), controlBattle = battleSelections(path.join(controlRoot, seasonName, "battles"), managerId), battleKeys = new Set([...experimentBattle.keys(), ...controlBattle.keys()]);
  let battleCompared = 0, battleChoiceDifferences = 0, battleRecordSetDifferences = 0;
  for (const key of battleKeys) { const left = experimentBattle.get(key), right = controlBattle.get(key); if (left === undefined || right === undefined) battleRecordSetDifferences += 1; else { battleCompared += 1; if (left !== right) battleChoiceDifferences += 1; } }
  return {ledgerCompared, ledgerSelectionDifferences, ledgerRecordSetDifferences, programSignalsCompared: signalLength, programSignalDifferences, battleCompared, battleChoiceDifferences, battleRecordSetDifferences};
}
function targetLedger(file: string, managerId: string): any[] { const value = read<any>(file), records = Array.isArray(value) ? value : value.records ?? []; return records.filter((record: any) => record.actor === managerId); }
function ledgerSelections(records: any[]): Map<string, string> { const counts = new Map<string, number>(); return new Map(records.map(record => { const base = String(record.context?.whiteBoxShadow?.decisionId ?? `${record.stage}|${record.decision}|${record.context?.seriesId ?? ""}`), occurrence = counts.get(base) ?? 0; counts.set(base, occurrence + 1); return [`${base}#${occurrence}`, JSON.stringify(record.selected)] as const; })); }
function programSignals(records: any[]): number[] { const values: number[] = []; const visit = (value: any): void => { if (!value || typeof value !== "object") return; if (typeof value.id === "string" && value.id.endsWith(".program") && typeof value.value === "number") values.push(value.value); if (typeof value.programAdjustment === "number") values.push(value.programAdjustment); for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child); }; records.forEach(visit); return values; }
function battleSelections(directory: string, managerId: string): Map<string, string> { const output = new Map<string, string>(); if (!fs.existsSync(directory)) return output; for (const file of filesNamed(directory, new Set(["ai-decisions.json", "ai-decisions.json.gz"]))) { const records = readCompressedJson<any[]>(file).filter(record => record.personalityId === managerId); records.forEach((record, index) => output.set(`${path.relative(directory, file).replaceAll("\\", "/").replace(/\.gz$/, "")}:${record.playerId}:${index}`, String(record.selected))); } return output; }
function filesNamed(directory: string, names: Set<string>): string[] { return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? filesNamed(path.join(directory, entry.name), names) : names.has(entry.name) ? [path.join(directory, entry.name)] : []); }
function readCompressedJson<T>(file: string): T { const source = fs.readFileSync(file); return JSON.parse((file.endsWith(".gz") ? zlib.gunzipSync(source) : source).toString("utf8")) as T; }
function markdown(value: typeof summary): string { const effects = value.decisionEffects; return `# Shadow program counterfactual\n\n- Source season: ${value.sourceSeason}\n- Activation/evaluation season: ${value.activationSeason}/${value.evaluationSeason}\n- Evaluation horizon: ${value.horizonSeasons} seasons\n- Continuation environment: ${value.continuationSalt ?? "source-default"}\n- Manager: ${value.isolatedDifference.managerId}\n- Operator mutation: ${value.isolatedDifference.operatorMutations.map(mutation => `\`${mutation}\``).join(", ") || "unavailable"}\n- Parent program: \`${value.isolatedDifference.parentProgramHash}\`\n- Candidate program: \`${value.isolatedDifference.candidateProgramHash}\`\n- Behavior distance: ${value.isolatedDifference.behaviorDistance.toFixed(6)}\n- Historical opportunity distance: ${value.isolatedDifference.opportunityDistance ?? "unavailable"}\n- Historical choice potential: ${value.isolatedDifference.choicePotential ?? "unavailable"}\n- Prefix verified: ${value.prefixVerified}\n- Program signal differences: ${effects.programSignalDifferences}/${effects.programSignalsCompared}\n- Management decision differences: ${effects.ledgerSelectionDifferences} (+${effects.ledgerRecordSetDifferences} unmatched)\n- Battle choice differences: ${effects.battleChoiceDifferences} (+${effects.battleRecordSetDifferences} unmatched)\n\n| Branch | Cumulative points | Final rank | Final-season champion | Titles | Cash |\n|---|---:|---:|---|---|---:|\n| Experiment | ${value.experiment.points} | ${value.experiment.rank} | ${value.experiment.champion} | ${value.experiment.titles} | ${value.experiment.cash} |\n| Control | ${value.control.points} | ${value.control.rank} | ${value.control.champion} | ${value.control.titles} | ${value.control.cash} |\n\nCumulative point delta: **${value.delta.points}**. Final-rank improvement: **${value.delta.rankImprovement}**.\n`; }
function sumDecisionEffects(left: ReturnType<typeof compareDecisionEffects>, right: ReturnType<typeof compareDecisionEffects>) { return Object.fromEntries(Object.keys(left).map(key => [key, left[key as keyof typeof left] + right[key as keyof typeof right]])) as ReturnType<typeof compareDecisionEffects>; }
function seasonRange(first: number, last: number): number[] { return Array.from({length: last - first + 1}, (_, index) => first + index); }
function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0); }
function digestFile(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function write(file: string, value: unknown): void { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integerOption(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`); return value; }
