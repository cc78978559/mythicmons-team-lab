import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {spawnSync} from "node:child_process";
import {evaluateLineupPilotEvidence, type LineupPilotEvidenceSample} from "../ai/whiteBox/lineupPilotReview";

const neutral = samples(Array.from({length: 30}, () => "neutral"));
assert.equal(evaluateLineupPilotEvidence(neutral.slice(0, 1), 30).conclusion, "insufficient-evidence");
assert.equal(evaluateLineupPilotEvidence(neutral, 30).conclusion, "reject-no-observed-impact");

const positive = samples(Array.from({length: 30}, (_, index) => index < 9 ? "better" : "neutral"));
const positiveReview = evaluateLineupPilotEvidence(positive, 30);
assert.equal(positiveReview.conclusion, "candidate-for-scoped-assist-review");
assert.ok(positiveReview.metrics.oneSidedImprovementP < .1);

const negative = samples(Array.from({length: 30}, (_, index) => index < 9 ? "worse" : "neutral"));
assert.equal(evaluateLineupPilotEvidence(negative, 30).conclusion, "reject-regression");

const unused = positive.map(sample => ({...sample, actionDivergences: 0, unusedSubstitutions: 1}));
assert.equal(evaluateLineupPilotEvidence(unused, 30).conclusion, "insufficient-evidence");

const corrupt = evaluateLineupPilotEvidence(positive, 30, [{severity: "fatal", code: "hash", message: "bad hash"}]);
assert.equal(corrupt.conclusion, "blocked-integrity");
cliFixture();
console.log("Lineup pilot review smoke passed: evidence floors, expression gate, regression rejection, and review-only promotion");

function samples(directions: Array<LineupPilotEvidenceSample["direction"]>): LineupPilotEvidenceSample[] {
  return directions.map((direction, index) => ({
    id: `case-${index}`,
    managerId: `manager-${String(index + 1).padStart(2, "0")}`,
    season: [1, 2, 4, 10, 13, 14, 16, 17, 20][index % 9],
    era: index % 3 === 0 ? "early" : index % 3 === 1 ? "middle" : "late",
    sourceOutcome: index % 3 === 0 ? "win" : index % 3 === 1 ? "loss" : "draw",
    scaleBand: index % 3 === 0 ? "low" : index % 3 === 1 ? "medium" : "high",
    marginBand: index % 3 === 0 ? "razor" : index % 3 === 1 ? "close" : "wide",
    direction,
    prefixVerified: true,
    sourceVerified: true,
    interventionVerified: true,
    causalAvailable: true,
    games: 2,
    actionDivergences: 2,
    unusedSubstitutions: 0,
    outcomeChanges: direction === "neutral" ? 0 : 2,
  }));
}

function cliFixture(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lineup-pilot-review-"));
  try {
    const source = path.join(root, "source"), pilot = path.join(root, "pilot"), season = path.join(source, "season-01"), caseRoot = path.join(pilot, "cases", "case-1");
    fs.mkdirSync(season, {recursive: true}); fs.mkdirSync(caseRoot, {recursive: true});
    const stateFile = path.join(source, "dynasty-state.json"), seasonFile = path.join(season, "season.json");
    fs.writeFileSync(stateFile, "{}"); fs.writeFileSync(seasonFile, JSON.stringify({season: 1}));
    const selected = {
      id: "case-1", domain: "lineup", season: 1, actor: "manager-01",
      decisionId: "lineup:league-r1-manager-01-manager-02:manager-01",
      kind: "boundary-agreement", incumbent: "a", challenger: "b", finalMargin: .01,
      rationalDelta: 0, styleDelta: 0, traceComplete: true, reasonableBand: .5, baselineStyleLimit: 2,
      boundedScenario: {styleScale: 1.1, styleLimit: 2, selected: "b"}, replayReady: true,
      blockers: [], contributionDeltas: [], priority: 1, seriesId: "league-r1-manager-01-manager-02",
      sourceOutcome: "win", era: "early", scaleBand: "low", marginBand: "close", assetMix: ["background"],
    };
    fs.writeFileSync(path.join(pilot, "pilot-plan.json"), JSON.stringify({schemaVersion: 1, source, requested: 1, available: 1, selected: [selected], coverage: {}}));
    const archive = path.join(caseRoot, "counterfactual-evidence.json.gz");
    const capsule = {
      schemaVersion: 1,
      summary: {source, decisionId: selected.decisionId, managerId: selected.actor, season: 1, prefixVerified: true, localOutcome: {direction: "neutral"}},
      hashes: {sourceState: hash(stateFile), controlSeason: hash(seasonFile)},
      interventionRecord: {context: {whiteBoxLineupExperiment: {trace: {decisionId: selected.decisionId}}}},
      battleCausalSignature: {available: true, summary: {games: 2, actionDivergences: 2, unusedSubstitutions: 0, outcomeChanges: 0}},
    };
    fs.writeFileSync(archive, zlib.gzipSync(Buffer.from(JSON.stringify(capsule))));
    fs.writeFileSync(path.join(pilot, "pilot-manifest.json"), JSON.stringify({schemaVersion: 1, source, items: [{id: selected.id, status: "complete", output: archive, result: {direction: "neutral"}}]}));
    const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(process.cwd(), "src", "cli", "reviewShadowLineupPilot.ts"), "--pilot", pilot], {cwd: process.cwd(), encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.conclusion, "insufficient-evidence");
    assert.equal(summary.fatal, 0);
    assert.ok(fs.existsSync(path.join(pilot, "promotion-review", "lineup-promotion-review.json")));
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}
function hash(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
