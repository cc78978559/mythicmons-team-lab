import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {acquireNamedRunLock} from "../draft/runLock";

type Stage = "telemetry" | "incubator" | "manager-agendas" | "causal-plan";
interface ResearchManifest {
  schemaVersion: 1;
  source: string;
  seasons: number;
  createdAt: string;
  updatedAt: string;
  activeStage: Stage | null;
  stages: Partial<Record<Stage, {status: "running" | "complete" | "failed"; startedAt: string; completedAt?: string; durationMs?: number; peakControllerRssBytes?: number; error?: string}>>;
  failures: Array<{stage: Stage; at: string; error: string}>;
}

const args = process.argv.slice(2), command = args[0] ?? "status", root = process.cwd();
const out = path.resolve(option("--out", "output/tooling/lineup-research-v6"));
const manifestFile = path.join(out, "research-manifest.json"), summaryFile = path.join(out, "summary.json");
const source = path.resolve(option("--source", "output/official-era-03/league"));
const seasons = integerOption("--seasons", 3, 3, 9);

if (command === "init") initialize();
else if (command === "status") emit(status(loadOrCreate(false)));
else if (command === "report") emit({...status(loadOrCreate(false)), manifest: manifestFile, summary: summaryFile});
else if (command === "continue") continueOne();
else usage();

function initialize(): void {
  if (!fs.existsSync(path.join(source, "dynasty-state.json"))) throw new Error(`League source is missing: ${source}`);
  if (fs.existsSync(manifestFile)) throw new Error(`Research manifest already exists: ${manifestFile}`);
  fs.mkdirSync(out, {recursive: true});
  const now = new Date().toISOString(), manifest: ResearchManifest = {schemaVersion: 1, source, seasons, createdAt: now, updatedAt: now, activeStage: null, stages: {}, failures: []};
  writeManifest(manifest); emit(status(manifest));
}

function continueOne(): void {
  const manifest = loadOrCreate(true), current = status(manifest);
  if (current.blocked.length) throw new Error(`Research is blocked: ${current.blocked.join(", ")}`);
  const stage = current.nextStage;
  if (!stage) { emit(current); return; }
  const lock = acquireNamedRunLock(out, ".lineup-research.lock", {workflow: "lineup-research", stage});
  const started = Date.now();
  try {
    manifest.activeStage = stage; manifest.stages[stage] = {status: "running", startedAt: new Date().toISOString()}; writeManifest(manifest);
    runStage(stage, manifest);
    manifest.stages[stage] = {...manifest.stages[stage]!, status: "complete", completedAt: new Date().toISOString(), durationMs: Date.now() - started, peakControllerRssBytes: process.memoryUsage().rss};
    manifest.activeStage = null; writeManifest(manifest); emit(status(manifest));
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 12000);
    manifest.stages[stage] = {...manifest.stages[stage]!, status: "failed", completedAt: new Date().toISOString(), durationMs: Date.now() - started, peakControllerRssBytes: process.memoryUsage().rss, error: message};
    manifest.failures.push({stage, at: new Date().toISOString(), error: message}); manifest.activeStage = null; writeManifest(manifest); throw error;
  } finally { lock.release(); }
}

function runStage(stage: Stage, manifest: ResearchManifest): void {
  if (stage === "telemetry") run(path.join(root, "src", "cli", "benchmarkLineupRepresentationAccumulation.ts"), ["--source", manifest.source, "--out", telemetryRoot(), "--seasons", String(manifest.seasons), "--publish-source-cache", "--source-cache", option("--source-cache", "output/tooling/shadow-lineup-source-cache")]);
  else if (stage === "incubator") run(path.join(root, "src", "cli", "incubateProspectiveLineupFeatures.ts"), ["--source", telemetryArchive(), "--out", incubatorRoot(), "--permutations", option("--permutations", "2000"), "--max-program-features", option("--max-program-features", "24")]);
  else if (stage === "manager-agendas") run(path.join(root, "src", "cli", "managerResearchAgendas.ts"), ["plan", "--source", manifest.source, "--out", agendasRoot(), "--round", "1", "--registry", candidateRegistry(), "--audit", candidateAudit()]);
  else {
    const selectedHypothesis = selectedManagerHypothesis();
    run(path.join(root, "src", "cli", "planLineupHypothesisStudy.ts"), ["--source", telemetryArchive(), "--registry", candidateRegistry(), "--audit", candidateAudit(), "--hypothesis", selectedHypothesis, "--requested", "24", "--maximum-research-rank", "2", "--research-agendas", path.join(agendasRoot(), "research-agendas.json.gz"), "--out", causalPlanRoot()]);
  }
}

