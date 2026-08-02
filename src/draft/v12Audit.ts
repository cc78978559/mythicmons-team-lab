import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {Dex} from "pokemon-showdown";
import {countProgramNodes, strategyProgramBehavior, strategyProgramHash, validateStrategyProgram, type StrategyProgram} from "./strategyProgram";
import {loadRegistrySnapshot} from "./registrySnapshot";
import type {ProgramOpportunitySnapshot} from "./strategyProgramOpportunity";
import {loadDynastyStateCore, verifyDynastyStateStorage, type DynastyStateStorage} from "./dynastyStateStore";
import {verifyHistoricalDynastyCheckpoint} from "./historicalRuntimeCheckpoint";

export interface V12AuditIssue {severity: "fatal" | "warning"; code: string; message: string; season?: number; managerId?: string}
export interface V12AuditSummary {
  schemaVersion: 5; inputSignature: string; completedSeasons: number; managers: number; fatalCount: number; warningCount: number; issues: V12AuditIssue[];
  metrics: {lineups: number; invalidLineups: number; expectedBattleFiles: number; battleFiles: number; battleInventoryMismatches: number; missingBattleEvidence: number; unendedBattles: number; stalledBattles: number; timeoutBattles: number; adjudicatedTimeoutBattles: number; protocolErrors: number; recoveredChoiceRetries: number; backgroundRegistrations: number; backgroundContractViolations: number; duplicateScarceAssets: number; duplicateRetainedContracts: number; contractOwnershipMismatches: number; invalidOfficialAssets: number; configurationUpdates: number; programCount: number; uniquePrograms: number; uniqueProgramBehaviors: number; nonZeroProgramBehaviors: number; averageProgramNodes: number; averageProgramBehaviorRange: number; programOpportunityFiles: number; programOpportunityObservations: number; programOpportunitySamples: number; invalidProgramOpportunities: number; healthWarnings: number; financialViolations: number; moneyConserved: boolean; outputBytes: number};
}

export interface V12AuditSignatureCache {
  schemaVersion: 1;
  seasons: number;
  files: Record<string, {size: number; mtimeMs: number; sha256: string}>;
}

export interface V12AuditSignatureResult {
  signature: string;
  cache: V12AuditSignatureCache;
  files: number;
  bytes: number;
  hashedFiles: number;
  hashedBytes: number;
}

export const V12_AUDIT_SIGNATURE_CACHE = ".audit-signature-cache.json";

interface State {version: number; completedSeason: number; moneySupply: number; leaguePool: number; settings?: {programEvolution?: boolean}; registry?: {hash: string; snapshot: string}; stateStorage?: DynastyStateStorage; decisionRecords?: Array<{decision: string; context?: any}>; assets: Record<string, {ownerId: string | null}>; managers: Array<{id: string; cash: number; contracts: Array<{assetId?: string; assetClass?: string}>; currentProfile: {strategyProgram?: StrategyProgram; configurationMemory?: unknown}}>}
export interface V12AuditOptions {auditedInputBytes?: number; onStage?: (stage: string, season?: number) => void}

