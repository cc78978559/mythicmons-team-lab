import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {parseArgs, numberArg, stringArg} from "../showdown/args";
import {runBattle, type BattleInput, type BattleResult} from "../showdown/battle";
import {loadTeam} from "../showdown/team";
import {recommendedBattleWorkers, runBattleWorkerPool} from "../draft/battleWorkerPool";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2)), baselineGames = numberArg(args, "baseline-games", 32, {integer: true, min: 1}), optimizedGames = numberArg(args, "optimized-games", Math.max(320, baselineGames * 10), {integer: true, min: baselineGames}), maxTurns = numberArg(args, "max-turns", 40, {integer: true, min: 1}), workers = numberArg(args, "workers", recommendedBattleWorkers(optimizedGames), {integer: true, min: 1}), target = numberArg(args, "target", 0, {min: 0}), referenceGps = numberArg(args, "reference-gps", 0, {min: 0}), out = path.resolve(stringArg(args, "out", "output/tooling/self-play-throughput"));
  if (target > 0 && referenceGps <= 0) throw new Error("--target requires a measured pre-change --reference-gps");
  const teamA = loadTeam(stringArg(args, "team-a", "examples/teamA.txt")).packed, teamB = loadTeam(stringArg(args, "team-b", "examples/teamB.txt")).packed, runRoot = path.join(out, `.run-${process.pid}-${Date.now()}`); fs.mkdirSync(runRoot, {recursive: true});
  try {
    const baselineInputs = inputs(baselineGames, "baseline", "full"), baseline = await measured(() => sequential(baselineInputs));
    const optimizedInputs = inputs(optimizedGames, "optimized", "training"), optimized = await measured(() => runBattleWorkerPool(optimizedInputs, workers));
    for (let index = 0; index < baselineGames; index += 1) assertSameOutcome(baseline.results[index], optimized.results[index]);
    const baselineGps = baselineGames * 1000 / baseline.elapsedMs, optimizedGps = optimizedGames * 1000 / optimized.elapsedMs, currentParallelScaling = optimizedGps / baselineGps, referenceSpeedup = referenceGps > 0 ? optimizedGps / referenceGps : null, technicalFailures = optimized.results.filter(result => result.stalled || result.errors.length).length, gateSpeedup = referenceSpeedup ?? currentParallelScaling;
    const report = {schemaVersion: 1, benchmark: "self-play-throughput-v1", generatedAt: new Date().toISOString(), hardware: {platform: process.platform, logicalProcessors: os.availableParallelism(), cpu: os.cpus()[0]?.model ?? "unknown"}, workload: {ai: "search", openTeamSheets: true, traceAiDecisions: true, maxTurns, baselineGames, optimizedGames, workers}, evidence: {baselineArtifacts: "full", optimizedArtifacts: "training", behavioralParityGames: baselineGames, trainingAuthority: "decision-learning-only-not-formal-white-box"}, baseline: metrics(baseline.results, baseline.elapsedMs), optimized: metrics(optimized.results, optimized.elapsedMs), preChangeReferenceGamesPerSecond: referenceGps || null, currentParallelScaling: round(currentParallelScaling), referenceSpeedup: referenceSpeedup === null ? null : round(referenceSpeedup), targetSpeedup: target || null, technicalFailures, passed: technicalFailures === 0 && (target === 0 || gateSpeedup >= target)};
    fs.mkdirSync(out, {recursive: true}); fs.writeFileSync(path.join(out, "benchmark.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"); console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 2;
  } finally { fs.rmSync(runRoot, {recursive: true, force: true}); }

  function inputs(count: number, label: string, artifactMode: "full" | "training"): BattleInput[] { return Array.from({length: count}, (_, gameIndex) => ({format: "gen9ou", teamA, teamB, seed: `self-play-throughput:${gameIndex}`, gameIndex, outDir: path.join(runRoot, label), maxTurns, idleTimeoutMs: 10000, wallClockTimeoutMs: 60000, ai: "search", openTeamSheets: true, traceAiDecisions: true, artifactMode})); }
}

async function measured(run: () => Promise<BattleResult[]>): Promise<{results: BattleResult[]; elapsedMs: number}> { const started = performance.now(), results = await run(); return {results, elapsedMs: performance.now() - started}; }
async function sequential(inputs: readonly BattleInput[]): Promise<BattleResult[]> { const results: BattleResult[] = []; for (const input of inputs) results.push(await runBattle(input)); return results; }
function assertSameOutcome(left: BattleResult, right: BattleResult): void { if (left.winner !== right.winner || left.turns !== right.turns || left.timeout !== right.timeout || left.stalled !== right.stalled || JSON.stringify(left.adjudication) !== JSON.stringify(right.adjudication)) throw new Error(`Worker-pool behavioral drift at game ${left.gameIndex}`); }
function metrics(results: BattleResult[], elapsedMs: number): Record<string, unknown> { return {games: results.length, elapsedMs: Math.round(elapsedMs), gamesPerSecond: round(results.length * 1000 / elapsedMs), stalled: results.filter(result => result.stalled).length, maxTurnAdjudications: results.filter(result => result.timeout).length}; }
function round(value: number): number { return Math.round(value * 1000) / 1000; }

main().catch(error => { console.error(error); process.exitCode = 1; });
