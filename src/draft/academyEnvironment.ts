import {cloneManagerProfile, materializeManagerProfile, type ManagerProfile, type ManagerTraits} from "./managerProfiles";
import {personalitySimilarity} from "./personalitySimilarity";
import {strategyProgramHash} from "./strategyProgram";

const TRAITS = ["risk", "stars", "synergy", "counter", "value", "flexibility"] as const;
const ECONOMICS = ["starPremium", "cashUtility", "bidAggression", "marketAwareness"] as const;
const TACTICS = ["aggression", "setupBias", "pivotBias", "recoveryBias", "statusBias", "teraBias", "switchBias"] as const;
const TACTICAL_WEIGHTS = ["expectedWeight", "downsideWeight", "worstWeight"] as const;
const ORGANIZATION = ["scarceConcentration", "backgroundReliance", "continuity", "experimentation", "rebuildPatience"] as const;
const CONFIGURATION = ["speedInvestment", "bulkBias", "statusMoveBias", "coverageBias", "accuracyRisk", "choiceItemBias", "recoveryItemBias"] as const;
const SYSTEMS = ["weather", "trickRoom", "balance", "offense", "stall", "hazardPressure", "pivotCycle", "setupCore"] as const;

export interface AcademyEnvironment {
  academyId: string;
  academyName: string;
  quality: number;
  patience: number;
  experimentation: number;
  tradition: ManagerProfile;
}

export interface AcademyDevelopmentEvidence {
  academyId: string;
  academyName: string;
  quality: number;
  patience: number;
  experimentation: number;
  configuredInfluence: number;
  effectiveInfluence: number;
  similarityBefore: number;
  similarityAfter: number;
  traitDeltas: ManagerTraits;
  parameterDeltas: Record<string, number>;
  strategyProgramUnchanged: boolean;
}

export interface AcademyAlumnus {childId: string; status: "promoted" | "retained" | "eliminated"; averageRank: number; capacity: number; profile: ManagerProfile}
export interface AcademyAllocations {facility: number; scouting: number; patience: number; experimentation: number}
export interface AcademyEconomyInput {grant: number; maximumSpend: number; performanceRevenueRate: number}
export interface AcademyEvolutionEvidence {cycle: number; alumni: number; promoted: number; retained: number; eliminated: number; performance: number; averageCulturalDistance: number; configuredRate: number; qualityBefore: number; qualityAfter: number; scoutingBefore: number; scoutingAfter: number; patienceBefore: number; patienceAfter: number; experimentationBefore: number; experimentationAfter: number; budgetBefore: number; grant: number; performanceRevenue: number; spend: number; spending: AcademyAllocations; budgetAfter: number; allocationsBefore: AcademyAllocations; allocationsAfter: AcademyAllocations; cultureModelChildId?: string}
export interface AcademyState {academyId: string; academyName: string; revision: number; quality: number; scouting: number; patience: number; experimentation: number; treasury: number; allocations: AcademyAllocations; tradition: ManagerProfile; latestEvidence?: AcademyEvolutionEvidence}

export function buildAcademyEnvironment(academyId: string, academyName: string, tradition: ManagerProfile): AcademyEnvironment {
  const organization = tradition.genome?.organization ?? {};
  const quality = average([tradition.traits.synergy, tradition.traits.value, tradition.traits.flexibility, tradition.economics.marketAwareness, tradition.learning.rate / .8]);
  const patience = average([tradition.traits.value, tradition.learning.memoryDecay, organization.continuity ?? .5, organization.rebuildPatience ?? .5]);
  const experimentation = average([tradition.traits.risk, tradition.traits.flexibility, tradition.learning.exploration, organization.experimentation ?? .5]);
  return {academyId, academyName, quality: clamp01(quality), patience: clamp01(patience), experimentation: clamp01(experimentation), tradition: cloneManagerProfile(tradition)};
}

export function createAcademyState(academyId: string, academyName: string, tradition: ManagerProfile, initialBudget = 30): AcademyState {
  const environment = buildAcademyEnvironment(academyId, academyName, tradition);
  const scouting = average([tradition.traits.counter, tradition.traits.flexibility, tradition.economics.marketAwareness]), allocations = desiredAllocations(tradition, 0, 0);
  return {academyId, academyName, revision: 0, quality: environment.quality, scouting: clamp01(scouting), patience: environment.patience, experimentation: environment.experimentation, treasury: Math.max(0, initialBudget), allocations, tradition: compactTradition(tradition)};
}

export function academyEnvironmentFromState(state: AcademyState): AcademyEnvironment { return {academyId: state.academyId, academyName: state.academyName, quality: state.quality, patience: state.patience, experimentation: state.experimentation, tradition: cloneManagerProfile(state.tradition)}; }

export function academyAlumniPerformance(state: AcademyState, alumni: readonly AcademyAlumnus[]): number { return average(alumni.map(alumnus => alumnusScore(alumnus))); }