export function auditV12Output(rootDirectory: string, inputSignature?: string, options: V12AuditOptions = {}): V12AuditSummary {
  const root = path.resolve(rootDirectory), issues: V12AuditIssue[] = [];
  if (fs.existsSync(path.join(root, ".run.lock"))) throw new Error("Cannot audit a league while it is still running");
  options.onStage?.("state-core");
  let state: State | undefined = loadDynastyStateCore<State>(path.join(root, "dynasty-state.json"));
  verifyDynastyStateStorage(path.join(root, "dynasty-state.json"), state.stateStorage);
  if (state.version !== 12) issues.push(issue("fatal", "wrong-state-version", `Expected V12, received V${state.version}`));
  if (!state.registry?.hash || !state.registry.snapshot || !fs.existsSync(path.resolve(root, state.registry.snapshot))) issues.push(issue("fatal", "missing-registry-snapshot", "League state does not point to a preserved registry snapshot"));
  else try { if (loadRegistrySnapshot(path.resolve(root, state.registry.snapshot)).hash !== state.registry.hash) throw new Error("state hash differs"); } catch (error) { issues.push(issue("fatal", "corrupt-registry-snapshot", String(error))); }
  const conserved = state.leaguePool + state.managers.reduce((sum, manager) => sum + manager.cash, 0) === state.moneySupply;
  if (!conserved) issues.push(issue("fatal", "money-conservation", "Team cash and league pool do not match money supply"));
  let lineups = 0, invalidLineups = 0, expectedBattleFiles = 0, battleFiles = 0, battleInventoryMismatches = 0, missingBattleEvidence = 0, unendedBattles = 0, stalledBattles = 0, timeoutBattles = 0, adjudicatedTimeoutBattles = 0, protocolErrors = 0, recoveredChoiceRetries = 0, backgroundRegistrations = 0, backgroundContractViolations = 0, duplicateScarceAssets = 0, duplicateRetainedContracts = 0, contractOwnershipMismatches = 0, invalidOfficialAssets = 0, configurationUpdates = 0, programOpportunityFiles = 0, programOpportunityObservations = 0, programOpportunitySamples = 0, invalidProgramOpportunities = 0, healthWarnings = 0, financialViolations = 0;
  configurationUpdates = state.decisionRecords?.filter(record => Array.isArray(record.context?.updates)).reduce((sum, record) => sum + Number(record.context?.updates?.length ?? 0), 0) ?? state.managers.filter(manager => manager.currentProfile.configurationMemory !== undefined).length;
  const programHashes = new Set<string>(), programBehaviorHashes = new Set<string>(); let programNodes = 0, nonZeroProgramBehaviors = 0, programBehaviorRange = 0;
  const retainedContracts = new Map<string, string>();
  for (const manager of state.managers) {
    try {
      if (!manager.currentProfile.strategyProgram) throw new Error("missing program");
      validateStrategyProgram(manager.currentProfile.strategyProgram);
      programHashes.add(strategyProgramHash(manager.currentProfile.strategyProgram));
      programNodes += countProgramNodes(manager.currentProfile.strategyProgram);
      const behavior = strategyProgramBehavior(manager.currentProfile.strategyProgram);
      programBehaviorHashes.add(behavior.hash);
      nonZeroProgramBehaviors += behavior.nonZero > 0 ? 1 : 0;
      programBehaviorRange += behavior.range;
    } catch (error) { issues.push(issue("fatal", "invalid-strategy-program", String(error), undefined, manager.id)); }
    for (const contract of manager.contracts) {
      if (contract.assetClass === "background" || contract.assetId?.startsWith("background:")) { backgroundContractViolations += 1; issues.push(issue("fatal", "background-contract", String(contract.assetId), undefined, manager.id)); }
      if (!contract.assetId) continue;
      const retainedBy = retainedContracts.get(contract.assetId);
      if (retainedBy) { duplicateRetainedContracts += 1; issues.push(issue("fatal", "duplicate-retained-contract", `${contract.assetId} is retained by ${retainedBy} and ${manager.id}`, undefined, manager.id)); }
      else retainedContracts.set(contract.assetId, manager.id);
      const ledgerOwner = state.assets?.[contract.assetId]?.ownerId;
      if (ledgerOwner !== manager.id) { contractOwnershipMismatches += 1; issues.push(issue("fatal", "contract-owner-mismatch", `${contract.assetId} ledger owner is ${ledgerOwner ?? "none"}`, undefined, manager.id)); }
    }
  }
  const completedSeasons = state.completedSeason, managerCount = state.managers.length, programEvolution = Boolean(state.settings?.programEvolution);
  state = undefined;
  options.onStage?.("historical-checkpoints");
  if (fs.existsSync(path.join(root, ".season-checkpoints"))) for (let season = 0; season <= completedSeasons; season += 1) try { verifyHistoricalDynastyCheckpoint(root, season); } catch (error) { issues.push(issue("fatal", "invalid-historical-checkpoint", String(error), season || undefined)); }
  for (let season = 1; season <= completedSeasons; season += 1) {
    options.onStage?.("season", season);
    const dir = path.join(root, `season-${String(season).padStart(2, "0")}`);
    for (const name of ["season.json", "decision-ledger.json", "rosters", "economy.json", "evolution.json", "battle-archive.json", "health.json", "financial-health.json"]) if (!fs.existsSync(path.join(dir, name))) issues.push(issue("fatal", "missing-artifact", `${name} is missing`, season));
    if (!fs.existsSync(path.join(dir, "season.json"))) continue;
    const opportunityFile = path.join(dir, "program-opportunities.json");
    if (fs.existsSync(opportunityFile)) {
      programOpportunityFiles += 1;
      try {
        const snapshot = read<ProgramOpportunitySnapshot>(opportunityFile), managerIds = new Set<string>();
        if ((snapshot.schemaVersion !== 1 && snapshot.schemaVersion !== 2) || snapshot.season !== season || !Number.isInteger(snapshot.sampleLimit) || snapshot.sampleLimit < 4 || snapshot.sampleLimit > 128) throw new Error("invalid opportunity envelope");
        for (const manager of snapshot.managers) {
          if (!manager.managerId || managerIds.has(manager.managerId)) throw new Error(`duplicate or empty manager ${manager.managerId}`);
          managerIds.add(manager.managerId);
          for (const entry of Object.values(manager.entrypoints)) if (entry) {
            if (!Number.isInteger(entry.observations) || entry.observations < entry.samples.length || entry.samples.length > snapshot.sampleLimit) throw new Error(`invalid observation bounds for ${manager.managerId}`);
            programOpportunityObservations += entry.observations; programOpportunitySamples += entry.samples.length;
            for (const sample of entry.samples) if (!/^[a-f0-9]{64}$/.test(sample.hash) || Object.values(sample.inputs).some(value => !Number.isFinite(value))) throw new Error(`invalid context sample for ${manager.managerId}`);
          }
          if (snapshot.schemaVersion === 2) {
            const decisionCounts = new Map<string, number>();
            for (const decision of manager.decisions ?? []) {
              decisionCounts.set(decision.entrypoint, (decisionCounts.get(decision.entrypoint) ?? 0) + 1);
              if (!decision.id || !/^[a-f0-9]{64}$/.test(decision.hash) || decision.candidates.length < 2 || decision.candidates.length > 8 || !decision.selectedIds.length || decision.selectedIds.some(id => !decision.candidates.some(candidate => candidate.id === id))) throw new Error(`invalid decision group for ${manager.managerId}`);
              if (decision.candidates.some(candidate => !candidate.id || !/^[a-f0-9]{64}$/.test(candidate.hash) || !Number.isFinite(candidate.score) || Object.values(candidate.inputs).some(value => !Number.isFinite(value)))) throw new Error(`invalid decision candidate for ${manager.managerId}`);
            }
            if ([...decisionCounts.values()].some(count => count > Math.max(4, Math.floor(snapshot.sampleLimit / 2)))) throw new Error(`decision group limit exceeded for ${manager.managerId}`);
          }
        }
      } catch (error) { invalidProgramOpportunities += 1; issues.push(issue("fatal", "invalid-program-opportunities", String(error), season)); }
    }
    if (fs.existsSync(path.join(dir, "season-pool.json"))) {
      const dex = Dex.mod("gen9");
      const pool = read<Array<{name?: string; configurationSource?: string; set?: {species?: string}}>>(path.join(dir, "season-pool.json"));
      for (const candidate of pool) {
        if (candidate.configurationSource === "locked-custom") continue;
        const species = dex.species.get(candidate.set?.species ?? candidate.name ?? "");
        if (species.exists && species.num <= 0) { invalidOfficialAssets += 1; issues.push(issue("fatal", "invalid-official-asset", `${species.name} has non-positive species number ${species.num}`, season)); }
      }
    }
    const seasonResult = read<{validity?: {valid: boolean; battleLineupSize: number}; registry?: {hash: string}}>(path.join(dir, "season.json"));
    if (!seasonResult.validity?.valid || seasonResult.validity.battleLineupSize !== 6) issues.push(issue("fatal", "invalid-season-sample", "Season is not marked as strict 6v6", season));
    if (!seasonResult.registry?.hash || !fs.existsSync(path.join(root, "config-snapshots", seasonResult.registry.hash))) issues.push(issue("fatal", "untraceable-season-registry", "Season registry hash has no immutable snapshot", season));
    else try { loadRegistrySnapshot(path.join(root, "config-snapshots", seasonResult.registry.hash)); } catch (error) { issues.push(issue("fatal", "corrupt-season-registry", String(error), season)); }
    let seasonUnended = 0, seasonStalled = 0, seasonTimeouts = 0, seasonErrors = 0;
    const battleRoot = path.join(dir, "battles");
    let seasonBattleFiles = 0, expectedSeasonBattles: number | null = null;
    const archiveFile = path.join(dir, "battle-archive.json");
    if (fs.existsSync(archiveFile)) {
      try {
        const archive = read<{schemaVersion?: number; battles?: number}>(archiveFile);
        const expected = Number(archive.battles);
        if (!Number.isInteger(expected) || expected < 0) throw new Error("invalid battle count");
        expectedSeasonBattles = expected; expectedBattleFiles += expected;
      } catch (error) {
        battleInventoryMismatches += 1;
        issues.push(issue("fatal", "invalid-battle-archive", String(error), season));
      }
    }
    for (const file of fs.existsSync(battleRoot) ? namedFiles(battleRoot, "end.json") : []) {
      seasonBattleFiles += 1;
      const battle = read<{ended?: boolean; stalled?: boolean; timeout?: boolean; adjudication?: {rule?: string}; errors?: unknown[]; choiceRetries?: number}>(file);
      battleFiles += 1;
      const gameDir = path.dirname(file);
      const hasPublicLog = fs.existsSync(path.join(gameDir, "public.log")) || fs.existsSync(path.join(gameDir, "public.log.gz"));
      const hasDecisionEvidence = fs.existsSync(path.join(gameDir, "ai-decisions.json")) || fs.existsSync(path.join(gameDir, "ai-decisions.json.gz")) || fs.existsSync(path.join(gameDir, "ai-timing.json.gz")) || fs.existsSync(path.join(gameDir, "ai-summary.json"));
      if (!hasPublicLog || !hasDecisionEvidence) { missingBattleEvidence += 1; issues.push(issue("fatal", "missing-battle-evidence", `${path.relative(root, gameDir)} public=${hasPublicLog} decisions=${hasDecisionEvidence}`, season)); }
      if (!battle.ended) { unendedBattles += 1; seasonUnended += 1; }
      if (battle.stalled) { stalledBattles += 1; seasonStalled += 1; }
      if (battle.timeout) {
        timeoutBattles += 1;
        if (battle.ended && battle.adjudication?.rule === "remaining-pokemon-then-hp") adjudicatedTimeoutBattles += 1;
        else seasonTimeouts += 1;
      }
      const errorCount = battle.errors?.length ?? 0;
      protocolErrors += errorCount; seasonErrors += errorCount;
      recoveredChoiceRetries += Number(battle.choiceRetries ?? 0);
    }
    if (expectedSeasonBattles !== null && seasonBattleFiles !== expectedSeasonBattles) { battleInventoryMismatches += 1; issues.push(issue("fatal", "battle-inventory-mismatch", `archive expects ${expectedSeasonBattles} battles, found ${seasonBattleFiles} end records`, season)); }
    if (fs.existsSync(path.join(dir, "health.json"))) {
      try {
        const health = read<{warnings?: unknown[]}>(path.join(dir, "health.json"));
        healthWarnings += (health.warnings ?? []).length;
      } catch (error) { issues.push(issue("fatal", "invalid-health-report", String(error), season)); }
    }
    if (fs.existsSync(path.join(dir, "financial-health.json"))) {
      try {
        const financial = read<{league?: {apronViolations?: number}; teams?: Array<{managerId?: string; legal?: boolean}>}>(path.join(dir, "financial-health.json"));
        const illegal = (financial.teams ?? []).filter(team => team.legal === false);
        financialViolations += Math.max(Number(financial.league?.apronViolations ?? 0), illegal.length);
        for (const team of illegal) issues.push(issue("fatal", "illegal-team-finance", "Financial health marks the team illegal", season, team.managerId));
        if (Number(financial.league?.apronViolations ?? 0) > illegal.length) issues.push(issue("fatal", "apron-violations", `${financial.league?.apronViolations} teams exceed the hard apron`, season));
      } catch (error) { issues.push(issue("fatal", "invalid-financial-health", String(error), season)); }
    }
    if (seasonUnended || seasonStalled || seasonTimeouts || seasonErrors) issues.push(issue("fatal", "technical-battle-results", `${seasonUnended} unended, ${seasonStalled} stalled, ${seasonTimeouts} timed out, ${seasonErrors} protocol errors`, season));
    if (fs.existsSync(path.join(dir, "decision-ledger.json"))) {
      const records = read<{records: Array<{stage: string; actor: string; selected: unknown; decision: string; context?: any}>}>(path.join(dir, "decision-ledger.json")).records;
      for (const record of records.filter(record => record.stage === "lineup")) {
        lineups += 1;
        if (!Array.isArray(record.selected) || record.selected.length !== 6) { invalidLineups += 1; issues.push(issue("fatal", "invalid-lineup-size", `${record.actor} selected ${Array.isArray(record.selected) ? record.selected.length : 0}`, season, record.actor)); }
      }
    }
    const rosterRoot = path.join(dir, "rosters"), scarceOwners = new Map<string, string>();
    if (fs.existsSync(rosterRoot)) for (const managerId of fs.readdirSync(rosterRoot)) {
      const roster = read<{members: Array<any>}>(path.join(rosterRoot, managerId, "roster.json"));
      if (roster.members.length < 6 || roster.members.length > 10) issues.push(issue("fatal", "invalid-roster-size", String(roster.members.length), season, managerId));
      for (const member of roster.members) {
        if (member.debutGeneration > season) issues.push(issue("fatal", "generation-lock-violation", `${member.pokemon} debuted in G${member.debutGeneration}`, season, managerId));
        if (member.economicClass === "background") {
          backgroundRegistrations += 1;
          if (member.price !== 0 || member.contract || member.method !== "registration") issues.push(issue("fatal", "invalid-background-member", member.pokemon, season, managerId));
        } else if (member.assetId) {
          if (scarceOwners.has(member.assetId)) { duplicateScarceAssets += 1; issues.push(issue("fatal", "duplicate-scarce-asset", member.assetId, season, managerId)); }
          else scarceOwners.set(member.assetId, managerId);
        }
        if (member.configurationSource === "ai") {
          const evTotal = Object.values(member.configuredSet?.evs ?? {}).reduce((sum: number, value) => sum + Number(value), 0);
          if (evTotal > 510) issues.push(issue("fatal", "illegal-ev-total", `${member.pokemon}: ${evTotal}`, season, managerId));
        }
      }
    }
  }
  options.onStage?.("finalize");
  const outputBytes = options.auditedInputBytes ?? auditInputBytes(root, completedSeasons);
  if (configurationUpdates === 0 && completedSeasons > 0) issues.push(issue("warning", "no-configuration-evidence", "No auditable configuration posterior updates were found"));
  if (programEvolution && completedSeasons >= 3 && programBehaviorHashes.size <= 1) issues.push(issue("warning", "program-behavior-collapse", "All active managers have the same strategy-program behavior fingerprint"));
  const summary: V12AuditSummary = {schemaVersion: 5, inputSignature: inputSignature ?? auditV12Signature(root, completedSeasons), completedSeasons, managers: managerCount, fatalCount: issues.filter(entry => entry.severity === "fatal").length, warningCount: issues.filter(entry => entry.severity === "warning").length, issues, metrics: {lineups, invalidLineups, expectedBattleFiles, battleFiles, battleInventoryMismatches, missingBattleEvidence, unendedBattles, stalledBattles, timeoutBattles, adjudicatedTimeoutBattles, protocolErrors, recoveredChoiceRetries, backgroundRegistrations, backgroundContractViolations, duplicateScarceAssets, duplicateRetainedContracts, contractOwnershipMismatches, invalidOfficialAssets, configurationUpdates, programCount: managerCount, uniquePrograms: programHashes.size, uniqueProgramBehaviors: programBehaviorHashes.size, nonZeroProgramBehaviors, averageProgramNodes: managerCount ? programNodes / managerCount : 0, averageProgramBehaviorRange: managerCount ? programBehaviorRange / managerCount : 0, programOpportunityFiles, programOpportunityObservations, programOpportunitySamples, invalidProgramOpportunities, healthWarnings, financialViolations, moneyConserved: conserved, outputBytes}};
  return summary;
}

