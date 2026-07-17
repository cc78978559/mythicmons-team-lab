import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {Dex, Teams, toID} from "pokemon-showdown";
import type {PokemonSet} from "pokemon-showdown/dist/sim/teams";
import {compileSandboxTeam} from "../sandbox/compiler";
import {installCompiledSandbox} from "../sandbox/installer";
import type {SandboxTeam} from "../sandbox/types";
import {loadBenchmarkPool, benchmarkTeamPath} from "../eval/benchmarkPool";
import {analyzePublicLog} from "../eval/logAnalysis";
import {runBattle} from "../showdown/battle";
import {loadTeam, writeTeam} from "../showdown/team";
import {DecisionLedger} from "../draft/decisionLedger";
import {extractKeyBattleDecisions} from "../draft/battleDecisionExtractor";
import {boundedDraftJitter, thirdRoundReversalOrder} from "../draft/scoring";
import {cloneManagerProfile, createNoviceProfiles, normalizedTraitWeights, roleTargetValue, type DraftRole, type ManagerProfile} from "../draft/managerProfiles";
import {DRAFT_GENERATIONS, draftGenerationSource} from "../draft/customRegistry";
import {solvePortfolioAuction, type PortfolioBid} from "../draft/portfolioAuction";
import {tradeAcceptable, waiverWinner} from "../draft/sportsMarket";
import {assertBattleLineup, chooseK} from "../draft/lineups";
import {evaluateStrategyProgram, strategyProgramHash} from "../draft/strategyProgram";
import {analyzeConfigurationTelemetry, emptyConfigurationEvidence, mergeConfigurationEvidence, type MemberConfigurationEvidence} from "../draft/configurationTelemetry";
import {acquireRunLock} from "../draft/runLock";
import {tacticalFamilyValue, tacticalOpponentModel, tacticalSignals} from "../draft/tacticalMemory";
import {evaluateWhiteBoxDecision, summarizeWhiteBoxShadow, type WhiteBoxCandidate} from "../ai/whiteBox/decision";
import {buildLineupWhiteBoxCandidate, evaluateLineupAssistGate, whiteBoxCandidateTotal, type WhiteBoxLineupInput} from "../ai/whiteBox/lineup";
import {LINEUP_SHADOW_PARAMETERS} from "../ai/whiteBox/parameters";
import {buildAcquisitionWhiteBoxCandidate, whiteBoxAcquisitionTotal} from "../ai/whiteBox/acquisition";
import {ACQUISITION_SHADOW_PARAMETERS, BID_SHADOW_PARAMETERS, MARKET_FLOW_SHADOW_PARAMETERS, REGISTRATION_SHADOW_PARAMETERS} from "../ai/whiteBox/parameters";
import {evaluateWhiteBoxBid} from "../ai/whiteBox/auction";
import {buildTradeWhiteBoxCandidate, evaluateMarketReplacement, evaluateTradeAssistGate, evaluateWaiverPriority, type TradeCandidateInput} from "../ai/whiteBox/marketFlow";
import {loadBattleAssistApproval} from "../ai/whiteBox/battleApproval";

type Side = "p1" | "p2";
type Role = DraftRole;

interface Candidate {
  id: string;
  assetId: string;
  family: string;
  name: string;
  source: string;
  set: PokemonSet;
  types: string[];
  stats: {hp: number; atk: number; def: number; spa: number; spd: number; spe: number};
  roles: Set<Role>;
  strength: number;
  market: number;
  tier: "premium" | "standard";
  scarcity: "legendary" | "unique-custom" | "elite-ordinary" | "standard";
  supplyCap: number;
  economicClass: "background" | "limited" | "unique";
  debutGeneration: number;
  configurationSource: "ai" | "locked-custom";
}

interface RosterEntry {
  candidate: Candidate;
  method: "auction" | "supplemental" | "keeper" | "free-agent" | "trade" | "waiver" | "registration";
  price: number;
  decisionId: string;
  appearances: number;
  kos: number;
  regularSeasonAppearances: number;
  regularSeasonKos: number;
  contract?: Record<string, unknown>;
  configurationEvidence: MemberConfigurationEvidence;
}

interface Manager extends ManagerProfile {
  matchupMemory: NonNullable<ManagerProfile["matchupMemory"]>;
  budget: number;
  division: string;
  roster: RosterEntry[];
  departed: RosterEntry[];
  record: {seriesWins: number; seriesLosses: number; seriesDraws: number; points: number; pairWins: number; pairLosses: number; kos: number};
}

const seed = process.env.V3_SEED || "decision-league-v3";
const poolSeed = process.env.V3_POOL_SEED || seed;
const universeSeed = process.env.V3_UNIVERSE_SEED || poolSeed;
const outDir = path.resolve(process.env.V3_OUT || "output/draft-league-v3");
const poolSize = Number(process.env.V3_POOL_SIZE || 120);
const auctionLots = Number(process.env.V3_AUCTION_LOTS || 24);
const pairsPerSeries = Number(process.env.V3_PAIRS || 2);
const dryRun = /^(1|true|yes)$/i.test(process.env.V3_DRY_RUN || "false");
const maxTurns = Number(process.env.V3_MAX_TURNS || 180);
const managerLimit = Number(process.env.V3_MANAGER_LIMIT || 10);
const seasonNumber = Number(process.env.V3_SEASON_NUMBER || 1);
const regularRoundSetting = Number(process.env.V3_REGULAR_ROUNDS || 0);
const keeperPath = process.env.V3_KEEPERS ? path.resolve(process.env.V3_KEEPERS) : null;
const marketHistoryPath = process.env.V3_MARKET_HISTORY ? path.resolve(process.env.V3_MARKET_HISTORY) : null;
const budgetPath = process.env.V3_BUDGETS ? path.resolve(process.env.V3_BUDGETS) : null;
const assetLedgerPath = process.env.V3_ASSET_LEDGER ? path.resolve(process.env.V3_ASSET_LEDGER) : null;
const auctionMode = process.env.V3_AUCTION_MODE || "sequential";
const minimumRosterSize = Number(process.env.V3_MIN_ROSTER || 8);
const maximumRosterSize = Number(process.env.V3_MAX_ROSTER || 8);
const midseasonGrant = Number(process.env.V3_MIDSEASON_GRANT || 0);
const keeperCap = Number(process.env.V3_KEEPER_CAP || process.env.V4_KEEPER_CAP || 70);
const maximumKeepers = Number(process.env.V3_MAX_KEEPERS || 3);
const separatePayroll = /^(1|true|yes)$/i.test(process.env.V3_SEPARATE_PAYROLL || "false");
const sportsMarket = /^(1|true|yes)$/i.test(process.env.V3_SPORTS_MARKET || "false");
const dualLayer = /^(1|true|yes)$/i.test(process.env.V3_DUAL_LAYER || "false");
const programEvolution = /^(1|true|yes)$/i.test(process.env.V3_PROGRAM_EVOLUTION || "false");
const compactOutput = /^(1|true|yes)$/i.test(process.env.V3_COMPACT_OUTPUT || "false");
const tacticalMemoryConfidenceFloor = Number(process.env.V3_TACTICAL_MEMORY_CONFIDENCE_FLOOR || .15);
const registryDirectory = path.resolve(process.env.V3_REGISTRY_DIR || path.join("data", "draft"));
const registryHash = process.env.V3_REGISTRY_HASH || "live";
const registryNamespace = process.env.V3_REGISTRY_NAMESPACE || (registryHash === "live" ? "" : registryHash.slice(0, 12));
const unlockGeneration = Math.max(1, Math.min(9, Number(process.env.V3_UNLOCK_GENERATION || 9)));
const maximumAuctionWins = sportsMarket ? maximumRosterSize : 3;
const lastWaiverRound = new Map<string, number>();
const startingBudgets = loadStartingBudgets();
const priorAssets = loadPriorAssets();
const ledger = new DecisionLedger();
const configuredCandidateCache = new Map<string, Candidate>();
const legalMoveIdsCache = new Map<string, string[]>();
const lineupShadowValues = LINEUP_SHADOW_PARAMETERS.snapshot().values;
const acquisitionShadowValues = ACQUISITION_SHADOW_PARAMETERS.snapshot().values;
const registrationShadowValues = REGISTRATION_SHADOW_PARAMETERS.snapshot().values;
const bidShadowValues = BID_SHADOW_PARAMETERS.snapshot().values;
const marketFlowShadowValues = MARKET_FLOW_SHADOW_PARAMETERS.snapshot().values;
const battleAssistApprovalPath=process.env.V3_BATTLE_ASSIST_APPROVAL||process.env.V4_BATTLE_ASSIST_APPROVAL||"";
const battleAssistApproval=battleAssistApprovalPath?loadBattleAssistApproval(path.resolve(battleAssistApprovalPath)):null;
const battleAssistScopes=battleAssistApproval?.payload.scopes.map(entry=>entry.scopeId)??[];

const customSources = DRAFT_GENERATIONS.map(generation => process.env.V3_REGISTRY_DIR ? path.join(registryDirectory, path.basename(draftGenerationSource(generation))) : draftGenerationSource(generation));

const baseManagerProfiles = createNoviceProfiles(managerLimit);
const managers: Manager[] = loadManagerProfiles().map(manager);

async function main(): Promise<void> {
  const lock = acquireRunLock(outDir, {seed, seasonNumber, registryHash});
  try {
  validateSettings();
  const {compiled, customFamilies, customIds, customGenerations} = compileRegistry();
  installCompiledSandbox(compiled, process.cwd(), {backup: false, replaceConflicts: true});
  const dex = Dex.mod(compiled.modId);
  const pool = buildSeasonPool(compiled.team, customFamilies, customIds, customGenerations, dex);
  calibratePool(pool, dex);
  writePool(pool);
  const available = new Map(pool.map(candidate => [candidate.id, candidate]));
  applyKeepers(available, dex);
  if (auctionMode === "portfolio") runPortfolioAuction(available, dex);
  else runAuction(available, dex);
  if (dualLayer) runBackgroundRegistration(pool, dex);
  else runSupplementalDraft(available, dex);
  writeRosters();
  if (dryRun) {
    for (const manager of managers) chooseLineup(manager, managers[(managers.indexOf(manager) + 1) % managers.length], dex, "dry-run-lineup");
    ledger.add({stage: "review", actor: "system", decision: "结束预演", selected: null, context: {dryRun: true, pool: pool.length, auctionLots, rosterSize: 8}, alternatives: [], rationale: ["已验证候选定价、竞价冲突、预算预留、补强选秀与8选6"]});
    finish({dryRun: true, champion: null, standings: [], validity: {schemaVersion: 1, valid: true, battleLineupSize: 6}});
    return;
  }
  const season = await runSeason(compiled.formatId, dex, available);
  resolveAcquisitionOutcomes(season.champion);
  writeRosters();
  finish(season);
  } finally { lock.release(); }
}

function manager(profile: ManagerProfile, index: number): Manager {
  const cloned = cloneManagerProfile(profile);
  const division = managerLimit >= 30 ? ["A", "B", "C"][Math.floor(index / 10)] : "League";
  return {...cloned, matchupMemory: cloned.matchupMemory ?? {}, budget: startingBudgets[cloned.id] ?? 100, division, roster: [], departed: [], record: {seriesWins: 0, seriesLosses: 0, seriesDraws: 0, points: 0, pairWins: 0, pairLosses: 0, kos: 0}};
}

function loadStartingBudgets(): Record<string, number> {
  if (!budgetPath || !fs.existsSync(budgetPath)) return {};
  const parsed = JSON.parse(fs.readFileSync(budgetPath, "utf8")) as {managers?: Record<string, number>};
  for (const [managerId, budget] of Object.entries(parsed.managers ?? {})) if (!Number.isInteger(budget) || budget < (dualLayer ? 0 : 8) || budget > 200) throw new Error(`Invalid starting budget for ${managerId}: ${budget}`);
  return parsed.managers ?? {};
}

interface PriorAsset {assetId: string; family: string; scarcity: Candidate["scarcity"]; supplyCap: number}

function loadPriorAssets(): PriorAsset[] {
  if (!assetLedgerPath || !fs.existsSync(assetLedgerPath)) return [];
  const parsed = JSON.parse(fs.readFileSync(assetLedgerPath, "utf8")) as {assets?: Record<string, PriorAsset>};
  return Object.values(parsed.assets ?? {});
}

function validateSettings(): void {
  if (!Number.isInteger(poolSize) || poolSize < 100) throw new Error("V3_POOL_SIZE must be at least 100");
  if (!Number.isInteger(auctionLots) || auctionLots < 10 || auctionLots > 90) throw new Error("V3_AUCTION_LOTS must be 10..90");
  if (!Number.isInteger(pairsPerSeries) || pairsPerSeries < 1) throw new Error("V3_PAIRS must be positive");
  if (!Number.isInteger(managerLimit) || managerLimit < 6 || managerLimit > 30) throw new Error("V3_MANAGER_LIMIT must be 6..30");
  if (!Number.isInteger(seasonNumber) || seasonNumber < 1) throw new Error("V3_SEASON_NUMBER must be positive");
  if (!Number.isInteger(regularRoundSetting) || regularRoundSetting < 0 || regularRoundSetting >= managerLimit) throw new Error(`V3_REGULAR_ROUNDS must be 0..${managerLimit - 1}`);
  if (!['sequential', 'portfolio'].includes(auctionMode)) throw new Error("V3_AUCTION_MODE must be sequential or portfolio");
  if (!Number.isInteger(minimumRosterSize) || !Number.isInteger(maximumRosterSize) || minimumRosterSize < 6 || maximumRosterSize < minimumRosterSize || maximumRosterSize > 10) throw new Error("V3 roster limits must satisfy 6 <= min <= max <= 10");
  if (!Number.isInteger(midseasonGrant) || midseasonGrant < 0 || midseasonGrant > 20) throw new Error("V3_MIDSEASON_GRANT must be 0..20");
  if (!Number.isFinite(tacticalMemoryConfidenceFloor) || tacticalMemoryConfidenceFloor < 0 || tacticalMemoryConfidenceFloor > 1) throw new Error("V3_TACTICAL_MEMORY_CONFIDENCE_FLOOR must be within 0..1");
}

function loadManagerProfiles(): ManagerProfile[] {
  const configured = process.env.V3_MANAGER_PROFILES ? JSON.parse(fs.readFileSync(path.resolve(process.env.V3_MANAGER_PROFILES), "utf8")) as {managers?: ManagerProfile[]} | ManagerProfile[] : null;
  const list = Array.isArray(configured) ? configured : configured?.managers;
  if (!list?.length) return baseManagerProfiles.map(cloneManagerProfile);
  const overrides = new Map(list.map(profile => [profile.id, profile]));
  const profiles = baseManagerProfiles.map(base => {
    const override = overrides.get(base.id);
    return override ? cloneManagerProfile({
      ...base,
      ...override,
      id: base.id,
      name: override.name || base.name,
      traits: {...base.traits, ...override.traits},
      preferredRoles: override.preferredRoles?.length ? [...override.preferredRoles] : [...base.preferredRoles],
      roleTargets: {...base.roleTargets, ...override.roleTargets},
      economics: {...base.economics, ...override.economics},
      tactics: {...base.tactics, ...override.tactics, id: base.id},
      learning: {...base.learning, ...override.learning},
      matchupMemory: override.matchupMemory ?? {},
    }) : cloneManagerProfile(base);
  });
  profiles.forEach(validateManagerProfile);
  return profiles;
}

