import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {runBattle, type BattleResult} from "../showdown/battle";
import {AI_VERSION, type AiStrategy} from "../showdown/choice";
import {loadTeam, validateTeam, writeTeam} from "../showdown/team";
import {benchmarkTeamPath, type LoadedBenchmarkPool} from "./benchmarkPool";
import {analyzePublicLog, mergeCounts} from "./logAnalysis";
import type {EvaluationSummary, MatchupSummary} from "./types";

export interface EvaluationInput {
  candidatePath: string;
  pool: LoadedBenchmarkPool;
  format: string;
  seed: string;
  gamesPerBenchmark: number;
  outDir: string;
  maxTurns: number;
  idleTimeoutMs?: number;
  wallClockTimeoutMs?: number;
  validate: boolean;
  ai: AiStrategy;
  openTeamSheets?: boolean;
  traceAiDecisions?: boolean;
}

export async function evaluateCandidate(input: EvaluationInput): Promise<EvaluationSummary> {
  const candidate = loadTeam(input.candidatePath);
  fs.mkdirSync(input.outDir, {recursive: true});

  if (input.validate) {
    throwIfInvalid(input.format, "candidate", validateTeam(input.format, candidate.sets));
  }

  writeTeam(candidate.sets, path.join(input.outDir, "candidate.export.txt"), "export");
  writeTeam(candidate.sets, path.join(input.outDir, "candidate.json"), "json");
  writeTeam(candidate.sets, path.join(input.outDir, "candidate.packed.txt"), "packed");
  fs.writeFileSync(path.join(input.outDir, "benchmark-pool.json"), `${JSON.stringify(input.pool, null, 2)}\n`, "utf8");

  const matchups: MatchupSummary[] = [];
  for (const benchmark of input.pool.benchmarks) {
    const benchmarkPath = benchmarkTeamPath(input.pool, benchmark.team);
    const opponent = loadTeam(benchmarkPath);
    if (input.validate) {
      throwIfInvalid(input.format, benchmark.id, validateTeam(input.format, opponent.sets));
    }

    const matchupDir = path.join(input.outDir, "matchups", benchmark.id);
    fs.mkdirSync(matchupDir, {recursive: true});
    writeTeam(opponent.sets, path.join(matchupDir, "benchmark.export.txt"), "export");

    const results: BattleResult[] = [];
    const killContribution: Record<string, number> = {};
    const deathsByOpponent: Record<string, number> = {};
    const failureReasons: Record<string, number> = {};

    for (let gameIndex = 0; gameIndex < input.gamesPerBenchmark; gameIndex += 1) {
      const result = await runBattle({
        format: input.format,
        teamA: candidate.packed,
        teamB: opponent.packed,
        seed: `${input.seed}:${benchmark.id}`,
        gameIndex,
        outDir: matchupDir,
        maxTurns: input.maxTurns,
        idleTimeoutMs: input.idleTimeoutMs,
        wallClockTimeoutMs: input.wallClockTimeoutMs,
        ai: input.ai,
        openTeamSheets: input.openTeamSheets ?? input.ai === "search",
        traceAiDecisions: input.traceAiDecisions ?? false,
      });
      results.push(result);

      const analysis = analyzePublicLog(result.publicLogPath, result.winner, result.turns);
      mergeCounts(killContribution, analysis.p1Kos);
      mergeCounts(deathsByOpponent, analysis.p2Kos);
      mergeCounts(failureReasons, analysis.failureSignals);
    }

    const wins = results.filter(result => result.winner === "Team A").length;
    const losses = results.filter(result => result.winner === "Team B").length;
    const draws = results.length - wins - losses;
    const stalled = results.filter(result => result.stalled).length;
    const timeouts = results.filter(result => result.timeout).length;
    const technicalDraws = results.filter(result => result.stalled || (result.timeout && !result.adjudication) || !result.ended).length;
    const completedDraws = Math.max(0, draws - technicalDraws);
    const scoredGames = wins + losses + completedDraws;
    const decisiveGames = wins + losses;
    const resultScore = (wins + completedDraws * 0.5) / Math.max(1, scoredGames);
    const averageTurns = average(results.map(result => result.turns));

    matchups.push({
      benchmarkId: benchmark.id,
      benchmarkName: benchmark.name,
      archetype: benchmark.archetype,
      games: results.length,
      wins,
      losses,
      draws,
      stalled,
      timeouts,
      technicalDraws,
      scoredGames,
      winRate: wins / Math.max(1, decisiveGames),
      resultScore,
      winRateInterval: wilsonInterval(wins, decisiveGames),
      sampleWarning: sampleWarning(scoredGames),
      averageTurns,
      weightedScore: resultScore * (benchmark.weight ?? 1),
      killContribution,
      deathsByOpponent,
      failureReasons,
      resultPaths: results.map(result => result.publicLogPath),
    });
  }

  return summarizeEvaluation(input, matchups, candidate.packed);
}

