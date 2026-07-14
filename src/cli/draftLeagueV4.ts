import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import {spawnSync} from "node:child_process";
import {DecisionLedger, type DecisionRecord} from "../draft/decisionLedger";
import {reviewManagerSeason, updateMatchupMemory, type DynastyRosterMember, type DynastyStanding, type KeeperContract, type SeasonReview} from "../draft/dynastyLearning";
import {classifyEmergentStyle, cloneManagerProfile, createNoviceProfiles, materializeManagerProfile, type ManagerProfile, type ManagerTraits} from "../draft/managerProfiles";
import {evolveManagerPopulation, founderLineage, type EvolutionCompetitor, type LineageIdentity, type ObservedBehavior} from "../draft/naturalEvolution";
import {extractTacticalEpisode, updateTacticalMemory, type TacticalEpisode} from "../draft/tacticalMemory";
import {auditLeagueSeason, type LeagueHealthSnapshot} from "../draft/leagueHealth";
import {updateQualityDiversityArchive, type QualityDiversityCandidate} from "../draft/qualityDiversity";
import {chooseRfaOffer, matchingContract, releaseDeadMoney, taggedContract, waiverWinner, type ContractOffer, type SportsContract} from "../draft/sportsMarket";
import {evaluateStrategyProgram, countProgramNodes, strategyProgramHash, validateStrategyProgram} from "../draft/strategyProgram";
import {createRegistrySnapshot, loadRegistrySnapshot, type RegistrySnapshot} from "../draft/registrySnapshot";
import {acquireRunLock} from "../draft/runLock";
import {writeSeasonBrief} from "../draft/seasonBrief";

interface SeasonResult {
  season: number;
  champion: {id: string; name: string};
  standings: DynastyStanding[];
  league: Array<{id: string; left: string; right: string; leftPairs: number; rightPairs: number}>;
  playoffs?: {playIns?: Array<{left: string; right: string}>; quarters?: Array<{left: string; right: string}>; semifinals?: Array<{left: string; right: string}>; final?: {left: string; right: string}};
  validity?: {schemaVersion: number; valid: boolean; battleLineupSize: number};
}

interface RosterFile {
  managerId: string;
  manager: string;
  budget: number;
  members: DynastyRosterMember[];
  departedMembers?: DynastyRosterMember[];
}

interface MarketAggregate {
  totalPrice: number;
  acquisitions: number;
  appearances: number;
  kos: number;
  currentValue?: number;
  lastSeason?: number;
}

interface AssetLedgerEntry {
  assetId: string;
  family: string;
  pokemon: string;
  scarcity: "legendary" | "unique-custom" | "elite-ordinary" | "standard";
  supplyCap: number;
  ownerId: string | null;
  status: "owned" | "available" | "locked";
  firstSeason: number;
  lastSeason: number;
  economicClass?: "limited" | "unique";
}

interface CareerSeason {
  season: number;
  rank: number;
  points: number;
  champion: boolean;
  roster: DynastyRosterMember[];
  review: SeasonReview;
}

interface ManagerCareer {
  id: string;
  name: string;
  baseProfile: ManagerProfile;
  currentProfile: ManagerProfile;
  contracts: KeeperContract[];
  cash: number;
  titles: number;
  totalPoints: number;
  seasons: CareerSeason[];
  lineage: LineageIdentity;
  lineageHistory: LineageIdentity[];
  pendingProfile?: ManagerProfile;
  pendingLineage?: LineageIdentity;
  deadMoneyCurrent?: number;
  deadMoneyNext?: number;
}

interface DynastyState {
  version: number;
  seed: string;
  completedSeason: number;
  settings: {seasonCount: number; managerLimit: number; pairs: number; poolSize: number; auctionLots: number; maxTurns: number; regularRounds: number; baseBudget?: number; keeperCap?: number; auctionMode?: string; minRoster?: number; maxRoster?: number; midseasonGrant?: number; contractModel?: string; dynamicPool?: boolean; learningModel?: string; carryRate?: number; carryCap?: number; maxKeepers?: number; separatePayroll?: boolean; dualLayer?: boolean; programEvolution?: boolean};
  managers: ManagerCareer[];
  market: Record<string, MarketAggregate>;
  assets: Record<string, AssetLedgerEntry>;
  fingerprint: RuntimeFingerprint;
  decisionRecords: DecisionRecord[];
  evolutionArchive?: Array<QualityDiversityCandidate<EvolutionCompetitor>>;
  leaguePool?: number;
  moneySupply?: number;
  registry?: {schemaVersion: 1; revision: string; hash: string; namespace: string; snapshot: string};
}

interface LegacyDynastyState extends Omit<DynastyState, "version" | "managers" | "assets"> {
  version: 5;
  managers: Array<Omit<ManagerCareer, "cash" | "lineage" | "lineageHistory" | "pendingProfile" | "pendingLineage">>;
}

interface LegacyV6State extends Omit<DynastyState, "version" | "managers"> {
  version: 6;
  managers: Array<Omit<ManagerCareer, "lineage" | "lineageHistory">>;
}

interface RuntimeFingerprint {
  codeHash: string;
  dataHash: string;
  registryHash: string;
  benchmarkHash: string;
  dependencyHash: string;
  pokemonShowdownVersion: string;
}

const root = process.cwd();
const seed = process.env.V4_SEED || "dynasty-league-v4";
const outDir = path.resolve(process.env.V4_OUT || "output/draft-league-v4");
const seasonCount = integerSetting("V4_SEASONS", 8, 1, 100);
const managerLimit = integerSetting("V4_MANAGER_LIMIT", 10, 6, 30);
const pairs = integerSetting("V4_PAIRS", 1, 1, 10);
const poolSize = integerSetting("V4_POOL_SIZE", managerLimit > 10 ? 420 : 240, 100, 800);
const auctionLots = integerSetting("V4_AUCTION_LOTS", managerLimit > 10 ? managerLimit * 2 : Math.min(24, managerLimit * 3), 10, Math.min(90, managerLimit * 3));
const maxTurns = integerSetting("V4_MAX_TURNS", 180, 20, 1000);
const regularRounds = integerSetting("V4_REGULAR_ROUNDS", managerLimit > 10 ? 24 : managerLimit - 1, 1, managerLimit - 1);
const stateVersion = integerSetting("V4_STATE_VERSION", 8, 8, 12);
const dualLayer = stateVersion >= 11 || /^(1|true|yes)$/i.test(process.env.V4_DUAL_LAYER || "false");
const programEvolution = stateVersion >= 12 || /^(1|true|yes)$/i.test(process.env.V4_PROGRAM_EVOLUTION || "false");
if (dualLayer) process.env.V4_DUAL_LAYER = "true";
if (programEvolution) process.env.V4_PROGRAM_EVOLUTION = "true";
const baseBudget = integerSetting("V4_BASE_BUDGET", 100, 20, 120);
const keeperCap = integerSetting("V4_KEEPER_CAP", 70, 40, 120);
const auctionMode = process.env.V4_AUCTION_MODE || "sequential";
const minRoster = integerSetting("V4_MIN_ROSTER", 8, 6, 10);
const maxRoster = integerSetting("V4_MAX_ROSTER", 8, minRoster, 10);
const midseasonGrant = integerSetting("V4_MIDSEASON_GRANT", 0, 0, 20);
const contractModel = process.env.V4_CONTRACT_MODEL || "compound";
const dynamicPool = /^(1|true|yes)$/i.test(process.env.V4_DYNAMIC_POOL || "false");
const learningModel = process.env.V4_LEARNING_MODEL || "observational";
const carryRate = numberSetting("V4_CARRY_RATE", .5, 0, 1);
const carryCap = integerSetting("V4_CARRY_CAP", 20, 0, 80);
const maxKeepers = integerSetting("V4_MAX_KEEPERS", 3, 3, 10);
const separatePayroll = /^(1|true|yes)$/i.test(process.env.V4_SEPARATE_PAYROLL || "false");
const resume = /^(1|true|yes)$/i.test(process.env.V4_RESUME || "false");
const expandFromV5 = /^(1|true|yes)$/i.test(process.env.V4_EXPAND_FROM_V5 || "false");
const adoptRegistry = /^(1|true|yes)$/i.test(process.env.V4_ADOPT_REGISTRY || "false");
const allowCodeUpgrade = /^(1|true|yes)$/i.test(process.env.V4_ALLOW_CODE_UPGRADE || "false");
const registrySource = path.resolve(process.env.V4_REGISTRY_SOURCE || path.join(root, "data", "draft"));
let registrySnapshot: RegistrySnapshot;
let runtimeFingerprint: RuntimeFingerprint;
const initialProfiles = createNoviceProfiles(managerLimit);
let managers: ManagerCareer[] = initialProfiles.map(profile => ({
  id: profile.id,
  name: profile.name,
  baseProfile: cloneManagerProfile(profile),
  currentProfile: cloneManagerProfile(profile),
  contracts: [],
  cash: stateVersion >= 10 ? 40 : 0,
  titles: 0,
  totalPoints: 0,
  seasons: [],
  lineage: founderLineage(profile.id),
  lineageHistory: [founderLineage(profile.id)],
  deadMoneyCurrent: 0,
  deadMoneyNext: 0,
}));
let market = new Map<string, MarketAggregate>();
let assets = new Map<string, AssetLedgerEntry>();
let ledger = new DecisionLedger();
let evolutionArchive: Array<QualityDiversityCandidate<EvolutionCompetitor>> = [];
let leaguePool = 0;
let moneySupply = stateVersion >= 10 ? managerLimit * 40 : 0;

function main(): void {
  const lock = acquireRunLock(outDir, {seed, stateVersion});
  try {
    registrySnapshot = prepareRegistrySnapshot();
    runtimeFingerprint = computeRuntimeFingerprint();
    const completedSeason = resume ? restoreCheckpoint() : 0;
    for (let season = completedSeason + 1; season <= seasonCount; season += 1) runDynastySeason(season);
    writeDynastyOutputs();
    const latestChampion = managers.find(manager => manager.seasons.at(-1)?.season === seasonCount && manager.seasons.at(-1)?.champion);
    const careerLeader = managers.slice().sort((a, b) => b.titles - a.titles || b.totalPoints - a.totalPoints)[0];
    console.log(JSON.stringify({seasons: seasonCount, managers: managerLimit, champion: latestChampion?.name, careerLeader: careerLeader?.name, decisions: ledger.all().length, registry: {revision: registrySnapshot.revision, hash: registrySnapshot.hash}, output: outDir}, null, 2));
  } finally { lock.release(); }
}

