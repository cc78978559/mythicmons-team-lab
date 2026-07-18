import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import {aggregateStrategyProgramEvolution, strategyProgramEvolutionMarkdown, type StrategyProgramCounterfactualSample} from "../ai/whiteBox/strategyProgramAggregation";
import {compactWhiteBoxRun, type WhiteBoxRetentionTrace} from "../ai/whiteBox/retention";

type RunStatus = "running" | "no-candidate" | "complete" | "failed";
type RetentionPolicy = "audit-summary" | "full";
interface SeedRun {seed: string; status: RunStatus; baseline: string; experiment?: string; completedSeasons: number; candidates: number; managerId?: string; durationMs: number; retention?: WhiteBoxRetentionTrace[]; error?: string}
interface Manifest {
  schemaVersion: 1;
  config: {targetSamples: number; minimumSeeds: number; maximumBaselineSeasons: number; horizonSeasons: number; maximumOutputMb: number; retention: RetentionPolicy; managers: number; pairs: number; pool: number; auctionLots: number; rounds: number; maxTurns: number};
  seeds: SeedRun[];
  stopReason?: string;
}
interface CandidatePackage {candidates?: Array<{managerId: string; programBehaviorDistance: number}>}
interface CounterfactualSummary {
  schemaVersion: 1; seed: string; sourceVerified: boolean; sourceSeason: number; activationSeason: number; evaluationSeason: number; horizonSeasons: number; prefixVerified: boolean;
  isolatedDifference: {managerId: string; parentProgramHash: string; candidateProgramHash: string; behaviorDistance: number; opportunityDistance: number | null; choicePotential: number | null; operatorMutations: string[]};
  decisionEffects: StrategyProgramCounterfactualSample["decisionEffects"];
  delta: {points: number; rankImprovement: number; titles: number; cash: number};
}

const args = process.argv.slice(2), root = process.cwd(), out = path.resolve(option("--out", "output/strategy-program-evolution-sampler"));
const targetSamples = integerOption("--target-samples", 10, 1, 1000), minimumSeeds = integerOption("--minimum-seeds", Math.min(10, targetSamples), 1, targetSamples);
const maximumBaselineSeasons = integerOption("--baseline-seasons", 4, 2, 20), maximumOutputMb = integerOption("--max-output-mb", 1024, 25, 102400);
const horizonSeasons = integerOption("--horizon", 2, 2, 2);
const retention = retentionOption("--retention", "audit-summary");
const managers = integerOption("--managers", 6, 4, 30), pairs = integerOption("--pairs", 1, 1, 20), pool = integerOption("--pool", 100, 40, 2000), auctionLots = integerOption("--auction-lots", 10, 0, 500), rounds = integerOption("--rounds", 1, 1, 20), maxTurns = integerOption("--max-turns", 80, 20, 300);
const candidateSeeds = option("--seeds", Array.from({length: 40}, (_, index) => `strategy-program-${String(index + 1).padStart(3, "0")}`).join(",")).split(",").map(value => value.trim()).filter(Boolean);
const config: Manifest["config"] = {targetSamples, minimumSeeds, maximumBaselineSeasons, horizonSeasons, maximumOutputMb, retention, managers, pairs, pool, auctionLots, rounds, maxTurns};
const manifestFile = path.join(out, "strategy-program-sampler-manifest.json");
fs.mkdirSync(out, {recursive: true});
let manifest: Manifest = fs.existsSync(manifestFile) ? read<Manifest>(manifestFile) : {schemaVersion: 1, config, seeds: []};
if (JSON.stringify(manifest.config) !== JSON.stringify(config)) {
  const previous = manifest.config;
  const immutable = (value: Manifest["config"]) => ({...value, targetSamples: 0, minimumSeeds: 0});
  const extendsEvidenceTarget = JSON.stringify(immutable(previous)) === JSON.stringify(immutable(config)) && targetSamples >= previous.targetSamples && minimumSeeds >= previous.minimumSeeds;
  if (!extendsEvidenceTarget) throw new Error("Sampler configuration differs from its manifest; only evidence targets may increase in place");
  manifest.config = config;
  manifest.stopReason = undefined;
}
save();