function validateManagerProfile(profile: ManagerProfile): void {
  for (const [trait, value] of Object.entries(profile.traits)) if (!Number.isFinite(value) || value < .05 || value > 1.2) throw new Error(`Invalid ${profile.id} trait ${trait}: ${value}`);
  const allowedRoles = new Set<Role>(["hazards", "removal", "recovery", "pivot", "setup", "priority", "screens", "status", "physical", "special"]);
  if (profile.preferredRoles.some(role => !allowedRoles.has(role))) throw new Error(`Invalid preferred role for ${profile.id}`);
  if (!profile.development || !Number.isInteger(profile.development.seasons) || profile.development.seasons < 0) throw new Error(`Invalid development state for ${profile.id}`);
  if (!Number.isFinite(profile.development.exploration) || profile.development.exploration < 0 || profile.development.exploration > 1) throw new Error(`Invalid exploration rate for ${profile.id}`);
  for (const [trait, posterior] of Object.entries(profile.development.strategies)) {
    if (![posterior.mean, posterior.confidence, posterior.effectiveSamples].every(Number.isFinite) || posterior.mean < 0 || posterior.mean > 1 || posterior.confidence < 0 || posterior.confidence > 1 || posterior.effectiveSamples < 0) throw new Error(`Invalid ${trait} posterior for ${profile.id}`);
  }
  for (const [opponent, memory] of Object.entries(profile.matchupMemory ?? {})) {
    if (!Number.isInteger(memory.series) || memory.series < 0 || !Number.isInteger(memory.wins) || memory.wins < 0 || !Number.isInteger(memory.losses) || memory.losses < 0) throw new Error(`Invalid matchup record for ${profile.id} vs ${opponent}`);
    for (const [family, score] of Object.entries(memory.familyScores)) if (!Number.isFinite(score) || score < -3 || score > 3) throw new Error(`Invalid matchup score for ${profile.id} vs ${opponent}: ${family}=${score}`);
  }
}

function compileRegistry(): {compiled: ReturnType<typeof compileSandboxTeam>; customFamilies: string[]; customIds: string[]; customGenerations: number[]} {
  const teams = customSources.map(source => JSON.parse(fs.readFileSync(path.resolve(source), "utf8")) as SandboxTeam);
  const combined: SandboxTeam = {name: "V3 Custom Registry", customMoves: teams.flatMap(team => team.customMoves ?? []), customAbilities: teams.flatMap(team => team.customAbilities ?? []), customItems: teams.flatMap(team => team.customItems ?? []), members: teams.flatMap(team => team.members)};
  return {
    compiled: compileSandboxTeam(combined, {namespace: registryNamespace}),
    customFamilies: teams.flatMap(team => team.members.map(member => toID(member.species))),
    customIds: teams.flatMap(team => team.members.map(member => member.id)),
    customGenerations: teams.flatMap((team, index) => team.members.map(() => index + 1)),
  };
}

function buildSeasonPool(customSets: PokemonSet[], customFamilies: string[], customIds: string[], customGenerations: number[], dex: ReturnType<typeof Dex.mod>): Candidate[] {
  if (dualLayer) return buildDualLayerPool(customSets, customIds, customGenerations, dex);
  const candidates: Candidate[] = customSets.map((set, index) => makeCandidate(`custom-${customIds[index]}`, `mythic-${customIds[index]}`, set.name || set.species, "自制", set, dex, customGenerations[index]));
  const modern = loadBenchmarkPool("benchmarks/gen9expanded/index.json");
  for (const benchmark of modern.benchmarks) {
    for (const set of loadTeam(benchmarkTeamPath(modern, benchmark.team)).sets) {
      const species = dex.species.get(set.species);
      candidates.push(makeCandidate(`modern-${species.id}`, toID(species.baseSpecies), set.species, `现代:${benchmark.name}`, normalizeSet(set), dex));
    }
  }
  const bestByFamily = new Map<string, Candidate>();
  for (const candidate of candidates) keepStronger(bestByFamily, candidate);
  const generationTarget = Math.max(poolSize + 120, Math.ceil(poolSize * 1.4));
  for (let attempt = 0; bestByFamily.size < generationTarget && attempt < generationTarget * 40; attempt += 1) {
    const digest = crypto.createHash("sha256").update(`${universeSeed}:pool:${attempt}`).digest();
    const generatorSeed = `${digest.readUInt32BE(0)},${digest.readUInt32BE(4)},${digest.readUInt32BE(8)},${digest.readUInt32BE(12)}` as `${number},${string}`;
    for (const set of Teams.getGenerator("gen9randombattle", generatorSeed).getTeam() as PokemonSet[]) {
      const species = dex.species.get(set.species);
      const family = toID(species.baseSpecies);
      if (bestByFamily.has(family)) continue;
      keepStronger(bestByFamily, makeCandidate(`generated-${species.id}`, family, set.species, "Showdown成熟配置", normalizeSet(set), dex));
      if (bestByFamily.size >= generationTarget) break;
    }
  }
  const allCandidates = augmentFunctionalDepth([...bestByFamily.values()], dex);
  const selected = ensureStandardDepth(selectDeepPool(allCandidates), allCandidates, dex);
  return issueScarceAssets(selected, dex);
}

function buildDualLayerPool(customSets: PokemonSet[], customIds: string[], customGenerations: number[], dex: ReturnType<typeof Dex.mod>): Candidate[] {
  const speciesCandidates = dex.species.all()
    .filter(species => species.exists && species.num > 0 && species.gen <= unlockGeneration && species.name === species.baseSpecies && species.isNonstandard !== "CAP")
    .map(species => makeCandidate(`official-${species.id}`, toID(species.baseSpecies), species.name, `官方:G${species.gen}`, configureOfficialSet(species.name, undefined, dex), dex, species.gen));
  const customCandidates = customSets.flatMap((set, index) => customGenerations[index] <= unlockGeneration
    ? [makeCandidate(`custom-${customIds[index]}`, `mythic-${customIds[index]}`, set.name || set.species, "自制", set, dex, customGenerations[index])]
    : []);
  const uniqueFamilies = new Map<string, Candidate>();
  for (const candidate of [...speciesCandidates, ...customCandidates]) keepStronger(uniqueFamilies, candidate);
  return issueDualLayerAssets([...uniqueFamilies.values()], dex);
}

function issueDualLayerAssets(speciesPool: Candidate[], dex: ReturnType<typeof Dex.mod>): Candidate[] {
  const priorByFamily = new Map<string, PriorAsset[]>();
  for (const asset of priorAssets) priorByFamily.set(asset.family, [...(priorByFamily.get(asset.family) ?? []), asset]);
  const limitedFamilies = new Set<string>();
  for (let generation = 1; generation <= unlockGeneration; generation += 1) {
    const ordinary = speciesPool.filter(candidate => candidate.debutGeneration === generation && candidate.source !== "自制" && !isLegendaryCandidate(candidate, dex)).sort((a, b) => b.strength - a.strength || a.family.localeCompare(b.family));
    for (const candidate of ordinary.slice(0, Math.max(3, Math.ceil(ordinary.length * .1)))) limitedFamilies.add(candidate.family);
  }
  const assets: Candidate[] = [];
  for (const candidate of speciesPool) {
    const unique = candidate.source === "自制" || isLegendaryCandidate(candidate, dex);
    const limited = !unique && limitedFamilies.has(candidate.family);
    if (!unique && !limited) {
      assets.push({...candidate, id: `background-${candidate.family}`, assetId: `background:${candidate.family}`, scarcity: "standard", supplyCap: managerLimit, economicClass: "background", tier: "standard"});
      continue;
    }
    const prior = priorByFamily.get(candidate.family);
    const scarcity = candidate.source === "自制" ? "unique-custom" : unique ? "legendary" : "elite-ordinary";
    const supplyCap = unique ? 1 : prior?.[0]?.supplyCap ?? 1 + poolTie(`v11-limited:${candidate.family}`) % 3;
    for (let copy = 1; copy <= supplyCap; copy += 1) {
      const previous = prior?.[copy - 1];
      const assetId = previous?.assetId ?? `${candidate.family}:${scarcity}:${copy}`;
      assets.push({...candidate, id: `${candidate.id}-asset-${copy}`, assetId, scarcity, supplyCap, economicClass: unique ? "unique" : "limited", tier: "premium"});
    }
  }
  return assets;
}

function augmentFunctionalDepth(candidates: Candidate[], dex: ReturnType<typeof Dex.mod>): Candidate[] {
  const result = [...candidates];
  const removalTarget = Math.ceil(managerLimit * 2 / 3);
  let removalCount = result.filter(candidate => candidate.roles.has("removal")).length;
  if (removalCount >= removalTarget) return result;
  const removalMoves = ["rapidspin", "defog", "tidyup", "mortalspin"];
  for (let index = 0; index < result.length && removalCount < removalTarget; index += 1) {
    const candidate = result[index];
    if (candidate.source === "自制" || candidate.roles.has("removal")) continue;
    const learnset = dex.species.getLearnsetData(candidate.set.species).learnset ?? {};
    const moveId = removalMoves.find(move => move in learnset);
    if (!moveId) continue;
    const set = cloneSet(candidate.set);
    set.moves = [...set.moves.slice(0, 3), dex.moves.get(moveId).name];
    result[index] = makeCandidate(`${candidate.id}-removal`, candidate.family, candidate.name, `${candidate.source}:功能配置`, set, dex);
    removalCount += 1;
  }
  return result;
}

function ensureStandardDepth(selected: Candidate[], allCandidates: Candidate[], dex: ReturnType<typeof Dex.mod>): Candidate[] {
  const result = new Map(selected.map(candidate => [candidate.family, candidate]));
  const requiredStandardSpecies = managerLimit * maximumRosterSize + Math.max(4, Math.ceil(auctionLots / 3));
  const isStandardSpecies = (candidate: Candidate) => candidate.source !== "自制" && !isLegendaryCandidate(candidate, dex);
  let standardCount = [...result.values()].filter(isStandardSpecies).length;
  if (standardCount >= requiredStandardSpecies) return [...result.values()];
  for (const candidate of [...allCandidates].filter(isStandardSpecies).sort((a, b) => poolTie(`standard-depth:${a.family}`) - poolTie(`standard-depth:${b.family}`))) {
    if (result.has(candidate.family)) continue;
    result.set(candidate.family, candidate);
    standardCount += 1;
    if (standardCount >= requiredStandardSpecies) break;
  }
  if (standardCount < requiredStandardSpecies) throw new Error(`Candidate pool can only supply ${standardCount}/${requiredStandardSpecies} standard species`);
  return [...result.values()];
}

function issueScarceAssets(speciesPool: Candidate[], dex: ReturnType<typeof Dex.mod>): Candidate[] {
  const priorByFamily = new Map<string, PriorAsset[]>();
  for (const asset of priorAssets) priorByFamily.set(asset.family, [...(priorByFamily.get(asset.family) ?? []), asset]);
  const ordinaryBand = [...speciesPool]
    .filter(candidate => !isLegendaryCandidate(candidate, dex) && candidate.source !== "自制")
    .sort((a, b) => b.strength - a.strength)
    .slice(0, Math.max(auctionLots * 2, managerLimit * 4));
  const eliteSpeciesCount = Math.max(4, Math.ceil(auctionLots / 3));
  const eliteFamilies = new Set(ordinaryBand
    .map(candidate => ({candidate, order: poolTie(`elite-issuance:${candidate.family}`)}))
    .sort((a, b) => a.order - b.order)
    .slice(0, eliteSpeciesCount)
    .map(entry => entry.candidate.family));
  const assets: Candidate[] = [];
  for (const candidate of speciesPool) {
    const issued = priorByFamily.get(candidate.family);
    if (issued?.length) {
      for (const asset of issued) assets.push({...candidate, id: `${candidate.id}-${toID(asset.assetId)}`, assetId: asset.assetId, scarcity: asset.scarcity, supplyCap: asset.supplyCap});
      continue;
    }
    const legendary = isLegendaryCandidate(candidate, dex);
    const uniqueCustom = candidate.source === "自制";
    const eliteOrdinary = !legendary && !uniqueCustom && eliteFamilies.has(candidate.family);
    const supplyCap = legendary || uniqueCustom ? 1 : eliteOrdinary ? 1 + poolTie(`elite-supply:${candidate.family}`) % 3 : 1;
    for (let copy = 1; copy <= supplyCap; copy += 1) {
      const scarcity = uniqueCustom ? "unique-custom" : legendary ? "legendary" : eliteOrdinary ? "elite-ordinary" : "standard";
      const assetId = `${candidate.family}:${scarcity}:${copy}`;
      assets.push({...candidate, id: `${candidate.id}-asset-${copy}`, assetId, scarcity, supplyCap});
    }
  }
  return assets;
}

function isLegendaryCandidate(candidate: Candidate, dex: ReturnType<typeof Dex.mod>): boolean {
  const species = dex.species.get(candidate.set.species);
  return (species.tags ?? []).some(tag => /Legendary|Mythical/i.test(tag));
}

function selectDeepPool(candidates: Candidate[]): Candidate[] {
  const ranked = [...candidates].sort((a, b) => b.strength - a.strength);
  const selected = new Map<string, Candidate>();
  const priorFamilies = new Set(priorAssets.map(asset => asset.family));
  for (const candidate of ranked) if (priorFamilies.has(candidate.family)) selected.set(candidate.family, candidate);
  for (const candidate of ranked.filter(candidate => candidate.source === "自制")) if (selected.size < poolSize) selected.set(candidate.family, candidate);
  const depthTarget = Math.min(managerLimit * 2, Math.floor(poolSize / 8));
  const criticalRoles: Role[] = ["hazards", "removal", "recovery", "pivot", "physical", "special"];
  for (const role of criticalRoles) {
    for (const candidate of ranked.filter(candidate => candidate.roles.has(role))) {
      if ([...selected.values()].filter(entry => entry.roles.has(role)).length >= depthTarget || selected.size >= poolSize) break;
      selected.set(candidate.family, candidate);
    }
  }
  const ordinaryDiversityTarget = Math.floor(poolSize * .65);
  const ordinaryCandidates = ranked
    .filter(candidate => candidate.source !== "自制")
    .sort((a, b) => poolTie(`ordinary-diversity:${a.family}`) - poolTie(`ordinary-diversity:${b.family}`));
  for (const candidate of ordinaryCandidates) {
    const ordinarySelected = [...selected.values()].filter(entry => entry.source !== "自制").length;
    if (ordinarySelected >= ordinaryDiversityTarget || selected.size >= poolSize) break;
    selected.set(candidate.family, candidate);
  }
  for (const candidate of ranked) {
    if (selected.size >= poolSize) break;
    selected.set(candidate.family, candidate);
  }
  const pool = [...selected.values()];
  const shallow = criticalRoles.filter(role => {
    const required = role === "removal" ? Math.ceil(managerLimit * 2 / 3) : Math.min(managerLimit, depthTarget);
    return pool.filter(candidate => candidate.roles.has(role)).length < required;
  });
  if (shallow.length) throw new Error(`Candidate pool lacks functional depth for: ${shallow.join(", ")}`);
  return pool;
}

function keepStronger(map: Map<string, Candidate>, candidate: Candidate): void {
  const existing = map.get(candidate.family);
  if (existing?.source === "自制") return;
  if (candidate.source === "自制") { map.set(candidate.family, candidate); return; }
  if (!existing || candidate.strength > existing.strength) map.set(candidate.family, candidate);
}

function makeCandidate(id: string, family: string, name: string, source: string, set: PokemonSet, dex: ReturnType<typeof Dex.mod>, debutGeneration?: number): Candidate {
  const species = dex.species.get(set.species);
  const moves = set.moves.map(move => dex.moves.get(move));
  const ids = new Set(moves.map(move => move.id));
  const roles = new Set<Role>();
  if (["stealthrock", "spikes", "toxicspikes", "stickyweb", "ceaselessedge"].some(move => ids.has(move))) roles.add("hazards");
  if (["defog", "rapidspin", "tidyup", "mortalspin"].some(move => ids.has(move))) roles.add("removal");
  if (moves.some(move => move.flags.heal) || sourceAbilities(dex, set.ability).has("regenerator")) roles.add("recovery");
  if (["uturn", "voltswitch", "flipturn", "partingshot", "batonpass"].some(move => ids.has(move))) roles.add("pivot");
  if (moves.some(move => hasPositiveBoost(move.boosts) || hasPositiveBoost(move.self?.boosts))) roles.add("setup");
  if (moves.some(move => move.priority > 0)) roles.add("priority");
  if (["reflect", "lightscreen", "auroraveil"].some(move => ids.has(move))) roles.add("screens");
  if (["toxic", "willowisp", "thunderwave", "nuzzle", "yawn", "spore", "sleeppowder"].some(move => ids.has(move))) roles.add("status");
  if (moves.some(move => move.category === "Physical")) roles.add("physical");
  if (moves.some(move => move.category === "Special")) roles.add("special");
  const custom = source === "自制";
  const candidate: Candidate = {id, assetId: `${family}:standard:1`, family, name, source, set: cloneSet(set), types: [...species.types], stats: {...species.baseStats}, roles, strength: 0, market: 0, tier: "standard", scarcity: "standard", supplyCap: 1, economicClass: custom ? "unique" : "background", debutGeneration: debutGeneration ?? species.gen ?? 9, configurationSource: custom ? "locked-custom" : "ai"};
  candidate.strength = rawStrength(candidate, dex);
  return candidate;
}

