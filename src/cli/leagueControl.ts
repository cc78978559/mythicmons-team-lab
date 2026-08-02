import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";

type CycleStatus = "running" | "pause-requested" | "paused" | "interrupted" | "failed" | "complete";
interface CycleManifest {
  schemaVersion: number;
  cycleId: string;
  status: CycleStatus;
  majorRoot: string;
  developmentOut: string;
  previousDevelopment?: string;
  boundary: {internalSeason: number; globalSeason: number; seed: string};
  promotionSlots: number;
  storage?: {minimumFreeGb: number; maximumDevelopmentOutputMb: number};
  configuration?: {globalSeasonOffset?: number; historyLedger?: string; developmentSeasons?: string; developmentRounds?: string; developmentMaxTurns?: string};
  stages: Record<string, {status: string; at?: string}>;
  activeStage?: string;
  updatedAt?: string;
  pausedAt?: string;
  failure?: {at: string; message: string};
}
interface LockInfo {schemaVersion?: number; pid?: number; startedAt?: string; workflow?: string}

const args = process.argv.slice(2), command = args[0] && !args[0].startsWith("--") ? args[0] : "status";
const root = process.cwd(), leagueRoot = path.resolve(option("--out", "output/official-era-03/league"));
const pauseFile = path.join(leagueRoot, ".official-season-cycle.pause.json");
const expectedStages = ["before-audit", "development", "promotion", "development-retention", "season", "after-audit", "history"];

switch (command) {
  case "status": printStatus(inspect(), args.includes("--json")); break;
  case "doctor": doctor(); break;
  case "pause": pause(); break;
  case "resume": resume(false); break;
  case "next": resume(true); break;
  case "report": report(); break;
  default: usage();
}

