import fs from "node:fs";
import path from "node:path";
import type {VariantExperimentSummary} from "./types";

export function writeVariantReport(summary: VariantExperimentSummary, targetPath: string): void {
  const sorted = [...summary.variants].sort((a, b) => compareNullableScores(b.delta.relativeScore, a.delta.relativeScore));
  const lines: string[] = [];

  lines.push("# Variant Experiment");
  lines.push("");
  lines.push(`Candidate: ${summary.candidate}`);
  lines.push(`Benchmark pool: ${summary.benchmarkPool}`);
  lines.push(`Format: ${summary.format}`);
  lines.push(`AI strategy: ${summary.ai}`);
  lines.push(`Games: ${summary.gamesPerBenchmark} per benchmark`);
  lines.push(`Baseline score: ${formatScore(summary.baseline.relativeScore)}`);
  lines.push(`Baseline win rate: ${(summary.baseline.overallWinRate * 100).toFixed(1)}% (${formatInterval(summary.baseline.overallWinRateInterval)} 95% CI)`);
  if (summary.baseline.sampleWarning) lines.push(`Sample warning: ${summary.baseline.sampleWarning}`);
  lines.push("");

  lines.push("## Delta Table");
  lines.push("");
  lines.push("| Rank | Change | Kind | Win rate delta | Score delta | Avg turn delta | New score |");
  lines.push("| ---: | --- | --- | ---: | ---: | ---: | ---: |");
  sorted.forEach((result, index) => {
    lines.push(`| ${index + 1} | ${result.variant.description} | ${result.variant.kind} | ${formatPercentDelta(result.delta.winRate)} | ${formatNumberDelta(result.delta.relativeScore)} | ${formatNumberDelta(result.delta.averageTurns)} | ${formatScore(result.evaluation.relativeScore)} |`);
  });
  lines.push("");

  lines.push("## Top Improvements");
  lines.push("");
  appendResults(lines, sorted.filter(result => result.delta.relativeScore !== null && result.delta.relativeScore > 0).slice(0, 5));
  lines.push("");

  lines.push("## Biggest Drops");
  lines.push("");
  appendResults(lines, [...sorted].reverse().filter(result => result.delta.relativeScore !== null && result.delta.relativeScore < 0).slice(0, 5));
  lines.push("");

  lines.push("## Skipped Variants");
  lines.push("");
  if (!summary.skipped.length) {
    lines.push("- none");
  } else {
    for (const skipped of summary.skipped) {
      lines.push(`- ${skipped.description}: ${skipped.reasons[0]}`);
    }
  }
  lines.push("");
  lines.push("Notes: each row changes exactly one variable from the baseline team. Deltas are point estimates relative to this run's baseline under the same AI, benchmark pool, Showdown version, and seed; low sample runs can easily be noise.");

  fs.mkdirSync(path.dirname(targetPath), {recursive: true});
  fs.writeFileSync(targetPath, `${lines.join("\n")}\n`, "utf8");
}

function appendResults(lines: string[], results: VariantExperimentSummary["variants"]): void {
  if (!results.length) {
    lines.push("- none");
    return;
  }
  for (const result of results) {
    lines.push(`- ${result.variant.description}: ${formatNumberDelta(result.delta.relativeScore)} score, ${formatPercentDelta(result.delta.winRate)} win rate`);
  }
}

function formatNumberDelta(value: number | null): string {
  if (value === null) return "n/a";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatScore(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(1)} / 100`;
}

function compareNullableScores(left: number | null, right: number | null): number {
  if (left === null) return right === null ? 0 : -1;
  if (right === null) return 1;
  return left - right;
}

function formatPercentDelta(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function formatInterval(interval: {low: number; high: number}): string {
  return `${(interval.low * 100).toFixed(1)}%-${(interval.high * 100).toFixed(1)}%`;
}
