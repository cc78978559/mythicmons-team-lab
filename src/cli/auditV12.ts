import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {auditV12Output, auditV12Signature, v12AuditMarkdown, type V12AuditSummary} from "../draft/v12Audit";
import {writeSeasonBrief} from "../draft/seasonBrief";

const args = process.argv.slice(2), root = process.cwd();
const out = path.resolve(option("--out", "output/draft-league-v12"));
if (fs.existsSync(path.join(out, ".run.lock"))) throw new Error(`League is still running: ${path.join(out, ".run.lock")}`);
if (args.includes("--run")) {
  const seasons = option("--seasons", "1");
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV12.ts")], {cwd: root, env: {...process.env, V12_OUT: out, V12_SEASONS: seasons, V12_RESUME: String(fs.existsSync(path.join(out, "dynasty-state.json")))}, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
const state = read<{completedSeason: number}>(path.join(out, "dynasty-state.json"));
const summaryPath = path.join(out, "audit-summary.json"), signature = auditV12Signature(out, state.completedSeason);
let summary: V12AuditSummary, cached = false;
if (!args.includes("--force") && fs.existsSync(summaryPath)) { const prior = read<V12AuditSummary>(summaryPath); cached = prior.schemaVersion === 3 && prior.inputSignature === signature; summary = cached ? prior : auditV12Output(out); } else summary = auditV12Output(out);
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(out, "audit-report.md"), v12AuditMarkdown(summary), "utf8");
for (let season = 1; season <= summary.completedSeasons; season += 1) writeSeasonBrief(path.join(out, `season-${String(season).padStart(2, "0")}`), out);
console.log(JSON.stringify({cached, seasons: summary.completedSeasons, fatal: summary.fatalCount, warnings: summary.warningCount, metrics: summary.metrics, summary: summaryPath}, null, 2));
if (summary.fatalCount) process.exitCode = 2;
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
