import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {compactLineupCounterfactual} from "../ai/whiteBox/counterfactualCapsule";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-counterfactual-capsule-")), source = path.join(root, "source"), run = path.join(root, "run");
try {
  fs.mkdirSync(source); fs.writeFileSync(path.join(source, "dynasty-state.json"), "{}");
  fs.mkdirSync(run); fs.writeFileSync(path.join(run, "counterfactual-summary.json"), JSON.stringify({source, season: 1, managerId: "manager-01", decisionId: "lineup:test:manager-01"}));
  for (const branch of ["incumbent", "whitebox"]) {
    const directory = path.join(run, branch), season = path.join(directory, "season-01");
    fs.mkdirSync(season, {recursive: true}); fs.writeFileSync(path.join(directory, "dynasty-state.json"), JSON.stringify({branch}));
    fs.writeFileSync(path.join(season, "season.json"), JSON.stringify({season: 1, branch}));
    fs.writeFileSync(path.join(season, "decision-ledger.json"), JSON.stringify({records: branch === "whitebox" ? [{context: {whiteBoxLineupExperiment: {trace: {decisionId: "lineup:test:manager-01"}}}}] : []}));
  }
  const result = compactLineupCounterfactual(run);
  assert(result.beforeBytes > 0); assert(fs.existsSync(result.archive)); assert.equal(fs.existsSync(path.join(run, "incumbent")), false); assert.equal(fs.existsSync(path.join(run, "whitebox")), false);
  const capsule = JSON.parse(zlib.gunzipSync(fs.readFileSync(result.archive)).toString("utf8"));
  assert.equal(capsule.summary.decisionId, "lineup:test:manager-01"); assert.equal(capsule.interventionRecord.context.whiteBoxLineupExperiment.trace.decisionId, "lineup:test:manager-01"); assert.equal(capsule.battleCausalSignature.available, false);
  const forced = path.join(root, "forced");
  fs.mkdirSync(forced); fs.writeFileSync(path.join(forced, "counterfactual-summary.json"), JSON.stringify({source, season: 1, managerId: "manager-01", decisionId: "lineup:forced:manager-01", interventionMode: "forced-candidate"}));
  for (const branch of ["incumbent", "whitebox"]) {
    const directory = path.join(forced, branch), season = path.join(directory, "season-01");
    fs.mkdirSync(season, {recursive: true}); fs.writeFileSync(path.join(directory, "dynasty-state.json"), JSON.stringify({branch}));
    fs.writeFileSync(path.join(season, "season.json"), JSON.stringify({season: 1, branch}));
    fs.writeFileSync(path.join(season, "decision-ledger.json"), JSON.stringify({records: branch === "whitebox" ? [{context: {programDecisionExperiment: {decisionId: "lineup:forced:manager-01", candidateId: "faster"}}}] : []}));
  }
  const forcedResult = compactLineupCounterfactual(forced);
  const forcedCapsule = JSON.parse(zlib.gunzipSync(fs.readFileSync(forcedResult.archive)).toString("utf8"));
  assert.equal(forcedCapsule.interventionRecord.context.programDecisionExperiment.candidateId, "faster");
  console.log("Counterfactual capsule smoke passed: verified evidence archive and reproducible branch removal");
} finally { fs.rmSync(root, {recursive: true, force: true}); }
