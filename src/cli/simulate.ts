import fs from "node:fs";
import path from "node:path";
import {parseArgs, stringArg, numberArg, booleanArg} from "../showdown/args";
import {runBattle, type BattleResult} from "../showdown/battle";
import {AI_VERSION, type AiStrategy} from "../showdown/choice";
import {loadTeam, validateTeam, writeTeam} from "../showdown/team";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const teamAPath = stringArg(args, "teamA");
  const teamBPath = stringArg(args, "teamB");
  const format = stringArg(args, "format", "gen9ou");
  const seed = stringArg(args, "seed", "1");
  const games = numberArg(args, "games", 1, {integer: true, min: 1});
  const maxTurns = numberArg(args, "maxTurns", 500, {integer: true, min: 1});
  const idleTimeoutMs = numberArg(args, "idleTimeoutMs", 5000, {integer: true, min: 1});
  const wallClockTimeoutMs = numberArg(args, "wallClockTimeoutMs", 30000, {integer: true, min: 1});
  const outDir = path.resolve(stringArg(args, "out", "output/run"));
  const shouldValidate = booleanArg(args, "validate", true);
  const ai = parseAi(stringArg(args, "ai", "basic"));
  const openTeamSheets = booleanArg(args, "open-team-sheets", ai === "search");
  const traceAiDecisions = booleanArg(args, "ai-trace", ai === "search");

  const teamA = loadTeam(teamAPath);
  const teamB = loadTeam(teamBPath);

  if (shouldValidate) {
    reportValidation(format, "teamA", validateTeam(format, teamA.sets));
    reportValidation(format, "teamB", validateTeam(format, teamB.sets));
  }

  fs.mkdirSync(outDir, {recursive: true});
  writeTeam(teamA.sets, path.join(outDir, "teamA.export.txt"), "export");
  writeTeam(teamA.sets, path.join(outDir, "teamA.json"), "json");
  writeTeam(teamA.sets, path.join(outDir, "teamA.packed.txt"), "packed");
  writeTeam(teamB.sets, path.join(outDir, "teamB.export.txt"), "export");
  writeTeam(teamB.sets, path.join(outDir, "teamB.json"), "json");
  writeTeam(teamB.sets, path.join(outDir, "teamB.packed.txt"), "packed");

  const results: BattleResult[] = [];
  for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
    results.push(await runBattle({
      format,
      teamA: teamA.packed,
      teamB: teamB.packed,
      seed,
      gameIndex,
      outDir,
      maxTurns,
      idleTimeoutMs,
      wallClockTimeoutMs,
      ai,
      openTeamSheets,
      traceAiDecisions,
    }));
  }

  const summary = summarize(format, seed, ai, openTeamSheets, traceAiDecisions, results);
  const summaryPath = path.join(outDir, "summary.json");
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(`Format: ${format}`);
  console.log(`AI: ${ai}`);
  console.log(`Open team sheets: ${openTeamSheets}`);
  console.log(`AI decision trace: ${traceAiDecisions}`);
  console.log(`Games: ${games}`);
  console.log(`Team A wins: ${summary.teamAWins}`);
  console.log(`Team B wins: ${summary.teamBWins}`);
  console.log(`Draw/unknown: ${summary.draws}`);
  console.log(`Stalled: ${summary.stalled}`);
  console.log(`Max-turn draws: ${summary.timeouts}`);
  console.log(`Average turns: ${summary.averageTurns.toFixed(2)}`);
  console.log(`Output: ${outDir}`);
}

function reportValidation(format: string, label: string, problems: string[]): void {
  if (!problems.length) return;
  throw new Error(`${label} is invalid for ${format}:\n- ${problems.join("\n- ")}`);
}

function parseAi(value: string): AiStrategy {
  if (value === "first" || value === "damage" || value === "basic" || value === "tactical" || value === "search") return value;
  throw new Error("--ai must be one of: basic, damage, first, search, tactical");
}

function summarize(
  format: string,
  seed: string,
  ai: AiStrategy,
  openTeamSheets: boolean,
  traceAiDecisions: boolean,
  results: BattleResult[],
) {
  const teamAWins = results.filter(result => result.winner === "Team A").length;
  const teamBWins = results.filter(result => result.winner === "Team B").length;
  const draws = results.length - teamAWins - teamBWins;
  const stalled = results.filter(result => result.stalled).length;
  const timeouts = results.filter(result => result.timeout).length;
  const averageTurns = results.reduce((total, result) => total + result.turns, 0) / Math.max(1, results.length);

  return {
    format,
    seed,
    ai,
    aiVersion: AI_VERSION,
    openTeamSheets,
    traceAiDecisions,
    games: results.length,
    teamAWins,
    teamBWins,
    draws,
    stalled,
    timeouts,
    teamAWinRate: teamAWins / Math.max(1, results.length),
    teamBWinRate: teamBWins / Math.max(1, results.length),
    averageTurns,
    results,
  };
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
