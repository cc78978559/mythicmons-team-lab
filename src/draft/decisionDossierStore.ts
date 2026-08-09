import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {DatabaseSync} from "node:sqlite";
import type {DecisionRecord} from "./decisionLedger";
import {classifyReplayEvidence} from "./evidenceEpochAudit";
import {acquireNamedRunLock} from "./runLock";
import type {AiDecisionTrace} from "../showdown/choice";
import {AI_VERSION} from "../showdown/choice";
import {buildEvidenceEpoch, canonicalJson, sha256} from "../showdown/evidenceEpoch";

const STORE_SCHEMA_VERSION = 1;
const DOSSIER_POLICY_VERSION = "decision-dossier-v1.5-current-era-coverage";

export interface DecisionDossierBuildOptions {
  leagueDirectory: string;
  outputDirectory: string;
  firstSeason?: number;
  lastSeason?: number;
}

export interface DecisionDossierSummary {
  schemaVersion: 1;
  policyVersion: string;
  generatedAt: string;
  leagueDirectory: string;
  database: string;
  seasons: number[];
  sources: number;
  reusedSources: number;
  rebuiltSources: number;
  removedSources: number;
  decisions: number;
  battleDecisions: number;
  leagueDecisions: number;
  managers: number;
  battleCoverage: {artifacts: number; fullTraceBattles: number; currentEraFullTraceBattles: number; keySummaryBattles: number; overlappingBattles: number; representedBattles: number; unrepresentedBattles: number};
  evidence: Record<string, number>;
  formalActivationAllowed: number;
  outcomeAuthority: "terminal-observational";
  anomalies: Array<{source: string; code: string; message: string}>;
  healthy: boolean;
  formalDecisionCoverageReady: boolean;
  inputSignature: string;
  currentPolicySha256: string;
  sourceAuditSignature: string | null;
  elapsedMs: number;
  peakRssBytes: number;
}

interface SourceDescriptor {
  sourcePath: string;
  absolutePath: string;
  domain: "battle" | "league";
  season: number;
  replayPath?: string;
  endPath?: string;
}

interface SourceFingerprint {
  fingerprint: string;
  decisionSha256: string;
  companions: Record<string, string>;
}

interface DossierRow {
  dossierId: string;
  sourcePath: string;
  sourceRecordKey: string;
  domain: "battle" | "league";
  season: number;
  stage: string;
  actor: string;
  ordinal: number;
  turn: number | null;
  side: string | null;
  selected: string | null;
  runnerUp: string | null;
  selectedScore: number | null;
  runnerUpScore: number | null;
  rationalScore: number | null;
  styleScore: number | null;
  margin: number | null;
  confidence: number | null;
  alternatives: number;
  reasonableAlternatives: number;
  contextJson: string;
  rationaleJson: string;
  outcomeJson: string;
  outcomeStatus: string;
  flagsJson: string;
  evidenceCompatibility: string;
  formalActivationAllowed: number;
  locatorJson: string;
  fingerprint: string;
}

