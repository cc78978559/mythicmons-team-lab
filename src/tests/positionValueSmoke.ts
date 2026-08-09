import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildPositionValueModel, doctorPositionValue, pairedPositionFeatures, positionFeatures, predictPairedPositionValue} from "../ai/positionValue";
import {createBattleReplayCapsule} from "../showdown/battle";
import {AI_VERSION, DEFAULT_TACTICAL_PROFILE, EMPTY_OPPONENT_MODEL, type PositionSnapshot} from "../showdown/choice";
import {buildEvidenceEpoch, LEAGUE_CONFIGURATION_POLICY_VERSION} from "../showdown/evidenceEpoch";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-position-value-")), source = path.join(root, "source"), out = path.join(root, "out");
try {
  let battle = 0;
  for (let cluster = 0; cluster < 60; cluster += 1) for (let replica = 0; replica < 2; replica += 1) {
    const directory = path.join(source, `cluster-${cluster}`, `game-${replica}`), p1Wins = (cluster + replica) % 2 === 0, capsule = createBattleReplayCapsule({schemaVersion: 2, aiVersion: AI_VERSION, format: "gen9ou", teamA: `team-a-${cluster}`, teamB: `team-b-${cluster}`, seed: [cluster + 1, replica + 1, 3, 4], maxTurns: 80, idleTimeoutMs: 1000, wallClockTimeoutMs: 5000, ai: "search", openTeamSheets: true, traceAiDecisions: true, aiProfiles: {p1: DEFAULT_TACTICAL_PROFILE, p2: DEFAULT_TACTICAL_PROFILE}, aiOpponentModels: {p1: EMPTY_OPPONENT_MODEL, p2: EMPTY_OPPONENT_MODEL}, evidenceEpoch: buildEvidenceEpoch(AI_VERSION, "gen9ou", {registryHash: "a".repeat(64), configurationPolicyVersion: LEAGUE_CONFIGURATION_POLICY_VERSION})});
    fs.mkdirSync(directory, {recursive: true}); write(path.join(directory, "replay-input.json"), capsule); write(path.join(directory, "end.json"), {winner: p1Wins ? "Team A" : "Team B", ended: true, turns: 12, timeout: false, aiDecisionCount: 4});
    const p1 = snapshot(p1Wins), p2 = snapshot(!p1Wins); write(path.join(directory, "ai-decisions.json"), [trace("p1", 1, p1), trace("p2", 2, p2), trace("p1", 3, p1), trace("p2", 4, p2)]); battle += 1;
  }
  const first = buildPositionValueModel(source, out); assert.equal(first.battles, battle); assert.equal(first.audit.healthy, true); assert.ok(first.testImprovement.vsConstantLogLossPercent > 0); assert.equal(first.audit.formalActivationAllowed, false);
  const favorable = snapshot(true), unfavorable = snapshot(false); assert.equal(positionFeatures(favorable).length, 12); assert.equal(pairedPositionFeatures(favorable, unfavorable).length, 12); assert.ok(predictPairedPositionValue(favorable, unfavorable, first.model) > predictPairedPositionValue(unfavorable, favorable, first.model));
  const doctor = doctorPositionValue(out, true) as any; assert.equal(doctor.healthy, true); assert.equal(doctor.verifiedSources, 120);
  const tamper = path.join(source, "cluster-0", "game-0", "end.json"), original = fs.readFileSync(tamper, "utf8"); fs.appendFileSync(tamper, " "); assert.equal((doctorPositionValue(out, true) as any).healthy, false); fs.writeFileSync(tamper, original, "utf8");
  const second = buildPositionValueModel(source, out); assert.equal(second.reusedSources, 120); assert.equal(second.modelCacheHit, true); assert.equal(second.model.sha256, first.model.sha256);
  console.log("Position value smoke passed: pre-action encoding, battle-cluster splits, calibrated model, signatures, symmetry, source verification, and incremental reuse");
} finally { try { fs.rmSync(root, {recursive: true, force: true}); } catch { /* Windows may retain a transient handle until exit. */ } }

function snapshot(favorable: boolean): PositionSnapshot { const strong = favorable ? {remaining: 6, hpTotal: 5.2, activeHp: .9} : {remaining: 3, hpTotal: 2.1, activeHp: .35}, weak = favorable ? {remaining: 3, hpTotal: 2.1, activeHp: .35} : {remaining: 6, hpTotal: 5.2, activeHp: .9}, side = (value: typeof strong) => ({...value, statusCount: favorable ? 0 : 2, activeStatus: !favorable, positiveBoosts: favorable ? 2 : 0, negativeBoosts: 0, hazards: favorable ? 0 : 2, screens: favorable ? 1 : 0}); return {schemaVersion: 1, encoderVersion: "position-snapshot-v1", turn: 10, own: side(strong), opponent: {...side(weak), statusCount: favorable ? 2 : 0, activeStatus: favorable, positiveBoosts: favorable ? 0 : 2, hazards: favorable ? 2 : 0, screens: favorable ? 0 : 1}, forcedSwitch: false, trapped: false, weather: null, fieldConditions: [], information: {ownHp: "private-request", opponentHp: "public-estimate"}}; }
function trace(playerId: "p1" | "p2", ordinal: number, positionSnapshot: PositionSnapshot): any { return {decisionOrdinal: ordinal, turn: 5, playerId, strategy: "search", selected: "move tackle", positionSnapshot, personalityId: "smoke", opponentModel: {confidence: 0, switchRate: 0, activeSpecies: null, activeMoveSamples: 0, fallbackMoveSamples: 0}, candidates: []}; }
function write(file: string, value: unknown): void { fs.writeFileSync(file, `${JSON.stringify(value)}\n`, "utf8"); }
