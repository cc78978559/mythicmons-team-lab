import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const root = process.cwd(), cache = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-affected-check-"));
try {
  const selection = run(["--dry-run", "--files", "src/cli/runOfficialSeasonCycle.ts", "--cache", cache]);
  assert.equal(selection.changedFiles, 1); assert.equal(selection.selectedTests, 2); assert.equal(selection.planned, 3);
  const first = run(["--files", "docs/non-code-change.md", "--cache", cache]);
  assert.equal(first.selectedTests, 0); assert.equal(first.passed, 1); assert.equal(first.cached, 0);
  const repeated = run(["--files", "docs/non-code-change.md", "--cache", cache]);
  assert.equal(repeated.passed, 0); assert.equal(repeated.cached, 1); assert.ok(repeated.cacheSavedMs > 0);
  console.log("Affected-check smoke passed: selective planning, compact execution, and hash-bound cache reuse");
} finally { fs.rmSync(cache, {recursive: true, force: true}); }

function run(commandArgs: string[]): any {
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "checkAffected.ts"), ...commandArgs], {cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
