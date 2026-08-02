import type {PilotEra, PilotMarginBand, PilotOutcome, PilotScaleBand} from "./lineupPilot";

export type LineupPilotReviewConclusion =
  | "blocked-integrity"
  | "insufficient-evidence"
  | "reject-no-observed-impact"
  | "reject-regression"
  | "keep-shadow-low-impact"
  | "keep-shadow-no-clear-benefit"
  | "candidate-for-scoped-assist-review";

export interface LineupPilotEvidenceSample {
  id: string;
  managerId: string;
  season: number;
  era: PilotEra;
  sourceOutcome: PilotOutcome;
  scaleBand: PilotScaleBand;
  marginBand: PilotMarginBand;
  direction: "better" | "neutral" | "worse";
  prefixVerified: boolean;
  sourceVerified: boolean;
  interventionVerified: boolean;
  causalAvailable: boolean;
  games: number;
  actionDivergences: number;
  unusedSubstitutions: number;
  outcomeChanges: number;
}

export interface LineupPilotReview {
  schemaVersion: 1;
  conclusion: LineupPilotReviewConclusion;
  thresholds: {
    minimumSamples: number;
    minimumManagers: number;
    minimumSeasons: number;
    minimumDecisive: number;
    minimumExpressionRate: number;
    maximumOneSidedP: number;
    minimumEraSamples: number;
    minimumSourceOutcomeSamples: number;
    minimumScaleBandSamples: number;
    minimumMarginBandSamples: number;
  };
  metrics: {
    planned: number;
    completed: number;
    pending: number;
    managers: number;
    seasons: number;
    better: number;
    neutral: number;
    worse: number;
    decisive: number;
    expressed: number;
    expressionRate: number;
    pairedScore: number;
    oneSidedImprovementP: number;
    oneSidedRegressionP: number;
    games: number;
    outcomeChanges: number;
    actionDivergences: number;
    unusedSubstitutions: number;
    byEra: Record<PilotEra, number>;
    bySourceOutcome: Record<PilotOutcome, number>;
    byScaleBand: Record<PilotScaleBand, number>;
    byMarginBand: Record<PilotMarginBand, number>;
  };
  issues: Array<{severity: "fatal" | "warning"; code: string; message: string}>;
  samples: LineupPilotEvidenceSample[];
}