export function buildDecisionDossiers(options: DecisionDossierBuildOptions): DecisionDossierSummary {
  const started = Date.now();
  const league = path.resolve(options.leagueDirectory), out = path.resolve(options.outputDirectory);
  if (!fs.existsSync(league)) throw new Error(`League directory does not exist: ${league}`);
  fs.mkdirSync(out, {recursive: true});
  const lock = acquireNamedRunLock(out, ".decision-dossiers.lock", {command: "build", league});
  const stateFile = path.join(out, "build-state.json"), failureFile = path.join(out, "failures.json");
  let phase = "discover", peakRssBytes = process.memoryUsage().rss;
  atomicJson(stateFile, {schemaVersion: 1, status: "running", phase, startedAt: new Date(started).toISOString(), peakRssBytes});
  let database: DatabaseSync | null = null;
  try {
    const databaseFile = path.join(out, "decision-dossiers.sqlite");
    const db = openStore(databaseFile); database = db;
    const discovery = discoverSources(league, options.firstSeason, options.lastSeason), descriptors = discovery.sources;
    const known = new Map((db.prepare("SELECT source_path, fingerprint FROM sources").all() as Array<{source_path: string; fingerprint: string}>).map(row => [row.source_path, row.fingerprint]));
    const active = new Set(descriptors.map(source => source.sourcePath));
    let reusedSources = 0, rebuiltSources = 0;
    const anomalies: DecisionDossierSummary["anomalies"] = [];
    phase = "index"; updateState(stateFile, phase, peakRssBytes);
    for (const descriptor of descriptors) {
      const hashes = fingerprintSource(descriptor);
      if (known.get(descriptor.sourcePath) === hashes.fingerprint) { reusedSources += 1; continue; }
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM decisions WHERE source_path = ?").run(descriptor.sourcePath);
        db.prepare(`INSERT INTO sources
          (source_path, domain, season, fingerprint, decision_sha256, companions_json, records, evidence_compatibility, formal_activation_allowed)
          VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', 0)
          ON CONFLICT(source_path) DO UPDATE SET domain=excluded.domain, season=excluded.season, fingerprint=excluded.fingerprint, decision_sha256=excluded.decision_sha256, companions_json=excluded.companions_json, records=0, evidence_compatibility='pending', formal_activation_allowed=0`)
          .run(descriptor.sourcePath, descriptor.domain, descriptor.season, hashes.fingerprint, hashes.decisionSha256, compact(hashes.companions));
        const result = descriptor.domain === "battle" ? indexBattleSource(db, descriptor, hashes, anomalies) : indexLeagueSource(db, descriptor, hashes, anomalies);
        db.prepare("UPDATE sources SET records=?, evidence_compatibility=?, formal_activation_allowed=? WHERE source_path=?")
          .run(result.records, result.compatibility, result.formalAllowed ? 1 : 0, descriptor.sourcePath);
        db.exec("COMMIT"); rebuiltSources += 1;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    }
    let removedSources = 0;
    for (const sourcePath of known.keys()) if (!active.has(sourcePath)) {
      db.exec("BEGIN IMMEDIATE");
      try { db.prepare("DELETE FROM decisions WHERE source_path = ?").run(sourcePath); db.prepare("DELETE FROM sources WHERE source_path = ?").run(sourcePath); db.exec("COMMIT"); removedSources += 1; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    }
    phase = "self-audit"; updateState(stateFile, phase, peakRssBytes);
    anomalies.push(...auditStore(db));
    const counts = db.prepare(`SELECT COUNT(*) decisions,
      SUM(CASE WHEN domain='battle' THEN 1 ELSE 0 END) battle_decisions,
      SUM(CASE WHEN domain='league' THEN 1 ELSE 0 END) league_decisions,
      COUNT(DISTINCT CASE WHEN actor GLOB 'manager-[0-9][0-9]' AND LENGTH(actor)=10 THEN actor END) managers,
      SUM(formal_activation_allowed) formal_allowed,
      SUM(CASE WHEN outcome_status='terminal-observational' THEN 1 ELSE 0 END) full_trace_decisions,
      SUM(CASE WHEN outcome_status='terminal-observational' AND evidence_compatibility='exact-compatible' THEN 1 ELSE 0 END) current_full_trace,
      SUM(CASE WHEN outcome_status='terminal-observational' AND evidence_compatibility='exact-compatible' THEN formal_activation_allowed ELSE 0 END) formal_current_full_trace FROM decisions`).get() as any;
    const evidenceRows = db.prepare("SELECT evidence_compatibility compatibility, COUNT(*) count FROM decisions GROUP BY evidence_compatibility").all() as Array<{compatibility: string; count: number}>;
    const sourceRows = db.prepare("SELECT source_path, fingerprint FROM sources ORDER BY source_path").all() as Array<{source_path: string; fingerprint: string}>;
    const seasons = [...new Set(descriptors.map(source => source.season))].sort((a, b) => a - b);
    const inputSignature = sha256(sourceRows.map(row => [row.source_path, row.fingerprint]));
    const currentPolicySha256 = buildEvidenceEpoch(AI_VERSION, "gen9ou").policySha256;
    const sourceAuditSignature = readAuditSignature(league);
    const evidence = Object.fromEntries(evidenceRows.map(row => [row.compatibility, Number(row.count)]));
    const decisions = Number(counts.decisions ?? 0), formalActivationAllowed = Number(counts.formal_allowed ?? 0);
    const fullTraceKeys = new Set(descriptors.filter(source => source.domain === "battle").map(source => traceBattleKey(source.sourcePath)));
    const currentEraFullTraceBattles = Number((db.prepare("SELECT COUNT(*) count FROM sources WHERE domain='battle' AND evidence_compatibility='exact-compatible' AND formal_activation_allowed=1 AND records>0").get() as any)?.count ?? 0);
    const summaryBattleRows = db.prepare("SELECT source_path, season, context_json, locator_json FROM decisions WHERE outcome_status='terminal-observational-key-summary' GROUP BY source_path, json_extract(locator_json, '$.recordId')").all() as Array<{source_path: string; season: number; context_json: string; locator_json: string}>;
    const keySummaryKeys = new Set(summaryBattleRows.map(row => summaryBattleKey(row.season, JSON.parse(row.context_json), row.source_path, JSON.parse(row.locator_json).recordId)));
    const overlappingBattles = [...keySummaryKeys].filter(key => fullTraceKeys.has(key)).length, representedBattles = new Set([...fullTraceKeys, ...keySummaryKeys]).size;
    const summary: DecisionDossierSummary = {
      schemaVersion: 1, policyVersion: DOSSIER_POLICY_VERSION, generatedAt: new Date().toISOString(), leagueDirectory: league, database: databaseFile,
      seasons, sources: sourceRows.length, reusedSources, rebuiltSources, removedSources, decisions, battleDecisions: Number(counts.battle_decisions ?? 0), leagueDecisions: Number(counts.league_decisions ?? 0), managers: Number(counts.managers ?? 0), evidence, formalActivationAllowed,
      battleCoverage: {artifacts: discovery.battleArtifacts, fullTraceBattles: fullTraceKeys.size, currentEraFullTraceBattles, keySummaryBattles: keySummaryKeys.size, overlappingBattles, representedBattles, unrepresentedBattles: Math.max(0, discovery.battleArtifacts - representedBattles)},
      outcomeAuthority: "terminal-observational", anomalies, healthy: anomalies.length === 0,
      formalDecisionCoverageReady: currentEraFullTraceBattles > 0 && Number(counts.current_full_trace ?? 0) > 0 && Number(counts.formal_current_full_trace ?? 0) === Number(counts.current_full_trace ?? 0),
      inputSignature, currentPolicySha256, sourceAuditSignature, elapsedMs: Date.now() - started, peakRssBytes,
    };
    db.exec("PRAGMA optimize"); db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); if (rebuiltSources || removedSources) db.exec("VACUUM");
    summary.elapsedMs = Date.now() - started; summary.peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss); setMetadata(db, summary); db.close(); database = null;
    atomicJson(path.join(out, "summary.json"), summary); atomicJson(failureFile, {schemaVersion: 1, failures: anomalies});
    writeReport(path.join(out, "report.md"), summary);
    atomicJson(stateFile, {schemaVersion: 1, status: "complete", phase: "complete", startedAt: new Date(started).toISOString(), completedAt: new Date().toISOString(), elapsedMs: summary.elapsedMs, peakRssBytes});
    return summary;
  } catch (error) {
    try { database?.close(); } catch { /* Preserve the primary failure. */ }
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    const failure = {phase, message: error instanceof Error ? error.message : String(error)};
    atomicJson(failureFile, {schemaVersion: 1, failures: [failure]});
    atomicJson(stateFile, {schemaVersion: 1, status: "failed", phase, failedAt: new Date().toISOString(), peakRssBytes, failure});
    throw error;
  } finally { lock.release(); }
}

