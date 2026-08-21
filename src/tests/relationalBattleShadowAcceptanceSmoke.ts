import assert from "node:assert/strict";
import {auditRelationalBattleShadowRecords} from "../ai/relationalBattleShadowAcceptance";
import {buildJointBattleDecisionSnapshot, JOINT_BATTLE_FEATURES, jointBattleKnown, jointBattleKnownMask, recommendJointBattleShadow, type JointBattleCandidateV1} from "../ai/relationalBattlePolicy";
import {buildUnifiedDecisionRecord, decisionInputProjection, type UnifiedDecisionRecord} from "../draft/unifiedDecisionRecord";

const move = candidate("move tackle", "move", .7, .6), switched = candidate("switch 2", "switch", .4, .5), snapshot = buildJointBattleDecisionSnapshot({informationMode: "closed-sheet", turn: 3, playerId: "p1", nodes: [move, switched].map(value => ({id: `candidate:${value.id}`, kind: "candidate", publicLabel: value.id})), edges: [], candidates: [move, switched], legacyFallback: {candidateId: "move tackle", source: "legacy-search", mandatoryWhenAllCandidatesVetoed: true}, modeAuxiliary: {label: "fixture", confidence: .5, authority: "diagnostic-only", routingAllowed: false}}), recommendation = recommendJointBattleShadow(snapshot);
const valid = record(snapshot, recommendation), healthy = auditRelationalBattleShadowRecords([valid]);
assert.deepEqual(healthy, {schemaVersion: 1, version: "relational-battle-shadow-acceptance-v1", authority: "read-only-shadow-diagnostic", activationStatus: "shadow-only", formalActivationAllowed: false, records: 1, accepted: 1, rejected: 0, candidates: {move: 1, switch: 1}, informationModes: {openSheet: 0, closedSheet: 1}, recommendations: {diagnostic: 1, legacyFallback: 0}, healthy: true, issues: []});
assert.deepEqual(auditRelationalBattleShadowRecords([]), {schemaVersion: 1, version: "relational-battle-shadow-acceptance-v1", authority: "read-only-shadow-diagnostic", activationStatus: "shadow-only", formalActivationAllowed: false, records: 0, accepted: 0, rejected: 0, candidates: {move: 0, switch: 0}, informationModes: {openSheet: 0, closedSheet: 0}, recommendations: {diagnostic: 0, legacyFallback: 0}, healthy: false, issues: [{code: "shadow-no-records", count: 1}]});

const openSnapshot = buildJointBattleDecisionSnapshot({...snapshot, informationMode: "open-sheet", modeAuxiliary: {label: "open-fixture", confidence: .75, authority: "diagnostic-only", routingAllowed: false}}), openRecommendation = recommendJointBattleShadow(openSnapshot), openValid = record(openSnapshot, openRecommendation), dualMode = auditRelationalBattleShadowRecords([valid, openValid]);
assert.deepEqual(dualMode.informationModes, {openSheet: 1, closedSheet: 1}); assert.deepEqual(dualMode.candidates, {move: 2, switch: 2}); assert.equal(dualMode.healthy, true);
assert.ok(openSnapshot.candidates.every(value => ["shortValue", "longValue", "uncertainty", "terminalRisk"].every(feature => jointBattleKnown(value.knownMask, feature as typeof JOINT_BATTLE_FEATURES[number]))));
assert.deepEqual(openSnapshot.candidates.map(value => value.id).sort(), openValid.options.map(value => value.id).sort());
assert.equal(openSnapshot.modeAuxiliary?.authority, "diagnostic-only"); assert.equal(openSnapshot.modeAuxiliary?.routingAllowed, false); assert.equal(openRecommendation.routingAllowed, false);
assert.equal(openValid.selected, openSnapshot.legacyFallback.candidateId); assert.equal(JSON.stringify(decisionInputProjection(openValid)).includes("jointBattle"), false);
const openAlternative = rebuild(openValid, {selected: "switch 2", postDecision: {winner: "p2"}}); assert.equal(openAlternative.decisionInputSha256, openValid.decisionInputSha256);

