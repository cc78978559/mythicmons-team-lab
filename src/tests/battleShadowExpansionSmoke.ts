import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {runBattle} from "../showdown/battle";
import {loadTeam} from "../showdown/team";

async function main(): Promise<void> {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "battle-shadow-expansion-"));
  try {
    const source = await runBattle({
      format: "gen9ou",
      teamA: loadTeam("examples/teamA.txt").packed,
      teamB: loadTeam("examples/teamB.txt").packed,
      seed: "shadow-expansion-source",
      gameIndex: 0,
      outDir: path.join(temporary, "source"),
      maxTurns: 8,
      ai: "search",
      openTeamSheets: true,
      traceAiDecisions: true,
    });
    const output = path.join(temporary, "expanded");
    const command = [require.resolve("tsx/cli"), path.join(process.cwd(), "src", "cli", "expandBattleShadowSources.ts"), "--source-game", path.dirname(source.replayInputPath), "--out", output, "--seed-count", "2", "--games-per-seed", "1", "--min-free-gb", "0"];
    run(command);
    const plan = read<any>(path.join(output, "battle-shadow-expansion-summary.json"));
    assert.equal(plan.completedGames, 0);
    assert.equal(fs.existsSync(path.join(output, "sources")), false);
    run([...command, "--max-launches", "1", "--run"]);
    const partial = read<any>(path.join(output, "battle-shadow-expansion-summary.json"));
    assert.equal(partial.completedGames, 1);
    assert.equal(partial.stopReason, "launch-budget:1");
    run([...command, "--max-launches", "2", "--run"]);
    const first = read<any>(path.join(output, "battle-shadow-expansion-summary.json"));
    assert.equal(first.completedSources, 2);
    assert.equal(first.completedGames, 2);
    assert.equal(first.failedGames, 0);
    assert.equal(first.stopReason, "source-pool-exhausted");
    for (const root of first.sourceRoots) {
      assert.equal(read<any>(path.join(root, "dynasty-state.json")).completedSeason, 0);
      assert.equal(read<any>(path.join(root, "source-origin.json")).sourceSha256, first.sourceSha256);
      assert(fs.existsSync(path.join(root, "season-00", "battles", "shadow-calibration", "game-0001", "replay-input.json")));
      assert(fs.existsSync(path.join(root, "season-00", "battles", "shadow-calibration", "game-0001", "ai-decisions.json")));
    }
    run([...command, "--max-launches", "2", "--run"]);
    const second = read<any>(path.join(output, "battle-shadow-expansion-summary.json"));
    assert.equal(second.completedGames, 2);
    assert.equal(read<any>(path.join(output, "battle-shadow-expansion-manifest.json")).runs.length, 2);
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
}

function run(command: string[]): void {
  const result = spawnSync(process.execPath, command, {cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }

main().then(() => console.log("Battle shadow source expansion smoke test passed")).catch(error => { console.error(error); process.exitCode = 1; });
