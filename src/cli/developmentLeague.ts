import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {spawnSync} from "node:child_process";
import type {CareerMemoryCheckpoint} from "../draft/careerArchive";
import {cloneManagerProfile, classifyEmergentStyle, type ManagerProfile} from "../draft/managerProfiles";
import {createManagerOffspring, type EvolutionCompetitor, type LineageIdentity, type ObservedBehavior} from "../draft/naturalEvolution";
import {strategyProgramHash} from "../draft/strategyProgram";
import {areLineagesRelated, founderCapacity} from "../draft/lineageDiversity";
import {personalitySimilarity} from "../draft/personalitySimilarity";
import {assessManagerLifecycle, validateLifecyclePolicy, type ManagerLifecyclePolicy} from "../draft/managerLifecycle";
import {academyAlumniPerformance, academyEnvironmentFromState, applyAcademyDevelopment, createAcademyState, evolveAcademyState, type AcademyAlumnus, type AcademyDevelopmentEvidence, type AcademyState} from "../draft/academyEnvironment";
import {runAcademyTalentMarket, type AcademyMarketPolicy, type ContractNegotiationPolicy, type ManagerConsentPolicy} from "../draft/academyTalentMarket";
import {academyFinancialControls, academyFinancialHealth, academyRecoveryRecords, settleAcademyContracts, settleSalaryGuarantees, type AcademyFinancialControl, type AcademyFinancialHealth, type AcademyRecoveryRecord, type SalaryGuaranteeDebt} from "../draft/academyContracts";

interface SeasonRecord {season: number; rank: number; points: number; champion: boolean}
interface SourceManager {id: string; name: string; currentProfile: ManagerProfile; lineage: LineageIdentity; lineageHistory: LineageIdentity[]; titles: number; totalPoints: number; seasons: SeasonRecord[]}
interface SourceState {version: number; seed: string; completedSeason: number; managers: SourceManager[]; fingerprint: CareerMemoryCheckpoint["source"]["fingerprint"]; registry?: {hash?: string; revision?: string; snapshot?: string}}
interface Entrant {
  slotId: string; childId: string; childName: string; parentId: string; parentName: string;
  rightsHolderId: string; optionYears: number; secondParentId?: string; lineage: LineageIdentity;
  mutations: string[]; origin: "newborn" | "retained"; cohort: number; priorCareer: SeasonRecord[];
  priorTitles: number; priorTotalPoints: number; parentSource: "major" | "development"; generation: number; annualSalary: number; contractYears: number;
  kinshipExclusions?: number; similarityExclusions?: number; closestMateSimilarity?: number; scoutingChance?: number; developmentAcademyId?: string; marketAcademy?: AcademyDevelopmentEvidence; academy?: AcademyDevelopmentEvidence;
}
interface DevelopmentManager {id: string; name: string; titles: number; totalPoints: number; seasons: SeasonRecord[]; baseProfile: ManagerProfile; currentProfile: ManagerProfile; lineage: LineageIdentity; lineageHistory: LineageIdentity[]}
interface PreviousRow {slotId: string; childId: string; childName: string; parentId: string; parentName: string; rightsHolderId: string; optionYearsRemaining: number; contractYearsRemaining?: number; status: string; totalPoints?: number; averageRank?: number; titles?: number; developmentSeasons?: number}
interface PreviousEntrants {schemaVersion: number; cycle?: number; capacity?: number; source: {root: string; season?: number; seed?: string}; entrants: Entrant[]; academies?: AcademyState[]; salaryDebts?: SalaryGuaranteeDebt[]; academyFinancialHealth?: AcademyFinancialHealth[]; academyRecoveryPlans?: AcademyRecoveryRecord[]}
interface PreviousSummary {cycle?: number; capacity?: number; retained: PreviousRow[]; promoted: PreviousRow[]; eliminated: PreviousRow[]}
interface ParentCandidate {id: string; name: string; profile: ManagerProfile; lineage: LineageIdentity; lineageHistory: LineageIdentity[]; rightsHolderId: string; source: "major" | "development"; points: number; rank: number; champion: boolean}
interface MajorSourceTransition {schemaVersion: 1; type: "promotion"; source: {root: string; seed: string; completedSeason: number; stateSha256: string; fingerprint: SourceState["fingerprint"]; registryHash?: string}; target: {root: string; seed: string; completedSeason: number; fingerprint: SourceState["fingerprint"]; registryHash?: string}}

