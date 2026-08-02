export interface LineupSpeedCausalResultCase {
  managerId: string;
  direction: "better" | "neutral" | "worse";
  pairMarginDelta: number;
  gameMarginDelta: number;
  games: number;
  actionDivergences: number;
  outcomeChanges: number;
  unusedSubstitutions: number;
}

export interface LineupSpeedCausalResult {
  schemaVersion: 1;
  conclusion: "insufficient-evidence" | "candidate-for-scoped-policy-study" | "regression-rejected" | "no-clear-benefit";
  metrics: {
    cases: number;
    managers: number;
    better: number;
    neutral: number;
    worse: number;
    pairedScore: number;
    improvementP: number;
    regressionP: number;
    games: number;
    actionDivergences: number;
    outcomeChanges: number;
    unusedSubstitutions: number;
  };
}

export function summarizeLineupSpeedCausalResult(cases: readonly LineupSpeedCausalResultCase[], expectedCases = 24): LineupSpeedCausalResult {
  if (new Set(cases.map(entry => entry.managerId)).size !== cases.length) throw new Error("Speed causal result requires manager-unique cases");
  const better = cases.filter(entry => entry.direction === "better").length;
  const neutral = cases.filter(entry => entry.direction === "neutral").length;
  const worse = cases.filter(entry => entry.direction === "worse").length;
  const decisive = better + worse;
  const improvementP = decisive ? binomialUpperTail(better, decisive) : 1;
  const regressionP = decisive ? binomialUpperTail(worse, decisive) : 1;
  const expressionRate = sum(cases, "actionDivergences") / Math.max(1, sum(cases, "games"));
  let conclusion: LineupSpeedCausalResult["conclusion"] = "no-clear-benefit";
  if (cases.length < expectedCases) conclusion = "insufficient-evidence";
  else if (worse > better && regressionP <= .1) conclusion = "regression-rejected";
  else if (better > worse && improvementP <= .1 && expressionRate >= .9 && sum(cases, "outcomeChanges") >= 6) conclusion = "candidate-for-scoped-policy-study";
  return {
    schemaVersion: 1,
    conclusion,
    metrics: {
      cases: cases.length,
      managers: new Set(cases.map(entry => entry.managerId)).size,
      better,
      neutral,
      worse,
      pairedScore: round(cases.length ? (better + neutral * .5) / cases.length : 0),
      improvementP: round(improvementP),
      regressionP: round(regressionP),
      games: sum(cases, "games"),
      actionDivergences: sum(cases, "actionDivergences"),
      outcomeChanges: sum(cases, "outcomeChanges"),
      unusedSubstitutions: sum(cases, "unusedSubstitutions"),
    },
  };
}

function sum(cases: readonly LineupSpeedCausalResultCase[], key: "games" | "actionDivergences" | "outcomeChanges" | "unusedSubstitutions"): number { return cases.reduce((total, entry) => total + entry[key], 0); }
function binomialUpperTail(successes: number, trials: number): number {
  const logs: number[] = []; let logProbability = -trials * Math.log(2);
  for (let k = 0; k <= trials; k++) { if (k >= successes) logs.push(logProbability); if (k < trials) logProbability += Math.log(trials - k) - Math.log(k + 1); }
  const maximum = Math.max(...logs);
  return Math.exp(maximum) * logs.reduce((total, value) => total + Math.exp(value - maximum), 0);
}
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