function configureOfficialSet(speciesName: string, profile: ManagerProfile | undefined, dex: ReturnType<typeof Dex.mod>): PokemonSet {
  const species = dex.species.get(speciesName);
  let legalMoveIds = legalMoveIdsCache.get(species.id);
  if (!legalMoveIds) {
    const learnset = dex.species.getLearnsetData(species.id).learnset ?? {};
    legalMoveIds = Object.keys(learnset);
    legalMoveIdsCache.set(species.id, legalMoveIds);
  }
  const genome = profile?.genome;
  const physicalBias = species.baseStats.atk - species.baseStats.spa;
  const physical = physicalBias + (genome?.configuration?.coverageBias ?? 0) * 8 >= 0;
  const statusBias = genome?.configuration?.statusMoveBias ?? 0;
  const accuracyRisk = genome?.configuration?.accuracyRisk ?? 0;
  const scored = legalMoveIds.map(id => dex.moves.get(id)).filter(move => move.exists && !move.isNonstandard && move.id !== "hiddenpower").map(move => {
    const accuracy = move.accuracy === true ? 100 : move.accuracy;
    const stab = move.type !== "???" && species.types.includes(move.type) ? 1.35 : 1;
    const categoryFit = move.category === "Status" ? 1 : (physical === (move.category === "Physical") ? 1.25 : .72);
    const genericStatusValue = 35 + (move.flags.heal ? 45 : 0) + (hasPositiveBoost(move.boosts) || hasPositiveBoost(move.self?.boosts) ? 35 : 0) + (move.status || move.volatileStatus ? 25 : 0) + (move.sideCondition || move.weather || move.terrain ? 30 : 0);
    const utility = move.category === "Status" ? genericStatusValue * (1 + statusBias) : move.basePower * stab * categoryFit + Math.max(0, move.priority) * 20;
    const learned = configurationPosterior(profile, "moves", move.id);
    const exploration = profile ? boundedDraftJitter(seed, `${profile.id}:configure:${species.id}:${move.id}`, seasonNumber) * profile.learning.exploration * 18 : 0;
    const programAdjustment = profile && programEvolution ? evaluateStrategyProgram(profile.strategyProgram, "configure", {baseline: utility / 150, strength: move.basePower / 150, accuracy: accuracy / 100, speed: species.baseStats.spe / 200, bulk: (species.baseStats.hp + species.baseStats.def + species.baseStats.spd) / 500, roleBreadth: move.category === "Status" ? 1 : 0}).value * 8 : 0;
    return {move, score: utility * (1 - Math.max(0, 100 - accuracy) / 180 * (1 - accuracyRisk)) * learned + exploration + programAdjustment + poolTie(`set:${profile?.id ?? "baseline"}:${species.id}:${move.id}`) / 1e9};
  }).sort((a, b) => b.score - a.score);
  const selected: typeof scored = [];
  const attacks = scored.filter(entry => entry.move.category !== "Status");
  if (attacks[0]) selected.push(attacks[0]);
  for (const entry of scored) {
    if (selected.length >= 4) break;
    if (selected.some(choice => choice.move.id === entry.move.id)) continue;
    if (entry.move.category === "Status" && selected.filter(choice => choice.move.category === "Status").length >= (statusBias > .08 ? 2 : 1)) continue;
    if (entry.move.category !== "Status" && selected.some(choice => choice.move.category !== "Status" && choice.move.type === entry.move.type) && scored.some(choice => choice.move.category !== "Status" && !selected.some(picked => picked.move.type === choice.move.type) && choice.score >= entry.score * .72)) continue;
    selected.push(entry);
  }
  const moves = selected.slice(0, 4).map(entry => entry.move.name);
  while (moves.length < 4 && attacks[moves.length]) moves.push(attacks[moves.length].move.name);
  const bulky = species.baseStats.hp + species.baseStats.def + species.baseStats.spd > 285 || (genome?.configuration?.bulkBias ?? 0) > .08;
  const fast = species.baseStats.spe >= 80 || (genome?.configuration?.speedInvestment ?? 0) > .08;
  const attackStat = physical ? "atk" : "spa";
  const secondary = bulky ? "hp" : fast ? "spe" : "hp";
  const evs = {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0};
  evs[attackStat] = 252;
  evs[secondary] = 252;
  evs[secondary === "spe" ? "hp" : "spe"] = 4;
  const choiceBias = genome?.configuration?.choiceItemBias ?? 0;
  const recoveryBias = genome?.configuration?.recoveryItemBias ?? 0;
  const itemOptions = [
    {name: "Heavy-Duty Boots", prior: 1},
    {name: "Leftovers", prior: 1 + (bulky ? .18 : 0) + recoveryBias},
    {name: physical ? "Choice Band" : "Choice Specs", prior: 1 + choiceBias},
    {name: "Life Orb", prior: 1 + (genome?.systems?.offense ?? 0) * .3},
    {name: "Focus Sash", prior: 1 + (fast ? .08 : 0)},
  ].map(option => ({...option, score: option.prior * configurationPosterior(profile, "items", toID(option.name)) + (profile ? boundedDraftJitter(seed, `${profile.id}:item:${species.id}:${toID(option.name)}`, seasonNumber) * profile.learning.exploration * .25 : 0)})).sort((a, b) => b.score - a.score);
  const item = itemOptions[0].name;
  const nature = physical ? (fast ? "Jolly" : bulky ? "Adamant" : "Adamant") : (fast ? "Timid" : bulky ? "Modest" : "Modest");
  return {name: species.name, species: species.name, item, ability: Object.values(species.abilities)[0] ?? "", moves, nature, evs, ivs: {hp: 31, atk: physical ? 31 : 0, def: 31, spa: 31, spd: 31, spe: 31}, level: 100, gender: ""};
}

function configurationPosterior(profile: ManagerProfile | undefined, kind: "moves" | "items", id: string): number {
  const posterior = profile?.configurationMemory?.[kind]?.[id];
  if (!posterior) return 1;
  return .65 + posterior.mean * .7 * posterior.confidence + .35 * (1 - posterior.confidence);
}

function configureCandidateForManager(manager: Manager, candidate: Candidate, dex: ReturnType<typeof Dex.mod>): Candidate {
  if (candidate.configurationSource === "locked-custom") return candidate;
  const cacheKey = `${manager.id}:${candidate.id}:${programEvolution ? strategyProgramHash(manager.strategyProgram!) : "parameters"}`;
  const cached = configuredCandidateCache.get(cacheKey);
  if (cached) return cached;
  const set = configureOfficialSet(candidate.set.species, manager, dex);
  const configured = makeCandidate(candidate.id, candidate.family, candidate.name, candidate.source, set, dex, candidate.debutGeneration);
  const result = {...configured, assetId: candidate.assetId, scarcity: candidate.scarcity, supplyCap: candidate.supplyCap, economicClass: candidate.economicClass, tier: candidate.tier, market: candidate.market};
  configuredCandidateCache.set(cacheKey, result);
  return result;
}

function hasPositiveBoost(boosts: Partial<Record<string, number>> | undefined): boolean {
  return Boolean(boosts && Object.values(boosts).some(value => typeof value === "number" && value > 0));
}

function rawStrength(candidate: Candidate, dex: ReturnType<typeof Dex.mod>): number {
  const abilities = sourceAbilities(dex, candidate.set.ability);
  const items = sourceItems(dex, candidate.set.item);
  let atk = candidate.stats.atk;
  let spa = candidate.stats.spa;
  if (abilities.has("hugepower") || abilities.has("purepower")) atk *= 2;
  if (items.has("choiceband")) atk *= 1.5;
  if (items.has("choicespecs")) spa *= 1.5;
  if (items.has("lifeorb")) { atk *= 1.3; spa *= 1.3; }
  let physicalBulk = candidate.stats.hp * candidate.stats.def;
  let specialBulk = candidate.stats.hp * candidate.stats.spd;
  if (abilities.has("furcoat")) physicalBulk *= 2;
  if (abilities.has("icescales")) specialBulk *= 2;
  return Math.max(atk, spa) * .75 + candidate.stats.spe * .5 + Math.sqrt(physicalBulk + specialBulk) * .65 + candidate.roles.size * 8 + (abilities.has("technician") && abilities.has("skilllink") ? 35 : 0);
}

function calibratePool(pool: Candidate[], dex: ReturnType<typeof Dex.mod>): void {
  const ranked = [...pool].sort((a, b) => b.strength - a.strength);
  const premium = ranked.filter(candidate => candidate.scarcity !== "standard");
  const premiumIndex = new Map(premium.map((candidate, index) => [candidate.assetId, index]));
  ranked.forEach((candidate, index) => {
    if (dualLayer && candidate.economicClass === "background") {
      candidate.tier = "standard";
      candidate.market = 0;
      return;
    }
    candidate.tier = candidate.scarcity === "standard" ? "standard" : "premium";
    const scarceIndex = premiumIndex.get(candidate.assetId) ?? 0;
    candidate.market = candidate.tier === "premium"
      ? Math.round(30 - scarceIndex / Math.max(1, premium.length - 1) * 8)
      : Math.max(3, Math.round(15 - index / Math.max(1, ranked.length - 1) * 10));
  });
  const marketHistory = loadMarketHistory();
  for (const candidate of pool) {
    if (dualLayer && candidate.economicClass === "background") continue;
    const history = marketHistory[candidate.family];
    if (!history) continue;
    const production = history.appearances > 0 ? Math.min(4, history.kos / history.appearances * 2) : 0;
    const ceiling = candidate.tier === "premium" ? 30 : 18;
    candidate.market = Math.max(3, Math.min(ceiling, Math.round(candidate.market * .7 + history.averagePrice * .3 + production)));
  }
  ledger.add({stage: "calibration", actor: "system", decision: "锁定赛季候选池与参考价", selected: `${pool.length}个资产`, context: {season: seasonNumber, legendaryAssets: pool.filter(candidate => candidate.scarcity === "legendary").length, uniqueCustomAssets: pool.filter(candidate => candidate.scarcity === "unique-custom").length, eliteOrdinarySpecies: new Set(pool.filter(candidate => candidate.scarcity === "elite-ordinary").map(candidate => candidate.family)).size, eliteOrdinaryAssets: pool.filter(candidate => candidate.scarcity === "elite-ordinary").length, premium: pool.filter(candidate => candidate.tier === "premium").length, roleDepth: Object.fromEntries((["hazards", "removal", "recovery", "pivot"] as Role[]).map(role => [role, new Set(pool.filter(candidate => candidate.roles.has(role)).map(candidate => candidate.family)).size])), custom: new Set(pool.filter(candidate => candidate.source === "自制").map(candidate => candidate.family)).size, modern: new Set(pool.filter(candidate => candidate.source.startsWith("现代:")).map(candidate => candidate.family)).size, generated: new Set(pool.filter(candidate => candidate.source === "Showdown成熟配置").map(candidate => candidate.family)).size, historicalFamilies: Object.keys(marketHistory).length, priceRange: [3, 30]}, alternatives: [], rationale: ["神兽、幻兽与35只魔改宝可梦各自永久一个资产", "顶级普通种按固定种子发行1至3个资产且永不超发", "高级货进入公开竞拍，普通功能件保留充足替代"]});
}

function loadMarketHistory(): Record<string, {averagePrice: number; appearances: number; kos: number}> {
  if (!marketHistoryPath || !fs.existsSync(marketHistoryPath)) return {};
  const parsed = JSON.parse(fs.readFileSync(marketHistoryPath, "utf8")) as {families?: Record<string, {averagePrice: number; appearances: number; kos: number}>};
  const families = parsed.families ?? {};
  for (const [family, history] of Object.entries(families)) {
    if (!Number.isFinite(history.averagePrice) || history.averagePrice < 0 || !Number.isFinite(history.appearances) || history.appearances < 0 || !Number.isFinite(history.kos) || history.kos < 0) throw new Error(`Invalid market history for ${family}`);
  }
  return families;
}

function applyKeepers(available: Map<string, Candidate>, dex: ReturnType<typeof Dex.mod>): void {
  if (!keeperPath || !fs.existsSync(keeperPath)) return;
  const parsed = JSON.parse(fs.readFileSync(keeperPath, "utf8")) as {managers?: Record<string, Array<{assetId?: string; family: string; pokemon: string; salary: number; years: number}>>};
  for (const manager of managers) {
    const keepers = parsed.managers?.[manager.id] ?? [];
    if (keepers.length > maximumKeepers) throw new Error(`${manager.id} cannot retain more than ${maximumKeepers} keepers`);
    const committed = keepers.reduce((sum, keeper) => sum + keeper.salary, 0);
    if (!Number.isInteger(committed) || committed > keeperCap) throw new Error(`${manager.id} keeper salaries exceed the keeper cap`);
    if (new Set(keepers.map(keeper => keeper.family)).size !== keepers.length) throw new Error(`${manager.id} keeper families must be unique`);
    for (const keeper of keepers) {
      const match = [...available.values()].find(candidate => keeper.assetId ? candidate.assetId === keeper.assetId : candidate.family === keeper.family);
      if (!match) throw new Error(`Keeper ${keeper.pokemon} (${keeper.family}) is absent from the season pool`);
      if (!Number.isInteger(keeper.salary) || keeper.salary < 1 || (!separatePayroll && keeper.salary > manager.budget) || !Number.isInteger(keeper.years) || keeper.years < 1) throw new Error(`Invalid keeper contract for ${keeper.pokemon}`);
      const decision = ledger.add({stage: "waiver", actor: manager.id, decision: `续约第${keeper.years}年成员`, selected: keeper.pokemon, context: {season: seasonNumber, family: keeper.family, salary: keeper.salary, budgetBefore: manager.budget}, alternatives: [{option: "释放至公开市场", cost: 0}], rationale: [`保留上季核心，薪资${keeper.salary}`, "最多保留三人且总承诺不超过预算"]});
      if (!separatePayroll) manager.budget -= keeper.salary;
      if (dualLayer && match.economicClass === "background") throw new Error(`Background species ${match.name} cannot have a keeper contract`);
      manager.roster.push(newRosterEntry(configureCandidateForManager(manager, match, dex), "keeper", keeper.salary, decision.id, keeper));
      available.delete(match.id);
    }
  }
}

function runAuction(available: Map<string, Candidate>, dex: ReturnType<typeof Dex.mod>): void {
  const nominationOrder = shuffledManagers("auction-lottery");
  for (let lot = 0; lot < auctionLots; lot += 1) {
    const nominator = nominationOrder[lot % nominationOrder.length];
    const premiumAvailable = [...available.values()].filter(candidate => candidate.tier === "premium");
    if (!premiumAvailable.length) break;
    const nominationRanked = premiumAvailable.map(candidate => {
      const ownValue = managerValue(nominator, candidate, dex);
      const marketPressure = managers.filter(manager => manager !== nominator).reduce((sum, manager) => sum + managerValue(manager, candidate, dex), 0) / Math.max(1, managers.length - 1);
      return {candidate, value: ownValue * (1 - nominator.economics.marketAwareness * .35) + marketPressure * nominator.economics.marketAwareness * .35};
    }).sort((a, b) => b.value - a.value);
    const nominated = nominationRanked[0].candidate;
    const bids = managers.map(manager => bidFor(manager, nominated, dex, lot)).sort((a, b) => b.bid - a.bid || tie(a.manager.id, lot) - tie(b.manager.id, lot));
    const winner = bids[0].bid > 0 ? bids[0] : null;
    const decision = ledger.add({stage: "auction", actor: nominator.id, decision: `提名并竞价 ${nominated.name}`, selected: winner ? `${winner.manager.name} ${winner.bid}` : "流拍", context: {lot: lot + 1, family: nominated.family, assetId: nominated.assetId, nominator: nominator.name, referencePrice: nominated.market, budgets: Object.fromEntries(managers.map(manager => [manager.id, manager.budget])), bids: bids.map(bid => ({manager: bid.manager.id, bid: bid.bid, ceiling: bid.ceiling, rationale: bid.rationale, whiteBox: bid.whiteBoxTrace}))}, alternatives: nominationRanked.slice(1, 5).map(entry => ({option: entry.candidate.name, score: entry.value})), rationale: winner ? [`${winner.manager.name}最高出价${winner.bid}`, `次高价${bids[1]?.bid ?? 0}`] : ["所有经理选择保留预算"]});
    if (!winner) { available.delete(nominated.id); continue; }
    winner.manager.budget -= winner.bid;
    winner.manager.roster.push(newRosterEntry(configureCandidateForManager(winner.manager, nominated, dex), "auction", winner.bid, decision.id));
    available.delete(nominated.id);
  }
}

