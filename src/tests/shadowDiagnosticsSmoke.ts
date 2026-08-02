import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {spawnSync} from "node:child_process";

const root = process.cwd(), workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-shadow-diagnostics-"));
const league = path.join(workspace, "league"), out = path.join(workspace, "diagnostics"), development = path.join(workspace, "development");
try {
  const season = path.join(league, "season-01"); fs.mkdirSync(season, {recursive: true}); fs.mkdirSync(development, {recursive: true});
  fs.writeFileSync(path.join(league, "dynasty-state.json"), `${JSON.stringify({version: 12, seed: "shadow-smoke", completedSeason: 1})}\n`);
  fs.writeFileSync(path.join(league, "audit-summary.json"), `${JSON.stringify({completedSeasons: 1, metrics: {battleFiles: 4, lineups: 2}})}\n`);
  const trace = (incumbent: string, shadow: string) => ({comparison: {incumbent, shadow, agrees: incumbent === shadow}, candidateCount: 2, reasonableCount: 2, hardRejectedCount: 0, candidates: [{id: shadow, eligible: true, finalScore: 1, contributions: [{group: "strength", value: 1}, {group: "planning", value: 0}]}, {id: incumbent, eligible: true, finalScore: .98, contributions: []}]});
  const records = [
    {stage: "lineup", decision: "lineup", context: {whiteBoxShadow: trace("same", "same")}},
    {stage: "draft", decision: "acquire", context: {whiteBoxShadow: trace("old", "new")}},
    {stage: "waiver", decision: "trade", context: {whiteBoxShadow: trace("trade-a", "trade-b"), whiteBoxTradeAssist: {incumbent: "trade-a", shadow: "trade-b", recommended: false, rationalMargin: .1, leftSideRegression: .4, rightSideRegression: 0, supportingSignals: ["one"], hardRejections: ["insufficient-margin:0.1<0.25", "insufficient-support:1<2"], parameters: {trade: {assistminimummargin: .25, assistmaximumsideregression: .25, assistminimumsignals: 2}}}}},
  ];
  fs.writeFileSync(path.join(season, "decision-ledger.json"), `${JSON.stringify({records})}\n`);
  fs.writeFileSync(path.join(season, "evolution.json"), `${JSON.stringify({applied: false})}\n`);
  fs.writeFileSync(path.join(season, "evolution-shadow-candidates.json"), `${JSON.stringify({candidates: [{programBehaviorDistance: .1, programOpportunity: {distance: .2, choicePotential: .05, byEntrypoint: {lineup: {distance: .2, choicePotential: .05}}}}]})}\n`);
  fs.writeFileSync(path.join(development, "development-summary.json"), `${JSON.stringify({policy: {academyMarket: {policy: "shadow"}}, contracts: {contracts: [{id: "one"}], replayRules: {policy: "enforce"}}})}\n`);
  const first = JSON.parse(run(["diagnose", "--source", league, "--development", development, "--out", out]).stdout), summary = read<any>(path.join(out, "shadow-diagnosis-summary.json"));
  assert.equal(first.status, "complete"); assert.equal(summary.scan.rawBattleLogsRead, 0); assert.equal(summary.scan.rawDecisionExamplesRetained, 0);
  assert.equal(summary.domains.find((row: any) => row.domain === "lineup").disagreements, 0);
  assert.equal(summary.domains.find((row: any) => row.domain === "acquisition").disagreements, 1);
  assert.equal(summary.tradeGate.blockedRates.margin, 1); assert.equal(summary.tradeGate.blockedRates.signals, 1);
  assert.equal(summary.programEvolution.candidates, 1); assert.equal(summary.development.academyMarketPolicy, "shadow");
  assert.ok(zlib.gunzipSync(fs.readFileSync(path.join(out, "shadow-diagnosis-details.json.gz"))).length > 0);
  assert.ok(read<any>(path.join(out, "token-budget.json")).estimatedTokensIfReadWhole < 4000);
  const cached = JSON.parse(run(["diagnose", "--source", league, "--development", development, "--out", out]).stdout);
  assert.equal(cached.status, "cached");
  const report = JSON.parse(run(["report", "--source", league, "--out", out]).stdout);
  assert.equal(report.completedSeason, 1); assert.ok(fs.existsSync(report.report));
  console.log("Shadow diagnostics smoke passed: compact scanning, causal funnel metrics, gzip details, cache reuse, and report");
} finally { fs.rmSync(workspace, {recursive: true, force: true}); }

function execute(commandArgs: string[]) { return spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src/cli/shadowDiagnostics.ts"), ...commandArgs], {cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024}); }
function run(commandArgs: string[]): {stdout: string; stderr: string} { const result = execute(commandArgs); assert.equal(result.status, 0, result.stderr || result.stdout); return {stdout: result.stdout, stderr: result.stderr}; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
