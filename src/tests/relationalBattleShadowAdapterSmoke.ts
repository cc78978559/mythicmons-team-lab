import assert from "node:assert/strict";
import {Teams} from "pokemon-showdown";
import {chooseAction, createBattleAiContext, updateAiContextFromPublicLine, type AiDecisionTrace, type ChoiceRequest} from "../showdown/choice";
import {buildBattleDecisionRecords, buildUnifiedDecisionRecord, decisionInputProjection} from "../draft/unifiedDecisionRecord";
import {buildJointBattleDecisionSnapshot, JOINT_BATTLE_FEATURES, jointBattleKnownMask, recommendJointBattleShadow, type JointBattleCandidateV1} from "../ai/relationalBattlePolicy";

const hiddenA = Teams.import(`Rotom-Wash @ Leftovers\nAbility: Levitate\n- Hydro Pump\n- Volt Switch\n- Will-O-Wisp\n- Protect`)!;
const hiddenB = Teams.import(`Rotom-Wash @ Choice Specs\nAbility: Pressure\n- Thunderbolt\n- Shadow Ball\n- Trick\n- Dark Pulse`)!;
const request: ChoiceRequest = {active: [{moves: [{id: "earthquake", move: "Earthquake", pp: 10}, {id: "dragonclaw", move: "Dragon Claw", pp: 15}]}], side: {id: "p1", pokemon: [{ident: "p1: Garchomp", details: "Garchomp, L100", condition: "100/100", active: true, stats: {atk: 359, def: 226, spa: 176, spd: 206, spe: 303}, moves: ["earthquake", "dragonclaw"], ability: "Rough Skin", item: "Leftovers"}, {ident: "p1: Corviknight", details: "Corviknight, L100", condition: "100/100", active: false, stats: {atk: 210, def: 339, spa: 142, spd: 206, spe: 170}, moves: ["bravebird", "uturn"], ability: "Pressure", item: "Leftovers"}]}};

const closedA = decision(false, hiddenA, "balanced"), closedB = decision(false, hiddenB, "balanced"), openA = decision(true, hiddenA, "balanced"), modeChanged = decision(false, hiddenA, "aggressive");
assert.equal(closedA.choice, closedA.trace.selected); assert.equal(closedA.choice, modeChanged.choice, "mode auxiliary changed legacy routing");
assert.deepEqual(closedA.trace.jointRelationalSnapshot?.candidates.map(value => value.actionKind).sort(), ["move", "move", "switch"]);
assert.equal(closedA.trace.jointBattleShadow?.routingAllowed, false); assert.equal(closedA.trace.jointBattleShadow?.formalActivationAllowed, false);
assert.equal(closedA.trace.jointBattleShadow?.candidateId, modeChanged.trace.jointBattleShadow?.candidateId, "mode auxiliary changed diagnostic recommendation");
assert.equal(closedA.trace.jointRelationalSnapshot?.sha256, decision(false, hiddenA, "balanced").trace.jointRelationalSnapshot?.sha256, "same public state changed joint signature");
assert.equal(closedA.trace.jointRelationalSnapshot?.sha256, closedB.trace.jointRelationalSnapshot?.sha256, "closed-sheet joint trace leaked hidden data");
assert.notEqual(openA.trace.jointRelationalSnapshot?.sha256, closedA.trace.jointRelationalSnapshot?.sha256, "information mode was absent from joint signature");
const record = buildBattleDecisionRecords([closedA.trace], {battleId: "joint-shadow", aiVersion: "joint-shadow-test", openTeamSheets: false})[0], projection = JSON.stringify(decisionInputProjection(record));
assert.equal(projection.includes("jointBattleShadow"), false); assert.equal(projection.includes("jointRelationalSnapshot"), false); assert.equal((record.provenance.jointBattleShadow as any).routingAllowed, false);
const alternative = buildUnifiedDecisionRecord({...record, selected: record.options.find(option => option.id !== record.selected)!.id}); assert.equal(alternative.decisionInputSha256, record.decisionInputSha256); assert.notEqual(alternative.sha256, record.sha256);
const replayRecord = buildBattleDecisionRecords([structuredClone(closedA.trace)], {battleId: "joint-shadow", aiVersion: "joint-shadow-test", openTeamSheets: false})[0]; assert.equal(replayRecord.sha256, record.sha256);

const mask = jointBattleKnownMask(JOINT_BATTLE_FEATURES), vetoed = [candidate("move 1", "move", 1, .1), candidate("switch 2", "switch", .1, 1)], snapshot = buildJointBattleDecisionSnapshot({informationMode: "closed-sheet", turn: 1, playerId: "p1", nodes: vetoed.map(value => ({id: `candidate:${value.id}`, kind: "candidate", publicLabel: value.id})), edges: [], candidates: vetoed, legacyFallback: {candidateId: "switch 2", source: "legacy-search", mandatoryWhenAllCandidatesVetoed: true}, modeAuxiliary: null}), fallback = recommendJointBattleShadow(snapshot);
assert.equal(fallback.usedLegacyFallback, true); assert.equal(fallback.candidateId, "switch 2");
console.log("Relational battle shadow adapter smoke passed");

function candidate(id: string, actionKind: "move" | "switch", uncertainty: number, terminalRisk: number): JointBattleCandidateV1 { const values = Object.fromEntries(JOINT_BATTLE_FEATURES.map(feature => [feature, 0])) as JointBattleCandidateV1["values"]; Object.assign(values, {shortValue: .2, longValue: .2, uncertainty, terminalRisk}); return {id, actionKind, target: id, legal: true, values, knownMask: mask}; }
function decision(openTeamSheets: boolean, opponentTeam: ReturnType<typeof Teams.import>, profileId: string): {choice: string; trace: AiDecisionTrace} { const context = createBattleAiContext("gen9ou", {openTeamSheets, teams: {p2: opponentTeam ?? []}, tacticalProfile: {id: profileId}}); updateAiContextFromPublicLine(context, "|switch|p1a: Garchomp|Garchomp, L100|100/100"); updateAiContextFromPublicLine(context, "|switch|p2a: Rotom-Wash|Rotom-Wash, L100|100/100"); const choice = chooseAction(request, "p1", "search", context), trace = structuredClone(context.lastDecision.p1!); trace.decisionOrdinal = 1; return {choice, trace}; }
