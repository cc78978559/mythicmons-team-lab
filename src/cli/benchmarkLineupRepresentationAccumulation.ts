import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {spawnSync} from "node:child_process";
import {auditLineupRepresentation, type LineupRepresentationObservation} from "../ai/whiteBox/lineupRepresentationAudit";
import {materializeHistoricalDynastyBoundary} from "../draft/historicalRuntimeCheckpoint";
import {acquireNamedRunLock} from "../draft/runLock";

const args = process.argv.slice(2);
const root = process.cwd();
const source = path.resolve(option("--source", "output/official-era-03/league"));
const out = path.resolve(option("--out", "output/tooling/shadow-lineup-representation-efficiency"));
const sourceStateFile = path.join(source, "dynasty-state.json");
const sourceState = read<any>(sourceStateFile);
const trialSeasons = integerOption("--seasons", 1, 1, 9);
const firstSeason = Number(sourceState.completedSeason) + 1;
const finalSeason = Number(sourceState.completedSeason) + trialSeasons;
const work = path.join(out, ".trial-work");
const sourceHash = fileHash(sourceStateFile);
const recoverCompletedWork = args.includes("--recover-completed-work");
const recoveredDurationMs = recoverCompletedWork ? integerOption("--recovered-duration-ms", 0, 1, 86_400_000) : 0;
fs.mkdirSync(out, {recursive: true});
if (recoverCompletedWork) clearStaleRecoveryLock(path.join(out, ".lineup-representation-efficiency.lock"));
const lock = acquireNamedRunLock(out, ".lineup-representation-efficiency.lock", {workflow: "lineup-representation-efficiency", source, firstSeason, finalSeason});
let completed = false;
try {
  if (fs.existsSync(work)) {
    assertSafeWork(work);
    if (!recoverCompletedWork) fs.rmSync(work, {recursive: true, force: true});
  }
  let durationMs = recoveredDurationMs;
  if (recoverCompletedWork) validateCompletedTrial(work, firstSeason, finalSeason);
  else {
    const boundary = materializeHistoricalDynastyBoundary(source, sourceState.completedSeason, work);
    const started = Date.now(), settings = sourceState.settings;
    const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV12.ts")], {
      cwd: root,
      env: {
        ...process.env,
        V12_OUT: work,
        V12_SEED: sourceState.seed,
        V12_SEASONS: String(finalSeason),
        V12_RESUME: "true",
        V12_ALLOW_CODE_UPGRADE: "true",
        V12_MANAGER_LIMIT: String(settings.managerLimit),
        V12_PAIRS: String(settings.pairs),
        V12_POOL_SIZE: String(settings.poolSize),
        V12_AUCTION_LOTS: String(settings.auctionLots),
        V12_REGULAR_ROUNDS: String(settings.regularRounds),
        V12_MAX_TURNS: String(settings.maxTurns),
        V12_MIN_ROSTER: String(settings.minRoster ?? 6),
        V12_MAX_ROSTER: String(settings.maxRoster ?? 10),
        V12_BASE_CASH: String(settings.baseBudget ?? 40),
        V12_AUCTION_MODE: String(settings.auctionMode ?? "sequential"),
        V12_REGISTRY_SOURCE: boundary.registrySource,
        V12_REGISTRY_REVISION: sourceState.registry?.revision ?? "lineup-representation-efficiency",
        V12_STRATEGY_PROGRAM_OPERATOR: String(settings.strategyProgramOperator ?? "observed-boundary-v1"),
        V12_EVOLUTION_MODE: String(settings.evolutionMode ?? "punctuated"),
        V12_EVOLUTION_POLICY: String(settings.evolutionPolicy ?? "shadow"),
        V12_EVOLUTION_MAX_BURSTS: String(settings.evolutionMaxBursts ?? 2),
        V12_EVOLUTION_MIN_CANDIDATES: String(settings.evolutionMinCandidates ?? 4),
        V12_EVOLUTION_MAX_CANDIDATES: String(settings.evolutionMaxCandidates ?? 8),
        V12_TACTICAL_MEMORY_CONFIDENCE_FLOOR: String(settings.tacticalMemoryConfidenceFloor ?? .15),
        V12_EVIDENCE_RETENTION: "compact",
        V12_EVIDENCE_SAMPLE_RATE: "0",
      },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(`Representation accumulation trial failed:\n${result.stderr || result.stdout}`);
    durationMs = Date.now() - started;
  }
  if (fileHash(sourceStateFile) !== sourceHash) throw new Error("Representation accumulation trial mutated the source dynasty");
  const observations: LineupRepresentationObservation[] = [], studyRows: any[] = [];
  let diagnosticBytes = 0, decisionLedgerBytes = 0, seasonOutputBytes = 0;
  for (let season = firstSeason; season <= finalSeason; season++) {
    const seasonRoot = path.join(work, `season-${String(season).padStart(2, "0")}`);
    const ledgerFile = path.join(seasonRoot, "decision-ledger.json");
    const ledger = read<any>(ledgerFile), seasonSummary = read<any>(path.join(seasonRoot, "season.json"));
    const series = new Map(allSeries(seasonSummary).map(entry => [String(entry.id), entry]));
    decisionLedgerBytes += fs.statSync(ledgerFile).size;
    seasonOutputBytes += directoryBytes(seasonRoot);
    for (const record of ledger.records ?? []) {
      const trace = record.context?.whiteBoxShadow;
      if (record.stage !== "lineup" || !trace) continue;
      const managerId = String(record.actor ?? ""), seriesId = String(record.context?.seriesId ?? "");
      observations.push({season, managerId, trace});
      studyRows.push({
        season,
        managerId,
        seriesId,
        outcome: seriesOutcome(series.get(canonicalSeriesId(seriesId)), managerId),
        comparison: trace.comparison,
        candidates: (trace.candidates ?? []).map((candidate: any) => ({id: candidate.id, diagnostics: candidate.diagnostics})),
      });
      for (const candidate of trace.candidates ?? []) diagnosticBytes += Buffer.byteLength(JSON.stringify(candidate.diagnostics ?? {}));
    }
  }
  const audit = auditLineupRepresentation(observations);
  const minutes = durationMs / 60000;
  const tracesPerSeason = audit.metrics.tracesWithDiagnostics / trialSeasons;
  const contrastsPerSeason = audit.metrics.variableContrasts / trialSeasons;
  const seasonsToReadiness = Math.max(
    Math.ceil(audit.thresholds.minimumTraces / Math.max(1, tracesPerSeason)),
    Math.ceil(audit.thresholds.minimumManagers / Math.max(1, audit.metrics.managers)),
    audit.thresholds.minimumSeasons,
    Math.ceil(audit.thresholds.minimumContrasts / Math.max(1, contrastsPerSeason)),
    audit.metrics.variableFeatures >= audit.thresholds.minimumVariableFeatures ? 1 : Number.POSITIVE_INFINITY,
  );
  const summary = {
    schemaVersion: 1,
    source,
    sourceCompletedSeason: sourceState.completedSeason,
    trialSeasons: {first: firstSeason, last: finalSeason, count: trialSeasons},
    sourceStateSha256: sourceHash,
    sourceUnchanged: true,
    temporaryTrialRemoved: true,
    recoveredCompletedWork: recoverCompletedWork,
    durationMs,
    metrics: audit.metrics,
    blockers: audit.blockers,
    throughput: {
      diagnosticTracesPerMinute: round(audit.metrics.tracesWithDiagnostics / minutes),
      variableContrastsPerMinute: round(audit.metrics.variableContrasts / minutes),
      diagnosticBytes,
      bytesPerDiagnosticTrace: round(diagnosticBytes / Math.max(1, audit.metrics.tracesWithDiagnostics)),
      decisionLedgerBytes,
      seasonOutputBytes,
      projectedSeasonsToReadiness: Number.isFinite(seasonsToReadiness) ? seasonsToReadiness : null,
    },
    featureVariance: audit.features,
  };
  write(path.join(out, "lineup-representation-efficiency.json"), summary);
  const sampleArchive = path.join(out, "lineup-representation-study-samples.json.gz");
  fs.writeFileSync(sampleArchive, zlib.gzipSync(Buffer.from(`${JSON.stringify({schemaVersion: 1, sourceStateSha256: sourceHash, firstSeason, finalSeason, rows: studyRows})}\n`, "utf8"), {level: 9}));
  const report = [
    "# Lineup Representation Accumulation Efficiency",
    "",
    `- Trial seasons: S${firstSeason}-S${finalSeason} from immutable S${sourceState.completedSeason} boundary`,
    `- Duration: ${(durationMs / 1000).toFixed(1)} seconds`,
    `- Diagnostic traces: ${audit.metrics.tracesWithDiagnostics}`,
    `- Variable contrasts: ${audit.metrics.variableContrasts}`,
    `- Managers: ${audit.metrics.managers}`,
    `- Variable features: ${audit.metrics.variableFeatures}`,
    `- Trace throughput: ${summary.throughput.diagnosticTracesPerMinute}/minute`,
    `- Contrast throughput: ${summary.throughput.variableContrastsPerMinute}/minute`,
    `- Diagnostic storage: ${diagnosticBytes} bytes (${summary.throughput.bytesPerDiagnosticTrace} bytes/trace)`,
    `- Decision ledger / season output: ${summary.throughput.decisionLedgerBytes} / ${summary.throughput.seasonOutputBytes} bytes`,
    `- Projected seasons to readiness: ${summary.throughput.projectedSeasonsToReadiness ?? "not estimable"}`,
    `- Readiness conclusion: ${audit.conclusion}`,
    `- Compressed study samples: ${fs.statSync(sampleArchive).size} bytes`,
    `- Source unchanged: true`,
    `- Temporary trial removed: true`,
    "",
    "The projection is a telemetry-readiness estimate, not evidence that any diagnostic improves competitive outcomes.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(out, "lineup-representation-efficiency.md"), report, "utf8");
  write(path.join(out, "token-budget.json"), {schemaVersion: 1, reportBytes: Buffer.byteLength(report), estimatedReportTokens: Math.ceil(Buffer.byteLength(report) / 4), rawBattleLogsReadByAudit: 0});
  completed = true;
  console.log(JSON.stringify({status: "complete", trialRange: `${firstSeason}-${finalSeason}`, durationMs, conclusion: audit.conclusion, ...audit.metrics, throughput: summary.throughput, sampleArchive, report: path.join(out, "lineup-representation-efficiency.md")}, null, 2));
} finally {
  if (fs.existsSync(work) && (!recoverCompletedWork || completed)) {
    assertSafeWork(work);
    fs.rmSync(work, {recursive: true, force: true});
  }
  lock.release();
  if (!completed && fileHash(sourceStateFile) !== sourceHash) throw new Error("Failed trial mutated the source dynasty");
}

function assertSafeWork(directory: string): void {
  const resolved = path.resolve(directory);
  if (resolved !== path.join(out, ".trial-work") || !resolved.startsWith(`${out}${path.sep}`)) throw new Error(`Unsafe trial work directory: ${resolved}`);
}
function validateCompletedTrial(directory: string, first: number, final: number): void { if (!fs.existsSync(path.join(directory, "dynasty-state.json"))) throw new Error("Recovered trial lacks dynasty state"); for (let season = first; season <= final; season++) for (const file of ["season.json", "decision-ledger.json"]) if (!fs.existsSync(path.join(directory, `season-${String(season).padStart(2, "0")}`, file))) throw new Error(`Recovered trial is incomplete: season-${season}/${file}`); }
function clearStaleRecoveryLock(file: string): void { if (!fs.existsSync(file)) return; const owner = read<any>(file), pid = Number(owner.pid); if (!Number.isInteger(pid) || pid < 1) throw new Error(`Recovery lock has invalid owner: ${file}`); try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") { fs.rmSync(file); return; } throw error; } throw new Error(`Cannot recover while lock owner ${pid} is alive`); }
function directoryBytes(directory: string): number { let total = 0; for (const entry of fs.readdirSync(directory, {withFileTypes: true})) { const file = path.join(directory, entry.name); total += entry.isDirectory() ? directoryBytes(file) : entry.isFile() ? fs.statSync(file).size : 0; } return total; }
function allSeries(season: any): any[] { const playoffs = season.playoffs ?? {}; return [...(season.league ?? []), ...(playoffs.playIns ?? []), ...(playoffs.quarters ?? []), ...(playoffs.semifinals ?? []), ...(playoffs.final ? [playoffs.final] : [])].filter(Boolean); }
function canonicalSeriesId(seriesId: string): string { return seriesId.replace(/-tiebreak-\d+$/, ""); }
function seriesOutcome(series: any, managerId: string): "win" | "loss" | "draw" | "missing" {
  if (!series || (String(series.left) !== managerId && String(series.right) !== managerId)) return "missing";
  const opponent = String(series.left) === managerId ? String(series.right) : String(series.left);
  const ownPairs = String(series.left) === managerId ? Number(series.leftPairs ?? 0) : Number(series.rightPairs ?? 0);
  const opponentPairs = String(series.left) === managerId ? Number(series.rightPairs ?? 0) : Number(series.leftPairs ?? 0);
  if (ownPairs !== opponentPairs) return ownPairs > opponentPairs ? "win" : "loss";
  let ownGames = 0, opponentGames = 0;
  for (const game of series.games ?? []) {
    if (String(game.winner) === managerId) ownGames++;
    else if (String(game.winner) === opponent) opponentGames++;
  }
  return ownGames === opponentGames ? "draw" : ownGames > opponentGames ? "win" : "loss";
}
function fileHash(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function write(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integerOption(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`); return value; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