function status(manifest: ResearchManifest): {schemaVersion: 1; status: string; stage: string; nextStage: Stage | null; completed: Stage[]; blocked: string[]; failures: number; source: string; seasons: number; artifacts: Record<string, unknown>; nextCommand: string | null} {
  validateManifest(manifest);
  const blocked: string[] = [];
  if (!fs.existsSync(path.join(manifest.source, "dynasty-state.json"))) blocked.push("source-missing");
  if (manifest.activeStage) blocked.push(`stage-running:${manifest.activeStage}`);
  for (const [stage, record] of Object.entries(manifest.stages)) if (record?.status === "complete" && !stageArtifactValid(stage as Stage)) blocked.push(`artifact-invalid:${stage}`);
  const stages: Stage[] = ["telemetry", "incubator", "manager-agendas", "causal-plan"];
  const completed = stages.filter(stage => manifest.stages[stage]?.status === "complete" && stageArtifactValid(stage));
  const incubator = fs.existsSync(path.join(incubatorRoot(), "summary.json")) ? read<any>(path.join(incubatorRoot(), "summary.json")) : null;
  const candidateCount = Number(incubator?.metrics?.novelPromoted ?? 0);
  const nextStage: Stage | null = blocked.length ? null : !completed.includes("telemetry") ? "telemetry" : !completed.includes("incubator") ? "incubator" : candidateCount <= 0 ? null : !completed.includes("manager-agendas") ? "manager-agendas" : !completed.includes("causal-plan") ? "causal-plan" : null;
  const plan = fs.existsSync(path.join(causalPlanRoot(), "causal-plan.json")) ? read<any>(path.join(causalPlanRoot(), "causal-plan.json")) : null;
  const causalSummaryFile = path.join(out, "causal-study", "causal-summary.json"), causal = fs.existsSync(causalSummaryFile) ? read<any>(causalSummaryFile) : null;
  const approvalEligible = causal?.conclusion === "candidate-for-scoped-policy-study" && causal?.causalScope === "population-causal" && Number(causal?.completed) >= 24 && Number(causal?.failed) === 0;
  const researchStatus = blocked.length ? "blocked" : nextStage ? "ready" : !plan ? "research-complete-no-candidate" : !causal ? "causal-run-ready" : approvalEligible ? "approval-ready" : "research-complete-no-approval";
  const nextCommand = nextStage ? `npm run lineup-research -- continue --out ${quote(out)}` : !plan ? null : !causal ? `npm run shadow:lineup-hypothesis-run -- --source ${quote(manifest.source)} --plan ${quote(path.join(causalPlanRoot(), "causal-plan.json"))} --out ${quote(path.join(out, "causal-study"))}` : approvalEligible ? `npm run release:whitebox-lineup-assist -- --study ${quote(path.join(out, "causal-study"))} --hypotheses ${quote(candidateRegistry())} --hypothesis ${quote(String(plan.hypothesisId))} --out ${quote(path.join(out, "lineup-assist-approval.json"))}` : null;
  const result = {schemaVersion: 1 as const, status: researchStatus, stage: manifest.activeStage ?? completed.at(-1) ?? "initialized", nextStage, completed, blocked, failures: manifest.failures.length, source: manifest.source, seasons: manifest.seasons, artifacts: {telemetry: artifact(telemetryArchive()), incubator: artifact(path.join(incubatorRoot(), "summary.json")), agendas: artifact(path.join(agendasRoot(), "summary.json")), causalPlan: artifact(path.join(causalPlanRoot(), "causal-plan.json")), causalStudy: artifact(causalSummaryFile), promotedHypotheses: candidateCount, selectedHypothesis: plan?.hypothesisId ?? null, causalConclusion: causal?.conclusion ?? null, approvalEligible, evaluatedPrograms: Number(incubator?.searchBudget?.evaluatedPrograms ?? 0), skippedPrograms: Number(incubator?.searchBudget?.skippedPrograms ?? 0)}, nextCommand};
  fs.mkdirSync(out, {recursive: true}); atomicJson(summaryFile, result); return result;
}

