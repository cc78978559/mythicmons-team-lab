import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const started = Date.now(), rssBefore = process.memoryUsage().rss;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tooling-doctor-status-contract-")), cli = path.resolve("src/cli/toolingDoctor.ts");
try {
  const missing = scenario("missing"), missingRun = invokeReadOnly(missing, ["status", ...paths(missing)]);
  assert.equal(missingRun.status, 2); assert.equal(missingRun.stderr, ""); assertStatusContract(missingRun.value); assert.equal(missingRun.value.available, false); assert.equal(missingRun.value.healthy, false); assert.equal(missingRun.value.evidenceVault, null); assert.equal(fs.existsSync(missing.root), false); assert.equal(fs.existsSync(missing.out), false); assert.equal(fs.existsSync(missing.pipeline), false);

  const available = scenario("available"), generatedAt = new Date(0).toISOString();
  write(path.join(available.out, "summary.json"), {healthy: true, generatedAt, storage: {files: 2, bytes: 10}, sourceCaches: {entries: 1, remainingBytes: 0, budgetBytes: 100}, formal: {evidenceEpochReady: true}, aiPipeline: {canaryActivationReady: false}, evidenceVault: {available: false}, issues: []});
  write(path.join(available.pipeline, "status.json"), {evaluation: {operationalHealthy: true, pipelineCycleComplete: true, researchMaturity: "fixture", formalActivationReady: false, nextMilestones: ["none"]}});
  const availableRun = invokeReadOnly(available, ["status", ...paths(available)]);
  assert.equal(availableRun.status, 0); assert.equal(availableRun.stderr, ""); assertStatusContract(availableRun.value); assert.equal(availableRun.value.available, true); assert.equal(availableRun.value.healthy, true); assert.equal(availableRun.value.generatedAt, generatedAt); assert.deepEqual(availableRun.value.evidenceVault, {available: false}); assert.equal(availableRun.value.pipeline.researchMaturity, "fixture");

  const invalid = scenario("invalid"), invalidRun = invokeReadOnly(invalid, ["unknown", ...paths(invalid)]);
  assert.notEqual(invalidRun.status, 0); assert.match(invalidRun.stderr, /Usage: npm run tooling/); assert.equal(invalidRun.stdout, ""); assert.equal(fs.existsSync(invalid.root), false); assert.equal(fs.existsSync(invalid.out), false); assert.equal(fs.existsSync(invalid.pipeline), false);

  console.log(`Tooling doctor status contract smoke passed: missing/static/invalid exits and zero-write fast path (${Date.now() - started}ms, RSS delta ${process.memoryUsage().rss - rssBefore} bytes)`);
} finally { fs.rmSync(temporary, {recursive: true, force: true}); }

function scenario(name: string) { const parent = path.join(temporary, name); fs.mkdirSync(parent); return {parent, root: path.join(parent, "root"), out: path.join(parent, "out"), pipeline: path.join(parent, "pipeline")}; }
function paths(value: ReturnType<typeof scenario>): string[] { return ["--root", value.root, "--out", value.out, "--ai-pipeline", value.pipeline]; }
function invokeReadOnly(value: ReturnType<typeof scenario>, args: string[]): {status: number | null; stdout: string; stderr: string; value: any} {
  const before = snapshot(value.parent), result = spawnSync(process.execPath, [require.resolve("tsx/cli"), cli, ...args], {cwd: process.cwd(), encoding: "utf8", maxBuffer: 8 * 1024 * 1024}); assert.equal(result.signal, null, result.stderr); assert.deepEqual(snapshot(value.parent), before, `status mutated ${value.parent}`);
  let parsed: any = null; if (result.stdout) assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, result.stdout); return {status: result.status, stdout: result.stdout, stderr: result.stderr, value: parsed};
}
function assertStatusContract(value: any): void { assert.equal(value.schemaVersion, 1); assert.equal(typeof value.available, "boolean"); assert.equal(typeof value.healthy, "boolean"); assert.ok(Array.isArray(value.issues)); }
function snapshot(root: string): string[] { const rows: string[] = []; const visit = (directory: string) => { for (const entry of fs.readdirSync(directory, {withFileTypes: true})) { const file = path.join(directory, entry.name); if (entry.isDirectory()) visit(file); else { const stat = fs.statSync(file); rows.push(`${path.relative(root, file).replaceAll("\\", "/")}:${stat.size}:${stat.mtimeMs}:${fileHash(file)}`); } } }; visit(root); return rows.sort(); }
function write(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value)}\n`, "utf8"); }
function fileHash(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