function inspect() {
  const statePath = path.join(leagueRoot, "dynasty-state.json"), state = readStateHeader(statePath);
  const manifests = cycleManifests(), unfinished = manifests.filter(row => row.manifest.status !== "complete");
  const selected = unfinished.sort((a, b) => b.modifiedMs - a.modifiedMs)[0] ?? manifests.sort((a, b) => b.modifiedMs - a.modifiedMs)[0];
  const manifest = selected?.manifest, workflowLock = readLock(path.join(leagueRoot, ".official-season-cycle.lock")), seasonLock = readLock(path.join(leagueRoot, ".run.lock"));
  const workflowAlive = lockAlive(workflowLock), seasonAlive = lockAlive(seasonLock), pauseRequested = fs.existsSync(pauseFile);
  const completedStages = manifest ? Object.keys(manifest.stages ?? {}) : [], nextStage = manifest && manifest.status !== "complete" ? expectedStages.find(stage => !completedStages.includes(stage) && (stage !== "history" || manifest.configuration?.historyLedger)) ?? null : null;
  let operationalStatus: CycleStatus | "idle" | "missing" = !state ? "missing" : !manifest || manifest.status === "complete" ? "idle" : manifest.status;
  if (manifest && manifest.status !== "complete") {
    if (pauseRequested) operationalStatus = workflowAlive ? "pause-requested" : "paused";
    else if (workflowAlive || seasonAlive) operationalStatus = "running";
    else if (manifest.status === "failed") operationalStatus = "failed";
    else operationalStatus = manifest.status === "paused" ? "paused" : "interrupted";
  }
  const audit = safeJson<any>(path.join(leagueRoot, "audit-summary.json")), auditCache = safeJson<any>(path.join(leagueRoot, ".audit-signature-cache.json")), auditRun = safeJson<any>(path.join(leagueRoot, "audit-run-state.json"));
  const cachedAudit = auditCacheStatus(auditCache, statePath), targetSeason = manifest ? manifest.boundary.internalSeason + 1 : state ? state.completedSeason + 1 : null;
  const targetDirectory = targetSeason === null ? null : path.join(leagueRoot, `season-${String(targetSeason).padStart(2, "0")}`);
  const issues: Array<{severity: "error" | "warning"; code: string; message: string}> = [];
  if (!state) issues.push({severity: "error", code: "state-missing", message: "dynasty-state.json is missing or its compact header cannot be read"});
  if (unfinished.length > 1) issues.push({severity: "error", code: "multiple-unfinished-cycles", message: `${unfinished.length} unfinished cycle manifests exist`});
  if (workflowLock && !workflowAlive) issues.push({severity: "warning", code: "stale-workflow-lock", message: `.official-season-cycle.lock belongs to inactive PID ${workflowLock.pid ?? "unknown"}`});
  if (seasonLock && !seasonAlive) issues.push({severity: "warning", code: "stale-season-lock", message: `.run.lock belongs to inactive PID ${seasonLock.pid ?? "unknown"}`});
  if (targetDirectory && fs.existsSync(targetDirectory) && state && targetSeason! > state.completedSeason && !manifest?.stages?.season) issues.push({severity: "error", code: "partial-season-directory", message: `${path.basename(targetDirectory)} exists before its season stage was committed`});
  if (!audit) issues.push({severity: "error", code: "audit-missing", message: "audit-summary.json is missing or unreadable"});
  else if (state && Number(audit.completedSeasons) !== state.completedSeason) issues.push({severity: "error", code: "audit-boundary-mismatch", message: `audit covers S${audit.completedSeasons}, state is S${state.completedSeason}`});
  if (audit && Number(audit.fatalCount) > 0) issues.push({severity: "error", code: "audit-fatal", message: `The current audit contains ${audit.fatalCount} fatal finding(s)`});
  if (audit && Number(audit.warningCount) > 0) issues.push({severity: "warning", code: "audit-warning", message: `The current audit contains ${audit.warningCount} warning(s)`});
  if (!cachedAudit) issues.push({severity: "error", code: "audit-signature-cache-missing", message: "The audit signature cache is missing or invalid"});
  else if (audit && (audit.inputSignature !== cachedAudit.signature || !cachedAudit.stateCurrent)) issues.push({severity: "error", code: "audit-signature-stale", message: "The clean audit summary does not match the current cached evidence boundary"});
  if (auditRun?.status === "failed") issues.push({severity: "error", code: "audit-last-run-failed", message: `The latest audit failed during ${auditRun.phase ?? "unknown"}`});
  if (auditRun?.status === "running" && Number(auditRun.pid) !== process.pid && !pidAlive(Number(auditRun.pid))) issues.push({severity: "error", code: "audit-run-interrupted", message: `Audit PID ${auditRun.pid ?? "unknown"} left an unfinished run at ${auditRun.phase ?? "unknown"}`});
  return {
    schemaVersion: 1, leagueRoot, state, operationalStatus, cycle: manifest ? {id: manifest.cycleId, manifestStatus: manifest.status, activeStage: manifest.activeStage ?? null, completedStages, totalStages: expectedStages.length - (manifest.configuration?.historyLedger ? 0 : 1), nextStage, boundarySeason: manifest.boundary.internalSeason, targetSeason, updatedAt: manifest.updatedAt ?? null, file: selected!.file} : null,
    process: {workflow: workflowLock ? {pid: workflowLock.pid ?? null, alive: workflowAlive, startedAt: workflowLock.startedAt ?? null} : null, season: seasonLock ? {pid: seasonLock.pid ?? null, alive: seasonAlive, startedAt: seasonLock.startedAt ?? null} : null},
    pauseRequested, audit: audit ? {completedSeasons: audit.completedSeasons, fatalCount: audit.fatalCount, warningCount: audit.warningCount, generatedAt: audit.generatedAt ?? null, signatureMatches: Boolean(cachedAudit && audit.inputSignature === cachedAudit.signature && cachedAudit.stateCurrent), runStatus: auditRun?.status ?? null, runPhase: auditRun?.phase ?? null} : null,
    storage: {stateBytes: state?.bytes ?? 0, freeGb: freeGb(leagueRoot)}, issues,
  };
}