export function decisionDossierStatus(outputDirectory: string): Record<string, unknown> {
  const out = path.resolve(outputDirectory), summary = optionalJson<DecisionDossierSummary>(path.join(out, "summary.json"));
  if (!summary) return {available: false, outputDirectory: out};
  const dbFile = path.join(out, "decision-dossiers.sqlite");
  return {available: fs.existsSync(dbFile), ...summary, databaseBytes: fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0};
}

export function doctorDecisionDossiers(outputDirectory: string, options: {verifySources?: boolean} = {}): Record<string, unknown> {
  const out = path.resolve(outputDirectory), summary = optionalJson<DecisionDossierSummary>(path.join(out, "summary.json")), issues: Array<{severity: "error" | "warning"; code: string; message: string}> = [];
  const dbFile = path.join(out, "decision-dossiers.sqlite");
  if (!summary || !fs.existsSync(dbFile)) return {available: false, healthy: false, issues: [{severity: "error", code: "missing-store", message: "Decision dossier store is missing"}]};
  const db = openExisting(dbFile);
  const integrity = String((db.prepare("PRAGMA integrity_check").get() as any)?.integrity_check ?? "unknown");
  if (integrity !== "ok") issues.push({severity: "error", code: "sqlite-integrity", message: integrity});
  const policy = metadata(db, "policyVersion"), signature = metadata(db, "inputSignature");
  if (policy !== DOSSIER_POLICY_VERSION) issues.push({severity: "error", code: "policy-stale", message: `Stored policy ${policy ?? "missing"} differs from ${DOSSIER_POLICY_VERSION}`});
  if (signature !== summary.inputSignature) issues.push({severity: "error", code: "summary-signature", message: "Summary and SQLite input signatures differ"});
  const currentAuditSignature = readAuditSignature(summary.leagueDirectory);
  if (summary.sourceAuditSignature && currentAuditSignature !== summary.sourceAuditSignature) issues.push({severity: "error", code: "source-audit-stale", message: "League audit signature changed after dossier construction"});
  const currentPolicySha256 = buildEvidenceEpoch(AI_VERSION, "gen9ou").policySha256;
  if (summary.currentPolicySha256 !== currentPolicySha256) issues.push({severity: "error", code: "evidence-policy-stale", message: "Evidence-era policy changed after dossier construction"});
  if (!summary.formalDecisionCoverageReady) issues.push({severity: "warning", code: "formal-coverage-blocked", message: "Indexed decisions are historical or otherwise ineligible for formal activation"});
  let verifiedSources = 0;
  if (options.verifySources) for (const row of db.prepare("SELECT source_path, decision_sha256 FROM sources").all() as Array<{source_path: string; decision_sha256: string}>) {
    const file = path.join(summary.leagueDirectory, ...row.source_path.split("/"));
    if (!fs.existsSync(file) || fileSha256(file) !== row.decision_sha256) issues.push({severity: "error", code: "source-hash", message: `Source changed or is missing: ${row.source_path}`});
    verifiedSources += 1;
  }
  db.close();
  return {available: true, healthy: !issues.some(issue => issue.severity === "error"), integrity, verifiedSources, issues, summary: {sources: summary.sources, decisions: summary.decisions, managers: summary.managers, inputSignature: summary.inputSignature}};
}