function restoreCheckpoint(): number {
  const statePath = path.join(outDir, "dynasty-state.json");
  if (!fs.existsSync(statePath)) return 0;
  const state = readJson<DynastyState>(statePath);
  if (state.version === 5 && expandFromV5) return migrateExpansionState(state as unknown as LegacyDynastyState);
  if (state.version === 6) return migrateNaturalEvolutionState(state as unknown as LegacyV6State);
  if (state.version === 7) throw new Error("V7 experimental evolution state cannot distinguish tested parents from untested offspring; resume from its V6 source or start a newer league");
  if (state.version !== stateVersion) throw new Error(`Unsupported dynasty state version ${state.version}; expected ${stateVersion}`);
  if (state.seed !== seed) throw new Error("V4_SEED does not match the saved dynasty");
  if (!settingsMatch(state.settings)) throw new Error("V4 settings do not match the saved dynasty");
  if (seasonCount < state.completedSeason) throw new Error("V4_SEASONS cannot be lower than the completed season count");
  validateDynastyState(state);
  if (!state.fingerprint || typeof state.fingerprint !== "object") throw new Error("Saved dynasty has no runtime fingerprint");
  const legacyRegistryMigration = stateVersion >= 12 && !state.registry && adoptRegistry;
  const codeUpgrade = allowCodeUpgrade && state.fingerprint.codeHash !== runtimeFingerprint.codeHash;
  if (stateVersion >= 12 && !state.registry && !adoptRegistry) throw new Error("Saved V12 dynasty predates registry snapshots; resume once with V12_ADOPT_REGISTRY=true to migrate it safely");
  if (legacyRegistryMigration && state.fingerprint.dataHash !== computeLegacyDataHash()) throw new Error("Legacy dynasty dataHash does not match the current registry and benchmarks; automatic snapshot migration is unsafe");
  for (const key of Object.keys(runtimeFingerprint) as Array<keyof RuntimeFingerprint>) {
    const registryChange = adoptRegistry && (key === "registryHash" || key === "dataHash");
    const migrationChange = legacyRegistryMigration && ["codeHash", "dataHash", "registryHash", "benchmarkHash"].includes(key);
    const explicitCodeChange = codeUpgrade && key === "codeHash";
    if (state.fingerprint[key] !== runtimeFingerprint[key] && !registryChange && !migrationChange && !explicitCodeChange) throw new Error(`Saved dynasty ${key} does not match the current runtime`);
  }
  managers = state.managers;
  market = new Map(Object.entries(state.market));
  assets = new Map(Object.entries(state.assets ?? {}));
  ledger = new DecisionLedger(state.decisionRecords);
  if (codeUpgrade) ledger.add({stage: "calibration", actor: "system", decision: "显式采用联盟代码升级", selected: runtimeFingerprint.codeHash, context: {before: state.fingerprint.codeHash, after: runtimeFingerprint.codeHash, registryHash: runtimeFingerprint.registryHash, benchmarkHash: runtimeFingerprint.benchmarkHash, dependencyHash: runtimeFingerprint.dependencyHash}, alternatives: [{option: "继续使用原代码版本"}], rationale: ["仅放宽代码哈希，配置、基准、依赖和Showdown版本仍需通过兼容性校验", "迁移记录进入联盟永久决策账本"]});
  evolutionArchive = state.evolutionArchive ?? [];
  leaguePool = state.leaguePool ?? 0;
  moneySupply = state.moneySupply ?? (stateVersion >= 10 ? state.managers.reduce((sum, manager) => sum + manager.cash, 0) + leaguePool : 0);
  if (adoptRegistry && state.registry?.hash !== registrySnapshot.hash) ledger.add({stage: "calibration", actor: "system", decision: legacyRegistryMigration ? "迁移旧联盟并冻结魔改配置" : "采用新的魔改配置版本", selected: registrySnapshot.revision, context: {before: state.registry?.hash, after: registrySnapshot.hash}, alternatives: [{option: "继续沿用联盟冻结快照"}], rationale: ["配置升级由联盟启动参数显式触发", "历史赛季仍保留原配置哈希"]});
  process.stdout.write(`V4 resumed after season ${state.completedSeason}\n`);
  return state.completedSeason;
}

function migrateNaturalEvolutionState(state: LegacyV6State): number {
  validateMigrationCompatibility(state);
  managers = state.managers.map(manager => {
    const lineage = founderLineage(manager.id);
    return {...manager, lineage, lineageHistory: [lineage]};
  });
  market = new Map(Object.entries(state.market));
  assets = new Map(Object.entries(state.assets));
  ledger = new DecisionLedger(state.decisionRecords);
  evolutionArchive = [];
  ledger.add({stage: "calibration", actor: "system", decision: "迁移到自然进化经理种群", selected: `${managers.length}条创始谱系`, context: {season: state.completedSeason}, alternatives: [{option: "继续固定人格后验"}], rationale: ["球队席位保留合同和历史", "策略谱系从当前经理状态建立创始种群", "后续赛季通过繁殖、变异和生态位保护更替"]});
  checkpoint(state.completedSeason);
  return state.completedSeason;
}

function validateMigrationCompatibility(state: Pick<DynastyState, "seed" | "completedSeason" | "settings" | "fingerprint">): void {
  if (state.seed !== seed) throw new Error("Migrated league seed does not match V4_SEED");
  if (state.settings.managerLimit !== managerLimit || state.settings.pairs !== pairs || state.settings.poolSize !== poolSize || state.settings.auctionLots !== auctionLots || state.settings.maxTurns !== maxTurns || state.settings.regularRounds !== regularRounds) throw new Error("Migrated league settings do not match the requested league");
  if (seasonCount < state.completedSeason) throw new Error("V4_SEASONS cannot be lower than the migrated league's completed season count");
  for (const key of ["dataHash", "dependencyHash", "pokemonShowdownVersion"] as const) if (state.fingerprint?.[key] !== runtimeFingerprint[key]) throw new Error(`Migrated league ${key} does not match the current runtime`);
}

function migrateExpansionState(state: LegacyDynastyState): number {
  validateExpansionMigration(state);
  if (state.completedSeason < 1) throw new Error("Expansion migration requires at least one completed season");
  if (state.managers.length >= managerLimit) throw new Error("Expansion migration requires a larger V4_MANAGER_LIMIT");
  const incumbentCount = state.managers.length;
  const expanded = initialProfiles.map((profile, index): ManagerCareer => {
    const incumbent = state.managers[index];
    if (incumbent) {
      const rosterPath = path.join(outDir, `season-${String(state.completedSeason).padStart(2, "0")}`, "rosters", incumbent.id, "roster.json");
      const cash = fs.existsSync(rosterPath) ? readJson<RosterFile>(rosterPath).budget : 0;
      const contracts = [...incumbent.contracts].sort((a, b) => b.lastSeasonKos - a.lastSeasonKos || b.lastSeasonAppearances - a.lastSeasonAppearances).slice(0, 2);
      const lineage = founderLineage(incumbent.id);
      return {...incumbent, cash, contracts, lineage, lineageHistory: [lineage]};
    }
    const lineage = founderLineage(profile.id);
    return {id: profile.id, name: profile.name, baseProfile: cloneManagerProfile(profile), currentProfile: cloneManagerProfile(profile), contracts: [], cash: 20, titles: 0, totalPoints: 0, seasons: [], lineage, lineageHistory: [lineage]};
  });
  managers = expanded;
  market = new Map(Object.entries(state.market));
  ledger = new DecisionLedger(state.decisionRecords);
  evolutionArchive = [];
  assets = new Map();
  syncAssetLedger(state.completedSeason, path.join(outDir, `season-${String(state.completedSeason).padStart(2, "0")}`));
  const protectedAssets = new Set(managers.flatMap(manager => manager.contracts.map(contract => contract.assetId).filter((assetId): assetId is string => Boolean(assetId))));
  for (const [assetId, asset] of assets) if (asset.ownerId && !protectedAssets.has(assetId)) assets.set(assetId, {...asset, ownerId: null, status: asset.scarcity === "standard" ? "available" : "locked"});
  ledger.add({stage: "calibration", actor: "system", decision: "V5创始联盟扩军至V6", selected: `${incumbentCount}队扩至${managerLimit}队`, context: {completedSeason: state.completedSeason, incumbents: incumbentCount, expansionTeams: managerLimit - incumbentCount, protectedPerIncumbent: 2, expansionCashCredit: 20}, alternatives: [{option: "重新开始联盟"}], rationale: ["保留创始赛季历史", "原队保护两份合同", "扩军队继承公共市场知识并获得首季预算补偿", "资产总账按既有assetId建立，禁止重新发行"]});
  checkpoint(state.completedSeason);
  process.stdout.write(`V6 expansion migration completed after season ${state.completedSeason}\n`);
  return state.completedSeason;
}

function validateExpansionMigration(state: LegacyDynastyState): void {
  if (state.seed !== seed) throw new Error("Expansion league seed does not match V4_SEED");
  if (state.settings.managerLimit !== state.managers.length || state.settings.pairs !== pairs || state.settings.poolSize !== poolSize || state.settings.auctionLots !== auctionLots || state.settings.maxTurns !== maxTurns || state.settings.regularRounds !== regularRounds) throw new Error("Expansion league settings do not match the requested migration");
  if (seasonCount < state.completedSeason) throw new Error("V4_SEASONS cannot be lower than the expansion league's completed season count");
  for (const key of ["dataHash", "dependencyHash", "pokemonShowdownVersion"] as const) if (state.fingerprint?.[key] !== runtimeFingerprint[key]) throw new Error(`Expansion league ${key} does not match the current runtime`);
}

