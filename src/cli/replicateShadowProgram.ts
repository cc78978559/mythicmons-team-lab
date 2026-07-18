import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {aggregateStrategyProgramReplicas, type StrategyProgramReplicaSample} from "../ai/whiteBox/strategyProgramReplication";
import {compactWhiteBoxRun} from "../ai/whiteBox/retention";

interface CounterfactualSummary {
  source: string;
  sourceVerified: boolean; prefixVerified: boolean; sourceSeason: number; horizonSeasons: number; continuationSalt: string | null;
  isolatedDifference: {managerId: string; candidateProgramHash: string};
  decisionEffects: Record<string, number>;
  delta: StrategyProgramReplicaSample["delta"];
}

const args = process.argv.slice(2), root = process.cwd();
const source = path.resolve(option("--source", "output/draft-league-v12")), out = path.resolve(option("--out", "output/shadow-program-replicas"));
const manager = option("--manager", ""), replicas = integerOption("--replicas", 3, 3, 9), horizon = integerOption("--horizon", 2, 2, 2);
if (!manager) throw new Error("--manager is required for candidate replication");
fs.mkdirSync(out, {recursive: true});
const samples: StrategyProgramReplicaSample[] = [];
for (let index = 1; index <= replicas; index += 1) {
  const salt = `replica-${String(index).padStart(2, "0")}`, directory = path.join(out, salt), summaryFile = path.join(directory, "counterfactual-summary.json");
  if (!fs.existsSync(summaryFile)) {
    if (fs.existsSync(directory)) removeIncompleteReplica(directory);
    const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "counterfactualShadowProgram.ts"), "--source", source, "--out", directory, "--manager", manager, "--horizon", String(horizon), "--continuation-salt", salt], {cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
    if (result.status !== 0) throw new Error(`Strategy-program replica ${salt} failed:\n${result.stderr || result.stdout}`);
  }
  const summary = read<CounterfactualSummary>(summaryFile);
  if (path.resolve(summary.source) !== source || summary.isolatedDifference.managerId !== manager || summary.horizonSeasons !== horizon || summary.continuationSalt !== salt) throw new Error(`Replica ${salt} does not match the requested source, manager, horizon, and environment`);
  samples.push({continuationSalt: requiredSalt(summary), sourceVerified: summary.sourceVerified, prefixVerified: summary.prefixVerified, sourceSeason: summary.sourceSeason, horizonSeasons: summary.horizonSeasons, managerId: summary.isolatedDifference.managerId, candidateProgramHash: summary.isolatedDifference.candidateProgramHash, decisionDifferences: Object.entries(summary.decisionEffects).filter(([key]) => key.endsWith("Differences")).reduce((sum, [, value]) => sum + value, 0), delta: summary.delta});
  for (const branch of ["experiment", "control"]) compactWhiteBoxRun(path.join(directory, branch));
}
const aggregate = aggregateStrategyProgramReplicas(samples);
write(path.join(out, "replication-summary.json"), aggregate);
fs.writeFileSync(path.join(out, "replication-report.md"), markdown(aggregate), "utf8");
console.log(JSON.stringify({conclusion: aggregate.conclusion, candidate: aggregate.candidate, metrics: aggregate.metrics, report: path.join(out, "replication-report.md")}, null, 2));

function markdown(value: ReturnType<typeof aggregateStrategyProgramReplicas>): string { const m = value.metrics; return `# Strategy-program candidate replicas\n\n- Conclusion: ${value.conclusion}\n- Manager: ${value.candidate.managerId}\n- Candidate: \`${value.candidate.programHash}\`\n- Source season / horizon: ${value.candidate.sourceSeason} / ${value.candidate.horizonSeasons}\n- Better / neutral / worse: ${m.better} / ${m.neutral} / ${m.worse}\n- Decision-divergent replicas: ${m.decisionDivergence}/${m.replicas}\n- Mean points / rank / titles / cash: ${signed(m.meanPointsDelta)} / ${signed(m.meanRankImprovement)} / ${signed(m.meanTitlesDelta)} / ${signed(m.meanCashDelta)}\n\nThis is within-source robustness evidence, not independent cross-seed activation evidence.\n`; }
function requiredSalt(value: CounterfactualSummary): string { if (!value.continuationSalt) throw new Error("Replica summary is missing its continuation salt"); return value.continuationSalt; }
function removeIncompleteReplica(directory: string): void { const target = path.resolve(directory); if (target === out || !target.startsWith(`${out}${path.sep}`)) throw new Error(`Unsafe incomplete replica path: ${target}`); fs.rmSync(target, {recursive: true, force: true}); }
function write(file: string, value: unknown): void { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integerOption(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`); return value; }
function signed(value: number): string { return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`; }
