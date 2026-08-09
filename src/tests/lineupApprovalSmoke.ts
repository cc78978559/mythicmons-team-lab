import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildLineupAssistApproval, evaluateApprovedLineupAssist, loadLineupAssistApproval} from "../ai/whiteBox/lineupApproval";
import type {WhiteBoxCandidateTrace} from "../ai/whiteBox/decision";
import {AI_VERSION} from "../showdown/choice";
import {buildEvidenceEpoch} from "../showdown/evidenceEpoch";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lineup-approval-"));
try {
  const sourceHash = "a".repeat(64), hypothesis = {id: "lineup-test-v1", title: "test", rationale: "test", stage: "observational-candidate" as const, minimumRepresentationVersion: 6, combine: "weighted-geometric-percentile" as const, factors: [{feature: "lineup.signal", direction: "higher" as const, weight: 1}], scope: ["all"], guardrails: [{feature: "lineup.strengthFloor", minimumDelta: -5}], applicability: [{source: "delta" as const, feature: "lineup.speedSpread", maximum: -.1}]};
  fs.writeFileSync(path.join(root, "causal-summary.json"), JSON.stringify({hypothesisId: hypothesis.id, conclusion: "candidate-for-scoped-policy-study", causalScope: "population-causal", activationStatus: "shadow-only", evidenceEpoch: {policySha256: buildEvidenceEpoch(AI_VERSION, "gen9ou").policySha256, formalActivationAllowed: true}, completed: 24, failed: 0, metrics: {managers: 24, cases: 24}, sharedStudySourceCache: {identity: {officialStateSha256: sourceHash}}}));
  fs.writeFileSync(path.join(root, "causal-manifest.json"), JSON.stringify({planSha256: "b".repeat(64)}));
  const approval = buildLineupAssistApproval(root, hypothesis, {applicationRate: .5, maximumApplicationsPerSeason: 2, firstSeason: 22, expiresAfterSeason: 23});
  const file = path.join(root, "approval.json"); fs.writeFileSync(file, JSON.stringify(approval)); assert.equal(loadLineupAssistApproval(file).sha256, approval.sha256);
  const incumbent = candidate("incumbent", 1, 200, 1), alternative = candidate("alternative", 2, 199.99, .8), outsideScope = candidate("outside-scope", 3, 199.99, .95);
  let decisionId = ""; for (let index = 0; index < 100; index++) { const probe = `lineup:probe-${index}`; if (!evaluateApprovedLineupAssist(approval, probe, 22, 0, incumbent, [incumbent, alternative]).reasons.includes("outside-canary-sample")) { decisionId = probe; break; } }
  assert.ok(decisionId); const applied = evaluateApprovedLineupAssist(approval, decisionId, 22, 0, incumbent, [incumbent, alternative]); assert.equal(applied.applied, true); assert.equal(applied.candidateId, "alternative");
  assert.deepEqual(evaluateApprovedLineupAssist(approval, decisionId, 22, 0, incumbent, [incumbent, outsideScope]).reasons, ["no-eligible-alternative"]);
  assert.deepEqual(evaluateApprovedLineupAssist(approval, decisionId, 24, 0, incumbent, [incumbent, alternative]).reasons, ["approval-expired"]);
  assert.deepEqual(evaluateApprovedLineupAssist(approval, decisionId, 22, 2, incumbent, [incumbent, alternative]).reasons, ["season-application-cap"]);
  const corrupt = JSON.parse(fs.readFileSync(file, "utf8")); corrupt.payload.canary.applicationRate = 1; fs.writeFileSync(file, JSON.stringify(corrupt)); assert.throws(() => loadLineupAssistApproval(file), /Invalid lineup assist approval/);
  console.log("Lineup approval smoke passed: evidence binding, signed canary, expiry, cap, and safe candidate selection");
} finally { fs.rmSync(root, {recursive: true, force: true}); }

function candidate(id: string, signal: number, rationalScore: number, speedSpread: number): WhiteBoxCandidateTrace { return {id, eligible: true, reasonable: true, hardRejections: [], rationalScore, rawStyleScore: 0, appliedStyleScore: 0, finalScore: rationalScore, contributions: [], diagnostics: {"lineup.representationVersion": 6, "lineup.signal": signal, "lineup.strengthFloor": 100, "lineup.speedSpread": speedSpread}}; }
