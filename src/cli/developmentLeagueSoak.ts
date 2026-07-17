import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {classifyEmergentStyle, type ManagerProfile} from "../draft/managerProfiles";
import {personalitySimilarity} from "../draft/personalitySimilarity";

interface SourceState {version: number; seed: string; completedSeason: number; managers: Array<{id: string}>}
interface CycleMetric {
  cycle: number; population: number; births: number; promoted: number; eliminated: number; lifecycleRetired: number;
  distinctFounders: number; maximumFounderShare: number; maximumGeneration: number; distinctStyles: number;
  meanPersonalitySimilarity: number; maximumPersonalitySimilarity: number; meanTraitVariance: number;
  marketExecuted: number; marketRejected: number; emergencySales: number; emergencySaleCandidates: number; payroll: number; newArrears: number;
  guaranteedDebt: number; academyCount: number; treasuryTotal: number; treasuryMinimum: number;
  healthy: number; strained: number; distressed: number; insolvent: number; recoveryPlans: number; trusteeships: number;
}

const args = process.argv.slice(2), root = process.cwd();
const source = path.resolve(option("--source", "output/test-v12-smoke"));
const out = path.resolve(option("--out", "output/development-ecology-baseline-v1"));
const cycles = integerOption("--cycles", 12, 2, 100), seasons = integerOption("--seasons-per-cycle", 1, 1, 6), capacity = integerOption("--capacity", 6, 6, 30);
const academyGrantPool = integerOption("--academy-grant-pool", 105, 0, 100000), academySigningFee = integerOption("--academy-signing-fee", 8, 0, 10000), academyMarketOfferPercent = integerOption("--academy-market-offer-percent", 115, 50, 200), academyEmergencySaleDiscountPercent = integerOption("--academy-emergency-sale-discount-percent", 35, 0, 90);
const retention = option("--retention", "compact");
if (retention !== "compact" && retention !== "all") throw new Error("--retention must be compact or all");
const sourceFile = path.join(source, "dynasty-state.json"), sourceState = read<SourceState>(sourceFile), sourceHash = digest(fs.readFileSync(sourceFile));
if (sourceState.managers.length < 6) throw new Error("Development soak requires at least six source managers");
const initialPreviousValue = option("--previous", "").trim(), initialPrevious = initialPreviousValue ? path.resolve(initialPreviousValue) : undefined;
if (initialPrevious && !fs.existsSync(path.join(initialPrevious, "entrants.json"))) throw new Error(`Previous development cycle is missing entrants.json: ${initialPrevious}`);
prepareOutput();