function summarizeEvaluation(input: EvaluationInput, matchups: MatchupSummary[], candidatePacked: string): EvaluationSummary {
  const totalGames = matchups.reduce((total, matchup) => total + matchup.games, 0);
  const totalWins = matchups.reduce((total, matchup) => total + matchup.wins, 0);
  const totalLosses = matchups.reduce((total, matchup) => total + matchup.losses, 0);
  const stalledGames = matchups.reduce((total, matchup) => total + matchup.stalled, 0);
  const timeoutGames = matchups.reduce((total, matchup) => total + matchup.timeouts, 0);
  const technicalDraws = matchups.reduce((total, matchup) => total + matchup.technicalDraws, 0);
  const scoredGames = matchups.reduce((total, matchup) => total + matchup.scoredGames, 0);
  const resultPoints = matchups.reduce((total, matchup) => total + matchup.resultScore * matchup.scoredGames, 0);
  const averageTurns = weightedAverage(matchups.map(matchup => [matchup.averageTurns, matchup.games]));
  const scoredMatchups = matchups.filter(matchup => matchup.scoredGames > 0);
  const benchmarkWeights = new Map(input.pool.benchmarks.map(benchmark => [benchmark.id, benchmark.weight ?? 1]));
  const weightedScoreTotal = scoredMatchups.reduce((total, matchup) => total + matchup.weightedScore, 0);
  const weightTotal = scoredMatchups.reduce((total, matchup) => total + (benchmarkWeights.get(matchup.benchmarkId) ?? 1), 0);
  const relativeScore = weightTotal > 0 ? (weightedScoreTotal / weightTotal) * 100 : null;
  const matchupConsistency = scoredMatchups.length
    ? Math.max(0, 1 - standardDeviation(scoredMatchups.map(matchup => matchup.resultScore)))
    : null;

  const archetypes: EvaluationSummary["archetypes"] = {};
  for (const matchup of matchups) {
    const current = archetypes[matchup.archetype] ?? {
      games: 0, wins: 0, losses: 0, draws: 0, stalled: 0, timeouts: 0,
      technicalDraws: 0, scoredGames: 0, winRate: 0, resultScore: 0, averageTurns: 0,
    };
    const previousTurnWeight = current.averageTurns * current.games;
    const previousScoreWeight = current.resultScore * current.scoredGames;
    current.games += matchup.games;
    current.wins += matchup.wins;
    current.losses += matchup.losses;
    current.draws += matchup.draws;
    current.stalled += matchup.stalled;
    current.timeouts += matchup.timeouts;
    current.technicalDraws += matchup.technicalDraws;
    current.scoredGames += matchup.scoredGames;
    current.winRate = current.wins / Math.max(1, current.wins + current.losses);
    current.resultScore = (previousScoreWeight + matchup.resultScore * matchup.scoredGames) / Math.max(1, current.scoredGames);
    current.averageTurns = (previousTurnWeight + matchup.averageTurns * matchup.games) / Math.max(1, current.games);
    archetypes[matchup.archetype] = current;
  }

  const killContribution: Record<string, number> = {};
  const failureReasons: Record<string, number> = {};
  for (const matchup of matchups) {
    mergeCounts(killContribution, matchup.killContribution);
    mergeCounts(failureReasons, matchup.failureReasons);
  }

  const sorted = [...scoredMatchups].sort((a, b) => a.resultScore - b.resultScore);

  return {
    candidate: path.resolve(input.candidatePath),
    benchmarkPool: input.pool.id,
    format: input.format,
    seed: input.seed,
    ai: input.ai,
    openTeamSheets: input.openTeamSheets ?? input.ai === "search",
    provenance: buildProvenance(input, candidatePacked),
    gamesPerBenchmark: input.gamesPerBenchmark,
    totalGames,
    stalledGames,
    timeoutGames,
    technicalDraws,
    scoredGames,
    overallWinRate: totalWins / Math.max(1, totalWins + totalLosses),
    overallResultScore: resultPoints / Math.max(1, scoredGames),
    overallWinRateInterval: wilsonInterval(totalWins, totalWins + totalLosses),
    sampleWarning: sampleWarning(scoredGames),
    averageTurns,
    relativeScore,
    matchupConsistency,
    archetypes,
    keyMatchups: {
      worst: sorted.slice(0, 3).map(toKeyMatchup),
      best: sorted.slice(-3).reverse().map(toKeyMatchup),
    },
    killContribution,
    failureReasons,
    matchups,
  };
}

