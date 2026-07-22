import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {spawnSync} from "node:child_process";
import {auditV12Signature} from "../draft/v12Audit";
import {acquireNamedRunLock} from "../draft/runLock";

interface State {version: number; seed: string; completedSeason: number; settings: Record<string, number | string | boolean | undefined>; managers: Array<{id: string}>; fingerprint: Record<string, string>}
interface CycleManifest {
  schemaVersion: 1; cycleId: string; status: "running" | "complete"; majorRoot: string; developmentOut: string; previousDevelopment?: string;
  boundary: {internalSeason: number; globalSeason: number; stateSha256: string; seed: string}; promotionSlots: number;
  stages: Record<string, {status: "complete"; at: string; evidence: Record<string, unknown>}>;
}

const args = process.argv.slice(2), root = process.cwd();
const majorRoot = path.resolve(requiredOption("--major-source")), developmentOut = path.resolve(requiredOption("--development-out"));
const previousDevelopment = option("--previous-development", "") ? path.resolve(option("--previous-development", "")) : undefined;
const promotionSlots = integerOption("--promotion-slots", 3, 1, 5), offset = integerOption("--global-season-offset", 0, 0, 100000);
const workflowLock = acquireNamedRunLock(majorRoot, ".official-season-cycle.lock", {workflow: "official-season-cycle"});
process.once("exit", () => workflowLock.release());
const cycleId = option("--cycle-id", "") || runningCycleId() || `after-s${String(readState().completedSeason).padStart(2, "0")}`;
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(cycleId)) throw new Error("Invalid --cycle-id");
const manifestDir = path.join(majorRoot, "season-cycles"), manifestPath = path.join(manifestDir, `${cycleId}.json`);
fs.mkdirSync(manifestDir, {recursive: true});
const initialState = readState(), initialHash = fileHash(path.join(majorRoot, "dynasty-state.json"));
let manifest = loadOrCreateManifest();
if (manifest.status === "complete") { verifyComplete(); finish(true); }

audit("before-audit", initialState.completedSeason);
development();
promotion();
compactDevelopment();
nextSeason();
audit("after-audit", manifest.boundary.internalSeason + 1);
updateHistory();
manifest.status = "complete"; persist(); finish(false);

function audit(stage: string, expectedSeason: number): void {
  if (manifest.stages[stage]) return;
  run("src/cli/auditV12.ts", ["--out", majorRoot, "--force"], process.env, `V12 audit (${stage})`);
  const summary = read<any>(path.join(majorRoot, "audit-summary.json"));
  if (summary.completedSeasons !== expectedSeason || summary.fatalCount !== 0 || summary.warningCount !== 0 || !summary.metrics?.moneyConserved) throw new Error(`${stage} did not produce a clean audited boundary`);
  completeStage(stage, {completedSeasons: summary.completedSeasons, inputSignature: summary.inputSignature, fatal: summary.fatalCount, warnings: summary.warningCount});
}

function development(): void {
  if (manifest.stages.development) return;
  if (!developmentComplete()) {
    const managerCount = initialState.managers.length, formalScale = managerCount >= 30;
    const command = ["--source", majorRoot, "--out", developmentOut, "--capacity", String(managerCount), "--parent-limit", String(managerCount), "--seasons", option("--development-seasons", "1"), "--promotion-slots", String(promotionSlots), "--elimination-slots", String(promotionSlots), "--regular-rounds", option("--development-rounds", "1"), "--max-turns", option("--development-max-turns", "40"), "--development-parent-percent", "50", "--max-founder-share-percent", "50", "--kinship-depth", "2", "--max-parent-similarity-percent", "90", "--academy-influence-percent", "15", "--academy-evolution-percent", "10", "--academy-initial-budget", "30", "--academy-grant-pool", String(Math.round(managerCount * 17.5)), "--academy-grant-load-percent", formalScale ? "100" : "0", "--academy-payroll-reserve-percent", formalScale ? "100" : "0", "--academy-max-cycle-spend", "30", "--academy-performance-revenue", "10", "--academy-market-policy", "shadow", "--academy-market-consent-policy", "enforce", "--academy-market-contract-policy", "enforce", "--academy-market-max-transactions", formalScale ? "10" : "2"];
    if (previousDevelopment) command.push("--previous", previousDevelopment);
    run("src/cli/developmentLeague.ts", command, process.env, "development league");
  }
  const promotion = read<any>(path.join(developmentOut, "promotion-package.json")), summary = read<any>(path.join(developmentOut, "development-summary.json"));
  const payload = promotionPayload();
  if (payload.source.stateSha256 !== manifest.boundary.stateSha256 || payload.source.completedSeason !== manifest.boundary.internalSeason || payload.source.seed !== manifest.boundary.seed) throw new Error("Development output is not bound to this cycle boundary");
  if (promotion.candidates !== promotionSlots || summary.promoted?.length !== promotionSlots) throw new Error("Development output has the wrong promotion count");
  completeStage("development", {cycle: summary.cycle, capacity: summary.capacity, candidates: promotion.candidates, packageSha256: promotion.sha256});
}

