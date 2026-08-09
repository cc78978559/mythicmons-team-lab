import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildLineupDeploymentPostmortem} from "../ai/whiteBox/lineupDeploymentPostmortem";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lineup-deployment-postmortem-")), control = path.join(root, "control"), canary = path.join(root, "canary"), approval = "a".repeat(64);
for (const branch of [control, canary]) fs.mkdirSync(path.join(branch, "season-01"), {recursive: true});
const series = Array.from({length: 12}, (_, index) => ({id: `s${index}`, left: `m${index}`, right: `o${index}`, leftPairs: index < 3 ? 0 : index < 9 ? 1 : 1, rightPairs: index < 3 ? 1 : index < 9 ? 1 : 0}));
fs.writeFileSync(path.join(control, "season-01", "season.json"), JSON.stringify({league: series}));
fs.writeFileSync(path.join(canary, "season-01", "season.json"), JSON.stringify({league: series.map((value, index) => index < 3 ? {...value, leftPairs: 1, rightPairs: 0} : index >= 9 ? {...value, leftPairs: 0, rightPairs: 1} : value)}));
const candidate = (id: string, scope: number) => ({id, rationalScore: id === "new" ? 9.9 : 10, rawStyleScore: 0, diagnostics: {"lineup.representationVersion": 6, "lineup.scope": scope}});
const records = (branch: "control" | "canary") => Array.from({length: 12}, (_, index) => ({
  stage: "lineup", actor: `m${index}`,
  selected: branch === "control" ? ["a", "b", "c", "d", "e", "f"] : ["a", "b", "c", "d", "e", "g"],
  context: {
    seriesId: `s${index}`,
    ...(branch === "canary" ? {lineupAssistPolicy: {approvalSha256: approval, applied: true, candidateId: "new", hypothesisScoreDelta: .1, rationalRegression: .1}} : {}),
    whiteBoxShadow: {comparison: {incumbent: "old"}, candidateCount: 2, reasonableCount: 2, candidates: [candidate("old", index < 6 ? 0 : 1), candidate("new", index < 6 ? 1 : 2)]},
  },
}));
fs.writeFileSync(path.join(control, "season-01", "decision-ledger.json"), JSON.stringify({records: records("control")})); fs.writeFileSync(path.join(canary, "season-01", "decision-ledger.json"), JSON.stringify({records: records("canary")}));
const result = buildLineupDeploymentPostmortem(control, canary, [1], approval);
assert.equal(result.cases.length, 12); assert.equal(result.cases[0].editCount, 1); assert.equal(result.cases[0].cascadeExposed, false); assert.equal(result.cases[1].cascadeExposed, true);
assert.deepEqual(result.audit && [result.audit.decisiveCases, result.audit.managers], [6, 12]); assert.equal(result.validity.causalClaimsAllowed, false); assert.ok(result.researchOptions.every(value => value.researchEligible && !value.observationalCandidate));
fs.rmSync(root, {recursive: true, force: true});
console.log("Lineup deployment postmortem smoke passed: compact predecision extraction, cascade warning, and research-only options");
