import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

interface SourceState {seed: string; managers: unknown[]; registry?: {snapshot?: string; [key: string]: unknown}; [key: string]: unknown}
interface SoakSummary {
  status: string;
  violations: string[];
  warnings: string[];
  aggregate: {averageInsolventAcademies: number; averageGuaranteedDebt: number; averagePersonalitySimilarity: number; totalMarketTransactions: number; maximumDebt: number};
  final: {distinctFounders: number; distinctStyles: number; meanPersonalitySimilarity: number; guaranteedDebt: number; academyCount?: number; treasuryTotal: number; population: number};
  metrics: Array<{cycle: number; guaranteedDebt: number}>;
}

const args = process.argv.slice(2), root = process.cwd();
const source = path.resolve(option("--source", "output/test-v12-smoke"));
const out = path.resolve(option("--out", "output/development-ecology-multiseed-v1"));
const seedCount = integerOption("--seed-count", 4, 1, 24), cycles = integerOption("--cycles", 12, 2, 100), recoveryCycles = integerOption("--recovery-cycles", 8, 1, 12), capacity = integerOption("--capacity", 6, 6, 30);
const reuseObservations = args.includes("--reuse-observations");
const sourceFile = path.join(source, "dynasty-state.json"), originalBytes = fs.readFileSync(sourceFile), originalHash = digest(originalBytes), sourceState = JSON.parse(originalBytes.toString("utf8")) as SourceState;
if (!sourceState.seed || sourceState.managers.length < capacity) throw new Error("Source must contain a seed and enough managers");
const seedPrefix = option("--seed-prefix", sourceState.seed);
prepareOutput();

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mythicmons-ecology-seeds-")), reusedVariantSources = new Set<string>(), runs: any[] = [];
try {
  for (let index = 1; index <= seedCount; index += 1) {
    const id = `seed-${String(index).padStart(2, "0")}`, seed = `${seedPrefix}:ecology-validation:${index}`;
    const runOut = path.join(out, id), summaryFile = path.join(runOut, "summary.json"), existingObservation = reuseObservations && fs.existsSync(summaryFile);
    const recordedRoot = existingObservation ? read<{source: {root: string}}>(path.join(runOut, `cycle-${String(cycles).padStart(3, "0")}`, "entrants.json")).source.root : undefined;
    const variantSource = recordedRoot ? path.resolve(recordedRoot) : path.join(tempRoot, id);
    if (recordedRoot) {
      const temporaryRoot = path.resolve(os.tmpdir());
      if (!variantSource.startsWith(`${temporaryRoot}${path.sep}`)) throw new Error(`Refusing to recreate non-temporary source: ${variantSource}`);
      reusedVariantSources.add(variantSource);
    }
    fs.mkdirSync(variantSource, {recursive: true});
    const registry = sourceState.registry ? {...sourceState.registry, snapshot: sourceState.registry.snapshot ? path.resolve(source, sourceState.registry.snapshot) : undefined} : undefined;
    const variantState: SourceState = {...sourceState, seed, registry};
    delete variantState.stateStorage;
    fs.writeFileSync(path.join(variantSource, "dynasty-state.json"), `${JSON.stringify(variantState, null, 2)}\n`, "utf8");
    if (!existingObservation) {
      const command = [require.resolve("tsx/cli"), path.join(root, "src", "cli", "developmentLeagueSoak.ts"), "--source", variantSource, "--out", runOut, "--cycles", String(cycles), "--seasons-per-cycle", "1", "--capacity", String(capacity), "--retention", "compact", "--force"];
      const run = spawnSync(process.execPath, command, {cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
      if (run.status !== 0) throw new Error(`${id} failed:\n${run.stderr || run.stdout}`);
    }
    const summary = read<SoakSummary>(summaryFile);
    let debtRecovery: {tested: boolean; cleared: boolean; cyclesToClear?: number; finalDebt?: number; output?: string} = {tested: false, cleared: summary.final.guaranteedDebt <= 1e-9};
    let recoveryViolations: string[] = [];
    if (summary.final.guaranteedDebt > 1e-9) {
      const recoveryOut = path.join(runOut, "debt-recovery"), previous = path.join(runOut, `cycle-${String(cycles).padStart(3, "0")}`);
      const recoveryCommand = [require.resolve("tsx/cli"), path.join(root, "src", "cli", "developmentLeagueSoak.ts"), "--source", variantSource, "--previous", previous, "--out", recoveryOut, "--cycles", String(recoveryCycles), "--seasons-per-cycle", "1", "--capacity", String(capacity), "--retention", "compact", "--force"];
      const recoveryRun = spawnSync(process.execPath, recoveryCommand, {cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
      if (recoveryRun.status !== 0) throw new Error(`${id} debt recovery failed:\n${recoveryRun.stderr || recoveryRun.stdout}`);
      const recovery = read<SoakSummary>(path.join(recoveryOut, "summary.json")), clearedIndex = recovery.metrics.findIndex(metric => metric.guaranteedDebt <= 1e-9);
      debtRecovery = {tested: true, cleared: clearedIndex >= 0, cyclesToClear: clearedIndex >= 0 ? clearedIndex + 1 : undefined, finalDebt: recovery.final.guaranteedDebt, output: recoveryOut};
      recoveryViolations = recovery.violations;
    }
    const violations = [...summary.violations, ...recoveryViolations.map(value => `recovery:${value}`)];
    const warnings = summary.warnings.filter(value => value !== "final-guaranteed-debt-above-zero");
    if (summary.final.guaranteedDebt > 1e-9 && !debtRecovery.cleared) warnings.push("debt-not-cleared-within-recovery-window");
    const status = violations.length ? "failed" : warnings.length ? "passed-with-warnings" : "passed";
    runs.push({id, seed, sourceHash: digest(fs.readFileSync(path.join(variantSource, "dynasty-state.json"))), status, violations, warnings, observationWarnings: summary.warnings, debtRecovery, aggregate: summary.aggregate, final: summary.final, output: runOut});
    console.log(`${id}: ${status}, founders ${summary.final.distinctFounders}, styles ${summary.final.distinctStyles}, similarity ${summary.final.meanPersonalitySimilarity.toFixed(3)}, debt ${summary.final.guaranteedDebt.toFixed(2)}, recovery ${debtRecovery.tested ? debtRecovery.cleared ? `${debtRecovery.cyclesToClear} cycle(s)` : "not cleared" : "not needed"}`);
  }
} finally {
  fs.rmSync(tempRoot, {recursive: true, force: true});
  for (const reusedSource of reusedVariantSources) fs.rmSync(reusedSource, {recursive: true, force: true});
}
if (digest(fs.readFileSync(sourceFile)) !== originalHash) throw new Error("Original source changed during multi-seed validation");

const hardFailureRuns = runs.filter(run => run.violations.length > 0).length, warningRuns = runs.filter(run => run.warnings.length > 0).length;
const summary = {
  schemaVersion: 1,
  name: "development-ecology-multiseed-v1",
  source: {path: source, sha256: originalHash, seed: sourceState.seed, managers: sourceState.managers.length},
  configuration: {seedCount, seedPrefix, cycles, recoveryCycles, capacity, profile: {academyGrantPool: 105, academySigningFee: 8, academyMarketOfferPercent: 115, academyEmergencySaleDiscountPercent: 35}},
  status: hardFailureRuns ? "failed" : warningRuns ? "passed-with-warnings" : "passed",
  hardFailureRuns,
  warningRuns,
  aggregate: {
    totalRuns: runs.length,
    observationCycles: runs.length * cycles,
    recoveryCyclesExecuted: runs.filter(run => run.debtRecovery.tested).length * recoveryCycles,
    unrecoveredDebtRuns: runs.filter(run => run.debtRecovery.tested && !run.debtRecovery.cleared).length,
    minimumFinalFounders: Math.min(...runs.map(run => run.final.distinctFounders)),
    minimumFinalStyles: Math.min(...runs.map(run => run.final.distinctStyles)),
    maximumFinalSimilarity: Math.max(...runs.map(run => run.final.meanPersonalitySimilarity)),
    maximumAverageInsolvency: Math.max(...runs.map(run => run.aggregate.averageInsolventAcademies)),
    maximumDebt: Math.max(...runs.map(run => run.aggregate.maximumDebt)),
    maximumFinalDebt: Math.max(...runs.map(run => run.final.guaranteedDebt)),
    minimumMarketTransactions: Math.min(...runs.map(run => run.aggregate.totalMarketTransactions)),
    averageMarketTransactions: average(runs.map(run => run.aggregate.totalMarketTransactions)),
    averageFinalTreasury: average(runs.map(run => run.final.treasuryTotal / (run.final.academyCount ?? run.final.population))),
  },
  runs,
};
writeJson(path.join(out, "summary.json"), summary);
fs.writeFileSync(path.join(out, "report.md"), report(summary), "utf8");
console.log(JSON.stringify({status: summary.status, hardFailureRuns, warningRuns, aggregate: summary.aggregate, output: out}, null, 2));
if (hardFailureRuns) process.exitCode = 1;

function report(value: any): string { return `# Development ecology multi-seed validation v1\n\nStatus: **${value.status}**  \nRuns: ${value.aggregate.totalRuns}  \nObservation cycles: ${value.aggregate.observationCycles}  \nRecovery cycles executed: ${value.aggregate.recoveryCyclesExecuted}  \nHard-failure runs: ${value.hardFailureRuns}  \nWarning runs: ${value.warningRuns}\n\n| Seed | Status | Warnings | Founders | Styles | Similarity | Deals | Avg insolvency | Max debt | End debt | Debt recovery | Avg treasury |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|\n${value.runs.map((run: any) => `| ${run.id} | ${run.status} | ${run.warnings.length} | ${run.final.distinctFounders} | ${run.final.distinctStyles} | ${run.final.meanPersonalitySimilarity.toFixed(3)} | ${run.aggregate.totalMarketTransactions} | ${run.aggregate.averageInsolventAcademies.toFixed(2)} | ${run.aggregate.maximumDebt.toFixed(2)} | ${run.final.guaranteedDebt.toFixed(2)} | ${run.debtRecovery.tested ? run.debtRecovery.cleared ? `cleared in ${run.debtRecovery.cyclesToClear}` : "not cleared" : "not needed"} | ${(run.final.treasuryTotal / (run.final.academyCount ?? run.final.population)).toFixed(1)} |`).join("\n")}\n\n## Worst-case envelope\n\n- Minimum final founders: ${value.aggregate.minimumFinalFounders}\n- Minimum final styles: ${value.aggregate.minimumFinalStyles}\n- Maximum final similarity: ${value.aggregate.maximumFinalSimilarity.toFixed(3)}\n- Maximum average insolvency: ${value.aggregate.maximumAverageInsolvency.toFixed(2)}\n- Maximum debt: ${value.aggregate.maximumDebt.toFixed(2)}\n- Maximum observation-end debt: ${value.aggregate.maximumFinalDebt.toFixed(2)}\n- Unrecovered debt runs: ${value.aggregate.unrecoveredDebtRuns}\n- Minimum market transactions: ${value.aggregate.minimumMarketTransactions}\n` }
function prepareOutput(): void { if (!fs.existsSync(out)) { fs.mkdirSync(out, {recursive: true}); return; } if (reuseObservations) return; if (!args.includes("--force")) throw new Error(`Output exists: ${out}; pass --force to replace it`); const resolved = path.resolve(out); if (path.parse(resolved).root === resolved || resolved === root || resolved === source || source.startsWith(`${resolved}${path.sep}`)) throw new Error(`Unsafe output: ${resolved}`); fs.rmSync(resolved, {recursive: true, force: true}); fs.mkdirSync(resolved, {recursive: true}); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integerOption(name: string, fallback: number, min: number, max: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function digest(bytes: Buffer): string { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function average(values: number[]): number { return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function writeJson(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
