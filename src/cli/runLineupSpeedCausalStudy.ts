import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import zlib from "node:zlib";
import {summarizeLineupSpeedCausalResult, type LineupSpeedCausalResultCase} from "../ai/whiteBox/lineupSpeedCausalResult";
import {materializeHistoricalDynastyBoundary} from "../draft/historicalRuntimeCheckpoint";
import {acquireNamedRunLock} from "../draft/runLock";
import {syncManagerMechanismLedgers} from "../ai/managerMechanismLedgerSync";
import {acquireSourceCacheLease, gcSourceCaches, touchSourceCache} from "../draft/sourceCacheMaintenance";

const args = process.argv.slice(2);
const root = process.cwd();
const official = path.resolve(option("--source", "output/official-era-03/league"));
const planFile = path.resolve(option("--plan", "output/tooling/shadow-lineup-speed-causal/lineup-speed-causal-plan.json"));
const out = path.resolve(option("--out", "output/tooling/shadow-lineup-speed-causal"));
const concurrency = integerOption("--concurrency", 3, 1, 4);
const maximumCases = integerOption("--max-cases", 24, 1, 24);
const prepareOnly = args.includes("--prepare-only");
const rebuildIncompleteSource = args.includes("--rebuild-incomplete-source");
const plan = read<any>(planFile), officialStateFile = path.join(official, "dynasty-state.json"), officialState = read<any>(officialStateFile);
const hypothesisId = String(plan.hypothesisId ?? plan.hypothesis?.primaryFeature ?? "lineup-speed-causal-v1");
const finalSeason = Math.max(...plan.selected.map((entry: any) => Number(entry.season))), sourceCacheRoot = path.resolve(option("--source-cache", "output/tooling/shadow-lineup-source-cache"));
const sourceCacheBudgetBytes = integerOption("--source-cache-max-mb", Number(process.env.LINEUP_SOURCE_CACHE_MAX_MB ?? 4096), 512, 102400) * 1048576, sourceCacheMaxAgeDays = integerOption("--source-cache-max-age-days", Number(process.env.LINEUP_SOURCE_CACHE_MAX_AGE_DAYS ?? 30), 0, 3650);
const sourceCacheIdentity = {officialStateSha256: fileHash(officialStateFile), finalSeason, runtimeInputsSha256: runtimeInputsHash(root)};
const sourceCacheKey = crypto.createHash("sha256").update(JSON.stringify(sourceCacheIdentity)).digest("hex"), studySource = path.join(sourceCacheRoot, sourceCacheKey), manifestFile = path.join(out, "causal-manifest.json");
fs.mkdirSync(out, {recursive: true});
void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });

async function main(): Promise<void> {
  const lock = acquireNamedRunLock(out, ".lineup-causal.lock", {workflow: "lineup-causal", hypothesisId, official, plan: planFile});
  let sourceLease: {release: () => void} | undefined;
  try {
    if (!prepareOnly && fs.existsSync(manifestFile)) {
      const persisted = loadManifest();
      if (persisted.items.every((item: any) => item.status === "complete")) {
        finalizeCompletedStudy(persisted);
        return;
      }
      if (persisted.sourceCache && (persisted.sourceCache.key !== sourceCacheKey || JSON.stringify(persisted.sourceCache.identity) !== JSON.stringify(sourceCacheIdentity))) throw new Error("Incomplete causal study runtime inputs changed; start a new study instead of mixing runtime identities");
    }
    if (!fs.existsSync(manifestFile)) verifyPersonalEvidenceSnapshot();
    prepareStudySource();
    sourceLease = acquireSourceCacheLease(studySource, sourceCacheKey, "lineup-causal-study");
    verifyPlanAgainstSource();
    if (prepareOnly) {
      console.log(JSON.stringify({status: "prepared", source: studySource, cases: plan.selected.length}, null, 2));
    } else {
      const manifest = loadManifest();
      const pending = manifest.items.filter((item: any) => item.status !== "complete").slice(0, maximumCases);
      for (let index = 0; index < pending.length; index += concurrency) {
        const batch = pending.slice(index, index + concurrency);
        const results = await Promise.allSettled(batch.map((item: any) => runCase(item)));
        const failure = results.find(result => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
      }
      writeManifest(manifest);
      if (manifest.items.every((item: any) => item.status === "complete")) finalizeCompletedStudy(manifest);
      else summarize(manifest);
    }
  } finally {
    sourceLease?.release();
    lock.release();
  }
}

function verifyPersonalEvidenceSnapshot(): void {
  const reference = plan.personalEvidence;
  if (!reference) return;
  const archive = path.resolve(root, String(reference.archive ?? "")), expected = String(reference.sha256 ?? "");
  if (!fs.existsSync(archive) || !/^[a-f0-9]{64}$/.test(expected) || fileHash(archive) !== expected) throw new Error("Causal plan personal-evidence snapshot does not match the current manager ledger");
  if (reference.researchAgendas) { const agendaArchive = path.resolve(root, String(reference.researchAgendas.archive ?? "")), agendaHash = String(reference.researchAgendas.sha256 ?? ""); if (!fs.existsSync(agendaArchive) || !/^[a-f0-9]{64}$/.test(agendaHash) || fileHash(agendaArchive) !== agendaHash) throw new Error("Causal plan research-agenda snapshot does not match manager requests"); }
  if (reference.priorExperiments) { const experimentArchive = path.resolve(root, String(reference.priorExperiments.archive ?? "")), experimentHash = String(reference.priorExperiments.sha256 ?? ""); if (!fs.existsSync(experimentArchive) || !/^[a-f0-9]{64}$/.test(experimentHash) || fileHash(experimentArchive) !== experimentHash) throw new Error("Causal plan prior-experiment snapshot does not match the import registry"); }
}

function finalizeCompletedStudy(manifest: any): void {
  const recordedCache = manifest.sourceCache ?? (fs.existsSync(path.join(out, "causal-summary.json")) ? read<any>(path.join(out, "causal-summary.json")).sharedStudySourceCache : null) ?? {key: sourceCacheKey, identity: sourceCacheIdentity, retained: fs.existsSync(studySource)};
  summarize(manifest, false, recordedCache);
  const final = read<any>(path.join(out, "causal-summary.json"));
  const completed = {...final, temporaryStudySourceRemoved: false, sharedStudySourceCache: recordedCache};
  if (fs.existsSync(studySource)) touchSourceCache(studySource, sourceCacheKey, "completed-study-review");
  write(path.join(out, "causal-summary.json"), completed);
  if (process.env.MANAGER_MECHANISM_AUTO_SYNC !== "false") {
    const sync = syncManagerMechanismLedgers({
      studies: [out],
      out: path.resolve(process.env.MANAGER_MECHANISM_LEDGER_OUT ?? "output/tooling/manager-mechanism-ledgers"),
      managerIds: (officialState.managers ?? []).map((manager: any) => String(manager.id)),
    });
    write(path.join(out, "mechanism-ledger-sync.json"), sync);
  }
  console.log(JSON.stringify(completed, null, 2));
}

function prepareStudySource(): void {
  fs.mkdirSync(sourceCacheRoot, {recursive: true});
  gcSourceCaches(sourceCacheRoot, path.dirname(sourceCacheRoot), {budgetBytes: sourceCacheBudgetBytes, maxAgeDays: sourceCacheMaxAgeDays, apply: true, protectedKeys: [sourceCacheKey]});
  const cacheLock = acquireNamedRunLock(sourceCacheRoot, `.${sourceCacheKey.slice(0, 24)}.lock`, {workflow: "lineup-causal-source-cache", sourceCacheKey, finalSeason});
  try {
    if (validStudySourceCache()) { touchSourceCache(studySource, sourceCacheKey, "causal-study-reuse"); return; }
    if (fs.existsSync(studySource)) {
      if (!rebuildIncompleteSource) throw new Error(`Invalid causal source cache: ${studySource}; inspect or use --rebuild-incomplete-source`);
      assertSafeStudySource(studySource); fs.rmSync(studySource, {recursive: true, force: true});
    }
    const temporary = path.join(sourceCacheRoot, `.${sourceCacheKey}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
    try { buildStudySource(temporary); write(path.join(temporary, "source-cache.json"), {schemaVersion: 1, key: sourceCacheKey, identity: sourceCacheIdentity, evidence: studySourceEvidence(temporary)}); fs.renameSync(temporary, studySource); touchSourceCache(studySource, sourceCacheKey, "causal-study-created"); }
    catch (error) { assertSafeStudySource(temporary); fs.rmSync(temporary, {recursive: true, force: true}); throw error; }
  } finally { cacheLock.release(); }
}

function buildStudySource(target: string): void {
  const officialHash = fileHash(officialStateFile);
  const boundary = materializeHistoricalDynastyBoundary(official, officialState.completedSeason, target);
  ensureStartingCheckpoint(target);
  const settings = officialState.settings;
  runSync(path.join(root, "src", "cli", "draftLeagueV12.ts"), [], {
    V12_OUT: target, V12_SEED: officialState.seed, V12_SEASONS: String(finalSeason), V12_RESUME: "true", V12_ALLOW_CODE_UPGRADE: "true",
    V12_MANAGER_LIMIT: String(settings.managerLimit), V12_PAIRS: String(settings.pairs), V12_POOL_SIZE: String(settings.poolSize),
    V12_AUCTION_LOTS: String(settings.auctionLots), V12_REGULAR_ROUNDS: String(settings.regularRounds), V12_MAX_TURNS: String(settings.maxTurns),
    V12_MIN_ROSTER: String(settings.minRoster ?? 6), V12_MAX_ROSTER: String(settings.maxRoster ?? 10), V12_BASE_CASH: String(settings.baseBudget ?? 40),
    V12_AUCTION_MODE: String(settings.auctionMode ?? "sequential"), V12_REGISTRY_SOURCE: boundary.registrySource,
    V12_REGISTRY_REVISION: officialState.registry?.revision ?? "lineup-speed-causal", V12_STRATEGY_PROGRAM_OPERATOR: String(settings.strategyProgramOperator ?? "observed-boundary-v1"),
    V12_EVOLUTION_MODE: String(settings.evolutionMode ?? "punctuated"), V12_EVOLUTION_POLICY: String(settings.evolutionPolicy ?? "shadow"),
    V12_EVOLUTION_MAX_BURSTS: String(settings.evolutionMaxBursts ?? 2), V12_EVOLUTION_MIN_CANDIDATES: String(settings.evolutionMinCandidates ?? 4),
    V12_EVOLUTION_MAX_CANDIDATES: String(settings.evolutionMaxCandidates ?? 8), V12_TACTICAL_MEMORY_CONFIDENCE_FLOOR: String(settings.tacticalMemoryConfidenceFloor ?? .15),
    V12_EVIDENCE_RETENTION: "compact", V12_EVIDENCE_SAMPLE_RATE: "0",
  });
  if (fileHash(officialStateFile) !== officialHash) throw new Error("Causal source preparation mutated the official dynasty");
}

function validStudySourceCache(): boolean {
  const markerFile = path.join(studySource, "source-cache.json"), stateFile = path.join(studySource, "dynasty-state.json");
  if (!fs.existsSync(markerFile) || !fs.existsSync(stateFile)) return false;
  try { const marker = read<any>(markerFile), state = read<any>(stateFile); return marker.schemaVersion === 1 && marker.key === sourceCacheKey && JSON.stringify(marker.identity) === JSON.stringify(sourceCacheIdentity) && state.completedSeason === finalSeason && JSON.stringify(marker.evidence) === JSON.stringify(studySourceEvidence(studySource)); }
  catch { return false; }
}

function studySourceEvidence(source: string): Record<string, string> { const files = ["dynasty-state.json"]; for (let season = Number(officialState.completedSeason) + 1; season <= finalSeason; season++) files.push(`season-${String(season).padStart(2, "0")}/season.json`, `season-${String(season).padStart(2, "0")}/decision-ledger.json`); return Object.fromEntries(files.map(relative => { const file = path.join(source, relative); if (!fs.existsSync(file)) throw new Error(`Causal source cache evidence is missing: ${relative}`); return [relative, fileHash(file)]; })); }

function ensureStartingCheckpoint(targetRoot: string): void {
  const season = Number(officialState.completedSeason);
  const relative = path.join(".season-checkpoints", `season-${String(season).padStart(2, "0")}`);
  const source = path.join(official, relative), target = path.join(targetRoot, relative);
  if (!fs.existsSync(path.join(source, "checkpoint.json"))) throw new Error(`Official starting checkpoint is missing: ${source}`);
  if (!fs.existsSync(path.join(target, "checkpoint.json"))) fs.cpSync(source, target, {recursive: true, force: false, errorOnExist: false, verbatimSymlinks: true});
  const checkpoint = read<any>(path.join(source, "checkpoint.json"));
  const runtimeManifest = String(checkpoint.runtime?.manifest ?? "");
  if (!runtimeManifest) throw new Error(`Official starting checkpoint has no runtime manifest: ${source}`);
  const runtimeSource = path.join(official, path.dirname(runtimeManifest));
  const runtimeTarget = path.join(targetRoot, path.dirname(runtimeManifest));
  if (!fs.existsSync(path.join(runtimeTarget, "runtime-manifest.json"))) {
    if (!fs.existsSync(path.join(runtimeSource, "runtime-manifest.json"))) throw new Error(`Official starting runtime is missing: ${runtimeSource}`);
    fs.cpSync(runtimeSource, runtimeTarget, {recursive: true, force: false, errorOnExist: false, verbatimSymlinks: true});
  }
}

function verifyPlanAgainstSource(): void {
  for (const planned of plan.selected) {
    const ledger = read<any>(path.join(studySource, `season-${String(planned.season).padStart(2, "0")}`, "decision-ledger.json"));
    const record = (ledger.records ?? []).find((entry: any) => entry.context?.whiteBoxShadow?.decisionId === planned.decisionId);
    const trace = record?.context?.whiteBoxShadow;
    if (!trace || String(record.actor) !== String(planned.managerId)) throw new Error(`Planned decision did not reproduce: ${planned.id}`);
    if (String(trace.comparison?.incumbent) !== String(planned.incumbentId)) throw new Error(`Planned incumbent drifted: ${planned.id}`);
    if (!(trace.candidates ?? []).some((candidate: any) => String(candidate.id) === String(planned.candidateId))) throw new Error(`Planned candidate drifted: ${planned.id}`);
  }
}

function loadManifest(): any {
  if (fs.existsSync(manifestFile)) return read<any>(manifestFile);
  const manifest = {schemaVersion: 1, plan: planFile, planSha256: fileHash(planFile), sourceCache: {key: sourceCacheKey, identity: sourceCacheIdentity, retained: true}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), items: plan.selected.map((entry: any) => ({...entry, status: "pending"}))};
  write(manifestFile, manifest); return manifest;
}

async function runCase(item: any): Promise<void> {
  item.status = "running"; item.startedAt = new Date().toISOString(); delete item.failedAt; delete item.error; writeManifestFromItem(item);
  const caseRoot = path.join(out, "cases", safeCase(item));
  try {
    await runAsync(path.join(root, "src", "cli", "counterfactualWhiteBoxLineup.ts"), [
      "--source", studySource, "--out", caseRoot, "--decision-id", item.decisionId, "--manager", item.managerId,
      "--season", String(item.season), "--candidate-id", item.candidateId, "--reuse-source-control", "--force",
    ]);
    runSync(path.join(root, "src", "cli", "compactLineupCounterfactual.ts"), ["--input", caseRoot], {});
    const archive = path.join(caseRoot, "counterfactual-evidence.json.gz");
    const capsule = JSON.parse(zlib.gunzipSync(fs.readFileSync(archive)).toString("utf8"));
    if (capsule.summary?.candidateId !== item.candidateId || capsule.interventionRecord?.context?.programDecisionExperiment?.candidateId !== item.candidateId) throw new Error(`Forced candidate evidence mismatch: ${item.id}`);
    item.status = "complete"; item.completedAt = new Date().toISOString(); delete item.failedAt; delete item.error; item.output = archive;
    item.result = {
      direction: capsule.summary.localOutcome.direction,
      pairMarginDelta: capsule.summary.localOutcome.delta.pairMargin,
      gameMarginDelta: capsule.summary.localOutcome.delta.gameMargin,
      causal: capsule.battleCausalSignature?.summary ?? {games: 0, actionDivergences: 0, outcomeChanges: 0, unusedSubstitutions: 0},
    };
    writeManifestFromItem(item);
  } catch (error) {
    item.status = "failed"; item.failedAt = new Date().toISOString(); item.error = (error instanceof Error ? error.message : String(error)).slice(0, 12000);
    writeManifestFromItem(item); throw error;
  }
}

function summarize(manifest: any, emit = true, recordedCache: any = manifest.sourceCache ?? {key: sourceCacheKey, identity: sourceCacheIdentity, retained: fs.existsSync(studySource)}): void {
  const completed = manifest.items.filter((item: any) => item.status === "complete");
  const cases: LineupSpeedCausalResultCase[] = completed.map((item: any) => ({
    managerId: item.managerId, direction: item.result.direction, pairMarginDelta: item.result.pairMarginDelta, gameMarginDelta: item.result.gameMarginDelta,
    games: Number(item.result.causal.games ?? 0), actionDivergences: Number(item.result.causal.actionDivergences ?? 0),
    outcomeChanges: Number(item.result.causal.outcomeChanges ?? 0), unusedSubstitutions: Number(item.result.causal.unusedSubstitutions ?? 0),
  }));
  const result = summarizeLineupSpeedCausalResult(cases, plan.selected.length);
  const sourceOutcomeBreakdown = Object.fromEntries(["win", "loss", "draw"].map(sourceOutcome => [
    sourceOutcome,
    Object.fromEntries(["better", "neutral", "worse"].map(direction => [
      direction,
      completed.filter((item: any) => item.sourceOutcome === sourceOutcome && item.result.direction === direction).length,
    ])),
  ]));
  const durations = completed.map((item: any) => Math.max(0, (Date.parse(item.completedAt) - Date.parse(item.startedAt)) / 1000)).filter(Number.isFinite);
  const retainedBytes = completed.reduce((sum: number, item: any) => sum + (item.output && fs.existsSync(item.output) ? fs.statSync(item.output).size : 0), 0);
  const reportedConclusion = plan.causalScope === "personal-local-replication" ? "personal-results-only" : result.conclusion;
  const summary = {
    ...result,
    conclusion: reportedConclusion,
    causalScope: plan.causalScope ?? "population-causal",
    hypothesisId,
    planned: plan.selected.length,
    completed: completed.length,
    pending: manifest.items.filter((item: any) => item.status === "pending").length,
    failed: manifest.items.filter((item: any) => item.status === "failed").length,
    sourceOutcomeBreakdown,
    efficiency: {
      meanCaseSeconds: durations.length ? round(durations.reduce((sum: number, value: number) => sum + value, 0) / durations.length) : 0,
      maxCaseSeconds: durations.length ? round(Math.max(...durations)) : 0,
      retainedCapsuleBytes: retainedBytes,
    },
    activationStatus: "shadow-only",
    temporaryStudySourceRemoved: false,
    sharedStudySourceCache: recordedCache,
  };
  write(path.join(out, "causal-summary.json"), summary);
  const report = [
    `# Lineup Causal Study: ${hypothesisId}`,
    "",
    `- Conclusion: ${reportedConclusion}`,
    `- Causal scope: ${plan.causalScope ?? "population-causal"}`,
    `- Completed: ${completed.length}/${plan.selected.length}`,
    `- Better/neutral/worse: ${result.metrics.better}/${result.metrics.neutral}/${result.metrics.worse}`,
    `- Paired score: ${result.metrics.pairedScore}`,
    `- Improvement/regression p: ${result.metrics.improvementP}/${result.metrics.regressionP}`,
    `- Games/action divergences/outcome changes: ${result.metrics.games}/${result.metrics.actionDivergences}/${result.metrics.outcomeChanges}`,
    `- Unused substitutions: ${result.metrics.unusedSubstitutions}`,
    `- Source-loss better/neutral/worse: ${sourceOutcomeBreakdown.loss.better}/${sourceOutcomeBreakdown.loss.neutral}/${sourceOutcomeBreakdown.loss.worse}`,
    `- Source-win better/neutral/worse: ${sourceOutcomeBreakdown.win.better}/${sourceOutcomeBreakdown.win.neutral}/${sourceOutcomeBreakdown.win.worse}`,
    `- Mean/max case runtime: ${summary.efficiency.meanCaseSeconds}s / ${summary.efficiency.maxCaseSeconds}s`,
    `- Retained capsule bytes: ${summary.efficiency.retainedCapsuleBytes}`,
    `- Activation: ${summary.activationStatus}`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(out, "causal-report.md"), report, "utf8");
  if (emit) console.log(JSON.stringify(summary, null, 2));
}

function writeManifestFromItem(item: any): void { const manifest = read<any>(manifestFile); const target = manifest.items.find((entry: any) => entry.id === item.id); Object.assign(target, item); writeManifest(manifest); }
function writeManifest(manifest: any): void {
  for (const item of manifest.items ?? []) if (item.status === "complete") { delete item.failedAt; delete item.error; }
  manifest.updatedAt = new Date().toISOString();
  write(manifestFile, manifest);
}
function runSync(script: string, toolArgs: string[], extraEnv: Record<string, string>): void { const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), script, ...toolArgs], {cwd: root, env: {...process.env, ...extraEnv}, encoding: "utf8", maxBuffer: 64 * 1024 * 1024}); if (result.status !== 0) throw new Error(`${path.basename(script)} failed:\n${result.stderr || result.stdout}`); }
function runAsync(script: string, toolArgs: string[]): Promise<void> { return new Promise((resolve, reject) => { const child = spawn(process.execPath, [require.resolve("tsx/cli"), script, ...toolArgs], {cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"]}); const output: Buffer[] = []; child.stdout.on("data", chunk => output.push(chunk)); child.stderr.on("data", chunk => output.push(chunk)); child.on("error", reject); child.on("close", code => code === 0 ? resolve() : reject(new Error(`${path.basename(script)} failed:\n${Buffer.concat(output).toString("utf8").slice(-12000)}`))); }); }
function safeCase(item: any): string { return `s${String(item.season).padStart(2, "0")}-${item.managerId}-${crypto.createHash("sha1").update(item.decisionId).digest("hex").slice(0, 10)}`; }
function assertSafeStudySource(candidate: string): void { const resolved = path.resolve(candidate), cache = path.resolve(sourceCacheRoot), name = path.basename(resolved).replace(/^\./, ""); if (path.dirname(resolved) !== cache || !name.startsWith(sourceCacheKey)) throw new Error(`Unsafe causal source-cache cleanup: ${resolved}`); }
function runtimeInputsHash(project: string): string {
  const inputs = [...walk(path.join(project, "src")).filter(file => file.endsWith(".ts") && !file.includes(`${path.sep}tests${path.sep}`)), ...walk(path.join(project, "benchmarks", "gen9expanded")), ...["package.json", "package-lock.json", "tsconfig.json"].map(file => path.join(project, file)).filter(file => fs.existsSync(file))].sort();
  const digest = crypto.createHash("sha256"); for (const file of inputs) digest.update(path.relative(project, file).replaceAll("\\", "/")).update("\0").update(fs.readFileSync(file)).update("\0"); return digest.digest("hex");
}
function walk(directory: string): string[] { if (!fs.existsSync(directory)) return []; const result: string[] = []; for (const entry of fs.readdirSync(directory, {withFileTypes: true})) { const file = path.join(directory, entry.name); if (entry.isDirectory()) result.push(...walk(file)); else if (entry.isFile()) result.push(file); } return result; }
function fileHash(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function write(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integerOption(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`); return value; }
function round(value: number): number { return Math.round(value * 1000) / 1000; }
