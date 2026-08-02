import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {V12_AUDIT_SIGNATURE_CACHE, auditV12Output, auditV12SignatureIncremental, v12AuditMarkdown, type V12AuditSignatureCache, type V12AuditSummary} from "../draft/v12Audit";
import {writeSeasonBrief} from "../draft/seasonBrief";

const args = process.argv.slice(2), root = process.cwd();
if (args.includes("--help") || args.includes("-h")) {
  console.log([
    "Usage: npm run audit:v12 -- --out <league> [options]",
    "",
    "Options:",
    "  --mode quick       Use the incremental signature cache and existing clean summary when possible (default)",
    "  --mode full        Run all invariant checks; unchanged file hashes are reused",
    "  --mode forensic    Rehash every input and run all invariant checks",
    "  --force            Rerun invariant checks even when the input signature is unchanged",
    "  --refresh-reports  Rewrite all season briefs even on a cache hit",
    "  --progress         Print stage and timing information to stderr",
    "  --run --seasons N  Legacy convenience: run/resume the league before auditing",
  ].join("\n"));
  process.exit(0);
}
const out = path.resolve(option("--out", "output/draft-league-v12"));
const mode = modeOption(), progress = args.includes("--progress") || Boolean(process.stderr.isTTY), started = Date.now();
const runStatePath = path.join(out, "audit-run-state.json"), failuresPath = path.join(out, "audit-failures.json");
let peakHeapBytes = 0, peakRssBytes = 0, currentPhase = "starting", currentSeason: number | undefined;
fs.mkdirSync(out, {recursive: true});
recoverInterruptedRun();
ensureFailureLedger();
process.once("SIGINT", () => terminate("SIGINT", 130));
process.once("SIGTERM", () => terminate("SIGTERM", 143));
try { runAudit(); }
catch (error) {
  const failure = {at: new Date().toISOString(), phase: currentPhase, season: currentSeason ?? null, elapsedMs: Date.now() - started, memory: sampleMemory(), error: error instanceof Error ? `${error.name}: ${error.message}` : String(error)};
  appendFailure(failure); persistRunState("failed", failure.error); console.error(JSON.stringify({status: "failed", ...failure, failures: failuresPath}, null, 2)); process.exitCode = 2;
}

