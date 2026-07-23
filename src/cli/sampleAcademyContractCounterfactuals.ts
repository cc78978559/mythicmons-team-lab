import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";

interface ScreenCase {caseId: string; competitiveReplayStatus: string}
interface ScreenArtifact {source: {sha256: string; cycle: number}; cases: ScreenCase[]}
interface SampleResult {selection: {caseId: string; childName: string}; source: {entrantsSha256: string; cycle: number}; intervention: {incumbentStatus: "arbitrated" | "released"; sourceSalary: number; candidateSalary: number; payrollDelta: number}; followup: {delta: {cyclePoints: number | null; averageRankImprovement: number | null; titles: number | null}; academyDelta: {payrollPaid: number | null; treasury: number | null; guaranteedDebt: number | null}}; conclusion: string; activationStatus: string}
interface Manifest {schemaVersion: 1; source: string; sourceSha256: string; screensSha256: string; cycle: number; cases: Array<{caseId: string; status: "complete"; result: string}>}

const args = process.argv.slice(2), root = process.cwd();
const source = path.resolve(required("--source")), screensPath = path.resolve(required("--screens")), out = path.resolve(required("--out")), samplesDir = path.join(out, "samples"), manifestPath = path.join(out, "manifest.json");
const screensBytes = fs.readFileSync(screensPath), screens = JSON.parse(screensBytes.toString("utf8")) as ScreenArtifact, sourceHash = digest(fs.readFileSync(path.join(source, "entrants.json"))), screensHash = digest(screensBytes);
if (screens.source.sha256 !== sourceHash) throw new Error("Academy contract screens do not match the selected source");
const eligible = screens.cases.filter(value => value.competitiveReplayStatus === "eligible-retained-source").sort((a, b) => a.caseId.localeCompare(b.caseId));
fs.mkdirSync(samplesDir, {recursive: true});
let manifest: Manifest = fs.existsSync(manifestPath) ? read<Manifest>(manifestPath) : {schemaVersion: 1, source, sourceSha256: sourceHash, screensSha256: screensHash, cycle: screens.source.cycle, cases: []};
if (manifest.source !== source || manifest.sourceSha256 !== sourceHash || manifest.screensSha256 !== screensHash) throw new Error("Existing academy contract batch belongs to different inputs");
for (const existing of option("--existing", "").split(",").map(value => value.trim()).filter(Boolean)) importExisting(path.resolve(existing));
persist();
for (const [index, candidate] of eligible.entries()) {
  if (manifest.cases.some(value => value.caseId === candidate.caseId)) continue;
  const sample = path.join(samplesDir, `sample-${String(index + 1).padStart(2, "0")}`);
  const run = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "counterfactualAcademyContract.ts"), "--source", source, "--screens", screensPath, "--out", sample, "--case-id", candidate.caseId, "--retention", "summary"], {cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
  if (run.status !== 0) throw new Error(`Academy contract sample ${candidate.caseId} failed:\n${run.stderr || run.stdout}`);
  const resultPath = path.join(sample, "academy-contract-counterfactual.json"), result = read<SampleResult>(resultPath);
  if (result.selection.caseId !== candidate.caseId || result.activationStatus !== "shadow-only") throw new Error("Academy contract sample result identity mismatch");
  manifest.cases.push({caseId: candidate.caseId, status: "complete", result: path.relative(out, resultPath).replace(/\\/g, "/")}); persist();
  console.log(`Academy contract sample ${manifest.cases.length}/${eligible.length}: ${result.conclusion}`);
}
const results = manifest.cases.map(value => read<SampleResult>(path.join(out, value.result))), counts = Object.fromEntries([...results.reduce((map, value) => map.set(value.conclusion, (map.get(value.conclusion) ?? 0) + 1), new Map<string, number>())].sort());
const aggregate = {schemaVersion: 1, hypothesis: "academy-manager-accepts-offer-followup-v1", source: {directory: source, cycle: screens.source.cycle, entrantsSha256: sourceHash, independentSources: 1}, samples: results.length, eligibleCases: eligible.length, complete: results.length === eligible.length, outcomes: counts, strata: {arbitrated: stratum(results.filter(value => value.intervention.incumbentStatus === "arbitrated")), released: stratum(results.filter(value => value.intervention.incumbentStatus === "released"))}, metrics: {meanInterventionPayrollDelta: average(results.map(value => value.intervention.payrollDelta)), meanCyclePointsDelta: averagePresent(results.map(value => value.followup.delta.cyclePoints)), meanRankImprovement: averagePresent(results.map(value => value.followup.delta.averageRankImprovement)), meanTitlesDelta: averagePresent(results.map(value => value.followup.delta.titles)), meanFollowupPayrollDelta: averagePresent(results.map(value => value.followup.academyDelta.payrollPaid)), meanFollowupTreasuryDelta: averagePresent(results.map(value => value.followup.academyDelta.treasury)), meanFollowupGuaranteedDebtDelta: averagePresent(results.map(value => value.followup.academyDelta.guaranteedDebt))}, evidenceStatus: results.length === eligible.length ? "source-local-complete-insufficient-independent-sources" : "source-local-incomplete", activationStatus: "shadow-only", cases: results.map(value => ({caseId: value.selection.caseId, childName: value.selection.childName, incumbentStatus: value.intervention.incumbentStatus, conclusion: value.conclusion, salaryDelta: value.intervention.candidateSalary - value.intervention.sourceSalary, interventionPayrollDelta: value.intervention.payrollDelta, competitiveDelta: value.followup.delta, academyDelta: value.followup.academyDelta}))};
write(path.join(out, "academy-contract-batch.json"), aggregate); fs.writeFileSync(path.join(out, "academy-contract-batch.md"), report(aggregate), "utf8");
console.log(JSON.stringify({out, samples: aggregate.samples, outcomes: aggregate.outcomes, metrics: aggregate.metrics, evidenceStatus: aggregate.evidenceStatus, activationStatus: aggregate.activationStatus}, null, 2));