function promotion(): void {
  if (manifest.stages.promotion) return;
  const transactionPath = path.join(majorRoot, "promotion-transactions", cycleId, "transaction.json");
  if (!fs.existsSync(transactionPath) || read<any>(transactionPath).status !== "committed") {
    run("src/cli/applyDevelopmentPromotion.ts", ["--major-source", majorRoot, "--promotion", path.join(developmentOut, "promotion-package.json"), "--auto-bottom", String(promotionSlots), "--transaction-id", cycleId], process.env, "in-place promotion");
  }
  const transaction = read<any>(transactionPath), state = readState();
  if (transaction.status !== "committed" || state.completedSeason !== manifest.boundary.internalSeason) throw new Error("Promotion transaction did not preserve the season boundary");
  completeStage("promotion", {transaction: path.relative(majorRoot, transactionPath).replace(/\\/g, "/"), packageSha256: transaction.promotion?.payloadSha256, vacancies: transaction.transactions?.map((row: any) => row.vacancy)});
}

function compactDevelopment(): void {
  if (manifest.stages["development-retention"]) return;
  run("src/cli/compactDevelopmentLeague.ts", ["--source", developmentOut, "--prune-league"], process.env, "development retention");
  const compact = read<any>(path.join(developmentOut, "development-final-state.json"));
  if (compact.schemaVersion !== 1 || !fs.existsSync(path.join(developmentOut, compact.archive)) || fs.existsSync(path.join(developmentOut, "league"))) throw new Error("Development retention did not produce a verified compact boundary");
  completeStage("development-retention", {archive: compact.archive, managers: compact.managers, sourceBytes: compact.sourceBytes, compactBytes: compact.compactBytes});
}

function nextSeason(): void {
  if (manifest.stages.season) return;
  const target = manifest.boundary.internalSeason + 1, current = readState();
  if (current.completedSeason === manifest.boundary.internalSeason) {
    const settings = current.settings, env = {...process.env,
      V12_OUT: majorRoot, V12_SEED: current.seed, V12_SEASONS: String(target), V12_RESUME: "true",
      V12_ALLOW_CODE_UPGRADE: args.includes("--allow-code-upgrade") ? "true" : "false",
      V12_MANAGER_LIMIT: String(settings.managerLimit), V12_PAIRS: String(settings.pairs), V12_POOL_SIZE: String(settings.poolSize), V12_AUCTION_LOTS: String(settings.auctionLots), V12_REGULAR_ROUNDS: String(settings.regularRounds), V12_MAX_TURNS: String(settings.maxTurns), V12_MIN_ROSTER: String(settings.minRoster ?? 6), V12_MAX_ROSTER: String(settings.maxRoster ?? 10), V12_BASE_CASH: String(settings.baseBudget ?? 40),
      V12_EVOLUTION_MODE: String(settings.evolutionMode ?? "punctuated"), V12_EVOLUTION_POLICY: String(settings.evolutionPolicy ?? "shadow"), V12_EVOLUTION_MAX_BURSTS: String(settings.evolutionMaxBursts ?? 2), V12_EVOLUTION_MIN_CANDIDATES: String(settings.evolutionMinCandidates ?? 4), V12_EVOLUTION_MAX_CANDIDATES: String(settings.evolutionMaxCandidates ?? 8), V12_EVIDENCE_RETENTION: "compact", V12_EVIDENCE_SAMPLE_RATE: "0",
    };
    run("src/cli/draftLeagueV12.ts", [], env, "next official season");
  }
  const state = readState();
  if (state.completedSeason !== target) throw new Error(`Expected completed season ${target}, received ${state.completedSeason}`);
  completeStage("season", {internalSeason: target, globalSeason: target + offset, stateSha256: fileHash(path.join(majorRoot, "dynasty-state.json"))});
}

