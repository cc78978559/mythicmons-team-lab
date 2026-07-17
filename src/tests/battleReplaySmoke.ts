import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {loadTeam} from "../showdown/team";
import {loadBattleReplayCapsule, runBattle} from "../showdown/battle";

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
