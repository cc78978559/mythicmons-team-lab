import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {cloneManagerProfile, type ManagerProfile} from "../draft/managerProfiles";
import type {LineageIdentity} from "../draft/naturalEvolution";

interface SeasonRecord {season: number; rank: number; points: number; champion: boolean}
interface MajorManager {
  id: string; name: string; baseProfile: ManagerProfile; currentProfile: ManagerProfile;
  contracts: unknown[]; cash: number; titles: number; totalPoints: number; seasons: SeasonRecord[];
  lineage: LineageIdentity; lineageHistory: LineageIdentity[];
  pendingProfile?: ManagerProfile; pendingLineage?: LineageIdentity;
  deadMoneyCurrent?: number; deadMoneyNext?: number;
}
interface MajorState {
  version: number; seed: string; completedSeason: number; settings: Record<string, unknown>;
  managers: MajorManager[]; market: Record<string, unknown>; assets: Record<string, {ownerId: string | null}>;
  fingerprint: Record<string, string>; registry?: {hash?: string; revision?: string; snapshot?: string};
  decisionRecords: Array<Record<string, unknown>>; evolutionArchive?: unknown[];
  punctuatedEvolution?: Record<string, Record<string, unknown>>; leaguePool?: number; moneySupply?: number;
}
interface PromotionCandidate {
  slotId: string; childId: string; childName: string; parentId: string; parentName: string;
  rightsHolderId: string; optionYearsRemaining: number; currentProfile: ManagerProfile;
  lineage: LineageIdentity; lineageHistory: LineageIdentity[]; career: SeasonRecord[];
}
interface PromotionPayload {schemaVersion: 1; source: Record<string, unknown>; candidates: PromotionCandidate[]}
interface AuditSummary {completedSeasons: number; fatalCount: number; warningCount: number; metrics: {moneyConserved: boolean; invalidLineups: number; missingBattleEvidence: number; unendedBattles: number; protocolErrors: number}}

const args = process.argv.slice(2);
const root = process.cwd();
if (args.includes("--rollback")) rollback();
else applyPromotion();