export function evolveAcademyState(state: AcademyState, alumni: readonly AcademyAlumnus[], cycle: number, configuredRate: number, economy: AcademyEconomyInput = {grant: 0, maximumSpend: 30, performanceRevenueRate: 0}): AcademyState {
  const rate = clamp(configuredRate, 0, .5), scored = alumni.map(alumnus => ({alumnus, score: alumnusScore(alumnus), distance: 1 - personalitySimilarity(alumnus.profile, state.tradition).similarity}));
  const performance = average(scored.map(entry => entry.score)), averageCulturalDistance = average(scored.map(entry => entry.distance));
  const retentionSignal = average(alumni.map(alumnus => alumnus.status === "retained" ? .5 : alumnus.status === "promoted" ? .2 : -1));
  const experimentationSignal = performance * averageCulturalDistance;
  const treasury = Math.max(0, state.treasury ?? 0), allocationsBefore = state.allocations ?? desiredAllocations(state.tradition, 0, 0), desired = desiredAllocations(state.tradition, performance, averageCulturalDistance), allocations = blendAllocations(allocationsBefore, desired, rate);
  const grant = Math.max(0, economy.grant), performanceRevenue = Math.max(0, performance) * Math.max(0, economy.performanceRevenueRate), available = treasury + grant + performanceRevenue, spend = alumni.length ? Math.min(available, Math.max(0, economy.maximumSpend)) : 0;
  const resourceScale = economy.maximumSpend > 0 ? spend / economy.maximumSpend : 0, spending = scaleAllocations(allocations, spend);
  const quality = clamp01(state.quality + performance * rate * .2 * resourceScale * (.5 + allocations.facility * 2));
  const scouting = clamp01((state.scouting ?? .5) + performance * rate * .12 * resourceScale * (.5 + allocations.scouting * 2));
  const patience = clamp01(state.patience + retentionSignal * rate * .1 * resourceScale * (.5 + allocations.patience * 2));
  const experimentation = clamp01(state.experimentation + experimentationSignal * rate * .15 * resourceScale * (.5 + allocations.experimentation * 2));
  const model = [...scored].sort((a, b) => b.score - a.score || a.alumnus.childId.localeCompare(b.alumnus.childId))[0];
  let tradition = cloneManagerProfile(state.tradition);
  if (model && model.score > 0 && rate > 0 && resourceScale > 0) tradition = applyAcademyDevelopment(tradition, buildAcademyEnvironment(state.academyId, state.academyName, model.alumnus.profile), rate * model.score * .25 * resourceScale * (.5 + allocations.experimentation * 2)).profile;
  const latestEvidence: AcademyEvolutionEvidence = {cycle, alumni: alumni.length, promoted: alumni.filter(entry => entry.status === "promoted").length, retained: alumni.filter(entry => entry.status === "retained").length, eliminated: alumni.filter(entry => entry.status === "eliminated").length, performance, averageCulturalDistance, configuredRate: rate, qualityBefore: state.quality, qualityAfter: quality, scoutingBefore: state.scouting ?? .5, scoutingAfter: scouting, patienceBefore: state.patience, patienceAfter: patience, experimentationBefore: state.experimentation, experimentationAfter: experimentation, budgetBefore: treasury, grant, performanceRevenue, spend, spending, budgetAfter: available - spend, allocationsBefore, allocationsAfter: allocations, cultureModelChildId: model?.score && model.score > 0 && resourceScale > 0 ? model.alumnus.childId : undefined};
  return {...state, revision: state.revision + (alumni.length ? 1 : 0), quality, scouting, patience, experimentation, treasury: available - spend, allocations, tradition: compactTradition(tradition), latestEvidence};
}

