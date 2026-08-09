import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";

const args = process.argv.slice(2), root = process.cwd(), source = path.resolve(required("--source")), registry = path.resolve(required("--registry")), audit = path.resolve(required("--audit")), freezeFile = path.resolve(required("--freeze")), agendas = path.resolve(required("--agendas")), ledgers = path.resolve(required("--mechanism-ledgers")), imports = path.resolve(required("--import-registry")), out = path.resolve(required("--out")), minimumScoreDelta = option("--minimum-score-delta", ".02");
const freeze = read<any>(freezeFile); if (freeze.activationStatus !== "shadow-only" || freeze.accumulationPolicy?.managerChoiceRequired !== true || freeze.accumulationPolicy?.maximumResearchPreferenceRank !== 0 || !freeze.requestCounts) throw new Error("Invalid manager-selected deployment research freeze");
fs.mkdirSync(out, {recursive: true}); const rows: any[] = [];
for (const [hypothesisId, requestedRaw] of Object.entries(freeze.requestCounts as Record<string, number>)) {
  const requested = Number(requestedRaw), target = path.join(out, hypothesisId); fs.mkdirSync(target, {recursive: true});
  const childArgs = [require.resolve("tsx/cli"), path.join(root, "src/cli/planLineupHypothesisStudy.ts"), "--source", source, "--registry", registry, "--audit", audit, "--hypothesis", hypothesisId, "--requested", String(requested), "--minimum-score-delta", minimumScoreDelta, "--maximum-research-rank", "0", "--sparse-accumulation", "--mechanism-ledgers", ledgers, "--research-agendas", agendas, "--import-registry", imports, "--out", target];
  const result = spawnSync(process.execPath, childArgs, {cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024});
  if (result.status === 0) {
    const plan = read<any>(path.join(target, "causal-plan.json")); rows.push({hypothesisId, requested, status: "ready", availableChoices: plan.availableChoices, availableManagers: plan.availableManagers, selected: plan.selected.length, deferred: plan.opportunityCoverage?.deferredRequestedManagers ?? 0, firstChoice: plan.opportunityCoverage?.selectedFirstChoiceRequests ?? 0, plan: path.relative(root, path.join(target, "causal-plan.json")).replaceAll("\\", "/")});
  } else rows.push({hypothesisId, requested, status: "blocked", reason: errorMessage(result.stderr || result.stdout)});
}
const summary = {schemaVersion: 1, activationStatus: "shadow-only", executionStatus: "preflight-only", ready: rows.filter(value => value.status === "ready").length, blocked: rows.filter(value => value.status === "blocked").length, selected: rows.reduce((sum, value) => sum + Number(value.selected ?? 0), 0), deferred: rows.reduce((sum, value) => sum + Number(value.deferred ?? 0), 0), rows};
write(path.join(out, "portfolio-plan.json"), summary); const report = ["# Manager-Selected Lineup Research Portfolio", "", `- Ready/blocked hypotheses: ${summary.ready}/${summary.blocked}`, `- Selected/deferred manager requests: ${summary.selected}/${summary.deferred}`, `- Execution: preflight only; no battle was run`, "", "| Hypothesis | Requested | Selected | Deferred | Choices |", "|---|---:|---:|---:|---:|", ...rows.map(value => `| ${value.hypothesisId} | ${value.requested} | ${value.selected ?? 0} | ${value.deferred ?? value.requested} | ${value.availableChoices ?? 0} |`), ""].join("\n"); fs.writeFileSync(path.join(out, "portfolio-plan.md"), report, "utf8"); write(path.join(out, "token-budget.json"), {schemaVersion: 1, reportBytes: Buffer.byteLength(report), estimatedReportTokens: Math.ceil(Buffer.byteLength(report) / 4), battleLogsRead: 0});
console.log(JSON.stringify({status: "complete", ready: summary.ready, blocked: summary.blocked, selected: summary.selected, deferred: summary.deferred, out}, null, 2));

function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function required(name: string): string { const value = option(name, ""); if (!value) throw new Error(`Missing ${name}`); return value; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? String(args[index + 1] ?? "") : fallback; }
function errorMessage(value: string): string { return value.match(/Error: ([^\r\n]+)/)?.[1] ?? value.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "unknown planning failure"; }
function write(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