function runPortfolioAuction(available: Map<string, Candidate>, dex: ReturnType<typeof Dex.mod>): void {
  const premium = [...available.values()].filter(candidate => candidate.tier === "premium");
  const offered = premium.map(candidate => ({
    candidate,
    pressure: managers.reduce((sum, manager) => sum + managerValue(manager, candidate, dex), 0) / managers.length,
  })).sort((a, b) => b.pressure - a.pressure || b.candidate.market - a.candidate.market || a.candidate.id.localeCompare(b.candidate.id)).slice(0, auctionLots).map(entry => entry.candidate);
  const bidDetails = new Map<string, ReturnType<typeof bidFor>>();
  const bids: PortfolioBid[] = [];
  for (const candidate of offered) for (const manager of managers) {
    const detail = bidFor(manager, candidate, dex, offered.indexOf(candidate));
    bidDetails.set(`${manager.id}:${candidate.id}`, detail);
    bids.push({managerId: manager.id, assetId: candidate.id, bid: detail.bid, utility: managerValue(manager, candidate, dex)});
  }
  const awards = solvePortfolioAuction(offered.map(candidate => candidate.id), bids, managers.map(manager => ({
    managerId: manager.id,
    budget: manager.budget,
    reserve: Math.max(0, minimumRosterSize - manager.roster.length) ,
    maxWins: Math.max(0, Math.min(maximumAuctionWins - manager.roster.filter(entry => entry.method === "auction").length, maximumRosterSize - manager.roster.length)),
  })), `${seed}:portfolio:${seasonNumber}`);
  const awardByAsset = new Map(awards.map(award => [award.assetId, award]));
  for (const [index, candidate] of offered.entries()) {
    const award = awardByAsset.get(candidate.id);
    const winner = award ? managers.find(manager => manager.id === award.managerId)! : null;
    const rankedBids = bids.filter(bid => bid.assetId === candidate.id && bid.bid > 0).sort((a, b) => b.bid - a.bid || b.utility - a.utility);
    const auditedBids = rankedBids.map(bid => ({...bid, whiteBox: bidDetails.get(`${bid.managerId}:${candidate.id}`)?.whiteBoxTrace}));
    const decision = ledger.add({stage: "auction", actor: "portfolio-market", decision: `组合市场分配 ${candidate.name}`, selected: winner ? `${winner.name} ${award!.payment}` : "未成交", context: {lot: index + 1, family: candidate.family, assetId: candidate.assetId, mode: "portfolio", pricing: "critical-bid-approximation", referencePrice: candidate.market, submittedBids: rankedBids.length, winningBid: award?.bid ?? 0, criticalBidPrice: award?.payment ?? 0, runnerUpBid: award?.runnerUpBid ?? 0, bids: auditedBids}, alternatives: rankedBids.slice(0, 5).map(bid => ({option: bid.managerId, score: bid.utility, cost: bid.bid})), rationale: winner ? ["全体高级资产同时求解", "在预算、名单和唯一性约束下最大化组合效用", `使用透明临界报价近似支付${award!.payment}`] : ["没有可行的正报价分配"]});
    if (winner) {
      winner.budget -= award!.payment;
      winner.roster.push(newRosterEntry(configureCandidateForManager(winner, candidate, dex), "auction", award!.payment, decision.id));
    }
    available.delete(candidate.id);
  }
}

function bidFor(manager: Manager, candidate: Candidate, dex: ReturnType<typeof Dex.mod>, lot: number) {
  const reserve = Math.max(0, minimumRosterSize - manager.roster.length - 1);
  const hardRejections = manager.roster.length >= maximumRosterSize ? ["名单容量已满"]
    : manager.roster.filter(entry => entry.method === "auction").length >= maximumAuctionWins ? [`已达到${maximumAuctionWins}名拍卖成员上限`]
      : manager.roster.some(entry => entry.candidate.family === candidate.family) ? ["同一经理不重复持有相同基础品种"] : [];
  if (hardRejections.length) {
    const whiteBoxTrace = evaluateWhiteBoxBid({decisionId: `bid:${seasonNumber}:${lot + 1}:${manager.id}:${candidate.id}`, managerId: manager.id, candidateId: candidate.id, mode: sportsMarket ? "sports-market" : "standard", budget: manager.budget, reserve, market: candidate.market, fit: 0, fundamental: 0, starPremium: manager.economics.starPremium, bidAggression: manager.economics.bidAggression, cashUtility: manager.economics.cashUtility, remainingNeed: Math.max(1, 4 - manager.roster.length), scarceMultiplier: 1, shade: 0, hardRejections});
    return {manager, bid: 0, ceiling: 0, rationale: hardRejections, whiteBoxTrace};
  }
  const fit = managerValue(manager, candidate, dex);
  const economics = manager.economics;
  const fundamental = candidate.strength / 18 + rosterSynergy(manager.roster.map(entry => entry.candidate), candidate, dex) * 2 + roleTargetValue(manager, countRoles(manager.roster.map(entry => entry.candidate)), candidate.roles, manager.roster.length) * 2;
  const demand = sportsMarket
    ? fundamental * (.8 + economics.bidAggression * .25) + candidate.market * .2 - economics.cashUtility * Math.max(1, 4 - manager.roster.length)
    : candidate.market * (.65 + economics.starPremium * .3) + fit * (2.5 + economics.bidAggression * 2) - economics.cashUtility * Math.max(1, 4 - manager.roster.length);
  const scarcePreference = dualLayer ? 1 + (manager.genome?.organization?.scarceConcentration ?? 0) * .35 : 1;
  const ceiling = Math.max(0, Math.min(manager.budget - reserve, Math.round(demand * scarcePreference)));
  const shade = Math.floor(boundedDraftJitter(seed, `${manager.id}:${candidate.id}`, lot) * bidShadowValues["bid.shadescale"]);
  const bid = Math.max(0, ceiling - shade);
  const whiteBoxTrace = evaluateWhiteBoxBid({decisionId: `bid:${seasonNumber}:${lot + 1}:${manager.id}:${candidate.id}`, managerId: manager.id, candidateId: candidate.id, mode: sportsMarket ? "sports-market" : "standard", budget: manager.budget, reserve, market: candidate.market, fit, fundamental, starPremium: economics.starPremium, bidAggression: economics.bidAggression, cashUtility: economics.cashUtility, remainingNeed: Math.max(1, 4 - manager.roster.length), scarceMultiplier: scarcePreference, shade, parameters: bidShadowValues});
  if (whiteBoxTrace.ceiling !== ceiling || whiteBoxTrace.bid !== bid) throw new Error(`White-box bid decomposition drifted for ${manager.id}:${candidate.id}`);
  return {manager, bid, ceiling, rationale: [`通用实力与适配估值${fit.toFixed(2)}`, sportsMarket ? `独立基本面估值${fundamental.toFixed(2)}，旧市场价仅作弱锚` : `参考市场价${candidate.market}`, `保留至少${reserve}资金完成名单`, shade ? `策略性压价${shade}` : "按上限竞价"], whiteBoxTrace};
}

function runSupplementalDraft(available: Map<string, Candidate>, dex: ReturnType<typeof Dex.mod>): void {
  const baseOrder = [...managers].sort((a, b) => b.budget - a.budget || tie(a.id, 0) - tie(b.id, 0));
  const orders = thirdRoundReversalOrder(baseOrder.length, 12);
  let overall = 0;
  for (const order of orders) {
    for (const index of order) {
      const manager = baseOrder[index];
      if (manager.roster.length >= targetRosterSize(manager)) continue;
      if (manager.budget < 1) {
        if (manager.roster.length < minimumRosterSize) throw new Error(`${manager.id} has no budget for required supplemental picks`);
        continue;
      }
      const shortlist = [...available.values()].filter(candidate => candidate.tier === "standard")
        .map(candidate => ({candidate, baseValue: managerValue(manager, candidate, dex)}))
        .sort((a, b) => b.baseValue - a.baseValue || tie(a.candidate.id, overall) - tie(b.candidate.id, overall))
        .slice(0, 24);
      const ranked = shortlist.map(({candidate, baseValue}) => {
        const completion = completionValue(manager, candidate, available, dex);
        const exploration = boundedDraftJitter(seed, `${manager.id}:explore:${candidate.id}`, overall) * manager.learning.exploration;
        return {candidate, completion, exploration, value: baseValue + completion + exploration};
      }).sort((a, b) => b.value - a.value || tie(a.candidate.id, overall) - tie(b.candidate.id, overall));
      const selected = ranked[0];
      const whiteBoxCandidates = ranked.map(entry => {
        const candidate = acquisitionWhiteBoxCandidate(manager, entry.candidate, dex, {completionValue: entry.completion, exploration: entry.exploration});
        const difference = Math.abs(whiteBoxAcquisitionTotal(candidate) - entry.value);
        if (difference > 1e-8) throw new Error(`White-box acquisition decomposition drifted by ${difference} for ${candidate.id}`);
        return candidate;
      });
      const whiteBoxTrace = evaluateWhiteBoxDecision({decisionId: `acquire:supplemental:${seasonNumber}:${overall + 1}:${manager.id}`, candidates: whiteBoxCandidates, reasonableBand: acquisitionShadowValues["acquire.reasonableband"], styleContributionLimit: acquisitionShadowValues["acquire.stylelimit"]});
      overall += 1;
      const decision = ledger.add({stage: "draft", actor: manager.id, decision: `补强第${manager.roster.length + 1}人`, selected: selected.candidate.name, context: {overallPick: overall, remainingBudget: manager.budget, roster: manager.roster.map(entry => entry.candidate.name), scarcity: missingRoles(manager), whiteBoxShadow: summarizeWhiteBoxShadow(whiteBoxTrace, selected.candidate.id, 3)}, alternatives: ranked.slice(1, 5).map(entry => ({option: entry.candidate.name, score: entry.value, rejectedBecause: explainRejection(manager, entry.candidate)})), rationale: explainFit(manager, selected.candidate), expectedValue: selected.value, confidence: confidence(ranked[0].value, ranked[1]?.value)});
      manager.roster.push(newRosterEntry(selected.candidate, "supplemental", 1, decision.id));
      manager.budget -= 1;
      available.delete(selected.candidate.id);
    }
    if (managers.every(manager => manager.roster.length >= targetRosterSize(manager))) break;
  }
  if (managers.some(manager => manager.roster.length < minimumRosterSize || manager.roster.length > maximumRosterSize)) throw new Error("Supplemental draft failed to build a legal roster");
}

function runBackgroundRegistration(pool: Candidate[], dex: ReturnType<typeof Dex.mod>): void {
  const background = pool.filter(candidate => candidate.economicClass === "background");
  if (background.length < minimumRosterSize) throw new Error(`Public background pool has only ${background.length} species`);
  for (const manager of managers) {
    let pick = 0;
    while (manager.roster.length < targetRosterSize(manager)) {
      const ranked = backgroundShortlist(manager, background, dex).map(candidate => {
        const configured = configureCandidateForManager(manager, candidate, dex);
        const exploration = boundedDraftJitter(seed, `${manager.id}:registration:${candidate.family}`, pick) * manager.learning.exploration * (1 + (manager.genome?.organization?.experimentation ?? 0));
        const publicPreference = manager.genome?.organization?.backgroundReliance ?? 0;
        const publicAdjustment = publicPreference * .2;
        return {candidate: configured, exploration, publicAdjustment, value: managerValue(manager, configured, dex) + exploration + publicAdjustment};
      }).sort((a, b) => b.value - a.value || a.candidate.family.localeCompare(b.candidate.family));
      const selected = ranked[0];
      if (!selected) throw new Error(`${manager.id} cannot complete a public registration roster`);
      const whiteBoxCandidates = ranked.map(entry => {
        const candidate = acquisitionWhiteBoxCandidate(manager, entry.candidate, dex, {exploration: entry.exploration, publicPreference: entry.publicAdjustment});
        const difference = Math.abs(whiteBoxAcquisitionTotal(candidate) - entry.value);
        if (difference > 1e-8) throw new Error(`White-box registration decomposition drifted by ${difference} for ${candidate.id}`);
        return candidate;
      });
      const whiteBoxTrace = evaluateWhiteBoxDecision({decisionId: `acquire:registration:${seasonNumber}:${manager.id}:${pick + 1}`, candidates: whiteBoxCandidates, reasonableBand: registrationShadowValues["registration.reasonableband"], styleContributionLimit: registrationShadowValues["registration.stylelimit"]});
      const decision = ledger.add({stage: "draft", actor: manager.id, decision: `自由注册第${manager.roster.length + 1}名成员`, selected: selected.candidate.name, context: {economicClass: "background", cost: 0, sharedPool: true, unlockGeneration, configuredSet: selected.candidate.set, whiteBoxShadow: summarizeWhiteBoxShadow(whiteBoxTrace, selected.candidate.id, 3)}, alternatives: ranked.slice(1, 5).map(entry => ({option: entry.candidate.name, score: entry.value})), rationale: [...explainFit(manager, selected.candidate), "普通品种不占合同、工资或交易资产空间"], expectedValue: selected.value, confidence: confidence(selected.value, ranked[1]?.value)});
      manager.roster.push(newRosterEntry(selected.candidate, "registration", 0, decision.id));
      pick += 1;
    }
  }
  if (managers.some(manager => manager.roster.length < minimumRosterSize || manager.roster.length > maximumRosterSize)) throw new Error("Public registration failed to build a legal roster");
}