function printStatus(status: ReturnType<typeof inspect>, json: boolean): void {
  if (json) { console.log(JSON.stringify(status, null, 2)); return; }
  const labels: Record<string, string> = {idle: "空闲", running: "运行中", "pause-requested": "等待安全暂停", paused: "已暂停", interrupted: "意外中断，可恢复", failed: "失败，等待检查", complete: "已完成", missing: "缺少联赛状态"};
  console.log(`正式联赛：${status.state ? `S${status.state.completedSeason} 已完成` : "状态不可用"}`);
  console.log(`运行状态：${labels[status.operationalStatus] ?? status.operationalStatus}`);
  if (status.cycle) {
    console.log(`当前周期：${status.cycle.id}（${status.cycle.completedStages.length}/${status.cycle.totalStages} 阶段）`);
    console.log(`下一阶段：${status.cycle.nextStage ?? "无"}`);
  }
  console.log(`进程：${status.process.workflow?.alive || status.process.season?.alive ? "活动" : "无"}`);
  console.log(`审计：${status.audit ? `S${status.audit.completedSeasons}，fatal ${status.audit.fatalCount} / warning ${status.audit.warningCount}，${status.audit.signatureMatches ? "签名有效" : "签名过期"}` : "无摘要"}`);
  console.log(`磁盘：剩余 ${status.storage.freeGb} GB；主状态 ${formatBytes(status.storage.stateBytes)}`);
  if (status.issues.length) for (const issue of status.issues) console.log(`${issue.severity === "error" ? "错误" : "注意"}：${issue.message}`);
}

function doctor(): void {
  const status = inspect(), errors = status.issues.filter(issue => issue.severity === "error"), warnings = status.issues.filter(issue => issue.severity === "warning");
  console.log(JSON.stringify({healthy: errors.length === 0, resumable: Boolean(status.state && status.cycle && !errors.length && !status.process.workflow?.alive && !status.process.season?.alive), operationalStatus: status.operationalStatus, completedSeason: status.state?.completedSeason ?? null, cycle: status.cycle, errors, warnings, freeGb: status.storage.freeGb}, null, 2));
  if (errors.length) process.exitCode = 2;
}

function pause(): void {
  if (!fs.existsSync(leagueRoot)) throw new Error(`League root does not exist: ${leagueRoot}`);
  const status = inspect();
  if (!status.cycle || status.cycle.manifestStatus === "complete") throw new Error("There is no unfinished official season cycle to pause");
  atomicJson(pauseFile, {schemaVersion: 1, requestedAt: new Date().toISOString(), requestedByPid: process.pid, cycleId: status.cycle.id});
  if (!status.process.workflow?.alive && !status.process.season?.alive) {
    const manifest = read<CycleManifest>(status.cycle.file); manifest.status = "paused"; manifest.activeStage = undefined; manifest.pausedAt = new Date().toISOString(); manifest.updatedAt = manifest.pausedAt; atomicJson(status.cycle.file, manifest);
  }
  const after = inspect();
  writeStatusSnapshot(after);
  console.log(JSON.stringify({status: after.operationalStatus, cycleId: after.cycle?.id, completedSeason: after.state?.completedSeason, nextStage: after.cycle?.nextStage, message: after.process.workflow?.alive || after.process.season?.alive ? "Pause requested; the current atomic stage will finish first." : "Cycle paused at a resumable boundary."}, null, 2));
}