export function auditV12Signature(root: string, seasons: number): string {
  return auditV12SignatureIncremental(root, seasons, undefined, true).signature;
}
export function cachedV12AuditSignature(root: string, seasons: number): V12AuditSignatureResult {
  let prior: V12AuditSignatureCache | undefined;
  try { prior = read<V12AuditSignatureCache>(path.join(root, V12_AUDIT_SIGNATURE_CACHE)); } catch { prior = undefined; }
  return auditV12SignatureIncremental(root, seasons, prior);
}
export function v12AuditSignatureFromCache(cache: V12AuditSignatureCache): {signature: string; files: number; bytes: number} {
  if (cache.schemaVersion !== 1) throw new Error("Unsupported V12 audit signature cache");
  const hash = crypto.createHash("sha256"); let bytes = 0;
  const relatives = Object.keys(cache.files).sort();
  for (const relative of relatives) { const entry = cache.files[relative]; hash.update(`${relative}\0${entry.sha256}\0`); bytes += entry.size; }
  return {signature: hash.digest("hex"), files: relatives.length, bytes};
}
export function auditV12SignatureIncremental(rootDirectory: string, seasons: number, prior?: V12AuditSignatureCache, rehashAll = false): V12AuditSignatureResult {
  const root = path.resolve(rootDirectory), entries: V12AuditSignatureCache["files"] = {};
  let bytes = 0, files = 0, hashedFiles = 0, hashedBytes = 0;
  for (const file of auditFiles(root, seasons)) {
    const relative = path.relative(root, file).replace(/\\/g, "/"), stat = fs.statSync(file), cached = prior?.schemaVersion === 1 ? prior.files[relative] : undefined;
    const reusable = !rehashAll && cached?.size === stat.size && cached.mtimeMs === stat.mtimeMs && /^[a-f0-9]{64}$/.test(cached.sha256);
    const sha256 = reusable ? cached.sha256 : crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    entries[relative] = {size: stat.size, mtimeMs: stat.mtimeMs, sha256};
    bytes += stat.size; files += 1;
    if (!reusable) { hashedFiles += 1; hashedBytes += stat.size; }
  }
  const cache = {schemaVersion: 1 as const, seasons, files: entries}, signature = v12AuditSignatureFromCache(cache).signature;
  return {signature, cache, files, bytes, hashedFiles, hashedBytes};
}
export function v12AuditMarkdown(summary: V12AuditSummary): string { const m = summary.metrics; return [`# V12 联盟审计`, ``, `- 赛季：${summary.completedSeasons}`, `- 经理：${summary.managers}`, `- 致命/警告：${summary.fatalCount}/${summary.warningCount}`, `- 阵容：${m.lineups}（非法${m.invalidLineups}）`, `- 比赛：${m.battleFiles}/${m.expectedBattleFiles}（清单异常${m.battleInventoryMismatches}）`, `- 公共注册：${m.backgroundRegistrations}`, `- 重复稀缺资产：${m.duplicateScarceAssets}`, `- 配置证据更新：${m.configurationUpdates}`, `- 策略程序：结构${m.uniquePrograms}/${m.programCount}种，行为${m.uniqueProgramBehaviors}种，非零${m.nonZeroProgramBehaviors}个，平均${m.averageProgramNodes.toFixed(1)}节点`, `- 健康警告/财务违规：${m.healthWarnings}/${m.financialViolations}`, `- 货币守恒：${m.moneyConserved ? "是" : "否"}`, `- 产物：${(m.outputBytes / 1048576).toFixed(1)}MB`, ``, `## 问题`, ``, ...(summary.issues.length ? summary.issues.map(entry => `- [${entry.severity.toUpperCase()}] ${entry.code}${entry.season ? ` S${entry.season}` : ""}${entry.managerId ? ` ${entry.managerId}` : ""}：${entry.message}`) : ["未发现问题。"]), ``].join("\n"); }
function* auditFiles(root: string, seasons: number): Generator<string> {
  if (fs.existsSync(path.join(root, "dynasty-state.json"))) yield path.join(root, "dynasty-state.json");
  if (fs.existsSync(path.join(root, "config-snapshots"))) yield* collectAuditInputs(path.join(root, "config-snapshots"));
  if (fs.existsSync(path.join(root, ".season-checkpoints"))) yield* collectAuditInputs(path.join(root, ".season-checkpoints"));
  if (fs.existsSync(path.join(root, ".runtime-bundles"))) yield* collectAuditInputs(path.join(root, ".runtime-bundles"));
  for (let season = 1; season <= seasons; season += 1) {
    const seasonRoot = path.join(root, `season-${String(season).padStart(2, "0")}`);
    if (fs.existsSync(seasonRoot)) yield* collectAuditInputs(seasonRoot);
  }
}
function* collectAuditInputs(directory: string): Generator<string> {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* collectAuditInputs(target);
    else if (!entry.name.startsWith("audit-") && !entry.name.endsWith(".md") && !["season-brief.json", "token-budget.json"].includes(entry.name)) yield target;
  }
}
function auditInputBytes(root: string, seasons: number): number { let total = 0; for (const file of auditFiles(root, seasons)) total += fs.statSync(file).size; return total; }
function* namedFiles(directory: string, name: string): Generator<string> { for (const entry of fs.readdirSync(directory, {withFileTypes: true})) { const target = path.join(directory, entry.name); if (entry.isDirectory()) yield* namedFiles(target, name); else if (entry.name === name) yield target; } }
function issue(severity: V12AuditIssue["severity"], code: string, message: string, season?: number, managerId?: string): V12AuditIssue { return {severity, code, message, season, managerId}; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