function runDynastySeason(season: number): void {
  activatePendingGeneration(season);
  const seasonDir = path.join(outDir, `season-${String(season).padStart(2, "0")}`);
  fs.mkdirSync(seasonDir, {recursive: true});
  const profilePath = path.join(seasonDir, "manager-profiles.json");
  const keeperPath = path.join(seasonDir, "keepers.json");
  const marketPath = path.join(seasonDir, "market-history.json");
  const budgetPath = path.join(seasonDir, "starting-budgets.json");
  const assetPath = path.join(seasonDir, "asset-ledger.json");
  writeJson(profilePath, {season, managers: managers.map(manager => manager.currentProfile)});
  writeJson(keeperPath, {season, managers: Object.fromEntries(managers.map(manager => [manager.id, manager.contracts]))});
  writeJson(marketPath, {season, families: marketSnapshot()});
  const startingBudgets = Object.fromEntries(managers.map(manager => [manager.id, stateVersion >= 10 ? manager.cash : baseBudget + Math.min(carryCap, Math.floor(manager.cash * carryRate))]));
  writeJson(budgetPath, {season, managers: startingBudgets});
  writeJson(assetPath, {season, assets: Object.fromEntries(assets)});
  fs.writeFileSync(path.join(seasonDir, "preseason-thesis.md"), preseasonThesis(season), "utf8");

  ledger.add({stage: "calibration", actor: "system", decision: `启动王朝第${season}季`, selected: `${managerLimit}名经理`, context: {season, poolSize, auctionLots, pairs, keepers: managers.reduce((sum, manager) => sum + manager.contracts.length, 0)}, alternatives: [], rationale: ["所有经理使用相同学习规则，历史经验后验进入估值", "保留名单先占用预算，其余成员回到公共池", "同一系列赛完成双向换边后才进入赛后学习"]});
  runV3Season(season, seasonDir, profilePath, keeperPath, marketPath, budgetPath, assetPath);

  const seasonResult = readJson<SeasonResult>(path.join(seasonDir, "season.json"));
  if (stateVersion >= 12 && (!seasonResult.validity?.valid || seasonResult.validity.battleLineupSize !== 6)) throw new Error(`Season ${season} is not a valid V12 six-versus-six sample`);
  const seasonLedger = readJson<{records: DecisionRecord[]}>(path.join(seasonDir, "decision-ledger.json")).records;
  const waiverQueue: Array<{formerManager: ManagerCareer; contract: KeeperContract}> = [];
  for (const career of managers) {
    career.deadMoneyCurrent = career.deadMoneyNext ?? 0;
    career.deadMoneyNext = 0;
  }
  for (const career of managers) {
    const standing = seasonResult.standings.find(entry => entry.id === career.id);
    if (!standing) throw new Error(`Season ${season} has no standing for ${career.id}`);
    const rosterFile = readJson<RosterFile>(path.join(seasonDir, "rosters", career.id, "roster.json"));
    const roster = rosterFile.members;
    const previousContracts = career.contracts;
    const review = reviewManagerSeason(career.baseProfile, career.currentProfile, standing, seasonResult.standings, [...roster, ...(rosterFile.departedMembers ?? [])], seasonLedger, previousContracts, roster);
    const rank = seasonResult.standings.findIndex(entry => entry.id === career.id) + 1;
    const champion = seasonResult.champion.id === career.id;
    career.titles += champion ? 1 : 0;
    career.totalPoints += standing.points;
    career.seasons.push({season, rank, points: standing.points, champion, roster, review});
    career.contracts = review.keepers;
    if (stateVersion >= 10) for (const released of previousContracts.filter(contract => !career.contracts.some(keeper => keeper.assetId === contract.assetId) && (contract.yearsRemaining ?? 0) > 0)) waiverQueue.push({formerManager: career, contract: released});
    career.cash = rosterFile.budget;
    career.currentProfile = materializeManagerProfile({...career.currentProfile, traits: {...review.after}, development: review.developmentAfter});
    learnConfigurationPreferences(career, roster, standing, seasonResult.standings);
    learnOpponentMatchups(career, roster, seasonResult, seasonLedger);
    learnTacticalEpisodes(career, roster, seasonResult, seasonDir);
    updateMarket(roster);
    recordReviewDecision(season, career, review, champion);
  }
  writeJson(path.join(seasonDir, "tactical-learning.json"), {schemaVersion: 1, season, managers: managers.map(manager => ({id: manager.id, tacticalMemory: manager.currentProfile.tacticalMemory}))});
  if (stateVersion >= 10) {
    runContractWaivers(season, seasonResult, waiverQueue);
    runOffseasonContractMarket(season);
    for (let pass = 0; pass < 12; pass += 1) {
      const complianceWaivers = chooseHardApronReleases(season);
      if (!complianceWaivers.length) break;
      runContractWaivers(season, seasonResult, complianceWaivers);
    }
    if (managers.some(manager => payrollFor(manager.id) > 120)) throw new Error("The league could not reach hard-apron compliance after waiver processing");
    updateDynamicMarket(season, seasonLedger);
    settleClosedEconomy(season, seasonResult, startingBudgets, seasonDir);
  }
  evolvePopulation(season, seasonResult, seasonDir, seasonLedger);
  writeJson(path.join(seasonDir, "health.json"), auditLeagueSeason(seasonDir));
  if (stateVersion >= 10) writeFinancialHealth(seasonDir);
  syncAssetLedger(season, seasonDir);
  if (stateVersion >= 12) archiveBattleLogs(seasonDir);
  fs.writeFileSync(path.join(seasonDir, "season-review.md"), seasonReviewMarkdown(season, seasonResult), "utf8");
  if (stateVersion >= 12) writeSeasonBrief(seasonDir, outDir);
  checkpoint(season);
}

function learnConfigurationPreferences(career: ManagerCareer, roster: DynastyRosterMember[], standing: DynastyStanding, standings: DynastyStanding[]): void {
  const memory = career.currentProfile.configurationMemory ?? {moves: {}, items: {}};
  const maxPoints = Math.max(1, ...standings.map(entry => entry.points));
  const teamResult = standing.points / maxPoints;
  const updates: Array<Record<string, unknown>> = [];
  for (const member of roster.filter(entry => entry.configurationSource === "ai" && entry.configuredSet)) {
    const production = member.regularSeasonAppearances ? clamp01(member.regularSeasonKos / member.regularSeasonAppearances) : .25;
    for (const move of member.configuredSet?.moves ?? []) {
      const id = normalizeConfigurationId(move), observed = member.configurationEvidence?.moves[id];
      if (!observed?.uses) continue;
      const events = observed.damageEvents + observed.statusEvents + observed.healEvents + observed.boostEvents;
      let evidence = clamp01(teamResult * .15 + Math.min(1, events / observed.uses) * .45 + Math.min(1, observed.kos / observed.uses * 2) * .25 + production * .15);
      if (stateVersion >= 12) evidence = clamp01(evidence + evaluateStrategyProgram(career.currentProfile.strategyProgram, "learn", {baseline: evidence, usage: Math.min(1, observed.uses / 20), production, teamResult}).value * .08);
      updates.push({kind: "move", id, pokemon: member.pokemon, evidence: observed, ...updateConfigurationPosterior(memory.moves, id, evidence, Math.min(4, observed.uses))});
    }
    if (member.configuredSet?.item) {
      const id = normalizeConfigurationId(member.configuredSet.item), observed = member.configurationEvidence?.items[id];
      if (observed?.triggers) {
        const evidence = clamp01(teamResult * .2 + production * .55 + Math.min(1, observed.triggers / Math.max(1, member.regularSeasonAppearances)) * .25);
        updates.push({kind: "item", id, pokemon: member.pokemon, evidence: observed, ...updateConfigurationPosterior(memory.items, id, evidence, Math.min(3, observed.triggers))});
      }
    }
  }
  career.currentProfile.configurationMemory = memory;
  ledger.add({stage: "review", actor: career.id, decision: `第${career.currentProfile.development.seasons}季配置证据更新`, selected: `${updates.length}项后验`, context: {programHash: strategyProgramHash(career.currentProfile.strategyProgram!), updates}, alternatives: [], rationale: updates.length ? ["仅使用实际出招或道具触发事件", "每项记录更新前后后验与有效样本"] : ["本季没有可归因的配置事件，后验保持不变"]});
}

function updateConfigurationPosterior(memory: Record<string, {mean: number; confidence: number; effectiveSamples: number}>, id: string, evidence: number, weight = 1): {before: {mean: number; confidence: number; effectiveSamples: number}; after: {mean: number; confidence: number; effectiveSamples: number}} {
  const prior = memory[id] ?? {mean: .5, confidence: 0, effectiveSamples: 2};
  const retained = Math.max(2, prior.effectiveSamples * .94);
  const effectiveSamples = Math.min(24, retained + weight);
  memory[id] = {mean: (prior.mean * retained + evidence * weight) / effectiveSamples, confidence: Math.min(1, Math.max(0, (effectiveSamples - 2) / 10)), effectiveSamples};
  return {before: {...prior}, after: {...memory[id]}};
}

function normalizeConfigurationId(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }

function activatePendingGeneration(season: number): void {
  for (const career of managers) {
    if (!career.pendingProfile || !career.pendingLineage) continue;
    career.currentProfile = career.pendingProfile;
    career.lineage = career.pendingLineage;
    career.lineageHistory.push(career.pendingLineage);
    career.pendingProfile = undefined;
    career.pendingLineage = undefined;
    ledger.add({stage: "calibration", actor: career.id, decision: `第${season}季启用新生策略谱系`, selected: career.lineage.lineageId, context: {season, niche: career.lineage.niche, mutations: career.lineage.mutations}, alternatives: [], rationale: ["后代只在进入正式赛季时成为当前人格", "上一赛季报告继续引用已经参赛验证的亲代"]});
  }
}

function evolvePopulation(season: number, result: SeasonResult, seasonDir: string, decisions: readonly DecisionRecord[]): void {
  const competitors = managers.map(career => {
    const standing = result.standings.find(entry => entry.id === career.id)!;
    const seasonEntry = career.seasons.find(entry => entry.season === season)!;
    return {slotId: career.id, profile: career.currentProfile, lineage: career.lineage, points: standing.points, rank: result.standings.findIndex(entry => entry.id === career.id) + 1, behavior: observedBehavior(career.id, standing, seasonEntry.roster, result, decisions), playoffScore: playoffScore(career.id, result), champion: result.champion.id === career.id};
  });
  const maxPoints = Math.max(1, ...competitors.map(entry => entry.points));
  evolutionArchive = updateQualityDiversityArchive(evolutionArchive, competitors.map(entry => ({
    id: entry.lineage.lineageId,
    behavior: behaviorVector(entry.behavior),
    quality: entry.points / maxPoints * .7 + (entry.playoffScore ?? 0) * .3,
    season,
    payload: {...entry, slotId: `archive:${entry.lineage.lineageId}`},
  })), 300);
  const descendants = evolveManagerPopulation(competitors, season, seed, evolutionArchive.map(entry => entry.payload));
  const report = descendants.map(descendant => {
    const slot = managers.find(manager => manager.id === descendant.slotId)!;
    const previous = slot.lineage;
    slot.pendingProfile = descendant.profile;
    slot.pendingLineage = descendant.lineage;
    ledger.add({stage: "review", actor: slot.id, decision: `第${season}季谱系繁殖`, selected: descendant.lineage.lineageId, context: {season, parentSlot: descendant.parentSlotId, secondParentSlot: descendant.secondParentSlotId, previousLineage: previous.lineageId, niche: descendant.lineage.niche, mutations: descendant.lineage.mutations, ecologicalFitness: descendant.ecologicalFitness, protectedCopy: descendant.protectedCopy}, alternatives: [{option: "保留原策略谱系"}], rationale: ["物种由本季实际行为向量动态聚类", descendant.protectedCopy ? "该后代是未经交叉和突变的物种精英副本" : "该后代通过遗传、重组或突变产生", "后代将在下一正式赛季开始时接受验证"]});
    return {previousLineage: previous.lineageId, ...descendant, program: {hash: strategyProgramHash(descendant.profile.strategyProgram!), nodes: countProgramNodes(descendant.profile.strategyProgram!)}, profile: undefined};
  });
  writeJson(path.join(seasonDir, "evolution.json"), {schemaVersion: 1, season, descendants: report});
}

function behaviorVector(value: ObservedBehavior): number[] {
  return [value.pace, value.lineupVariation, value.starInvestment, value.roleBreadth, value.rosterTurnover, value.knockoutPressure, value.backgroundReliance ?? 0, value.configurationAggression ?? 0, value.systemConcentration ?? 0];
}

function playoffScore(managerId: string, result: SeasonResult): number {
  if (result.champion.id === managerId) return 1;
  const playoffs = result.playoffs;
  if (!playoffs) return 0;
  if (playoffs.final && [playoffs.final.left, playoffs.final.right].includes(managerId)) return .8;
  if (playoffs.semifinals?.some(series => [series.left, series.right].includes(managerId))) return .6;
  if (playoffs.quarters?.some(series => [series.left, series.right].includes(managerId))) return .4;
  if (playoffs.playIns?.some(series => [series.left, series.right].includes(managerId))) return .2;
  return 0;
}