const args = process.argv.slice(2), root = process.cwd();
const source = path.resolve(option("--source", "output/draft-league-v12"));
const out = path.resolve(option("--out", "output/development-league"));
const previousPath = option("--previous", "") ? path.resolve(option("--previous", "")) : undefined;
const seasons = integerOption("--seasons", 3, 1, 12);
const parentLimit = integerOption("--parent-limit", 6, 1, 30);
const childrenPerParent = integerOption("--children-per-parent", 1, 1, 3);
const promotionSlots = integerOption("--promotion-slots", 1, 1, 5);
const eliminationSlots = integerOption("--elimination-slots", 1, 0, 5);
const developmentParentPercent = integerOption("--development-parent-percent", 50, 0, 100);
const maxFounderSharePercent = integerOption("--max-founder-share-percent", 50, 1, 100);
const kinshipDepth = integerOption("--kinship-depth", 2, 0, 10);
const maxParentSimilarityPercent = integerOption("--max-parent-similarity-percent", 90, 0, 100);
const academyInfluencePercent = integerOption("--academy-influence-percent", 15, 0, 50);
const academyEvolutionPercent = integerOption("--academy-evolution-percent", 10, 0, 50);
const academyInitialBudget = integerOption("--academy-initial-budget", 30, 0, 10000);
const academyGrantPool = integerOption("--academy-grant-pool", 105, 0, 100000);
const academyGrantLoadPercent = integerOption("--academy-grant-load-percent", 0, 0, 200);
const academyGrantDebtPercent = integerOption("--academy-grant-debt-percent", 0, 0, 200);
const academyPayrollReservePercent = integerOption("--academy-payroll-reserve-percent", 0, 0, 100);
const academyMaximumSpend = integerOption("--academy-max-cycle-spend", 30, 0, 10000);
const academyPerformanceRevenue = integerOption("--academy-performance-revenue", 10, 0, 10000);
const academyMarketPolicy = marketPolicy(option("--academy-market-policy", "shadow"));
const academyMarketConsentPolicy = consentPolicy(option("--academy-market-consent-policy", "enforce"));
const academyMarketConsentThreshold = integerOption("--academy-market-consent-threshold-percent", 50, 0, 100) / 100;
const academyMarketContractPolicy = contractPolicy(option("--academy-market-contract-policy", "enforce"));
const academyRookieSalary = integerOption("--academy-rookie-salary", 2, 0, 1000);
const academyMarketBaseSalary = integerOption("--academy-market-base-salary", 3, 0, 1000);
const academyMarketMaximumSalary = integerOption("--academy-market-max-salary", 10, 0, 10000);
const academyMarketOfferPercent = integerOption("--academy-market-offer-percent", 115, 50, 200);
const academyContractYears = integerOption("--academy-contract-years", 3, 1, 12);
const academyArbitrationDemandPercent = integerOption("--academy-arbitration-demand-percent", 60, 0, 100);
const academyMarketMaximumTransactions = integerOption("--academy-market-max-transactions", 2, 0, 10);
const academySigningFee = integerOption("--academy-signing-fee", 8, 0, 10000);
const academyTransferFee = integerOption("--academy-transfer-fee", 15, 0, 10000);
const academyLoanFee = integerOption("--academy-loan-fee", 5, 0, 10000);
const academyEmergencySaleDiscountPercent = integerOption("--academy-emergency-sale-discount-percent", 35, 0, 90);
const academyTransferMinimumFit = integerOption("--academy-transfer-min-fit-percent", 15, -100, 100) / 100;
const academyLoanMinimumFit = integerOption("--academy-loan-min-fit-percent", 5, -100, 100) / 100;
const lifecyclePolicy: ManagerLifecyclePolicy = {
  maturitySeasons: integerOption("--maturity-seasons", 2, 0, 20),
  fertilityMaxSeasons: integerOption("--fertility-max-seasons", 8, 0, 40),
  retirementMinSeasons: integerOption("--retirement-min-seasons", 8, 0, 40),
  retirementHardSeasons: integerOption("--retirement-hard-seasons", 12, 1, 60),
  retirementBasePercent: integerOption("--retirement-base-percent", 25, 0, 100),
  retirementGrowthPercent: integerOption("--retirement-growth-percent", 15, 0, 100),
};
validateLifecyclePolicy(lifecyclePolicy);
const sourceState = read<SourceState>(path.join(source, "dynasty-state.json"));
const parents = [...sourceState.managers].sort((a, b) => a.id.localeCompare(b.id)).slice(0, parentLimit);
const previous = previousPath ? loadPrevious(previousPath) : undefined;
const cycle = (previous?.summary.cycle ?? previous?.entrants.cycle ?? 0) + 1;
const lifecycle = classifyPreviousLifecycle();
const academyControls = academyFinancialControls(sourceState.managers.map(manager => manager.id), previous?.entrants.academyFinancialHealth ?? [], previous?.entrants.salaryDebts ?? []);
const academyStates = buildAcademyStates();
const academyGuarantees = settleSalaryGuarantees(previous?.entrants.salaryDebts ?? [], academyStates);
for (const academy of academyStates) academy.treasury = academyGuarantees.balances[academy.academyId] ?? academy.treasury;
const academyTalentMarket = buildAcademyTalentMarket();
for (const academy of academyStates) academy.treasury = academyTalentMarket.balances[academy.academyId] ?? academy.treasury;
const defaultCapacity = previous?.summary.capacity ?? previous?.entrants.capacity ?? parents.length * childrenPerParent;
const entrantCount = integerOption("--capacity", defaultCapacity, 6, 30);
if (promotionSlots + eliminationSlots > entrantCount) throw new Error("Promotion and elimination slots exceed the entrant count");
if (lifecycle.continuing.length > entrantCount) throw new Error(`Capacity ${entrantCount} cannot hold ${lifecycle.continuing.length} continuing managers`);
if (previousPath && path.resolve(previousPath) === out) throw new Error("The next development output must differ from --previous");
prepareOutput();

const birthSeason = sourceState.completedSeason + cycle;
const entrants: Entrant[] = [], checkpointManagers: CareerMemoryCheckpoint["managers"] = [];
addRetainedManagers();
addNewbornManagers();
const academyContracts = settleAcademyContracts(entrants.map(entrant => {
  const manager = checkpointManagers.find(value => value.id === entrant.slotId)!;
  const previousRow = lifecycle.continuing.find(value => value.childId === entrant.childId);
  return {childId: entrant.childId, childName: entrant.childName, academyId: entrant.rightsHolderId, optionYears: entrant.optionYears, annualSalary: entrant.annualSalary, contractYears: entrant.contractYears, profile: manager.currentProfile, averageRank: previousRow?.averageRank, capacity: previous?.entrants.capacity ?? entrantCount};
}), academyStates, new Set(academyTalentMarket.transactions.filter(transaction => transaction.status === "executed").map(transaction => transaction.childId)), {policy: academyMarketContractPolicy, cycleSeasons: seasons, renewalYears: academyContractYears, baseSalary: academyMarketBaseSalary, maximumSalary: academyMarketMaximumSalary, arbitrationDemandWeight: academyArbitrationDemandPercent / 100, cycle});
for (const academy of academyStates) academy.treasury = academyContracts.balances[academy.academyId] ?? academy.treasury;
for (const entrant of entrants) { const assignment = academyContracts.assignments[entrant.childId]; if (assignment) { entrant.annualSalary = assignment.annualSalary; entrant.contractYears = assignment.contractYears; entrant.optionYears = assignment.optionYears; } }
const salaryDebts = [...academyGuarantees.remainingDebts, ...academyContracts.newDebts];
const academyFinancial = academyFinancialHealth(academyStates, academyGuarantees, academyContracts, academyMarketBaseSalary * seasons);
const academyRecovery = academyRecoveryRecords(academyControls, academyFinancial, previous?.entrants.academyRecoveryPlans ?? [], cycle);

writeJson(path.join(out, "entrants.json"), {schemaVersion: 15, cycle, capacity: entrantCount, source: {root: source, season: sourceState.completedSeason, seed: sourceState.seed}, previous: previousPath, birthSeason, policy: {developmentParentPercent, maxFounderSharePercent, maxFounderCount: founderCapacity(entrantCount, maxFounderSharePercent), kinshipDepth, maxParentSimilarityPercent, academyInfluencePercent, academyEvolutionPercent, academyEconomy: {initialBudget: academyInitialBudget, grantPool: academyGrantPool, grantLoadPercent: academyGrantLoadPercent, grantDebtPercent: academyGrantDebtPercent, payrollReservePercent: academyPayrollReservePercent, maximumCycleSpend: academyMaximumSpend, performanceRevenueRate: academyPerformanceRevenue}, academyMarket: academyMarketRules(), lifecycle: lifecyclePolicy}, academyFinancialControls: academyControls, academyRecoveryPlans: academyRecovery, academies: academyStates, talentMarket: academyTalentMarket, salaryGuarantees: academyGuarantees, salaryDebts, contracts: academyContracts, academyFinancialHealth: academyFinancial, lifecycleRetired: lifecycle.retired, diversity: diversitySnapshot(), entrants});
const checkpointManifest = writeCheckpoint(checkpointManagers);
runDevelopmentLeague(checkpointManifest);
const result = evaluateLeague();
writeJson(path.join(out, "development-summary.json"), result);
writePromotionPackage(result.promoted);
fs.writeFileSync(path.join(out, "development-report.md"), report(result), "utf8");
console.log(JSON.stringify({cycle, capacity: entrantCount, returning: entrants.filter(entry => entry.origin === "retained").length, lifecycleRetired: lifecycle.retired.length, births: entrants.filter(entry => entry.origin === "newborn").length, developmentParentBirths: entrants.filter(entry => entry.origin === "newborn" && entry.parentSource === "development").length, seasons, promoted: result.promoted.map(entry => entry.childName), retained: result.retained.length, eliminated: result.eliminated.map(entry => entry.childName), output: out}, null, 2));

