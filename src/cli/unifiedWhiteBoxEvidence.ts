import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {buildUnifiedEvidencePlan, unifiedEvidenceMarkdown, type UnifiedEvidenceCase, type UnifiedEvidencePlan, type UnifiedEvidenceReplica} from "../ai/whiteBox/unifiedEvidence";
import {aggregateUnifiedBattleEvidence, aggregateUnifiedEvidence, aggregateUnifiedMemoryEvidence,aggregateUnifiedProgramEvolution, unifiedEvidenceAggregateMarkdown, type AnyUnifiedEvidenceAggregate} from "../ai/whiteBox/unifiedAggregation";
import type {WhiteBoxCounterfactualSample} from "../ai/whiteBox/counterfactualBatch";
import type {BattleCounterfactualSample} from "../ai/whiteBox/battleAggregation";
import type {TacticalMemoryAblationSample} from "../ai/whiteBox/tacticalMemoryAblation";
import type {StrategyProgramCounterfactualSample} from "../ai/whiteBox/strategyProgramAggregation";
import {compactWhiteBoxRun, type WhiteBoxRetentionTrace} from "../ai/whiteBox/retention";
import {acquireNamedRunLock} from "../draft/runLock";

type RunStatus = "complete" | "failed";
interface ExperimentRun {hypothesisId: string; replicaId: string; seed: string; status: RunStatus; directory: string; startedAt: string; completedAt: string; retention?: WhiteBoxRetentionTrace[]; error?: string}
interface Manifest {
  schemaVersion: 4;
  config: {inputs: string[]; portfolioBidScreens:string[]; maximumCases: number; maximumPerDomain: number; minimumImpact: number; maximumExperiments: number; maximumOutputMb: number; minimumFreeGb: number; followupSeasons: number; activationSamples: number; activationSeeds: number};
  plan: UnifiedEvidencePlan;
  runs: ExperimentRun[];
  stopReason: string | null;
}

const args = process.argv.slice(2), root = process.cwd();
const inputs = option("--inputs", "output/draft-league-v12").split(",").map(value => path.resolve(value.trim())).filter(Boolean);
const portfolioBidScreens=option("--portfolio-bid-screens","").split(",").map(value=>value.trim()).filter(Boolean).map(value=>path.resolve(value));
const out = path.resolve(option("--out", "output/unified-whitebox-evidence"));
const maximumCases = integerOption("--max-cases", 60, 1, 10000), maximumPerDomain = integerOption("--max-per-domain", 10, 1, 1000), minimumImpact = numberOption("--min-impact", 0, 0, 1e9);
const maximumExperiments = integerOption("--max-experiments", 1, 1, 100), maximumOutputMb = integerOption("--max-output-mb", 1024, 10, 102400), minimumFreeGb = numberOption("--min-free-gb", 10, 0, 10000), followupSeasons = integerOption("--followup-seasons", 1, 1, 10);
const activationSamples = integerOption("--activation-samples", 30, 10, 1000), activationSeeds = integerOption("--activation-seeds", 10, 5, activationSamples);
const config = {inputs,portfolioBidScreens, maximumCases, maximumPerDomain, minimumImpact, maximumExperiments, maximumOutputMb, minimumFreeGb, followupSeasons, activationSamples, activationSeeds};
fs.mkdirSync(out, {recursive: true});
const workflowLock = acquireNamedRunLock(out, ".unified-evidence.lock", {workflow: "unified-whitebox-evidence"});
process.once("exit", () => workflowLock.release());
const manifestPath = path.join(out, "evidence-manifest.json"), previousRaw = fs.existsSync(manifestPath) ? read<any>(manifestPath) : null;
if (previousRaw?.schemaVersion === 1 && previousRaw.runs?.length) throw new Error("Schema-v1 evidence manifest has experiment runs and cannot be migrated safely; use a new --out directory");
if (previousRaw && ![2,3,4].includes(previousRaw.schemaVersion)) throw new Error(`Unsupported evidence manifest schema: ${previousRaw.schemaVersion}`);
const previous = [2,3,4].includes(previousRaw?.schemaVersion) ? previousRaw as Manifest : null;
if (previous && JSON.stringify(previous.config) !== JSON.stringify(config)) throw new Error("Unified evidence configuration differs from the existing manifest; use a new --out directory");
const plan = buildUnifiedEvidencePlan(inputs, {maximumCases, maximumPerDomain, minimumImpact,portfolioBidScreens,historicalReplayFollowupSeasons:followupSeasons});
const manifest: Manifest = {schemaVersion: 4, config, plan, runs: previous?.runs ?? [], stopReason: null};
writePlan();

