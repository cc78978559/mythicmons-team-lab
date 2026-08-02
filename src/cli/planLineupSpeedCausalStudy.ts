import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {buildLineupSpeedCausalPlan, type LineupSpeedCausalChoice} from "../ai/whiteBox/lineupSpeedCausalPlan";

const args = process.argv.slice(2);
const input = path.resolve(option("--input", "output/tooling/shadow-lineup-representation-v3-efficiency/lineup-representation-study-samples.json.gz"));
const out = path.resolve(option("--out", "output/tooling/shadow-lineup-speed-causal"));
const requested = Number(option("--target", "24"));
const study = JSON.parse(zlib.gunzipSync(fs.readFileSync(input)).toString("utf8"));
const choices: LineupSpeedCausalChoice[] = [];
for (const row of study.rows ?? []) {
  if (row.outcome !== "win" && row.outcome !== "loss") continue;
  const incumbent = row.candidates?.find((candidate: any) => String(candidate.id) === String(row.comparison?.incumbent));
  if (!incumbent?.diagnostics) continue;
  for (const candidate of row.candidates ?? []) {
    if (!candidate.diagnostics || candidate.id === incumbent.id) continue;
    choices.push({
      id: `${row.season}:${row.managerId}:${row.seriesId}:${candidate.id}`,
      decisionId: `lineup:${row.seriesId}:${row.managerId}`,
      season: Number(row.season),
      managerId: String(row.managerId),
      sourceOutcome: row.outcome,
      incumbentId: String(incumbent.id),
      candidateId: String(candidate.id),
      deltas: {
        speedAdvantageMean: delta(candidate, incumbent, "lineup.speedAdvantageMean"),
        strengthFloor: delta(candidate, incumbent, "lineup.strengthFloor"),
        roleTagBreadth: delta(candidate, incumbent, "lineup.roleTagBreadth"),
      },
    });
  }
}
const plan = buildLineupSpeedCausalPlan(choices, requested);
const result = {...plan, input, inputSha256: digest(fs.readFileSync(input)), createdAt: new Date().toISOString(), activationAuthorized: false};
fs.mkdirSync(out, {recursive: true});
write(path.join(out, "lineup-speed-causal-plan.json"), result);
const report = [
  "# Lineup Speed Causal Study Plan",
  "",
  `- Requested/selected: ${plan.requested}/${plan.selected.length}`,
  `- Available choices/managers: ${plan.availableChoices}/${plan.availableManagers}`,
  `- Season coverage: ${JSON.stringify(plan.coverage.seasons)}`,
  `- Source outcomes: ${JSON.stringify(plan.coverage.sourceOutcomes)}`,
  `- Unique managers: ${plan.coverage.managers}`,
  `- Primary intervention: increase lineup.speedAdvantageMean`,
  `- Guardrails: strengthFloor delta >= -5; roleTagBreadth delta >= -1`,
  `- Primary outcome: local pair margin, manager-level exact paired review`,
  "",
  "This plan is predeclared from observational telemetry. It does not activate lineup behavior.",
  "",
].join("\n");
fs.writeFileSync(path.join(out, "lineup-speed-causal-plan.md"), report, "utf8");
write(path.join(out, "token-budget.json"), {schemaVersion: 1, reportBytes: Buffer.byteLength(report), estimatedReportTokens: Math.ceil(Buffer.byteLength(report) / 4), rawBattleLogsRead: 0});
console.log(JSON.stringify({status: "planned", selected: plan.selected.length, coverage: plan.coverage, availableChoices: plan.availableChoices, availableManagers: plan.availableManagers, report: path.join(out, "lineup-speed-causal-plan.md")}, null, 2));

function delta(candidate: any, incumbent: any, feature: string): number { return round(Number(candidate.diagnostics?.[feature] ?? 0) - Number(incumbent.diagnostics?.[feature] ?? 0)); }
function digest(bytes: Buffer): string { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function write(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
