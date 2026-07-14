import fs from "node:fs";
import path from "node:path";
import type {EvaluationSummary} from "./types";

export function writeEvaluationReport(summary: EvaluationSummary, targetPath: string): void {
  const lines: string[] = [];
  const decisiveGames = summary.matchups.reduce((total, matchup) => total + matchup.wins + matchup.losses, 0);

  lines.push(`# Evaluation Report`);
  lines.push("");
  lines.push(`Candidate: ${summary.candidate}`);
  lines.push(`Benchmark pool: ${summary.benchmarkPool}`);
  lines.push(`Format: ${summary.format}`);
  lines.push(`AI strategy: ${summary.ai}`);
  lines.push(`AI version: ${summary.provenance.aiVersion}`);
  lines.push(`Showdown version: ${summary.provenance.showdownVersion}`);
  lines.push(`Candidate hash: ${summary.provenance.candidateHash}`);
  lines.push(`Benchmark hash: ${summary.provenance.benchmarkPoolHash}`);
  if (summary.provenance.sandboxModHash) lines.push(`Sandbox mod hash: ${summary.provenance.sandboxModHash}`);
  lines.push(`Games: ${summary.totalGames} (${summary.gamesPerBenchmark} per benchmark)`);
  if (summary.stalledGames) lines.push(`Stalled games: ${summary.stalledGames}`);
  if (summary.timeoutGames) lines.push(`Max-turn draws: ${summary.timeoutGames}`);
  if (summary.technicalDraws) lines.push(`Technical draws excluded from score: ${summary.technicalDraws}`);
  lines.push(`Scored games: ${summary.scoredGames}`);
  lines.push(`Pool-relative score: ${formatScore(summary.relativeScore)}`);
  lines.push(`Overall win rate: ${decisiveGames ? `${formatPercent(summary.overallWinRate)} (${formatInterval(summary.overallWinRateInterval)} 95% CI)` : "n/a"}`);
  lines.push(`Overall result score: ${summary.scoredGames ? formatPercent(summary.overallResultScore) : "n/a"}`);
  if (summary.sampleWarning) lines.push(`Sample warning: ${summary.sampleWarning}`);
  lines.push(`Average turns: ${summary.averageTurns.toFixed(1)}`);
  lines.push(`Matchup consistency: ${summary.matchupConsistency === null ? "n/a" : `${(summary.matchupConsistency * 100).toFixed(1)}%`}`);
  lines.push("");

  lines.push(`## Matchups`);
  lines.push("");
  lines.push(`| Benchmark | Archetype | W-L-D | Timeout | Stalled | Win rate | Result score | 95% CI | Avg turns |`);
  lines.push(`| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const matchup of summary.matchups) {
    lines.push([
      `| ${matchup.benchmarkName}`,
      matchup.archetype,
      `${matchup.wins}-${matchup.losses}-${matchup.draws}`,
      String(matchup.timeouts),
      String(matchup.stalled),
      matchup.wins + matchup.losses ? formatPercent(matchup.winRate) : "n/a",
      matchup.scoredGames ? formatPercent(matchup.resultScore) : "n/a",
      matchup.wins + matchup.losses ? formatInterval(matchup.winRateInterval) : "n/a",
      `${matchup.averageTurns.toFixed(1)} |`,
    ].join(" | "));
  }
  lines.push("");

  lines.push(`## Archetypes`);
  lines.push("");
  lines.push(`| Archetype | Games | Timeout | Stalled | Win rate | Result score | Avg turns |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const [archetype, data] of Object.entries(summary.archetypes)) {
    const winRate = data.wins + data.losses ? `${(data.winRate * 100).toFixed(1)}%` : "n/a";
    const resultScore = data.scoredGames ? `${(data.resultScore * 100).toFixed(1)}%` : "n/a";
    lines.push(`| ${archetype} | ${data.games} | ${data.timeouts} | ${data.stalled} | ${winRate} | ${resultScore} | ${data.averageTurns.toFixed(1)} |`);
  }
  lines.push("");

  lines.push(`## Key Matchups`);
  lines.push("");
  lines.push(`Best: ${summary.keyMatchups.best.map(formatKeyMatchup).join(", ") || "n/a"}`);
  lines.push(`Worst: ${summary.keyMatchups.worst.map(formatKeyMatchup).join(", ") || "n/a"}`);
  lines.push("");

  lines.push(`## Kill Contribution`);
  lines.push("");
  appendCounts(lines, summary.killContribution);
  lines.push("");

  lines.push(`## Common Failure Reasons`);
  lines.push("");
  appendCounts(lines, summary.failureReasons);
  lines.push("");
  lines.push(`Notes: failure reasons are heuristic labels derived from protocol log events. They are evidence for review, not a definitive diagnosis.`);

  fs.mkdirSync(path.dirname(targetPath), {recursive: true});
  fs.writeFileSync(targetPath, `${lines.join("\n")}\n`, "utf8");
}

function appendCounts(lines: string[], counts: Record<string, number>): void {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    lines.push("- n/a");
    return;
  }
  for (const [key, value] of entries) lines.push(`- ${key}: ${value}`);
}

function formatKeyMatchup(matchup: {name: string; archetype: string; winRate: number}): string {
  return `${matchup.name} (${matchup.archetype}, ${(matchup.winRate * 100).toFixed(1)}%)`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatScore(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(1)} / 100`;
}

function formatInterval(interval: {low: number; high: number}): string {
  return `${formatPercent(interval.low)}-${formatPercent(interval.high)}`;
}
