import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import crypto from "node:crypto";

const root = process.cwd(), workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-league-control-")), league = path.join(workspace, "league");
try {
  fs.mkdirSync(path.join(league, "season-cycles"), {recursive: true});
  const stateFile = path.join(league, "dynasty-state.json"); fs.writeFileSync(stateFile, `${JSON.stringify({version: 12, seed: "control-smoke", completedSeason: 4, payload: "x".repeat(100000)})}\n`);
  const stat = fs.statSync(stateFile), stateHash = crypto.createHash("sha256").update(fs.readFileSync(stateFile)).digest("hex"), signature = crypto.createHash("sha256").update(`dynasty-state.json\0${stateHash}\0`).digest("hex");
  fs.writeFileSync(path.join(league, ".audit-signature-cache.json"), `${JSON.stringify({schemaVersion: 1, seasons: 4, files: {"dynasty-state.json": {size: stat.size, mtimeMs: stat.mtimeMs, sha256: stateHash}}})}\n`);
  fs.writeFileSync(path.join(league, "audit-summary.json"), `${JSON.stringify({completedSeasons: 4, fatalCount: 0, warningCount: 0, inputSignature: signature})}\n`);
  fs.writeFileSync(path.join(league, "audit-run-state.json"), `${JSON.stringify({schemaVersion: 1, status: "complete", phase: "complete"})}\n`);
  const development = path.join(workspace, "development-season-05"), history = path.join(workspace, "official-history.json"), manifestPath = path.join(league, "season-cycles", "after-s4.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify({schemaVersion: 1, cycleId: "after-s4", status: "running", majorRoot: league, developmentOut: development, boundary: {internalSeason: 4, globalSeason: 4, seed: "control-smoke"}, promotionSlots: 3, storage: {minimumFreeGb: 1, maximumDevelopmentOutputMb: 512}, configuration: {globalSeasonOffset: 0, historyLedger: history, developmentSeasons: "1", developmentRounds: "1", developmentMaxTurns: "40"}, stages: {"before-audit": {status: "complete"}, development: {status: "complete"}}}, null, 2)}\n`);
  const status = JSON.parse(run(["status", "--out", league, "--json"]).stdout);
  assert.equal(status.state.completedSeason, 4); assert.equal(status.state.bytes > 100000, true); assert.equal(status.operationalStatus, "interrupted"); assert.equal(status.cycle.nextStage, "promotion");
  const doctor = JSON.parse(run(["doctor", "--out", league]).stdout);
  assert.equal(doctor.healthy, true); assert.equal(doctor.resumable, true);
  const cleanAudit = read<any>(path.join(league, "audit-summary.json")); fs.writeFileSync(path.join(league, "audit-summary.json"), `${JSON.stringify({...cleanAudit, fatalCount: 1})}\n`);
  const fatalDoctor = execute(["doctor", "--out", league]); assert.equal(fatalDoctor.status, 2); assert.match(fatalDoctor.stdout, /audit-fatal/);
  fs.writeFileSync(path.join(league, "audit-summary.json"), `${JSON.stringify(cleanAudit)}\n`);
  const paused = JSON.parse(run(["pause", "--out", league]).stdout), pausedManifest = read<any>(manifestPath);
  assert.equal(paused.status, "paused"); assert.equal(pausedManifest.status, "paused"); assert.equal(fs.existsSync(path.join(league, ".official-season-cycle.pause.json")), true);
  assert.equal(read<any>(path.join(league, "league-status.json")).operationalStatus, "paused");
  const resume = JSON.parse(run(["resume", "--out", league, "--dry-run", "--allow-code-upgrade"]).stdout);
  assert.equal(resume.command, "official-season-cycle"); assert.ok(resume.args.includes("after-s4")); assert.ok(resume.args.includes(history)); assert.ok(resume.args.includes("--allow-code-upgrade"));
  run(["report", "--out", league]);
  assert.match(fs.readFileSync(path.join(league, "league-control-report.md"), "utf8"), /Operational status: paused/);
  fs.writeFileSync(path.join(league, ".official-season-cycle.lock"), `${JSON.stringify({schemaVersion: 1, pid: 2147483647})}\n`);
  const stale = JSON.parse(run(["status", "--out", league, "--json"]).stdout);
  assert.ok(stale.issues.some((issue: any) => issue.code === "stale-workflow-lock"));
  fs.appendFileSync(stateFile, " ");
  const staleAudit = JSON.parse(run(["status", "--out", league, "--json"]).stdout); assert.equal(staleAudit.audit.signatureMatches, false); assert.ok(staleAudit.issues.some((issue: any) => issue.code === "audit-signature-stale"));
  const blockedDoctor = execute(["doctor", "--out", league]); assert.equal(blockedDoctor.status, 2); assert.match(blockedDoctor.stdout, /audit-signature-stale/);
  const blockedResume = execute(["resume", "--out", league, "--dry-run"]); assert.notEqual(blockedResume.status, 0); assert.match(blockedResume.stderr, /audit-signature-stale/);
  console.log("League control smoke passed: compact status, diagnosis, pause, resumable command reconstruction, and report");
} finally { fs.rmSync(workspace, {recursive: true, force: true}); }

function execute(args: string[]) { return spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src/cli/leagueControl.ts"), ...args], {cwd: root, encoding: "utf8"}); }
function run(args: string[]): {stdout: string; stderr: string} { const result = execute(args); assert.equal(result.status, 0, result.stderr || result.stdout); return {stdout: result.stdout, stderr: result.stderr}; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
