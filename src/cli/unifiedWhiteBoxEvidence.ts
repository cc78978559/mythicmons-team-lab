import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {buildUnifiedEvidencePlan, unifiedEvidenceMarkdown, type UnifiedEvidenceCase, type UnifiedEvidencePlan} from "../ai/whiteBox/unifiedEvidence";
import {compactWhiteBoxRun, type WhiteBoxRetentionTrace} from "../ai/whiteBox/retention";

type RunStatus = "complete" | "failed";
interface ExperimentRun {caseId: string; status: RunStatus; directory: string; startedAt: string; completedAt: string; retention?: WhiteBoxRetentionTrace[]; error?: string}
interface Manifest {
  schemaVersion: 1;
  config: {inputs: string[]; maximumCases: number; maximumPerDomain: number; minimumImpact: number; maximumExperiments: number; maximumOutputMb: number; minimumFreeGb: number; followupSeasons: number};
  plan: UnifiedEvidencePlan;
  runs: ExperimentRun[];
  stopReason: string | null;
}

const args = process.argv.slice(2), root = process.cwd();
const inputs = option("--inputs", "output/draft-league-v12").split(",").map(value => path.resolve(value.trim())).filter(Boolean);
const out = path.resolve(option("--out", "output/unified-whitebox-evidence"));
const maximumCases = integerOption("--max-cases", 60, 1, 10000), maximumPerDomain = integerOption("--max-per-domain", 10, 1, 1000), minimumImpact = numberOption("--min-impact", 0, 0, 1e9);
const maximumExperiments = integerOption("--max-experiments", 1, 1, 100), maximumOutputMb = integerOption("--max-output-mb", 1024, 10, 102400), minimumFreeGb = numberOption("--min-free-gb", 10, 0, 10000), followupSeasons = integerOption("--followup-seasons", 1, 1, 10);
const config = {inputs, maximumCases, maximumPerDomain, minimumImpact, maximumExperiments, maximumOutputMb, minimumFreeGb, followupSeasons};
fs.mkdirSync(out, {recursive: true});
const manifestPath = path.join(out, "evidence-manifest.json"), previous = fs.existsSync(manifestPath) ? read<Manifest>(manifestPath) : null;
if (previous && JSON.stringify(previous.config) !== JSON.stringify(config)) throw new Error("Unified evidence configuration differs from the existing manifest; use a new --out directory");
const plan = buildUnifiedEvidencePlan(inputs, {maximumCases, maximumPerDomain, minimumImpact});
const manifest: Manifest = {schemaVersion: 1, config, plan, runs: previous?.runs ?? [], stopReason: null};
writePlan();

if (args.includes("--run")) {
  const completed = new Set(manifest.runs.filter(run => run.status === "complete").map(run => run.caseId));
  const queue = plan.cases.filter(entry => entry.selected && entry.status === "executable" && entry.runner === "general" && !completed.has(entry.id)).slice(0, maximumExperiments);
  for (const entry of queue) {
    const outputMb = directorySize(out) / 1048576, freeGb = freeBytes(out) / 1073741824;
    if (outputMb >= maximumOutputMb) { manifest.stopReason = `output-budget:${round(outputMb)}MB/${maximumOutputMb}MB`; break; }
    if (freeGb < minimumFreeGb) { manifest.stopReason = `disk-reserve:${round(freeGb)}GB/${minimumFreeGb}GB`; break; }
    runExperiment(entry);
  }
  if (!queue.length) manifest.stopReason = "no-executable-selected-cases";
  writePlan();
}

const summary = {
  selected: plan.metrics.selected,
  executable: plan.cases.filter(entry => entry.selected && entry.status === "executable").length,
  completed: manifest.runs.filter(run => run.status === "complete").length,
  failed: manifest.runs.filter(run => run.status === "failed").length,
  outputMb: round(directorySize(out) / 1048576),
  stopReason: manifest.stopReason,
  manifest: manifestPath,
};
write(path.join(out, "evidence-summary.json"), summary);
console.log(JSON.stringify(summary, null, 2));

function runExperiment(entry: UnifiedEvidenceCase): void {
  const directory = path.join(out, "experiments", entry.id), startedAt = new Date().toISOString();
  if (fs.existsSync(directory)) throw new Error(`Untracked experiment directory exists: ${directory}`);
  try {
    const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "counterfactualWhiteBox.ts"), "--source", entry.root, "--out", directory, "--case-index", String(entry.reviewIndex), "--followup-seasons", String(followupSeasons)], {cwd: root, env: {...process.env}, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Counterfactual exited ${result.status}`);
    const retention = [path.join(directory, "incumbent"), path.join(directory, "whitebox")].map(branch => compactWhiteBoxRun(branch));
    manifest.runs.push({caseId: entry.id, status: "complete", directory, startedAt, completedAt: new Date().toISOString(), retention});
    writePlan();
  } catch (error) {
    safeRemove(directory);
    manifest.runs.push({caseId: entry.id, status: "failed", directory, startedAt, completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error)});
    manifest.stopReason = `experiment-failed:${entry.id}`;
    writePlan();
    throw error;
  }
}

function writePlan(): void {
  write(manifestPath, manifest);
  fs.writeFileSync(path.join(out, "evidence-plan.md"), unifiedEvidenceMarkdown(plan), "utf8");
}
function safeRemove(directory: string): void { const resolved = path.resolve(directory); if (!resolved.startsWith(`${path.resolve(out)}${path.sep}`) || resolved === path.resolve(out)) throw new Error(`Unsafe experiment cleanup target: ${resolved}`); fs.rmSync(resolved, {recursive: true, force: true}); }
function directorySize(directory: string): number { if (!fs.existsSync(directory)) return 0; let total = 0; for (const entry of fs.readdirSync(directory, {withFileTypes: true})) { const target = path.join(directory, entry.name); total += entry.isDirectory() ? directorySize(target) : fs.statSync(target).size; } return total; }
function freeBytes(directory: string): number { return Number(fs.statfsSync(directory).bavail) * Number(fs.statfsSync(directory).bsize); }
function write(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integerOption(name: string, fallback: number, min: number, max: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function numberOption(name: string, fallback: number, min: number, max: number): number { const value = Number(option(name, String(fallback))); if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function round(value: number): number { return Math.round(value * 100) / 100; }
