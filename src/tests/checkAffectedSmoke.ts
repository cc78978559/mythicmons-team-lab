import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const root = process.cwd(), cache = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-affected-check-"));
try {
  const selection = run(["--dry-run", "--files", "src/cli/runOfficialSeasonCycle.ts", "--cache", cache]);
  assert.equal(selection.changedFiles, 1); assert.equal(selection.selectedTests, 3); assert.equal(selection.planned, 4);
  const dataSelection = run(["--dry-run", "--files", "data/shadow-evidence-registry.json", "--cache", cache]);
  assert.equal(dataSelection.selectedTests, 1); assert.equal(dataSelection.planned, 2);
  const first = run(["--files", "docs/non-code-change.md", "--cache", cache]);
  assert.equal(first.selectedTests, 0); assert.equal(first.passed, 1); assert.equal(first.cached, 0);
  const repeated = run(["--files", "docs/non-code-change.md", "--cache", cache]);
  assert.equal(repeated.passed, 0); assert.equal(repeated.cached, 1); assert.ok(repeated.cacheSavedMs > 0);
  const shards = Array.from({length: 4}, (_, index) => run(["--all", "--dry-run", "--shard", `${index}/4`, "--cache", path.join(cache, `shard-${index}`)]));
  assert.deepEqual(shards.map(value => value.shard), ["0/4", "1/4", "2/4", "3/4"]);
  assert.equal(shards.reduce((sum, value) => sum + value.selectedTests, 0), shards[0].selectedBeforeShard);
  assert.equal(shards.reduce((sum, value) => sum + value.planned, 0), shards[0].selectedBeforeShard + 1, "Only shard zero should run typecheck");
  assert.throws(() => run(["--all", "--dry-run", "--shard", "4/4", "--cache", cache]));
  console.log("Affected-check smoke passed: selective planning, compact execution, cache reuse, and complete deterministic sharding");
} finally { fs.rmSync(cache, {recursive: true, force: true}); }

function run(commandArgs: string[]): any {
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "checkAffected.ts"), ...commandArgs], {cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
