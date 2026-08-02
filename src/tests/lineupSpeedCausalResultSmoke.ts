import assert from "node:assert/strict";
import {summarizeLineupSpeedCausalResult, type LineupSpeedCausalResultCase} from "../ai/whiteBox/lineupSpeedCausalResult";

const cases = (better: number, neutral: number, worse: number): LineupSpeedCausalResultCase[] =>
  [...Array(better).fill("better"), ...Array(neutral).fill("neutral"), ...Array(worse).fill("worse")].map((direction, index) => ({
    managerId: `manager-${index}`,
    direction,
    pairMarginDelta: direction === "better" ? 1 : direction === "worse" ? -1 : 0,
    gameMarginDelta: 0,
    games: 2,
    actionDivergences: 2,
    outcomeChanges: direction === "neutral" ? 0 : 1,
    unusedSubstitutions: 0,
  }));
assert.equal(summarizeLineupSpeedCausalResult(cases(16, 4, 4)).conclusion, "candidate-for-scoped-policy-study");
assert.equal(summarizeLineupSpeedCausalResult(cases(4, 4, 16)).conclusion, "regression-rejected");
assert.equal(summarizeLineupSpeedCausalResult(cases(8, 8, 8)).conclusion, "no-clear-benefit");
assert.equal(summarizeLineupSpeedCausalResult(cases(3, 0, 0)).conclusion, "insufficient-evidence");
assert.throws(() => summarizeLineupSpeedCausalResult([...cases(1, 0, 0), {...cases(1, 0, 0)[0]}]));
console.log("Lineup speed causal result smoke passed: evidence, benefit, regression, and uniqueness gates");