function loadPrevious(directory: string) {
  const entrants = read<PreviousEntrants>(path.join(directory, "entrants.json"));
  const summary = read<PreviousSummary>(path.join(directory, "development-summary.json"));
  const state = read<{managers: DevelopmentManager[]}>(path.join(directory, "league", "dynasty-state.json"));
  const recordedSource = path.resolve(entrants.source.root);
  if (recordedSource !== source) {
    const recordedStatePath = path.join(recordedSource, "dynasty-state.json");
    if (!fs.existsSync(recordedStatePath)) throw new Error("Previous development cycle belongs to a different major-league source");
    const recordedState = read<SourceState>(recordedStatePath);
    const sameJourney = entrants.source.seed === sourceState.seed
      && entrants.source.season === recordedState.completedSeason
      && recordedState.seed === sourceState.seed
      && recordedState.completedSeason <= sourceState.completedSeason
      && recordedState.registry?.hash === sourceState.registry?.hash
      && JSON.stringify(recordedState.fingerprint) === JSON.stringify(sourceState.fingerprint);
    if (!sameJourney && !authorizedPromotionTransition(entrants, recordedSource, recordedState, recordedStatePath)) throw new Error("Previous development cycle belongs to a different major-league source");
  }
  return {entrants, summary, state};
}

function authorizedPromotionTransition(entrants: PreviousEntrants, recordedSource: string, recordedState: SourceState, recordedStatePath: string): boolean {
  const transitionPath = path.join(source, "major-source-transition.json");
  if (!fs.existsSync(transitionPath)) return false;
  const transition = read<MajorSourceTransition>(transitionPath), sourceHash = crypto.createHash("sha256").update(fs.readFileSync(recordedStatePath)).digest("hex");
  return transition.schemaVersion === 1
    && transition.type === "promotion"
    && path.resolve(transition.source.root) === recordedSource
    && transition.source.seed === entrants.source.seed
    && transition.source.seed === recordedState.seed
    && transition.source.completedSeason === entrants.source.season
    && transition.source.completedSeason === recordedState.completedSeason
    && transition.source.stateSha256 === sourceHash
    && transition.source.registryHash === recordedState.registry?.hash
    && JSON.stringify(transition.source.fingerprint) === JSON.stringify(recordedState.fingerprint)
    && path.resolve(transition.target.root) === source
    && transition.target.seed === sourceState.seed
    && transition.target.completedSeason <= sourceState.completedSeason
    && transition.target.registryHash === sourceState.registry?.hash
    && JSON.stringify(transition.target.fingerprint) === JSON.stringify(sourceState.fingerprint);
}

function classifyPreviousLifecycle() {
  if (!previous) return {continuing: [] as PreviousRow[], retired: [] as Array<Record<string, unknown>>};
  const continuing: PreviousRow[] = [], retired: Array<Record<string, unknown>> = [];
  for (const row of previous.summary.retained) {
    const entrant = previous.entrants.entrants.find(value => value.childId === row.childId), manager = previous.state.managers.find(value => value.id === row.slotId);
    if (!entrant || !manager) throw new Error(`Incomplete lifecycle record for ${row.childId}`);
    const career = combineCareer(entrant.priorCareer ?? [], manager.seasons), assessment = assessManagerLifecycle(career.length, lifecyclePolicy, `${sourceState.seed}:development:${cycle}:${row.childId}`);
    if (assessment.retires) retired.push({childId: row.childId, childName: row.childName, parentId: row.parentId, rightsHolderId: row.rightsHolderId, lineage: manager.lineage, careerSeasons: career.length, titles: (entrant.priorTitles ?? 0) + manager.titles, totalPoints: (entrant.priorTotalPoints ?? 0) + manager.totalPoints, assessment});
    else continuing.push(row);
  }
  return {continuing, retired};
}

function buildAcademyStates(): AcademyState[] {
  const records = parents.map(manager => {
    const rawState = previous?.entrants.academies?.find(value => value.academyId === manager.id) ?? createAcademyState(manager.id, manager.name, manager.currentProfile, academyInitialBudget), control = academyControls.find(value => value.academyId === manager.id);
    return {state: applyFinancialLeadership(rawState, control), alumni: previous ? academyAlumni(manager.id) : []};
  });
  if (!previous) return records.map(record => record.state).sort((a, b) => a.academyId.localeCompare(b.academyId));
  const weights = records.map(record => {
    const guaranteedDebt = (previous?.entrants.salaryDebts ?? []).filter(debt => debt.academyId === record.state.academyId).reduce((sum, debt) => sum + debt.amount, 0);
    return 1 + academyAlumniPerformance(record.state, record.alumni) * .5 + Math.max(0, record.alumni.length - 1) * academyGrantLoadPercent / 100 + guaranteedDebt / Math.max(1, academyMarketBaseSalary) * academyGrantDebtPercent / 100;
  }), totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  const continuingIds = new Set(lifecycle.continuing.map(row => row.childId));
  return records.map((record, index) => {
    const control = academyControls.find(value => value.academyId === record.state.academyId), grant = academyGrantPool * weights[index] / totalWeight;
    const guaranteedDebt = (previous.entrants.salaryDebts ?? []).filter(debt => debt.academyId === record.state.academyId).reduce((sum, debt) => sum + debt.amount, 0);
    const continuingPayroll = previous.entrants.entrants.filter(entrant => entrant.rightsHolderId === record.state.academyId && continuingIds.has(entrant.childId) && entrant.contractYears > 0).reduce((sum, entrant) => sum + entrant.annualSalary * seasons, 0);
    const protectedReserve = (guaranteedDebt + continuingPayroll) * academyPayrollReservePercent / 100, spendable = Math.max(0, record.state.treasury + grant - protectedReserve), maximumSpend = Math.min(academyMaximumSpend * (control?.spendingMultiplier ?? 1), spendable);
    return evolveAcademyState(record.state, record.alumni, cycle, academyEvolutionPercent / 100, {grant, maximumSpend, performanceRevenueRate: academyPerformanceRevenue, protectedReserve});
  }).sort((a, b) => a.academyId.localeCompare(b.academyId));
}

