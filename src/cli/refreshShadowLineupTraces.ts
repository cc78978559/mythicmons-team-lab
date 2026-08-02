import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {spawnSync} from "node:child_process";
import {buildShadowExperimentPlan, compactShadowExperimentQueue} from "../ai/whiteBox/shadowExperimentPlanner";
import {acquireNamedRunLock} from "../draft/runLock";
import {materializeHistoricalReplayCheckpoint, planHistoricalReplaySegments} from "../draft/historicalRuntimeCheckpoint";

const args = process.argv.slice(2);
const REFRESH_SCHEMA_VERSION = 2;
const source = path.resolve(option("--source", "output/official-era-03/league"));
const diagnostics = path.resolve(option("--diagnostics", "output/tooling/shadow-diagnostics"));
const out = path.resolve(option("--out", "output/tooling/shadow-lineup-refresh"));
const limit = integerOption("--limit", 12, 1, 100), maximumSeason = integerOption("--maximum-season", 21, 1, 999), requestedSeason = integerOption("--target-season", 0, 0, 999), force = args.includes("--force");
const queueFile = path.resolve(option("--queue", path.join(diagnostics, "shadow-experiment-queue.json")));
const sourceStateFile = path.join(source, "dynasty-state.json"), summaryFile = path.join(out, "refresh-summary.json");
const sourceState = read<any>(sourceStateFile), queue = read<any>(queueFile);
if (args.includes("--reindex")) {
  const archive = path.join(out, "refreshed-lineup-traces.json.gz"), refreshedQueue = path.join(out, "refreshed-experiment-queue.json");
  const payload = JSON.parse(zlib.gunzipSync(fs.readFileSync(archive)).toString("utf8")), plan = buildShadowExperimentPlan(payload.rows ?? []);
  write(refreshedQueue, compactShadowExperimentQueue(plan, limit));
  const previous = read<any>(summaryFile), updated = {...previous, schemaVersion: REFRESH_SCHEMA_VERSION, completeTraces: plan.completeTraces, boundedFlips: plan.boundedFlips, replayReady: plan.replayReady, queue: refreshedQueue};
  write(summaryFile, updated); print(updated, true); process.exit(0);
}
const eligibleSeasons = [...new Set<number>((queue.cases ?? []).filter((entry: any) => entry.domain === "lineup" && !entry.traceComplete && entry.boundedScenario && Number(entry.season) <= maximumSeason).map((entry: any) => Number(entry.season)))].sort((a, b) => a - b);
const replaySeason = requestedSeason || eligibleSeasons[0];
if (!replaySeason) throw new Error("No bounded incomplete lineup cases are available for trace refresh");
const targets = selectTargets(queue.cases ?? [], limit, replaySeason);
if (!targets.length) throw new Error("No bounded incomplete lineup cases are available for trace refresh");
const signature = digest({toolVersion: REFRESH_SCHEMA_VERSION, source: fileSignature(sourceStateFile), queue: fileSignature(queueFile), replaySeason, targets: targets.map(entry => entry.decisionId)});
if (!force && fs.existsSync(summaryFile)) {
  const cached = read<any>(summaryFile);
  if (cached.inputSignature === signature) { print(cached, true); process.exit(0); }
}
fs.mkdirSync(out, {recursive: true});
if (force) reclaimStaleLock(path.join(out, ".shadow-lineup-refresh.lock"));
const lock = acquireNamedRunLock(out, ".shadow-lineup-refresh.lock", {workflow: "shadow-lineup-refresh", source});
process.once("exit", () => lock.release());
const work = path.join(out, ".replay-work");
if (fs.existsSync(work)) {
  if (!force) throw new Error(`Replay work directory exists: ${work}; inspect it or rerun with --force`);
  assertSafeWork(work); fs.rmSync(work, {recursive: true, force: true});
}
const sourceHash = fileHash(sourceStateFile), started = Date.now();
runReplay(work, targets.map(entry => entry.decisionId));
verifyReplay(work);
if (fileHash(sourceStateFile) !== sourceHash) throw new Error("Trace refresh mutated the source dynasty");
const rows = extractTargets(work, new Set(targets.map(entry => entry.decisionId)));
const plan = buildShadowExperimentPlan(rows), compact = compactShadowExperimentQueue(plan, limit);
const archive = path.join(out, "refreshed-lineup-traces.json.gz"), refreshedQueue = path.join(out, "refreshed-experiment-queue.json");
fs.writeFileSync(archive, zlib.gzipSync(Buffer.from(`${JSON.stringify({schemaVersion: 1, source, inputSignature: signature, rows})}\n`), {level: 9}));
write(refreshedQueue, compact);
const summary = {
  schemaVersion: REFRESH_SCHEMA_VERSION, inputSignature: signature, source, replaySeason,
  requested: targets.length, recovered: rows.length, completeTraces: plan.completeTraces,
  boundedFlips: plan.boundedFlips, replayReady: plan.replayReady, durationMs: Date.now() - started,
  temporaryReplayRemoved: true, archive, queue: refreshedQueue,
};
assertSafeWork(work); fs.rmSync(work, {recursive: true, force: true});
write(summaryFile, summary); print(summary, false);

