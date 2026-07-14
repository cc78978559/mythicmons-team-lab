import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {auditInputSignature, auditMarkdown, auditV10Output, type V10AuditSummary} from "../draft/v10Audit";

type Mode = "quick" | "season" | "long-run";
const root = process.cwd();
const args = process.argv.slice(2);
const mode = option("--mode", "quick") as Mode;
if (!(["quick", "season", "long-run"] as string[]).includes(mode)) throw new Error("--mode must be quick, season, or long-run");
const targetSeasons = integerOption("--seasons", mode === "long-run" ? 100 : 4, 1, 1000);
const outDir = path.resolve(option("--out", mode === "quick" ? "output/draft-league-v10" : mode === "season" ? "output/v10-audit-season" : "output/v10-long-run"));
const force = flag("--force");
const noCache = flag("--no-cache");
const pruneBattles = flag("--prune-battles");

if (mode !== "quick") ensureSimulation();
const state = read<{completedSeason: number}>(path.join(outDir, "dynasty-state.json"));
const summaryPath = path.join(outDir, "audit-summary.json");
const signature = auditInputSignature(outDir, state.completedSeason);
let summary: V10AuditSummary;
let cacheHit = false;
if (!force && !noCache && fs.existsSync(summaryPath)) {
  const cached = read<V10AuditSummary>(summaryPath);
  cacheHit = cached.inputSignature === signature;
  summary = cacheHit ? cached : auditV10Output(outDir);
} else summary = auditV10Output(outDir);
write(summaryPath, summary);
fs.writeFileSync(path.join(outDir, "audit-report.md"), auditMarkdown(summary), "utf8");
if (pruneBattles && mode === "long-run") pruneBattleLogs();
console.log(JSON.stringify({mode, cached: cacheHit, seasons: summary.completedSeasons, managers: summary.managers, fatal: summary.fatalCount, warnings: summary.warningCount, metrics: summary.metrics, summary: summaryPath}, null, 2));
if (summary.fatalCount) process.exitCode = 2;

function ensureSimulation(): void {
  const statePath = path.join(outDir, "dynasty-state.json");
  const completed = fs.existsSync(statePath) ? read<{completedSeason: number}>(statePath).completedSeason : 0;
  if (!force && completed >= targetSeasons) return;
  if (force && fs.existsSync(outDir)) throw new Error(`--force will not overwrite an existing league directory; choose a new --out path: ${outDir}`);
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV10.ts")], {
    cwd: root,
    env: {...process.env, V10_OUT: outDir, V10_SEASONS: String(targetSeasons), V10_RESUME: String(completed > 0), V10_SEED: option("--seed", mode === "long-run" ? "v10-local-long-run" : "v10-local-audit")},
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`V10 simulation failed:\n${result.stderr || result.stdout}`);
}

function pruneBattleLogs(): void {
  const resolved = path.resolve(outDir);
  const allowedRoot = path.resolve(root, "output");
  if (resolved === allowedRoot || !resolved.startsWith(`${allowedRoot}${path.sep}`)) throw new Error("Battle pruning is restricted to a child of the workspace output directory");
  for (const entry of fs.readdirSync(resolved, {withFileTypes: true})) {
    if (!entry.isDirectory() || !/^season-\d+$/.test(entry.name)) continue;
    const battles = path.join(resolved, entry.name, "battles");
    if (fs.existsSync(battles)) fs.rmSync(battles, {recursive: true, force: true});
  }
}

function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function flag(name: string): boolean { return args.includes(name); }
function integerOption(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`); return value; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function write(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