function academyAlumni(academyId: string): AcademyAlumnus[] {
  if (!previous) return [];
  return previous.entrants.entrants.flatMap(entrant => {
    if (entrant.rightsHolderId !== academyId) return [];
    const row = [...previous.summary.promoted, ...previous.summary.retained, ...previous.summary.eliminated].find(value => value.childId === entrant.childId), alumnus = previous.state.managers.find(value => value.id === row?.slotId);
    if (!row || !alumnus || !["promoted", "retained", "eliminated"].includes(row.status)) return [];
    return [{childId: entrant.childId, status: row.status as AcademyAlumnus["status"], averageRank: row.averageRank ?? entrantCountFallback(previous.entrants.capacity), capacity: previous.entrants.capacity ?? previous.entrants.entrants.length, profile: alumnus.currentProfile}];
  });
}

function buildAcademyTalentMarket() {
  if (!previous) return runAcademyTalentMarket([], academyStates, academyMarketRules());
  const candidates = lifecycle.continuing.map(row => {
    const entrant = previous.entrants.entrants.find(value => value.childId === row.childId), manager = previous.state.managers.find(value => value.id === row.slotId);
    if (!entrant || !manager) throw new Error(`Incomplete market candidate ${row.childId}`);
    return {childId: row.childId, childName: row.childName, rightsHolderId: entrant.rightsHolderId, optionYears: row.optionYearsRemaining, annualSalary: entrant.annualSalary ?? academyRookieSalary, contractYears: row.contractYearsRemaining ?? entrant.contractYears ?? 0, profile: manager.currentProfile, averageRank: row.averageRank, capacity: previous.entrants.capacity ?? previous.entrants.entrants.length};
  });
  return runAcademyTalentMarket(candidates, academyStates, academyMarketRules());
}

function academyMarketRules() { return {policy: academyMarketPolicy, consentPolicy: academyMarketConsentPolicy, consentThreshold: academyMarketConsentThreshold, contractPolicy: academyMarketContractPolicy, baseSalary: academyMarketBaseSalary, maximumSalary: academyMarketMaximumSalary, offerMultiplier: academyMarketOfferPercent / 100, prepaidSeasons: seasons, contractYears: academyContractYears, maximumTransactions: academyMarketMaximumTransactions, signingFee: academySigningFee, transferFee: academyTransferFee, loanFee: academyLoanFee, transferMinimumFitDelta: academyTransferMinimumFit, loanMinimumFitDelta: academyLoanMinimumFit, freeAgentOptionYears: 3, acquisitionBlockedAcademyIds: academyControls.filter(control => !control.acquisitionAllowed).map(control => control.academyId), emergencySaleAcademyIds: academyControls.filter(control => control.triggerStatus === "distressed" || control.triggerStatus === "insolvent").map(control => control.academyId), emergencySaleDiscountPercent: academyEmergencySaleDiscountPercent}; }

function addRetainedManagers(): void {
  if (!previous) return;
  const retained = [...lifecycle.continuing].sort((a, b) => a.slotId.localeCompare(b.slotId));
  const slotMap = new Map(retained.map((row, index) => [row.slotId, slot(index)]));
  for (let index = 0; index < retained.length; index += 1) {
    const row = retained[index], oldEntrant = previous.entrants.entrants.find(entry => entry.childId === row.childId), oldManager = previous.state.managers.find(manager => manager.id === row.slotId);
    if (!oldEntrant || !oldManager) throw new Error(`Incomplete retained-manager record for ${row.childId}`);
    const slotId = slot(index), priorCareer = combineCareer(oldEntrant.priorCareer ?? [], oldManager.seasons);
    const assignment = academyTalentMarket.assignments[row.childId] ?? {rightsHolderId: oldEntrant.rightsHolderId, developmentAcademyId: oldEntrant.rightsHolderId, optionYears: row.optionYearsRemaining, annualSalary: oldEntrant.annualSalary ?? academyRookieSalary, contractYears: row.contractYearsRemaining ?? oldEntrant.contractYears ?? 0};
    let currentProfile = remapProfile(oldManager.currentProfile, slotId, row.childName, slotMap); const baseProfile = remapProfile(oldManager.baseProfile ?? oldManager.currentProfile, slotId, row.childName, slotMap);
    const transaction = academyTalentMarket.transactions.find(value => value.childId === row.childId && value.status === "executed");
    let marketAcademy: AcademyDevelopmentEvidence | undefined;
    if (transaction) { const academy = academyStates.find(value => value.academyId === assignment.developmentAcademyId); if (!academy) throw new Error(`Unknown market academy ${assignment.developmentAcademyId}`); const developed = applyAcademyDevelopment(currentProfile, academyEnvironmentFromState(academy), academyInfluencePercent / 200); currentProfile = developed.profile; marketAcademy = developed.evidence; }
    const entrant: Entrant = {...oldEntrant, slotId, childName: row.childName, rightsHolderId: assignment.rightsHolderId, developmentAcademyId: assignment.developmentAcademyId, optionYears: assignment.optionYears, annualSalary: assignment.annualSalary, contractYears: assignment.contractYears, marketAcademy, origin: "retained", priorCareer, priorTitles: (oldEntrant.priorTitles ?? 0) + oldManager.titles, priorTotalPoints: (oldEntrant.priorTotalPoints ?? 0) + oldManager.totalPoints, parentSource: oldEntrant.parentSource ?? "major", generation: oldEntrant.generation ?? oldManager.lineage.generation};
    entrants.push(entrant);
    checkpointManagers.push({id: slotId, name: entrant.childName, baseProfile, currentProfile, lineage: oldManager.lineage, lineageHistory: oldManager.lineageHistory});
  }
}

