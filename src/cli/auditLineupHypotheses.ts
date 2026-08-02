import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {auditLineupHypotheses, validateLineupHypothesisRegistry, type LineupHypothesisObservation, type LineupHypothesisRegistry} from "../ai/whiteBox/lineupHypothesisWorkbench";

const args = process.argv.slice(2), root = process.cwd();
const source = path.resolve(option("--source", "output/tooling/shadow-lineup-representation-v3-efficiency/lineup-representation-study-samples.json.gz"));
const registryFile = path.resolve(option("--registry", "data/lineup-audit-hypotheses.json"));
const out = path.resolve(option("--out", "output/tooling/shadow-lineup-hypotheses"));
const permutations = integerOption("--permutations", 2000, 100, 100000);
const registry = validateLineupHypothesisRegistry(read<LineupHypothesisRegistry>(registryFile));
const archive = JSON.parse(zlib.gunzipSync(fs.readFileSync(source)).toString("utf8"));
const observations: LineupHypothesisObservation[] = (archive.rows ?? []).map((row: any) => {
  const selectedId = String(row.comparison?.incumbent ?? ""), selected = (row.candidates ?? []).find((candidate: any) => String(candidate.id) === selectedId);
  if (!selected?.diagnostics) throw new Error(`Selected lineup diagnostics missing: ${row.season}/${row.managerId}/${row.seriesId}`);
  return {seriesId: String(row.seriesId), season: Number(row.season), managerId: String(row.managerId), outcome: row.outcome, diagnostics: selected.diagnostics};
});
const audit = auditLineupHypotheses(observations, registry, permutations);
fs.mkdirSync(out, {recursive: true});
write(path.join(out, "lineup-hypothesis-audit.json"), {...audit, source: path.relative(root, source), registry: path.relative(root, registryFile)});
fs.writeFileSync(path.join(out, "lineup-hypothesis-audit.md"), report(audit), "utf8");
const compact = {conclusion: audit.conclusion, activationStatus: audit.activationStatus, metrics: audit.metrics, candidates: audit.findings.filter(finding => finding.observationalCandidate && finding.registeredStage !== "causal-complete").map(finding => ({id: finding.id, effect: finding.standardizedEffect, q: finding.adjustedQ, nextAction: finding.nextAction})), reviewedCausal: audit.findings.filter(finding => finding.registeredStage === "causal-complete").map(finding => ({id: finding.id, causalConclusion: finding.causalConclusion})), report: path.join(out, "lineup-hypothesis-audit.md")};
write(path.join(out, "summary.json"), compact);
write(path.join(out, "token-budget.json"), {summaryBytes: Buffer.byteLength(JSON.stringify(compact)), estimatedReadTokens: Math.ceil(Buffer.byteLength(JSON.stringify(compact)) / 3.5), fullAuditBytes: fs.statSync(path.join(out, "lineup-hypothesis-audit.json")).size});
console.log(JSON.stringify(compact, null, 2));

function report(audit: ReturnType<typeof auditLineupHypotheses>): string {
  const lines = ["# Lineup Hypothesis Audit", "", `- Conclusion: ${audit.conclusion}`, `- Activation: ${audit.activationStatus}`, `- Observations / decisive pairs: ${audit.metrics.observations} / ${audit.metrics.decisivePairs}`, `- Managers / seasons: ${audit.metrics.managers} / ${audit.metrics.seasons}`, `- New observational candidates: ${audit.metrics.observationalCandidates}`, "", "| Hypothesis | Registered | Audit | Effect | Winner higher | p | q | Causal evidence |", "|---|---|---|---:|---:|---:|---:|---|"];
  for (const finding of audit.findings) lines.push(`| ${finding.title} | ${finding.registeredStage} | ${finding.auditStage} | ${finding.standardizedEffect} | ${(finding.winnerHigherRate * 100).toFixed(1)}% | ${finding.permutationP} | ${finding.adjustedQ} | ${finding.causalConclusion ?? "none"} |`);
  lines.push("", "Observational candidates may enter guarded causal planning. They never modify lineup scores or manager preferences directly.", "");
  return lines.join("\n");
}
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function write(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integerOption(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`); return value; }
