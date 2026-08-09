import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const root = process.cwd(), cache = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-affected-check-"));
try {
  const selection = run(["--dry-run", "--files", "src/cli/runOfficialSeasonCycle.ts", "--cache", cache]);
  assert.equal(selection.changedFiles, 1); assert.equal(selection.selectedTests, 4); assert.equal(selection.planned, 5);
  const dataSelection = run(["--dry-run", "--files", "data/shadow-evidence-registry.json", "--cache", cache]);
  assert.equal(dataSelection.selectedTests, 1); assert.equal(dataSelection.planned, 2);
  const registrySelection = run(["--dry-run", "--files", "data/draft/g1-six-team.json", "--cache", cache]); assert.equal(registrySelection.selectedTests, 3); assert.equal(registrySelection.planned, 4);
  const benchmarkSelection = run(["--dry-run", "--files", "benchmarks/gen9expanded/index.json", "--cache", cache]); assert.equal(benchmarkSelection.selectedTests, 4); assert.equal(benchmarkSelection.planned, 5);
  const legacyBenchmarkSelection = run(["--dry-run", "--files", "benchmarks/gen9ou/index.json", "--cache", cache]); assert.equal(legacyBenchmarkSelection.selectedTests, 2); assert.equal(legacyBenchmarkSelection.planned, 3);
  const exampleSelection = run(["--dry-run", "--files", "examples/teamA.txt", "--cache", cache]); assert.equal(exampleSelection.selectedTests, 3); assert.equal(exampleSelection.planned, 4);
  const wrapperSelection = run(["--dry-run", "--files", ["src", "cli", "simulate.ts"].join("/"), "--cache", cache]); assert.equal(wrapperSelection.selectedTests, 1); assert.equal(wrapperSelection.planned, 2);
  const compositeSource = run(["--dry-run", "--files", "src/cli/aiPipeline.ts", "--cache", cache]);
  assert.equal(compositeSource.selectedTests, 2); assert.equal(compositeSource.planned, 3);
  const compositeSecondTest = run(["--dry-run", "--files", "src/tests/aiPipelineCliSmoke.ts", "--cache", cache]);
  assert.equal(compositeSecondTest.selectedTests, 2); assert.equal(compositeSecondTest.planned, 3);
  const first = run(["--files", "docs/non-code-change.md", "--cache", cache]);
  assert.equal(first.selectedTests, 0); assert.equal(first.passed, 1); assert.equal(first.cached, 0);
  const repeated = run(["--files", "docs/non-code-change.md", "--cache", cache]);
  assert.equal(repeated.passed, 0); assert.equal(repeated.cached, 1); assert.ok(repeated.cacheSavedMs > 0);
  const shards = Array.from({length: 4}, (_, index) => run(["--all", "--dry-run", "--shard", `${index}/4`, "--cache", path.join(cache, `shard-${index}`)]));
  assert.deepEqual(shards.map(value => value.shard), ["0/4", "1/4", "2/4", "3/4"]);
  assert.equal(shards.reduce((sum, value) => sum + value.selectedTests, 0), shards[0].selectedBeforeShard);
  assert.equal(shards.reduce((sum, value) => sum + value.planned, 0), shards[0].selectedBeforeShard + 1, "Only shard zero should run typecheck");
  assert.throws(() => run(["--all", "--dry-run", "--shard", "4/4", "--cache", cache]));
  console.log("Affected-check smoke passed: selective planning, composite scripts, compact execution, cache reuse, and complete deterministic sharding");
} finally { fs.rmSync(cache, {recursive: true, force: true}); }

function run(commandArgs: string[]): any {
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "checkAffected.ts"), ...commandArgs], {cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
