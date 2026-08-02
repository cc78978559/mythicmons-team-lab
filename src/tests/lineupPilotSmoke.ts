import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildLineupPilotPlan} from "../ai/whiteBox/lineupPilot";
import type {ShadowExperimentCase} from "../ai/whiteBox/shadowExperimentPlanner";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lineup-pilot-"));
try {
  for (const season of [2, 9, 18]) {
    const directory = path.join(root, `season-${String(season).padStart(2, "0")}`);
    fs.mkdirSync(directory, {recursive: true});
    fs.writeFileSync(path.join(directory, "season.json"), JSON.stringify({
      league: [
        {id: `league-r1-manager-01-manager-02`, left: "manager-01", right: "manager-02", leftPairs: 1, rightPairs: 0, games: [{winner: "manager-01"}]},
        {id: `league-r2-manager-03-manager-04`, left: "manager-03", right: "manager-04", leftPairs: 0, rightPairs: 0, games: [{winner: "manager-03"}, {winner: "manager-04"}]},
      ],
      playoffs: {},
    }));
  }
  const cases: ShadowExperimentCase[] = [];
  for (const [index, season] of [2, 9, 18].entries()) {
    for (const actor of ["manager-01", "manager-02", "manager-03"]) {
      const series = actor === "manager-03" ? "league-r2-manager-03-manager-04" : "league-r1-manager-01-manager-02";
      cases.push(makeCase(season, actor, series, 1.01 + index * .2, index));
    }
  }
  const plan = buildLineupPilotPlan(cases, root, 9);
  assert.equal(plan.selected.length, 9);
  assert.deepEqual(plan.coverage.eras, {early: 3, middle: 3, late: 3});
  assert.ok(plan.coverage.outcomes.win > 0);
  assert.ok(plan.coverage.outcomes.loss > 0);
  assert.ok(plan.coverage.outcomes.draw > 0);
  assert.equal(plan.coverage.managers, 3);
  assert.deepEqual(plan.selected[0].assetMix, ["background", "custom", "special"]);
  console.log("Lineup pilot smoke passed: stratified eras, outcomes, perturbation bands, and manager diversity");
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}

function makeCase(season: number, actor: string, series: string, scale: number, index: number): ShadowExperimentCase {
  return {
    id: `${season}:${actor}`,
    domain: "lineup",
    season,
    actor,
    decisionId: `lineup:${series}:${actor}`,
    kind: "boundary-agreement",
    incumbent: "background-a+custom-g1-a-asset-1+official-a-asset-1",
    challenger: "background-b+custom-g1-a-asset-1+official-a-asset-1",
    finalMargin: .0001 + index * .005,
    rationalDelta: 0,
    styleDelta: 0,
    traceComplete: false,
    reasonableBand: .5,
    baselineStyleLimit: 2,
    boundedScenario: {styleScale: scale, styleLimit: 2, selected: "background-b+custom-g1-a-asset-1+official-a-asset-1"},
    replayReady: false,
    blockers: ["incomplete-candidate-trace"],
    contributionDeltas: [],
    priority: 1,
  };
}