function runBackgroundAdjustment(round: number, pool: Candidate[], dex: ReturnType<typeof Dex.mod>): Array<Record<string, unknown>> {
  const background = pool.filter(candidate => candidate.economicClass === "background");
  const results: Array<Record<string, unknown>> = [];
  for (const manager of managers) {
    const current = manager.roster.filter(entry => entry.candidate.economicClass === "background").sort((a, b) => managerValue(manager, a.candidate, dex) - managerValue(manager, b.candidate, dex))[0];
    if (!current) continue;
    const ranked = backgroundShortlist(manager, background, dex).map(candidate => {
      const configured = configureCandidateForManager(manager, candidate, dex);
      return {candidate: configured, value: managerValue(manager, configured, dex)};
    }).sort((a, b) => b.value - a.value || a.candidate.family.localeCompare(b.candidate.family));
    const replacement = ranked[0];
    if (!replacement) continue;
    const currentValue = managerValue(manager, current.candidate, dex);
    if (replacement.value < currentValue * marketFlowShadowValues["background.minimumupgrade"]) continue;
    const whiteBoxCandidates = ranked.map(entry => {
      const candidate = acquisitionWhiteBoxCandidate(manager, entry.candidate, dex, {});
      const difference = Math.abs(whiteBoxAcquisitionTotal(candidate) - entry.value);
      if (difference > 1e-8) throw new Error(`White-box background adjustment decomposition drifted by ${difference} for ${candidate.id}`);
      return candidate;
    });
    const targetTrace = evaluateWhiteBoxDecision({decisionId: `market:background-target:${seasonNumber}:${round}:${manager.id}`, candidates: whiteBoxCandidates, reasonableBand: registrationShadowValues["registration.reasonableband"], styleContributionLimit: registrationShadowValues["registration.stylelimit"]});
    const replacementTrace = evaluateMarketReplacement({decisionId: `market:background-replacement:${seasonNumber}:${round}:${manager.id}:${replacement.candidate.id}`, mode: "background", budget: manager.budget, rosterLegal: manager.roster.length >= minimumRosterSize, duplicateFamily: manager.roster.some(entry => entry !== current && entry.candidate.family === replacement.candidate.family), currentValue, targetValue: replacement.value, currentStrength: current.candidate.strength, targetStrength: replacement.candidate.strength, fillsNeed: false, cost: 0, continuityEvidence: Math.min(1, current.appearances / Math.max(1, round)), parameters: marketFlowShadowValues});
    const actionTrace = evaluateWhiteBoxDecision({decisionId: `market:background-action:${seasonNumber}:${round}:${manager.id}`, reasonableBand: 0, styleContributionLimit: 0, candidates: [{id: "replace", hardRejections: replacementTrace.accepted ? [] : replacementTrace.hardRejections, rational: [{id: "background.targetvalue", group: "roster", source: "goal", value: replacement.value, reason: "Expected value after replacement"}]}, {id: "hold", rational: [{id: "background.currentvalue", group: "roster", source: "risk", value: currentValue, reason: "Current value plus protected continuity"}, {id: "background.continuity", group: "roster", source: "risk", value: replacementTrace.switchCost, reason: "Observed-use continuity protection"}]}]});
    if (backgroundHoldExperimentEnabled(manager.id, round) && actionTrace.selected === "hold") {
      ledger.add({stage: "waiver", actor: manager.id, decision: `第${round}轮白箱实验保持公共名单`, selected: current.candidate.name, context: {round, proposed: replacement.candidate.name, cost: 0, economicClass: "background", policy: "whitebox-experiment", whiteBoxTarget: summarizeWhiteBoxShadow(targetTrace, replacement.candidate.id, 3), whiteBoxAction: summarizeWhiteBoxShadow(actionTrace, "replace", 2), whiteBoxReplacement: replacementTrace}, alternatives: [{option: replacement.candidate.name, score: replacement.value}], rationale: ["边际升级未覆盖已使用成员的连续性成本", "实验仅作用于指定经理、赛季和轮次"]});
      results.push({type: "background-hold", round, manager: manager.id, retained: current.candidate.name, proposed: replacement.candidate.name, cost: 0});
      continue;
    }
    const decision = ledger.add({stage: "waiver", actor: manager.id, decision: `第${round}轮调整公共名单`, selected: replacement.candidate.name, context: {released: current.candidate.name, cost: 0, economicClass: "background", whiteBoxTarget: summarizeWhiteBoxShadow(targetTrace, replacement.candidate.id, 3), whiteBoxAction: summarizeWhiteBoxShadow(actionTrace, "replace", 2), whiteBoxReplacement: replacementTrace}, alternatives: ranked.slice(1, 5).map(entry => ({option: entry.candidate.name, score: entry.value})), rationale: ["根据赛季样本修正体系适配", "公共成员可自由更换且不发生资产转移"]});
    manager.roster[manager.roster.indexOf(current)] = newRosterEntry(replacement.candidate, "registration", 0, decision.id);
    manager.departed.push(current);
    results.push({type: "background-registration", round, manager: manager.id, signed: replacement.candidate.name, released: current.candidate.name, cost: 0});
  }
  return results;
}

function backgroundShortlist(manager: Manager, background: Candidate[], dex: ReturnType<typeof Dex.mod>): Candidate[] {
  const available = background.filter(candidate => !manager.roster.some(entry => entry.candidate.family === candidate.family));
  const coarse = available.map(candidate => ({candidate, value: managerValue(manager, candidate, dex)}));
  const selected = new Map<string, Candidate>();
  const keep = (entries: typeof coarse, count: number): void => {
    for (const entry of [...entries].sort((a, b) => b.value - a.value || a.candidate.family.localeCompare(b.candidate.family)).slice(0, count)) selected.set(entry.candidate.family, entry.candidate);
  };
  keep(coarse, Math.max(48, maximumRosterSize * 6));
  for (const role of missingRoles(manager)) keep(coarse.filter(entry => entry.candidate.roles.has(role)), 8);
  return [...selected.values()];
}

function targetRosterSize(manager: Manager): number {
  const preference = (manager.traits.flexibility + manager.traits.value + manager.learning.exploration) / 3;
  return Math.max(minimumRosterSize, Math.min(maximumRosterSize, Math.round(minimumRosterSize + preference * (maximumRosterSize - minimumRosterSize))));
}

function managerValue(manager: Manager, candidate: Candidate, dex: ReturnType<typeof Dex.mod>): number {
  const common = candidate.strength / 180;
  const synergy = rosterSynergy(manager.roster.map(entry => entry.candidate), candidate, dex);
  const counter = opponentCounterValue(manager, candidate, dex);
  const flexibility = candidate.roles.size / 6;
  const value = candidate.strength / Math.max(3, candidate.market) / 20;
  const star = candidate.market / 30;
  const risk = riskValue(candidate, dex);
  const weights = normalizedTraitWeights(manager.traits);
  const personal = synergy * weights.synergy + counter * weights.counter + flexibility * weights.flexibility + value * weights.value + star * weights.stars + risk * weights.risk;
  const counts = countRoles(manager.roster.map(entry => entry.candidate));
  const roleFit = roleTargetValue(manager, counts, candidate.roles, manager.roster.length);
  const baseline = common * .7 + personal * 1.8 + roleFit * .35 + systemFit(manager, candidate) * .3;
  const programAdjustment = programEvolution ? evaluateStrategyProgram(manager.strategyProgram, "acquire", {baseline, strength: candidate.strength / 300, price: candidate.market / 30, roleBreadth: candidate.roles.size / 10, speed: candidate.stats.spe / 200, bulk: (candidate.stats.hp + candidate.stats.def + candidate.stats.spd) / 500, rosterSize: manager.roster.length / maximumRosterSize}).value * .15 : 0;
  return baseline + programAdjustment;
}

function backgroundHoldExperimentEnabled(managerId: string, round: number): boolean {
  return process.env.V4_BACKGROUND_POLICY === "whitebox-experiment" && process.env.V4_BACKGROUND_POLICY_TARGET === `${managerId}@${seasonNumber}@${round}`;
}

function acquisitionWhiteBoxCandidate(
  manager: Manager,
  candidate: Candidate,
  dex: ReturnType<typeof Dex.mod>,
  extras: {completionValue?: number; exploration?: number; publicPreference?: number} = {},
): WhiteBoxCandidate {
  const commonStrength = candidate.strength / 180;
  const synergy = rosterSynergy(manager.roster.map(entry => entry.candidate), candidate, dex);
  const counter = opponentCounterValue(manager, candidate, dex);
  const flexibility = candidate.roles.size / 6;
  const value = candidate.strength / Math.max(3, candidate.market) / 20;
  const star = candidate.market / 30;
  const risk = riskValue(candidate, dex);
  const traitWeights = normalizedTraitWeights(manager.traits);
  const roleFit = roleTargetValue(manager, countRoles(manager.roster.map(entry => entry.candidate)), candidate.roles, manager.roster.length);
  const systems = systemFit(manager, candidate);
  const personal = synergy * traitWeights.synergy + counter * traitWeights.counter + flexibility * traitWeights.flexibility + value * traitWeights.value + star * traitWeights.stars + risk * traitWeights.risk;
  const baseline = commonStrength * .7 + personal * 1.8 + roleFit * .35 + systems * .3;
  const programAdjustment = programEvolution ? evaluateStrategyProgram(manager.strategyProgram, "acquire", {baseline, strength: candidate.strength / 300, price: candidate.market / 30, roleBreadth: candidate.roles.size / 10, speed: candidate.stats.spe / 200, bulk: (candidate.stats.hp + candidate.stats.def + candidate.stats.spd) / 500, rosterSize: manager.roster.length / maximumRosterSize}).value * .15 : 0;
  return buildAcquisitionWhiteBoxCandidate({id: candidate.id, commonStrength, roleFit, synergy, counter, flexibility, value, star, risk, traitWeights, systemFit: systems, programAdjustment, ...extras});
}

function systemFit(manager: Manager, candidate: Candidate): number {
  const systems = manager.genome?.systems ?? {};
  let score = (systems.balance ?? 0) * candidate.roles.size / 8;
  if (candidate.roles.has("hazards")) score += systems.hazardPressure ?? 0;
  if (candidate.roles.has("pivot")) score += systems.pivotCycle ?? 0;
  if (candidate.roles.has("setup")) score += systems.setupCore ?? 0;
  if (candidate.roles.has("recovery") || candidate.roles.has("status")) score += (systems.stall ?? 0) * .5;
  if (candidate.roles.has("priority") || candidate.roles.has("physical") || candidate.roles.has("special")) score += (systems.offense ?? 0) * .25;
  if (candidate.stats.spe <= 60) score += (systems.trickRoom ?? 0) * .4;
  return score;
}

function completionValue(manager: Manager, candidate: Candidate, available: Map<string, Candidate>, dex: ReturnType<typeof Dex.mod>): number {
  const shadow = [...manager.roster.map(entry => entry.candidate), candidate];
  let total = 0;
  for (let slot = shadow.length; slot < targetRosterSize(manager); slot += 1) {
    const best = [...available.values()].filter(option => !shadow.includes(option)).map(option => ({option, value: rosterSynergy(shadow, option, dex) + option.strength / 250 + roleTargetValue(manager, countRoles(shadow), option.roles, shadow.length) * .5})).sort((a, b) => b.value - a.value)[0];
    if (!best) break;
    shadow.push(best.option);
    total += best.value;
  }
  return total / Math.max(1, targetRosterSize(manager) - manager.roster.length) * .1;
}

function chooseLineup(manager: Manager, opponent: Manager, dex: ReturnType<typeof Dex.mod>, seriesId: string): RosterEntry[] {
  const combinations = chooseSix(manager.roster).map(lineup => ({lineup, value: lineupValue(manager, lineup.map(entry => entry.candidate), opponent, dex)})).sort((a, b) => b.value - a.value);
  const incumbent = combinations[0];
  if (!incumbent) throw new Error(`${manager.id} has no legal six-member lineup`);
  assertBattleLineup(incumbent.lineup, manager.id);
  const whiteBoxCandidates = combinations.map(option => {
    const candidate = lineupWhiteBoxCandidate(manager, option.lineup.map(entry => entry.candidate), opponent, dex);
    const difference = Math.abs(whiteBoxCandidateTotal(candidate) - option.value);
    if (difference > 1e-8) throw new Error(`White-box lineup decomposition drifted by ${difference} for ${candidate.id}`);
    return candidate;
  });
  const incumbentId = lineupCandidateId(incumbent.lineup.map(entry => entry.candidate));
  const decisionId = `lineup:${seriesId}:${manager.id}`;
  const whiteBoxTrace = evaluateWhiteBoxDecision({
    decisionId,
    candidates: whiteBoxCandidates,
    reasonableBand: lineupShadowValues["lineup.reasonableband"],
    styleContributionLimit: lineupShadowValues["lineup.stylelimit"],
  });
  const experiment=process.env.V4_LINEUP_POLICY==="whitebox-experiment"&&process.env.V4_LINEUP_POLICY_TARGET===decisionId;
  const experimentBand=experiment?boundedExperimentValue("V4_LINEUP_BAND",.5,0,5):whiteBoxTrace.reasonableBand,experimentStyleLimit=experiment?boundedExperimentValue("V4_LINEUP_STYLE_LIMIT",3,0,5):whiteBoxTrace.styleContributionLimit,experimentStyleScale=experiment?boundedExperimentValue("V4_LINEUP_STYLE_SCALE",1.1,0,2):1;
  const experimentTrace=experiment?evaluateWhiteBoxDecision({decisionId,candidates:whiteBoxCandidates.map(candidate=>({...candidate,style:candidate.style?.map(entry=>({...entry,value:entry.value*experimentStyleScale}))})),reasonableBand:experimentBand,styleContributionLimit:experimentStyleLimit}):null;
  const experimental=experimentTrace?.selected?combinations.find(option=>lineupCandidateId(option.lineup.map(entry=>entry.candidate))===experimentTrace.selected):undefined,selected=experimental??incumbent,experimentGate=experimentTrace?evaluateLineupAssistGate(experimentTrace.candidates.find(candidate=>candidate.id===incumbentId),experimentTrace.candidates.find(candidate=>candidate.id===experimentTrace.selected)):null;
  ledger.add({stage: "lineup", actor: manager.id, decision: `对阵${opponent.name}的8选6`, selected: selected.lineup.map(entry => entry.candidate.name), context: {seriesId, roles: [...new Set(selected.lineup.flatMap(entry => [...entry.candidate.roles]))], opponentRoster: opponent.roster.map(entry => entry.candidate.name), benched: manager.roster.filter(entry => !selected.lineup.includes(entry)).map(entry => entry.candidate.name), policy:experiment?"whitebox-experiment":"incumbent",whiteBoxShadow: summarizeWhiteBoxShadow(whiteBoxTrace, incumbentId, process.env.V4_WHITEBOX_FULL_LINEUP_TRACE==="true"?whiteBoxTrace.candidates.length:3),...(experimentTrace?{whiteBoxLineupExperiment:{band:experimentBand,styleLimit:experimentStyleLimit,styleScale:experimentStyleScale,gate:experimentGate,trace:summarizeWhiteBoxShadow(experimentTrace,incumbentId,experimentTrace.candidates.length)}}:{})}, alternatives: combinations.slice(1, 4).map(option => ({option: option.lineup.map(entry => entry.candidate.name).join("/"), score: option.value})), rationale: lineupReasons(selected.lineup, opponent, dex), expectedValue: selected.value, confidence: confidence(combinations[0].value, combinations[1]?.value)});
  return selected.lineup;
}

function boundedExperimentValue(name:string,fallback:number,minimum:number,maximum:number):number{const value=Number(process.env[name]??fallback);if(!Number.isFinite(value)||value<minimum||value>maximum)throw new Error(`${name} must be within ${minimum}..${maximum}`);return value;}

async function runSeason(format: string, dex: ReturnType<typeof Dex.mod>, available: Map<string, Candidate>) {
  const series = [];
  const fullSchedule = roundRobinSchedule(managers);
  const regularRounds = regularRoundSetting || (managers.length > 10 ? Math.min(24, fullSchedule.length) : fullSchedule.length);
  const operationRounds = regularRounds >= 16 ? new Set([8, 16]) : regularRounds >= 6 ? new Set([Math.floor(regularRounds / 2)]) : new Set<number>();
  const transactions = [];
  for (let roundIndex = 0; roundIndex < regularRounds; roundIndex += 1) {
    const round = roundIndex + 1;
    for (const [left, right] of fullSchedule[roundIndex]) {
      const result = await playSeries(format, left, right, dex, `league-r${round}-${left.id}-${right.id}`, pairsPerSeries, "league");
      series.push({...result, round});
    }
    if (operationRounds.has(round)) {
      if (midseasonGrant > 0) {
        for (const manager of managers) manager.budget += midseasonGrant;
        ledger.add({stage: "calibration", actor: "system", decision: `第${round}轮发放联盟运营收入`, selected: `${midseasonGrant}资金/队`, context: {round, midseasonGrant}, alternatives: [], rationale: ["运营收入属于经理可自由使用的流动资金", "未使用资金可以留存，不强制交易"]});
      }
      if (sportsMarket) {
        transactions.push(...runTradeWindow(round, dex));
        if (dualLayer) transactions.push(...runBackgroundAdjustment(round, [...available.values()], dex));
        else transactions.push(...runWaiverWindow(round, available, dex));
      } else transactions.push(...runFreeAgentWindow(round, available, dex));
    }
  }
  const standings = [...managers].sort((a, b) => b.record.points - a.record.points || (b.record.pairWins - b.record.pairLosses) - (a.record.pairWins - a.record.pairLosses) || b.record.kos - a.record.kos);
  const playoffSeeds = managers.length >= 30 ? seedThirtyTeamPlayoffs(standings) : standings;
  const playoffs = await runPlayoffs(format, playoffSeeds, dex);
  const champion = playoffs.champion;
  ledger.add({stage: "review", actor: champion.id, decision: "赢得V3冠军", selected: champion.name, context: {final: playoffs.final}, alternatives: [], rationale: ["通过竞拍、轮次赛程、季中操作和淘汰赛完成完整决策链"]});
  return {dryRun: false, season: seasonNumber, regularRounds, transactions, champion: {id: champion.id, name: champion.name}, standings: standings.map(manager => ({id: manager.id, name: manager.name, division: manager.division, budget: manager.budget, ...manager.record})), league: series, playoffs: playoffs.bracket, validity: {schemaVersion: 1, valid: true, battleLineupSize: 6}};
}