export function evaluateLineupPilotEvidence(
  samples: readonly LineupPilotEvidenceSample[],
  planned: number,
  externalIssues: LineupPilotReview["issues"] = [],
  options: Partial<LineupPilotReview["thresholds"]> = {},
): LineupPilotReview {
  const thresholds = {
    minimumSamples: integer(options.minimumSamples ?? 24, 3, 100, "minimumSamples"),
    minimumManagers: integer(options.minimumManagers ?? 20, 2, 100, "minimumManagers"),
    minimumSeasons: integer(options.minimumSeasons ?? 9, 2, 100, "minimumSeasons"),
    minimumDecisive: integer(options.minimumDecisive ?? 8, 2, 100, "minimumDecisive"),
    minimumExpressionRate: finite(options.minimumExpressionRate ?? .9, 0, 1, "minimumExpressionRate"),
    maximumOneSidedP: finite(options.maximumOneSidedP ?? .1, .001, .5, "maximumOneSidedP"),
    minimumEraSamples: integer(options.minimumEraSamples ?? 6, 1, 100, "minimumEraSamples"),
    minimumSourceOutcomeSamples: integer(options.minimumSourceOutcomeSamples ?? 4, 1, 100, "minimumSourceOutcomeSamples"),
    minimumScaleBandSamples: integer(options.minimumScaleBandSamples ?? 6, 1, 100, "minimumScaleBandSamples"),
    minimumMarginBandSamples: integer(options.minimumMarginBandSamples ?? 6, 1, 100, "minimumMarginBandSamples"),
  };
  if (!Number.isInteger(planned) || planned < samples.length) throw new Error("planned sample count is invalid");
  const issues = [...externalIssues];
  const ids = new Set<string>(), managersSeen = new Set<string>();
  for (const sample of samples) {
    if (!sample.id || ids.has(sample.id)) issues.push({severity: "fatal", code: "duplicate-sample", message: `Duplicate or empty sample id: ${sample.id}`});
    ids.add(sample.id);
    if (!sample.managerId || managersSeen.has(sample.managerId)) issues.push({severity: "fatal", code: "correlated-manager", message: `Manager contributes more than one formal sample: ${sample.managerId}`});
    managersSeen.add(sample.managerId);
    if (!sample.prefixVerified || !sample.sourceVerified || !sample.interventionVerified) issues.push({severity: "fatal", code: "unverified-sample", message: `Source, prefix, or intervention verification failed for ${sample.id}`});
    if (!sample.causalAvailable || sample.games < 1) issues.push({severity: "fatal", code: "missing-causal-signature", message: `No battle causal signature for ${sample.id}`});
  }
  const directions = samples.map(sample => sample.direction);
  const better = count(directions, "better"), neutral = count(directions, "neutral"), worse = count(directions, "worse"), decisive = better + worse;
  const expressed = samples.filter(sample => sample.actionDivergences > 0 && sample.unusedSubstitutions === 0).length;
  const managers = new Set(samples.map(sample => sample.managerId)).size, seasons = new Set(samples.map(sample => sample.season)).size;
  const byEra = counts(samples, ["early", "middle", "late"], sample => sample.era);
  const bySourceOutcome = counts(samples, ["win", "loss", "draw"], sample => sample.sourceOutcome);
  const byScaleBand = counts(samples, ["low", "medium", "high"], sample => sample.scaleBand);
  const byMarginBand = counts(samples, ["razor", "close", "wide"], sample => sample.marginBand);
  const expressionRate = samples.length ? expressed / samples.length : 0;
  const oneSidedImprovementP = decisive ? binomialUpperTail(better, decisive) : 1;
  const oneSidedRegressionP = decisive ? binomialUpperTail(worse, decisive) : 1;
  if (samples.length < thresholds.minimumSamples) issues.push({severity: "warning", code: "insufficient-samples", message: `${samples.length}/${thresholds.minimumSamples} completed samples`});
  if (managers < thresholds.minimumManagers) issues.push({severity: "warning", code: "insufficient-managers", message: `${managers}/${thresholds.minimumManagers} independent managers`});
  if (seasons < thresholds.minimumSeasons) issues.push({severity: "warning", code: "insufficient-seasons", message: `${seasons}/${thresholds.minimumSeasons} seasons`});
  for (const [key, value] of Object.entries(byEra)) if (value < thresholds.minimumEraSamples) issues.push({severity: "warning", code: `era-${key}`, message: `${value}/${thresholds.minimumEraSamples} ${key} samples`});
  for (const [key, value] of Object.entries(bySourceOutcome)) if (value < thresholds.minimumSourceOutcomeSamples) issues.push({severity: "warning", code: `source-outcome-${key}`, message: `${value}/${thresholds.minimumSourceOutcomeSamples} source-${key} samples`});
  for (const [key, value] of Object.entries(byScaleBand)) if (value < thresholds.minimumScaleBandSamples) issues.push({severity: "warning", code: `scale-${key}`, message: `${value}/${thresholds.minimumScaleBandSamples} ${key} perturbation samples`});
  for (const [key, value] of Object.entries(byMarginBand)) if (value < thresholds.minimumMarginBandSamples) issues.push({severity: "warning", code: `margin-${key}`, message: `${value}/${thresholds.minimumMarginBandSamples} ${key} margin samples`});
  if (expressionRate < thresholds.minimumExpressionRate) issues.push({severity: "warning", code: "low-expression", message: `${round(expressionRate)}/${thresholds.minimumExpressionRate} samples changed battle behavior`});
  if (decisive < thresholds.minimumDecisive) issues.push({severity: "warning", code: "insufficient-decisive", message: `${decisive}/${thresholds.minimumDecisive} outcome-changing samples`});
  const baseEnough = samples.length >= thresholds.minimumSamples
    && managers >= thresholds.minimumManagers
    && seasons >= thresholds.minimumSeasons
    && Object.values(byEra).every(value => value >= thresholds.minimumEraSamples)
    && Object.values(bySourceOutcome).every(value => value >= thresholds.minimumSourceOutcomeSamples)
    && Object.values(byScaleBand).every(value => value >= thresholds.minimumScaleBandSamples)
    && Object.values(byMarginBand).every(value => value >= thresholds.minimumMarginBandSamples)
    && expressionRate >= thresholds.minimumExpressionRate;
  const fatal = issues.some(issue => issue.severity === "fatal");
  const conclusion: LineupPilotReviewConclusion = fatal ? "blocked-integrity"
    : !baseEnough ? "insufficient-evidence"
    : decisive === 0 ? "reject-no-observed-impact"
    : oneSidedRegressionP <= thresholds.maximumOneSidedP && worse > better ? "reject-regression"
    : decisive < thresholds.minimumDecisive ? "keep-shadow-low-impact"
    : oneSidedImprovementP <= thresholds.maximumOneSidedP && better > worse ? "candidate-for-scoped-assist-review"
    : "keep-shadow-no-clear-benefit";
  return {
    schemaVersion: 1,
    conclusion,
    thresholds,
    metrics: {
      planned,
      completed: samples.length,
      pending: planned - samples.length,
      managers,
      seasons,
      better,
      neutral,
      worse,
      decisive,
      expressed,
      expressionRate: round(expressionRate),
      pairedScore: round(samples.length ? (better + neutral * .5) / samples.length : 0),
      oneSidedImprovementP: round(oneSidedImprovementP),
      oneSidedRegressionP: round(oneSidedRegressionP),
      games: sum(samples, "games"),
      outcomeChanges: sum(samples, "outcomeChanges"),
      actionDivergences: sum(samples, "actionDivergences"),
      unusedSubstitutions: sum(samples, "unusedSubstitutions"),
      byEra,
      bySourceOutcome,
      byScaleBand,
      byMarginBand,
    },
    issues,
    samples: samples.map(sample => structuredClone(sample)),
  };
}

