import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {runBattle} from "../showdown/battle";
import {loadTeam} from "../showdown/team";
import {assertRelationalDecisionSnapshot, relationalKnown, RELATIONAL_ENCODER_VERSION, RELATIONAL_SWITCH_FEATURES, type RelationalSwitchFeature} from "../ai/relationalDecision";
import {managerProgramV3Hash, noviceManagerProgramV3, type ManagerProgramRuleV3} from "../ai/managerProgramV3";
import type {AiDecisionTrace} from "../showdown/choice";

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "relational-battle-v3-")), common = {format: "gen9ou", teamA: loadTeam("examples/teamA.txt").packed, teamB: loadTeam("examples/teamB.txt").packed, seed: "relational-battle-v3", gameIndex: 0, maxTurns: 30, ai: "search" as const, traceAiDecisions: true};
  try {
    const open = await runBattle({...common, outDir: path.join(root, "open"), openTeamSheets: true}), closed = await runBattle({...common, outDir: path.join(root, "closed"), openTeamSheets: false});
    const openTraces = read(open.decisionLogPath), closedTraces = read(closed.decisionLogPath); assert.ok(openTraces.length && closedTraces.length);
    for (const trace of [...openTraces, ...closedTraces]) { assert.ok(trace.relationalSnapshot); assert.doesNotThrow(() => assertRelationalDecisionSnapshot(trace.relationalSnapshot!)); assert.equal(trace.relationalSnapshot!.candidates.every(candidate => Object.keys(candidate.values).length === 24), true); }
    assert.equal(closedTraces.every(trace => trace.relationalSnapshot!.informationMode === "closed-sheet" && trace.relationalSnapshot!.nodes.filter(node => node.kind === "opponent-response").every(node => !node.publicLabel.startsWith("switch "))), true);
    assert.equal(openTraces.every(trace => trace.relationalSnapshot!.informationMode === "open-sheet"), true);
    let target: AiDecisionTrace | undefined, feature: RelationalSwitchFeature | undefined, weight = 1;
    for (const trace of openTraces.filter(value => value.selected.startsWith("switch "))) { const switches = trace.relationalSnapshot!.candidates.filter(candidate => candidate.actionKind === "switch"); for (const name of RELATIONAL_SWITCH_FEATURES) { if (switches.length < 2 || switches.some(candidate => !relationalKnown(candidate.knownMask, name)) || new Set(switches.map(candidate => candidate.values[name])).size < 2) continue; for (const sign of [1, -1]) { const proposed = [...switches].sort((a, b) => sign * b.values[name] - sign * a.values[name] || a.id.localeCompare(b.id))[0].id; if (proposed !== trace.selected) { target = trace; feature = name; weight = sign; break; } } if (target) break; } if (target) break; } assert.ok(target?.decisionOrdinal && feature);
    const evidence = {encoderVersion: RELATIONAL_ENCODER_VERSION, corpusSignature: "a".repeat(64), familySplitSignature: "b".repeat(64)}, program = noviceManagerProgramV3("battle-smoke", evidence), parent = managerProgramV3Hash(program);
    const ruleBase: Omit<ManagerProgramRuleV3, "id"> = {conditions: [], terms: [{path: `candidate.${feature!}`, reducer: "identity", transform: "linear", weight}], lineage: {operation: "mutate", parents: [parent], evidenceClusters: ["smoke"]}}; program.rules.push({...ruleBase, id: "mp3-battle-smoke"}); program.revision = 1; program.ancestry = [parent];
    const branch = await runBattle({...common, outDir: path.join(root, "program"), openTeamSheets: true, decisionProgramIntervention: {protocol: "manager-program-v3-switch-v1", playerId: target!.playerId, startDecisionOrdinal: target!.decisionOrdinal!, maxControlledDecisions: 5, program, programHash: managerProgramV3Hash(program), encoderVersion: RELATIONAL_ENCODER_VERSION, ancestorSourceFingerprints: [], ancestorFamilyClusterIds: []}});
    assert.ok(branch.decisionProgramEvaluations >= 1 && branch.decisionProgramEvaluations <= 5); assert.ok(branch.decisionProgramApplications >= 1); assert.equal(branch.decisionProgramEvents.length, branch.decisionProgramEvaluations);
    const branchTraces = read(branch.decisionLogPath), interventionTrace = branchTraces.find(trace => trace.v3ProgramPolicy?.accepted); assert.ok(interventionTrace); assert.equal(interventionTrace!.v3ProgramPolicy!.programHash, managerProgramV3Hash(program));
    const rerun = await runBattle({...common, outDir: path.join(root, "open-rerun"), openTeamSheets: true}); assert.equal(normalize(open.publicLogPath), normalize(rerun.publicLogPath)); assert.deepEqual(read(rerun.decisionLogPath), openTraces);
    console.log("Relational battle V3 smoke passed: open/closed information boundary, signed traces, five-decision adapter, and shadow parity");
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
}
function read(file: string): AiDecisionTrace[] { return JSON.parse(fs.readFileSync(file, "utf8")) as AiDecisionTrace[]; }
function normalize(file: string): string { return fs.readFileSync(file, "utf8").split("\n").filter(line => !line.startsWith("|t:|")).join("\n"); }
main().catch(error => { console.error(error); process.exitCode = 1; });