function observedBehavior(managerId: string, standing: DynastyStanding, roster: DynastyRosterMember[], result: SeasonResult, decisions: readonly DecisionRecord[]): ObservedBehavior {
  const lineups = decisions.filter(record => record.stage === "lineup" && record.actor === managerId);
  const uniqueLineups = new Set(lineups.map(record => JSON.stringify(record.selected))).size;
  const battles = decisions.filter(record => record.stage === "battle" && (record.context.left === managerId || record.context.right === managerId));
  const turns = battles.map(record => Number(record.outcome?.turns ?? 0)).filter(value => value > 0);
  const averageTurns = turns.length ? turns.reduce((sum, value) => sum + value, 0) / turns.length : 32;
  const totalPrice = Math.max(1, roster.reduce((sum, member) => sum + member.price, 0));
  const starPrice = roster.filter(member => member.price >= 20).reduce((sum, member) => sum + member.price, 0);
  const roles = new Set(roster.flatMap(member => member.roles ?? []));
  const roleCounts = [...roles].map(role => roster.filter(member => member.roles?.includes(role)).length);
  const aggressiveConfigurations = roster.filter(member => {
    const evs = member.configuredSet?.evs ?? {};
    const item = member.configuredSet?.item ?? "";
    return (evs.spe ?? 0) >= 252 || /Choice|Life Orb/i.test(item);
  }).length;
  const maxKos = Math.max(1, ...result.standings.map(entry => entry.kos));
  return {
    pace: clamp01((52 - averageTurns) / 40),
    lineupVariation: lineups.length ? clamp01(uniqueLineups / lineups.length) : 0,
    starInvestment: clamp01(starPrice / totalPrice),
    roleBreadth: clamp01(roles.size / 10),
    rosterTurnover: clamp01(roster.filter(member => member.method === "free-agent" || member.method === "supplemental").length / Math.max(1, roster.length)),
    knockoutPressure: clamp01(standing.kos / maxKos),
    backgroundReliance: clamp01(roster.filter(member => member.economicClass === "background").length / Math.max(1, roster.length)),
    configurationAggression: clamp01(aggressiveConfigurations / Math.max(1, roster.length)),
    systemConcentration: clamp01((Math.max(0, ...roleCounts) / Math.max(1, roster.length) - .25) / .75),
  };
}

function learnOpponentMatchups(career: ManagerCareer, roster: DynastyRosterMember[], season: SeasonResult, decisions: readonly DecisionRecord[]): void {
  const nameToFamily = new Map(roster.map(member => [member.pokemon, member.family]));
  const memories = career.currentProfile.matchupMemory ?? {};
  for (const series of season.league) {
    if (series.left !== career.id && series.right !== career.id) continue;
    const opponent = series.left === career.id ? series.right : series.left;
    const ownPairs = series.left === career.id ? series.leftPairs : series.rightPairs;
    const opposingPairs = series.left === career.id ? series.rightPairs : series.leftPairs;
    const result = ownPairs > opposingPairs ? "win" : ownPairs < opposingPairs ? "loss" : "draw";
    const lineup = decisions.find(record => record.stage === "lineup" && record.actor === career.id && record.context.seriesId === series.id);
    const selectedNames = Array.isArray(lineup?.selected) ? lineup.selected : [];
    const selectedFamilies = selectedNames.map(name => nameToFamily.get(name)).filter((family): family is string => Boolean(family));
    memories[opponent] = updateMatchupMemory(memories[opponent], selectedFamilies, result, career.currentProfile.learning.memoryDecay);
  }
  career.currentProfile.matchupMemory = memories;
}

function learnTacticalEpisodes(career: ManagerCareer, roster: DynastyRosterMember[], season: SeasonResult, seasonDir: string): void {
  const familyByName = new Map<string, string>();
  for (const member of roster) {
    for (const name of [member.pokemon, member.family, member.configuredSet?.name, member.configuredSet?.species]) {
      if (name) familyByName.set(normalizeConfigurationId(name), member.family);
    }
  }
  const episodes: TacticalEpisode[] = [];
  for (const series of season.league) {
    if (series.left !== career.id && series.right !== career.id) continue;
    const opponentId = series.left === career.id ? series.right : series.left;
    for (const orientation of ["left-p1", "right-p1"] as const) {
      const battleDir = path.join(seasonDir, "battles", series.id, orientation);
      if (!fs.existsSync(battleDir)) continue;
      const leftIsP1 = orientation === "left-p1";
      const ownIsLeft = series.left === career.id;
      const perspective = (ownIsLeft === leftIsP1 ? "p1" : "p2") as "p1" | "p2";
      for (const entry of fs.readdirSync(battleDir, {withFileTypes: true}).filter(value => value.isDirectory() && /^game-/.test(value.name)).sort((left, right) => left.name.localeCompare(right.name))) {
        const publicLogPath = path.join(battleDir, entry.name, "public.log");
        if (!fs.existsSync(publicLogPath)) continue;
        episodes.push(extractTacticalEpisode({id: `${series.id}:${orientation}:${entry.name}`, opponentId, publicLogPath, perspective, familyByName}));
      }
    }
  }
  career.currentProfile.tacticalMemory = updateTacticalMemory(career.currentProfile.tacticalMemory, episodes, season.season, career.currentProfile.learning.memoryDecay);
  ledger.add({stage: "review", actor: career.id, decision: `Season ${season.season} tactical memory update`, selected: `${episodes.length} battle episodes`, context: {season: season.season, episodes: episodes.length, opponents: [...new Set(episodes.map(episode => episode.opponentId))], decisiveEvents: episodes.reduce((sum, episode) => sum + episode.decisiveEvents.length, 0)}, alternatives: [], rationale: ["Credit is assigned from observed knockouts, survival, fainting, moves, leads, and switches", "Event evidence persists into future lineup and strategy-program decisions"]});
}

