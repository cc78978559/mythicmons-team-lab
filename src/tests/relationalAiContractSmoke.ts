import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const started = Date.now(), rssBefore = process.memoryUsage().rss;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "relational-ai-contract-")), missingRoot = path.join(temporary, "missing"), tamperedRoot = path.join(temporary, "tampered"), cli = path.resolve("src/cli/relationalAi.ts");
try {
  fs.mkdirSync(missingRoot); write(path.join(tamperedRoot, "manager-program-v3", "summary.json"), {});

  const defaultStatus = invokeReadOnly(missingRoot, ["--root", missingRoot]);
  assert.equal(defaultStatus.status, 0); assertContract(defaultStatus.value); assert.equal(defaultStatus.value.available, false); assert.equal(defaultStatus.value.healthy, true);

  const explicitStatus = invokeReadOnly(missingRoot, ["status", "--root", missingRoot, "--verify-corpus"]);
  assert.equal(explicitStatus.status, 0); assertContract(explicitStatus.value); assert.deepEqual(explicitStatus.value, defaultStatus.value);

  const unhealthyStatus = invokeReadOnly(tamperedRoot, ["status", "--root", tamperedRoot]);
  assert.equal(unhealthyStatus.status, 0); assertContract(unhealthyStatus.value); assert.equal(unhealthyStatus.value.healthy, false); assert.ok(unhealthyStatus.value.issues.some((issue: any) => issue.code === "stage3v3-unavailable"));

  const unhealthyDoctor = invokeReadOnly(tamperedRoot, ["doctor", "--root", tamperedRoot]);
  assert.equal(unhealthyDoctor.status, 2); assertContract(unhealthyDoctor.value); assert.deepEqual(unhealthyDoctor.value, unhealthyStatus.value);

  const healthyDoctor = invokeReadOnly(missingRoot, ["doctor", "--root", missingRoot]);
  assert.equal(healthyDoctor.status, 0); assertContract(healthyDoctor.value); assert.equal(healthyDoctor.value.healthy, true);

  console.log(`Relational AI CLI contract smoke passed: default/status/doctor exit codes, JSON contract, missing/tampered archives, and zero writes (${Date.now() - started}ms, RSS delta ${process.memoryUsage().rss - rssBefore} bytes)`);
} finally { fs.rmSync(temporary, {recursive: true, force: true}); }

function invokeReadOnly(root: string, args: string[]): {status: number | null; value: any} {
  const before = snapshot(root), result = spawnSync(process.execPath, [require.resolve("tsx/cli"), cli, ...args], {cwd: process.cwd(), encoding: "utf8", maxBuffer: 8 * 1024 * 1024});
  assert.equal(result.signal, null, result.stderr); assert.equal(result.stderr, ""); assert.deepEqual(snapshot(root), before, `CLI mutated ${root}`);
  let value: any; assert.doesNotThrow(() => { value = JSON.parse(result.stdout); }, result.stdout || result.stderr); return {status: result.status, value};
}
function assertContract(value: any): void { assert.equal(typeof value.available, "boolean"); assert.equal(typeof value.healthy, "boolean"); assert.equal(typeof value.activationReady, "boolean"); assert.equal(typeof value.stages, "object"); assert.ok(Array.isArray(value.issues)); }
function snapshot(root: string): string[] { const rows: string[] = []; const visit = (directory: string) => { for (const entry of fs.readdirSync(directory, {withFileTypes: true})) { const file = path.join(directory, entry.name); if (entry.isDirectory()) visit(file); else { const stat = fs.statSync(file); rows.push(`${path.relative(root, file).replaceAll("\\", "/")}:${stat.size}:${stat.mtimeMs}:${fileHash(file)}`); } } }; visit(root); return rows.sort(); }
function write(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value)}\n`, "utf8"); }
function fileHash(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
