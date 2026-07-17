export type BattleAggregatePromotion = "blocked" | "insufficient-evidence" | "reject-hypothesis" | "candidate-for-assist";

export interface BattleOutcomeEvidence {
  winner: string | null;
  turns: number;
  ended: boolean;
  timeout: boolean;
  stalled: boolean;
  errors: string[];
}

export interface BattleCounterfactualSample {
  seed: string;
  caseId: string;
  sourceVerified: boolean;
  prefixVerified: boolean;
  playerId: "p1" | "p2";
  incumbent: BattleOutcomeEvidence;
  whitebox: BattleOutcomeEvidence;
}

export interface BattleCounterfactualAggregate {
  schemaVersion: 1;
  promotion: BattleAggregatePromotion;
  samples: BattleCounterfactualSample[];
  issues: Array<{severity: "fatal" | "warning"; code: string; message: string}>;
  thresholds: {minimumSamples: number; minimumSeeds: number; minimumDecisivePairs: number; maximumOneSidedP: number};
  metrics: {
    samples: number;
    seeds: number;
    better: number;
    neutral: number;
    worse: number;
    decisivePairs: number;
    pairedWinRate: number;
    meanScoreDelta: number;
    oneSidedImprovementP: number;
    oneSidedRegressionP: number;
  };
}

export function aggregateBattleCounterfactuals(samples: readonly BattleCounterfactualSample[], options: {minimumSamples?: number; minimumSeeds?: number; minimumDecisivePairs?: number; maximumOneSidedP?: number} = {}): BattleCounterfactualAggregate {
  if (!samples.length) throw new Error("Battle counterfactual aggregate requires at least one sample");
  for (const sample of samples) validateSample(sample);
  const minimumSamples = integer(options.minimumSamples ?? 30, 3, 10000, "minimumSamples");
  const minimumSeeds = integer(options.minimumSeeds ?? 10, 2, minimumSamples, "minimumSeeds");
  const minimumDecisivePairs = integer(options.minimumDecisivePairs ?? 10, 2, minimumSamples, "minimumDecisivePairs");
  const maximumOneSidedP = finite(options.maximumOneSidedP ?? .1, .001, .5, "maximumOneSidedP");
  const issues: BattleCounterfactualAggregate["issues"] = [];
  if (samples.some(sample => !sample.sourceVerified)) issues.push({severity: "fatal", code: "source-drift", message: "At least one incumbent battle did not reproduce the retained source"});
  if (samples.some(sample => !sample.prefixVerified)) issues.push({severity: "fatal", code: "prefix-drift", message: "At least one intervention diverged before its target decision"});
  if (samples.some(sample => invalidOutcome(sample.incumbent) || invalidOutcome(sample.whitebox))) issues.push({severity: "fatal", code: "invalid-battle", message: "At least one branch stalled, errored, or did not reach a scored ending"});
  const deltas = samples.map(sample => score(sample.whitebox, sample.playerId) - score(sample.incumbent, sample.playerId));
  const better = deltas.filter(value => value > 0).length, neutral = deltas.filter(value => value === 0).length, worse = deltas.filter(value => value < 0).length;
  const decisivePairs = better + worse, seeds = new Set(samples.map(sample => sample.seed)).size;
  const oneSidedImprovementP = decisivePairs ? binomialUpperTail(better, decisivePairs) : 1;
  const oneSidedRegressionP = decisivePairs ? binomialUpperTail(worse, decisivePairs) : 1;
  if (samples.length < minimumSamples) issues.push({severity: "warning", code: "insufficient-samples", message: `${samples.length}/${minimumSamples} paired battles`});
  if (seeds < minimumSeeds) issues.push({severity: "warning", code: "insufficient-seeds", message: `${seeds}/${minimumSeeds} independent seeds`});
  if (decisivePairs < minimumDecisivePairs) issues.push({severity: "warning", code: "insufficient-decisive-pairs", message: `${decisivePairs}/${minimumDecisivePairs} outcome-changing pairs`});
  if (samples.length >= minimumSamples && seeds >= minimumSeeds && decisivePairs === 0) issues.push({severity: "warning", code: "no-observed-effect", message: "The formal sample and seed floor produced no outcome-changing pair"});
  const metrics = {samples: samples.length, seeds, better, neutral, worse, decisivePairs, pairedWinRate: round((better + neutral * .5) / samples.length), meanScoreDelta: round(mean(deltas)), oneSidedImprovementP: round(oneSidedImprovementP), oneSidedRegressionP: round(oneSidedRegressionP)};
  const fatal = issues.some(issue => issue.severity === "fatal");
  const baseEnough = samples.length >= minimumSamples && seeds >= minimumSeeds, enough = baseEnough && decisivePairs >= minimumDecisivePairs;
  const promotion: BattleAggregatePromotion = fatal ? "blocked" : baseEnough && decisivePairs === 0 ? "reject-hypothesis" : !enough ? "insufficient-evidence" : oneSidedImprovementP <= maximumOneSidedP && better > worse ? "candidate-for-assist" : "reject-hypothesis";
  return {schemaVersion: 1, promotion, samples: samples.map(sample => structuredClone(sample)), issues, thresholds: {minimumSamples, minimumSeeds, minimumDecisivePairs, maximumOneSidedP}, metrics};
}

export function battleCounterfactualAggregateMarkdown(value: BattleCounterfactualAggregate): string {
  const m = value.metrics;
  return ["# Battle counterfactual aggregate", "", `- Conclusion: ${value.promotion}`, `- Samples/seeds: ${m.samples}/${m.seeds}`, `- Better/neutral/worse: ${m.better}/${m.neutral}/${m.worse}`, `- Outcome-changing pairs: ${m.decisivePairs}/${value.thresholds.minimumDecisivePairs}`, `- Paired win rate: ${(m.pairedWinRate * 100).toFixed(1)}%`, `- Mean score delta: ${signed(m.meanScoreDelta)}`, `- One-sided improvement p: ${m.oneSidedImprovementP.toFixed(4)}`, "", "Turn count is retained for audit but is not a reward. Only the acting side's win/draw/loss score contributes to competitive direction.", ""].join("\n");
}

function invalidOutcome(value: BattleOutcomeEvidence): boolean { return value.stalled || value.errors.length > 0 || !value.ended; }
function validateSample(sample: BattleCounterfactualSample): void { if (!sample.seed || !sample.caseId || (sample.playerId !== "p1" && sample.playerId !== "p2")) throw new Error("Malformed battle counterfactual sample identity"); for (const outcome of [sample.incumbent,sample.whitebox]) if (!outcome || !Array.isArray(outcome.errors) || typeof outcome.ended !== "boolean" || typeof outcome.stalled !== "boolean" || typeof outcome.turns !== "number") throw new Error(`Malformed battle outcome in ${sample.caseId}`); }
function score(value: BattleOutcomeEvidence, playerId: "p1" | "p2"): number { const own = playerId === "p1" ? "Team A" : "Team B"; return value.winner === own ? 1 : value.winner === null ? .5 : 0; }
function binomialUpperTail(successes: number, trials: number): number { const logs:number[]=[];let logProbability=-trials*Math.log(2);for(let k=0;k<=trials;k+=1){if(k>=successes)logs.push(logProbability);if(k<trials)logProbability+=Math.log(trials-k)-Math.log(k+1);}const maximum=Math.max(...logs);return Math.exp(maximum)*logs.reduce((sum,value)=>sum+Math.exp(value-maximum),0); }
function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function integer(value: number, min: number, max: number, name: string): number { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function finite(value: number, min: number, max: number, name: string): number { if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function signed(value: number): string { return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`; }
