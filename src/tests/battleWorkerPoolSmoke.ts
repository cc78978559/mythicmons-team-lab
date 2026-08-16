import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {loadTeam} from "../showdown/team";
import {runBattle, type BattleInput} from "../showdown/battle";
import {readUnifiedDecisionRecords} from "../draft/unifiedDecisionRecord";
import {recommendedBattleWorkers, runBattleWorkerPool, runBattleWorkerPoolSettled} from "../draft/battleWorkerPool";

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-battle-pool-"));
  try {
    const teamA = loadTeam("examples/teamA.txt").packed, teamB = loadTeam("examples/teamB.txt").packed, common = (gameIndex: number, outDir: string): BattleInput => ({format: "gen9ou", teamA, teamB, seed: `pool-smoke:${gameIndex}`, gameIndex, outDir, maxTurns: 8, ai: "search", openTeamSheets: true, traceAiDecisions: true, artifactMode: "training"});
    const sequential = []; for (let index = 0; index < 4; index += 1) sequential.push(await runBattle(common(index, path.join(root, "sequential"))));
    const parallel = await runBattleWorkerPool(Array.from({length: 4}, (_, index) => common(index, path.join(root, "parallel"))), 2);
    assert.deepEqual(parallel.map(result => [result.gameIndex, result.winner, result.turns, result.timeout, result.adjudication]), sequential.map(result => [result.gameIndex, result.winner, result.turns, result.timeout, result.adjudication]));
    assert.equal(parallel.every(result => result.artifactMode === "training" && result.decisionLogPath === result.unifiedDecisionLogPath && fs.existsSync(result.publicLogPath) && fs.existsSync(result.rawLogPath)), true);
    assert.equal(parallel.every(result => readUnifiedDecisionRecords(result.unifiedDecisionLogPath).length > 0), true);
    assert.equal(recommendedBattleWorkers(1), 1);
    assert.equal(recommendedBattleWorkers(10_000), Math.min(32, os.availableParallelism()));
    await assert.rejects(() => runBattleWorkerPool([common(0, path.join(root, "invalid"))], 0), /1\.\.64/);
    await assert.rejects(() => runBattle({...common(0, path.join(root, "formal-boundary")), decisionIntervention: {decisionOrdinal: 1, playerId: "p1", turn: 1, expectedIncumbent: "move 1", selected: "move 2"}}), /Training artifacts cannot be combined/);
    const completed: number[] = [], settled = await runBattleWorkerPoolSettled([common(5, path.join(root, "settled-valid")), {...common(6, path.join(root, "settled-invalid")), decisionIntervention: {decisionOrdinal: 1, playerId: "p1", turn: 1, expectedIncumbent: "move 1", selected: "move 2"}}], 2, {onComplete: (_outcome, index) => completed.push(index)});
    assert.equal(settled[0].ok, true); assert.equal(settled[1].ok, false); assert.deepEqual(completed.sort((a, b) => a - b), [0, 1]);
    console.log("Battle worker pool smoke passed: deterministic ordering, behavioral parity, compact training evidence, and bounded workers");
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
