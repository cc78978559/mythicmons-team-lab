import type {StrategyProgramMutationOperator} from "../../draft/strategyProgram";

export type StrategyProgramEvolutionConclusion = "blocked" | "insufficient-evidence" | "no-observed-effect" | "reject-operator" | "no-clear-benefit" | "candidate-for-bounded-active-review";
export type StrategyProgramEvolutionHypothesis = "observed-boundary-two-season-program-operator-v1" | "compound-observed-boundary-two-season-program-operator-v2" | "decision-margin-two-season-program-operator-v3";

export interface StrategyProgramCounterfactualSample {
  seed: string;
  managerId: string;
  operator: StrategyProgramMutationOperator;
  sourceSeason: number;
  activationSeason: number;
  evaluationSeason: number;
  horizonSeasons: number;
  sourceVerified: boolean;
  prefixVerified: boolean;
  parentProgramHash: string;
  candidateProgramHash: string;
  behaviorDistance: number;
  opportunityDistance: number;
  choicePotential: number;
  operatorMutations: string[];
  decisionEffects: {ledgerCompared: number; ledgerSelectionDifferences: number; ledgerRecordSetDifferences: number; programSignalsCompared: number; programSignalDifferences: number; battleCompared: number; battleChoiceDifferences: number; battleRecordSetDifferences: number};
  delta: {points: number; rankImprovement: number; titles: number; cash: number};
}

export interface StrategyProgramEvolutionAggregate {
  schemaVersion: 1;
  conclusion: StrategyProgramEvolutionConclusion;
  hypothesis: StrategyProgramEvolutionHypothesis;
  thresholds: {minimumSamples: number; minimumSeeds: number; minimumDecisivePairs: number; minimumDecisiveSeeds: number; maximumOneSidedP: number};
  metrics: {
    samples: number; seeds: number; better: number; neutral: number; worse: number; decisivePairs: number;
    betterSeeds: number; neutralSeeds: number; worseSeeds: number; decisiveSeeds: number;
    pairedWinRate: number; meanPointsDelta: number; meanRankImprovement: number; meanTitlesDelta: number; meanCashDelta: number;
    meanBehaviorDistance: number; meanOpportunityDistance: number; meanChoicePotential: number; samplesWithProgramSignalDifference: number; samplesWithDecisionDifference: number; decisionDivergenceRate: number; oneSidedImprovementP: number; oneSidedRegressionP: number;
  };
  issues: Array<{severity: "fatal" | "warning"; code: string; message: string}>;
  samples: StrategyProgramCounterfactualSample[];
}