function runV3Season(season: number, seasonDir: string, profilePath: string, keeperPath: string, marketPath: string, budgetPath: string, assetPath: string): void {
  const tsxCli = require.resolve("tsx/cli");
  const child = spawnSync(process.execPath, [tsxCli, path.join(root, "src", "cli", "draftLeagueV3.ts")], {
    cwd: root,
    env: {
      ...process.env,
      V3_SEED: `${seed}:season:${season}`,
      V3_POOL_SEED: dynamicPool ? `${seed}:season:${season}:pool` : `${seed}:shared-pool`,
      V3_UNIVERSE_SEED: `${seed}:shared-universe`,
      V3_OUT: seasonDir,
      V3_SEASON_NUMBER: String(season),
      V3_MANAGER_LIMIT: String(managerLimit),
      V3_POOL_SIZE: String(poolSize),
      V3_AUCTION_LOTS: String(auctionLots),
      V3_PAIRS: String(pairs),
      V3_MAX_TURNS: String(maxTurns),
      V3_REGULAR_ROUNDS: String(regularRounds),
      V3_MANAGER_PROFILES: profilePath,
      V3_KEEPERS: keeperPath,
      V3_MARKET_HISTORY: marketPath,
      V3_BUDGETS: budgetPath,
      V3_ASSET_LEDGER: assetPath,
      V3_AUCTION_MODE: auctionMode,
      V3_MIN_ROSTER: String(minRoster),
      V3_MAX_ROSTER: String(maxRoster),
      V3_MIDSEASON_GRANT: String(midseasonGrant),
      V3_KEEPER_CAP: String(keeperCap),
      V3_MAX_KEEPERS: String(maxKeepers),
      V3_SEPARATE_PAYROLL: String(separatePayroll),
      V3_DUAL_LAYER: String(dualLayer),
      V3_PROGRAM_EVOLUTION: String(programEvolution),
      V4_DUAL_LAYER: String(dualLayer),
      V3_UNLOCK_GENERATION: String(Math.min(9, season)),
      V4_CURRENT_SEASON: String(season),
      V3_DRY_RUN: "false",
      V3_REGISTRY_DIR: registrySnapshot.directory,
      V3_REGISTRY_HASH: registrySnapshot.hash,
      V3_REGISTRY_NAMESPACE: registrySnapshot.namespace,
    },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.status !== 0) throw new Error(`Season ${season} failed:\n${child.stderr || child.stdout}`);
  process.stdout.write(`V4 season ${season}/${seasonCount} complete\n`);
}

function updateMarket(roster: DynastyRosterMember[]): void {
  for (const member of roster) {
    if (dualLayer && member.economicClass === "background") continue;
    const aggregate = market.get(member.family) ?? {totalPrice: 0, acquisitions: 0, appearances: 0, kos: 0};
    aggregate.totalPrice += member.price;
    aggregate.acquisitions += 1;
    aggregate.appearances += member.appearances;
    aggregate.kos += member.kos;
    market.set(member.family, aggregate);
  }
}

function runContractWaivers(season: number, result: SeasonResult, queue: Array<{formerManager: ManagerCareer; contract: KeeperContract}>): void {
  for (const entry of queue) {
    const contract = asSportsContract(entry.formerManager.id, entry.contract, season);
    const transferredOwner = managers.find(manager => manager !== entry.formerManager && manager.contracts.some(item => item.assetId === contract.assetId));
    if (transferredOwner) {
      ledger.add({stage: "waiver", actor: transferredOwner.id, decision: `第${season}季确认交易合同转移`, selected: contract.pokemon, context: {formerTeam: entry.formerManager.id, assetId: contract.assetId, salary: contract.salary}, alternatives: [], rationale: ["新球队已持有同一资产合同", "原队旧合同记录退出，不重复进入waiver且不产生死钱"]});
      continue;
    }
    const claims = managers.filter(manager => manager !== entry.formerManager && manager.contracts.length < maxKeepers && !manager.contracts.some(item => item.family === contract.family) && payrollFor(manager.id) + contract.salary <= 120).filter(manager => {
      const appetite = .72 + manager.currentProfile.traits.stars * .25 + manager.currentProfile.traits.value * Math.max(0, contract.marketValue - contract.salary) / Math.max(1, contract.marketValue) * .35;
      return contract.marketValue * appetite >= contract.salary;
    }).map(manager => {
      const standing = result.standings.find(item => item.id === manager.id)!;
      const games = standing.seriesWins + standing.seriesLosses;
      return {teamId: manager.id, winPct: standing.seriesWins / Math.max(1, games), roundsSinceClaim: 16};
    });
    const winnerId = waiverWinner(claims);
    if (winnerId) {
      const winner = managers.find(manager => manager.id === winnerId)!;
      winner.contracts.push({...entry.contract, originalTeamId: entry.contract.originalTeamId ?? entry.formerManager.id});
      ledger.add({stage: "waiver", actor: winner.id, decision: `第${season}季接管被裁合同`, selected: contract.pokemon, context: {formerTeam: entry.formerManager.id, salary: contract.salary, yearsRemaining: contract.yearsRemaining, claimants: claims.map(claim => claim.teamId)}, alternatives: claims.filter(claim => claim.teamId !== winner.id).map(claim => ({option: claim.teamId})), rationale: ["认领方完整接手原工资和剩余年限", "原队不产生该合同死钱"]});
      continue;
    }
    const dead = releaseDeadMoney(contract);
    entry.formerManager.deadMoneyCurrent = (entry.formerManager.deadMoneyCurrent ?? 0) + dead.current;
    entry.formerManager.deadMoneyNext = (entry.formerManager.deadMoneyNext ?? 0) + dead.next;
    ledger.add({stage: "waiver", actor: entry.formerManager.id, decision: `第${season}季被裁合同无人认领`, selected: contract.pokemon, context: {salary: contract.salary, yearsRemaining: contract.yearsRemaining, deadMoney: dead}, alternatives: [], rationale: ["无人愿意完整接管合同", "原队承担保证部分，资产随后回到开放市场"]});
  }
}

function updateDynamicMarket(season: number, decisions: readonly DecisionRecord[]): void {
  const recent = managers.flatMap(manager => manager.seasons.find(entry => entry.season === season)?.roster ?? []);
  const byFamily = new Map<string, DynastyRosterMember[]>();
  for (const member of recent) byFamily.set(member.family, [...(byFamily.get(member.family) ?? []), member]);
  const bidSignals = new Map<string, number[]>();
  for (const record of decisions.filter(record => record.stage === "auction")) {
    const family = String((record.context as any).family ?? "");
    if (!family) continue;
    const bids = ((record.context as any).bids ?? []).map((bid: any) => Number(bid.bid)).filter((bid: number) => bid > 0);
    if (bids.length) bidSignals.set(family, [...(bidSignals.get(family) ?? []), ...bids]);
  }
  const replacement = median(recent.filter(member => member.scarcity === "standard" && (!dualLayer || member.economicClass !== "background")).map(member => member.market)) || 6;
  for (const [family, aggregate] of market) {
    const members = byFamily.get(family) ?? [];
    const previous = aggregate.currentValue ?? aggregate.totalPrice / Math.max(1, aggregate.acquisitions);
    const bids = bidSignals.get(family) ?? [];
    const demand = bids.length ? median(bids) : previous * .9;
    const appearances = members.reduce((sum, member) => sum + member.regularSeasonAppearances, 0);
    const kos = members.reduce((sum, member) => sum + member.regularSeasonKos, 0);
    const usage = Math.min(1, appearances / Math.max(1, regularRounds * members.length));
    const production = Math.min(1, kos / Math.max(1, appearances));
    const performance = replacement * (.8 + usage * .25 + production * .25);
    const raw = previous * .6 + demand * .25 + performance * .15;
    aggregate.currentValue = Math.max(2, Math.round(Math.max(previous * .75, Math.min(previous * 1.4, raw))));
    aggregate.lastSeason = season;
    market.set(family, aggregate);
    for (const manager of managers) for (const contract of manager.contracts.filter(contract => contract.family === family)) contract.marketValue = aggregate.currentValue;
  }
}

function settleClosedEconomy(season: number, result: SeasonResult, startingBudgets: Record<string, number>, seasonDir: string): void {
  const startCash = Object.values(startingBudgets).reduce((sum, value) => sum + value, 0);
  const endCashBefore = managers.reduce((sum, manager) => sum + manager.cash, 0);
  const payments = startCash - endCashBefore;
  if (!Number.isInteger(payments) || payments < 0) throw new Error(`Season ${season} created cash outside the closed economy`);
  leaguePool += payments;
  const poolBeforeDistribution = leaguePool;
  const distributedLiquidity = dualLayer ? 0 : distributeLiquidityMinimum();
  leaguePool -= distributedLiquidity;
  const equalCredits = Math.floor(leaguePool * .85);
  const balanceCredits = leaguePool - equalCredits;
  const distributedEqual = distributeCredits(managers, equalCredits);
  const bottomHalf = result.standings.slice(Math.floor(result.standings.length / 2)).map(standing => managers.find(manager => manager.id === standing.id)!).filter(Boolean);
  const distributedBalance = distributeCredits(bottomHalf, balanceCredits);
  leaguePool -= distributedEqual + distributedBalance;
  const totalAfter = leaguePool + managers.reduce((sum, manager) => sum + manager.cash, 0);
  if (totalAfter !== moneySupply) throw new Error(`Season ${season} violated money conservation: ${totalAfter} != ${moneySupply}`);
  writeJson(path.join(seasonDir, "economy.json"), {season, moneySupply, startCash, paymentsToLeaguePool: payments, poolBeforeDistribution, distributedLiquidity, distributedEqual, distributedBalance, leaguePool, teamCash: Object.fromEntries(managers.map(manager => [manager.id, manager.cash])), totalAfter, conserved: true});
}

function distributeLiquidityMinimum(): number {
  let distributed = 0;
  for (const manager of [...managers].sort((a, b) => a.id.localeCompare(b.id))) {
    const required = Math.max(0, minRoster - manager.contracts.length);
    while (manager.cash < required && leaguePool - distributed > 0 && manager.cash < 60) {
      manager.cash += 1;
      distributed += 1;
    }
  }
  if (managers.some(manager => manager.cash < Math.max(0, minRoster - manager.contracts.length))) throw new Error("The fixed money supply cannot fund every legal minimum roster");
  return distributed;
}

function distributeCredits(recipients: ManagerCareer[], requested: number): number {
  let remaining = requested, distributed = 0;
  const ordered = [...recipients].sort((a, b) => a.id.localeCompare(b.id));
  while (remaining > 0 && ordered.some(manager => manager.cash < 60)) {
    for (const manager of ordered) {
      if (remaining <= 0) break;
      if (manager.cash >= 60) continue;
      manager.cash += 1;
      remaining -= 1;
      distributed += 1;
    }
  }
  return distributed;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function runOffseasonContractMarket(season: number): void {
  const expiring = managers.flatMap(manager => manager.contracts.filter(contract => contract.status === "rfa" || contract.status === "ufa").map(contract => ({manager, contract})));
  for (const entry of expiring) {
    if (!entry.manager.contracts.includes(entry.contract)) continue;
    const contract = asSportsContract(entry.manager.id, entry.contract, season);
    const offers: ContractOffer[] = managers.filter(manager => manager !== entry.manager && manager.contracts.length < maxKeepers && !manager.contracts.some(item => item.family === contract.family)).map(manager => {
      const appetite = .82 + manager.currentProfile.traits.stars * .28 - manager.currentProfile.traits.value * .12;
      return {teamId: manager.id, salary: Math.max(2, Math.min(35, Math.round(contract.marketValue * appetite))), years: 1 + Math.round(manager.currentProfile.traits.synergy * 3), guaranteeRate: contract.assetClass === "standard" ? .2 : .35};
    }).filter(offer => payrollFor(offer.teamId) + offer.salary <= 120 && managers.find(manager => manager.id === offer.teamId)!.cash >= marketSigningCost(offer.salary));
    const best = chooseRfaOffer(offers);
    const motherCanMatch = best && contract.status === "rfa" && payrollFor(entry.manager.id, entry.contract) + best.salary <= 120 && entry.manager.cash >= marketSigningCost(best.salary);
    const motherWantsMatch = motherCanMatch && best.salary <= contract.marketValue * (1 + entry.manager.currentProfile.traits.synergy * .25);
    if (best && motherWantsMatch) {
      const signingCost = marketSigningCost(best.salary);
      entry.manager.cash -= signingCost;
      replaceContract(entry.manager, entry.contract, matchingContract(contract, best, entry.manager.id));
      ledger.add({stage: "waiver", actor: entry.manager.id, decision: `第${season}季RFA匹配`, selected: contract.pokemon, context: {offer: best, marketValue: contract.marketValue, signingCost}, alternatives: [{option: best.teamId}], rationale: ["外部报价完成价格发现", "母队在完整工资硬线内匹配", "签约取得费进入联盟池"]});
      continue;
    }
    if (best) {
      const destination = managers.find(manager => manager.id === best.teamId)!;
      const signingCost = marketSigningCost(best.salary);
      destination.cash -= signingCost;
      entry.manager.contracts.splice(entry.manager.contracts.indexOf(entry.contract), 1);
      const signed = matchingContract(contract, best, destination.id);
      destination.contracts.push({...entry.contract, ...signed, years: signed.serviceYears + 1});
      ledger.add({stage: "waiver", actor: destination.id, decision: `第${season}季${contract.status.toUpperCase()}签约`, selected: contract.pokemon, context: {formerTeam: entry.manager.id, offer: best, marketValue: contract.marketValue, signingCost}, alternatives: offers.filter(offer => offer !== best).slice(0, 4).map(offer => ({option: offer.teamId, cost: offer.salary})), rationale: ["公开报价现值最高", contract.status === "rfa" ? "母队放弃匹配" : "资产已进入完全自由市场", "签约取得费进入联盟池"]});
      continue;
    }
    const tag = taggedContract(contract, topComparableSalary(contract.family));
    if (tag && payrollFor(entry.manager.id, entry.contract) + tag.salary <= 120) {
      replaceContract(entry.manager, entry.contract, tag);
      ledger.add({stage: "waiver", actor: entry.manager.id, decision: `第${season}季唯一资产标签`, selected: contract.pokemon, context: {salary: tag.salary, tagCount: tag.tagCount}, alternatives: [{option: "进入UFA"}], rationale: ["每队仅可对唯一资产使用", "连续标签显著涨价且最多两次"]});
    } else entry.manager.contracts.splice(entry.manager.contracts.indexOf(entry.contract), 1);
  }
}

function marketSigningCost(salary: number): number { return Math.max(1, Math.round(salary * .25)); }

function payrollFor(managerId: string, excluding?: KeeperContract): number {
  const manager = managers.find(candidate => candidate.id === managerId)!;
  return (manager.deadMoneyCurrent ?? 0) + manager.contracts.filter(contract => contract !== excluding).reduce((sum, contract) => sum + contract.salary, 0);
}

function replaceContract(manager: ManagerCareer, previous: KeeperContract, next: SportsContract): void {
  manager.contracts[manager.contracts.indexOf(previous)] = {...previous, ...next, years: next.serviceYears + 1};
}

function asSportsContract(teamId: string, contract: KeeperContract, season: number): SportsContract {
  return {
    assetId: contract.assetId ?? contract.family, family: contract.family, pokemon: contract.pokemon, salary: contract.salary,
    yearsRemaining: contract.yearsRemaining ?? 1, serviceYears: contract.serviceYears ?? contract.years,
    guaranteeRate: contract.guaranteeRate ?? .2, status: contract.status ?? "controlled", originalTeamId: contract.originalTeamId ?? teamId,
    acquiredSeason: contract.acquiredSeason ?? season, acquisitionCost: contract.acquisitionCost ?? contract.salary,
    marketValue: contract.marketValue ?? contract.salary, assetClass: contract.assetClass ?? "standard", tagCount: contract.tagCount ?? 0,
  };
}

function topComparableSalary(family: string): number {
  const salaries = managers.flatMap(manager => manager.contracts.filter(contract => contract.family !== family).map(contract => contract.salary)).sort((a, b) => b - a).slice(0, 5);
  return Math.max(2, Math.round(salaries.reduce((sum, salary) => sum + salary, 0) / Math.max(1, salaries.length)));
}

function chooseHardApronReleases(season: number): Array<{formerManager: ManagerCareer; contract: KeeperContract}> {
  const queue: Array<{formerManager: ManagerCareer; contract: KeeperContract}> = [];
  for (const manager of managers) {
    while (payrollFor(manager.id) > 120 && manager.contracts.length) {
      const ranked = manager.contracts.map(contract => ({contract, score: complianceRetentionValue(manager, contract)})).sort((a, b) => a.score - b.score || b.contract.salary - a.contract.salary);
      const released = ranked[0]?.contract ?? [...manager.contracts].sort((a, b) => b.salary - a.salary)[0];
      manager.contracts.splice(manager.contracts.indexOf(released), 1);
      queue.push({formerManager: manager, contract: released});
      ledger.add({stage: "waiver", actor: manager.id, decision: `第${season}季经理选择硬线合规方案`, selected: released.pokemon, context: {salary: released.salary, payrollPendingWaiver: payrollFor(manager.id), retentionScore: ranked[0]?.score, traits: manager.currentProfile.traits}, alternatives: ranked.slice(1, 4).map(entry => ({option: entry.contract.pokemon, cost: entry.contract.salary, score: entry.score})), rationale: ["完整工资与当季死钱超过硬线120", "经理按明星偏好、工资价值、连续性和合同控制期自主比较牺牲对象", "合同先进入全联盟waiver；无人接手才产生死钱"]});
    }
  }
  return queue;
}

function complianceRetentionValue(manager: ManagerCareer, contract: KeeperContract): number {
  const marketValue = contract.marketValue ?? contract.salary;
  const years = contract.yearsRemaining ?? 1;
  const service = contract.serviceYears ?? contract.years;
  const scarcity = contract.assetClass === "legendary" || contract.assetClass === "unique-custom" ? 1 : 0;
  const competitive = marketValue * (.65 + manager.currentProfile.traits.stars * .55);
  const efficiency = Math.max(0, marketValue - contract.salary) * (.5 + manager.currentProfile.traits.value);
  const continuity = Math.min(4, service) * manager.currentProfile.traits.synergy * 2;
  const control = years * (1 + manager.currentProfile.traits.value * 1.5);
  const uniqueOption = scarcity * (2 + manager.currentProfile.traits.risk * 2);
  const deadMoneyRisk = contract.salary * (contract.guaranteeRate ?? .2) * (.4 + manager.currentProfile.traits.value * .3);
  return competitive + efficiency + continuity + control + uniqueOption - deadMoneyRisk;
}

function syncAssetLedger(season: number, seasonDir: string): void {
  const pool = readJson<Array<{assetId: string; family: string; name: string; scarcity: AssetLedgerEntry["scarcity"]; supplyCap: number; economicClass?: "background" | "limited" | "unique"}>>(path.join(seasonDir, "season-pool.json"));
  for (const asset of pool) {
    if (dualLayer && asset.economicClass === "background") continue;
    const previous = assets.get(asset.assetId);
    assets.set(asset.assetId, {...asset, economicClass: asset.economicClass === "background" ? undefined : asset.economicClass, pokemon: asset.name, ownerId: null, status: asset.scarcity === "standard" ? "available" : "locked", firstSeason: previous?.firstSeason ?? season, lastSeason: season});
  }
  for (const career of managers) {
    const roster = career.seasons.find(entry => entry.season === season)?.roster ?? [];
    for (const member of roster) {
      if (!member.assetId) continue;
      const previous = assets.get(member.assetId);
      if (!previous) continue;
      assets.set(member.assetId, {...previous, ownerId: career.id, status: "owned", lastSeason: season});
    }
  }
  for (const career of managers) for (const contract of career.contracts) {
    if (!contract.assetId) continue;
    const previous = assets.get(contract.assetId);
    if (!previous) throw new Error(`Contract ${contract.assetId} has no asset ledger entry`);
    assets.set(contract.assetId, {...previous, ownerId: career.id, status: "owned", lastSeason: season});
  }
}

function marketSnapshot(): Record<string, {averagePrice: number; appearances: number; kos: number}> {
  return Object.fromEntries([...market.entries()].map(([family, aggregate]) => [family, {
    averagePrice: stateVersion >= 10 ? aggregate.currentValue ?? aggregate.totalPrice / Math.max(1, aggregate.acquisitions) : aggregate.totalPrice / Math.max(1, aggregate.acquisitions),
    appearances: aggregate.appearances,
    kos: aggregate.kos,
  }]));
}

function recordReviewDecision(season: number, career: ManagerCareer, review: SeasonReview, champion: boolean): void {
  const strongest = [...review.signals].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  ledger.add({stage: "review", actor: career.id, decision: `第${season}季复盘并调整策略后验`, selected: review.emergentStyle.label, context: {season, champion, performance: review.performance, before: review.before, after: review.after, development: review.developmentAfter, signals: review.signals}, alternatives: [{option: "完全不学习"}, {option: "把重复对局全部视为独立样本"}], rationale: strongest ? [strongest.reason, "每季每条策略最多增加一个有效样本", `当前探索率${review.developmentAfter.exploration.toFixed(3)}`, "风格标签只描述后验，不控制行为"] : ["本季证据不足以改变模型"]});
  for (const keeper of review.keepers) ledger.add({stage: "waiver", actor: career.id, decision: `为第${season + 1}季保留成员`, selected: keeper.pokemon, context: {family: keeper.family, salary: keeper.salary, years: keeper.years, appearances: keeper.lastSeasonAppearances, kos: keeper.lastSeasonKos}, alternatives: review.released.slice(0, 3).map(member => ({option: member.pokemon})), rationale: [`上季出场${keeper.lastSeasonAppearances}次、击倒${keeper.lastSeasonKos}次`, `续约薪资${keeper.salary}`, "保留名单最多三人且承诺资金不超过70"]});
}

function preseasonThesis(season: number): string {
  const lines = [`# 王朝联赛第 ${season} 季：季前计划`, "", `候选池至少 ${poolSize} 个进化家族；每队基础预算 100；公开竞拍 ${auctionLots} 个标的；常规赛 ${regularRounds} 轮；每组 ${pairs} 个双向样本。`, ""];
  for (const manager of managers) {
    const changes = traitChanges(manager.baseProfile.traits, manager.currentProfile.traits);
    lines.push(`## ${manager.name}`, "", `- 保留成员：${manager.contracts.length ? manager.contracts.map(contract => `${contract.pokemon}(${contract.salary})`).join("、") : "无"}`, `- 当前倾向：${dominantTraits(manager.currentProfile.traits)}`, `- 已建对手档案：${Object.keys(manager.currentProfile.matchupMemory ?? {}).length}`, `- 生涯修正：${changes.length ? changes.join("；") : "首季，尚无历史修正"}`, "");
  }
  return `${lines.join("\n")}\n`;
}

function seasonReviewMarkdown(season: number, result: SeasonResult): string {
  const lines = [`# 王朝联赛第 ${season} 季复盘`, "", `冠军：**${result.champion.name}**`, "", "## 积分榜", "", "| 排名 | 赛区 | 经理 | 积分 | 系列赛 | 击倒 | 剩余资金 |", "|---:|---|---|---:|---:|---:|---:|"];
  result.standings.forEach((standing, index) => lines.push(`| ${index + 1} | ${standing.division ?? "-"} | ${standing.name} | ${standing.points} | ${standing.seriesWins}-${standing.seriesLosses} | ${standing.kos} | ${standing.budget ?? 0} |`));
  lines.push("", "## 学习与续约", "");
  for (const career of managers) {
    const seasonEntry = career.seasons[career.seasons.length - 1];
    const changed = [...seasonEntry.review.signals].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 2);
    const rosterByAsset = new Map(seasonEntry.roster.map(member => [member.assetId ?? member.family, member]));
    const rosterByFamily = new Map(seasonEntry.roster.map(member => [member.family, member]));
    lines.push(`### ${career.name}`, "", `- 主要修正：${changed.map(signal => `${traitName(signal.trait)}${signed(signal.delta)}（${signal.reason}）`).join("；")}`, `- 保留：${seasonEntry.review.keepers.length ? seasonEntry.review.keepers.map(keeper => `${assetLabel(rosterByAsset.get(keeper.assetId ?? "") ?? rosterByFamily.get(keeper.family), keeper.pokemon)}，下季薪资${keeper.salary}`).join("；") : "无"}`, `- 释放：${seasonEntry.review.released.map(member => assetLabel(rosterByFamily.get(member.family), member.pokemon)).join("、") || "无"}`, "");
  }
  appendCustomPerformance(lines, season);
  return `${lines.join("\n")}\n`;
}

function appendCustomPerformance(lines: string[], season: number): void {
  const seasonDir = path.join(outDir, `season-${String(season).padStart(2, "0")}`);
  const pool = readJson<Array<{assetId: string; name: string; scarcity: string; market: number}>>(path.join(seasonDir, "season-pool.json"));
  const customPool = pool.filter(candidate => candidate.scarcity === "unique-custom");
  const owned = managers.flatMap(manager => {
    const entry = manager.seasons.find(candidate => candidate.season === season);
    return (entry?.roster ?? []).filter(member => member.scarcity === "unique-custom").map(member => ({manager: manager.name, member}));
  });
  const ownedIds = new Set(owned.map(entry => entry.member.assetId));
  lines.push("", "## 魔改宝可梦表现", "", "| 魔改宝可梦 | 经理 | 获得方式 | 价格 | 出场 | 击倒 | 常规赛出场 | 常规赛击倒 |", "|---|---|---|---:|---:|---:|---:|---:|");
  for (const {manager, member} of owned.sort((a, b) => b.member.kos - a.member.kos)) {
    lines.push(`| ${assetLabel(member, member.pokemon)} | ${manager} | ${member.method === "auction" ? "竞拍" : member.method === "keeper" ? "续约" : member.method === "free-agent" ? "自由签约" : "补强"} | ${member.price} | ${member.appearances} | ${member.kos} | ${member.regularSeasonAppearances} | ${member.regularSeasonKos} |`);
  }
  if (!owned.length) lines.push("| 无 | - | - | - | - | - | - | - |");
  const unowned = customPool.filter(candidate => !ownedIds.has(candidate.assetId));
  lines.push("", `未成交魔改（${unowned.length}）：${unowned.map(candidate => `[魔改] ${candidate.name}`).join("、") || "无"}。`);
}

function assetLabel(member: Pick<DynastyRosterMember, "scarcity"> | undefined, pokemon: string): string {
  const label = member?.scarcity === "unique-custom" ? "魔改"
    : member?.scarcity === "legendary" ? "神兽"
      : member?.scarcity === "elite-ordinary" ? "顶级普通"
        : "标准";
  return `[${label}] ${pokemon}`;
}

function checkpoint(completedSeason: number): void {
  const snapshot: DynastyState = {version: stateVersion, seed, completedSeason, settings: currentSettings(), managers, market: Object.fromEntries(market), assets: Object.fromEntries(assets), fingerprint: runtimeFingerprint, registry: registryState(), decisionRecords: [...ledger.all()], evolutionArchive, leaguePool, moneySupply};
  validateDynastyState(snapshot);
  writeJson(path.join(outDir, "dynasty-state.json"), snapshot);
  writeEvolutionSummary(completedSeason);
  ledger.write(path.join(outDir, "career-decisions"));
}

function writeEvolutionSummary(completedSeason: number): void {
  writeJson(path.join(outDir, "evolution-summary.json"), {
    schemaVersion: 1,
    completedSeason,
    managers: managers.map(manager => {
      const style = classifyEmergentStyle(manager.currentProfile);
      return {
        id: manager.id,
        seasons: manager.currentProfile.development.seasons,
        style,
        traits: manager.currentProfile.traits,
        exploration: manager.currentProfile.development.exploration,
        effectiveSamples: Object.fromEntries(Object.entries(manager.currentProfile.development.strategies).map(([trait, posterior]) => [trait, posterior.effectiveSamples])),
        titles: manager.titles,
        totalPoints: manager.totalPoints,
        lineage: manager.lineage,
        lineageDepth: manager.lineageHistory.length,
        pendingLineage: manager.pendingLineage ?? null,
        strategyProgram: {hash: strategyProgramHash(manager.currentProfile.strategyProgram!), nodes: countProgramNodes(manager.currentProfile.strategyProgram!)},
      };
    }),
  });
}

function writeDynastyOutputs(): void {
  checkpoint(seasonCount);
  fs.writeFileSync(path.join(outDir, "season-index.md"), seasonIndexMarkdown(), "utf8");
  fs.writeFileSync(path.join(outDir, "learning-report.md"), learningReportMarkdown(), "utf8");
  fs.writeFileSync(path.join(outDir, "health-report.md"), healthReportMarkdown(), "utf8");
  for (const career of managers) {
    const careerDir = path.join(outDir, "careers");
    fs.mkdirSync(careerDir, {recursive: true});
    fs.writeFileSync(path.join(careerDir, `${career.id}.md`), careerMarkdown(career), "utf8");
  }
}

function writeFinancialHealth(seasonDir: string): void {
  const teams = managers.map(manager => {
    const payroll = manager.contracts.reduce((sum, contract) => sum + contract.salary, 0) + (manager.deadMoneyCurrent ?? 0);
    return {managerId: manager.id, contracts: manager.contracts.length, cash: manager.cash, deadMoneyCurrent: manager.deadMoneyCurrent ?? 0, deadMoneyNext: manager.deadMoneyNext ?? 0, payroll, legal: payroll <= 120};
  });
  writeJson(path.join(seasonDir, "financial-health.json"), {
    rules: {hardApron: 120},
    teams,
    league: {
      averagePayroll: teams.reduce((sum, team) => sum + team.payroll, 0) / Math.max(1, teams.length),
      apronViolations: teams.filter(team => !team.legal).length,
      leaguePool,
      moneySupply,
    },
  });
}

function healthReportMarkdown(): string {
  const snapshots: LeagueHealthSnapshot[] = [];
  for (let season = 1; season <= seasonCount; season += 1) {
    const file = path.join(outDir, `season-${String(season).padStart(2, "0")}`, "health.json");
    if (fs.existsSync(file)) snapshots.push(readJson<LeagueHealthSnapshot>(file));
  }
  const lines = ["# 联盟健康报告", "", "| 赛季 | 季中交易 | 有流动性球队 | 拍卖同价率 | 后段/前段价格 | 闲置名单 | 行为物种 | 警报 |", "|---:|---:|---:|---:|---:|---:|---:|---|"];
  for (const item of snapshots) lines.push(`| ${item.season} | ${item.transactions} | ${item.teamsWithMidseasonLiquidity} | ${(item.auctionTieRate * 100).toFixed(1)}% | ${item.lateToEarlyPriceRatio.toFixed(2)} | ${(item.unusedRosterRate * 100).toFixed(1)}% | ${item.behaviorSpecies} | ${item.warnings.join("、") || "正常"} |`);
  return `${lines.join("\n")}\n`;
}

function seasonIndexMarkdown(): string {
  const lines = ["# V4 王朝联赛赛季索引", "", `共完成 ${seasonCount} 个赛季。`, "", "| 赛季 | 冠军 | 常规赛第一 |", "|---:|---|---|"];
  for (let season = 1; season <= seasonCount; season += 1) {
    const result = readJson<SeasonResult>(path.join(outDir, `season-${String(season).padStart(2, "0")}`, "season.json"));
    lines.push(`| ${season} | ${result.champion.name} | ${result.standings[0].name} |`);
  }
  lines.push("", "## 生涯排名", "", "| 排名 | 经理 | 冠军 | 累计积分 | 最终主要倾向 |", "|---:|---|---:|---:|---|");
  [...managers].sort((a, b) => b.titles - a.titles || b.totalPoints - a.totalPoints).forEach((manager, index) => lines.push(`| ${index + 1} | ${manager.name} | ${manager.titles} | ${manager.totalPoints} | ${classifyEmergentStyle(manager.currentProfile).label} |`));
  return `${lines.join("\n")}\n`;
}

function learningReportMarkdown(): string {
  const lines = ["# V4 经理发展报告", "", "所有经理从相同的中性新手开始；风格名称仅由长期决策后验生成，不参与行为控制。", ""];
  for (const manager of managers) {
    const style = classifyEmergentStyle(manager.currentProfile);
    lines.push(`## ${manager.name}`, "", `- 生涯：${manager.titles} 冠，累计 ${manager.totalPoints} 分`, `- 当前风格：${style.label}（置信度${(style.confidence * 100).toFixed(1)}%）`, `- 探索率：${manager.currentProfile.development.exploration.toFixed(3)}`, `- 倾向变化：${traitChanges(manager.baseProfile.traits, manager.currentProfile.traits).join("；") || "尚未分化"}`);
    const lessons = manager.seasons.flatMap(season => season.review.signals.map(signal => ({season: season.season, ...signal}))).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3);
    for (const lesson of lessons) lines.push(`- 第${lesson.season}季：${traitName(lesson.trait)}${signed(lesson.delta)}，${lesson.reason}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function careerMarkdown(career: ManagerCareer): string {
  const lines = [`# ${career.name}：经理生涯`, "", `冠军 ${career.titles} 次，累计 ${career.totalPoints} 分。`, "", "| 赛季 | 排名 | 积分 | 冠军 | 保留到下季 |", "|---:|---:|---:|---|---|"];
  for (const season of career.seasons) {
    const byAsset = new Map(season.roster.map(member => [member.assetId ?? member.family, member]));
    lines.push(`| ${season.season} | ${season.rank} | ${season.points} | ${season.champion ? "是" : "否"} | ${season.review.keepers.map(keeper => assetLabel(byAsset.get(keeper.assetId ?? keeper.family), keeper.pokemon)).join("、") || "无"} |`);
  }
  lines.push("", "## 人格轨迹", "", `初始：${formatTraits(career.baseProfile.traits)}`, "", `当前：${formatTraits(career.currentProfile.traits)}`, "", "## 赛季教训", "");
  for (const season of career.seasons) {
    const signal = [...season.review.signals].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    lines.push(`- 第${season.season}季：${signal ? `${traitName(signal.trait)}${signed(signal.delta)}，${signal.reason}` : "维持原模型"}`);
  }
  return `${lines.join("\n")}\n`;
}

function dominantTraits(traits: ManagerTraits): string {
  return (Object.entries(traits) as Array<[keyof ManagerTraits, number]>).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([trait, value]) => `${traitName(trait)}${value.toFixed(2)}`).join("、");
}

function traitChanges(base: ManagerTraits, current: ManagerTraits): string[] {
  return (Object.keys(base) as Array<keyof ManagerTraits>).map(trait => ({trait, delta: current[trait] - base[trait]})).filter(entry => Math.abs(entry.delta) >= .005).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).map(entry => `${traitName(entry.trait)}${signed(entry.delta)}`);
}