export function lineupPilotReviewMarkdown(value: LineupPilotReview): string {
  const m = value.metrics;
  return [
    "# Lineup Shadow Promotion Review",
    "",
    `- Conclusion: ${value.conclusion}`,
    `- Completed/planned: ${m.completed}/${m.planned}`,
    `- Managers/seasons: ${m.managers}/${m.seasons}`,
    `- Better/neutral/worse: ${m.better}/${m.neutral}/${m.worse}`,
    `- Decisive: ${m.decisive}/${value.thresholds.minimumDecisive}`,
    `- Expression: ${m.expressed}/${m.completed} (${(m.expressionRate * 100).toFixed(1)}%)`,
    `- Improvement/regression p: ${m.oneSidedImprovementP.toFixed(4)} / ${m.oneSidedRegressionP.toFixed(4)}`,
    `- Battle games/divergences/outcome changes: ${m.games}/${m.actionDivergences}/${m.outcomeChanges}`,
    "",
    "One manager contributes at most one formal sample. Side-swapped games verify treatment expression but do not increase the independent sample count. A passing result is only a candidate for scoped assist review; this command cannot activate league behavior.",
    "",
    "## Coverage",
    "",
    `- Era: ${JSON.stringify(m.byEra)}`,
    `- Source outcome: ${JSON.stringify(m.bySourceOutcome)}`,
    `- Scale: ${JSON.stringify(m.byScaleBand)}`,
    `- Margin: ${JSON.stringify(m.byMarginBand)}`,
    "",
    "## Issues",
    "",
    ...(value.issues.length ? value.issues.map(issue => `- [${issue.severity.toUpperCase()}] ${issue.code}: ${issue.message}`) : ["No issues."]),
    "",
  ].join("\n");
}

function counts<T extends string>(samples: readonly LineupPilotEvidenceSample[], keys: readonly T[], selector: (sample: LineupPilotEvidenceSample) => T): Record<T, number> {
  return Object.fromEntries(keys.map(key => [key, samples.filter(sample => selector(sample) === key).length])) as Record<T, number>;
}
function count(values: readonly string[], target: string): number { return values.filter(value => value === target).length; }
function sum(samples: readonly LineupPilotEvidenceSample[], key: "games" | "outcomeChanges" | "actionDivergences" | "unusedSubstitutions"): number { return samples.reduce((total, sample) => total + sample[key], 0); }
function binomialUpperTail(successes: number, trials: number): number {
  const logs: number[] = []; let logProbability = -trials * Math.log(2);
  for (let k = 0; k <= trials; k++) {
    if (k >= successes) logs.push(logProbability);
    if (k < trials) logProbability += Math.log(trials - k) - Math.log(k + 1);
  }
  const maximum = Math.max(...logs);
  return Math.exp(maximum) * logs.reduce((total, value) => total + Math.exp(value - maximum), 0);
}
function integer(value: number, min: number, max: number, name: string): number { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function finite(value: number, min: number, max: number, name: string): number { if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