function addNewbornManagers(): void {
  const births = entrantCount - entrants.length;
  const developmentParents = eligibleDevelopmentParents();
  const developmentBirths = Math.min(births, developmentParents.length, Math.ceil(births * developmentParentPercent / 100));
  const majorParents = parents.map(majorParent);
  const founderCounts = new Map<string, number>();
  for (const entrant of entrants) founderCounts.set(entrant.lineage.founderId, (founderCounts.get(entrant.lineage.founderId) ?? 0) + 1);
  const maximumFounderCount = founderCapacity(entrantCount, maxFounderSharePercent), usedDevelopmentParents = new Set<string>();
  for (let birth = 0; birth < births; birth += 1) {
    const index = entrants.length;
    const eligible = (candidates: ParentCandidate[]) => candidates.filter(candidate => (founderCounts.get(candidate.lineage.founderId) ?? 0) < maximumFounderCount && !usedDevelopmentParents.has(candidate.id)).sort((a, b) => (founderCounts.get(a.lineage.founderId) ?? 0) - (founderCounts.get(b.lineage.founderId) ?? 0) || b.points - a.points || a.id.localeCompare(b.id));
    const preferredDevelopment = birth < developmentBirths ? eligible(developmentParents) : [];
    const parent = preferredDevelopment[0] ?? eligible(majorParents)[0];
    if (!parent) throw new Error(`Founder diversity limit ${maximumFounderCount}/${entrantCount} leaves no eligible parent for birth ${birth + 1}`);
    if (parent.source === "development") usedDevelopmentParents.add(parent.id);
    founderCounts.set(parent.lineage.founderId, (founderCounts.get(parent.lineage.founderId) ?? 0) + 1);
    const slotId = slot(index), childName = `${parent.name}${parent.source === "development" ? "后备" : "学院"} C${cycle}-${birth + 1}`;
    const slotProfile = cloneManagerProfile(parent.profile);
    slotProfile.id = slotId; slotProfile.name = childName; slotProfile.tactics.id = slotId; slotProfile.matchupMemory = {};
    const academyState = academyStates.find(state => state.academyId === parent.rightsHolderId);
    if (!academyState) throw new Error(`Unknown academy rights holder ${parent.rightsHolderId}`);
    const rawMateCandidates = majorParents.filter(candidate => candidate.id !== parent.id);
    const unrelatedMateCandidates = rawMateCandidates.filter(candidate => !areLineagesRelated(parent, candidate, kinshipDepth));
    const kinshipExclusions = rawMateCandidates.length - unrelatedMateCandidates.length;
    const scoredMateCandidates = unrelatedMateCandidates.map(candidate => ({candidate, evidence: personalitySimilarity(parent.profile, candidate.profile)}));
    const mateCandidates = scoredMateCandidates.filter(entry => entry.evidence.similarity <= maxParentSimilarityPercent / 100).map(entry => entry.candidate);
    const similarityExclusions = unrelatedMateCandidates.length - mateCandidates.length;
    const closestMateSimilarity = scoredMateCandidates.length ? Math.max(...scoredMateCandidates.map(entry => entry.evidence.similarity)) : 0;
    const scoutingChance = .05 + academyState.scouting * .3;
    const secondParentCandidate = unit(`${sourceState.seed}:development:${birthSeason}:${slotId}:second-parent`) < scoutingChance && mateCandidates.length
      ? mateCandidates[Math.floor(unit(`${sourceState.seed}:${cycle}:${slotId}:mate`) * mateCandidates.length)] : undefined;
    const secondParent = secondParentCandidate ? parentCompetitor(secondParentCandidate) : undefined;
    const offspring = createManagerOffspring({parent: parentCompetitor(parent), secondParent, slotProfile, birthSeason, seed: `${sourceState.seed}:development:${birthSeason}:${slotId}`});
    const academy = academyEnvironmentFromState(academyState), developed = applyAcademyDevelopment(offspring.profile, academy, academyInfluencePercent / 100);
    const entrant: Entrant = {slotId, childId: offspring.lineage.lineageId, childName, parentId: parent.id, parentName: parent.name, rightsHolderId: parent.rightsHolderId, developmentAcademyId: parent.rightsHolderId, optionYears: 3, annualSalary: academyRookieSalary, contractYears: academyContractYears, secondParentId: secondParentCandidate?.id, lineage: offspring.lineage, mutations: offspring.lineage.mutations, origin: "newborn", cohort: cycle, priorCareer: [], priorTitles: 0, priorTotalPoints: 0, parentSource: parent.source, generation: offspring.lineage.generation, kinshipExclusions, similarityExclusions, closestMateSimilarity, scoutingChance, academy: developed.evidence};
    entrants.push(entrant);
    checkpointManagers.push({id: slotId, name: childName, baseProfile: cloneManagerProfile(developed.profile), currentProfile: cloneManagerProfile(developed.profile), lineage: offspring.lineage, lineageHistory: mergeLineageHistory(parent.lineageHistory, secondParentCandidate?.lineageHistory ?? [], offspring.lineage)});
  }
}

function eligibleDevelopmentParents(): ParentCandidate[] {
  if (!previous) return [];
  const candidates: ParentCandidate[] = [];
  for (const row of lifecycle.continuing) {
    const entrant = previous.entrants.entrants.find(value => value.childId === row.childId), manager = previous.state.managers.find(value => value.id === row.slotId);
    if (!entrant || !manager) throw new Error(`Incomplete development-parent record for ${row.childId}`);
    const latest = manager.seasons.at(-1);
    const careerSeasons = combineCareer(entrant.priorCareer ?? [], manager.seasons).length;
    const assignment = academyTalentMarket.assignments[row.childId] ?? {rightsHolderId: entrant.rightsHolderId};
    const activeProfile = checkpointManagers.find(value => value.lineage.lineageId === manager.lineage.lineageId)?.currentProfile ?? manager.currentProfile;
    if (assessManagerLifecycle(careerSeasons, lifecyclePolicy, `${sourceState.seed}:development:${cycle}:${row.childId}`).parentEligible) candidates.push({id: entrant.childId, name: row.childName, profile: activeProfile, lineage: manager.lineage, lineageHistory: manager.lineageHistory, rightsHolderId: assignment.rightsHolderId, source: "development", points: (entrant.priorTotalPoints ?? 0) + manager.totalPoints, rank: latest?.rank ?? row.averageRank ?? entrantCount, champion: latest?.champion ?? false});
  }
  return candidates;
}