function applyPromotion(): void {
  const majorRoot = path.resolve(requiredOption("--major-source"));
  const statePath = path.join(majorRoot, "dynasty-state.json");
  if (fs.existsSync(path.join(majorRoot, ".run.lock"))) throw new Error(`League is currently running: ${majorRoot}`);
  const beforeBytes = fs.readFileSync(statePath), state = JSON.parse(beforeBytes.toString("utf8")) as MajorState;
  if (state.version !== 12) throw new Error(`In-place promotion requires a V12 dynasty, received V${state.version}`);
  validateAudit(majorRoot, state.completedSeason);

  const loaded = loadPromotionPackage(path.resolve(requiredOption("--promotion")));
  const autoBottom = optionalInteger("--auto-bottom", 0, 0, state.managers.length);
  const explicit = csvOption("--replacements");
  if (autoBottom && explicit.length) throw new Error("Use either --auto-bottom or --replacements, not both");
  const replacements = autoBottom ? bottomManagers(state, autoBottom) : explicit.length ? explicit : [requiredOption("--replace")];
  const requestedIndices = csvIntegerOption("--candidate-indices");
  const candidateIndices = requestedIndices.length ? requestedIndices.map(value => value - 1) : replacements.map((_, index) => index);
  if (candidateIndices.length !== replacements.length) throw new Error("--candidate-indices must contain one index per replacement");
  if (new Set(replacements).size !== replacements.length || new Set(candidateIndices).size !== candidateIndices.length) throw new Error("Vacancies and candidates must be unique");
  const reason = option("--reason", autoBottom ? "relegation" : "");
  if (!["retirement", "relegation"].includes(reason)) throw new Error("--reason must be retirement or relegation");

  const assignments = replacements.map((replacementId, index) => {
    const outgoing = state.managers.find(manager => manager.id === replacementId);
    const candidate = loaded.payload.candidates[candidateIndices[index]];
    if (!outgoing) throw new Error(`Major league has no vacancy target ${replacementId}`);
    if (!candidate) throw new Error(`Promotion package has no candidate ${candidateIndices[index] + 1}`);
    if (candidate.optionYearsRemaining < 0) throw new Error(`Candidate ${candidate.childName} has invalid option years`);
    return {replacementId, candidateIndex: candidateIndices[index], outgoing, candidate};
  });

  const transactionId = option("--transaction-id", `after-s${String(state.completedSeason).padStart(2, "0")}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(transactionId)) throw new Error("Invalid --transaction-id");
  const transactionDir = path.join(majorRoot, "promotion-transactions", transactionId);
  if (fs.existsSync(transactionDir)) throw new Error(`Promotion transaction already exists: ${transactionDir}`);
  fs.mkdirSync(transactionDir, {recursive: true});

  const beforeHash = hash(beforeBytes), backup = zlib.gzipSync(beforeBytes, {level: 9});
  fs.writeFileSync(path.join(transactionDir, "dynasty-state.before.json.gz"), backup);
  fs.copyFileSync(path.join(majorRoot, "audit-summary.json"), path.join(transactionDir, "audit-summary.before.json"));

  const rows = assignments.map(({outgoing, candidate, candidateIndex}) => ({
    vacancy: outgoing.id, candidateIndex: candidateIndex + 1,
    outgoing: {id: outgoing.id, name: outgoing.name, lineage: outgoing.lineage, titles: outgoing.titles, totalPoints: outgoing.totalPoints, seasons: outgoing.seasons.length},
    incoming: {childId: candidate.childId, name: candidate.childName, lineage: candidate.lineage, parentId: candidate.parentId, parentName: candidate.parentName, rightsHolderId: candidate.rightsHolderId, optionYearsRemaining: candidate.optionYearsRemaining, developmentCareer: candidate.career},
    preservedClubState: {cash: outgoing.cash, contracts: outgoing.contracts.length, deadMoneyCurrent: outgoing.deadMoneyCurrent ?? 0, deadMoneyNext: outgoing.deadMoneyNext ?? 0},
  }));
  const manifestPath = path.join(transactionDir, "transaction.json");
  const baseManifest = {
    schemaVersion: 1, transactionId, status: "prepared", atomic: true, inPlace: true, reason,
    selectionPolicy: autoBottom ? {type: "automatic-bottom-standings", count: autoBottom} : {type: "explicit-vacancies"},
    boundary: {completedSeason: state.completedSeason, seed: state.seed, version: state.version},
    source: {root: majorRoot, beforeSha256: beforeHash, backup: "dynasty-state.before.json.gz", backupSha256: hash(backup), audit: "audit-summary.before.json"},
    promotion: {manifest: path.resolve(requiredOption("--promotion")), payloadSha256: loaded.sha256},
    transactions: rows,
    preserves: ["season numbering", "all season evidence", "league assets", "market history", "contracts", "cash", "dead money", "money supply", "non-replaced managers", "quality-diversity archive"],
    resets: ["incoming major-league titles", "incoming major-league points", "incoming major-league season record", "vacancy punctuated-evolution pressure", "pending vacancy mutation"],
  };
  writeJson(manifestPath, baseManifest);

  const replacementIds = new Set(replacements);
  state.managers = state.managers.map(manager => {
    const assignment = assignments.find(value => value.replacementId === manager.id);
    if (!assignment) return manager;
    const profile = cloneManagerProfile(assignment.candidate.currentProfile);
    profile.id = manager.id; profile.name = assignment.candidate.childName; profile.tactics.id = manager.id;
    return {
      id: manager.id, name: assignment.candidate.childName,
      baseProfile: cloneManagerProfile(profile), currentProfile: profile,
      contracts: manager.contracts, cash: manager.cash, titles: 0, totalPoints: 0, seasons: [],
      lineage: assignment.candidate.lineage, lineageHistory: assignment.candidate.lineageHistory,
      deadMoneyCurrent: manager.deadMoneyCurrent ?? 0, deadMoneyNext: manager.deadMoneyNext ?? 0,
    };
  });
  for (const id of replacementIds) if (state.punctuatedEvolution) state.punctuatedEvolution[id] = {
    managerId: id, phase: "stable", pressure: 0, pressureReservoir: 0, stableSeasons: 0,
    lastBurstSeason: null, cooldownUntilSeason: 0, burstCount: 0,
    lastTriggerReasons: [`in-place-promotion-after-season:${state.completedSeason}`],
  };
  const sequence = state.decisionRecords.length + 1;
  state.decisionRecords.push({
    id: `decision-${String(sequence).padStart(5, "0")}`, sequence, stage: "review", actor: "system",
    decision: `第${state.completedSeason}季原位升降级`, selected: assignments.map(value => `${value.outgoing.name} -> ${value.candidate.childName}`),
    context: {transactionId, reason, vacancies: replacements, promotionPackageSha256: loaded.sha256, continuity: "same-dynasty"},
    alternatives: [{option: "开启新竞技时代", rejectedBecause: ["会重置联赛资产与连续赛季编号"]}],
    rationale: ["保留俱乐部资产和经济责任", "替换经理人格与个人职业记录", "以单一原子事务执行全部席位"], links: [path.relative(majorRoot, manifestPath).replace(/\\/g, "/")],
  });

  const afterBytes = Buffer.from(`${JSON.stringify(state, null, 2)}\n`, "utf8"), afterHash = hash(afterBytes);
  atomicWrite(statePath, afterBytes);
  writeJson(manifestPath, {...baseManifest, status: "committed", committedAt: new Date().toISOString(), result: {afterSha256: afterHash, completedSeason: state.completedSeason, managers: state.managers.length}});
  console.log(JSON.stringify({transaction: manifestPath, status: "committed", completedSeason: state.completedSeason, vacancies: rows.map(row => ({id: row.vacancy, outgoing: row.outgoing.name, incoming: row.incoming.name})), beforeSha256: beforeHash, afterSha256: afterHash}, null, 2));
}

function rollback(): never {
  const manifestPath = path.resolve(requiredOption("--rollback"));
  const manifest = read<any>(manifestPath);
  if (manifest.schemaVersion !== 1 || manifest.status !== "committed" || !manifest.source?.root || !manifest.result?.afterSha256) throw new Error("Rollback requires a committed in-place promotion transaction");
  const majorRoot = path.resolve(manifest.source.root), statePath = path.join(majorRoot, "dynasty-state.json");
  if (fs.existsSync(path.join(majorRoot, ".run.lock"))) throw new Error(`League is currently running: ${majorRoot}`);
  const current = fs.readFileSync(statePath);
  if (hash(current) !== manifest.result.afterSha256) throw new Error("Current dynasty state has changed since promotion; refusing destructive rollback");
  const backupPath = path.resolve(path.dirname(manifestPath), manifest.source.backup), compressed = fs.readFileSync(backupPath);
  if (hash(compressed) !== manifest.source.backupSha256) throw new Error("Rollback archive hash mismatch");
  const restored = zlib.gunzipSync(compressed);
  if (hash(restored) !== manifest.source.beforeSha256) throw new Error("Rollback state hash mismatch");
  atomicWrite(statePath, restored);
  writeJson(manifestPath, {...manifest, status: "rolled-back", rolledBackAt: new Date().toISOString(), rollback: {restoredSha256: hash(restored)}});
  console.log(JSON.stringify({transaction: manifestPath, status: "rolled-back", restoredSha256: hash(restored)}, null, 2));
  process.exit(0);
}

function validateAudit(majorRoot: string, completedSeason: number): void {
  const audit = read<AuditSummary>(path.join(majorRoot, "audit-summary.json"));
  const invalid = audit.completedSeasons !== completedSeason || audit.fatalCount !== 0 || audit.warningCount !== 0 || !audit.metrics?.moneyConserved || audit.metrics.invalidLineups !== 0 || audit.metrics.missingBattleEvidence !== 0 || audit.metrics.unendedBattles !== 0 || audit.metrics.protocolErrors !== 0;
  if (invalid) throw new Error("Latest major-league audit is not clean or does not match the season boundary");
}
function bottomManagers(state: MajorState, count: number): string[] {
  return state.managers.map(manager => ({manager, latest: manager.seasons.at(-1)})).map(entry => {
    if (!entry.latest || entry.latest.season !== state.completedSeason) throw new Error(`Manager ${entry.manager.id} has no result at completed season ${state.completedSeason}`);
    return entry;
  }).sort((left, right) => right.latest!.rank - left.latest!.rank || left.manager.id.localeCompare(right.manager.id)).slice(0, count).map(entry => entry.manager.id);
}
function loadPromotionPackage(manifestPath: string): {payload: PromotionPayload; sha256: string} {
  const manifest = read<{archive: string; sha256: string; candidates: number}>(manifestPath);
  const bytes = zlib.gunzipSync(fs.readFileSync(path.resolve(path.dirname(manifestPath), manifest.archive)));
  const sha256 = hash(bytes);
  if (sha256 !== manifest.sha256) throw new Error(`Promotion package hash mismatch: ${sha256} != ${manifest.sha256}`);
  const payload = JSON.parse(bytes.toString("utf8")) as PromotionPayload;
  if (payload.schemaVersion !== 1 || !Array.isArray(payload.candidates) || payload.candidates.length !== manifest.candidates) throw new Error("Invalid promotion package");
  return {payload, sha256};
}
function atomicWrite(file: string, bytes: Buffer): void { const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`; fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, file); }
function hash(value: Buffer): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function writeJson(file: string, value: unknown): void { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function requiredOption(name: string): string { const value = option(name, ""); if (!value) throw new Error(`${name} is required`); return value; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function csvOption(name: string): string[] { const value = option(name, ""); return value ? value.split(",").map(entry => entry.trim()).filter(Boolean) : []; }
function csvIntegerOption(name: string): number[] { return csvOption(name).map(entry => { const value = Number(entry); if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error(`${name} values must be 1..100`); return value; }); }
function optionalInteger(name: string, fallback: number, min: number, max: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