const startedAt = new Date().toISOString(), startedMs = Date.now(), metrics: CycleMetric[] = [], violations: string[] = [], warnings: string[] = [];
const keepCycles = new Set([1, Math.ceil(cycles / 2), cycles]);
let previous: string | undefined = initialPrevious;
for (let cycle = 1; cycle <= cycles; cycle += 1) {
  const cycleDir = path.join(out, `cycle-${String(cycle).padStart(3, "0")}`), command = [require.resolve("tsx/cli"), path.join(root, "src", "cli", "developmentLeague.ts"), "--source", source, "--out", cycleDir, "--seasons", String(seasons), "--capacity", String(capacity), "--parent-limit", "6", "--promotion-slots", "1", "--elimination-slots", "1", "--development-parent-percent", "50", "--max-founder-share-percent", "50", "--kinship-depth", "2", "--max-parent-similarity-percent", "90", "--academy-grant-pool", String(academyGrantPool), "--academy-market-policy", "active", "--academy-market-consent-policy", "enforce", "--academy-market-contract-policy", "enforce", "--academy-market-offer-percent", String(academyMarketOfferPercent), "--academy-market-max-transactions", "2", "--academy-signing-fee", String(academySigningFee), "--academy-emergency-sale-discount-percent", String(academyEmergencySaleDiscountPercent), "--regular-rounds", "1", "--max-turns", "20"];
  if (previous) command.push("--previous", previous);
  const run = spawnSync(process.execPath, command, {cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
  if (run.status !== 0) throw new Error(`Cycle ${cycle} failed:\n${run.stderr || run.stdout}`);
  const entrants = read<any>(path.join(cycleDir, "entrants.json")), summary = read<any>(path.join(cycleDir, "development-summary.json")), state = read<any>(path.join(cycleDir, "league", "dynasty-state.json"));
  const metric = cycleMetric(cycle, entrants, summary, state); metrics.push(metric); validateCycle(metric, entrants, summary, violations);
  previous = cycleDir;
  const removable = cycle - 2;
  if (retention === "compact" && removable > 0 && !keepCycles.has(removable)) fs.rmSync(path.join(out, `cycle-${String(removable).padStart(3, "0")}`), {recursive: true, force: true});
  console.log(`Development soak cycle ${cycle}/${cycles}: founders ${metric.distinctFounders}, similarity ${metric.meanPersonalitySimilarity.toFixed(3)}, debt ${metric.guaranteedDebt.toFixed(2)}, insolvent ${metric.insolvent}`);
}
if (digest(fs.readFileSync(sourceFile)) !== sourceHash) violations.push("major-league-source-mutated");
if (retention === "compact") for (let cycle = 1; cycle <= cycles; cycle += 1) if (!keepCycles.has(cycle)) fs.rmSync(path.join(out, `cycle-${String(cycle).padStart(3, "0")}`), {recursive: true, force: true});

const final = metrics.at(-1)!, averageInsolvent = average(metrics.map(metric => metric.insolvent)), averageDebt = average(metrics.map(metric => metric.guaranteedDebt)), averageSimilarity = average(metrics.map(metric => metric.meanPersonalitySimilarity));
if (final.distinctFounders < 2) warnings.push("final-founder-diversity-below-2");
if (final.distinctStyles < 2) warnings.push("final-style-diversity-below-2");
if (averageSimilarity > .97) warnings.push("mean-personality-similarity-above-0.97");
if (averageInsolvent > capacity / 3) warnings.push("average-insolvent-academies-above-one-third");
const totalMarketTransactions = sum(metrics.map(metric => metric.marketExecuted)), totalEmergencySales = sum(metrics.map(metric => metric.emergencySales)), totalEmergencySaleCandidates = sum(metrics.map(metric => metric.emergencySaleCandidates));
if (totalMarketTransactions < Math.ceil(cycles / 3)) warnings.push("market-transactions-below-one-per-three-cycles");
if (final.treasuryTotal / final.academyCount > 60) warnings.push("final-average-academy-treasury-above-60");
if (final.guaranteedDebt > 1e-9) warnings.push("final-guaranteed-debt-above-zero");
const baseline = {schemaVersion: 1, name: "development-ecology-v1", createdAt: new Date().toISOString(), source: {path: source, sha256: sourceHash, version: sourceState.version, seed: sourceState.seed, completedSeason: sourceState.completedSeason, managers: sourceState.managers.length}, configuration: {cycles, seasonsPerCycle: seasons, capacity, previous: initialPrevious, academyGrantPool, academySigningFee, academyMarketOfferPercent, academyEmergencySaleDiscountPercent, marketPolicy: "active", consentPolicy: "enforce", contractPolicy: "enforce", retention, retainedCycles: [...keepCycles].sort((a, b) => a - b)}, acceptance: {hard: ["source immutable", "population equals capacity", "unique active child ids", "nonnegative treasury", "all economic conservation errors <= 1e-6"], advisory: ["at least two final founders", "at least two final styles", "mean personality similarity <= 0.97", "average insolvency <= one third", "at least one executed market transaction per three cycles", "final average academy treasury <= 60", "final guaranteed debt equals zero"], coverage: ["count emergency-sale-eligible contracts and completed emergency sales; execution is verified by a focused deterministic test"]}};
const summary = {schemaVersion: 1, baseline: baseline.name, status: violations.length ? "failed" : warnings.length ? "passed-with-warnings" : "passed", startedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - startedMs, cyclesCompleted: metrics.length, violations, warnings, aggregate: {averageInsolventAcademies: averageInsolvent, averageGuaranteedDebt: averageDebt, averagePersonalitySimilarity: averageSimilarity, totalBirths: sum(metrics.map(metric => metric.births)), totalEmergencySales, totalEmergencySaleCandidates, totalMarketTransactions, maximumDebt: Math.max(...metrics.map(metric => metric.guaranteedDebt)), maximumMeanSimilarity: Math.max(...metrics.map(metric => metric.meanPersonalitySimilarity))}, final, metrics};
writeJson(path.join(out, "baseline.json"), baseline); writeJson(path.join(out, "summary.json"), summary); fs.writeFileSync(path.join(out, "report.md"), report(summary), "utf8");
console.log(JSON.stringify({status: summary.status, cycles: metrics.length, violations, warnings, output: out}, null, 2));
if (violations.length) process.exitCode = 1;

function cycleMetric(cycle: number, entrants: any, summary: any, state: any): CycleMetric {
  const rows = [...summary.promoted, ...summary.retained, ...summary.eliminated], founderCounts = new Map<string, number>(), profiles: ManagerProfile[] = state.managers.map((manager: any) => manager.currentProfile);
  for (const entrant of entrants.entrants) founderCounts.set(entrant.lineage.founderId, (founderCounts.get(entrant.lineage.founderId) ?? 0) + 1);
  const similarities: number[] = [];
  for (let left = 0; left < profiles.length; left += 1) for (let right = left + 1; right < profiles.length; right += 1) similarities.push(personalitySimilarity(profiles[left], profiles[right]).similarity);
  const traitKeys = ["risk", "stars", "synergy", "counter", "value", "flexibility"] as const, traitVariance = traitKeys.map(key => variance(profiles.map(profile => profile.traits[key])));
  const health = entrants.academyFinancialHealth ?? [], market = entrants.talentMarket?.transactions ?? [], debts = entrants.salaryDebts ?? [], academies = entrants.academies ?? [];
  return {cycle, population: entrants.entrants.length, births: summary.births, promoted: summary.promoted.length, eliminated: summary.eliminated.length, lifecycleRetired: summary.lifecycleRetired.length, distinctFounders: founderCounts.size, maximumFounderShare: Math.max(0, ...founderCounts.values()) / Math.max(1, entrants.entrants.length), maximumGeneration: Math.max(0, ...entrants.entrants.map((entrant: any) => entrant.generation ?? entrant.lineage.generation)), distinctStyles: new Set(rows.map((row: any) => row.style.label)).size, meanPersonalitySimilarity: average(similarities), maximumPersonalitySimilarity: Math.max(0, ...similarities), meanTraitVariance: average(traitVariance), marketExecuted: market.filter((transaction: any) => transaction.status === "executed").length, marketRejected: market.filter((transaction: any) => transaction.status === "rejected").length, emergencySales: market.filter((transaction: any) => transaction.status === "executed" && transaction.financialIntervention === "emergency-sale").length, emergencySaleCandidates: entrants.talentMarket.emergencySaleCandidates ?? 0, payroll: entrants.contracts.payrollOutflow, newArrears: entrants.contracts.arrears, guaranteedDebt: sum(debts.map((debt: any) => debt.amount)), academyCount: academies.length, treasuryTotal: sum(academies.map((academy: any) => academy.treasury)), treasuryMinimum: Math.min(...academies.map((academy: any) => academy.treasury)), healthy: health.filter((value: any) => value.status === "healthy").length, strained: health.filter((value: any) => value.status === "strained").length, distressed: health.filter((value: any) => value.status === "distressed").length, insolvent: health.filter((value: any) => value.status === "insolvent").length, recoveryPlans: (entrants.academyRecoveryPlans ?? []).filter((value: any) => value.state !== "normal").length, trusteeships: (entrants.academyFinancialControls ?? []).filter((value: any) => value.trusteeship).length};
}
function validateCycle(metric: CycleMetric, entrants: any, summary: any, failures: string[]): void {
  const prefix = `cycle-${metric.cycle}`;
  if (metric.population !== capacity) failures.push(`${prefix}:population-${metric.population}-not-${capacity}`);
  if (new Set(entrants.entrants.map((entry: any) => entry.childId)).size !== metric.population) failures.push(`${prefix}:duplicate-child-id`);
  if (metric.treasuryMinimum < -1e-9) failures.push(`${prefix}:negative-treasury`);
  const errors = [entrants.talentMarket.conservationError, entrants.contracts.conservationError, entrants.salaryGuarantees.conservationError, summary.academyEconomy.conservationError];
  if (errors.some(error => !Number.isFinite(error) || Math.abs(error) > 1e-6)) failures.push(`${prefix}:economic-conservation`);
  if (Object.values(metric).some(value => typeof value === "number" && !Number.isFinite(value))) failures.push(`${prefix}:non-finite-metric`);
}
function report(summary: any): string { const final = summary.final, aggregate = summary.aggregate; return `# Development ecology soak\n\nStatus: **${summary.status}**  \nCycles: ${summary.cyclesCompleted}  \nDuration: ${(summary.durationMs / 1000).toFixed(1)} seconds  \nViolations: ${summary.violations.length}  \nWarnings: ${summary.warnings.length}\n\n## Final ecology\n\n- Population: ${final.population}\n- Founders: ${final.distinctFounders}\n- Maximum founder share: ${(final.maximumFounderShare * 100).toFixed(1)}%\n- Maximum generation: ${final.maximumGeneration}\n- Styles: ${final.distinctStyles}\n- Mean personality similarity: ${final.meanPersonalitySimilarity.toFixed(3)}\n- Mean trait variance: ${final.meanTraitVariance.toFixed(5)}\n- Guaranteed debt: ${final.guaranteedDebt.toFixed(2)}\n- Financial health: ${final.healthy} healthy, ${final.strained} strained, ${final.distressed} distressed, ${final.insolvent} insolvent\n\n## Aggregate\n\n- Births: ${aggregate.totalBirths}\n- Executed market transactions: ${aggregate.totalMarketTransactions}\n- Emergency-sale candidates: ${aggregate.totalEmergencySaleCandidates}\n- Emergency sales: ${aggregate.totalEmergencySales}\n- Average guaranteed debt: ${aggregate.averageGuaranteedDebt.toFixed(2)}\n- Maximum guaranteed debt: ${aggregate.maximumDebt.toFixed(2)}\n- Average insolvent academies: ${aggregate.averageInsolventAcademies.toFixed(2)}\n- Average personality similarity: ${aggregate.averagePersonalitySimilarity.toFixed(3)}\n\n## Findings\n\n${summary.violations.length ? summary.violations.map((value: string) => `- HARD: ${value}`).join("\n") : "- No hard invariant violation."}\n${summary.warnings.length ? summary.warnings.map((value: string) => `- Advisory: ${value}`).join("\n") : "- No advisory warning."}\n`; }
function prepareOutput(): void { if (!fs.existsSync(out)) { fs.mkdirSync(out, {recursive: true}); return; } if (!args.includes("--force")) throw new Error(`Soak output exists: ${out}; pass --force to replace it`); const resolved = path.resolve(out); if (path.parse(resolved).root === resolved || resolved === root || resolved === source || source.startsWith(`${resolved}${path.sep}`)) throw new Error(`Unsafe soak output: ${resolved}`); fs.rmSync(resolved, {recursive: true, force: true}); fs.mkdirSync(resolved, {recursive: true}); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integerOption(name: string, fallback: number, min: number, max: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function variance(values: number[]): number { const mean = average(values); return average(values.map(value => (value - mean) ** 2)); }
function average(values: number[]): number { return values.length ? sum(values) / values.length : 0; }
function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0); }
function digest(value: Buffer): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function writeJson(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
