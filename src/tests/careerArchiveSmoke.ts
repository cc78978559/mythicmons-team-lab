import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {buildCareerArchive, loadCareerMemoryCheckpoint, readCareerPortrait} from "../draft/careerArchive";

const root = process.cwd(), temporary = fs.mkdtempSync(path.join(os.tmpdir(), "mythicmons-career-"));
try {
  const source = path.join(temporary, "source"), next = path.join(temporary, "next");
  runLeague(source, "career-source");
  const archive = buildCareerArchive(source);
  assert.equal(archive.managers, 6);
  assert.ok(archive.compressedBytes < archive.checkpointBytes);
  const checkpoint = loadCareerMemoryCheckpoint(archive.checkpointManifest);
  assert.equal(checkpoint.managers.length, 6);
  const portrait = readCareerPortrait(archive.destination, "manager-01");
  assert.equal(portrait.record.seasons, 1);
  assert.match(portrait.introduction, /我是经理 01/);

  runLeague(next, "career-next", archive.checkpointManifest);
  const sourceState = read<any>(path.join(source, "dynasty-state.json")), nextState = read<any>(path.join(next, "dynasty-state.json"));
  assert.equal(nextState.completedSeason, 1);
  assert.equal(nextState.managers.reduce((sum: number, manager: any) => sum + manager.titles, 0), 1, "old titles must not carry into the new journey");
  assert.ok(nextState.managers.every((manager: any, index: number) => manager.currentProfile.development.seasons >= sourceState.managers[index].currentProfile.development.seasons));
  assert.ok(nextState.decisionRecords.some((record: any) => record.decision === "从生涯心智检查点开启新旅程"));
  const budgets = read<any>(path.join(next, "season-01", "starting-budgets.json"));
  assert.ok(Object.values(budgets.managers).every(value => value === 40));
  const keepers = read<any>(path.join(next, "season-01", "keepers.json"));
  assert.ok(Object.values(keepers.managers).every(value => Array.isArray(value) && value.length === 0));
  const battleArchive = read<any>(path.join(next, "season-01", "battle-archive.json"));
  assert.equal(battleArchive.retention, "compact");
  assert.ok(battleArchive.compactEvidenceBattles > 0);
  assert.equal(findFiles(path.join(next, "season-01", "battles"), "public.log.gz").length, battleArchive.battles);
  assert.ok(findFiles(path.join(next, "season-01", "battles"), "ai-summary.json").length > 0);
  console.log("Career archive, inherited memory, and compact evidence smoke test passed");
} finally {
  fs.rmSync(temporary, {recursive: true, force: true});
}

function runLeague(output: string, seed: string, checkpoint = ""): void {
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV12.ts")], {
    cwd: root,
    env: {...process.env, V12_OUT: output, V12_SEASONS: "1", V12_RESUME: "false", V12_SEED: seed, V12_MANAGER_LIMIT: "6", V12_PAIRS: "1", V12_POOL_SIZE: "100", V12_AUCTION_LOTS: "10", V12_REGULAR_ROUNDS: "2", V12_MAX_TURNS: "20", V12_MIN_ROSTER: "6", V12_MAX_ROSTER: "6", V12_EVIDENCE_RETENTION: "compact", V12_EVIDENCE_SAMPLE_RATE: "0", V12_CAREER_CHECKPOINT: checkpoint},
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

function findFiles(directory: string, name: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...findFiles(target, name));
    else if (entry.name === name) files.push(target);
  }
  return files;
}
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