export function showDecisionDossier(outputDirectory: string, dossierId: string, hydrate = false): Record<string, unknown> | null {
  const out = path.resolve(outputDirectory), summary = optionalJson<DecisionDossierSummary>(path.join(out, "summary.json"));
  if (!summary) return null;
  const db = openExisting(path.join(out, "decision-dossiers.sqlite"));
  const row = db.prepare("SELECT * FROM decisions WHERE dossier_id = ?").get(dossierId) as any;
  if (!row) { db.close(); return null; }
  const dossier = presentRow(row);
  if (!hydrate) { db.close(); return dossier; }
  const source = db.prepare("SELECT * FROM sources WHERE source_path = ?").get(row.source_path) as any; db.close();
  const file = path.join(summary.leagueDirectory, ...String(row.source_path).split("/"));
  if (fileSha256(file) !== source.decision_sha256) throw new Error(`Refusing hydration because source hash changed: ${row.source_path}`);
  const locator = JSON.parse(row.locator_json);
  const raw = readJson<any>(file);
  let record: unknown;
  if (locator.embeddedDecisionIndex !== undefined) record = raw.records.find((candidate: DecisionRecord) => candidate.id === locator.recordId && candidate.sequence === locator.sequence)?.context?.decisions?.[locator.embeddedDecisionIndex];
  else if (row.domain === "battle") record = (raw as AiDecisionTrace[]).find((trace, index) => trace.playerId === locator.playerId && (trace.decisionOrdinal ?? index + 1) === locator.decisionOrdinal);
  else record = raw.records.find((candidate: DecisionRecord) => candidate.id === locator.recordId && candidate.sequence === locator.sequence);
  if (!record) throw new Error(`Dossier locator no longer resolves: ${dossierId}`);
  return {...dossier, hydrated: true, raw: record};
}

export function listManagerDossiers(outputDirectory: string, manager: string, options: {season?: number; limit?: number} = {}): Record<string, unknown> {
  const db = openExisting(path.join(path.resolve(outputDirectory), "decision-dossiers.sqlite"));
  const limit = Math.max(1, Math.min(500, options.limit ?? 50));
  const rows = options.season === undefined
    ? db.prepare("SELECT * FROM decisions WHERE actor = ? ORDER BY season DESC, ordinal DESC LIMIT ?").all(manager, limit)
    : db.prepare("SELECT * FROM decisions WHERE actor = ? AND season = ? ORDER BY ordinal DESC LIMIT ?").all(manager, options.season, limit);
  const totals = db.prepare("SELECT COUNT(*) decisions, COUNT(DISTINCT season) seasons, SUM(CASE WHEN domain='battle' THEN 1 ELSE 0 END) battle_decisions FROM decisions WHERE actor = ?").get(manager) as any;
  db.close(); return {manager, totals, dossiers: (rows as any[]).map(presentRow)};
}