function majorParent(manager: SourceManager): ParentCandidate { const latest = manager.seasons.at(-1); return {id: manager.id, name: manager.name, profile: manager.currentProfile, lineage: manager.lineage, lineageHistory: manager.lineageHistory, rightsHolderId: manager.id, source: "major", points: latest?.points ?? manager.totalPoints, rank: latest?.rank ?? 1, champion: latest?.champion ?? false}; }
function parentCompetitor(parent: ParentCandidate): EvolutionCompetitor { return {slotId: parent.id, profile: parent.profile, lineage: parent.lineage, points: parent.points, rank: parent.rank, champion: parent.champion, playoffScore: parent.champion ? 1 : 0, behavior: profileBehavior(parent.profile)}; }
function mergeLineageHistory(primary: LineageIdentity[], secondary: LineageIdentity[], child: LineageIdentity): LineageIdentity[] { const seen = new Set<string>(); return [...primary, ...secondary, child].filter(lineage => !seen.has(lineage.lineageId) && Boolean(seen.add(lineage.lineageId))); }
function diversitySnapshot() { const founderCounts = Object.fromEntries([...entrants.reduce((counts, entrant) => counts.set(entrant.lineage.founderId, (counts.get(entrant.lineage.founderId) ?? 0) + 1), new Map<string, number>())].sort(([a], [b]) => a.localeCompare(b))); const counts = Object.values(founderCounts); return {founderCounts, distinctFounders: counts.length, maximumFounderCount: counts.length ? Math.max(...counts) : 0, kinshipExclusions: entrants.reduce((sum, entrant) => sum + (entrant.kinshipExclusions ?? 0), 0), similarityExclusions: entrants.reduce((sum, entrant) => sum + (entrant.similarityExclusions ?? 0), 0), closestMateSimilarity: Math.max(0, ...entrants.map(entrant => entrant.closestMateSimilarity ?? 0))}; }
function academySnapshot() { const evidence = entrants.flatMap(entrant => entrant.origin === "newborn" && entrant.academy ? [entrant.academy] : []), organizations = Object.fromEntries([...evidence.reduce((counts, entry) => counts.set(entry.academyId, (counts.get(entry.academyId) ?? 0) + 1), new Map<string, number>())].sort(([a], [b]) => a.localeCompare(b))); return {developedBirths: evidence.length, organizations, averageQuality: average(evidence.map(entry => entry.quality)), averageEffectiveInfluence: average(evidence.map(entry => entry.effectiveInfluence)), averageSimilarityShift: average(evidence.map(entry => entry.similarityAfter - entry.similarityBefore)), programsChanged: evidence.filter(entry => !entry.strategyProgramUnchanged).length}; }
function academyEvolutionSnapshot() { const updated = academyStates.filter(state => (state.latestEvidence?.alumni ?? 0) > 0), revisions = Object.fromEntries(academyStates.map(state => [state.academyId, state.revision])); return {academies: academyStates.length, updated: updated.length, alumni: updated.reduce((sum, state) => sum + (state.latestEvidence?.alumni ?? 0), 0), averagePerformance: average(updated.map(state => state.latestEvidence!.performance)), averageQualityDelta: average(updated.map(state => state.latestEvidence!.qualityAfter - state.latestEvidence!.qualityBefore)), cultureModelsAdopted: updated.filter(state => state.latestEvidence?.cultureModelChildId).length, revisions}; }
function academyEconomySnapshot() { const evidence = academyStates.flatMap(state => state.latestEvidence ? [state.latestEvidence] : []), totalBudgetBefore = evidence.reduce((sum, entry) => sum + entry.budgetBefore, 0), totalGrants = evidence.reduce((sum, entry) => sum + entry.grant, 0), totalPerformanceRevenue = evidence.reduce((sum, entry) => sum + entry.performanceRevenue, 0), totalMaximumSpend = evidence.reduce((sum, entry) => sum + entry.maximumSpend, 0), totalProtectedReserve = evidence.reduce((sum, entry) => sum + entry.protectedReserve, 0), totalSpend = evidence.reduce((sum, entry) => sum + entry.spend, 0), totalBudgetAfter = evidence.reduce((sum, entry) => sum + entry.budgetAfter, 0); return {academies: academyStates.length, totalBudgetBefore, totalGrants, totalPerformanceRevenue, totalMaximumSpend, totalProtectedReserve, totalSpend, totalBudgetAfter, conservationError: totalBudgetBefore + totalGrants + totalPerformanceRevenue - totalSpend - totalBudgetAfter, spending: {facility: evidence.reduce((sum, entry) => sum + entry.spending.facility, 0), scouting: evidence.reduce((sum, entry) => sum + entry.spending.scouting, 0), patience: evidence.reduce((sum, entry) => sum + entry.spending.patience, 0), experimentation: evidence.reduce((sum, entry) => sum + entry.spending.experimentation, 0)}}; }

function remapProfile(profile: ManagerProfile, id: string, name: string, slotMap: Map<string, string>): ManagerProfile {
  const copy = cloneManagerProfile(profile), memory: NonNullable<ManagerProfile["matchupMemory"]> = {};
  for (const [oldOpponent, value] of Object.entries(copy.matchupMemory ?? {})) { const mapped = slotMap.get(oldOpponent); if (mapped && mapped !== id) memory[mapped] = value; }
  copy.id = id; copy.name = name; copy.tactics.id = id; copy.matchupMemory = memory;
  return copy;
}

function profileBehavior(profile: ManagerProfile): ObservedBehavior { const traits = profile.traits; return {pace: traits.risk, lineupVariation: traits.flexibility, starInvestment: traits.stars, roleBreadth: (traits.synergy + traits.flexibility) / 2, rosterTurnover: 1 - traits.value, knockoutPressure: (traits.counter + traits.risk) / 2}; }

function writeCheckpoint(managers: CareerMemoryCheckpoint["managers"]): string {
  const checkpoint: CareerMemoryCheckpoint = {schemaVersion: 1, source: {seed: sourceState.seed, completedSeason: sourceState.completedSeason, stateVersion: sourceState.version, fingerprint: sourceState.fingerprint, registry: {hash: sourceState.registry?.hash, revision: sourceState.registry?.revision}}, managers};
  const bytes = Buffer.from(`${JSON.stringify(checkpoint)}\n`, "utf8"), compressed = zlib.gzipSync(bytes, {level: 9});
  const archive = path.join(out, "development-checkpoint.json.gz"), manifest = path.join(out, "development-checkpoint.json");
  fs.writeFileSync(archive, compressed);
  writeJson(manifest, {schemaVersion: 1, archive: path.basename(archive), sha256: crypto.createHash("sha256").update(bytes).digest("hex"), sourceBytes: bytes.length, compressedBytes: compressed.length, managers: managers.length});
  return manifest;
}

function runDevelopmentLeague(checkpoint: string): void {
  const registrySource = sourceState.registry?.snapshot ? path.resolve(source, sourceState.registry.snapshot) : path.resolve(option("--registry", "data/draft"));
  const regularRounds = integerOption("--regular-rounds", Math.min(3, entrantCount - 1), 1, entrantCount - 1);
  const env = {...process.env, V12_OUT: path.join(out, "league"), V12_SEED: `${sourceState.seed}:development:${birthSeason}:cycle:${cycle}`, V12_SEASONS: String(seasons), V12_MANAGER_LIMIT: String(entrantCount), V12_PAIRS: "1", V12_POOL_SIZE: String(Math.max(100, entrantCount * 16)), V12_AUCTION_LOTS: String(Math.max(10, entrantCount * 2)), V12_REGULAR_ROUNDS: String(regularRounds), V12_MAX_TURNS: String(integerOption("--max-turns", 40, 20, 180)), V12_MIN_ROSTER: "6", V12_MAX_ROSTER: "6", V12_BASE_CASH: "40", V12_REGISTRY_SOURCE: registrySource, V12_REGISTRY_REVISION: sourceState.registry?.revision ?? "development-league", V12_CAREER_CHECKPOINT: checkpoint, V12_ALLOW_CODE_UPGRADE: "true", V12_EVOLUTION_MODE: "punctuated", V12_EVOLUTION_POLICY: "shadow", V12_EVIDENCE_RETENTION: "compact", V12_EVIDENCE_SAMPLE_RATE: "0"};
  const run = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV12.ts")], {cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
  if (run.status !== 0) throw new Error(`Development league failed:\n${run.stderr || run.stdout}`);
}