export function aggregateStrategyProgramEvolution(samples: readonly StrategyProgramCounterfactualSample[], options: {minimumSamples?: number; minimumSeeds?: number; minimumDecisivePairs?: number; minimumDecisiveSeeds?: number; maximumOneSidedP?: number} = {}): StrategyProgramEvolutionAggregate {
  if (!samples.length) throw new Error("Strategy-program aggregation requires at least one sample");
  samples.forEach(validateSample);
  const operators = new Set(samples.map(sample => sample.operator));
  if (operators.size !== 1) throw new Error("Strategy-program aggregation cannot mix mutation operators");
  const operator = samples[0].operator;
  const minimumSamples = integer(options.minimumSamples ?? 10, 3, 10000, "minimumSamples");
  const minimumSeeds = integer(options.minimumSeeds ?? 10, 2, minimumSamples, "minimumSeeds");
  const minimumDecisivePairs = integer(options.minimumDecisivePairs ?? 4, 2, minimumSamples, "minimumDecisivePairs");
  const minimumDecisiveSeeds = integer(options.minimumDecisiveSeeds ?? 4, 2, minimumSeeds, "minimumDecisiveSeeds");
  const maximumOneSidedP = finite(options.maximumOneSidedP ?? .1, .001, .5, "maximumOneSidedP");
  const issues: StrategyProgramEvolutionAggregate["issues"] = [];
  if (samples.some(sample => !sample.sourceVerified)) issues.push({severity: "fatal", code: "source-drift", message: "At least one candidate was not bound to its source dynasty"});
  if (samples.some(sample => !sample.prefixVerified)) issues.push({severity: "fatal", code: "prefix-drift", message: "At least one branch failed immutable-prefix verification"});
  if (samples.some(sample => sample.behaviorDistance <= 0 || sample.parentProgramHash === sample.candidateProgramHash)) issues.push({severity: "fatal", code: "non-semantic-candidate", message: "At least one sample did not isolate a semantic strategy-program change"});
  const samplesWithProgramSignalDifference = samples.filter(sample => sample.decisionEffects.programSignalDifferences > 0).length;
  const samplesWithDecisionDifference = samples.filter(sample => sample.decisionEffects.ledgerSelectionDifferences + sample.decisionEffects.ledgerRecordSetDifferences + sample.decisionEffects.battleChoiceDifferences + sample.decisionEffects.battleRecordSetDifferences > 0).length;
  const directions = samples.map(sample => competitiveDirection(sample.delta));
  const better = directions.filter(value => value > 0).length, neutral = directions.filter(value => value === 0).length, worse = directions.filter(value => value < 0).length;
  const seedDirections = groupedSeedDirections(samples, directions), seeds = seedDirections.size;
  const betterSeeds = [...seedDirections.values()].filter(value => value > 0).length, neutralSeeds = [...seedDirections.values()].filter(value => value === 0).length, worseSeeds = [...seedDirections.values()].filter(value => value < 0).length;
  const decisivePairs = better + worse, decisiveSeeds = betterSeeds + worseSeeds;
  const oneSidedImprovementP = decisiveSeeds ? binomialUpperTail(betterSeeds, decisiveSeeds) : 1;
  const oneSidedRegressionP = decisiveSeeds ? binomialUpperTail(worseSeeds, decisiveSeeds) : 1;
  if (samples.length < minimumSamples) issues.push({severity: "warning", code: "insufficient-samples", message: `${samples.length}/${minimumSamples} paired seasons`});
  if (seeds < minimumSeeds) issues.push({severity: "warning", code: "insufficient-seeds", message: `${seeds}/${minimumSeeds} independent seeds`});
  if (decisivePairs < minimumDecisivePairs) issues.push({severity: "warning", code: "insufficient-decisive-pairs", message: `${decisivePairs}/${minimumDecisivePairs} outcome-changing pairs`});
  if (decisiveSeeds < minimumDecisiveSeeds) issues.push({severity: "warning", code: "insufficient-decisive-seeds", message: `${decisiveSeeds}/${minimumDecisiveSeeds} directional seed clusters`});
  if (samples.length >= minimumSamples && seeds >= minimumSeeds && decisivePairs === 0) issues.push({severity: "warning", code: "no-observed-effect", message: "The formal sample floor produced no competitive change"});
  if (samples.length >= minimumSamples && samplesWithDecisionDifference === 0) issues.push({severity: "warning", code: "no-decision-divergence", message: "Programs executed without changing any observed management or battle choice"});
  const metrics = {
    samples: samples.length, seeds, better, neutral, worse, decisivePairs, betterSeeds, neutralSeeds, worseSeeds, decisiveSeeds,
    pairedWinRate: round((better + neutral * .5) / samples.length),
    meanPointsDelta: round(mean(samples.map(sample => sample.delta.points))),
    meanRankImprovement: round(mean(samples.map(sample => sample.delta.rankImprovement))),
    meanTitlesDelta: round(mean(samples.map(sample => sample.delta.titles))),
    meanCashDelta: round(mean(samples.map(sample => sample.delta.cash))),
    meanBehaviorDistance: round(mean(samples.map(sample => sample.behaviorDistance))), meanOpportunityDistance: round(mean(samples.map(sample => sample.opportunityDistance))), meanChoicePotential: round(mean(samples.map(sample => sample.choicePotential))), samplesWithProgramSignalDifference, samplesWithDecisionDifference, decisionDivergenceRate: round(samplesWithDecisionDifference / samples.length),
    oneSidedImprovementP: round(oneSidedImprovementP), oneSidedRegressionP: round(oneSidedRegressionP),
  };
  const fatal = issues.some(issue => issue.severity === "fatal");
  const baseEnough = samples.length >= minimumSamples && seeds >= minimumSeeds;
  const directionalEnough = decisivePairs >= minimumDecisivePairs && decisiveSeeds >= minimumDecisiveSeeds;
  const healthy = metrics.meanPointsDelta >= 0 && metrics.meanTitlesDelta >= 0;
  const conclusion: StrategyProgramEvolutionConclusion = fatal ? "blocked"
    : baseEnough && decisivePairs === 0 ? "no-observed-effect"
    : !baseEnough || !directionalEnough ? "insufficient-evidence"
    : oneSidedRegressionP <= maximumOneSidedP && worse > better ? "reject-operator"
    : oneSidedImprovementP <= maximumOneSidedP && better > worse && healthy ? "candidate-for-bounded-active-review"
    : "no-clear-benefit";
  return {schemaVersion: 1, conclusion, hypothesis: hypothesisFor(operator), thresholds: {minimumSamples, minimumSeeds, minimumDecisivePairs, minimumDecisiveSeeds, maximumOneSidedP}, metrics, issues, samples: samples.map(sample => structuredClone(sample))};
}