function seedThirtyTeamPlayoffs(standings: Manager[]): Manager[] {
  const divisionWinners = ["A", "B", "C"].map(division => standings.find(manager => manager.division === division)).filter((manager): manager is Manager => Boolean(manager)).sort((a, b) => standings.indexOf(a) - standings.indexOf(b));
  const winnerIds = new Set(divisionWinners.map(manager => manager.id));
  return [...divisionWinners, ...standings.filter(manager => !winnerIds.has(manager.id))];
}

async function runPlayoffs(format: string, standings: Manager[], dex: ReturnType<typeof Dex.mod>) {
  if (standings.length < 12) {
    const wildA = await playKnockout(format, standings[2], standings[5], dex, "wildcard-3-6");
    const wildB = await playKnockout(format, standings[3], standings[4], dex, "wildcard-4-5");
    const semiA = await playKnockout(format, standings[0], seriesWinner(wildB, standings[3], standings[4]), dex, "semifinal-1");
    const semiB = await playKnockout(format, standings[1], seriesWinner(wildA, standings[2], standings[5]), dex, "semifinal-2");
    const left = seriesWinner(semiA, standings[0], seriesWinner(wildB, standings[3], standings[4]));
    const right = seriesWinner(semiB, standings[1], seriesWinner(wildA, standings[2], standings[5]));
    const final = await playKnockout(format, left, right, dex, "final");
    return {champion: seriesWinner(final, left, right), final, bracket: {wildcards: [wildA, wildB], semifinals: [semiA, semiB], final}};
  }
  const playIns = await Promise.all([
    playKnockout(format, standings[4], standings[11], dex, "playin-5-12"),
    playKnockout(format, standings[5], standings[10], dex, "playin-6-11"),
    playKnockout(format, standings[6], standings[9], dex, "playin-7-10"),
    playKnockout(format, standings[7], standings[8], dex, "playin-8-9"),
  ]);
  const winners = playIns.map((series, index) => seriesWinner(series, standings[4 + index], standings[11 - index]));
  const quarters = await Promise.all([
    playKnockout(format, standings[0], winners[3], dex, "quarterfinal-1"),
    playKnockout(format, standings[1], winners[2], dex, "quarterfinal-2"),
    playKnockout(format, standings[2], winners[1], dex, "quarterfinal-3"),
    playKnockout(format, standings[3], winners[0], dex, "quarterfinal-4"),
  ]);
  const quarterWinners = quarters.map((series, index) => seriesWinner(series, standings[index], winners[3 - index]));
  const semifinals = await Promise.all([
    playKnockout(format, quarterWinners[0], quarterWinners[3], dex, "semifinal-1"),
    playKnockout(format, quarterWinners[1], quarterWinners[2], dex, "semifinal-2"),
  ]);
  const finalists = [seriesWinner(semifinals[0], quarterWinners[0], quarterWinners[3]), seriesWinner(semifinals[1], quarterWinners[1], quarterWinners[2])];
  const final = await playKnockout(format, finalists[0], finalists[1], dex, "final");
  return {champion: seriesWinner(final, finalists[0], finalists[1]), final, bracket: {playIns, quarters, semifinals, final}};
}

async function playKnockout(format: string, left: Manager, right: Manager, dex: ReturnType<typeof Dex.mod>, seriesId: string) {
  let result = await playSeries(format, left, right, dex, seriesId, Math.max(2, pairsPerSeries), "playoff");
  for (let extension = 1; result.leftPairs === result.rightPairs && extension <= 3; extension += 1) {
    const extra = await playSeries(format, left, right, dex, `${seriesId}-tiebreak-${extension}`, 1, "playoff");
    result = {...result, leftPairs: result.leftPairs + extra.leftPairs, rightPairs: result.rightPairs + extra.rightPairs, splitPairs: result.splitPairs + extra.splitPairs, games: [...result.games, ...extra.games]};
  }
  return result;
}

function roundRobinSchedule(entrants: Manager[]): Array<Array<[Manager, Manager]>> {
  const rotation: Array<Manager | null> = [...entrants];
  if (rotation.length % 2) rotation.push(null);
  const rounds: Array<Array<[Manager, Manager]>> = [];
  for (let round = 0; round < rotation.length - 1; round += 1) {
    const pairings: Array<[Manager, Manager]> = [];
    for (let index = 0; index < rotation.length / 2; index += 1) {
      const left = rotation[index];
      const right = rotation[rotation.length - 1 - index];
      if (left && right) pairings.push(round % 2 ? [right, left] : [left, right]);
    }
    rounds.push(pairings);
    rotation.splice(1, 0, rotation.pop()!);
  }
  return rounds;
}

function runTradeWindow(round: number, dex: ReturnType<typeof Dex.mod>): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];
  const tradeCounts = new Map<string, number>();
  const maximumTradesPerWindow = 3;
  const ordered = [...managers].sort((a, b) => tie(a.id, round) - tie(b.id, round));
  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
    const left = ordered[leftIndex], right = ordered[rightIndex];
    if ((tradeCounts.get(left.id) ?? 0) >= maximumTradesPerWindow || (tradeCounts.get(right.id) ?? 0) >= maximumTradesPerWindow) continue;
    const leftContender = contenderProbability(left), rightContender = contenderProbability(right);
    const leftStructureBefore = tradeRosterStructure(left, left.roster.map(entry => entry.candidate));
    const rightStructureBefore = tradeRosterStructure(right, right.roster.map(entry => entry.candidate));
    const leftTypePressureBefore = tradeTypePressure(left.roster.map(entry => entry.candidate), dex);
    const rightTypePressureBefore = tradeTypePressure(right.roster.map(entry => entry.candidate), dex);
    type TradeOption = {id: string; leftAsset: RosterEntry; rightAsset: RosterEntry; leftBefore: number; leftAfter: number; rightBefore: number; rightAfter: number; total: number};
    let best: TradeOption | undefined;
    const tradeOptions = new Map<string, TradeOption>();
    const tradeInputs = new Map<string, TradeCandidateInput>();
    const tradeCandidates: WhiteBoxCandidate[] = [];
    let candidateIndex = 0;
    for (const leftAsset of left.roster.filter(entry => !dualLayer || entry.candidate.economicClass !== "background")) for (const rightAsset of right.roster.filter(entry => !dualLayer || entry.candidate.economicClass !== "background")) {
      const id = `${String(candidateIndex).padStart(3, "0")}:${leftAsset.candidate.id}->${rightAsset.candidate.id}`;
      candidateIndex += 1;
      const duplicateFamily = left.roster.some(entry => entry !== leftAsset && entry.candidate.family === rightAsset.candidate.family)
        || right.roster.some(entry => entry !== rightAsset && entry.candidate.family === leftAsset.candidate.family);
      const leftBefore = longTermAssetUtility(left, leftAsset, dex, leftContender), leftAfter = longTermAssetUtility(left, rightAsset, dex, leftContender);
      const rightBefore = longTermAssetUtility(right, rightAsset, dex, rightContender), rightAfter = longTermAssetUtility(right, leftAsset, dex, rightContender);
      const leftStructureAfter = tradeRosterStructure(left, left.roster.map(entry => entry === leftAsset ? rightAsset.candidate : entry.candidate));
      const rightStructureAfter = tradeRosterStructure(right, right.roster.map(entry => entry === rightAsset ? leftAsset.candidate : entry.candidate));
      const leftTypePressureAfter = tradeTypePressure(left.roster.map(entry => entry === leftAsset ? rightAsset.candidate : entry.candidate), dex);
      const rightTypePressureAfter = tradeTypePressure(right.roster.map(entry => entry === rightAsset ? leftAsset.candidate : entry.candidate), dex);
      const total = leftAfter + rightAfter - leftBefore - rightBefore;
      tradeOptions.set(id, {id, leftAsset, rightAsset, leftBefore, leftAfter, rightBefore, rightAfter, total});
      const tradeInput: TradeCandidateInput = {id, leftBefore, leftAfter, rightBefore, rightAfter, leftContender, rightContender, duplicateFamily, leftMinimumCoverageChange: leftStructureAfter.minimumCoverage - leftStructureBefore.minimumCoverage, rightMinimumCoverageChange: rightStructureAfter.minimumCoverage - rightStructureBefore.minimumCoverage, leftTargetDepthChange: leftStructureAfter.targetDepth - leftStructureBefore.targetDepth, rightTargetDepthChange: rightStructureAfter.targetDepth - rightStructureBefore.targetDepth, leftTypePressureImprovement: leftTypePressureBefore - leftTypePressureAfter, rightTypePressureImprovement: rightTypePressureBefore - rightTypePressureAfter, parameters: marketFlowShadowValues};
      tradeInputs.set(id, tradeInput);
      tradeCandidates.push(buildTradeWhiteBoxCandidate(tradeInput));
      if (duplicateFamily) continue;
      if (!tradeAcceptable(leftBefore, leftAfter, leftContender) || !tradeAcceptable(rightBefore, rightAfter, rightContender) || total < .1 || total <= (best?.total ?? 0)) continue;
      best = tradeOptions.get(id)!;
    }
    if (!best) continue;
    const whiteBoxTrace = evaluateWhiteBoxDecision({decisionId: `market:trade:${seasonNumber}:${round}:${left.id}:${right.id}`, candidates: tradeCandidates, reasonableBand: 0, styleContributionLimit: 0});
    const whiteBoxShadow = {...summarizeWhiteBoxShadow(whiteBoxTrace, best.id, 3), policyVersion: "trade-structure-v3", parameters: {...marketFlowShadowValues}};
    const whiteBoxTradeAssist = evaluateTradeAssistGate(whiteBoxTrace.decisionId, tradeInputs.get(best.id)!, whiteBoxTrace.selected ? tradeInputs.get(whiteBoxTrace.selected) : undefined, marketFlowShadowValues);
    const experiment = tradeExperimentEnabled(whiteBoxTrace.decisionId);
    const selectedTrade = experiment && whiteBoxTrace.selected ? tradeOptions.get(whiteBoxTrace.selected) ?? best : best;
    const leftSlot = left.roster.indexOf(selectedTrade.leftAsset), rightSlot = right.roster.indexOf(selectedTrade.rightAsset);
    const decision = ledger.add({stage: "waiver", actor: `${left.id}+${right.id}`, decision: `第${round}轮一换一交易`, selected: `${selectedTrade.leftAsset.candidate.name}<->${selectedTrade.rightAsset.candidate.name}`, context: {round, left: left.id, right: right.id, leftBefore: selectedTrade.leftBefore, leftAfter: selectedTrade.leftAfter, rightBefore: selectedTrade.rightBefore, rightAfter: selectedTrade.rightAfter, leftContender, rightContender, policy: experiment ? "whitebox-experiment" : "incumbent", whiteBoxShadow, whiteBoxTradeAssist}, alternatives: [], rationale: ["双方按当季竞争力、合同剩余控制期和工资剩余价值评估", "白箱影子另行比较交易后的最低角色覆盖、功能深度与属性压力", "辅助触发门要求充分优势、双方保护和多项独立证据", "合同和资产身份随交易转移"]});
    left.roster[leftSlot] = {...selectedTrade.rightAsset, candidate: configureCandidateForManager(left, selectedTrade.rightAsset.candidate, dex), method: "trade", decisionId: decision.id};
    right.roster[rightSlot] = {...selectedTrade.leftAsset, candidate: configureCandidateForManager(right, selectedTrade.leftAsset.candidate, dex), method: "trade", decisionId: decision.id};
    tradeCounts.set(left.id, (tradeCounts.get(left.id) ?? 0) + 1);
    tradeCounts.set(right.id, (tradeCounts.get(right.id) ?? 0) + 1);
    results.push({type: "trade", round, left: left.id, right: right.id, sent: selectedTrade.leftAsset.candidate.name, received: selectedTrade.rightAsset.candidate.name, ...(experiment ? {policy: "whitebox-experiment"} : {})});
  }
  return results;
}

function contenderProbability(manager: Manager): number {
  const maximum = Math.max(1, ...managers.map(candidate => candidate.record.points));
  return Math.max(0, Math.min(1, manager.record.points / maximum));
}

function longTermAssetUtility(manager: Manager, entry: RosterEntry, dex: ReturnType<typeof Dex.mod>, contender: number): number {
  const contract = entry.contract ?? {};
  const salary = Number(contract.salary ?? entry.price);
  const years = Math.max(0, Number(contract.yearsRemaining ?? 1));
  const marketValue = Number(contract.marketValue ?? entry.candidate.market);
  const current = managerValue(manager, entry.candidate, dex) * 10 * (.7 + contender * .5 + manager.traits.stars * .35);
  const futureWeight = .65 + (1 - contender) * .55 + manager.traits.value * .45;
  const controlValue = (4 * years + .6 * Math.max(0, marketValue - salary) * years) * futureWeight;
  const salaryCost = salary / 12 * (1 + manager.traits.value * .35);
  return current + controlValue - salaryCost;
}

function runWaiverWindow(round: number, available: Map<string, Candidate>, dex: ReturnType<typeof Dex.mod>): Array<Record<string, unknown>> {
  const claims: Array<{manager: Manager; candidate: Candidate; worst: RosterEntry; cost: number; targetShadow: ReturnType<typeof summarizeWhiteBoxShadow>}> = [];
  for (const manager of managers) {
    if (manager.budget < 2 || manager.roster.length < minimumRosterSize) continue;
    const candidates = [...available.values()].filter(candidate => candidate.tier === "standard" && !manager.roster.some(entry => entry.candidate.family === candidate.family));
    if (!candidates.length) continue;
    const ranked = candidates.map(candidate => ({candidate, value: managerValue(manager, candidate, dex)})).sort((a, b) => b.value - a.value);
    const best = ranked[0];
    const worst = [...manager.roster].sort((a, b) => managerValue(manager, a.candidate, dex) - managerValue(manager, b.candidate, dex))[0];
    if (best.value < managerValue(manager, worst.candidate, dex) * 1.04) continue;
    const acquisitionTrace = evaluateWhiteBoxDecision({decisionId: `market:waiver-target:${seasonNumber}:${round}:${manager.id}`, candidates: candidates.map(candidate => acquisitionWhiteBoxCandidate(manager, candidate, dex, {})), reasonableBand: acquisitionShadowValues["acquire.reasonableband"], styleContributionLimit: acquisitionShadowValues["acquire.stylelimit"]});
    claims.push({manager, candidate: best.candidate, worst, cost: Math.max(2, Math.min(manager.budget, Math.round(best.candidate.market * .35))), targetShadow: summarizeWhiteBoxShadow(acquisitionTrace, best.candidate.id, 3)});
  }
  const results: Array<Record<string, unknown>> = [];
  for (const candidateId of new Set(claims.map(claim => claim.candidate.id))) {
    const grouped = claims.filter(claim => claim.candidate.id === candidateId);
    const priorityInputs = grouped.map(claim => ({teamId: claim.manager.id, winPct: claim.manager.record.seriesWins / Math.max(1, claim.manager.record.seriesWins + claim.manager.record.seriesLosses + claim.manager.record.seriesDraws), roundsSinceClaim: round - (lastWaiverRound.get(claim.manager.id) ?? 0)}));
    const winnerId = waiverWinner(priorityInputs);
    const claim = grouped.find(entry => entry.manager.id === winnerId);
    if (!claim || !available.has(candidateId)) continue;
    const priorityTrace = evaluateWaiverPriority(`market:waiver-priority:${seasonNumber}:${round}:${candidateId}`, priorityInputs, marketFlowShadowValues);
    if (priorityTrace.selected !== winnerId) throw new Error(`White-box waiver priority drifted for ${candidateId}`);
    const currentValue = managerValue(claim.manager, claim.worst.candidate, dex);
    const targetValue = managerValue(claim.manager, claim.candidate, dex);
    const replacementTrace = evaluateMarketReplacement({decisionId: `market:waiver-replacement:${seasonNumber}:${round}:${claim.manager.id}:${candidateId}`, mode: "waiver", budget: claim.manager.budget, rosterLegal: claim.manager.roster.length >= minimumRosterSize, duplicateFamily: claim.manager.roster.some(entry => entry.candidate.family === claim.candidate.family), currentValue, targetValue, currentStrength: claim.worst.candidate.strength, targetStrength: claim.candidate.strength, fillsNeed: false, cost: claim.cost, parameters: marketFlowShadowValues});
    if (!replacementTrace.accepted) throw new Error(`White-box waiver replacement drifted for ${claim.manager.id}:${candidateId}`);
    const decision = ledger.add({stage: "waiver", actor: claim.manager.id, decision: `第${round}轮waiver认领`, selected: claim.candidate.name, context: {round, cost: claim.cost, released: claim.worst.candidate.name, claimants: grouped.map(entry => entry.manager.id), whiteBoxPriority: summarizeWhiteBoxShadow(priorityTrace, winnerId, 3), whiteBoxTarget: claim.targetShadow, whiteBoxReplacement: replacementTrace}, alternatives: grouped.filter(entry => entry !== claim).map(entry => ({option: entry.manager.id})), rationale: ["所有认领同时提交", "按战绩与距离上次成功认领时间滚动排序"]});
    claim.manager.roster.splice(claim.manager.roster.indexOf(claim.worst), 1);
    claim.manager.departed.push(claim.worst);
    available.set(claim.worst.candidate.id, claim.worst.candidate);
    available.delete(candidateId);
    claim.manager.budget -= claim.cost;
    claim.manager.roster.push(newRosterEntry(claim.candidate, "waiver", claim.cost, decision.id));
    lastWaiverRound.set(claim.manager.id, round);
    results.push({type: "waiver", round, manager: claim.manager.id, signed: claim.candidate.name, released: claim.worst.candidate.name, cost: claim.cost});
  }
  return results;
}