function resume(startNext: boolean): void {
  const status = inspect();
  if (!status.state) throw new Error(`Cannot operate league without dynasty state: ${leagueRoot}`);
  if (status.process.workflow?.alive || status.process.season?.alive) throw new Error("The official league is already running");
  const blockers = status.issues.filter(issue => issue.severity === "error");
  if (blockers.length) throw new Error(`League is not resumable: ${blockers.map(issue => issue.code).join(", ")}`);
  let commandArgs: string[];
  if (startNext) {
    if (status.cycle && status.cycle.manifestStatus !== "complete") throw new Error(`Cycle ${status.cycle.id} is unfinished; resume it instead of starting another cycle`);
    const nextSeason = status.state.completedSeason + 1, developmentOut = path.resolve(option("--development-out", path.join(path.dirname(leagueRoot), `development-season-${nextSeason}`)));
    commandArgs = ["--major-source", leagueRoot, "--development-out", developmentOut, "--promotion-slots", option("--promotion-slots", "3"), "--cycle-id", option("--cycle-id", `after-s${status.state.completedSeason}`)];
    const previous = latestDevelopment(status);
    if (previous) commandArgs.push("--previous-development", previous);
    const history = path.resolve(option("--history-ledger", path.join(path.dirname(leagueRoot), "official-history-ledger.json")));
    if (fs.existsSync(history)) commandArgs.push("--history-ledger", history);
  } else {
    if (!status.cycle || status.cycle.manifestStatus === "complete") throw new Error("There is no unfinished cycle to resume");
    const manifest = read<CycleManifest>(status.cycle.file);
    commandArgs = manifestArgs(manifest);
  }
  if (args.includes("--allow-code-upgrade")) commandArgs.push("--allow-code-upgrade");
  if (!args.includes("--dry-run")) clearStaleLocks();
  if (fs.existsSync(pauseFile) && !args.includes("--dry-run")) fs.rmSync(pauseFile, {force: true});
  if (args.includes("--dry-run")) { console.log(JSON.stringify({command: "official-season-cycle", args: commandArgs}, null, 2)); return; }
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src/cli/runOfficialSeasonCycle.ts"), ...commandArgs], {cwd: root, stdio: "inherit"});
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

function report(): void {
  const status = inspect(), target = path.resolve(option("--output", path.join(leagueRoot, "league-control-report.md")));
  const lines = ["# Official League Status", "", `- Generated: ${new Date().toISOString()}`, `- Completed season: ${status.state?.completedSeason ?? "unavailable"}`, `- Operational status: ${status.operationalStatus}`, `- Cycle: ${status.cycle?.id ?? "none"}`, `- Stage progress: ${status.cycle ? `${status.cycle.completedStages.length}/${status.cycle.totalStages}` : "n/a"}`, `- Next stage: ${status.cycle?.nextStage ?? "none"}`, `- Active process: ${status.process.workflow?.alive || status.process.season?.alive ? "yes" : "no"}`, `- Audit: ${status.audit ? `S${status.audit.completedSeasons}, ${status.audit.fatalCount} fatal, ${status.audit.warningCount} warnings` : "unavailable"}`, `- Free disk: ${status.storage.freeGb} GB`, "", "## Issues", "", ...(status.issues.length ? status.issues.map(issue => `- ${issue.severity}: ${issue.code} - ${issue.message}`) : ["- None"]), ""];
  fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, lines.join("\n"), "utf8");
  console.log(JSON.stringify({report: target, status: status.operationalStatus, issues: status.issues.length}, null, 2));
}