const incomplete = record(buildJointBattleDecisionSnapshot({...snapshot, nodes: snapshot.nodes.slice(0, 1), candidates: [move], legacyFallback: snapshot.legacyFallback, modeAuxiliary: snapshot.modeAuxiliary}), recommendJointBattleShadow(buildJointBattleDecisionSnapshot({...snapshot, nodes: snapshot.nodes.slice(0, 1), candidates: [move], legacyFallback: snapshot.legacyFallback, modeAuxiliary: snapshot.modeAuxiliary})));
const wrongSelected = rebuild(valid, {selected: "switch 2"});
const wrongRecommendation = rebuild(valid, {provenance: {...valid.provenance, jointBattleShadow: {...recommendation, candidateId: "switch 2"}}});
const leaked = rebuild(valid, {observation: {...valid.observation, jointBattleShadow: recommendation}});
const badSnapshot = structuredClone(snapshot); badSnapshot.candidates[0].knownMask = "xxxxxx";
const badSnapshotVersion = structuredClone(snapshot); (badSnapshotVersion as any).version = "future";
const routedMode = structuredClone(snapshot); (routedMode.modeAuxiliary as any).routingAllowed = true;
const badSignature = structuredClone(valid); badSignature.sha256 = "0".repeat(64);
const badRecordVersion = structuredClone(valid); (badRecordVersion as any).version = "future";
const failed = auditRelationalBattleShadowRecords([incomplete, wrongSelected, wrongRecommendation, leaked, rebuild(valid, {provenance: {...valid.provenance, jointRelationalSnapshot: badSnapshot}}), rebuild(valid, {provenance: {...valid.provenance, jointRelationalSnapshot: badSnapshotVersion}}), rebuild(valid, {provenance: {...valid.provenance, jointRelationalSnapshot: routedMode}}), badSignature, badRecordVersion]);
assert.equal(failed.healthy, false); assert.equal(failed.accepted, 0);
assert.equal(failed.rejected, 9);
assert.deepEqual(new Set(failed.issues.map(issue => issue.code)), new Set(["shadow-candidate-incomplete", "shadow-legacy-selection-mismatch", "shadow-recommendation-mismatch", "shadow-input-leakage", "shadow-snapshot-signature-invalid", "shadow-snapshot-contract-invalid", "shadow-record-signature-invalid", "shadow-record-contract-invalid"]));

const alternativeOutcome = rebuild(valid, {selected: "switch 2", postDecision: {winner: "p2"}});
assert.equal(alternativeOutcome.decisionInputSha256, valid.decisionInputSha256, "selection or result entered the input signature");
const allVeto = [candidate("move tackle", "move", .2, .2, 1), candidate("switch 2", "switch", .2, .2, .99)], vetoSnapshot = buildJointBattleDecisionSnapshot({...snapshot, candidates: allVeto, legacyFallback: {candidateId: "move tackle", source: "legacy-search", mandatoryWhenAllCandidatesVetoed: true}}), vetoRecommendation = recommendJointBattleShadow(vetoSnapshot);
assert.equal(vetoRecommendation.usedLegacyFallback, true); assert.equal(auditRelationalBattleShadowRecords([record(vetoSnapshot, vetoRecommendation)]).healthy, true);
const noModeSnapshot = buildJointBattleDecisionSnapshot({...snapshot, modeAuxiliary: null}); assert.equal(auditRelationalBattleShadowRecords([record(noModeSnapshot, recommendJointBattleShadow(noModeSnapshot))]).healthy, true);
assert.throws(() => buildJointBattleDecisionSnapshot({...snapshot, candidates: [{...move, knownMask: "000000", values: {...move.values, shortValue: .7}}]}), /Unknown joint battle feature must be zero/);
console.log("Relational battle shadow acceptance smoke passed");

function candidate(id: string, actionKind: "move" | "switch", shortValue: number, longValue: number, terminalRisk = .1): JointBattleCandidateV1 { const values = Object.fromEntries(JOINT_BATTLE_FEATURES.map(feature => [feature, 0])) as JointBattleCandidateV1["values"]; Object.assign(values, {shortValue, longValue, uncertainty: .1, terminalRisk}); return {id, actionKind, target: id, legal: true, values, knownMask: jointBattleKnownMask(["shortValue", "longValue", "uncertainty", "terminalRisk"])}; }
function record(jointSnapshot = snapshot, jointRecommendation = recommendation): UnifiedDecisionRecord { const open = jointSnapshot.informationMode === "open-sheet"; return buildUnifiedDecisionRecord({decisionId: `fixture:${jointSnapshot.informationMode}:p1:1`, domain: "battle", actor: "p1", ordinal: 1, policy: {id: "legacy-search", version: "fixture"}, information: {mode: jointSnapshot.informationMode, timing: "contemporaneous", activationEligible: true, sources: ["own-private-request", "public-battle-protocol", ...(open ? ["declared-open-team-sheet"] : [])]}, observation: {turn: 3}, options: [move, switched].map(value => ({id: value.id, score: value.values.shortValue})), selected: "move tackle", provenance: {jointRelationalSnapshot: jointSnapshot, jointBattleShadow: jointRecommendation}}); }
function rebuild(base: UnifiedDecisionRecord, changes: Partial<UnifiedDecisionRecord>): UnifiedDecisionRecord { return buildUnifiedDecisionRecord({...base, ...changes, provenance: changes.provenance ?? base.provenance, selected: changes.selected ?? base.selected, postDecision: changes.postDecision ?? base.postDecision}); }