function evaluateLeague() {
  const state = read<{managers: DevelopmentManager[]}>(path.join(out, "league", "dynasty-state.json"));
  const styleCounts = new Map<string, number>();
  for (const manager of state.managers) { const style = classifyEmergentStyle(manager.currentProfile).label; styleCounts.set(style, (styleCounts.get(style) ?? 0) + 1); }
  const ranked = state.managers.map(manager => { const entrant = entrants.find(entry => entry.slotId === manager.id)!; const style = classifyEmergentStyle(manager.currentProfile).label, nicheBonus = 3 / (styleCounts.get(style) ?? 1); return {manager, entrant, fitness: realizedFitness(manager, entrant) + nicheBonus, nicheBonus}; }).sort((a, b) => b.fitness - a.fitness || a.manager.id.localeCompare(b.manager.id));
  const promoted = ranked.slice(0, promotionSlots).map(entry => resultRow(entry.manager, entry.entrant, entry.fitness, entry.nicheBonus, "promoted"));
  const eliminatedEntries = eliminationSlots ? ranked.slice(-eliminationSlots) : [];
  const eliminatedIds = new Set(eliminatedEntries.map(entry => entry.manager.id)), promotedIds = new Set(promoted.map(entry => entry.slotId));
  const eliminated = eliminatedEntries.map(entry => resultRow(entry.manager, entry.entrant, entry.fitness, entry.nicheBonus, "eliminated"));
  const retained = ranked.filter(entry => !promotedIds.has(entry.manager.id) && !eliminatedIds.has(entry.manager.id)).map(entry => resultRow(entry.manager, entry.entrant, entry.fitness, entry.nicheBonus, "retained"));
  return {schemaVersion: 15 as const, cycle, capacity: entrantCount, seasons, returning: entrants.filter(entry => entry.origin === "retained").length, lifecycleRetired: lifecycle.retired, births: entrants.filter(entry => entry.origin === "newborn").length, developmentParentBirths: entrants.filter(entry => entry.origin === "newborn" && entry.parentSource === "development").length, majorParentBirths: entrants.filter(entry => entry.origin === "newborn" && entry.parentSource === "major").length, policy: {developmentParentPercent, maxFounderSharePercent, maxFounderCount: founderCapacity(entrantCount, maxFounderSharePercent), kinshipDepth, maxParentSimilarityPercent, academyInfluencePercent, academyEvolutionPercent, academyEconomy: {initialBudget: academyInitialBudget, grantPool: academyGrantPool, grantLoadPercent: academyGrantLoadPercent, grantDebtPercent: academyGrantDebtPercent, payrollReservePercent: academyPayrollReservePercent, maximumCycleSpend: academyMaximumSpend, performanceRevenueRate: academyPerformanceRevenue}, academyMarket: academyMarketRules(), lifecycle: lifecyclePolicy}, academyFinancialControls: academyControls, academyRecoveryPlans: academyRecovery, talentMarket: academyTalentMarket, salaryGuarantees: academyGuarantees, salaryDebts, contracts: academyContracts, academyFinancialHealth: academyFinancial, academy: academySnapshot(), academyEvolution: academyEvolutionSnapshot(), academyEconomy: academyEconomySnapshot(), diversity: diversitySnapshot(), promoted, retained, eliminated, archive: [...lifecycle.retired, ...eliminated.map(archiveRow)]};
}

