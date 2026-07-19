import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {aggregateStrategyProgramEvolution, type StrategyProgramCounterfactualSample} from "../ai/whiteBox/strategyProgramAggregation";

const positive = Array.from({length: 10}, (_, index) => sample(index, index < 8 ? 1 : -1));
const supported = aggregateStrategyProgramEvolution(positive);
assert.equal(supported.conclusion, "candidate-for-bounded-active-review");
assert.equal(supported.hypothesis, "observed-boundary-two-season-program-operator-v1");
assert.equal(supported.metrics.betterSeeds, 8);
assert.equal(supported.metrics.oneSidedImprovementP < .1, true);
assert.equal(aggregateStrategyProgramEvolution(Array.from({length: 10}, (_, index) => sample(index, 0))).conclusion, "no-observed-effect");
assert.equal(aggregateStrategyProgramEvolution(Array.from({length: 10}, (_, index) => sample(index, index < 8 ? -1 : 1))).conclusion, "reject-operator");
const compound = positive.map(value => ({...value, operator: "compound-observed-boundary-v2" as const, operatorMutations: ["program.compound-observed-boundary-v2[acquire.observed-boundary.speed@0.5:+2|lineup.observed-boundary.strength@0.4:-1]"]}));
assert.equal(aggregateStrategyProgramEvolution(compound).hypothesis, "compound-observed-boundary-two-season-program-operator-v2");
const margin = positive.map(value => ({...value, operator: "decision-margin-v3" as const, operatorMutations: ["program.acquire.decision-margin-v3.strength@0.5:+0.333334:abcdef1234"]}));
assert.equal(aggregateStrategyProgramEvolution(margin).hypothesis, "decision-margin-two-season-program-operator-v3");
assert.throws(() => aggregateStrategyProgramEvolution([positive[0], compound[1]]), /cannot mix mutation operators/);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-program-sampler-"));
try {
  const out = path.join(root, "sample"), command = [require.resolve("tsx/cli"), path.join(process.cwd(), "src", "cli", "sampleStrategyProgramEvolution.ts"), "--run", "--out", out, "--target-samples", "1", "--minimum-seeds", "1", "--baseline-seasons", "2", "--seeds", "program-semantic-probe", "--managers", "6", "--pairs", "1", "--rounds", "1", "--max-turns", "20", "--retention", "audit-summary"];
  run(command);
  const interrupted = path.join(out, "seeds", "interrupted-seed"); fs.mkdirSync(interrupted, {recursive: true}); fs.writeFileSync(path.join(interrupted, "partial.txt"), "partial");
  const interruptedManifest = read<any>(path.join(out, "strategy-program-sampler-manifest.json"));
  interruptedManifest.seeds.push({seed: "interrupted-seed", status: "running", baseline: path.join(interrupted, "baseline"), completedSeasons: 0, candidates: 0, durationMs: 0});
  fs.writeFileSync(path.join(out, "strategy-program-sampler-manifest.json"), `${JSON.stringify(interruptedManifest, null, 2)}\n`);
  run(command);
  const manifest = read<any>(path.join(out, "strategy-program-sampler-manifest.json")), summary = read<any>(path.join(out, "strategy-program-sampler-summary.json")), evidence = read<any>(path.join(out, "strategy-program-evidence.json"));
  assert.equal(manifest.seeds.length, 1);
  assert.equal(fs.existsSync(interrupted), false);
  assert.equal(manifest.seeds[0].status, "complete");
  assert.equal(summary.progress.complete, true);
  assert.equal(summary.progress.samples, 1);
  assert.equal(summary.failed, 0);
  assert.equal(evidence.conclusion, "insufficient-evidence");
  assert.equal(evidence.samples[0].seed, "program-semantic-probe");
  assert.equal(evidence.samples[0].sourceVerified, true);
  assert.equal(evidence.samples[0].prefixVerified, true);
  assert(evidence.samples[0].behaviorDistance > 0);
  assert(evidence.samples[0].decisionEffects.battleCompared > 0);
  assert(manifest.seeds[0].retention.length >= 1);
  const extended = [...command];
  extended[extended.indexOf("--target-samples") + 1] = "2";
  run(extended);
  const extendedManifest = read<any>(path.join(out, "strategy-program-sampler-manifest.json"));
  assert.equal(extendedManifest.config.targetSamples, 2);
  assert.equal(extendedManifest.seeds.length, 1, "Increasing a target must retain validated seeds without recomputing them");
  assert.notEqual(spawnSync(process.execPath, command, {cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024}).status, 0, "Evidence targets must not decrease in place");
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
console.log("Strategy-program evolution sampler smoke passed");

function sample(index: number, direction: number): StrategyProgramCounterfactualSample {
  return {seed: `seed-${index}`, managerId: `manager-${index}`, operator: "observed-boundary-v1", sourceSeason: 2, activationSeason: 3, evaluationSeason: 4, horizonSeasons: 2, sourceVerified: true, prefixVerified: true, parentProgramHash: `parent-${index}`, candidateProgramHash: `candidate-${index}`, behaviorDistance: .01 + index / 1000, opportunityDistance: .02, choicePotential: .01, operatorMutations: ["program.acquire.observed-boundary.speed@0.5:+2"], decisionEffects: {ledgerCompared: 2, ledgerSelectionDifferences: direction ? 1 : 0, ledgerRecordSetDifferences: 0, programSignalsCompared: 2, programSignalDifferences: 1, battleCompared: 10, battleChoiceDifferences: 0, battleRecordSetDifferences: 0}, delta: {points: direction * 3, rankImprovement: direction, titles: 0, cash: direction}};
}
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function run(command: string[]): void { const result = spawnSync(process.execPath, command, {cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024}); if (result.status !== 0) throw new Error(result.stderr || result.stdout); }
