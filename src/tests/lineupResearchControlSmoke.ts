import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {spawnSync} from "node:child_process";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "lineup-research-control-"));
try {
  const source = path.join(temporary, "league"), out = path.join(temporary, "research"); fs.mkdirSync(source); fs.writeFileSync(path.join(source, "dynasty-state.json"), "{}");
  const initialized = run("init", source, out); assert.equal(initialized.nextStage, "telemetry"); assert.equal(initialized.status, "ready");
  const telemetry = path.join(out, "telemetry"); fs.mkdirSync(telemetry); fs.writeFileSync(path.join(telemetry, "lineup-representation-study-samples.json.gz"), zlib.gzipSync(Buffer.from(JSON.stringify({schemaVersion: 1, firstSeason: 1, finalSeason: 3, rows: [{season: 1}, {season: 2}, {season: 3}]}))));
  const manifestFile = path.join(out, "research-manifest.json"), manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")); manifest.stages.telemetry = {status: "complete", startedAt: new Date().toISOString(), completedAt: new Date().toISOString()}; fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const afterTelemetry = run("status", source, out); assert.equal(afterTelemetry.nextStage, "incubator");
  const incubator = path.join(out, "incubator"); fs.mkdirSync(incubator); fs.writeFileSync(path.join(incubator, "summary.json"), JSON.stringify({activationStatus: "shadow-only", metrics: {novelPromoted: 0}, searchBudget: {evaluatedPrograms: 12, skippedPrograms: 50}}));
  fs.writeFileSync(path.join(incubator, "candidate-registry.json"), JSON.stringify({schemaVersion: 1, hypotheses: []}));
  fs.writeFileSync(path.join(incubator, "candidate-audit.json"), JSON.stringify({schemaVersion: 1, findings: []}));
  manifest.stages.incubator = {status: "complete", startedAt: new Date().toISOString(), completedAt: new Date().toISOString()}; fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const completed = run("report", source, out); assert.equal(completed.status, "research-complete-no-candidate"); assert.equal(completed.artifacts.evaluatedPrograms, 12); assert.ok(fs.existsSync(path.join(out, "summary.json")));
  fs.rmSync(path.join(incubator, "summary.json")); const blocked = run("status", source, out); assert.equal(blocked.status, "blocked"); assert.deepEqual(blocked.blocked, ["artifact-invalid:incubator"]);
  console.log("Lineup research control smoke passed: compact status, artifact validation, staged continuation, and blocking");
} finally { fs.rmSync(temporary, {recursive: true, force: true}); }

function run(command: string, source: string, out: string): any { const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(process.cwd(), "src", "cli", "lineupResearch.ts"), command, "--source", source, "--out", out], {cwd: process.cwd(), encoding: "utf8"}); assert.equal(result.status, 0, result.stderr || result.stdout); return JSON.parse(result.stdout); }