function stageArtifactValid(stage: Stage): boolean { try { if (stage === "telemetry") { const value = readGzip<any>(telemetryArchive()); return Array.isArray(value.rows) && value.rows.length > 0 && value.finalSeason - value.firstSeason + 1 >= 3; } if (stage === "incubator") { const value = read<any>(path.join(incubatorRoot(), "summary.json")); return value.activationStatus === "shadow-only" && Number.isInteger(value.metrics?.novelPromoted) && fs.existsSync(candidateRegistry()) && fs.existsSync(candidateAudit()); } if (stage === "manager-agendas") { const value = read<any>(path.join(agendasRoot(), "summary.json")); return Number(value.managersWithRequest) > 0 && fs.existsSync(path.join(agendasRoot(), "research-agendas.json.gz")); } const value = read<any>(path.join(causalPlanRoot(), "causal-plan.json")); return value.activationStatus === "shadow-only" && value.selected?.length === 24; } catch { return false; } }
function telemetryRoot(): string { return path.join(out, "telemetry"); }
function telemetryArchive(): string { return path.join(telemetryRoot(), "lineup-representation-study-samples.json.gz"); }
function incubatorRoot(): string { return path.join(out, "incubator"); }
function candidateRegistry(): string { return path.join(incubatorRoot(), "candidate-registry.json"); }
function candidateAudit(): string { return path.join(incubatorRoot(), "candidate-audit.json"); }
function agendasRoot(): string { return path.join(out, "manager-agendas"); }
function causalPlanRoot(): string { return path.join(out, "causal-plan"); }
function selectedManagerHypothesis(): string { const summary = read<any>(path.join(agendasRoot(), "summary.json")), entries = Object.entries(summary.requestsByMechanism ?? {}).map(([id, count]) => ({id, count: Number(count)})).sort((left, right) => right.count - left.count || left.id.localeCompare(right.id)); if (!entries.length) throw new Error("Managers selected no research hypothesis"); return entries[0].id; }
function artifact(file: string): unknown { return fs.existsSync(file) ? {file, bytes: fs.statSync(file).size, sha256: hash(file)} : null; }
function loadOrCreate(create: boolean): ResearchManifest { if (fs.existsSync(manifestFile)) return read<ResearchManifest>(manifestFile); if (!create) throw new Error(`Research manifest is missing; run init: ${manifestFile}`); initializeForContinue(); return read<ResearchManifest>(manifestFile); }
function initializeForContinue(): void { if (!fs.existsSync(path.join(source, "dynasty-state.json"))) throw new Error(`League source is missing: ${source}`); fs.mkdirSync(out, {recursive: true}); const now = new Date().toISOString(); writeManifest({schemaVersion: 1, source, seasons, createdAt: now, updatedAt: now, activeStage: null, stages: {}, failures: []}); }
function validateManifest(value: ResearchManifest): void { if (value.schemaVersion !== 1 || !path.isAbsolute(value.source) || !Number.isInteger(value.seasons) || value.seasons < 3 || value.seasons > 9 || !Array.isArray(value.failures)) throw new Error("Invalid lineup research manifest"); }
function writeManifest(value: ResearchManifest): void { value.updatedAt = new Date().toISOString(); validateManifest(value); atomicJson(manifestFile, value); }
function run(script: string, toolArgs: string[]): void { const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), script, ...toolArgs], {cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024}); if (result.status !== 0) throw new Error(`${path.basename(script)} failed:\n${(result.stderr || result.stdout).slice(-12000)}`); }
function emit(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function readGzip<T>(file: string): T { return JSON.parse(require("node:zlib").gunzipSync(fs.readFileSync(file)).toString("utf8")) as T; }
function atomicJson(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
function hash(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integerOption(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`); return value; }
function quote(value: string): string { return value.includes(" ") ? `\"${value}\"` : value; }
function usage(): never { console.error("Usage: npm run lineup-research -- <init|status|continue|report> [--source dir] [--out dir] [--seasons 3..9]"); process.exit(2); }