export function applyAcademyDevelopment(profile: ManagerProfile, academy: AcademyEnvironment, configuredInfluence: number): {profile: ManagerProfile; evidence: AcademyDevelopmentEvidence} {
  const before = cloneManagerProfile(profile), next = cloneManagerProfile(profile), effectiveInfluence = clamp01(configuredInfluence) * (.75 + academy.quality * .5);
  for (const key of TRAITS) next.traits[key] = clamp(next.traits[key] + (academy.tradition.traits[key] - next.traits[key]) * effectiveInfluence, .1, .9);
  const genome = next.genome!;
  for (const key of TACTICS) genome.tactics[key] = blend(genome.tactics[key] ?? 0, academy.tradition.genome?.tactics[key] ?? 0, effectiveInfluence * .6);
  for (const key of ORGANIZATION) genome.organization[key] = blend(genome.organization[key] ?? .5, academy.tradition.genome?.organization[key] ?? .5, effectiveInfluence);
  for (const key of CONFIGURATION) genome.configuration[key] = blend(genome.configuration[key] ?? .5, academy.tradition.genome?.configuration[key] ?? .5, effectiveInfluence * .35);
  for (const key of SYSTEMS) genome.systems[key] = blend(genome.systems[key] ?? .5, academy.tradition.genome?.systems[key] ?? .5, effectiveInfluence * .35);
  genome.learning.rate = blend(next.learning.rate, academy.tradition.learning.rate, effectiveInfluence * .5);
  genome.learning.memoryDecay = blend(next.learning.memoryDecay, academy.tradition.learning.memoryDecay, effectiveInfluence * .5);
  genome.learning.exploration = blend(genome.learning.exploration ?? 0, academy.tradition.genome?.learning.exploration ?? 0, effectiveInfluence * (.5 + academy.experimentation * .5));
  genome.organization.rebuildPatience = blend(genome.organization.rebuildPatience ?? .5, academy.patience, effectiveInfluence);
  const developed = materializeManagerProfile(next), beforeSimilarity = personalitySimilarity(before, academy.tradition).similarity, afterSimilarity = personalitySimilarity(developed, academy.tradition).similarity;
  const traitDeltas = Object.fromEntries(TRAITS.map(key => [key, developed.traits[key] - before.traits[key]])) as unknown as ManagerTraits;
  const beforeParameters = auditableParameters(before), afterParameters = auditableParameters(developed), parameterDeltas = Object.fromEntries(Object.keys(beforeParameters).map(key => [key, afterParameters[key] - beforeParameters[key]]));
  return {profile: developed, evidence: {academyId: academy.academyId, academyName: academy.academyName, quality: academy.quality, patience: academy.patience, experimentation: academy.experimentation, configuredInfluence: clamp01(configuredInfluence), effectiveInfluence, similarityBefore: beforeSimilarity, similarityAfter: afterSimilarity, traitDeltas, parameterDeltas, strategyProgramUnchanged: strategyProgramHash(before.strategyProgram!) === strategyProgramHash(developed.strategyProgram!)}};
}

function auditableParameters(profile: ManagerProfile): Record<string, number> {
  return Object.fromEntries([
    ...TRAITS.map(key => [`traits.${key}`, profile.traits[key]] as const),
    ...ECONOMICS.map(key => [`economics.${key}`, profile.economics[key]] as const),
    ...TACTICAL_WEIGHTS.map(key => [`tactics.${key}`, profile.tactics[key]] as const),
    ...TACTICS.map(key => [`tactics.${key}`, profile.tactics[key]] as const),
    ...ORGANIZATION.map(key => [`organization.${key}`, profile.genome?.organization[key] ?? .5] as const),
    ...CONFIGURATION.map(key => [`configuration.${key}`, profile.genome?.configuration[key] ?? .5] as const),
    ...SYSTEMS.map(key => [`systems.${key}`, profile.genome?.systems[key] ?? .5] as const),
    ["learning.rate", profile.learning.rate] as const, ["learning.exploration", profile.learning.exploration] as const, ["learning.memoryDecay", profile.learning.memoryDecay] as const,
  ]);
}

function compactTradition(profile: ManagerProfile): ManagerProfile { const copy = cloneManagerProfile(profile); copy.matchupMemory = {}; copy.configurationMemory = {moves: {}, items: {}}; copy.tacticalMemory = undefined; copy.development.styleHistory = []; return copy; }
function alumnusScore(alumnus: AcademyAlumnus): number { const rankScore = alumnus.capacity <= 1 ? 0 : 1 - 2 * (alumnus.averageRank - 1) / (alumnus.capacity - 1), statusScore = alumnus.status === "promoted" ? 1 : alumnus.status === "eliminated" ? -1 : 0; return clamp(statusScore * .65 + rankScore * .35, -1, 1); }
function desiredAllocations(profile: ManagerProfile, performance: number, culturalDistance: number): AcademyAllocations { return normalizeAllocations({facility: .2 + profile.traits.synergy + Math.max(0, -performance) * .5, scouting: .2 + profile.traits.counter + profile.traits.flexibility * .5, patience: .2 + profile.traits.value + (profile.genome?.organization.rebuildPatience ?? .5), experimentation: .2 + profile.traits.risk + culturalDistance}); }
function normalizeAllocations(value: AcademyAllocations): AcademyAllocations { const total = Object.values(value).reduce((sum, entry) => sum + Math.max(0, entry), 0) || 1; return {facility: Math.max(0, value.facility) / total, scouting: Math.max(0, value.scouting) / total, patience: Math.max(0, value.patience) / total, experimentation: Math.max(0, value.experimentation) / total}; }
function blendAllocations(current: AcademyAllocations, target: AcademyAllocations, rate: number): AcademyAllocations { return normalizeAllocations({facility: blend(current.facility, target.facility, rate), scouting: blend(current.scouting, target.scouting, rate), patience: blend(current.patience, target.patience, rate), experimentation: blend(current.experimentation, target.experimentation, rate)}); }
function scaleAllocations(value: AcademyAllocations, total: number): AcademyAllocations { return {facility: value.facility * total, scouting: value.scouting * total, patience: value.patience * total, experimentation: value.experimentation * total}; }

function blend(current: number, target: number, influence: number): number { return current + (target - current) * clamp01(influence); }
function average(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function clamp01(value: number): number { return clamp(value, 0, 1); }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, Number.isFinite(value) ? value : (min + max) / 2)); }