function importExisting(directory: string): void {
  const resultPath = path.join(directory, "academy-contract-counterfactual.json"), result = read<SampleResult>(resultPath);
  if (result.source.entrantsSha256 !== sourceHash || !eligible.some(value => value.caseId === result.selection.caseId)) return;
  if (!manifest.cases.some(value => value.caseId === result.selection.caseId)) {
    const index = eligible.findIndex(value => value.caseId === result.selection.caseId), target = path.join(samplesDir, `sample-${String(index + 1).padStart(2, "0")}`); fs.mkdirSync(target, {recursive: true});
    const copied = path.join(target, "academy-contract-counterfactual.json"); fs.copyFileSync(resultPath, copied);
    const markdown = path.join(directory, "academy-contract-counterfactual.md"); if (fs.existsSync(markdown)) fs.copyFileSync(markdown, path.join(target, "academy-contract-counterfactual.md"));
    manifest.cases.push({caseId: result.selection.caseId, status: "complete", result: path.relative(out, copied).replace(/\\/g, "/")});
  }
  if (args.includes("--prune-existing-branches")) pruneExistingBranches(directory);
}
function pruneExistingBranches(directory: string): void {
  const resolvedRoot = path.resolve(directory);
  if (!fs.existsSync(path.join(resolvedRoot, "academy-contract-counterfactual.json"))) throw new Error("Cannot prune an existing sample without its retained summary");
  for (const name of ["experiment-source", "control-followup", "experiment-followup"]) {
    const branch = path.resolve(resolvedRoot, name);
    if (path.dirname(branch) !== resolvedRoot || !branch.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Existing sample retention escaped its output directory");
    if (fs.existsSync(branch)) fs.rmSync(branch, {recursive: true, force: true});
  }
}
function persist(): void { manifest.cases.sort((a, b) => a.caseId.localeCompare(b.caseId)); write(manifestPath, manifest); }
function report(value: any): string { return `# Academy contract counterfactual batch\n\n${value.samples}/${value.eligibleCases} source-local cases complete from one development cycle. Evidence status: **${value.evidenceStatus}**; activation remains **shadow-only**.\n\n| Source status | Samples | Mean current payroll delta | Mean follow-up payroll delta |\n|---|---:|---:|---:|\n| Arbitrated | ${value.strata.arbitrated.samples} | ${format(value.strata.arbitrated.meanInterventionPayrollDelta)} | ${format(value.strata.arbitrated.meanFollowupPayrollDelta)} |\n| Released | ${value.strata.released.samples} | ${format(value.strata.released.meanInterventionPayrollDelta)} | ${format(value.strata.released.meanFollowupPayrollDelta)} |\n\n| Outcome | Count |\n|---|---:|\n${Object.entries(value.outcomes).map(([key, count]) => `| ${key} | ${count} |`).join("\n")}\n\nMean cycle-points delta: ${format(value.metrics.meanCyclePointsDelta)}; mean rank improvement: ${format(value.metrics.meanRankImprovement)}; mean titles delta: ${format(value.metrics.meanTitlesDelta)}.\n`;
}
function stratum(values: SampleResult[]): any { return {samples: values.length, outcomes: Object.fromEntries([...values.reduce((map, value) => map.set(value.conclusion, (map.get(value.conclusion) ?? 0) + 1), new Map<string, number>())].sort()), meanSalaryDelta: values.length ? average(values.map(value => value.intervention.candidateSalary - value.intervention.sourceSalary)) : null, meanInterventionPayrollDelta: averagePresent(values.map(value => value.intervention.payrollDelta)), meanFollowupPayrollDelta: averagePresent(values.map(value => value.followup.academyDelta.payrollPaid)), meanFollowupTreasuryDelta: averagePresent(values.map(value => value.followup.academyDelta.treasury))}; }
function format(value: number | null): string { return value === null ? "n/a" : value.toFixed(3); }
function average(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function averagePresent(values: Array<number | null>): number | null { const present = values.filter((value): value is number => value !== null); return present.length ? average(present) : null; }
function digest(bytes: Buffer): string { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function write(file: string, value: unknown): void { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function required(name: string): string { const value = option(name, "").trim(); if (!value) throw new Error(`Missing ${name}`); return value; }