function manifestArgs(manifest: CycleManifest): string[] {
  const configuration = manifest.configuration ?? {}, storage = manifest.storage;
  const values = ["--major-source", manifest.majorRoot, "--development-out", manifest.developmentOut, "--promotion-slots", String(manifest.promotionSlots), "--cycle-id", manifest.cycleId, "--global-season-offset", String(configuration.globalSeasonOffset ?? 0)];
  if (manifest.previousDevelopment) values.push("--previous-development", manifest.previousDevelopment);
  if (configuration.historyLedger) values.push("--history-ledger", configuration.historyLedger);
  if (configuration.developmentSeasons) values.push("--development-seasons", configuration.developmentSeasons);
  if (configuration.developmentRounds) values.push("--development-rounds", configuration.developmentRounds);
  if (configuration.developmentMaxTurns) values.push("--development-max-turns", configuration.developmentMaxTurns);
  if (storage) values.push("--min-free-gb", String(storage.minimumFreeGb), "--max-development-output-mb", String(storage.maximumDevelopmentOutputMb));
  return values;
}
function latestDevelopment(status: ReturnType<typeof inspect>): string | undefined { const manifest = status.cycle?.file ? read<CycleManifest>(status.cycle.file) : undefined; return manifest?.developmentOut && fs.existsSync(manifest.developmentOut) ? manifest.developmentOut : undefined; }
function cycleManifests(): Array<{file: string; modifiedMs: number; manifest: CycleManifest}> { const directory = path.join(leagueRoot, "season-cycles"); if (!fs.existsSync(directory)) return []; return fs.readdirSync(directory).filter(file => file.endsWith(".json")).flatMap(file => { const target = path.join(directory, file); const manifest = safeJson<CycleManifest>(target); return manifest ? [{file: target, modifiedMs: fs.statSync(target).mtimeMs, manifest}] : []; }); }
function readStateHeader(file: string): {version: number; seed: string; completedSeason: number; bytes: number; modifiedAt: string} | null { if (!fs.existsSync(file)) return null; const descriptor = fs.openSync(file, "r"); try { const buffer = Buffer.alloc(65536), bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0), text = buffer.subarray(0, bytesRead).toString("utf8"); const version = fieldNumber(text, "version"), completedSeason = fieldNumber(text, "completedSeason"), seed = fieldString(text, "seed"); if (version === null || completedSeason === null || seed === null) return null; const stat = fs.statSync(file); return {version, seed, completedSeason, bytes: stat.size, modifiedAt: stat.mtime.toISOString()}; } finally { fs.closeSync(descriptor); } }
function fieldNumber(text: string, name: string): number | null { const match = text.match(new RegExp(`"${name}"\\s*:\\s*(\\d+)`)); return match ? Number(match[1]) : null; }
function fieldString(text: string, name: string): string | null { const match = text.match(new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`)); return match?.[1] ?? null; }
function readLock(file: string): LockInfo | null { return safeJson<LockInfo>(file); }
function lockAlive(lock: LockInfo | null): boolean { if (!lock?.pid || !Number.isInteger(lock.pid)) return false; try { process.kill(lock.pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; } }
function pidAlive(pid: number): boolean { if (!Number.isInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; } }
function auditCacheStatus(cache: any, stateFile: string): {signature: string; stateCurrent: boolean} | null {
  if (cache?.schemaVersion !== 1 || !cache.files || typeof cache.files !== "object") return null;
  const hash = crypto.createHash("sha256"), names = Object.keys(cache.files).sort();
  for (const name of names) { const entry = cache.files[name]; if (!entry || !/^[a-f0-9]{64}$/.test(String(entry.sha256))) return null; hash.update(`${name}\0${entry.sha256}\0`); }
  const stateEntry = cache.files["dynasty-state.json"], stat = fs.existsSync(stateFile) ? fs.statSync(stateFile) : null;
  return {signature: hash.digest("hex"), stateCurrent: Boolean(stat && stateEntry?.size === stat.size && stateEntry?.mtimeMs === stat.mtimeMs)};
}
function clearStaleLocks(): void { for (const name of [".official-season-cycle.lock", ".run.lock"]) { const file = path.join(leagueRoot, name), lock = readLock(file); if (lock && !lockAlive(lock)) fs.rmSync(file, {force: true}); } }
function writeStatusSnapshot(status: ReturnType<typeof inspect>): void { atomicJson(path.join(leagueRoot, "league-status.json"), {schemaVersion: 1, updatedAt: new Date().toISOString(), completedSeason: status.state?.completedSeason ?? null, operationalStatus: status.operationalStatus, cycleId: status.cycle?.id ?? null, activeStage: status.cycle?.activeStage ?? null, completedStages: status.cycle?.completedStages ?? [], nextStage: status.cycle?.nextStage ?? null, issues: status.issues}); }
function freeGb(directory: string): number { let current = directory; while (!fs.existsSync(current)) { const parent = path.dirname(current); if (parent === current) return 0; current = parent; } const stat = fs.statfsSync(current); return Math.round(Number(stat.bavail) * Number(stat.bsize) / 10737418.24) / 100; }
function formatBytes(bytes: number): string { return bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GB` : `${(bytes / 1048576).toFixed(1)} MB`; }
function safeJson<T>(file: string): T | null { try { return read<T>(file); } catch { return null; } }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function atomicJson(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function usage(): never { console.error("Usage: npm run league -- <status|doctor|pause|resume|next|report> [--out DIR] [--json] [--dry-run]"); process.exit(2); }
