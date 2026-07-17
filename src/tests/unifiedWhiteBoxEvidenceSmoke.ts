import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {buildUnifiedEvidencePlan, unifiedEvidenceMarkdown} from "../ai/whiteBox/unifiedEvidence";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "unified-whitebox-"));
try {
  const candidate = (id: string, rational: number, style: number) => ({id, eligible: true, reasonable: true, hardRejections: [], rationalScore: rational, rawStyleScore: style, appliedStyleScore: style, finalScore: rational + style, contributions: [{id: "test.value", group: "value", source: "competence", value: rational, reason: "test"}]});
  const shadow = (decisionId: string, incumbent: string, selected: string) => ({version: "white-box-decision-v1", decisionId, comparison: {incumbent, shadow: selected, agrees: false}, candidateCount: 2, reasonableCount: 2, hardRejectedCount: 0, candidates: [candidate(incumbent, 2, 0), candidate(selected, 2.4, .1)]});
  fs.writeFileSync(path.join(root, "dynasty-state.json"), JSON.stringify({seed: "unified-smoke", completedSeason: 2, decisionRecords: [
    {id: "keeper-1", actor: "manager-01", decision: "keeper", context: {season: 2, keeperWhiteBoxShadow: shadow("keeper:manager-01:2", "a+b", "a")}},
    {id: "keeper-2", actor: "manager-02", decision: "keeper", context: {season: 2, keeperWhiteBoxShadow: shadow("keeper:manager-02:2", "a+b", "a")}},
    {id: "lineup-1", actor: "manager-03", decision: "lineup", context: {season: 2, whiteBoxShadow: shadow("lineup:series-1:manager-03", "a+b+c+d+e+f", "a+b+c+d+e+g")}},
    {id: "draft-1", actor: "manager-04", decision: "draft", context: {season: 2, whiteBoxShadow: shadow("acquire:supplemental:2:1:manager-04", "a", "b")}},
  ]}));
  const battleDir = path.join(root, "season-02", "battles", "game-1"); fs.mkdirSync(battleDir, {recursive: true});
  fs.writeFileSync(path.join(battleDir, "ai-decisions.json"), JSON.stringify([{turn: 3, playerId: "p1", personalityId: "manager-05", whiteBoxShadow: {comparison: {incumbent: "move 1", shadow: "switch 2", agrees: false}, trace: shadow("battle:game-1:3:p1", "move 1", "switch 2")}}]));
  const plan = buildUnifiedEvidencePlan([root], {maximumCases: 10, maximumPerDomain: 2});
  assert.equal(plan.metrics.scanned, 5);
  assert.equal(plan.metrics.uniqueFingerprints, 4);
  assert.equal(plan.sources[0].battleEvidence, "available");
  assert.equal(plan.sources[0].battleDifferences, 1);
  assert.equal(plan.cases.find(entry => entry.domain === "keeper")?.duplicates, 2);
  assert.equal(plan.cases.find(entry => entry.domain === "keeper")?.status, "executable");
  assert.equal(plan.cases.find(entry => entry.domain === "lineup")?.status, "requires-gate");
  assert.equal(plan.cases.find(entry => entry.domain === "battle")?.status, "requires-gate");
  assert.equal(plan.cases.find(entry => entry.domain === "acquisition")?.status, "archive-only");
  assert.match(unifiedEvidenceMarkdown(plan), /统一白箱反事实证据清单/);
  const output = path.join(root, "evidence-output");
  for (let pass = 0; pass < 2; pass += 1) {
    const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(process.cwd(), "src", "cli", "unifiedWhiteBoxEvidence.ts"), "--inputs", root, "--out", output, "--max-cases", "10", "--max-per-domain", "2"], {cwd: process.cwd(), encoding: "utf8"});
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(output, "evidence-manifest.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.plan.metrics.scanned, 5);
  assert.deepEqual(manifest.runs, []);
  assert.ok(fs.existsSync(path.join(output, "evidence-plan.md")));
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
console.log("Unified white-box evidence planning smoke test passed");
