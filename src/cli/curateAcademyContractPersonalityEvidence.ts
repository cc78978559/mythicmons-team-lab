import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const source = path.resolve(required("--source")), priorSource = path.resolve(required("--prior-source")), screensPath = path.resolve(required("--screens")), priorBatchPath = path.resolve(required("--prior-batch")), out = path.resolve(required("--out"));
const sourceEntrants = read<any>(path.join(source, "entrants.json")), priorEntrants = read<any>(path.join(priorSource, "entrants.json")), screens = read<any>(screensPath), priorBatch = read<any>(priorBatchPath);
if (screens.source.sha256 !== digest(fs.readFileSync(path.join(source, "entrants.json"))) || priorBatch.source.entrantsSha256 !== digest(fs.readFileSync(path.join(priorSource, "entrants.json")))) throw new Error("Personality curation inputs are not source-bound");
const sourceState = read<any>(path.join(source, "development-final-state.json")), priorState = read<any>(path.join(priorSource, "development-final-state.json"));
if (sourceState.sha256 !== priorState.sha256 || sourceState.managers !== priorState.managers) throw new Error("Personality shadow source does not reproduce the prior manager state");
if (JSON.stringify(withoutShadows(sourceEntrants.contracts)) !== JSON.stringify(withoutShadows(priorEntrants.contracts))) throw new Error("Personality shadow source changed the incumbent contract ledger");
const eligible = screens.cases.filter((value: any) => value.competitiveReplayStatus === "eligible-retained-source").sort((a: any, b: any) => a.caseId.localeCompare(b.caseId));
const cases = eligible.map((screen: any) => {
  const prior = priorBatch.cases.find((value: any) => value.caseId === screen.caseId);
  if (!prior) throw new Error(`Prior batch is missing personality-eligible case ${screen.caseId}`);
  return {...prior, personalityEvidence: screen.personalityEvidence};
});
const aggregate = {schemaVersion: 1, hypothesis: "academy-personality-concession-v1", source: {directory: source, cycle: sourceEntrants.cycle, entrantsSha256: screens.source.sha256, priorSource, priorEntrantsSha256: priorBatch.source.entrantsSha256, finalManagersSha256: sourceState.sha256, independentSources: 1}, equivalence: {finalManagerStateExact: true, incumbentContractLedgerExactAfterRemovingShadowTrace: true, reusedCounterfactuals: cases.length}, policy: {version: "academy-contract-concession-v1", eligibleCases: eligible.length, rejectedCases: screens.summary.personalityRejected, recommendedCases: screens.summary.personalityRecommended}, outcomes: Object.fromEntries([...cases.reduce((map: Map<string, number>, value: any) => map.set(value.conclusion, (map.get(value.conclusion) ?? 0) + 1), new Map<string, number>())].sort()), metrics: {meanSalaryDelta: average(cases.map((value: any) => value.salaryDelta)), meanInterventionPayrollDelta: average(cases.map((value: any) => value.interventionPayrollDelta)), meanCyclePointsDelta: average(cases.map((value: any) => value.competitiveDelta.cyclePoints)), meanRankImprovement: average(cases.map((value: any) => value.competitiveDelta.averageRankImprovement)), meanTitlesDelta: average(cases.map((value: any) => value.competitiveDelta.titles)), meanFollowupPayrollDelta: average(cases.map((value: any) => value.academyDelta.payrollPaid)), meanFollowupTreasuryDelta: average(cases.map((value: any) => value.academyDelta.treasury))}, evidenceStatus: "source-local-personality-subset-complete-insufficient-independent-sources", activationStatus: "shadow-only", cases};
fs.mkdirSync(out, {recursive: true}); write(path.join(out, "academy-contract-personality-evidence.json"), aggregate); fs.writeFileSync(path.join(out, "academy-contract-personality-evidence.md"), report(aggregate), "utf8");
console.log(JSON.stringify({out, policy: aggregate.policy, outcomes: aggregate.outcomes, metrics: aggregate.metrics, evidenceStatus: aggregate.evidenceStatus, activationStatus: aggregate.activationStatus}, null, 2));

function withoutShadows(value: any): any { if (Array.isArray(value)) return value.map(withoutShadows); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "concessionWhiteBoxShadow").map(([key, child]) => [key, withoutShadows(child)])); return value; }
function report(value: any): string { return `# Academy contract personality evidence\n\nThe personality shadow recommended ${value.policy.recommendedCases} of the ${value.policy.recommendedCases + value.policy.rejectedCases} disputed contracts. After lifecycle and safety gates, ${value.policy.eligibleCases} retained cases reused exact prior counterfactuals. All ${value.equivalence.reusedCounterfactuals} were competitively neutral. Evidence remains **${value.evidenceStatus}** and **shadow-only**.\n\nMean salary delta ${value.metrics.meanSalaryDelta.toFixed(3)}, mean follow-up payroll delta ${value.metrics.meanFollowupPayrollDelta.toFixed(3)}, mean follow-up treasury delta ${value.metrics.meanFollowupTreasuryDelta.toFixed(3)}.\n`; }
function average(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function digest(bytes: Buffer): string { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function write(file: string, value: unknown): void { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function required(name: string): string { const value = option(name, "").trim(); if (!value) throw new Error(`Missing ${name}`); return value; }
