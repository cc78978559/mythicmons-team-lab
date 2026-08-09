import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const repo = path.resolve(__dirname, "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lineup-deployment-summary-"));
const study = path.join(root, "study-a");
const out = path.join(root, "summary");
fs.mkdirSync(study, {recursive: true});
fs.writeFileSync(path.join(study, "causal-summary.json"), JSON.stringify({
  schemaVersion: 1,
  activationStatus: "shadow-only",
  hypothesisId: "boundary-a-v1",
  causalScope: "manager-selected-accumulation",
  conclusion: "no-clear-benefit",
  completed: 2,
  failed: 0,
  metrics: {cases: 2, managers: 2, better: 0, neutral: 1, worse: 1, games: 4, actionDivergences: 3, outcomeChanges: 1},
}));
const run = path.join(root, "portfolio-run.json");
const review = path.join(root, "review.json");
fs.writeFileSync(run, JSON.stringify({schemaVersion: 1, activationStatus: "shadow-only", status: "complete", items: [{hypothesisId: "boundary-a-v1", study}]}));
fs.writeFileSync(review, JSON.stringify({activationStatus: "shadow-only", round: 2, executed: 2, unexecuted: 1, firstChoiceExecuted: 2, informationReward: {mean: 0.5}}));
const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(repo, "src/cli/summarizeLineupDeploymentPortfolio.ts"), "--run", run, "--review", review, "--out", out], {cwd: repo, encoding: "utf8"});
assert.equal(result.status, 0, result.stderr || result.stdout);
const summary = JSON.parse(fs.readFileSync(path.join(out, "portfolio-summary.json"), "utf8"));
assert.equal(summary.conclusion, "no-boundary-rescued-deployment");
assert.equal(summary.recommendation, "retain-parent-retirement");
assert.deepEqual(summary.totals, {cases: 2, managers: 2, better: 0, neutral: 1, worse: 1, games: 4, actionDivergences: 3, outcomeChanges: 1, studies: 1});
assert.equal(summary.managerLearning.firstChoiceExecuted, 2);
assert.equal(summary.authority, "research-only-no-activation-authority");
fs.rmSync(root, {recursive: true, force: true});
console.log("Lineup deployment portfolio summary smoke passed: aggregate verdict, manager learning, and activation guard");