function runFreeAgentWindow(round: number, available: Map<string, Candidate>, dex: ReturnType<typeof Dex.mod>): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];
  const priority = [...managers].sort((a, b) => a.record.points - b.record.points || (a.record.pairWins - a.record.pairLosses) - (b.record.pairWins - b.record.pairLosses) || tie(a.id, round) - tie(b.id, round));
  for (const manager of priority) {
    if (manager.budget < 2 || manager.roster.length < minimumRosterSize) continue;
    const candidates = [...available.values()].filter(candidate => candidate.tier === "standard" && !manager.roster.some(entry => entry.candidate.family === candidate.family));
    if (!candidates.length) continue;
    const best = candidates.map(candidate => ({candidate, value: managerValue(manager, candidate, dex)})).sort((a, b) => b.value - a.value)[0];
    const worst = [...manager.roster].sort((a, b) => a.candidate.strength - b.candidate.strength || a.appearances - b.appearances)[0];
    const fillsNeed = missingRoles(manager).some(role => best.candidate.roles.has(role) && !worst.candidate.roles.has(role));
    if (!fillsNeed && best.candidate.strength < worst.candidate.strength * 1.06) continue;
    const cost = Math.max(2, Math.min(manager.budget, Math.round(best.candidate.market * .35)));
    const replacementTrace = evaluateMarketReplacement({decisionId: `market:free-agent-replacement:${seasonNumber}:${round}:${manager.id}:${best.candidate.id}`, mode: "free-agent", budget: manager.budget, rosterLegal: manager.roster.length >= minimumRosterSize, duplicateFamily: manager.roster.some(entry => entry.candidate.family === best.candidate.family), currentValue: managerValue(manager, worst.candidate, dex), targetValue: best.value, currentStrength: worst.candidate.strength, targetStrength: best.candidate.strength, fillsNeed, cost, parameters: marketFlowShadowValues});
    if (!replacementTrace.accepted) throw new Error(`White-box free-agent replacement drifted for ${manager.id}:${best.candidate.id}`);
    const acquisitionTrace = evaluateWhiteBoxDecision({decisionId: `market:free-agent-target:${seasonNumber}:${round}:${manager.id}`, candidates: candidates.map(candidate => acquisitionWhiteBoxCandidate(manager, candidate, dex, {})), reasonableBand: acquisitionShadowValues["acquire.reasonableband"], styleContributionLimit: acquisitionShadowValues["acquire.stylelimit"]});
    manager.roster.splice(manager.roster.indexOf(worst), 1);
    manager.departed.push(worst);
    available.set(worst.candidate.id, worst.candidate);
    available.delete(best.candidate.id);
    const decision = ledger.add({stage: "waiver", actor: manager.id, decision: `第${round}轮自由市场补强`, selected: best.candidate.name, context: {round, cost, budgetBefore: manager.budget, released: worst.candidate.name, whiteBoxTarget: summarizeWhiteBoxShadow(acquisitionTrace, best.candidate.id, 3), whiteBoxReplacement: replacementTrace}, alternatives: [{option: worst.candidate.name, score: worst.candidate.strength}], rationale: fillsNeed ? ["填补当前角色缺口"] : ["自由球员带来明确实力升级"]});
    manager.budget -= cost;
    manager.roster.push(newRosterEntry(best.candidate, "free-agent", cost, decision.id));
    results.push({round, manager: manager.id, signed: best.candidate.name, released: worst.candidate.name, cost});
  }
  return results;
}

async function playSeries(format: string, left: Manager, right: Manager, dex: ReturnType<typeof Dex.mod>, seriesId: string, pairs: number, stage: "league" | "playoff") {
  const leftLineup = chooseLineup(left, right, dex, seriesId);
  const rightLineup = chooseLineup(right, left, dex, seriesId);
  let leftPairs = 0, rightPairs = 0, splitPairs = 0;
  const games = [];
  for (let pair = 0; pair < pairs; pair += 1) {
    let leftGameWins = 0, rightGameWins = 0;
    for (const orientation of ["left-p1", "right-p1"] as const) {
      const leftSide: Side = orientation === "left-p1" ? "p1" : "p2";
      const result = await runBattle({format, teamA: Teams.pack((orientation === "left-p1" ? leftLineup : rightLineup).map(entry => entry.candidate.set)), teamB: Teams.pack((orientation === "left-p1" ? rightLineup : leftLineup).map(entry => entry.candidate.set)), seed: `${seed}:${seriesId}:pair:${pair}`, gameIndex: pair, outDir: path.join(outDir, "battles", seriesId, orientation), maxTurns, ai: "search", aiProfiles: orientation === "left-p1" ? {p1: programTactics(left, right), p2: programTactics(right, left)} : {p1: programTactics(right, left), p2: programTactics(left, right)}, aiOpponentModels: orientation === "left-p1" ? {p1: tacticalOpponentModel(left.tacticalMemory, right.id,{minimumConfidence:tacticalMemoryConfidenceFloor}), p2: tacticalOpponentModel(right.tacticalMemory, left.id,{minimumConfidence:tacticalMemoryConfidenceFloor})} : {p1: tacticalOpponentModel(right.tacticalMemory, left.id,{minimumConfidence:tacticalMemoryConfidenceFloor}), p2: tacticalOpponentModel(left.tacticalMemory, right.id,{minimumConfidence:tacticalMemoryConfidenceFloor})}, openTeamSheets: true, traceAiDecisions: true,battleAssistScopes,battleAssistApprovalSha256:battleAssistApproval?.sha256});
      const leftWon = result.winner === (leftSide === "p1" ? "Team A" : "Team B");
      const rightWon = result.winner === (leftSide === "p1" ? "Team B" : "Team A");
      if (leftWon) leftGameWins += 1;
      if (rightWon) rightGameWins += 1;
      updateMemberOutcomes(left, right, leftLineup, rightLineup, leftSide, result.publicLogPath, stage);
      const keyDecisions = extractKeyBattleDecisions(result.decisionLogPath, 6);
      ledger.add({stage: stage === "league" ? "battle" : "playoff", actor: "battle-ai", decision: `${seriesId} 配对${pair + 1} ${orientation}关键战术`, selected: keyDecisions.map(decision => `${decision.playerId}:${decision.selected}`), context: {seriesId, left: left.id, right: right.id, pair: pair + 1, orientation, winner: leftWon ? left.id : rightWon ? right.id : null, turns: result.turns, decisions: keyDecisions}, alternatives: keyDecisions.filter(decision => decision.runnerUp).map(decision => ({option: `${decision.playerId}:${decision.runnerUp}`, score: decision.runnerUpScore ?? undefined})), rationale: keyDecisions.flatMap(decision => decision.rationale).slice(0, 8), outcome: {winner: leftWon ? left.id : rightWon ? right.id : null, turns: result.turns}});
      games.push({pair, orientation, winner: leftWon ? left.id : rightWon ? right.id : null, turns: result.turns, keyDecisionCount: keyDecisions.length});
    }
    if (leftGameWins === 2) leftPairs += 1;
    else if (rightGameWins === 2) rightPairs += 1;
    else splitPairs += 1;
  }
  if (stage === "league") applySeriesPoints(left, right, leftPairs, rightPairs);
  return {id: seriesId, stage, left: left.id, right: right.id, leftPairs, rightPairs, splitPairs, games};
}

function applySeriesPoints(left: Manager, right: Manager, leftPairs: number, rightPairs: number): void {
  left.record.pairWins += leftPairs; left.record.pairLosses += rightPairs;
  right.record.pairWins += rightPairs; right.record.pairLosses += leftPairs;
  if (leftPairs > rightPairs) { left.record.seriesWins += 1; right.record.seriesLosses += 1; left.record.points += 3; }
  else if (rightPairs > leftPairs) { right.record.seriesWins += 1; left.record.seriesLosses += 1; right.record.points += 3; }
  else { left.record.seriesDraws += 1; right.record.seriesDraws += 1; left.record.points += 1; right.record.points += 1; }
}

function seriesWinner(series: {leftPairs: number; rightPairs: number}, left: Manager, right: Manager): Manager {
  if (series.leftPairs > series.rightPairs) return left;
  if (series.rightPairs > series.leftPairs) return right;
  return left.record.points >= right.record.points ? left : right;
}

function updateMemberOutcomes(left: Manager, right: Manager, leftLineup: RosterEntry[], rightLineup: RosterEntry[], leftSide: Side, logPath: string, stage: "league" | "playoff"): void {
  leftLineup.forEach(entry => entry.appearances += 1);
  rightLineup.forEach(entry => entry.appearances += 1);
  if (stage === "league") {
    leftLineup.forEach(entry => entry.regularSeasonAppearances += 1);
    rightLineup.forEach(entry => entry.regularSeasonAppearances += 1);
  }
  const analysis = analyzePublicLog(logPath, null, 0);
  const leftKos = leftSide === "p1" ? analysis.p1Kos : analysis.p2Kos;
  const rightKos = leftSide === "p1" ? analysis.p2Kos : analysis.p1Kos;
  creditKos(left, leftLineup, leftKos, stage);
  creditKos(right, rightLineup, rightKos, stage);
  if (stage === "league") {
    const telemetry = analyzeConfigurationTelemetry(logPath);
    applyConfigurationTelemetry(leftLineup, leftSide === "p1" ? telemetry.p1 : telemetry.p2);
    applyConfigurationTelemetry(rightLineup, leftSide === "p1" ? telemetry.p2 : telemetry.p1);
  }
}

function applyConfigurationTelemetry(lineup: RosterEntry[], evidence: Record<string, MemberConfigurationEvidence>): void {
  for (const entry of lineup) {
    const names = [entry.candidate.name, entry.candidate.set.name, entry.candidate.set.species].map(value => toID(value));
    const source = Object.entries(evidence).find(([name]) => names.includes(toID(name)))?.[1];
    if (source) mergeConfigurationEvidence(entry.configurationEvidence, source);
  }
}

function creditKos(manager: Manager, lineup: RosterEntry[], counts: Record<string, number>, stage: "league" | "playoff"): void {
  for (const [name, count] of Object.entries(counts)) {
    manager.record.kos += count;
    const killId = toID(name);
    const entry = lineup.find(candidate => toID(candidate.candidate.name) === killId || toID(candidate.candidate.set.name) === killId || candidate.candidate.family === killId);
    if (entry) {
      entry.kos += count;
      if (stage === "league") entry.regularSeasonKos += count;
    }
  }
}

function newRosterEntry(candidate: Candidate, method: RosterEntry["method"], price: number, decisionId: string, contract?: Record<string, unknown>): RosterEntry {
  return {candidate, method, price, decisionId, appearances: 0, kos: 0, regularSeasonAppearances: 0, regularSeasonKos: 0, contract, configurationEvidence: emptyConfigurationEvidence()};
}

function resolveAcquisitionOutcomes(champion: {id: string}): void {
  for (const manager of managers) for (const entry of manager.roster) ledger.resolve(entry.decisionId, {appearances: entry.appearances, kos: entry.kos, champion: manager.id === champion.id, cost: entry.price, method: entry.method});
}

