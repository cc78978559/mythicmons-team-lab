import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {auditEvidenceEpochs} from "../draft/evidenceEpochAudit";
import {AI_VERSION} from "../showdown/choice";
import {buildEvidenceEpoch, classifyEvidenceEpoch, LEAGUE_CONFIGURATION_POLICY_VERSION, validateEvidenceEpoch} from "../showdown/evidenceEpoch";
import {createBattleReplayCapsule, type BattleReplayInput} from "../showdown/battle";
import {DEFAULT_TACTICAL_PROFILE, EMPTY_OPPONENT_MODEL} from "../showdown/choice";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-epoch-")), out = path.join(root, "audit");
try {
  const format = "gen9ou@@@Dynamax Clause,Terastal Clause", current = buildEvidenceEpoch(AI_VERSION, format, {registryHash: "a".repeat(64), configurationPolicyVersion: LEAGUE_CONFIGURATION_POLICY_VERSION});
  assert.equal(validateEvidenceEpoch(current).length, 0);
  assert.equal(classifyEvidenceEpoch(current, current).formalActivationAllowed, true);
  const changed = structuredClone(current); changed.battlePolicy.aiVersion = "changed";
  assert.match(validateEvidenceEpoch(changed).join("; "), /signature mismatch/);

  writeCapsule(path.join(root, "legacy", "replay-input.json"), capsule(1));
  writeCapsule(path.join(root, "current", "replay-input.json"), capsule(2, current));
  writeCapsule(path.join(root, "contradiction", "replay-input.json"), capsule(2, current));
  fs.writeFileSync(path.join(root, "contradiction", "public.log"), "|-terastallize|p1a: Test|Fire\n", "utf8");
  const first = auditEvidenceEpochs(root, out, {verifyEvents: true}).summary;
  assert.equal(first.files, 3); assert.equal(first.counts["historical-only"], 1); assert.equal(first.counts["exact-compatible"], 1); assert.equal(first.counts.invalid, 1); assert.equal(first.eventViolations, 1);
  const second = auditEvidenceEpochs(root, out, {verifyEvents: true}).summary;
  assert.equal(second.cachedFiles, 3);
  fs.writeFileSync(path.join(root, "current", "public.log"), "|-terastallize|p1a: Changed|Water\n", "utf8");
  const third = auditEvidenceEpochs(root, out, {verifyEvents: true}).summary;
  assert.equal(third.cachedFiles, 2); assert.equal(third.counts.invalid, 2);
  console.log("Evidence epoch smoke passed: legacy downgrade, current admission, contradiction rejection, and cache reuse");
} finally { fs.rmSync(root, {recursive: true, force: true}); }

function writeCapsule(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, JSON.stringify(value), "utf8"); }
function capsule(schemaVersion: 1 | 2, evidenceEpoch?: ReturnType<typeof buildEvidenceEpoch>) { const input: BattleReplayInput = {schemaVersion, aiVersion: AI_VERSION, format: evidenceEpoch?.content.format ?? "gen9ou", teamA: "team-a", teamB: "team-b", seed: [1, 2, 3, 4], maxTurns: 10, idleTimeoutMs: 1000, wallClockTimeoutMs: 5000, ai: "search", openTeamSheets: true, traceAiDecisions: true, aiProfiles: {p1: DEFAULT_TACTICAL_PROFILE, p2: DEFAULT_TACTICAL_PROFILE}, aiOpponentModels: {p1: EMPTY_OPPONENT_MODEL, p2: EMPTY_OPPONENT_MODEL}, ...(evidenceEpoch ? {evidenceEpoch} : {})}; return createBattleReplayCapsule(input); }