function selectTargets(cases: any[], maximum: number, targetSeason: number): any[] {
  const selected: any[] = [], managerSeason = new Map<string, number>();
  for (const entry of cases) {
    if (selected.length >= maximum) break;
    if (entry.domain !== "lineup" || entry.traceComplete || !entry.boundedScenario || Number(entry.season) !== targetSeason) continue;
    const key = `${entry.actor}@${entry.season}`, count = managerSeason.get(key) ?? 0;
    if (count >= 2) continue;
    selected.push(entry); managerSeason.set(key, count + 1);
  }
  return selected;
}
function runReplay(directory: string, decisionIds: string[]): void {
  const settings = sourceState.settings, replay = materializeHistoricalReplayCheckpoint(source, replaySeason, directory);
  const segments = planHistoricalReplaySegments(source, replaySeason, replaySeason);
  for (const segment of segments) {
    const env = {
      ...process.env, NODE_PATH: segment.nodePath, V12_OUT: directory, V12_SEED: sourceState.seed, V12_SEASONS: String(segment.lastSeason), V12_RESUME: "true",
      V12_ALLOW_CODE_UPGRADE: "true", V12_MANAGER_LIMIT: String(settings.managerLimit), V12_PAIRS: String(settings.pairs),
      V12_POOL_SIZE: String(settings.poolSize), V12_AUCTION_LOTS: String(settings.auctionLots), V12_REGULAR_ROUNDS: String(settings.regularRounds),
      V12_MAX_TURNS: String(settings.maxTurns), V12_MIN_ROSTER: String(settings.minRoster ?? 6), V12_MAX_ROSTER: String(settings.maxRoster ?? 10),
      V12_BASE_CASH: String(settings.baseBudget ?? 40), V12_AUCTION_MODE: String(settings.auctionMode ?? "sequential"),
      V12_REGISTRY_SOURCE: replay.registrySource, V12_REGISTRY_REVISION: sourceState.registry?.revision ?? "shadow-lineup-refresh",
      V12_EVIDENCE_RETENTION: "compact", V4_WHITEBOX_FULL_LINEUP_TRACE: "true",
      V4_WHITEBOX_FULL_LINEUP_TARGETS: decisionIds.join(","),
    };
    const script = path.join(segment.runtimeWorkspace, "src", "cli", "draftLeagueV12.ts");
    const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), script], {cwd: segment.runtimeWorkspace, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
    if (result.status !== 0) throw new Error(`Historical trace refresh failed for seasons ${segment.firstSeason}-${segment.lastSeason}:\n${result.stderr || result.stdout}`);
  }
}
function verifyReplay(actualRoot: string): void {
  const name = `season-${String(replaySeason).padStart(2, "0")}`;
  const expected = essential(read<any>(path.join(source, name, "season.json"))), actual = essential(read<any>(path.join(actualRoot, name, "season.json")));
  if (digest(expected) !== digest(actual)) throw new Error(`Trace refresh changed competitive result in ${name}`);
}
function extractTargets(directory: string, targets: Set<string>): Array<{domain: string; season: number; actor: string; recordId: string; trace: any}> {
  const rows: Array<{domain: string; season: number; actor: string; recordId: string; trace: any}> = [];
  const file = path.join(directory, `season-${String(replaySeason).padStart(2, "0")}`, "decision-ledger.json");
  for (const record of read<any>(file).records ?? []) {
    const trace = record.context?.whiteBoxShadow;
    if (record.stage !== "lineup" || !trace || !targets.has(String(trace.decisionId))) continue;
    if (Number(trace.candidateCount ?? 0) !== Number(trace.candidates?.length ?? -1)) throw new Error(`Target trace remained incomplete: ${trace.decisionId}`);
    rows.push({domain: "lineup", season: replaySeason, actor: String(record.actor), recordId: String(record.id), trace});
  }
  const found = new Set(rows.map(row => row.trace.decisionId)), missing = [...targets].filter(target => !found.has(target));
  if (missing.length) throw new Error(`Target traces were not reproduced: ${missing.join(", ")}`);
  return rows;
}
function essential(value: any): any { return {season: value.season, champion: value.champion, standings: value.standings, transactions: value.transactions, validity: value.validity}; }
function assertSafeWork(directory: string): void { const resolved = path.resolve(directory); if (resolved !== path.join(out, ".replay-work") || !resolved.startsWith(`${out}${path.sep}`)) throw new Error(`Unsafe replay work directory: ${resolved}`); }
function reclaimStaleLock(file: string): void {
  if (!fs.existsSync(file)) return;
  const owner = read<any>(file), pid = Number(owner.pid);
  if (Number.isInteger(pid) && pid > 0) {
    try { process.kill(pid, 0); throw new Error(`Cannot reclaim active refresh lock owned by PID ${pid}`); }
    catch (error) {
      if (error instanceof Error && error.message.startsWith("Cannot reclaim active")) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ESRCH") throw new Error(`Cannot verify refresh lock owner PID ${pid}: ${code ?? String(error)}`);
    }
  }
  fs.rmSync(file, {force: true});
}
function print(value: any, cached: boolean): void { console.log(JSON.stringify({status: cached ? "cached" : "complete", replaySeason: value.replaySeason, requested: value.requested, recovered: value.recovered, completeTraces: value.completeTraces, boundedFlips: value.boundedFlips, replayReady: value.replayReady, durationMs: value.durationMs, temporaryReplayRemoved: value.temporaryReplayRemoved, queue: value.queue}, null, 2)); }
function fileSignature(file: string): any { const stat = fs.statSync(file); return {file: path.resolve(file), size: stat.size, mtimeMs: Math.round(stat.mtimeMs)}; }
function fileHash(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function digest(value: unknown): string { return crypto.createHash("sha256").update(stable(value)).digest("hex"); }
function stable(value: any): string { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function write(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temporary, file); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integerOption(name: string, fallback: number, min: number, max: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
