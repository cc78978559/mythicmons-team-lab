import fs from "node:fs";
import path from "node:path";
import {parseArgs, stringArg, numberArg, booleanArg} from "../showdown/args";
import {loadBenchmarkPool} from "../eval/benchmarkPool";
import {evaluateCandidate} from "../eval/evaluator";
import {writeEvaluationReport} from "../eval/report";
import type {AiStrategy} from "../showdown/choice";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const teamPath = stringArg(args, "team");
  const poolPath = stringArg(args, "benchmarks", "benchmarks/gen9ou/index.json");
  const pool = loadBenchmarkPool(poolPath);
  const format = stringArg(args, "format", pool.format);
  const seed = stringArg(args, "seed", "1");
  const gamesPerBenchmark = numberArg(args, "games", 3, {integer: true, min: 1});
  const maxTurns = numberArg(args, "maxTurns", 500, {integer: true, min: 1});
  const idleTimeoutMs = numberArg(args, "idleTimeoutMs", 5000, {integer: true, min: 1});
  const wallClockTimeoutMs = numberArg(args, "wallClockTimeoutMs", 30000, {integer: true, min: 1});
  const outDir = path.resolve(stringArg(args, "out", "output/eval"));
  const validate = booleanArg(args, "validate", true);
  const ai = parseAi(stringArg(args, "ai", "basic"));
  const openTeamSheets = booleanArg(args, "open-team-sheets", ai === "search");
  const traceAiDecisions = booleanArg(args, "ai-trace", false);

  const summary = await evaluateCandidate({
    candidatePath: teamPath,
    pool,
    format,
    seed,
    gamesPerBenchmark,
    outDir,
    maxTurns,
    idleTimeoutMs,
    wallClockTimeoutMs,
    validate,
    ai,
    openTeamSheets,
    traceAiDecisions,
  });

  fs.mkdirSync(outDir, {recursive: true});
  fs.writeFileSync(path.join(outDir, "evaluation.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeEvaluationReport(summary, path.join(outDir, "report.md"));

  console.log(`Format: ${summary.format}`);
  console.log(`AI: ${summary.ai}`);
  console.log(`Open team sheets: ${summary.openTeamSheets}`);
  console.log(`AI decision trace: ${summary.provenance.aiDecisionTraceEnabled}`);
  console.log(`Benchmark pool: ${summary.benchmarkPool}`);
  console.log(`Total games: ${summary.totalGames}`);
  if (summary.stalledGames) console.log(`Stalled games: ${summary.stalledGames}`);
  if (summary.timeoutGames) console.log(`Max-turn adjudications: ${summary.timeoutGames}`);
  if (summary.technicalDraws) console.log(`Technical draws excluded: ${summary.technicalDraws}`);
  const decisiveGames = summary.matchups.reduce((total, matchup) => total + matchup.wins + matchup.losses, 0);
  console.log(`Overall win rate: ${decisiveGames ? `${(summary.overallWinRate * 100).toFixed(1)}%` : "N/A"}`);
  console.log(`Pool-relative score: ${summary.relativeScore === null ? "N/A" : `${summary.relativeScore.toFixed(1)} / 100`}`);
  console.log(`Average turns: ${summary.averageTurns.toFixed(1)}`);
  console.log(`Report: ${path.join(outDir, "report.md")}`);
}

function parseAi(value: string): AiStrategy {
  if (value === "first" || value === "damage" || value === "basic" || value === "tactical" || value === "search") return value;
  throw new Error("--ai must be one of: basic, damage, first, search, tactical");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
