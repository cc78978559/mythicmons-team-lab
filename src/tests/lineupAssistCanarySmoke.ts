import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {auditLineupAssistCanary} from "../ai/whiteBox/lineupAssistCanary";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lineup-canary-")), control = path.join(root, "control"), canary = path.join(root, "canary"), hash = "a".repeat(64);
try {
  writeSeason(control, false); writeSeason(canary, true);
  const summary = auditLineupAssistCanary(control, canary, [28], hash);
  assert.equal(summary.decisions.evaluated, 2);
  assert.equal(summary.decisions.applied, 1);
  assert.equal(summary.decisions.reasons["outside-canary-sample"], 1);
  assert.equal(summary.divergence.lineups, 1);
  assert.equal(summary.divergence.seriesOutcomes, 1);
  assert.deepEqual(summary.direct, {matchedApplications: 1, lineupDivergences: 1, better: 1, neutral: 0, worse: 0, missingSeries: 0});
  assert.deepEqual(summary.evidence, {decisive: 1, improvementP: .5, regressionP: 1, conclusion: "insufficient-applications", disposition: "investigate"});
  assert.deepEqual([summary.outcomes.improvedManagers, summary.outcomes.worseManagers], [1, 1]);
  assert.equal(summary.safety.valid, true);
  console.log("Lineup assist canary smoke passed");
} finally { fs.rmSync(root, {recursive: true, force: true}); }

function writeSeason(target: string, assisted: boolean): void {
  const directory = path.join(target, "season-28"); fs.mkdirSync(directory, {recursive: true});
  const winner = assisted ? "manager-01" : "manager-02";
  fs.writeFileSync(path.join(directory, "season.json"), `${JSON.stringify({season: 28, champion: {id: winner}, standings: [{id: "manager-01", points: assisted ? 3 : 0, seriesWins: assisted ? 1 : 0, seriesLosses: assisted ? 0 : 1}, {id: "manager-02", points: assisted ? 0 : 3, seriesWins: assisted ? 0 : 1, seriesLosses: assisted ? 1 : 0}], league: [{id: "series-1", left: "manager-01", right: "manager-02", leftPairs: assisted ? 1 : 0, rightPairs: assisted ? 0 : 1}], playoffs: {}})}\n`, "utf8");
  const policy = (applied: boolean) => ({approvalSha256: hash, applied, candidateId: applied ? "alternative" : null, reasons: applied ? [] : ["outside-canary-sample"]});
  const records = [
    {stage: "lineup", actor: "manager-01", selected: assisted ? ["B"] : ["A"], context: {seriesId: "series-1", ...(assisted ? {lineupAssistPolicy: policy(true)} : {})}},
    {stage: "lineup", actor: "manager-02", selected: ["C"], context: {seriesId: "series-1", ...(assisted ? {lineupAssistPolicy: policy(false)} : {})}},
  ];
  fs.writeFileSync(path.join(directory, "decision-ledger.json"), `${JSON.stringify({records})}\n`, "utf8");
}
