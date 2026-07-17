import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {runBattle} from "../showdown/battle";
import {loadTeam} from "../showdown/team";

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-memory-policy-"));
  const source = path.join(root, "source"), out = path.join(root, "experiment");
  try {
    for (let index = 0; index < 2; index += 1) {
      await runBattle({
        format: "gen9ou",
        teamA: loadTeam("examples/teamA.txt").packed,
        teamB: loadTeam("examples/teamB.txt").packed,
        seed: `memory-policy-smoke-${index}`,
        gameIndex: index,
        outDir: path.join(source, `battle-${index}`),
        maxTurns: 8,
        ai: "search",
        openTeamSheets: true,
        traceAiDecisions: true,
        aiProfiles: {p1: {id: "manager-01"}, p2: {id: "manager-02"}},
        aiOpponentModels: {
          p1: {confidence: .4, switchRate: .2, moveUsage: {earthquake: 5}, moveUsageBySpecies: {}},
          p2: {confidence: .4, switchRate: .2, moveUsage: {shadowball: 5}, moveUsageBySpecies: {}},
        },
        aiOpponentModelShadows: {
          "seasonal-decay": {
            p1: {confidence: .2, switchRate: .1, moveUsage: {earthquake: 2}, moveUsageBySpecies: {}},
            p2: {confidence: .2, switchRate: .1, moveUsage: {shadowball: 2}, moveUsageBySpecies: {}},
          },
        },
        aiOpponentModelPolicy: "cumulative",
      });
    }
    const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.resolve("src/cli/sampleTacticalMemoryAblation.ts"), "--inputs", source, "--out", out, "--shadow-policy", "seasonal-decay", "--minimum-confidence", "0", "--target-samples", "3", "--minimum-seeds", "2", "--minimum-decisive-pairs", "2", "--minimum-decisive-seeds", "2", "--max-samples", "4", "--max-launches", "3", "--min-free-gb", "0", "--run"], {cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const summary = read<any>(path.join(out, "tactical-memory-ablation-summary.json"));
    assert.equal(summary.candidates, 4);
    assert.equal(summary.completed, 3);
    assert.equal(summary.failed, 0);
    const samples = findNamed(out, "tactical-memory-ablation-sample.json").map(file => read<any>(file));
    assert.equal(samples.length, 3);
    assert(samples.every(sample => sample.candidatePolicy === "seasonal-decay" && sample.sourceVerified));
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
}

function findNamed(directory: string, name: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...findNamed(target, name));
    else if (entry.name === name) result.push(target);
  }
  return result;
}

function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }

main().then(() => console.log("Tactical memory policy sampler smoke test passed")).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
