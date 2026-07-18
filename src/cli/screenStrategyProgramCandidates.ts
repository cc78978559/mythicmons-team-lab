import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import type {StrategyProgramEvolutionAggregate} from "../ai/whiteBox/strategyProgramAggregation";
import {selectBeneficialStrategyProgramSamples, summarizeStrategyProgramScreening, type StrategyProgramScreeningResult} from "../ai/whiteBox/strategyProgramScreening";
import type {StrategyProgramReplicationAggregate} from "../ai/whiteBox/strategyProgramReplication";
import type {StrategyProgramMutationOperator} from "../draft/strategyProgram";

interface SamplerManifest {seeds: Array<{seed: string; status: string; baseline: string}>}

const args = process.argv.slice(2), root = process.cwd();
const sampler = path.resolve(option("--sampler", "output/strategy-program-evolution-sampler")), out = path.resolve(option("--out", "output/strategy-program-candidate-screen"));
const replicas = integerOption("--replicas", 3, 3, 9), horizon = integerOption("--horizon", 2, 2, 2), maximumCandidates = integerOption("--max-candidates", 100, 1, 1000);
const rawEvidence = read<StrategyProgramEvolutionAggregate>(path.join(sampler, "strategy-program-evidence.json")), manifest = read<SamplerManifest>(path.join(sampler, "strategy-program-sampler-manifest.json"));
const evidenceOperator: StrategyProgramMutationOperator = rawEvidence.hypothesis === "compound-observed-boundary-two-season-program-operator-v2" ? "compound-observed-boundary-v2" : "observed-boundary-v1";
const evidence = {...rawEvidence, samples: rawEvidence.samples.map(sample => ({...sample, operator: sample.operator ?? evidenceOperator}))};
const candidates = selectBeneficialStrategyProgramSamples(evidence.samples).slice(0, maximumCandidates);
fs.mkdirSync(out, {recursive: true});
const results: StrategyProgramScreeningResult[] = [];
for (const candidate of candidates) {
  const seedRun = manifest.seeds.find(entry => entry.seed === candidate.seed && entry.status === "complete");
  if (!seedRun) throw new Error(`Sampler manifest has no completed source for ${candidate.seed}`);
  const directory = path.join(out, safe(candidate.seed));
  const run = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "replicateShadowProgram.ts"), "--source", seedRun.baseline, "--out", directory, "--manager", candidate.managerId, "--replicas", String(replicas), "--horizon", String(horizon)], {cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
  if (run.status !== 0) throw new Error(`Candidate screen failed for ${candidate.seed}:\n${run.stderr || run.stdout}`);
  const replication = read<StrategyProgramReplicationAggregate>(path.join(directory, "replication-summary.json"));
  if (replication.candidate.managerId !== candidate.managerId || replication.candidate.programHash !== candidate.candidateProgramHash) throw new Error(`Candidate screen identity drifted for ${candidate.seed}`);
  results.push({seed: candidate.seed, managerId: candidate.managerId, operator: candidate.operator, candidateProgramHash: candidate.candidateProgramHash, sourceDelta: candidate.delta, replicationConclusion: replication.conclusion});
}
const summary = {...summarizeStrategyProgramScreening(results), hypothesis: evidence.hypothesis, sourceEvidence: path.join(sampler, "strategy-program-evidence.json"), settings: {replicas, horizon, maximumCandidates}};
write(path.join(out, "screening-summary.json"), summary);
fs.writeFileSync(path.join(out, "screening-report.md"), markdown(summary), "utf8");
console.log(JSON.stringify({conclusion: summary.conclusion, metrics: summary.metrics, report: path.join(out, "screening-report.md")}, null, 2));

function markdown(value: typeof summary): string { const m = value.metrics; return `# Strategy-program candidate screening\n\n- Hypothesis: ${value.hypothesis}\n- Conclusion: ${value.conclusion}\n- Screened: ${m.screened}\n- Stable / regression / sensitive / no effect: ${m.stable} / ${m.regression} / ${m.sensitive} / ${m.noEffect}\n- Survival rate: ${(m.survivalRate * 100).toFixed(1)}%\n\nOnly source-positive candidates enter this within-source environment screen. Passing remains review evidence, not production activation.\n`; }
function safe(value: string): string { return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "candidate"; }
function write(file: string, value: unknown): void { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integerOption(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`); return value; }