if (args.includes("--run")) {
  for (const interrupted of manifest.seeds.filter(entry => entry.status === "running")) cleanupSeed(interrupted.seed);
  manifest.seeds = manifest.seeds.filter(entry => entry.status !== "running");
  if (args.includes("--retry-failed")) {
    for (const failed of manifest.seeds.filter(entry => entry.status === "failed")) cleanupSeed(failed.seed);
    manifest.seeds = manifest.seeds.filter(entry => entry.status !== "failed");
  }
  save();
}
if (args.includes("--run")) for (const seed of candidateSeeds) {
  if (manifest.seeds.some(entry => entry.seed === seed)) continue;
  const currentSamples = loadSamples();
  if (currentSamples.length >= targetSamples && new Set(currentSamples.map(sample => sample.seed)).size >= minimumSeeds) { manifest.stopReason = "evidence-target-reached"; save(); break; }
  if (directorySize(out) / 1048576 > maximumOutputMb) { manifest.stopReason = "output-limit"; save(); throw new Error(`Sampler output exceeded ${maximumOutputMb} MB`); }
  const started = Date.now(), seedRoot = path.join(out, "seeds", safe(seed)), baseline = path.join(seedRoot, "baseline"), experiment = path.join(seedRoot, "counterfactual");
  try {
    if (fs.existsSync(seedRoot)) throw new Error(`Untracked seed directory already exists: ${seedRoot}`);
    fs.mkdirSync(seedRoot, {recursive: true});
    manifest.seeds.push({seed, status: "running", baseline, completedSeasons: 0, candidates: 0, durationMs: 0}); save();
    const candidate = findCandidate(seed, baseline);
    if (!candidate) {
      const compacted = compact([baseline]);
      finish({seed, status: "no-candidate", baseline, completedSeasons: completedSeason(baseline), candidates: 0, durationMs: Date.now() - started, retention: compacted});
      process.stdout.write(`strategy-program ${seed}: no semantic shadow winner in ${maximumBaselineSeasons} seasons\n`);
      continue;
    }
    run([path.join(root, "src", "cli", "counterfactualShadowProgram.ts"), "--source", baseline, "--out", experiment, "--manager", candidate.managerId, "--horizon", String(horizonSeasons)], process.env, `Counterfactual ${seed}`);
    const result = read<CounterfactualSummary>(path.join(experiment, "counterfactual-summary.json"));
    if (result.seed !== seed || result.horizonSeasons !== horizonSeasons || result.evaluationSeason !== result.sourceSeason + horizonSeasons || result.isolatedDifference.managerId !== candidate.managerId || result.isolatedDifference.behaviorDistance <= 0 || result.isolatedDifference.opportunityDistance === null || result.isolatedDifference.choicePotential === null || !result.isolatedDifference.operatorMutations.some(mutation => mutation.startsWith("program."))) throw new Error("Counterfactual summary does not match the selected opportunity-adjusted candidate");
    const compacted = compact([baseline, path.join(experiment, "experiment"), path.join(experiment, "control")]);
    finish({seed, status: "complete", baseline, experiment, completedSeasons: result.sourceSeason, candidates: candidate.count, managerId: candidate.managerId, durationMs: Date.now() - started, retention: compacted});
    process.stdout.write(`strategy-program ${seed}: paired season complete for ${candidate.managerId}\n`);
  } catch (error) {
    finish({seed, status: "failed", baseline, completedSeasons: fs.existsSync(path.join(baseline, "dynasty-state.json")) ? completedSeason(baseline) : 0, candidates: 0, durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error)}); throw error;
  }
}

const samples = loadSamples();
const formalMinimumSamples = Math.max(10, targetSamples), formalMinimumSeeds = Math.max(10, minimumSeeds);
let aggregate: ReturnType<typeof aggregateStrategyProgramEvolution> | null = null;
if (samples.length) {
  aggregate = aggregateStrategyProgramEvolution(samples, {minimumSamples: formalMinimumSamples, minimumSeeds: Math.min(formalMinimumSeeds, formalMinimumSamples), minimumDecisivePairs: Math.min(4, formalMinimumSamples), minimumDecisiveSeeds: Math.min(4, formalMinimumSeeds, formalMinimumSamples)});
  write(path.join(out, "strategy-program-evidence.json"), aggregate);
  fs.writeFileSync(path.join(out, "strategy-program-evidence.md"), strategyProgramEvolutionMarkdown(aggregate), "utf8");
}
const uniqueSeeds = new Set(samples.map(sample => sample.seed)).size;
const summary = {schemaVersion: 1, conclusion: aggregate?.conclusion ?? "not-started", progress: {samples: samples.length, seeds: uniqueSeeds, targetSamples, minimumSeeds, complete: samples.length >= targetSamples && uniqueSeeds >= minimumSeeds}, attemptedSeeds: manifest.seeds.length, noCandidate: manifest.seeds.filter(entry => entry.status === "no-candidate").length, failed: manifest.seeds.filter(entry => entry.status === "failed").length, stopReason: manifest.stopReason, retentionRemovedMb: round(manifest.seeds.flatMap(entry => entry.retention ?? []).reduce((sum, entry) => sum + entry.removedBytes, 0) / 1048576), outputMb: round(directorySize(out) / 1048576), manifest: manifestFile};
write(path.join(out, "strategy-program-sampler-summary.json"), summary);
console.log(JSON.stringify(summary, null, 2));