function formatTraits(traits: ManagerTraits): string {
  return (Object.entries(traits) as Array<[keyof ManagerTraits, number]>).map(([trait, value]) => `${traitName(trait)} ${value.toFixed(3)}`).join("；");
}

function traitName(trait: keyof ManagerTraits): string {
  return ({risk: "冒险", stars: "明星", synergy: "协同", counter: "针对", value: "价值", flexibility: "灵活"} as const)[trait];
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}

function currentSettings(): DynastyState["settings"] {
  return {seasonCount, managerLimit, pairs, poolSize, auctionLots, maxTurns, regularRounds, baseBudget, keeperCap, auctionMode, minRoster, maxRoster, midseasonGrant, contractModel, dynamicPool, learningModel, carryRate, carryCap, maxKeepers, separatePayroll, dualLayer, programEvolution};
}

function settingsMatch(saved: DynastyState["settings"]): boolean {
  const current = currentSettings();
  return saved.managerLimit === current.managerLimit
    && saved.pairs === current.pairs
    && saved.poolSize === current.poolSize
    && saved.auctionLots === current.auctionLots
    && saved.maxTurns === current.maxTurns
    && saved.regularRounds === current.regularRounds
    && (saved.baseBudget ?? 100) === current.baseBudget
    && (saved.keeperCap ?? 70) === current.keeperCap
    && (saved.auctionMode ?? "sequential") === current.auctionMode
    && (saved.minRoster ?? 8) === current.minRoster
    && (saved.maxRoster ?? 8) === current.maxRoster
    && (saved.midseasonGrant ?? 0) === current.midseasonGrant
    && (saved.contractModel ?? "compound") === current.contractModel
    && (saved.dynamicPool ?? false) === current.dynamicPool
    && (saved.learningModel ?? "observational") === current.learningModel
    && (saved.carryRate ?? .5) === current.carryRate
    && (saved.carryCap ?? 20) === current.carryCap
    && (saved.maxKeepers ?? 3) === current.maxKeepers
    && (saved.dualLayer ?? false) === current.dualLayer
    && (saved.programEvolution ?? false) === current.programEvolution
    && (saved.separatePayroll ?? false) === current.separatePayroll;
}

