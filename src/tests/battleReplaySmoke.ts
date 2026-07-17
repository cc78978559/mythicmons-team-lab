import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {loadTeam} from "../showdown/team";
import {applyApprovedBattleAssist,loadBattleReplayCapsule, runBattle} from "../showdown/battle";
import {buildBattleAssistScope} from "../ai/whiteBox/battleScope";

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mythicmons-replay-"));
  try {
  const first = await runBattle({
    format: "gen9ou",
    teamA: loadTeam("examples/teamA.txt").packed,
    teamB: loadTeam("examples/teamB.txt").packed,
    seed: "battle-replay-smoke",
    gameIndex: 0,
    outDir: path.join(root, "source"),
    maxTurns: 8,
    ai: "search",
    openTeamSheets: true,
    traceAiDecisions: true,
    aiProfiles: {
      p1: {id: "replay-p1", aggression: .2, pivotBias: .3},
      p2: {id: "replay-p2", recoveryBias: .4, switchBias: -.1},
    },
    aiOpponentModels: {
      p1: {confidence: .4, switchRate: .2, moveUsage: {earthquake: 4}, moveUsageBySpecies: {greattusk: {earthquake: 3}}},
      p2: {confidence: .3, switchRate: .4, moveUsage: {shadowball: 5}, moveUsageBySpecies: {}},
    },
  });
  const capsule = loadBattleReplayCapsule(first.replayInputPath);
  assert.equal(capsule.sha256, first.replayInputSha256);
  assert.equal(capsule.input.aiProfiles.p1.id, "replay-p1");
  assert.equal(capsule.input.aiOpponentModels.p1.moveUsageBySpecies.greattusk.earthquake, 3);

  const replay = await runBattle({
    ...capsule.input,
    seed: "ignored-when-explicit-seed-is-present",
    explicitSeed: capsule.input.seed,
    gameIndex: 0,
    outDir: path.join(root, "replay"),
  });
  assert.equal(deterministicPublicLog(replay.publicLogPath), deterministicPublicLog(first.publicLogPath));
  assert.equal(fs.readFileSync(replay.decisionLogPath, "utf8"), fs.readFileSync(first.decisionLogPath, "utf8"));
  assert.equal(replay.winner, first.winner);
  assert.equal(replay.turns, first.turns);

  const sourceTraces = JSON.parse(fs.readFileSync(first.decisionLogPath, "utf8"));
  const target = sourceTraces.find((trace: any) => trace.whiteBoxShadow?.trace?.candidates.some((candidate: any) => candidate.id !== trace.selected && candidate.eligible && candidate.reasonable && candidate.finalScore !== null));
  assert.ok(target, "expected at least one legal alternative battle decision");
  const selected = target.whiteBoxShadow.trace.candidates.find((candidate: any) => candidate.id !== target.selected && candidate.eligible && candidate.reasonable && candidate.finalScore !== null).id;
  const branch = await runBattle({
    ...capsule.input,
    seed: "ignored-for-intervention",
    explicitSeed: capsule.input.seed,
    gameIndex: 0,
    outDir: path.join(root, "intervention"),
    decisionIntervention: {decisionOrdinal: target.decisionOrdinal, playerId: target.playerId, turn: target.turn, expectedIncumbent: target.selected, selected},
  });
  assert.equal(branch.decisionInterventionApplied, true);
  const branchTraces = JSON.parse(fs.readFileSync(branch.decisionLogPath, "utf8"));
  assert.deepEqual(branchTraces.slice(0, target.decisionOrdinal - 1), sourceTraces.slice(0, target.decisionOrdinal - 1));
  assert.equal(branchTraces[target.decisionOrdinal - 1].incumbentSelected, target.selected);
  assert.equal(branchTraces[target.decisionOrdinal - 1].selected, selected);
  assert.equal(branchTraces[target.decisionOrdinal - 1].intervention.applied, true);

  const assistCandidate=(id:string,rational:number,style:number)=>({id,eligible:true,reasonable:true,hardRejections:[],rationalScore:rational,rawStyleScore:style,appliedStyleScore:style,finalScore:rational+style,contributions:[{id:"battle.expected",group:"expected",source:"competence",value:rational,reason:"expected"},{id:"battle.downside",group:"risk",source:"risk",value:0,reason:"downside"},{id:"battle.worst",group:"risk",source:"risk",value:0,reason:"worst"}]});
  const assistTrace:any={turn:1,playerId:"p1",strategy:"search",selected:"move tackle",personalityId:"test",battleContext:{ownSpecies:"Alpha",opponentSpecies:"Beta"},whiteBoxShadow:{comparison:{incumbent:"move tackle",shadow:"switch 2",agrees:false},trace:{candidates:[assistCandidate("move tackle",2,0),assistCandidate("switch 2",3,.1)]}}};
  const assistScope=buildBattleAssistScope({ownSpecies:"Alpha",opponentSpecies:"Beta",incumbent:"move tackle",selected:"switch 2",incumbentCandidate:assistTrace.whiteBoxShadow.trace.candidates[0]});
  assert.equal(applyApprovedBattleAssist(structuredClone(assistTrace),"move tackle",new Set(),{applications:0}),"move tackle");
  const approvedTrace=structuredClone(assistTrace),assistState={applications:0};assert.equal(applyApprovedBattleAssist(approvedTrace,"move tackle",new Set([assistScope.id]),assistState),"switch 2");assert.equal(approvedTrace.assistPolicy.applied,true);assert.equal(assistState.applications,1);
  assert.notEqual(buildBattleAssistScope({ownSpecies:"Gamma",opponentSpecies:"Beta",incumbent:"move tackle",selected:"switch 2",incumbentCandidate:assistTrace.whiteBoxShadow.trace.candidates[0]}).id,assistScope.id);
  assert.notEqual(buildBattleAssistScope({ownSpecies:"Alpha",opponentSpecies:"Beta",incumbent:"move tackle",selected:"switch 2",selectedTarget:"Delta",incumbentCandidate:assistTrace.whiteBoxShadow.trace.candidates[0]}).id,buildBattleAssistScope({ownSpecies:"Alpha",opponentSpecies:"Beta",incumbent:"move tackle",selected:"switch 2",selectedTarget:"Epsilon",incumbentCandidate:assistTrace.whiteBoxShadow.trace.candidates[0]}).id);

  const corruptPath = path.join(root, "corrupt.json");
  const corrupt = JSON.parse(fs.readFileSync(first.replayInputPath, "utf8"));
  corrupt.input.maxTurns += 1;
  fs.writeFileSync(corruptPath, JSON.stringify(corrupt), "utf8");
  assert.throws(() => loadBattleReplayCapsule(corruptPath), /hash mismatch/);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

main().then(() => console.log("Battle replay capsule smoke test passed")).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

function deterministicPublicLog(file: string): string {
  return fs.readFileSync(file, "utf8").split("\n").filter(line => !line.startsWith("|t:|")).join("\n");
}