function runAudit(): void {
if (fs.existsSync(path.join(out, ".run.lock"))) throw new Error(`League is still running: ${path.join(out, ".run.lock")}`);
persistRunState("running");
if (args.includes("--run")) {
  process.stderr.write("audit:v12 --run is a legacy mutating option; prefer running draft-league-v12 separately.\n");
  const seasons = option("--seasons", "1");
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV12.ts")], {cwd: root, env: {...process.env, V12_OUT: out, V12_SEASONS: seasons, V12_RESUME: String(fs.existsSync(path.join(out, "dynasty-state.json")))}, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
const state = read<{completedSeason: number}>(path.join(out, "dynasty-state.json"));
const summaryPath = path.join(out, "audit-summary.json"), cachePath = path.join(out, V12_AUDIT_SIGNATURE_CACHE);
checkpoint("signature-index"); stage(`indexing ${state.completedSeason} seasons`);
let priorCache = mode === "forensic" ? undefined : optional<V12AuditSignatureCache>(cachePath);
const signatureStarted = Date.now(); let signatureResult: ReturnType<typeof auditV12SignatureIncremental> | undefined = auditV12SignatureIncremental(out, state.completedSeason, priorCache, mode === "forensic");
if (!priorCache || priorCache.seasons !== state.completedSeason || signatureResult.hashedFiles > 0 || Object.keys(priorCache.files).length !== signatureResult.files) writeAtomic(cachePath, signatureResult.cache);
const signature = {value: signatureResult.signature, files: signatureResult.files, bytes: signatureResult.bytes, hashedFiles: signatureResult.hashedFiles, hashedBytes: signatureResult.hashedBytes};
signatureResult = undefined; priorCache = undefined;
checkpoint("signature-ready"); stage(`signature ready: ${signature.hashedFiles}/${signature.files} files hashed, ${megabytes(signature.hashedBytes)}/${megabytes(signature.bytes)} MB read in ${seconds(signatureStarted)}s`);
let summary: V12AuditSummary, cached = false;
if (!args.includes("--force") && mode === "quick" && fs.existsSync(summaryPath)) {
  const prior = read<V12AuditSummary>(summaryPath);
  cached = prior.schemaVersion === 5 && prior.inputSignature === signature.value;
  summary = cached ? prior : auditV12Output(out, signature.value, {auditedInputBytes: signature.bytes, onStage: checkpoint});
} else summary = auditV12Output(out, signature.value, {auditedInputBytes: signature.bytes, onStage: checkpoint});
if (!cached || args.includes("--refresh-reports")) {
  checkpoint("write-reports");
  stage("writing audit and season reports");
  writeAtomic(summaryPath, summary);
  fs.writeFileSync(path.join(out, "audit-report.md"), v12AuditMarkdown(summary), "utf8");
  for (let season = 1; season <= summary.completedSeasons; season += 1) writeSeasonBrief(path.join(out, `season-${String(season).padStart(2, "0")}`), out);
}
checkpoint("complete"); persistRunState("complete");
console.log(JSON.stringify({cached, mode, seasons: summary.completedSeasons, fatal: summary.fatalCount, warnings: summary.warningCount, signature: {files: signature.files, bytes: signature.bytes, hashedFiles: signature.hashedFiles, hashedBytes: signature.hashedBytes}, elapsedMs: Date.now() - started, peakMemory: {heapBytes: peakHeapBytes, rssBytes: peakRssBytes}, metrics: summary.metrics, summary: summaryPath}, null, 2));
if (summary.fatalCount) process.exitCode = 2;
}
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function optional<T>(file: string): T | undefined { try { return read<T>(file); } catch { return undefined; } }
function modeOption(): "quick" | "full" | "forensic" {
  const value = option("--mode", "quick");
  if (value !== "quick" && value !== "full" && value !== "forensic") throw new Error("--mode must be quick, full, or forensic");
  return value;
}
function writeAtomic(file: string, value: unknown): void {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}
function stage(message: string): void { if (progress) process.stderr.write(`[audit:v12] ${message}\n`); }
function checkpoint(phase: string, season?: number): void { currentPhase = phase; currentSeason = season; sampleMemory(); persistRunState("running"); stage(season === undefined ? phase : `${phase} ${season}`); }
function sampleMemory(): {heapBytes: number; rssBytes: number; peakHeapBytes: number; peakRssBytes: number} { const memory = process.memoryUsage(); peakHeapBytes = Math.max(peakHeapBytes, memory.heapUsed); peakRssBytes = Math.max(peakRssBytes, memory.rss); return {heapBytes: memory.heapUsed, rssBytes: memory.rss, peakHeapBytes, peakRssBytes}; }
function persistRunState(status: "running" | "complete" | "failed", error?: string): void { writeAtomic(runStatePath, {schemaVersion: 1, status, mode, pid: process.pid, startedAt: new Date(started).toISOString(), updatedAt: new Date().toISOString(), phase: currentPhase, season: currentSeason ?? null, elapsedMs: Date.now() - started, memory: sampleMemory(), ...(error ? {error} : {})}); }
function recoverInterruptedRun(): void { const prior = optional<any>(runStatePath); if (prior?.status !== "running") return; appendFailure({at: new Date().toISOString(), phase: prior.phase ?? "unknown", season: prior.season ?? null, elapsedMs: prior.elapsedMs ?? null, memory: prior.memory ?? null, error: `Interrupted audit process ${prior.pid ?? "unknown"} left no terminal status`}); }
function ensureFailureLedger(): void { if (!fs.existsSync(failuresPath)) writeAtomic(failuresPath, {schemaVersion: 1, failures: []}); }
function appendFailure(failure: unknown): void { const prior = optional<any>(failuresPath), failures = [...(Array.isArray(prior?.failures) ? prior.failures : []), failure].slice(-20); writeAtomic(failuresPath, {schemaVersion: 1, failures}); }
function terminate(signal: string, exitCode: number): never { const failure = {at: new Date().toISOString(), phase: currentPhase, season: currentSeason ?? null, elapsedMs: Date.now() - started, memory: sampleMemory(), error: `Audit terminated by ${signal}`}; appendFailure(failure); persistRunState("failed", failure.error); process.exit(exitCode); }
function megabytes(bytes: number): string { return (bytes / 1048576).toFixed(1); }
function seconds(since: number): string { return ((Date.now() - since) / 1000).toFixed(2); }