function findCandidate(seed: string, baseline: string): {managerId: string; count: number} | null {
  for (let season = 1; season <= maximumBaselineSeasons; season += 1) {
    runSeason(seed, baseline, season);
    const packageFile = path.join(baseline, `season-${String(season).padStart(2, "0")}`, "evolution-shadow-candidates.json");
    if (!fs.existsSync(packageFile)) continue;
    const candidates = (read<CandidatePackage>(packageFile).candidates ?? []).filter(candidate => candidate.programBehaviorDistance > 0).sort((left, right) => candidateOrder(seed, left.managerId).localeCompare(candidateOrder(seed, right.managerId)));
    if (candidates.length) return {managerId: candidates[0].managerId, count: candidates.length};
  }
  return null;
}
function runSeason(seed: string, baseline: string, season: number): void {
  const env = {...process.env, V12_OUT: baseline, V12_SEED: seed, V12_SEASONS: String(season), V12_RESUME: season > 1 ? "true" : "false", V12_ALLOW_CODE_UPGRADE: season > 1 ? "true" : "false", V12_MANAGER_LIMIT: String(managers), V12_PAIRS: String(pairs), V12_POOL_SIZE: String(pool), V12_AUCTION_LOTS: String(auctionLots), V12_REGULAR_ROUNDS: String(rounds), V12_MAX_TURNS: String(maxTurns), V12_MIN_ROSTER: "6", V12_MAX_ROSTER: "6", V12_REGISTRY_SOURCE: path.resolve(option("--registry", "data/draft")), V12_REGISTRY_REVISION: `strategy-program-sampler:${seed}`, V12_EVOLUTION_MODE: "punctuated", V12_EVOLUTION_POLICY: "shadow", V12_EVOLUTION_SHOCK: "1", V12_EVOLUTION_MAX_BURSTS: "2", V12_EVOLUTION_MIN_CANDIDATES: "4", V12_EVOLUTION_MAX_CANDIDATES: "8", V12_EVIDENCE_RETENTION: "compact", V12_EVIDENCE_SAMPLE_RATE: "0"};
  run([path.join(root, "src", "cli", "draftLeagueV12.ts")], env, `Baseline ${seed} season ${season}`);
}
function loadSamples(): StrategyProgramCounterfactualSample[] {
  return manifest.seeds.filter(entry => entry.status === "complete" && entry.experiment).map(entry => {
    const value = read<CounterfactualSummary>(path.join(entry.experiment!, "counterfactual-summary.json"));
    if (value.isolatedDifference.opportunityDistance === null || value.isolatedDifference.choicePotential === null) throw new Error(`Sample ${value.seed} predates opportunity-adjusted evidence; use a new sampler output`);
    return {seed: value.seed, managerId: value.isolatedDifference.managerId, sourceSeason: value.sourceSeason, activationSeason: value.activationSeason, evaluationSeason: value.evaluationSeason, horizonSeasons: value.horizonSeasons, sourceVerified: value.sourceVerified, prefixVerified: value.prefixVerified, parentProgramHash: value.isolatedDifference.parentProgramHash, candidateProgramHash: value.isolatedDifference.candidateProgramHash, behaviorDistance: value.isolatedDifference.behaviorDistance, opportunityDistance: value.isolatedDifference.opportunityDistance, choicePotential: value.isolatedDifference.choicePotential, operatorMutations: value.isolatedDifference.operatorMutations, decisionEffects: value.decisionEffects, delta: value.delta};
  });
}
function compact(directories: string[]): WhiteBoxRetentionTrace[] { if (retention === "full") return []; return directories.filter(directory => fs.existsSync(path.join(directory, "dynasty-state.json"))).map(directory => compactWhiteBoxRun(directory)); }
function run(cliArgs: string[], env: NodeJS.ProcessEnv, label: string): void { const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), ...cliArgs], {cwd: root, env: {...env}, encoding: "utf8", maxBuffer: 64 * 1024 * 1024}); if (result.status !== 0) throw new Error(`${label} failed:\n${result.stderr || result.stdout}`); }
function completedSeason(directory: string): number { return read<{completedSeason: number}>(path.join(directory, "dynasty-state.json")).completedSeason; }
function finish(value: SeedRun): void { const index = manifest.seeds.findIndex(entry => entry.seed === value.seed); if (index < 0) throw new Error(`Missing running manifest entry for ${value.seed}`); manifest.seeds[index] = value; save(); }
function cleanupSeed(seed: string): void { const seedsRoot = path.resolve(out, "seeds"), target = path.resolve(seedsRoot, safe(seed)); if (target === seedsRoot || !target.startsWith(`${seedsRoot}${path.sep}`)) throw new Error(`Unsafe sampler recovery target: ${target}`); fs.rmSync(target, {recursive: true, force: true}); }
function candidateOrder(seed: string, managerId: string): string { return crypto.createHash("sha256").update(`${seed}:${managerId}`).digest("hex"); }
function save(): void { write(manifestFile, manifest); }
function write(file: string, value: unknown): void { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function directorySize(directory: string): number { if (!fs.existsSync(directory)) return 0; let total = 0; for (const entry of fs.readdirSync(directory, {withFileTypes: true})) { const target = path.join(directory, entry.name); total += entry.isDirectory() ? directorySize(target) : fs.statSync(target).size; } return total; }
function safe(value: string): string { return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "seed"; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integerOption(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`); return value; }
function retentionOption(name: string, fallback: RetentionPolicy): RetentionPolicy { const value = option(name, fallback); if (value !== "audit-summary" && value !== "full") throw new Error(`${name} must be audit-summary or full`); return value; }
function round(value: number): number { return Math.round(value * 100) / 100; }
