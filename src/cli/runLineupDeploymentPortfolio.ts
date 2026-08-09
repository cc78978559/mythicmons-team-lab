import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {acquireNamedRunLock} from "../draft/runLock";

type PortfolioRunItem = {hypothesisId: string; plan: string; study: string; selected: number; status: "pending" | "running" | "complete"};

const args = process.argv.slice(2), root = process.cwd(), portfolioFile = path.resolve(required("--portfolio")), source = path.resolve(required("--source")), out = path.resolve(required("--out")), sourceCache = path.resolve(option("--source-cache", "output/tooling/shadow-lineup-source-cache")), concurrency = integer("--concurrency", 1, 1, 4), resume = args.includes("--resume");
const portfolio = read<any>(portfolioFile), rows = (portfolio.rows ?? []).filter((value: any) => value.status === "ready");
if (portfolio.schemaVersion !== 1 || portfolio.activationStatus !== "shadow-only" || portfolio.executionStatus !== "preflight-only" || !rows.length || rows.some((value: any) => !value.plan || Number(value.selected) < 1)) throw new Error("Invalid lineup deployment portfolio");
fs.mkdirSync(out, {recursive: true}); const stateFile = path.join(out, "portfolio-run.json"), lock = acquireNamedRunLock(out, ".lineup-deployment-portfolio.lock", {workflow: "lineup-deployment-portfolio", portfolio: portfolioFile});
let phase = "prepare", currentHypothesis: string | null = null;
try {
  const state = fs.existsSync(stateFile) ? read<any>(stateFile) : null;
  if (state && !resume && state.status !== "complete") throw new Error("Portfolio run exists; use --resume");
  const items: PortfolioRunItem[] = rows.map((row: any) => ({hypothesisId: String(row.hypothesisId), plan: path.resolve(root, String(row.plan)), study: path.join(out, String(row.hypothesisId)), selected: Number(row.selected), status: studyComplete(path.join(out, String(row.hypothesisId)), String(row.hypothesisId)) ? "complete" : "pending"}));
  write(stateFile, snapshot("running", items));
  for (const item of items) {
    currentHypothesis = item.hypothesisId; if (item.status === "complete") continue;
    phase = `run:${item.hypothesisId}`; item.status = "running"; write(stateFile, snapshot("running", items));
    const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src/cli/runLineupSpeedCausalStudy.ts"), "--source", source, "--plan", item.plan, "--out", item.study, "--source-cache", sourceCache, "--source-cache-max-mb", "8192", "--concurrency", String(concurrency)], {cwd: root, env: {...process.env, MANAGER_MECHANISM_AUTO_SYNC: "false"}, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
    if (result.status !== 0) throw new Error(`Causal portfolio study failed for ${item.hypothesisId}:\nstatus=${result.status ?? "null"} signal=${result.signal ?? "none"} spawnError=${result.error ? `${result.error.name}: ${result.error.message}` : "none"}\n${result.stderr || result.stdout || "<empty child output>"}`);
    if (!studyComplete(item.study, item.hypothesisId)) throw new Error(`Causal portfolio study did not finalize: ${item.hypothesisId}`);
    item.status = "complete"; write(stateFile, snapshot("running", items));
  }
  phase = "complete"; write(stateFile, snapshot("complete", items));
  console.log(JSON.stringify({status: "complete", studies: items.length, cases: items.reduce((sum, value) => sum + value.selected, 0), studyDirectories: items.map(value => value.study), out}, null, 2));
} catch (error) {
  const prior = fs.existsSync(stateFile) ? read<any>(stateFile) : {}, memory = process.memoryUsage(); write(stateFile, {...prior, status: "failed", phase, currentHypothesis, memory: {rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal}, failures: [{message: error instanceof Error ? error.message : String(error)}], updatedAt: new Date().toISOString()}); throw error;
} finally { lock.release(); }

function snapshot(status: "running" | "complete", items: PortfolioRunItem[]): any { return {schemaVersion: 1, activationStatus: "shadow-only", status, phase, currentHypothesis, portfolio: portfolioFile, source, sourceCache, studies: items.length, cases: items.reduce((sum, value) => sum + value.selected, 0), items, updatedAt: new Date().toISOString()}; }
function studyComplete(directory: string, hypothesisId: string): boolean { const file = path.join(directory, "causal-summary.json"); if (!fs.existsSync(file)) return false; const summary = read<any>(file); return summary.hypothesisId === hypothesisId && Number(summary.failed ?? 0) === 0 && Number(summary.completed ?? 0) > 0; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function required(name: string): string { const value = option(name, ""); if (!value) throw new Error(`Missing ${name}`); return value; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? String(args[index + 1] ?? "") : fallback; }
function integer(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`); return value; }
function write(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