if (args.includes("--run")) {
  const completed = new Set(manifest.runs.filter(run => run.status === "complete").map(run => run.replicaId));
  const queue = plan.cases.filter(entry => entry.selected && entry.status === "executable" && entry.runner !== null).flatMap(hypothesis => oneReplicaPerSeed(hypothesis).filter(replica => !completed.has(replica.id)).map(replica => ({hypothesis, replica}))).slice(0, maximumExperiments);
  for (const {hypothesis, replica} of queue) {
    const outputMb = directorySize(out) / 1048576, freeGb = freeBytes(out) / 1073741824;
    if (outputMb >= maximumOutputMb) { manifest.stopReason = `output-budget:${round(outputMb)}MB/${maximumOutputMb}MB`; break; }
    if (freeGb < minimumFreeGb) { manifest.stopReason = `disk-reserve:${round(freeGb)}GB/${minimumFreeGb}GB`; break; }
    runExperiment(hypothesis, replica);
  }
  if (!queue.length) manifest.stopReason = "no-executable-selected-replicas";
  writePlan();
}

const aggregates = refreshAggregates();
const summary = {
  selectedHypotheses: plan.metrics.selected,
  executableHypotheses: plan.cases.filter(entry => entry.selected && entry.status === "executable").length,
  gateReasons: plan.metrics.gateReasons,
  selectedGateReasons: plan.metrics.selectedGateReasons,
  crossSeedHypotheses: plan.metrics.crossSeedHypotheses,
  completedExperiments: manifest.runs.filter(run => run.status === "complete").length,
  failedExperiments: manifest.runs.filter(run => run.status === "failed").length,
  aggregateStages: countBy(aggregates.map(value => value.stage)),
  activationCandidates: aggregates.filter(value => value.activationEligible).length,
  outputMb: round(directorySize(out) / 1048576),
  stopReason: manifest.stopReason,
  manifest: manifestPath,
};
write(path.join(out, "evidence-summary.json"), summary);
console.log(JSON.stringify(summary, null, 2));

