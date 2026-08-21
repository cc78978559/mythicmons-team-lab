import assert from "node:assert/strict";
import {assertJointBattleDecisionSnapshot, buildJointBattleDecisionSnapshot, JOINT_BATTLE_FEATURES, jointBattleKnownMask, recommendJointBattleShadow, type JointBattleCandidateV1} from "../ai/relationalBattlePolicy";

const allKnown = jointBattleKnownMask(JOINT_BATTLE_FEATURES);
function candidate(id: string, actionKind: "move" | "switch", shortValue: number, longValue: number, uncertainty = .1, terminalRisk = .1): JointBattleCandidateV1 { const values = Object.fromEntries(JOINT_BATTLE_FEATURES.map(feature => [feature, 0])) as JointBattleCandidateV1["values"]; Object.assign(values, {shortValue, longValue, uncertainty, terminalRisk}); return {id, actionKind, target: id, legal: true, values, knownMask: allKnown}; }
function snapshot(modeLabel = "balanced", candidates = [candidate("move 1", "move", .8, .6), candidate("switch 2", "switch", .4, .5)]) { return buildJointBattleDecisionSnapshot({informationMode: "closed-sheet", turn: 4, playerId: "p1", nodes: [{id: "own", kind: "own-active", publicLabel: "own"}, {id: "opponent", kind: "opponent-active", publicLabel: "opponent"}, ...candidates.map(value => ({id: `candidate:${value.id}`, kind: "candidate" as const, publicLabel: value.id}))], edges: [], candidates, legacyFallback: {candidateId: candidates[1]?.id ?? candidates[0].id, source: "legacy-search", mandatoryWhenAllCandidatesVetoed: true}, modeAuxiliary: {label: modeLabel, confidence: .9, authority: "diagnostic-only", routingAllowed: false}}); }

const first = snapshot(), reordered = buildJointBattleDecisionSnapshot({...first, nodes: [...first.nodes].reverse(), edges: [], candidates: [...first.candidates].reverse(), legacyFallback: first.legacyFallback, modeAuxiliary: first.modeAuxiliary});
assert.equal(first.sha256, reordered.sha256);
assert.equal(recommendJointBattleShadow(first).candidateId, "move 1");
assert.equal(recommendJointBattleShadow(snapshot("offense")).candidateId, recommendJointBattleShadow(snapshot("stall")).candidateId, "mode auxiliary routed the decision");
const vetoed = [candidate("move 1", "move", .8, .8, .1, 1), candidate("switch 2", "switch", .5, .5, 1, .2)], fallback = recommendJointBattleShadow(snapshot("balanced", vetoed));
assert.equal(fallback.usedLegacyFallback, true); assert.equal(fallback.candidateId, "switch 2"); assert.equal(fallback.routingAllowed, false); assert.equal(fallback.formalActivationAllowed, false);
const hidden = candidate("move 3", "move", .2, .2); hidden.knownMask = jointBattleKnownMask(JOINT_BATTLE_FEATURES.filter(feature => feature !== "longValue")); assert.throws(() => snapshot("balanced", [hidden, candidate("switch 2", "switch", .2, .2)]), /Unknown joint battle feature/);
const tampered = structuredClone(first); tampered.candidates[0].values.longValue = -.9; assert.throws(() => assertJointBattleDecisionSnapshot(tampered), /signature mismatch/);
console.log("Relational battle policy contract smoke passed");
