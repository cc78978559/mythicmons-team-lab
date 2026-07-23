import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {AcademyContractSettlement} from "../draft/academyContracts";
import {reconstructAcademyContractSettlement, screenAcademyContractConcessions} from "../ai/whiteBox/academyContractCounterfactual";

interface EntrantsArtifact {schemaVersion: number; cycle: number; contracts: AcademyContractSettlement}
interface DevelopmentSummary {promoted?: Array<{childId: string}>; retained?: Array<{childId: string}>; eliminated?: Array<{childId: string}>}
const args = process.argv.slice(2);
const source = path.resolve(required("--source"));
const entrantsPath = fs.statSync(source).isDirectory() ? path.join(source, "entrants.json") : source;
const out = path.resolve(option("--out", path.join(path.dirname(entrantsPath), "academy-contract-screen")));
const bytes = fs.readFileSync(entrantsPath), artifact = JSON.parse(bytes.toString("utf8")) as EntrantsArtifact;
const reconstructed = reconstructAcademyContractSettlement(artifact.contracts);
const rawCases = screenAcademyContractConcessions(artifact.contracts);
const cycleStatuses = loadCycleStatuses(path.join(path.dirname(entrantsPath), "development-summary.json"));
const cases = rawCases.map(value => {
  const cycleStatus = cycleStatuses[value.childId] ?? "unknown";
  const competitiveReplayStatus = value.screenStatus === "blocked-arrears-increase" ? "blocked-arrears-increase" : value.personalityRecommendation === "incumbent" ? "blocked-personality-reject" : cycleStatus === "retained" ? "eligible-retained-source" : cycleStatus === "unknown" ? "missing-cycle-status" : "departed-current-cycle";
  return {...value, cycleStatus, competitiveReplayStatus};
});
const result = {
  schemaVersion: 1, hypothesis: "academy-manager-accepts-offer-v1", source: {entrantsPath, schemaVersion: artifact.schemaVersion, cycle: artifact.cycle, sha256: crypto.createHash("sha256").update(bytes).digest("hex")},
  validation: {sourceReconstructed: true, contractCount: reconstructed.contracts.length, balanceCount: Object.keys(reconstructed.balances).length},
  summary: {cases: cases.length, personalityRecommended: cases.filter(value => value.personalityRecommendation === "accept-offer").length, personalityRejected: cases.filter(value => value.personalityRecommendation === "incumbent").length, personalityUnavailable: cases.filter(value => value.personalityRecommendation === "unavailable").length, blockedArrearsIncrease: cases.filter(value => value.competitiveReplayStatus === "blocked-arrears-increase").length, blockedPersonalityReject: cases.filter(value => value.competitiveReplayStatus === "blocked-personality-reject").length, eligibleRetainedSources: cases.filter(value => value.competitiveReplayStatus === "eligible-retained-source").length, departedCurrentCycle: cases.filter(value => value.competitiveReplayStatus === "departed-current-cycle").length, missingCycleStatus: cases.filter(value => value.competitiveReplayStatus === "missing-cycle-status").length},
  scope: "contract-ledger-only", activationStatus: "shadow-only", cases,
};
fs.mkdirSync(out, {recursive: true});
write(path.join(out, "academy-contract-screens.json"), result);
fs.writeFileSync(path.join(out, "academy-contract-screens.md"), report(result), "utf8");
console.log(JSON.stringify({out, cycle: artifact.cycle, contracts: reconstructed.contracts.length, cases: cases.length, sourceReconstructed: true}, null, 2));

function report(value: typeof result): string {
  return `# Academy contract counterfactual screen\n\nCycle ${value.source.cycle}; ${value.validation.contractCount} contracts reconstructed exactly; ${value.cases.length} concession cases. Personality recommends ${value.summary.personalityRecommended}, rejects ${value.summary.personalityRejected}, and lacks legacy evidence for ${value.summary.personalityUnavailable}. ${value.summary.blockedArrearsIncrease} are blocked for increasing arrears, ${value.summary.departedCurrentCycle} departed this cycle, and ${value.summary.eligibleRetainedSources} retained sources may proceed to competitive replay. These are shadow-only contract-ledger effects, not competitive promotion evidence.\n\n| Child | Cycle | Incumbent | Personality | Candidate salary | Affected contracts | Payroll delta | Arrears delta | Academy balance delta | Replay status |\n|---|---|---|---|---:|---:|---:|---:|---:|---|\n${value.cases.map(item => `| ${item.childName} | ${item.cycleStatus} | ${item.incumbentStatus} | ${item.personalityRecommendation} | ${item.candidateSalary.toFixed(2)} | ${item.affectedChildIds.length} | ${item.payrollDelta.toFixed(2)} | ${item.arrearsDelta.toFixed(2)} | ${item.academyBalanceDelta.toFixed(2)} | ${item.competitiveReplayStatus} |`).join("\n")}\n`;
}
function loadCycleStatuses(file: string): Partial<Record<string, "promoted" | "retained" | "eliminated">> {
  if (!fs.existsSync(file)) return {};
  const summary = JSON.parse(fs.readFileSync(file, "utf8")) as DevelopmentSummary, statuses: Partial<Record<string, "promoted" | "retained" | "eliminated">> = {};
  for (const status of ["promoted", "retained", "eliminated"] as const) for (const row of summary[status] ?? []) statuses[row.childId] = status;
  return statuses;
}
function write(file: string, value: unknown): void { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function required(name: string): string { const value = option(name, "").trim(); if (!value) throw new Error(`Missing ${name}`); return value; }