function runExperiment(hypothesis: UnifiedEvidenceCase, replica: UnifiedEvidenceReplica): void {
  const directory = path.join(out, "experiments", hypothesis.id, replica.id), startedAt = new Date().toISOString();
  if (fs.existsSync(directory)) throw new Error(`Untracked experiment directory exists: ${directory}`);
  try {
    const command = replica.runner === "lineup" ? lineupCommand(replica, directory) : replica.runner === "battle" ? battleCommand(replica, directory) : replica.runner === "memory" ? memoryCommand(replica, directory) : replica.runner==="learning"?learningCommand(replica,directory):replica.runner==="program-evolution"?programEvolutionCommand(replica,directory):replica.runner==="evolution"?evolutionCommand(replica,directory):replica.runner==="acquisition"?acquisitionCommand(replica,directory):replica.runner==="bid"?bidCommand(replica,directory): [path.join(root, "src", "cli", "counterfactualWhiteBox.ts"), "--source", replica.root, "--out", directory, "--case-index", String(replica.reviewIndex), "--followup-seasons", String(followupSeasons)];
    const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), ...command], {cwd: root, env: {...process.env}, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Counterfactual exited ${result.status}`);
    if (replica.runner === "lineup") verifyLineupExperiment(directory, replica);
    const retention = replica.runner === "battle" || replica.runner === "memory" ? undefined : replica.runner==="program-evolution"||replica.runner==="evolution"||replica.runner==="acquisition"||replica.runner==="bid"?[path.join(directory,"experiment"),path.join(directory,"control")].map(branch=>compactWhiteBoxRun(branch)):[path.join(directory, "incumbent"), path.join(directory,replica.runner==="learning"?"candidate":"whitebox")].map(branch => compactWhiteBoxRun(branch));
    manifest.runs.push({hypothesisId: hypothesis.id, replicaId: replica.id, seed: replica.sourceSeed, status: "complete", directory, startedAt, completedAt: new Date().toISOString(), retention});
    writePlan();
  } catch (error) {
    safeRemove(directory);
    manifest.runs.push({hypothesisId: hypothesis.id, replicaId: replica.id, seed: replica.sourceSeed, status: "failed", directory, startedAt, completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error)});
    manifest.stopReason = `experiment-failed:${replica.id}`;
    writePlan();
    throw error;
  }
}

function learningCommand(replica:UnifiedEvidenceReplica,directory:string):string[]{const target=replica.learningTarget;if(!target)throw new Error(`Executable learning replica is incomplete: ${replica.id}`);return[path.join(root,"src","cli","counterfactualWhiteBoxLearning.ts"),"--source",replica.root,"--out",directory,"--manager",target.managerId,"--season",String(target.season),"--followup-seasons",String(followupSeasons)];}
function programEvolutionCommand(replica:UnifiedEvidenceReplica,directory:string):string[]{const target=replica.evolutionTarget;if(!target||target.kind!=="program")throw new Error(`Executable program-evolution replica is incomplete: ${replica.id}`);return[path.join(root,"src","cli","counterfactualShadowProgram.ts"),"--source",replica.root,"--out",directory,"--manager",target.managerId,"--horizon",String(target.horizonSeasons)];}
function evolutionCommand(replica:UnifiedEvidenceReplica,directory:string):string[]{const target=replica.evolutionTarget;if(!target||target.kind!=="full-lineage")throw new Error(`Executable evolution replica is incomplete: ${replica.id}`);return[path.join(root,"src","cli","counterfactualPunctuatedEvolution.ts"),"--source",replica.root,"--out",directory,"--manager",target.managerId];}
function acquisitionCommand(replica:UnifiedEvidenceReplica,directory:string):string[]{const target=replica.acquisitionTarget;if(!target)throw new Error(`Executable acquisition replica is incomplete: ${replica.id}`);return[path.join(root,"src","cli","counterfactualProgramDecision.ts"),"--source",replica.root,"--out",directory,"--decision-id",target.decisionId,"--manager",target.managerId,"--candidate",target.candidateId,"--season",String(target.season),"--followup",String(followupSeasons)];}
function bidCommand(replica:UnifiedEvidenceReplica,directory:string):string[]{const target=replica.bidTarget;if(!target)throw new Error(`Executable bid replica is incomplete: ${replica.id}`);return[path.join(root,"src","cli","counterfactualWhiteBoxBid.ts"),"--source",replica.root,"--out",directory,"--decision-id",target.decisionId,"--manager",target.managerId,"--season",String(target.season),"--followup-seasons",String(followupSeasons)];}

function memoryCommand(replica: UnifiedEvidenceReplica, directory: string): string[] {
  const target=replica.memoryTarget;if(!target)throw new Error(`Executable memory replica is incomplete: ${replica.id}`);
  return [path.join(root,"src","cli","counterfactualTacticalMemory.ts"),"--source-game",target.sourceGame,"--out",directory,"--player",target.playerId,"--candidate-policy",target.candidatePolicy];
}

function battleCommand(replica: UnifiedEvidenceReplica, directory: string): string[] {
  const target = replica.battleTarget;
  if (!target) throw new Error(`Executable battle replica is incomplete: ${replica.id}`);
  return [path.join(root, "src", "cli", "counterfactualWhiteBoxBattle.ts"), "--source-game", target.sourceGame, "--out", directory, "--decision-ordinal", String(target.decisionOrdinal)];
}

function lineupCommand(replica: UnifiedEvidenceReplica, directory: string): string[] {
  const scenario = replica.lineupScenario;
  if (replica.season === null || !scenario) throw new Error(`Executable lineup replica is incomplete: ${replica.id}`);
  return [path.join(root, "src", "cli", "counterfactualWhiteBoxLineup.ts"), "--source", replica.root, "--out", directory, "--decision-id", replica.decisionId, "--manager", replica.actor, "--season", String(replica.season), "--band", String(scenario.band), "--style-limit", String(scenario.styleLimit), "--style-scale", String(scenario.styleScale)];
}

function verifyLineupExperiment(directory: string, replica: UnifiedEvidenceReplica): void {
  const branch = path.join(directory, "whitebox");
  for (const entry of fs.readdirSync(branch, {withFileTypes: true}).filter(value => value.isDirectory() && /^season-\d+$/.test(value.name))) {
    const file = path.join(branch, entry.name, "decision-ledger.json"); if (!fs.existsSync(file)) continue;
    for (const record of read<any>(file).records ?? []) {
      const experiment = record.context?.whiteBoxLineupExperiment;
      if (experiment?.trace?.decisionId !== replica.decisionId) continue;
      if (!experiment.gate?.recommended) throw new Error(`Lineup assist gate changed during replay: ${replica.decisionId}`);
      if (experiment.trace.comparison?.shadow !== replica.shadow) throw new Error(`Lineup scenario selection drifted during replay: ${replica.decisionId}`);
      return;
    }
  }
  throw new Error(`Missing replayed lineup gate: ${replica.decisionId}`);
}

function refreshAggregates(): AnyUnifiedEvidenceAggregate[] {
  const aggregates: AnyUnifiedEvidenceAggregate[] = [], aggregateRoot = path.join(out, "aggregates");
  for (const hypothesis of plan.cases) {
    const runs = manifest.runs.filter(run => run.status === "complete" && run.hypothesisId === hypothesis.id);
    if (!runs.length) continue;
    const aggregate = hypothesis.domain === "battle" ? aggregateUnifiedBattleEvidence(hypothesis.id, runs.map(run => battleSample(run))) : hypothesis.domain === "memory" ? aggregateUnifiedMemoryEvidence(hypothesis.id,runs.map(run=>memorySample(run)),{activationSamples,activationSeeds}):hypothesis.domain==="program-evolution"?aggregateUnifiedProgramEvolution(hypothesis.id,runs.map(run=>programEvolutionSample(run)),{activationSamples,activationSeeds}) : aggregateUnifiedEvidence(hypothesis.id, hypothesis.domain, runs.map(run => hypothesis.domain==="evolution"?evolutionSample(run):managementSample(run)), {activationSamples, activationSeeds});
    aggregates.push(aggregate);
    write(path.join(aggregateRoot, `${hypothesis.id}.json`), aggregate);
    fs.writeFileSync(path.join(aggregateRoot, `${hypothesis.id}.md`), unifiedEvidenceAggregateMarkdown(aggregate), "utf8");
  }
  write(path.join(out, "aggregate-index.json"), {schemaVersion: 1, hypotheses: aggregates.map(value => { const metrics = "battleBatch" in value ? value.battleBatch.metrics : "memoryBatch" in value ? value.memoryBatch.metrics : "programBatch" in value?value.programBatch.metrics:value.batch.metrics; return {id: value.hypothesisId, domain: value.domain, stage: value.stage, conclusion: value.conclusion, samples: metrics.samples, seeds: metrics.seeds, activationEligible: value.activationEligible}; })});
  return aggregates;
}

function managementSample(run: ExperimentRun): WhiteBoxCounterfactualSample { const summary = read<any>(path.join(run.directory, "counterfactual-summary.json")); return {seed: run.seed, caseId: run.replicaId, prefixVerified: Boolean(summary.prefixVerified), comparison: summary.comparison}; }
function battleSample(run: ExperimentRun): BattleCounterfactualSample { const summary = read<any>(path.join(run.directory, "counterfactual-summary.json")); return {seed: run.seed, caseId: run.replicaId, sourceVerified: Boolean(summary.sourceVerified), prefixVerified: Boolean(summary.prefixVerified), playerId: summary.intervention?.playerId, incumbent: summary.incumbent, whitebox: summary.whitebox}; }
function memorySample(run:ExperimentRun):TacticalMemoryAblationSample { const sample=read<TacticalMemoryAblationSample>(path.join(run.directory,"tactical-memory-ablation-sample.json"));return {...sample,seed:run.seed,caseId:run.replicaId}; }
function programEvolutionSample(run:ExperimentRun):StrategyProgramCounterfactualSample{const value=read<any>(path.join(run.directory,"counterfactual-summary.json"));return{seed:run.seed,managerId:value.isolatedDifference.managerId,operator:value.isolatedDifference.operator,sourceSeason:value.sourceSeason,activationSeason:value.activationSeason,evaluationSeason:value.evaluationSeason,horizonSeasons:value.horizonSeasons,sourceVerified:Boolean(value.sourceVerified),prefixVerified:Boolean(value.prefixVerified),parentProgramHash:value.isolatedDifference.parentProgramHash,candidateProgramHash:value.isolatedDifference.candidateProgramHash,behaviorDistance:value.isolatedDifference.behaviorDistance,opportunityDistance:value.isolatedDifference.opportunityDistance,choicePotential:value.isolatedDifference.choicePotential,operatorMutations:value.isolatedDifference.operatorMutations,decisionEffects:value.decisionEffects,delta:value.delta};}
function evolutionSample(run:ExperimentRun):WhiteBoxCounterfactualSample{const value=read<any>(path.join(run.directory,"counterfactual-summary.json")),c=value.comparison,branch=(entry:any)=>({id:c.managerId,cash:entry.cash,contracts:0,payroll:0,titles:entry.titles,totalPoints:entry.points,finalRank:entry.rank,finalPoints:entry.points,finalChampion:Boolean(entry.champion)});return{seed:run.seed,caseId:run.replicaId,prefixVerified:Boolean(value.isolatedDifferenceVerified),comparison:{managerId:c.managerId,interventionSeason:c.activationSeason,finalSeason:c.activationSeason,incumbent:branch(c.control),whitebox:branch(c.experiment),delta:{cash:c.delta.cash,contracts:0,payroll:0,titles:c.delta.titles,totalPoints:c.delta.points,finalRank:-c.delta.rankImprovement,finalPoints:c.delta.points},champions:{incumbent:c.control.champion?[c.managerId]:[],whitebox:c.experiment.champion?[c.managerId]:[]}}};}

function oneReplicaPerSeed(hypothesis: UnifiedEvidenceCase): UnifiedEvidenceReplica[] { const seen = new Set<string>(); return hypothesis.replicas.filter(replica => { if (seen.has(replica.sourceSeed)) return false; seen.add(replica.sourceSeed); return true; }); }
function writePlan(): void { write(manifestPath, manifest); fs.writeFileSync(path.join(out, "evidence-plan.md"), unifiedEvidenceMarkdown(plan), "utf8"); }
function safeRemove(directory: string): void { const resolved = path.resolve(directory); if (!resolved.startsWith(`${path.resolve(out)}${path.sep}`) || resolved === path.resolve(out)) throw new Error(`Unsafe experiment cleanup target: ${resolved}`); fs.rmSync(resolved, {recursive: true, force: true}); }
function directorySize(directory: string): number { if (!fs.existsSync(directory)) return 0; let total = 0; for (const entry of fs.readdirSync(directory, {withFileTypes: true})) { const target = path.join(directory, entry.name); total += entry.isDirectory() ? directorySize(target) : fs.statSync(target).size; } return total; }
function freeBytes(directory: string): number { const stats = fs.statfsSync(directory); return Number(stats.bavail) * Number(stats.bsize); }
function countBy(values: string[]): Record<string, number> { const result: Record<string, number> = {}; for (const value of values) result[value] = (result[value] ?? 0) + 1; return result; }
function write(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integerOption(name: string, fallback: number, min: number, max: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function numberOption(name: string, fallback: number, min: number, max: number): number { const value = Number(option(name, String(fallback))); if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function round(value: number): number { return Math.round(value * 100) / 100; }