function finish(season: unknown): void {
  ledger.write(outDir);
  const documented = typeof season === "object" && season !== null
    ? {...season, registry: {hash: registryHash, namespace: registryNamespace || "default"}}
    : season;
  fs.writeFileSync(path.join(outDir, "season.json"), `${JSON.stringify(documented, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "decision-summary.md"), decisionSummary(season), "utf8");
  fs.writeFileSync(path.join(outDir, "decision-story.md"), decisionStory(season), "utf8");
  console.log(JSON.stringify({dryRun, season: seasonNumber, managers: managers.length, rostered: managers.reduce((sum, manager) => sum + manager.roster.length, 0), decisions: ledger.all().length, output: outDir}, null, 2));
}

function writePool(pool: Candidate[]): void {
  fs.writeFileSync(path.join(outDir, "season-pool.json"), `${JSON.stringify(pool.map(candidate => ({id: candidate.id, assetId: candidate.assetId, family: candidate.family, name: candidate.name, source: candidate.source, scarcity: candidate.scarcity, economicClass: candidate.economicClass, debutGeneration: candidate.debutGeneration, configurationSource: candidate.configurationSource, supplyCap: candidate.supplyCap, tier: candidate.tier, strength: candidate.strength, market: candidate.market, roles: [...candidate.roles]})), null, 2)}\n`, "utf8");
}

function writeRosters(): void {
  for (const manager of managers) {
    const dir = path.join(outDir, "rosters", manager.id);
    writeTeam(manager.roster.map(entry => entry.candidate.set), path.join(dir, "roster.export.txt"), "export");
    fs.mkdirSync(dir, {recursive: true});
    const serialize = (entry: RosterEntry) => ({assetId: entry.candidate.assetId, family: entry.candidate.family, pokemon: entry.candidate.name, method: entry.method, scarcity: entry.candidate.scarcity, economicClass: entry.candidate.economicClass, debutGeneration: entry.candidate.debutGeneration, configurationSource: entry.candidate.configurationSource, configuredSet: entry.candidate.set, configurationEvidence: entry.configurationEvidence, supplyCap: entry.candidate.supplyCap, tier: entry.candidate.tier, price: entry.price, market: entry.candidate.market, roles: [...entry.candidate.roles], decisionId: entry.decisionId, appearances: entry.appearances, kos: entry.kos, regularSeasonAppearances: entry.regularSeasonAppearances, regularSeasonKos: entry.regularSeasonKos, contract: entry.contract});
    fs.writeFileSync(path.join(dir, "roster.json"), `${JSON.stringify({managerId: manager.id, manager: manager.name, season: seasonNumber, budget: manager.budget, traits: manager.traits, preferredRoles: manager.preferredRoles, roleTargets: manager.roleTargets, economics: manager.economics, tactics: manager.tactics, learning: manager.learning, development: manager.development, ...(compactOutput ? {} : {tacticalMemory: manager.tacticalMemory}), members: manager.roster.map(serialize), departedMembers: manager.departed.map(serialize)}, null, 2)}\n`, "utf8");
  }
}

function decisionSummary(season: any): string {
  const auction = ledger.all().filter(record => record.stage === "auction");
  const contested = auction.filter(record => Array.isArray((record.context as any).bids) && (record.context as any).bids.filter((bid: any) => bid.bid > 0).length >= 3);
  const lines = ["# V3 决策追踪摘要", "", `- 经理：${managers.length}`, `- 拍卖标的：${auctionLots}`, `- 高竞争拍卖：${contested.length}`, `- 决策记录：${ledger.all().length}`, `- 模式：${dryRun ? "预演" : "完整赛季"}`, "", "## 阵容", ""];
  for (const manager of managers) lines.push(`- **${manager.name}**：${manager.roster.map(entry => `${entry.candidate.name}(${entry.method === "auction" ? `${entry.price}资金` : entry.method === "keeper" ? `续约${entry.price}` : "补强"})`).join("、")}`);
  if (season?.champion) lines.push("", `## 冠军`, "", `**${season.champion.name}**`);
  lines.push("", "## 最激烈竞价", "");
  for (const record of contested.slice(0, 8)) lines.push(`- ${record.decision}：${record.selected}`);
  return `${lines.join("\n")}\n`;
}

function decisionStory(season: any): string {
  const records = ledger.all();
  const auctions = records.filter(record => record.stage === "auction").map(record => ({record, bids: ((record.context as any).bids ?? []).filter((bid: any) => bid.bid > 0)})).sort((a, b) => b.bids.length - a.bids.length || ((b.bids[0]?.bid ?? 0) - (b.bids[1]?.bid ?? 0)) - ((a.bids[0]?.bid ?? 0) - (a.bids[1]?.bid ?? 0)));
  const closeDrafts = records.filter(record => record.stage === "draft" && (record.confidence ?? 1) < .12).slice(0, 12);
  const lineups = records.filter(record => record.stage === "lineup");
  const battleChoices = records.filter(record => record.stage === "battle" || record.stage === "playoff").filter(record => Array.isArray((record.context as any).decisions) && (record.context as any).decisions.length);
  const lines = ["# 从选秀到冠军：关键决策故事", "", "## 拍卖桌上的冲突", ""];
  for (const item of auctions.slice(0, 10)) {
    const top = [...item.bids].sort((a: any, b: any) => b.bid - a.bid);
    lines.push(`- **${item.record.decision.replace("提名并竞价 ", "")}**：${item.bids.length}队出价，${item.record.selected}成交；第二报价${top[1]?.bid ?? 0}。`);
  }
  lines.push("", "## 最难的补强选择", "");
  for (const record of closeDrafts) lines.push(`- ${managers.find(manager => manager.id === record.actor)?.name ?? record.actor}选择${record.selected}，信心${((record.confidence ?? 0) * 100).toFixed(1)}%；备选为${record.alternatives.slice(0, 2).map(option => option.option).join("、")}。`);
  lines.push("", "## 8选6管理", "", `共做出${lineups.length}次赛前阵容决策。`);
  for (const record of lineups.slice(-12)) lines.push(`- ${managers.find(manager => manager.id === record.actor)?.name ?? record.actor}：带上${(record.selected as string[]).join("、")}；替补${((record.context as any).benched ?? []).join("、")}。`);
  if (season?.champion) {
    const champion = managers.find(manager => manager.id === season.champion.id)!;
    lines.push("", "## 冠军投资回报", "");
    for (const entry of [...champion.roster].sort((a, b) => b.kos - a.kos)) lines.push(`- ${entry.candidate.name}：${entry.method === "auction" ? `${entry.price}资金购入` : entry.method === "keeper" ? `${entry.price}资金续约` : "补强选中"}，出场${entry.appearances}次，记录${entry.kos}次击倒。`);
  }
  lines.push("", "## 被抓取的战术分岔", "", `共有${battleChoices.length}场比赛出现值得进入主报告的战术选择。`);
  for (const record of battleChoices.slice(-12)) {
    const decisions = (record.context as any).decisions as Array<{turn: number; selected: string; runnerUp?: string; kind: string}>;
    const key = decisions[0];
    lines.push(`- ${record.decision}：第${key.turn}回合选择${key.selected}${key.runnerUp ? `，而非${key.runnerUp}` : ""}（${key.kind}）；本局胜者${(record.outcome as any)?.winner ?? "未知"}。`);
  }
  if (season?.champion) lines.push("", "## 冠军", "", `**${season.champion.name}**`);
  return `${lines.join("\n")}\n`;
}

function countRoles(candidates: Candidate[]): Partial<Record<Role, number>> {
  const counts: Partial<Record<Role, number>> = {};
  for (const candidate of candidates) for (const role of candidate.roles) counts[role] = (counts[role] ?? 0) + 1;
  return counts;
}

function rosterSynergy(roster: Candidate[], candidate: Candidate, dex: ReturnType<typeof Dex.mod>): number {
  let score = .5;
  for (const role of candidate.roles) if (!roster.some(member => member.roles.has(role))) score += .12;
  for (const type of candidate.types) score -= roster.filter(member => member.types.includes(type)).length * .08;
  for (const attackType of dex.types.names()) {
    const weak = roster.filter(member => dex.getEffectiveness(attackType, member.types) > 0).length;
    if (weak >= 2 && dex.getEffectiveness(attackType, candidate.types) <= 0) score += weak * .05;
    if (weak >= 2 && dex.getEffectiveness(attackType, candidate.types) > 0) score -= weak * .06;
  }
  return score;
}

function opponentCounterValue(manager: Manager, candidate: Candidate, dex: ReturnType<typeof Dex.mod>): number {
  const opponents = managers.filter(other => other !== manager).flatMap(other => other.roster.map(entry => entry.candidate));
  if (!opponents.length) return 0;
  const moveTypes = candidate.set.moves.map(move => dex.moves.get(move)).filter(move => move.category !== "Status").map(move => move.type);
  return Math.min(1, opponents.reduce((sum, opponent) => sum + (moveTypes.some(type => dex.getEffectiveness(type, opponent.types) > 0) ? .04 : 0), 0));
}

function riskValue(candidate: Candidate, dex: ReturnType<typeof Dex.mod>): number {
  const moves = candidate.set.moves.map(move => dex.moves.get(move));
  const inaccurate = moves.filter(move => typeof move.accuracy === "number" && move.accuracy < 90).length;
  const status = candidate.roles.has("status") ? 1 : 0;
  const setup = candidate.roles.has("setup") ? 1 : 0;
  return Math.min(1, inaccurate * .25 + status * .25 + setup * .3);
}

function lineupValue(manager: Manager, lineup: Candidate[], opponentManager: Manager, dex: ReturnType<typeof Dex.mod>): number {
  const opponent = opponentManager.roster.map(entry => entry.candidate);
  let score = lineup.reduce((sum, candidate) => sum + candidate.strength / 200, 0);
  const roles = new Set(lineup.flatMap(candidate => [...candidate.roles]));
  const roleCounts = countRoles(lineup);
  for (const [role, target] of Object.entries(manager.roleTargets) as Array<[Role, {minimum: number; target: number; weight: number}]>) {
    const count = roleCounts[role] ?? 0;
    score += Math.min(count, target.target) * target.weight * .09;
    if (count < target.minimum) score -= (target.minimum - count) * target.weight * .22;
  }
  const structuralRoles = ["hazards", "removal", "recovery", "pivot"].filter(role => roles.has(role as Role)).length;
  score += structuralRoles * (.2 + manager.traits.synergy * .15);
  score += roles.size * manager.traits.flexibility * .025;
  score += lineup.reduce((sum, candidate) => sum + candidate.market / 30, 0) * manager.traits.stars * .035;
  score += lineup.reduce((sum, candidate) => sum + candidate.strength / Math.max(3, candidate.market), 0) * manager.traits.value * .003;
  score += lineup.reduce((sum, candidate) => sum + riskValue(candidate, dex), 0) * manager.traits.risk * .035;
  const matchup = manager.matchupMemory[opponentManager.id];
  if (matchup) score += lineup.reduce((sum, candidate) => sum + (matchup.familyScores[candidate.family] ?? 0), 0) * manager.traits.counter * .04;
  score += lineup.reduce((sum, candidate) => sum + tacticalFamilyValue(manager.tacticalMemory, opponentManager.id, candidate.family), 0) * manager.traits.counter * .18;
  for (const candidate of lineup) {
    const moveTypes = candidate.set.moves.map(move => dex.moves.get(move)).filter(move => move.category !== "Status").map(move => move.type);
    score += opponent.filter(target => moveTypes.some(type => dex.getEffectiveness(type, target.types) > 0)).length * (.02 + manager.traits.counter * .035);
  }
  if (programEvolution) score += evaluateStrategyProgram(manager.strategyProgram, "lineup", {baseline: score / 10, strength: lineup.reduce((sum, candidate) => sum + candidate.strength, 0) / 1800, roleBreadth: roles.size / 10, rosterSize: manager.roster.length / maximumRosterSize, opponentPressure: opponent.reduce((sum, candidate) => sum + candidate.strength, 0) / 1800}).value * .2;
  return score;
}

function tradeExperimentEnabled(decisionId: string): boolean {
  return process.env.V4_TRADE_POLICY === "whitebox-experiment" && process.env.V4_TRADE_POLICY_TARGET === decisionId;
}

function tradeRosterStructure(manager: Manager, roster: Candidate[]): {minimumCoverage: number; targetDepth: number} {
  const counts = countRoles(roster);
  let minimumCoverage = 0;
  let targetDepth = 0;
  for (const [role, target] of Object.entries(manager.roleTargets) as Array<[Role, {minimum: number; target: number; weight: number}]>) {
    const count = counts[role] ?? 0;
    minimumCoverage += Math.min(count, target.minimum) * target.weight;
    targetDepth += Math.max(0, Math.min(count, target.target) - target.minimum) * target.weight;
  }
  return {minimumCoverage, targetDepth};
}

function tradeTypePressure(roster: Candidate[], dex: ReturnType<typeof Dex.mod>): number {
  let pressure = 0;
  for (const attackType of dex.types.names()) {
    const weaknesses = roster.filter(candidate => dex.getImmunity(attackType, candidate.types) && dex.getEffectiveness(attackType, candidate.types) > 0).length;
    const buffers = roster.filter(candidate => !dex.getImmunity(attackType, candidate.types) || dex.getEffectiveness(attackType, candidate.types) < 0).length;
    pressure += Math.max(0, weaknesses - buffers - 1);
  }
  return pressure;
}

function lineupWhiteBoxCandidate(manager: Manager, lineup: Candidate[], opponentManager: Manager, dex: ReturnType<typeof Dex.mod>): WhiteBoxCandidate {
  const opponent = opponentManager.roster.map(entry => entry.candidate);
  const matchup = manager.matchupMemory[opponentManager.id];
  const members = lineup.map(candidate => {
    const moveTypes = candidate.set.moves.map(move => dex.moves.get(move)).filter(move => move.category !== "Status").map(move => move.type);
    return {
      id: candidate.id,
      strength: candidate.strength,
      market: candidate.market,
      roles: [...candidate.roles],
      risk: riskValue(candidate, dex),
      opponentCoverage: opponent.filter(target => moveTypes.some(type => dex.getEffectiveness(type, target.types) > 0)).length,
      historicalMatchup: matchup?.familyScores[candidate.family] ?? 0,
      tacticalMemory: tacticalFamilyValue(manager.tacticalMemory, opponentManager.id, candidate.family),
    };
  });
  const input: WhiteBoxLineupInput = {
    id: lineupCandidateId(lineup),
    members,
    traits: manager.traits,
    roleTargets: manager.roleTargets,
  };
  const base = buildLineupWhiteBoxCandidate(input);
  const baseline = whiteBoxCandidateTotal(base);
  const programAdjustment = programEvolution
    ? evaluateStrategyProgram(manager.strategyProgram, "lineup", {baseline: baseline / 10, strength: lineup.reduce((sum, candidate) => sum + candidate.strength, 0) / 1800, roleBreadth: new Set(lineup.flatMap(candidate => [...candidate.roles])).size / 10, rosterSize: manager.roster.length / maximumRosterSize, opponentPressure: opponent.reduce((sum, candidate) => sum + candidate.strength, 0) / 1800}).value * .2
    : 0;
  return buildLineupWhiteBoxCandidate({...input, programAdjustment});
}

function lineupCandidateId(lineup: Candidate[]): string {
  return lineup.map(candidate => candidate.id).sort().join("+");
}

function programTactics(manager: Manager, opponent: Manager): Manager["tactics"] {
  if (!programEvolution) return manager.tactics;
  const memory = tacticalSignals(manager.tacticalMemory, opponent.id);
  const value = evaluateStrategyProgram(manager.strategyProgram, "battle", {baseline: 0, strength: manager.roster.reduce((sum, entry) => sum + entry.candidate.strength, 0) / 2400, opponentPressure: opponent.roster.reduce((sum, entry) => sum + entry.candidate.strength, 0) / 2400, rosterSize: manager.roster.length / maximumRosterSize, tacticalConfidence: memory.confidence, historicalWinRate: memory.historicalWinRate, opponentLeadConcentration: memory.opponentLeadConcentration, opponentSwitchRate: memory.opponentSwitchRate}).value;
  return {...manager.tactics, aggression: clampBiasValue(manager.tactics.aggression + value * .15), setupBias: clampBiasValue(manager.tactics.setupBias + value * .08), switchBias: clampBiasValue(manager.tactics.switchBias - value * .08)};
}

function clampBiasValue(value: number): number { return Math.max(-1, Math.min(1, value)); }

function lineupReasons(lineup: RosterEntry[], opponent: Manager, dex: ReturnType<typeof Dex.mod>): string[] {
  const roles = new Set(lineup.flatMap(entry => [...entry.candidate.roles]));
  return [`覆盖功能：${[...roles].join("/")}`, `针对${opponent.name}的属性与速度线`, `保留${lineup.filter(entry => entry.candidate.roles.has("pivot")).length}个转场点`];
}

function chooseSix<T>(roster: T[]): T[][] {
  return chooseK(roster, 6);
}

function missingRoles(manager: Manager): Role[] {
  return manager.preferredRoles.filter(role => !manager.roster.some(entry => entry.candidate.roles.has(role)));
}

function explainFit(manager: Manager, candidate: Candidate): string[] {
  const fills = missingRoles(manager).filter(role => candidate.roles.has(role));
  return [`通用实力${candidate.strength.toFixed(1)}`, fills.length ? `补上${fills.join("/")}` : "提高现有体系质量", `角色数${candidate.roles.size}`];
}

function explainRejection(manager: Manager, candidate: Candidate): string[] {
  const reasons = [];
  if (candidate.types.some(type => manager.roster.filter(entry => entry.candidate.types.includes(type)).length >= 2)) reasons.push("属性重复");
  if (!missingRoles(manager).some(role => candidate.roles.has(role))) reasons.push("未填补首要缺口");
  return reasons.length ? reasons : ["综合前瞻略低"];
}

function confidence(first: number, second = first): number {
  return Math.max(0, Math.min(1, (first - second) / Math.max(1, Math.abs(first)) * 5));
}

function sourceAbilities(dex: ReturnType<typeof Dex.mod>, ability: string): Set<string> {
  const effect = dex.abilities.get(ability) as unknown as {id: string; mythicSourceAbilities?: string[]};
  return new Set((effect.mythicSourceAbilities ?? [effect.id]).map(toID));
}

function sourceItems(dex: ReturnType<typeof Dex.mod>, item: string): Set<string> {
  const effect = dex.items.get(item) as unknown as {id: string; mythicSourceItems?: string[]};
  return new Set((effect.mythicSourceItems ?? [effect.id]).map(toID));
}

function normalizeSet(source: PokemonSet): PokemonSet {
  const set = cloneSet(source);
  const stats = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
  set.level = 100;
  set.evs = Object.fromEntries(stats.map(stat => [stat, 252])) as PokemonSet["evs"];
  set.ivs = Object.fromEntries(stats.map(stat => [stat, source.ivs?.[stat] === 0 ? 0 : 31])) as PokemonSet["ivs"];
  return set;
}

function cloneSet(set: PokemonSet): PokemonSet { return JSON.parse(JSON.stringify(set)) as PokemonSet; }
function shuffledManagers(label: string): Manager[] { return [...managers].sort((a, b) => tie(`${label}:${a.id}`, 0) - tie(`${label}:${b.id}`, 0)); }
function tie(value: string, pick: number): number { return Number.parseInt(crypto.createHash("sha256").update(`${seed}:${pick}:${value}`).digest("hex").slice(0, 8), 16); }
function poolTie(value: string): number { return Number.parseInt(crypto.createHash("sha256").update(`${poolSeed}:${value}`).digest("hex").slice(0, 8), 16); }

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
