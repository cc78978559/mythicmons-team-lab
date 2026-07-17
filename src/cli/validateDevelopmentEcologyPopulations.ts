import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";

const args = process.argv.slice(2), root = process.cwd(), out = path.resolve(option("--out", "output/development-ecology-populations-v1"));
const sources = option("--sources", "output/test-v12-smoke,output/whitebox-memory-v12,output/whitebox-ai-import-league").split(",").map(value => path.resolve(value.trim())).filter(Boolean);
const cycles = integerOption("--cycles", 12, 2, 100), recoveryCycles = integerOption("--recovery-cycles", 8, 1, 12), capacity = integerOption("--capacity", 6, 6, 30), seedPrefix = option("--seed-prefix", "development-population-validation-v1");
if (sources.length < 2) throw new Error("Population validation requires at least two comma-separated sources");
prepareOutput();

const populations: any[] = [];
for (let index = 0; index < sources.length; index += 1) {
  const source = sources[index], id = `${String(index + 1).padStart(2, "0")}-${safeId(path.basename(source))}`, populationOut = path.join(out, id);
  if (!fs.existsSync(path.join(source, "dynasty-state.json"))) throw new Error(`Missing dynasty-state.json: ${source}`);
  const command = [require.resolve("tsx/cli"), path.join(root, "src", "cli", "validateDevelopmentEcologySeeds.ts"), "--source", source, "--out", populationOut, "--seed-count", "1", "--seed-prefix", seedPrefix, "--cycles", String(cycles), "--recovery-cycles", String(recoveryCycles), "--capacity", String(capacity), "--force"];
  const run = spawnSync(process.execPath, command, {cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
  if (run.status !== 0) throw new Error(`${id} failed:\n${run.stderr || run.stdout}`);
  const summary = read<any>(path.join(populationOut, "summary.json")), world = summary.runs[0];
  populations.push({id, source: summary.source, status: summary.status, hardFailureRuns: summary.hardFailureRuns, warningRuns: summary.warningRuns, aggregate: summary.aggregate, world, output: populationOut});
  console.log(`${id}: ${summary.status}, managers ${summary.source.managers}, founders ${world.final.distinctFounders}, styles ${world.final.distinctStyles}, similarity ${world.final.meanPersonalitySimilarity.toFixed(3)}`);
}

const hardFailures = populations.filter(value => value.hardFailureRuns > 0).length, warnings = populations.filter(value => value.warningRuns > 0).length;
const summary = {
  schemaVersion: 1,
  name: "development-ecology-populations-v1",
  status: hardFailures ? "failed" : warnings ? "passed-with-warnings" : "passed",
  configuration: {sources, seedPrefix, cycles, recoveryCycles, capacity},
  hardFailurePopulations: hardFailures,
  warningPopulations: warnings,
  envelope: {
    minimumFinalFounders: Math.min(...populations.map(value => value.world.final.distinctFounders)),
    minimumFinalStyles: Math.min(...populations.map(value => value.world.final.distinctStyles)),
    maximumFinalSimilarity: Math.max(...populations.map(value => value.world.final.meanPersonalitySimilarity)),
    maximumAverageInsolvency: Math.max(...populations.map(value => value.world.aggregate.averageInsolventAcademies)),
    maximumDebt: Math.max(...populations.map(value => value.world.aggregate.maximumDebt)),
    unrecoveredDebtPopulations: populations.filter(value => value.aggregate.unrecoveredDebtRuns > 0).length,
    minimumMarketTransactions: Math.min(...populations.map(value => value.world.aggregate.totalMarketTransactions)),
  },
  populations,
};
writeJson(path.join(out, "summary.json"), summary); fs.writeFileSync(path.join(out, "report.md"), report(summary), "utf8");
console.log(JSON.stringify({status: summary.status, hardFailures, warnings, envelope: summary.envelope, output: out}, null, 2));
if (hardFailures) process.exitCode = 1;

function report(value: any): string { return `# Development ecology population validation v1\n\nStatus: **${value.status}**  \nPopulations: ${value.populations.length}  \nShared world seed: ${value.configuration.seedPrefix}  \nHard-failure populations: ${value.hardFailurePopulations}  \nWarning populations: ${value.warningPopulations}\n\n| Population | Source managers | Status | Founders | Styles | Similarity | Deals | Avg insolvency | Max debt | Debt recovery |\n|---|---:|---|---:|---:|---:|---:|---:|---:|---|\n${value.populations.map((entry: any) => `| ${entry.id} | ${entry.source.managers} | ${entry.status} | ${entry.world.final.distinctFounders} | ${entry.world.final.distinctStyles} | ${entry.world.final.meanPersonalitySimilarity.toFixed(3)} | ${entry.world.aggregate.totalMarketTransactions} | ${entry.world.aggregate.averageInsolventAcademies.toFixed(2)} | ${entry.world.aggregate.maximumDebt.toFixed(2)} | ${entry.world.debtRecovery.tested ? entry.world.debtRecovery.cleared ? `cleared in ${entry.world.debtRecovery.cyclesToClear}` : "not cleared" : "not needed"} |`).join("\n")}\n\n## Worst-case envelope\n\n- Minimum final founders: ${value.envelope.minimumFinalFounders}\n- Minimum final styles: ${value.envelope.minimumFinalStyles}\n- Maximum final similarity: ${value.envelope.maximumFinalSimilarity.toFixed(3)}\n- Maximum average insolvency: ${value.envelope.maximumAverageInsolvency.toFixed(2)}\n- Maximum debt: ${value.envelope.maximumDebt.toFixed(2)}\n- Unrecovered debt populations: ${value.envelope.unrecoveredDebtPopulations}\n- Minimum market transactions: ${value.envelope.minimumMarketTransactions}\n`; }
function prepareOutput(): void { if (!fs.existsSync(out)) { fs.mkdirSync(out, {recursive: true}); return; } if (!args.includes("--force")) throw new Error(`Output exists: ${out}; pass --force to replace it`); const resolved = path.resolve(out); if (path.parse(resolved).root === resolved || resolved === root || sources.some(source => resolved === source || source.startsWith(`${resolved}${path.sep}`))) throw new Error(`Unsafe output: ${resolved}`); fs.rmSync(resolved, {recursive: true, force: true}); fs.mkdirSync(resolved, {recursive: true}); }
function safeId(value: string): string { return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "population"; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integerOption(name: string, fallback: number, min: number, max: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function writeJson(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