function updateHistory(): void {
  const configured = option("--history-ledger", "");
  if (!configured || manifest.stages.history) return;
  const ledgerPath = path.resolve(configured), ledger = read<any>(ledgerPath), internalSeason = manifest.boundary.internalSeason + 1, globalSeason = internalSeason + offset;
  const existing = ledger.seasons?.find((entry: any) => entry.globalSeason === globalSeason);
  const season = read<any>(path.join(majorRoot, `season-${String(internalSeason).padStart(2, "0")}`, "season.json")), auditSummary = read<any>(path.join(majorRoot, "audit-summary.json"));
  const row = {globalSeason, internalSeason, eraRoot: majorRoot, champion: season.champion?.name, championId: season.champion?.id, stateSha256: fileHash(path.join(majorRoot, "dynasty-state.json")), auditInputSignature: auditSummary.inputSignature, cycleId};
  if (existing && JSON.stringify(existing) !== JSON.stringify(row)) throw new Error(`History ledger already has a different global season ${globalSeason}`);
  if (!existing) {
    const latest = Math.max(0, ...(ledger.seasons ?? []).map((entry: any) => Number(entry.globalSeason)));
    if (latest && latest + 1 !== globalSeason) throw new Error(`History ledger expected global season ${latest + 1}, not ${globalSeason}`);
    ledger.seasons = [...(ledger.seasons ?? []), row].sort((a: any, b: any) => a.globalSeason - b.globalSeason);
    ledger.completedGlobalSeason = globalSeason; ledger.updatedAt = new Date().toISOString(); atomicJson(ledgerPath, ledger);
  }
  completeStage("history", {ledger: ledgerPath, globalSeason});
}

function developmentComplete(): boolean { return ["promotion-package.json", "promotion-package.json.gz", "development-summary.json", "entrants.json"].every(file => fs.existsSync(path.join(developmentOut, file))); }
function promotionPayload(): any { const promotion = read<any>(path.join(developmentOut, "promotion-package.json")); return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(developmentOut, promotion.archive))).toString("utf8")); }
function completeStage(stage: string, evidence: Record<string, unknown>): void { manifest.stages[stage] = {status: "complete", at: new Date().toISOString(), evidence}; persist(); }
function persist(): void { atomicJson(manifestPath, manifest); }
function loadOrCreateManifest(): CycleManifest {
  if (fs.existsSync(manifestPath)) {
    const saved = read<CycleManifest>(manifestPath);
    if (saved.majorRoot !== majorRoot || saved.developmentOut !== developmentOut || saved.boundary.seed !== initialState.seed || saved.promotionSlots !== promotionSlots) throw new Error("Cycle id already belongs to different inputs");
    return saved;
  }
  return {schemaVersion: 1, cycleId, status: "running", majorRoot, developmentOut, previousDevelopment, boundary: {internalSeason: initialState.completedSeason, globalSeason: initialState.completedSeason + offset, stateSha256: initialHash, seed: initialState.seed}, promotionSlots, stages: {}};
}
function verifyComplete(): void { const state = readState(), audit = read<any>(path.join(majorRoot, "audit-summary.json")); if (state.completedSeason !== manifest.boundary.internalSeason + 1 || audit.completedSeasons !== state.completedSeason || audit.inputSignature !== auditV12Signature(majorRoot, state.completedSeason) || audit.fatalCount || audit.warningCount) throw new Error("Completed cycle manifest no longer matches the league"); }
function finish(reused: boolean): never { console.log(JSON.stringify({cycleId, status: manifest.status, reused, internalSeason: manifest.boundary.internalSeason + 1, globalSeason: manifest.boundary.internalSeason + 1 + offset, manifest: manifestPath}, null, 2)); process.exit(0); }
function readState(): State { return read<State>(path.join(majorRoot, "dynasty-state.json")); }
function runningCycleId(): string | undefined { const directory = path.join(majorRoot, "season-cycles"); if (!fs.existsSync(directory)) return undefined; const running = fs.readdirSync(directory).filter(file => file.endsWith(".json")).map(file => read<CycleManifest>(path.join(directory, file))).filter(value => value.status === "running"); if (running.length > 1) throw new Error("Multiple unfinished season cycles require an explicit --cycle-id"); return running[0]?.cycleId; }
function run(file: string, commandArgs: string[], env: NodeJS.ProcessEnv, label: string): void { const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, file), ...commandArgs], {cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024}); if (result.status !== 0) throw new Error(`${label} failed:\n${result.stderr || result.stdout}`); }
function atomicJson(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
function fileHash(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function requiredOption(name: string): string { const value = option(name, ""); if (!value) throw new Error(`${name} is required`); return value; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integerOption(name: string, fallback: number, min: number, max: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