function realizedFitness(manager: DevelopmentManager, entrant: Entrant): number { const career = combinedCareer(manager, entrant), titles = entrant.priorTitles + manager.titles, points = entrant.priorTotalPoints + manager.totalPoints, averageRank = career.reduce((sum, season) => sum + season.rank, 0) / Math.max(1, career.length), consistency = 1 - Math.min(1, rankDeviation(career.map(season => season.rank)) / Math.max(1, entrantCount - 1)); return titles * 100 + points * 5 + (entrantCount + 1 - averageRank) * 2 + consistency; }
function resultRow(manager: DevelopmentManager, entrant: Entrant, fitness: number, nicheBonus: number, status: "promoted" | "retained" | "eliminated") { const career = combinedCareer(manager, entrant), optionYearsRemaining = Math.max(0, entrant.optionYears - seasons), contractYearsRemaining = Math.max(0, entrant.contractYears - seasons); return {cycle, origin: entrant.origin, cohort: entrant.cohort, generation: entrant.generation ?? entrant.lineage.generation, parentSource: entrant.parentSource ?? "major", slotId: manager.id, childId: entrant.childId, childName: entrant.childName, parentId: entrant.parentId, parentName: entrant.parentName, rightsHolderId: entrant.rightsHolderId, annualSalary: entrant.annualSalary ?? academyRookieSalary, contractYearsRemaining, optionYearsRemaining, rightsStatus: optionYearsRemaining > 0 ? "affiliate" : "independent", status, fitness, nicheBonus, developmentSeasons: career.length, cycleTitles: manager.titles, cyclePoints: manager.totalPoints, titles: entrant.priorTitles + manager.titles, totalPoints: entrant.priorTotalPoints + manager.totalPoints, averageRank: career.reduce((sum, season) => sum + season.rank, 0) / Math.max(1, career.length), style: classifyEmergentStyle(manager.currentProfile), strategyProgramHash: strategyProgramHash(manager.currentProfile.strategyProgram!), lineage: manager.lineage}; }
function archiveRow(entry: ReturnType<typeof resultRow>) { return {childId: entry.childId, parentId: entry.parentId, status: entry.status, developmentSeasons: entry.developmentSeasons, titles: entry.titles, totalPoints: entry.totalPoints, averageRank: entry.averageRank, style: entry.style, strategyProgramHash: entry.strategyProgramHash, lineage: entry.lineage}; }
function combinedCareer(manager: DevelopmentManager, entrant: Entrant): SeasonRecord[] { return combineCareer(entrant.priorCareer, manager.seasons); }
function combineCareer(previousCareer: SeasonRecord[], current: SeasonRecord[]): SeasonRecord[] { return [...previousCareer, ...current.map((season, index) => ({...season, season: previousCareer.length + index + 1}))]; }
function writePromotionPackage(promoted: Array<ReturnType<typeof resultRow>>): void {
  const state = read<{managers: DevelopmentManager[]}>(path.join(out, "league", "dynasty-state.json"));
  const payload = {schemaVersion: 1, source: {majorLeague: source, developmentLeague: path.join(out, "league"), birthSeason, developmentSeasons: seasons, cycle}, candidates: promoted.map(entry => { const manager = state.managers.find(value => value.id === entry.slotId)!, entrant = entrants.find(value => value.slotId === entry.slotId)!; return {...entry, currentProfile: manager.currentProfile, lineageHistory: manager.lineageHistory, career: combinedCareer(manager, entrant)}; })};
  const bytes = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8"), archive = path.join(out, "promotion-package.json.gz");
  fs.writeFileSync(archive, zlib.gzipSync(bytes, {level: 9}));
  writeJson(path.join(out, "promotion-package.json"), {schemaVersion: 1, archive: path.basename(archive), sha256: crypto.createHash("sha256").update(bytes).digest("hex"), sourceBytes: bytes.length, compressedBytes: fs.statSync(archive).size, candidates: promoted.length});
}
function rankDeviation(ranks: number[]): number { const average = ranks.reduce((sum, rank) => sum + rank, 0) / Math.max(1, ranks.length); return Math.sqrt(ranks.reduce((sum, rank) => sum + (rank - average) ** 2, 0) / Math.max(1, ranks.length)); }
function applyFinancialLeadership(state: AcademyState, control: AcademyFinancialControl | undefined): AcademyState { if (!control?.leadershipAllocationTarget || control.leadershipInfluence <= 0) return state; const target = control.leadershipAllocationTarget, influence = control.leadershipInfluence, current = state.allocations; return {...state, allocations: {facility: current.facility + (target.facility - current.facility) * influence, scouting: current.scouting + (target.scouting - current.scouting) * influence, patience: current.patience + (target.patience - current.patience) * influence, experimentation: current.experimentation + (target.experimentation - current.experimentation) * influence}}; }
function report(result: ReturnType<typeof evaluateLeague>): string { const rows = [...result.promoted, ...result.retained, ...result.eliminated], marketExecuted = result.talentMarket.transactions.filter(transaction => transaction.status === "executed").length, marketProposed = result.talentMarket.transactions.filter(transaction => transaction.status === "proposed").length, marketRejected = result.talentMarket.transactions.filter(transaction => transaction.status === "rejected").length, renewed = result.contracts.contracts.filter(contract => contract.status === "renewed").length, arbitrated = result.contracts.contracts.filter(contract => contract.status === "arbitrated").length, released = result.contracts.contracts.filter(contract => contract.released).length, healthSummary = (["healthy", "strained", "distressed", "insolvent"] as const).map(status => `${status} ${result.academyFinancialHealth.filter(academy => academy.status === status).length}`).join(", "), controlled = result.academyFinancialControls.filter(control => control.recoveryRequired).length, embargoed = result.academyFinancialControls.filter(control => !control.acquisitionAllowed).length, trusteeships = result.academyFinancialControls.filter(control => control.trusteeship).length; return `# Development league cycle ${result.cycle}\n\n${result.capacity} managers completed ${result.seasons} seasons: ${result.returning} returning, ${result.lifecycleRetired.length} lifecycle retirements, and ${result.births} newborn (${result.developmentParentBirths} from development parents). Talent market ${result.policy.academyMarket.policy}: ${marketExecuted} executed, ${marketProposed} proposed, ${marketRejected} rejected; internal fees ${result.talentMarket.internalFees.toFixed(2)}, signing outflow ${result.talentMarket.signingOutflow.toFixed(2)}, market-prepaid salary ${result.talentMarket.salaryOutflow.toFixed(2)}. Contract ledger: payroll ${result.contracts.payrollOutflow.toFixed(2)}, new arrears ${result.contracts.arrears.toFixed(2)}, ${renewed} renewed, ${arbitrated} arbitrated, ${released} released/defaulted. Salary guarantees: opening debt ${result.salaryGuarantees.openingDebt.toFixed(2)}, repaid ${result.salaryGuarantees.paid.toFixed(2)}, remaining guaranteed debt ${result.salaryDebts.reduce((sum, debt) => sum + debt.amount, 0).toFixed(2)}. Financial health: ${healthSummary}; controls: ${controlled} recovery plans, ${embargoed} acquisition embargoes, ${trusteeships} trusteeships. ${result.academyEvolution.updated} academies learned from ${result.academyEvolution.alumni} prior alumni; grants ${result.academyEconomy.totalGrants.toFixed(2)}, performance revenue ${result.academyEconomy.totalPerformanceRevenue.toFixed(2)}, spend ${result.academyEconomy.totalSpend.toFixed(2)}. Academies developed ${result.academy.developedBirths} new births with average effective influence ${(result.academy.averageEffectiveInfluence * 100).toFixed(1)}%. Founder diversity: ${result.diversity.distinctFounders} founders, maximum ${result.diversity.maximumFounderCount}/${result.policy.maxFounderCount} allowed for new births; ${result.diversity.kinshipExclusions} related and ${result.diversity.similarityExclusions} overly similar mate candidates excluded.\n\n| Child | Origin | Generation | Parent source | Parent | Status | Salary | Contract years | Career seasons | Titles | Points | Average rank | Rights | Style |\n|---|---|---:|---|---|---|---:|---:|---:|---:|---:|---:|---|---|\n${rows.map(entry => `| ${entry.childName} | ${entry.origin} | ${entry.generation} | ${entry.parentSource} | ${entry.parentName} | ${entry.status} | ${entry.annualSalary.toFixed(2)} | ${entry.contractYearsRemaining} | ${entry.developmentSeasons} | ${entry.titles} | ${entry.totalPoints} | ${entry.averageRank.toFixed(2)} | ${entry.rightsStatus} | ${entry.style.label} |`).join("\n")}\n`; }
function prepareOutput(): void { if (!fs.existsSync(out)) { fs.mkdirSync(out, {recursive: true}); return; } if (!args.includes("--force")) throw new Error(`Development output exists: ${out}; pass --force to replace it`); const resolved = path.resolve(out); if (path.parse(resolved).root === resolved || resolved === root || resolved === source || source.startsWith(`${resolved}${path.sep}`)) throw new Error(`Unsafe development output: ${resolved}`); fs.rmSync(resolved, {recursive: true, force: true}); fs.mkdirSync(resolved, {recursive: true}); }
function slot(index: number): string { return `manager-${String(index + 1).padStart(2, "0")}`; }
function unit(seed: string): number { return parseInt(crypto.createHash("sha256").update(seed).digest("hex").slice(0, 13), 16) / 0x10000000000000; }
function average(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function entrantCountFallback(value: number | undefined): number { return value && value > 0 ? (value + 1) / 2 : 1; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function marketPolicy(value: string): AcademyMarketPolicy { if (value !== "shadow" && value !== "active") throw new Error("--academy-market-policy must be shadow or active"); return value; }
function consentPolicy(value: string): ManagerConsentPolicy { if (value !== "enforce" && value !== "ignore") throw new Error("--academy-market-consent-policy must be enforce or ignore"); return value; }
function contractPolicy(value: string): ContractNegotiationPolicy { if (value !== "enforce" && value !== "ignore") throw new Error("--academy-market-contract-policy must be enforce or ignore"); return value; }
function integerOption(name: string, fallback: number, min: number, max: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function writeJson(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
