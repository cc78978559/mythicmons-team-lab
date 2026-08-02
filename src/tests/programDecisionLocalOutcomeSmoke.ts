import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {readLineupLocalOutcome} from "../ai/whiteBox/programDecisionLocalOutcome";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lineup-outcome-"));
try {
  const control = path.join(root, "control"), experiment = path.join(root, "experiment");
  writeSeason(control, 0, 1, ["manager-02", "manager-02"]);
  writeSeason(experiment, 1, 0, ["manager-01", "manager-01"]);
  const result = readLineupLocalOutcome(
    control,
    experiment,
    4,
    "lineup:final-tiebreak-1:manager-01",
    "manager-01",
  );
  assert.equal(result.seriesId, "final");
  assert.equal(result.direction, "better");
  assert.equal(result.delta.pairMargin, 2);
  assert.equal(result.delta.gameMargin, 4);
  console.log("Program decision local outcome smoke passed: current playoff keys and tiebreak aliases");
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}

function writeSeason(directory: string, leftPairs: number, rightPairs: number, winners: string[]): void {
  const season = path.join(directory, "season-04");
  fs.mkdirSync(season, {recursive: true});
  fs.writeFileSync(path.join(season, "season.json"), JSON.stringify({
    league: [],
    playoffs: {
      playIns: [],
      quarters: [],
      semifinals: [],
      final: {
        id: "final",
        left: "manager-01",
        right: "manager-02",
        leftPairs,
        rightPairs,
        splitPairs: 0,
        games: winners.map(winner => ({winner})),
      },
    },
  }));
}
