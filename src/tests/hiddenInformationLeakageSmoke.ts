import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Teams} from "pokemon-showdown";
import {chooseAction, createBattleAiContext, updateAiContextFromPublicLine, type AiDecisionTrace, type ChoiceRequest} from "../showdown/choice";
import {attachUnifiedDecisionOutcome, buildBattleDecisionRecords, buildUnifiedDecisionRecord, decisionInputProjection, readUnifiedDecisionRecords} from "../draft/unifiedDecisionRecord";
import {DecisionLedger} from "../draft/decisionLedger";

const hiddenA = Teams.import(`Rotom-Wash @ Leftovers
Ability: Levitate
- Hydro Pump
- Volt Switch
- Will-O-Wisp
- Protect`)!;
const hiddenB = Teams.import(`Rotom-Wash @ Choice Specs
Ability: Pressure
- Thunderbolt
- Shadow Ball
- Trick
- Dark Pulse`)!;
const request: ChoiceRequest = {
  active: [{moves: [{id: "earthquake", move: "Earthquake", pp: 10}, {id: "dragonclaw", move: "Dragon Claw", pp: 15}]}],
  side: {id: "p1", pokemon: [{ident: "p1: Garchomp", details: "Garchomp, L100", condition: "100/100", active: true, stats: {atk: 359, def: 226, spa: 176, spd: 206, spe: 303}, moves: ["earthquake", "dragonclaw"], ability: "Rough Skin", item: "Leftovers"}]},
};

const closedA = decision(false, hiddenA), closedB = decision(false, hiddenB);
assert.equal(closedA.choice, closedB.choice, "closed-sheet choice changed when only hidden opponent data changed");
assert.deepEqual(closedA.trace, closedB.trace, "closed-sheet trace contains or depends on hidden opponent data");
const recordsA = buildBattleDecisionRecords([closedA.trace], {battleId: "same-public-state", aiVersion: "leak-smoke", openTeamSheets: false}), recordsB = buildBattleDecisionRecords([closedB.trace], {battleId: "same-public-state", aiVersion: "leak-smoke", openTeamSheets: false});
assert.equal(recordsA[0].decisionInputSha256, recordsB[0].decisionInputSha256, "closed-sheet decision input signature leaked hidden data");
assert.equal(recordsA[0].selected, recordsB[0].selected);

const openA = decision(true, hiddenA), openB = decision(true, hiddenB), openRecordA = buildBattleDecisionRecords([openA.trace], {battleId: "declared-open-state", aiVersion: "leak-smoke", openTeamSheets: true})[0], openRecordB = buildBattleDecisionRecords([openB.trace], {battleId: "declared-open-state", aiVersion: "leak-smoke", openTeamSheets: true})[0];
assert.notEqual(openRecordA.decisionInputSha256, openRecordB.decisionInputSha256, "declared open sheets were not represented in the decision input");

const resolved = attachUnifiedDecisionOutcome(recordsA[0], {winner: "p2"});
assert.equal(resolved.decisionInputSha256, recordsA[0].decisionInputSha256, "post-decision outcome changed the decision-time input signature");
assert.notEqual(resolved.sha256, recordsA[0].sha256, "post-decision outcome was not bound to the record signature");
const protectedRecord = buildBattleDecisionRecords([closedA.trace], {battleId: "protected", aiVersion: "leak-smoke", openTeamSheets: false, replayInputSha256: "f".repeat(64), outcome: {winner: "secret-winner"}})[0], projected = JSON.stringify(decisionInputProjection(protectedRecord)); assert.equal(projected.includes("secret-winner"), false); assert.equal(projected.includes("f".repeat(64)), false); assert.equal(Object.hasOwn(decisionInputProjection(protectedRecord), "selected"), false);
const alternative = buildUnifiedDecisionRecord({...recordsA[0], selected: recordsA[0].options.find(option => option.id !== recordsA[0].selected)!.id}); assert.equal(alternative.decisionInputSha256, recordsA[0].decisionInputSha256, "counterfactual selection changed the decision-time input signature"); assert.notEqual(alternative.sha256, recordsA[0].sha256);
assert.throws(() => buildUnifiedDecisionRecord({decisionId: "leak", domain: "battle", actor: "p1", ordinal: 1, policy: {id: "test", version: "1"}, information: {mode: "closed-sheet", timing: "contemporaneous", activationEligible: true, sources: ["public-battle-protocol"]}, observation: {opponentTeam: hiddenA}, options: [{id: "move earthquake"}], selected: "move earthquake"}), /Forbidden contemporaneous decision input/);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-unified-ledger-"));
try {
  const ledger = new DecisionLedger(); ledger.add({stage: "review", actor: "manager-01", decision: "season review", selected: "revise", context: {winner: "manager-02"}, alternatives: [{option: "retain"}], rationale: ["post-season evidence"], outcome: {rank: 3}}); ledger.write(root);
  const retrospective = readUnifiedDecisionRecords(path.join(root, "unified-decisions.json.gz")); assert.equal(retrospective.length, 1); assert.equal(retrospective[0].information.timing, "retrospective"); assert.equal(retrospective[0].information.activationEligible, false);
} finally { fs.rmSync(root, {recursive: true, force: true}); }

console.log("Hidden-information smoke passed: closed sheets are invariant to hidden sets, open sheets are explicit, and outcomes cannot enter decision-time signatures");

function decision(openTeamSheets: boolean, opponentTeam: ReturnType<typeof Teams.import>): {choice: string; trace: AiDecisionTrace} {
  const context = createBattleAiContext("gen9ou", {openTeamSheets, teams: {p2: opponentTeam ?? []}});
  updateAiContextFromPublicLine(context, "|switch|p1a: Garchomp|Garchomp, L100|100/100");
  updateAiContextFromPublicLine(context, "|switch|p2a: Rotom-Wash|Rotom-Wash, L100|100/100");
  const choice = chooseAction(request, "p1", "search", context), trace = structuredClone(context.lastDecision.p1!); trace.decisionOrdinal = 1;
  return {choice, trace};
}
