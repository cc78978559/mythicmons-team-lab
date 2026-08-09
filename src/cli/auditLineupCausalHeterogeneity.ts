import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {auditLineupCausalHeterogeneity, type LineupCausalHeterogeneityCase} from "../ai/whiteBox/lineupCausalHeterogeneity";

const args = process.argv.slice(2), study = path.resolve(option("--study", "output/tooling/lineup-research-v6-baseline/causal-study")), out = path.resolve(option("--out", path.join(study, "heterogeneity")));
const manifest = read<any>(path.join(study, "causal-manifest.json")), cases: LineupCausalHeterogeneityCase[] = [];
for (const item of manifest.items ?? []) {
  if (item.status !== "complete" || !item.output || !fs.existsSync(item.output)) continue;
  const capsule = JSON.parse(zlib.gunzipSync(fs.readFileSync(item.output)).toString("utf8")), trace = capsule.interventionRecord?.context?.whiteBoxShadow;
  const incumbentId = String(item.incumbentId), candidateId = String(item.candidateId), incumbent = trace?.candidates?.find((value: any) => String(value.id) === incumbentId), candidate = trace?.candidates?.find((value: any) => String(value.id) === candidateId);
  if (!incumbent?.diagnostics || !candidate?.diagnostics) throw new Error(`Causal capsule lacks predecision candidates: ${item.id}`);
  const signals: Record<string, number> = {
    "decision.candidateCount": Number(trace.candidateCount), "decision.reasonableCount": Number(trace.reasonableCount),
    "decision.incumbentRationalScore": Number(incumbent.rationalScore), "decision.candidateRationalDelta": Number(candidate.rationalScore) - Number(incumbent.rationalScore),
    "decision.incumbentStyleScore": Number(incumbent.rawStyleScore), "decision.candidateStyleDelta": Number(candidate.rawStyleScore) - Number(incumbent.rawStyleScore),
  };
  for (const [feature, raw] of Object.entries(incumbent.diagnostics)) { const value = Number(raw), alternative = Number(candidate.diagnostics[feature]); if (!Number.isFinite(value) || !Number.isFinite(alternative) || feature === "lineup.representationVersion") continue; signals[`incumbent.${feature}`] = value; signals[`delta.${feature}`] = alternative - value; }
  if (Object.values(signals).some(value => !Number.isFinite(value))) throw new Error(`Causal capsule has non-finite predecision signals: ${item.id}`);
  cases.push({managerId: String(item.managerId), direction: item.result.direction, signals});
}
const audit = auditLineupCausalHeterogeneity(cases);
fs.mkdirSync(out, {recursive: true}); write(path.join(out, "heterogeneity-audit.json"), audit);
const report = ["# Lineup Causal Heterogeneity", "", `- Evidence: ${audit.evidenceStatus}`, `- Cases/managers/decisive: ${audit.cases}/${audit.managers}/${audit.decisiveCases}`, `- Predecision signals: ${audit.signals}`, `- Scope proposals: ${audit.proposals.length}`, "", "| Signal | Rule | Selected B/N/W | Excluded B/N/W | Utility lift |", "|---|---|---:|---:|---:|", ...audit.findings.slice(0, 15).map(value => `| ${value.signal} | ${value.operator} ${value.threshold} | ${value.better}/${value.neutral}/${value.worse} | ${value.excludedBetter}/${value.excludedNeutral}/${value.excludedWorse} | ${value.utilityLift} |`), "", audit.nextAction, ""].join("\n");
fs.writeFileSync(path.join(out, "heterogeneity-audit.md"), report, "utf8"); write(path.join(out, "token-budget.json"), {schemaVersion: 1, reportBytes: Buffer.byteLength(report), estimatedReportTokens: Math.ceil(Buffer.byteLength(report) / 4), battleLogsRead: 0, evidenceCapsulesRead: cases.length});
console.log(JSON.stringify({status: "complete", cases: audit.cases, signals: audit.signals, proposals: audit.proposals, report: path.join(out, "heterogeneity-audit.md")}, null, 2));
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function write(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