function openStore(file: string): DatabaseSync {
  let db = new DatabaseSync(file);
  const version = Number((db.prepare("PRAGMA user_version").get() as any)?.user_version ?? 0);
  if (version !== 0 && version !== STORE_SCHEMA_VERSION) { db.close(); fs.rmSync(file, {force: true}); db = new DatabaseSync(file); }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA temp_store=MEMORY;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sources (source_path TEXT PRIMARY KEY, domain TEXT NOT NULL, season INTEGER NOT NULL, fingerprint TEXT NOT NULL, decision_sha256 TEXT NOT NULL, companions_json TEXT NOT NULL, records INTEGER NOT NULL, evidence_compatibility TEXT NOT NULL, formal_activation_allowed INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS decisions (
      dossier_id TEXT PRIMARY KEY, source_path TEXT NOT NULL, source_record_key TEXT NOT NULL, domain TEXT NOT NULL, season INTEGER NOT NULL, stage TEXT NOT NULL, actor TEXT NOT NULL, ordinal INTEGER NOT NULL, turn INTEGER, side TEXT,
      selected TEXT, runner_up TEXT, selected_score REAL, runner_up_score REAL, rational_score REAL, style_score REAL, margin REAL, confidence REAL, alternatives INTEGER NOT NULL, reasonable_alternatives INTEGER NOT NULL,
      context_json TEXT NOT NULL, rationale_json TEXT NOT NULL, outcome_json TEXT NOT NULL, outcome_status TEXT NOT NULL, flags_json TEXT NOT NULL, evidence_compatibility TEXT NOT NULL, formal_activation_allowed INTEGER NOT NULL, locator_json TEXT NOT NULL, fingerprint TEXT NOT NULL,
      FOREIGN KEY(source_path) REFERENCES sources(source_path) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS decisions_actor_season ON decisions(actor, season);
    CREATE INDEX IF NOT EXISTS decisions_season_stage ON decisions(season, domain, stage);
    CREATE INDEX IF NOT EXISTS decisions_source ON decisions(source_path);
    PRAGMA user_version=${STORE_SCHEMA_VERSION};`);
  return db;
}

function openExisting(file: string): DatabaseSync { if (!fs.existsSync(file)) throw new Error(`Decision dossier database is missing: ${file}`); return new DatabaseSync(file, {readOnly: true}); }

function discoverSources(league: string, firstSeason?: number, lastSeason?: number): {sources: SourceDescriptor[]; battleArtifacts: number} {
  const result: SourceDescriptor[] = []; let battleArtifacts = 0;
  for (const entry of fs.readdirSync(league, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const match = entry.isDirectory() ? entry.name.match(/^season-(\d+)$/) : null;
    if (!match) continue; const season = Number(match[1]);
    if (firstSeason !== undefined && season < firstSeason || lastSeason !== undefined && season > lastSeason) continue;
    const seasonDir = path.join(league, entry.name), ledger = path.join(seasonDir, "decision-ledger.json");
    if (fs.existsSync(ledger)) result.push(descriptor(league, ledger, "league", season));
    walk(seasonDir, file => {
      if (/^end\.json(?:\.gz)?$/.test(path.basename(file)) && file.includes(`${path.sep}battles${path.sep}`)) battleArtifacts += 1;
      if (!/^ai-decisions\.json(?:\.gz)?$/.test(path.basename(file))) return;
      const directory = path.dirname(file), replayPath = existing(directory, ["replay-input.json", "replay-input.json.gz"]), endPath = existing(directory, ["end.json", "end.json.gz"]);
      if (replayPath && endPath) result.push({...descriptor(league, file, "battle", season), replayPath, endPath});
    });
  }
  return {sources: result.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath)), battleArtifacts};
}

function descriptor(league: string, absolutePath: string, domain: "battle" | "league", season: number): SourceDescriptor { return {sourcePath: relative(league, absolutePath), absolutePath, domain, season}; }
function fingerprintSource(source: SourceDescriptor): SourceFingerprint {
  const decisionSha256 = fileSha256(source.absolutePath), companions: Record<string, string> = {};
  if (source.replayPath) companions.replay = fileSha256(source.replayPath);
  if (source.endPath) companions.end = fileSha256(source.endPath);
  return {decisionSha256, companions, fingerprint: sha256({policy: DOSSIER_POLICY_VERSION, evidencePolicySha256: buildEvidenceEpoch(AI_VERSION, "gen9ou").policySha256, decisionSha256, companions})};
}

function indexBattleSource(db: DatabaseSync, source: SourceDescriptor, hashes: SourceFingerprint, anomalies: DecisionDossierSummary["anomalies"]): {records: number; compatibility: string; formalAllowed: boolean} {
  const traces = readJson<AiDecisionTrace[]>(source.absolutePath), end = readJson<any>(source.endPath!), evidence = classifyReplayEvidence(source.replayPath!);
  if (!Array.isArray(traces)) throw new Error(`Battle decision source is not an array: ${source.sourcePath}`);
  if (Number(end.aiDecisionCount) !== traces.length) anomalies.push({source: source.sourcePath, code: "decision-count", message: `end.json declares ${end.aiDecisionCount}; source contains ${traces.length}`});
  const ordinals = new Set<number>();
  for (let index = 0; index < traces.length; index += 1) {
    const trace = traces[index], ordinal = trace.decisionOrdinal ?? index + 1;
    if (ordinals.has(ordinal)) anomalies.push({source: source.sourcePath, code: "duplicate-ordinal", message: `Duplicate decision ordinal ${ordinal}`}); ordinals.add(ordinal);
    const row = battleRow(source, hashes, trace, index, end, evidence.compatibility, evidence.formalActivationAllowed);
    validateRow(row, anomalies); insertDecision(db, row);
  }
  return {records: traces.length, compatibility: evidence.compatibility, formalAllowed: evidence.formalActivationAllowed};
}

function battleRow(source: SourceDescriptor, hashes: SourceFingerprint, trace: AiDecisionTrace, index: number, end: any, compatibility: string, formalAllowed: boolean): DossierRow {
  const ordinal = trace.decisionOrdinal ?? index + 1, white = trace.whiteBoxShadow?.trace?.candidates ?? [];
  const selectedWhite = white.find(candidate => candidate.id === trace.selected), rankedWhite = white.filter(candidate => candidate.eligible && candidate.reasonable).sort((a, b) => whiteScore(b) - whiteScore(a));
  const tactical = [...trace.candidates].sort((a, b) => b.score - a.score), selectedTactical = tactical.find(candidate => candidate.choice === trace.selected) ?? null;
  const runnerWhite = rankedWhite.find(candidate => candidate.id !== trace.selected) ?? null, runnerTactical = tactical.find(candidate => candidate.choice !== trace.selected) ?? null;
  const selectedScore = finite(selectedWhite?.finalScore) ?? finite(selectedTactical?.score), runnerUpScore = finite(runnerWhite?.finalScore) ?? finite(runnerTactical?.score), runnerUp = runnerWhite?.id ?? runnerTactical?.choice ?? null;
  const flags: string[] = [trace.selected.startsWith("switch ") ? "switch" : trace.selected.startsWith("move ") ? "move" : "other"];
  const margin = selectedScore !== null && runnerUpScore !== null ? selectedScore - runnerUpScore : null;
  if (margin !== null && Math.abs(margin) <= 12) flags.push("close-call");
  if (trace.whiteBoxShadow && !trace.whiteBoxShadow.comparison.agrees) flags.push("whitebox-disagreement");
  if (trace.intervention?.applied) flags.push("intervention"); if (trace.assistPolicy?.applied) flags.push("assist-applied");
  if ((selectedTactical?.downside ?? 0) < -40 || (selectedTactical?.worst ?? 0) < -80) flags.push("high-downside");
  if (/\bterastallize\b/.test(trace.selected)) flags.push("historical-tera-selection");
  const ownTeam = trace.playerId === "p1" ? end.p1 : end.p2, opponentTeam = trace.playerId === "p1" ? end.p2 : end.p1;
  const ownWon = end.winner === ownTeam;
  const context = {ownSpecies: trace.battleContext?.ownSpecies ?? null, opponentSpecies: trace.battleContext?.opponentSpecies ?? null, target: trace.actionTargets?.[trace.selected] ?? null, position: trace.positionSnapshot ?? null, opponentModel: {confidence: trace.opponentModel?.confidence ?? null, switchRate: trace.opponentModel?.switchRate ?? null, activeMoveSamples: trace.opponentModel?.activeMoveSamples ?? 0, fallbackMoveSamples: trace.opponentModel?.fallbackMoveSamples ?? 0}};
  const rationale = {contributions: (selectedWhite?.contributions ?? []).map(item => ({id: item.id, source: item.source, value: item.value})), incumbent: trace.incumbentSelected ?? trace.policyIncumbentSelected ?? null, whiteBoxSelected: trace.whiteBoxShadow?.trace.selected ?? null};
  const outcome = {authority: "terminal-observational", winner: end.winner ?? null, ownResult: end.ended ? ownWon ? "win" : "loss" : "unfinished", turns: end.turns ?? null, timeout: Boolean(end.timeout), adjudication: end.adjudication ?? null};
  return makeRow(source, hashes, {
    sourceRecordKey: `${trace.playerId}:${ordinal}`, domain: "battle", stage: "battle", actor: trace.personalityId, ordinal, turn: trace.turn, side: trace.playerId, selected: trace.selected, runnerUp,
    selectedScore, runnerUpScore, rationalScore: finite(selectedWhite?.rationalScore) ?? finite(selectedTactical?.baseScore), styleScore: finite(selectedWhite?.appliedStyleScore) ?? finite(selectedTactical?.personalityAdjustment), margin,
    confidence: finite(trace.opponentModel?.confidence), alternatives: white.length || tactical.length, reasonableAlternatives: white.filter(candidate => candidate.eligible && candidate.reasonable).length || tactical.length,
    contextJson: compact(context), rationaleJson: compact(rationale), outcomeJson: compact(outcome), outcomeStatus: "terminal-observational", flagsJson: compact(flags), evidenceCompatibility: compatibility, formalActivationAllowed: formalAllowed ? 1 : 0, locatorJson: compact({playerId: trace.playerId, decisionOrdinal: ordinal}),
  });
}

function indexLeagueSource(db: DatabaseSync, source: SourceDescriptor, hashes: SourceFingerprint, anomalies: DecisionDossierSummary["anomalies"]): {records: number; compatibility: string; formalAllowed: boolean} {
  const envelope = readJson<{records: DecisionRecord[]}>(source.absolutePath), records = envelope.records;
  if (!Array.isArray(records)) throw new Error(`Decision ledger has no records array: ${source.sourcePath}`);
  const ids = new Set<string>();
  let inserted = 0;
  for (const record of records) {
    if (ids.has(record.id)) anomalies.push({source: source.sourcePath, code: "duplicate-ledger-id", message: `Duplicate ledger id ${record.id}`}); ids.add(record.id);
    const embedded = record.stage === "battle" && Array.isArray((record.context as any)?.decisions) ? (record.context as any).decisions as any[] : null;
    if (embedded) {
      for (let index = 0; index < embedded.length; index += 1) {
        const decision = embedded[index], selectedScore = finite(decision.selectedScore), runnerScore = finite(decision.runnerUpScore), actor = String(decision.personalityId ?? record.actor), flags = ["key-summary", String(decision.kind ?? "other")];
        if (/\bterastallize\b/.test(String(decision.selected ?? ""))) flags.push("historical-tera-selection");
        const parentContext = {...record.context} as any; delete parentContext.decisions;
        const ownResult = record.outcome?.winner ? record.outcome.winner === actor ? "win" : "loss" : "unknown";
        const row = makeRow(source, hashes, {sourceRecordKey: `${record.id}:embedded:${index}`, domain: "battle", stage: "battle", actor, ordinal: record.sequence * 100 + index + 1, turn: Number.isFinite(decision.turn) ? decision.turn : null, side: decision.playerId ?? null, selected: decision.selected ?? null, runnerUp: decision.runnerUp ?? null, selectedScore, runnerUpScore: runnerScore, rationalScore: selectedScore, styleScore: null, margin: finite(decision.margin) ?? (selectedScore !== null && runnerScore !== null ? selectedScore - runnerScore : null), confidence: finite(record.confidence), alternatives: decision.runnerUp ? 2 : 1, reasonableAlternatives: decision.runnerUp ? 2 : 1, contextJson: compact({...parentContext, summaryKind: decision.kind ?? null}), rationaleJson: compact({reasons: decision.rationale ?? [], source: "season-key-decision-summary"}), outcomeJson: compact({authority: "terminal-observational", winner: record.outcome?.winner ?? null, ownResult, turns: record.outcome?.turns ?? null}), outcomeStatus: "terminal-observational-key-summary", flagsJson: compact(flags), evidenceCompatibility: "historical-only", formalActivationAllowed: 0, locatorJson: compact({recordId: record.id, sequence: record.sequence, embeddedDecisionIndex: index})});
        validateRow(row, anomalies); insertDecision(db, row); inserted += 1;
      }
      continue;
    }
    const alternatives = [...(record.alternatives ?? [])].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity)), runner = alternatives.find(option => option.option !== selectedText(record.selected)) ?? null;
    const selectedScore = finite(record.expectedValue), runnerScore = finite(runner?.score), outcomeStatus = record.outcome ? "ledger-recorded-observational" : "unresolved";
    const row = makeRow(source, hashes, {sourceRecordKey: `${record.id}:${record.sequence}`, domain: "league", stage: record.stage, actor: record.actor, ordinal: record.sequence, turn: null, side: null, selected: selectedText(record.selected), runnerUp: runner?.option ?? null, selectedScore, runnerUpScore: runnerScore, rationalScore: selectedScore, styleScore: null, margin: selectedScore !== null && runnerScore !== null ? selectedScore - runnerScore : null, confidence: finite(record.confidence), alternatives: alternatives.length, reasonableAlternatives: alternatives.filter(option => !(option.rejectedBecause?.length)).length, contextJson: compact(summarizeContext(record.context ?? {})), rationaleJson: compact({decision: record.decision, reasons: (record.rationale ?? []).slice(0, 12), links: (record.links ?? []).slice(0, 12)}), outcomeJson: compact({authority: "ledger-observational", value: summarizeContext(record.outcome ?? null)}), outcomeStatus, flagsJson: compact(record.outcome ? [] : ["unresolved-outcome"]), evidenceCompatibility: "historical-only", formalActivationAllowed: 0, locatorJson: compact({recordId: record.id, sequence: record.sequence})});
    validateRow(row, anomalies); insertDecision(db, row); inserted += 1;
  }
  return {records: inserted, compatibility: "historical-only", formalAllowed: false};
}

function makeRow(source: SourceDescriptor, hashes: SourceFingerprint, value: Omit<DossierRow, "dossierId" | "sourcePath" | "season" | "fingerprint">): DossierRow {
  const dossierId = `dd-${sha256({source: source.sourcePath, sourceFingerprint: hashes.fingerprint, key: value.sourceRecordKey}).slice(0, 24)}`;
  const fingerprint = sha256({...value, sourcePath: source.sourcePath, season: source.season});
  return {dossierId, sourcePath: source.sourcePath, season: source.season, fingerprint, ...value};
}

function insertDecision(db: DatabaseSync, row: DossierRow): void {
  db.prepare(`INSERT INTO decisions VALUES (${Array(29).fill("?").join(",")})`).run(row.dossierId, row.sourcePath, row.sourceRecordKey, row.domain, row.season, row.stage, row.actor, row.ordinal, row.turn, row.side, row.selected, row.runnerUp, row.selectedScore, row.runnerUpScore, row.rationalScore, row.styleScore, row.margin, row.confidence, row.alternatives, row.reasonableAlternatives, row.contextJson, row.rationaleJson, row.outcomeJson, row.outcomeStatus, row.flagsJson, row.evidenceCompatibility, row.formalActivationAllowed, row.locatorJson, row.fingerprint);
}

function validateRow(row: DossierRow, anomalies: DecisionDossierSummary["anomalies"]): void {
  if (!row.actor?.trim()) anomalies.push({source: row.sourcePath, code: "missing-actor", message: `Missing actor at ${row.sourceRecordKey}`});
  if (!row.sourceRecordKey || !row.locatorJson) anomalies.push({source: row.sourcePath, code: "missing-locator", message: `Missing locator at ${row.sourceRecordKey}`});
  for (const [name, value] of Object.entries({selectedScore: row.selectedScore, runnerUpScore: row.runnerUpScore, rationalScore: row.rationalScore, styleScore: row.styleScore, margin: row.margin, confidence: row.confidence})) if (value !== null && !Number.isFinite(value)) anomalies.push({source: row.sourcePath, code: "non-finite-score", message: `${name} is non-finite at ${row.sourceRecordKey}`});
  if (row.domain === "battle" && row.evidenceCompatibility === "exact-compatible" && /\b(?:terastallize|dynamax)\b/.test(row.selected ?? "")) anomalies.push({source: row.sourcePath, code: "forbidden-current-mechanic", message: `Current-era decision selects a disabled mechanic at ${row.sourceRecordKey}`});
}

function auditStore(db: DatabaseSync): DecisionDossierSummary["anomalies"] {
  const result: DecisionDossierSummary["anomalies"] = [];
  const orphan = Number((db.prepare("SELECT COUNT(*) count FROM decisions d LEFT JOIN sources s ON s.source_path=d.source_path WHERE s.source_path IS NULL").get() as any).count);
  if (orphan) result.push({source: "database", code: "orphan-decisions", message: `${orphan} decision rows have no source`});
  const duplicate = Number((db.prepare("SELECT COUNT(*) count FROM (SELECT dossier_id FROM decisions GROUP BY dossier_id HAVING COUNT(*) > 1)").get() as any).count);
  if (duplicate) result.push({source: "database", code: "duplicate-dossiers", message: `${duplicate} dossier ids are duplicated`});
  return result;
}

function setMetadata(db: DatabaseSync, summary: DecisionDossierSummary): void {
  const statement = db.prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)");
  for (const [key, value] of Object.entries({policyVersion: summary.policyVersion, inputSignature: summary.inputSignature, currentPolicySha256: summary.currentPolicySha256, sourceAuditSignature: summary.sourceAuditSignature ?? "", generatedAt: summary.generatedAt, leagueDirectory: summary.leagueDirectory})) statement.run(key, String(value));
}
function metadata(db: DatabaseSync, key: string): string | null { return ((db.prepare("SELECT value FROM metadata WHERE key=?").get(key) as any)?.value as string | undefined) ?? null; }
function presentRow(row: any): Record<string, unknown> { return {id: row.dossier_id, domain: row.domain, season: row.season, stage: row.stage, actor: row.actor, ordinal: row.ordinal, turn: row.turn, side: row.side, selected: row.selected, runnerUp: row.runner_up, scores: {selected: row.selected_score, runnerUp: row.runner_up_score, rational: row.rational_score, style: row.style_score, margin: row.margin}, confidence: row.confidence, alternatives: row.alternatives, reasonableAlternatives: row.reasonable_alternatives, context: JSON.parse(row.context_json), rationale: JSON.parse(row.rationale_json), outcome: JSON.parse(row.outcome_json), outcomeStatus: row.outcome_status, flags: JSON.parse(row.flags_json), evidence: {compatibility: row.evidence_compatibility, formalActivationAllowed: Boolean(row.formal_activation_allowed)}, source: {path: row.source_path, recordKey: row.source_record_key, locator: JSON.parse(row.locator_json), fingerprint: row.fingerprint}}; }

function readAuditSignature(league: string): string | null { const summary = optionalJson<any>(path.join(league, "audit-summary.json")); return typeof summary?.inputSignature === "string" ? summary.inputSignature : null; }
function selectedText(value: string | string[] | null): string | null { return Array.isArray(value) ? value.join(" | ") : value; }
function summarizeContext(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length <= 240 ? value : `${value.slice(0, 237)}...`;
  if (Array.isArray(value)) return {count: value.length, sample: value.slice(0, 3).map(item => summarizeContext(item, depth + 1))};
  if (typeof value !== "object") return String(value);
  if (depth >= 3) return {keys: Object.keys(value as Record<string, unknown>).length};
  const entries = Object.entries(value as Record<string, unknown>), result: Record<string, unknown> = {};
  for (const [key, item] of entries.slice(0, 24)) result[key] = summarizeContext(item, depth + 1);
  if (entries.length > 24) result._omittedKeys = entries.length - 24;
  return result;
}
function traceBattleKey(sourcePath: string): string { const match = sourcePath.match(/^(season-\d+)\/battles\/([^/]+)\/([^/]+)\/game-(\d+)\//); return match ? `${match[1]}:${match[2]}:${match[3]}:${Number(match[4])}` : `trace:${sourcePath}`; }
function summaryBattleKey(season: number, context: any, sourcePath: string, recordId: string): string { return context?.seriesId && context?.orientation && Number.isFinite(Number(context?.pair)) ? `season-${String(season).padStart(2, "0")}:${context.seriesId}:${context.orientation}:${Number(context.pair)}` : `summary:${sourcePath}:${recordId}`; }
function whiteScore(value: {finalScore: number | null; rationalScore: number | null}): number { return finite(value.finalScore) ?? finite(value.rationalScore) ?? -Infinity; }
function finite(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function compact(value: unknown): string { return canonicalJson(value); }
function fileSha256(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function readJson<T>(file: string): T { const raw = fs.readFileSync(file), text = file.endsWith(".gz") ? zlib.gunzipSync(raw).toString("utf8") : raw.toString("utf8"); return JSON.parse(text) as T; }
function optionalJson<T>(file: string): T | null { try { return readJson<T>(file); } catch { return null; } }
function existing(directory: string, names: string[]): string | null { for (const name of names) { const file = path.join(directory, name); if (fs.existsSync(file)) return file; } return null; }
function relative(root: string, file: string): string { return path.relative(root, file).replace(/\\/g, "/"); }
function walk(directory: string, visit: (file: string) => void): void { for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) { const target = path.join(directory, entry.name); if (entry.isDirectory()) walk(target, visit); else visit(target); } }
function updateState(file: string, phase: string, peakRssBytes: number): void { atomicJson(file, {schemaVersion: 1, status: "running", phase, updatedAt: new Date().toISOString(), peakRssBytes: Math.max(peakRssBytes, process.memoryUsage().rss)}); }
function atomicJson(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
function writeReport(file: string, summary: DecisionDossierSummary): void { fs.writeFileSync(file, [`# Decision Dossiers`, "", `- Seasons: ${summary.seasons.join(", ")}`, `- Sources: ${summary.sources} (${summary.reusedSources} reused, ${summary.rebuiltSources} rebuilt)`, `- Decisions: ${summary.decisions} (${summary.battleDecisions} battle, ${summary.leagueDecisions} league)`, `- Managers: ${summary.managers}`, `- Battle artifacts: ${summary.battleCoverage.artifacts}`, `- Full decision traces: ${summary.battleCoverage.fullTraceBattles}`, `- Key-decision summaries: ${summary.battleCoverage.keySummaryBattles}`, `- Full/summary overlap: ${summary.battleCoverage.overlappingBattles}`, `- Represented battles: ${summary.battleCoverage.representedBattles}`, `- Unrepresented battles: ${summary.battleCoverage.unrepresentedBattles}`, `- Historical-only decisions: ${summary.evidence["historical-only"] ?? 0}`, `- Formal activation eligible: ${summary.formalActivationAllowed}`, `- Outcome authority: ${summary.outcomeAuthority}`, `- Anomalies: ${summary.anomalies.length}`, `- Elapsed: ${summary.elapsedMs} ms`, `- Peak RSS: ${Math.round(summary.peakRssBytes / 1048576)} MB`, "", "The index is derived and rebuildable. Raw decision traces and ledgers remain canonical evidence.", ""].join("\n"), "utf8"); }