export function strategyProgramEvolutionMarkdown(value: StrategyProgramEvolutionAggregate): string {
  const m = value.metrics;
  return ["# Strategy-program evolution evidence", "", `- Conclusion: ${value.conclusion}`, `- Hypothesis: ${value.hypothesis}`, `- Samples/seeds: ${m.samples}/${m.seeds}`, `- Better/neutral/worse: ${m.better}/${m.neutral}/${m.worse}`, `- Better/neutral/worse seed clusters: ${m.betterSeeds}/${m.neutralSeeds}/${m.worseSeeds}`, `- Decisive pairs/seeds: ${m.decisivePairs}/${m.decisiveSeeds}`, `- Historical opportunity distance / choice potential: ${m.meanOpportunityDistance.toFixed(6)} / ${m.meanChoicePotential.toFixed(6)}`, `- Program-signal differences: ${m.samplesWithProgramSignalDifference}/${m.samples}`, `- Management or battle decision differences: ${m.samplesWithDecisionDifference}/${m.samples} (${(m.decisionDivergenceRate * 100).toFixed(1)}%)`, `- Paired win rate: ${(m.pairedWinRate * 100).toFixed(1)}%`, `- Mean points/rank/titles/cash delta: ${signed(m.meanPointsDelta)} / ${signed(m.meanRankImprovement)} / ${signed(m.meanTitlesDelta)} / ${signed(m.meanCashDelta)}`, `- Mean program behavior distance: ${m.meanBehaviorDistance.toFixed(6)}`, `- Improvement/regression p: ${m.oneSidedImprovementP.toFixed(4)} / ${m.oneSidedRegressionP.toFixed(4)}`, "", "Each seed tests a different semantic program selected by the same shadow-winner operator. The aggregate evaluates that operator, not one universal program. Promotion is review-only and requires both directional evidence and non-negative mean points and titles.", "", "## Issues", "", ...(value.issues.length ? value.issues.map(issue => `- [${issue.severity.toUpperCase()}] ${issue.code}: ${issue.message}`) : ["No issues."]), ""].join("\n");
}

function validateSample(sample: StrategyProgramCounterfactualSample): void {
  if (!sample.seed || !sample.managerId || !Number.isInteger(sample.sourceSeason) || !Number.isInteger(sample.activationSeason) || !Number.isInteger(sample.evaluationSeason) || !Number.isInteger(sample.horizonSeasons) || sample.activationSeason !== sample.sourceSeason + 1 || sample.evaluationSeason !== sample.sourceSeason + sample.horizonSeasons || sample.horizonSeasons !== 2) throw new Error("Malformed strategy-program sample identity");
  if (!Array.isArray(sample.operatorMutations) || !sample.operatorMutations.some(mutation => mutation.startsWith("program."))) throw new Error(`Missing strategy-program operator identity for ${sample.seed}`);
  if (sample.operator !== "observed-boundary-v1" && sample.operator !== "compound-observed-boundary-v2" && sample.operator !== "decision-margin-v3") throw new Error(`Unknown strategy-program operator for ${sample.seed}`);
  if (!Number.isFinite(sample.behaviorDistance) || !Number.isFinite(sample.opportunityDistance) || !Number.isFinite(sample.choicePotential) || sample.opportunityDistance < 0 || sample.choicePotential < 0 || !Object.values(sample.delta).every(Number.isFinite)) throw new Error(`Malformed strategy-program metrics for ${sample.seed}`);
  if (!sample.decisionEffects || !Object.values(sample.decisionEffects).every(value => Number.isInteger(value) && value >= 0)) throw new Error(`Missing decision-effect telemetry for ${sample.seed}`);
}
function hypothesisFor(operator: StrategyProgramMutationOperator): StrategyProgramEvolutionHypothesis { return operator === "decision-margin-v3" ? "decision-margin-two-season-program-operator-v3" : operator === "compound-observed-boundary-v2" ? "compound-observed-boundary-two-season-program-operator-v2" : "observed-boundary-two-season-program-operator-v1"; }
function competitiveDirection(delta: StrategyProgramCounterfactualSample["delta"]): number { if (delta.titles !== 0) return Math.sign(delta.titles); if (delta.points !== 0) return Math.sign(delta.points); if (delta.rankImprovement !== 0) return Math.sign(delta.rankImprovement); return 0; }
function groupedSeedDirections(samples: readonly StrategyProgramCounterfactualSample[], directions: readonly number[]): Map<string, number> { const grouped = new Map<string, number[]>(); samples.forEach((sample, index) => grouped.set(sample.seed, [...(grouped.get(sample.seed) ?? []), directions[index]])); return new Map([...grouped].map(([seed, values]) => [seed, Math.sign(mean(values))])); }
function binomialUpperTail(successes: number, trials: number): number { const logs: number[] = []; let logProbability = -trials * Math.log(2); for (let k = 0; k <= trials; k += 1) { if (k >= successes) logs.push(logProbability); if (k < trials) logProbability += Math.log(trials - k) - Math.log(k + 1); } const maximum = Math.max(...logs); return Math.exp(maximum) * logs.reduce((sum, value) => sum + Math.exp(value - maximum), 0); }
function mean(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function integer(value: number, min: number, max: number, name: string): number { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function finite(value: number, min: number, max: number, name: string): number { if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function signed(value: number): string { return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`; }