function integerSetting(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer in ${min}..${max}`);
  return value;
}

function numberSetting(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be in ${min}..${max}`);
  return value;
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  atomicWriteFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function atomicWriteFile(file: string, contents: string): void {
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, contents, "utf8");
  fs.renameSync(temporary, file);
}

function computeRuntimeFingerprint(): RuntimeFingerprint {
  const showdownPackage = readJson<{version?: string}>(require.resolve("pokemon-showdown/package.json"));
  const sourceFiles = listFiles(path.join(root, "src"), file => file.endsWith(".ts"));
  const benchmarkHash = hashFiles(listFiles(path.join(root, "benchmarks", "gen9expanded"), () => true));
  return {
    codeHash: hashFiles(stateVersion >= 12 ? sourceFiles.filter(file => !file.includes(`${path.sep}tests${path.sep}`)) : sourceFiles),
    dataHash: crypto.createHash("sha256").update(registrySnapshot.hash).update("\0").update(benchmarkHash).digest("hex"),
    registryHash: registrySnapshot.hash,
    benchmarkHash,
    dependencyHash: hashFiles([path.join(root, "package-lock.json")]),
    pokemonShowdownVersion: showdownPackage.version ?? "unknown",
  };
}

function computeLegacyDataHash(): string {
  return hashFiles([
    ...listFiles(path.join(root, "data", "draft"), file => file.endsWith(".json")),
    ...listFiles(path.join(root, "benchmarks", "gen9expanded"), () => true),
  ]);
}

