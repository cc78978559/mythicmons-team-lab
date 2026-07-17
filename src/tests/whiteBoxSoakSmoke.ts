import assert from "node:assert/strict";
import {evaluateWhiteBoxSoak, whiteBoxSoakMarkdown, type WhiteBoxSoakRun} from "../ai/whiteBox/soak";

const runs = [run("seed-a", 1, "digest-a"), run("seed-a", 2, "digest-a"), run("seed-b", 1, "digest-b"), run("seed-b", 2, "digest-b")];
const stable = evaluateWhiteBoxSoak(runs);
assert.equal(stable.promotion, "soak-stable");
assert.equal(stable.metrics.deterministicSeeds, 2);
assert.equal(stable.metrics.agreementRate, 1);
assert.match(whiteBoxSoakMarkdown(stable), /结果与审计均确定的种子：2\/2/);

const drifted = evaluateWhiteBoxSoak(runs.map(entry => entry.seed === "seed-a" && entry.repeat === 2 ? {...entry, outcomeDigest: "different"} : entry));
assert.equal(drifted.promotion, "blocked");
assert(drifted.issues.some(issue => issue.code === "fixed-seed-drift"));

const auditDrifted = evaluateWhiteBoxSoak(runs.map(entry => entry.seed === "seed-a" && entry.repeat === 2 ? {...entry, auditDigest: "different"} : entry));
assert.equal(auditDrifted.promotion, "blocked");
assert(auditDrifted.issues.some(issue => issue.code === "fixed-seed-audit-drift"));

const uncovered = evaluateWhiteBoxSoak(runs.map((entry, index) => index === 0 ? {...entry, coverage: .9} : entry));
assert.equal(uncovered.promotion, "blocked");
assert(uncovered.issues.some(issue => issue.code === "coverage-below-gate"));

const oversized = evaluateWhiteBoxSoak(runs.map(entry => ({...entry, auditBytes: 40, outputBytes: 100})), .25);
assert.equal(oversized.promotion, "needs-review");
assert(oversized.issues.some(issue => issue.code === "audit-ratio-above-gate"));

console.log("White-box fixed-seed soak smoke test passed");

function run(seed: string, repeat: number, outcomeDigest: string): WhiteBoxSoakRun {
  return {seed, repeat, output: `${seed}-${repeat}`, durationMs: 1000, outcomeDigest, auditDigest: `audit-${seed}`, outputBytes: 1000, auditBytes: 100, coverage: 1, comparisons: 10, agreements: 10, fatalCount: 0, warningCount: 0, auditPromotion: "shadow-stable"};
}