function buildProvenance(input: EvaluationInput, candidatePacked: string): EvaluationSummary["provenance"] {
  const showdownPackagePath = path.resolve("node_modules", "pokemon-showdown", "package.json");
  const showdownVersion = fs.existsSync(showdownPackagePath)
    ? String((JSON.parse(fs.readFileSync(showdownPackagePath, "utf8")) as {version?: unknown}).version ?? "unknown")
    : "unknown";
  const benchmarkPayload = input.pool.benchmarks.map(benchmark => ({
    ...benchmark,
    contents: fs.readFileSync(benchmarkTeamPath(input.pool, benchmark.team), "utf8"),
  }));
  const modDir = path.resolve("node_modules", "pokemon-showdown", "dist", "data", "mods", "mythicmons");
  return {
    nodeVersion: process.version,
    showdownVersion,
    aiVersion: AI_VERSION,
    openTeamSheets: input.openTeamSheets ?? input.ai === "search",
    aiDecisionTraceEnabled: input.traceAiDecisions ?? false,
    candidateHash: sha256(candidatePacked),
    benchmarkPoolHash: sha256(JSON.stringify({id: input.pool.id, format: input.pool.format, benchmarks: benchmarkPayload})),
    sandboxModHash: input.format.includes("mythicmons") && fs.existsSync(modDir) ? hashDirectory(modDir) : null,
  };
}

function hashDirectory(directory: string): string {
  const hash = crypto.createHash("sha256");
  for (const file of fs.readdirSync(directory).sort()) {
    const filePath = path.join(directory, file);
    if (!fs.statSync(filePath).isFile()) continue;
    hash.update(file);
    hash.update(fs.readFileSync(filePath));
  }
  return hash.digest("hex");
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function toKeyMatchup(matchup: MatchupSummary) {
  return {
    benchmarkId: matchup.benchmarkId,
    name: matchup.benchmarkName,
    archetype: matchup.archetype,
    winRate: matchup.winRate,
  };
}

function throwIfInvalid(format: string, label: string, problems: string[]): void {
  if (!problems.length) return;
  throw new Error(`${label} is invalid for ${format}:\n- ${problems.join("\n- ")}`);
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function weightedAverage(values: Array<[number, number]>): number {
  const weight = values.reduce((total, [, currentWeight]) => total + currentWeight, 0);
  if (!weight) return 0;
  return values.reduce((total, [value, currentWeight]) => total + value * currentWeight, 0) / weight;
}

function standardDeviation(values: number[]): number {
  if (!values.length) return 0;
  const mean = average(values);
  const variance = average(values.map(value => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function wilsonInterval(wins: number, games: number): {low: number; high: number} {
  if (games <= 0) return {low: 0, high: 0};
  const z = 1.96;
  const p = wins / games;
  const denominator = 1 + (z ** 2) / games;
  const center = p + (z ** 2) / (2 * games);
  const margin = z * Math.sqrt((p * (1 - p) + (z ** 2) / (4 * games)) / games);
  return {
    low: clamp((center - margin) / denominator, 0, 1),
    high: clamp((center + margin) / denominator, 0, 1),
  };
}

function sampleWarning(games: number): string | undefined {
  if (games >= 20) return undefined;
  return `low sample: ${games} games; treat point estimates as noisy until at least 20 games`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