function prepareRegistrySnapshot(): RegistrySnapshot {
  const statePath = path.join(outDir, "dynasty-state.json");
  if (resume && !adoptRegistry && fs.existsSync(statePath)) {
    const prior = readJson<Partial<DynastyState>>(statePath);
    if (prior.registry?.snapshot) return loadRegistrySnapshot(path.resolve(outDir, prior.registry.snapshot));
  }
  return createRegistrySnapshot(registrySource, path.join(outDir, "config-snapshots"), process.env.V4_REGISTRY_REVISION);
}

function registryState(): NonNullable<DynastyState["registry"]> {
  return {schemaVersion: 1, revision: registrySnapshot.revision, hash: registrySnapshot.hash, namespace: registrySnapshot.namespace, snapshot: path.relative(outDir, registrySnapshot.directory)};
}

function archiveBattleLogs(seasonDir: string): void {
  const battleRoot = path.join(seasonDir, "battles");
  if (!fs.existsSync(battleRoot)) return;
  let files = 0, sourceBytes = 0, compressedBytes = 0;
  for (const file of listFiles(battleRoot, candidate => candidate.endsWith("raw.log") || candidate.endsWith("public.log"))) {
    const source = fs.readFileSync(file), compressed = zlib.gzipSync(source, {level: 6}), target = `${file}.gz`;
    fs.writeFileSync(target, compressed);
    fs.rmSync(file, {force: true});
    files += 1; sourceBytes += source.length; compressedBytes += compressed.length;
  }
  writeJson(path.join(seasonDir, "battle-archive.json"), {schemaVersion: 1, files, sourceBytes, compressedBytes, ratio: sourceBytes ? compressedBytes / sourceBytes : 0});
}

function listFiles(directory: string, include: (file: string) => boolean): string[] {
  if (!fs.existsSync(directory)) throw new Error(`Fingerprint directory is missing: ${directory}`);
  const result: string[] = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(target, include));
    else if (entry.isFile() && include(target)) result.push(target);
  }
  return result.sort();
}

function hashFiles(files: string[]): string {
  const hash = crypto.createHash("sha256");
  for (const file of [...files].sort()) {
    hash.update(path.relative(root, file).replace(/\\/g, "/"));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function validateDynastyState(state: DynastyState): void {
  if (!Number.isInteger(state.completedSeason) || state.completedSeason < 0) throw new Error("Saved dynasty has an invalid completed season");
  if (!Array.isArray(state.managers) || state.managers.length !== managerLimit) throw new Error("Saved dynasty has an invalid manager count");
  const expectedIds = initialProfiles.map(profile => profile.id);
  if (state.managers.some((manager, index) => manager.id !== expectedIds[index])) throw new Error("Saved dynasty manager identities do not match the current league");
  const retainedAssets = new Map<string, string>();
  for (const manager of state.managers) {
    for (const profile of [manager.baseProfile, manager.currentProfile]) validateProfileState(profile);
    if (!manager.lineage || !manager.lineage.lineageId || !Number.isInteger(manager.lineage.generation) || manager.lineage.generation < 0) throw new Error(`Saved dynasty has invalid lineage for ${manager.id}`);
    if (!Array.isArray(manager.lineageHistory) || !manager.lineageHistory.length || manager.lineageHistory.at(-1)?.lineageId !== manager.lineage.lineageId) throw new Error(`Saved dynasty has invalid lineage history for ${manager.id}`);
    if (Boolean(manager.pendingProfile) !== Boolean(manager.pendingLineage)) throw new Error(`Saved dynasty has an incomplete pending generation for ${manager.id}`);
    if (manager.pendingProfile) validateProfileState(manager.pendingProfile);
    if (!Number.isInteger(manager.cash) || manager.cash < 0 || manager.cash > (stateVersion >= 10 ? 60 : 200)) throw new Error(`Saved dynasty has invalid cash for ${manager.id}`);
    if (!Array.isArray(manager.contracts) || manager.contracts.length > maxKeepers) throw new Error(`Saved dynasty has too many contracts for ${manager.id}`);
    const salary = manager.contracts.reduce((sum, contract) => sum + contract.salary, 0);
    if (!Number.isInteger(salary) || salary > keeperCap) throw new Error(`Saved dynasty exceeds the keeper budget for ${manager.id}`);
    for (const contract of manager.contracts) {
      if (!contract.family || !Number.isInteger(contract.salary) || contract.salary < 1 || !Number.isInteger(contract.years) || contract.years < 1) throw new Error(`Saved dynasty has an invalid contract for ${manager.id}`);
      if (!contract.assetId) throw new Error(`Saved dynasty contract has no asset id for ${contract.family}`);
      if (retainedAssets.has(contract.assetId)) throw new Error(`Saved dynasty retains asset ${contract.assetId} for multiple managers`);
      retainedAssets.set(contract.assetId, manager.id);
    }
  }
  for (const [family, aggregate] of Object.entries(state.market)) if (!family || [aggregate.totalPrice, aggregate.acquisitions, aggregate.appearances, aggregate.kos].some(value => !Number.isFinite(value) || value < 0)) throw new Error(`Saved dynasty has invalid market data for ${family}`);
  if (!state.assets || typeof state.assets !== "object") throw new Error("Saved dynasty has no asset ledger");
  const seenAssets = new Set<string>();
  for (const [assetId, asset] of Object.entries(state.assets)) {
    if (asset.assetId !== assetId || seenAssets.has(assetId) || asset.supplyCap < 1 || asset.supplyCap > 3) throw new Error(`Saved dynasty has invalid asset ${assetId}`);
    seenAssets.add(assetId);
  }
  for (const [assetId, managerId] of retainedAssets) if (state.assets[assetId]?.ownerId !== managerId) throw new Error(`Saved dynasty contract owner ${managerId} disagrees with asset ledger for ${assetId}`);
  if (!Array.isArray(state.decisionRecords)) throw new Error("Saved dynasty has no decision ledger snapshot");
  if (stateVersion >= 10) {
    if (!Number.isInteger(state.leaguePool) || (state.leaguePool ?? -1) < 0 || !Number.isInteger(state.moneySupply) || (state.moneySupply ?? 0) <= 0) throw new Error("Saved V10 dynasty has invalid closed-economy state");
    const conserved = (state.leaguePool ?? 0) + state.managers.reduce((sum, manager) => sum + manager.cash, 0);
    if (conserved !== state.moneySupply) throw new Error(`Saved V10 dynasty violates money conservation: ${conserved} != ${state.moneySupply}`);
  }
  if (state.evolutionArchive && (!Array.isArray(state.evolutionArchive) || state.evolutionArchive.length > 300)) throw new Error("Saved dynasty has an invalid evolution archive");
  state.decisionRecords.forEach((record, index) => {
    const sequence = index + 1;
    if (record.sequence !== sequence || record.id !== `decision-${String(sequence).padStart(5, "0")}`) throw new Error("Saved dynasty has a non-contiguous decision ledger");
  });
}

function validateProfileState(profile: ManagerProfile): void {
  for (const [trait, value] of Object.entries(profile.traits)) if (!Number.isFinite(value) || value < .05 || value > 1.2) throw new Error(`Saved dynasty has invalid ${profile.id} trait ${trait}`);
  if (!profile.development || !Number.isInteger(profile.development.seasons) || profile.development.seasons < 0) throw new Error(`Saved dynasty has invalid development state for ${profile.id}`);
  if (!Number.isFinite(profile.development.exploration) || profile.development.exploration < 0 || profile.development.exploration > 1) throw new Error(`Saved dynasty has invalid exploration for ${profile.id}`);
  for (const posterior of Object.values(profile.development.strategies)) if (![posterior.mean, posterior.confidence, posterior.effectiveSamples].every(Number.isFinite) || posterior.mean < 0 || posterior.mean > 1 || posterior.confidence < 0 || posterior.confidence > 1 || posterior.effectiveSamples < 0) throw new Error(`Saved dynasty has invalid strategy posterior for ${profile.id}`);
  const genome = profile.genome;
  if (stateVersion >= 12) {
    if (!profile.strategyProgram) throw new Error(`Saved V12 dynasty has no strategy program for ${profile.id}`);
    validateStrategyProgram(profile.strategyProgram);
  }
  if (genome) {
    for (const value of Object.values(genome.economics ?? {})) if (!Number.isFinite(value) || value! < -.35 || value! > .35) throw new Error(`Saved dynasty has invalid economics genome for ${profile.id}`);
    for (const value of Object.values(genome.tactics ?? {})) if (!Number.isFinite(value) || value! < -.5 || value! > .5) throw new Error(`Saved dynasty has invalid tactics genome for ${profile.id}`);
    for (const value of Object.values(genome.roles ?? {})) if (!Number.isFinite(value) || value! < -.6 || value! > .8) throw new Error(`Saved dynasty has invalid role genome for ${profile.id}`);
    for (const value of Object.values(genome.configuration ?? {})) if (!Number.isFinite(value) || value! < -.7 || value! > .7) throw new Error(`Saved dynasty has invalid configuration genome for ${profile.id}`);
    for (const value of Object.values(genome.systems ?? {})) if (!Number.isFinite(value) || value! < -.7 || value! > .8) throw new Error(`Saved dynasty has invalid systems genome for ${profile.id}`);
    for (const value of Object.values(genome.organization ?? {})) if (!Number.isFinite(value) || value! < -.6 || value! > .7) throw new Error(`Saved dynasty has invalid organization genome for ${profile.id}`);
    if (genome.learning.rate !== undefined && (!Number.isFinite(genome.learning.rate) || genome.learning.rate < .05 || genome.learning.rate > .8)) throw new Error(`Saved dynasty has invalid learning-rate genome for ${profile.id}`);
    if (genome.learning.memoryDecay !== undefined && (!Number.isFinite(genome.learning.memoryDecay) || genome.learning.memoryDecay < .5 || genome.learning.memoryDecay > .99)) throw new Error(`Saved dynasty has invalid memory genome for ${profile.id}`);
    if (genome.learning.exploration !== undefined && (!Number.isFinite(genome.learning.exploration) || genome.learning.exploration < -.25 || genome.learning.exploration > .25)) throw new Error(`Saved dynasty has invalid exploration genome for ${profile.id}`);
  }
  for (const [opponent, memory] of Object.entries(profile.matchupMemory ?? {})) {
    if (!Number.isInteger(memory.series) || memory.series < 0 || !Number.isInteger(memory.wins) || memory.wins < 0 || !Number.isInteger(memory.losses) || memory.losses < 0) throw new Error(`Saved dynasty has invalid matchup totals for ${profile.id} vs ${opponent}`);
    for (const score of Object.values(memory.familyScores)) if (!Number.isFinite(score) || score < -3 || score > 3) throw new Error(`Saved dynasty has invalid matchup scores for ${profile.id} vs ${opponent}`);
  }
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }

main();
