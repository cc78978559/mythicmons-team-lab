import type {AiTacticalProfile} from "../showdown/choice";
import {cloneStrategyProgram, noviceStrategyProgram, type StrategyProgram} from "./strategyProgram";
import {cloneTacticalMemory, emptyTacticalMemory, type TacticalMemory} from "./tacticalMemory";

export type DraftRole = "hazards" | "removal" | "recovery" | "pivot" | "setup" | "priority" | "screens" | "status" | "physical" | "special";

export interface ManagerTraits {
  risk: number;
  stars: number;
  synergy: number;
  counter: number;
  value: number;
  flexibility: number;
}

export interface StrategyPosterior {
  mean: number;
  confidence: number;
  effectiveSamples: number;
}

export interface ManagerDevelopment {
  seasons: number;
  exploration: number;
  strategies: Record<keyof ManagerTraits, StrategyPosterior>;
  styleHistory: Array<{season: number; label: string; confidence: number}>;
}
export interface ConfigurationMemory {
  moves: Record<string, StrategyPosterior>;
  items: Record<string, StrategyPosterior>;
}

export interface RoleTarget { minimum: number; target: number; weight: number }
export interface ManagerEconomics { starPremium: number; cashUtility: number; bidAggression: number; marketAwareness: number }
export interface ManagerLearning { rate: number; exploration: number; memoryDecay: number }
export interface ManagerConfigurationGenome { speedInvestment: number; bulkBias: number; statusMoveBias: number; coverageBias: number; accuracyRisk: number; choiceItemBias: number; recoveryItemBias: number }
export interface ManagerSystemGenome { weather: number; trickRoom: number; balance: number; offense: number; stall: number; hazardPressure: number; pivotCycle: number; setupCore: number }
export interface ManagerOrganizationGenome { scarceConcentration: number; backgroundReliance: number; continuity: number; experimentation: number; rebuildPatience: number }

export interface ManagerGenome {
  economics: Partial<Record<keyof ManagerEconomics, number>>;
  tactics: Partial<Record<"aggression" | "setupBias" | "pivotBias" | "recoveryBias" | "statusBias" | "teraBias" | "switchBias", number>>;
  roles: Partial<Record<DraftRole, number>>;
  learning: Partial<Record<keyof ManagerLearning, number>>;
  configuration: Partial<Record<keyof ManagerConfigurationGenome, number>>;
  systems: Partial<Record<keyof ManagerSystemGenome, number>>;
  organization: Partial<Record<keyof ManagerOrganizationGenome, number>>;
}

export interface ManagerProfile {
  id: string;
  name: string;
  traits: ManagerTraits;
  preferredRoles: DraftRole[];
  roleTargets: Partial<Record<DraftRole, RoleTarget>>;
  economics: ManagerEconomics;
  tactics: AiTacticalProfile;
  learning: ManagerLearning;
  development: ManagerDevelopment;
  genome?: ManagerGenome;
  configurationMemory?: ConfigurationMemory;
  strategyProgram?: StrategyProgram;
  matchupMemory?: Record<string, MatchupMemory>;
  tacticalMemory?: TacticalMemory;
}

export interface MatchupMemory { series: number; wins: number; losses: number; familyScores: Record<string, number> }

const TRAIT_KEYS = ["risk", "stars", "synergy", "counter", "value", "flexibility"] as const;
const NOVICE_TRAITS: ManagerTraits = {risk: .5, stars: .5, synergy: .5, counter: .5, value: .5, flexibility: .5};

export const DEFAULT_MANAGER_PROFILES: ManagerProfile[] = createNoviceProfiles(10);

export function createNoviceProfiles(count: number): ManagerProfile[] {
  if (!Number.isInteger(count) || count < 1 || count > 30) throw new Error("Manager count must be 1..30");
  return Array.from({length: count}, (_, index) => noviceProfile(index + 1));
}

function noviceProfile(number: number): ManagerProfile {
  const id = `manager-${String(number).padStart(2, "0")}`;
  const strategies = Object.fromEntries(TRAIT_KEYS.map(key => [key, {mean: .5, confidence: 0, effectiveSamples: 2}])) as Record<keyof ManagerTraits, StrategyPosterior>;
  return materializeManagerProfile({
    id,
    name: `经理 ${String(number).padStart(2, "0")}`,
    traits: {...NOVICE_TRAITS},
    preferredRoles: [],
    roleTargets: {},
    economics: {starPremium: .5, cashUtility: .5, bidAggression: .5, marketAwareness: .5},
    tactics: tactical(id, .55, .25, .2),
    learning: {rate: .35, exploration: .8, memoryDecay: .85},
    development: {seasons: 0, exploration: .8, strategies, styleHistory: []},
    genome: emptyGenome(),
    configurationMemory: {moves: {}, items: {}},
    strategyProgram: noviceStrategyProgram(),
    matchupMemory: {},
    tacticalMemory: emptyTacticalMemory(),
  });
}

export function materializeManagerProfile(profile: ManagerProfile): ManagerProfile {
  const t = profile.traits;
  const genome = profile.genome ?? emptyGenome();
  const structuralWeight = .35 + t.synergy * .65;
  const roleTargets: Partial<Record<DraftRole, RoleTarget>> = {
    hazards: {minimum: 0, target: 1, weight: structuralWeight},
    removal: {minimum: 0, target: 1, weight: structuralWeight},
    recovery: {minimum: 0, target: 2, weight: .25 + t.synergy * .65},
    pivot: {minimum: 0, target: 2, weight: .25 + (t.synergy + t.flexibility) * .35},
    setup: {minimum: 0, target: 2, weight: .2 + t.risk * .65},
    priority: {minimum: 0, target: 2, weight: .25 + t.risk * .4},
    screens: {minimum: 0, target: 1, weight: .15 + t.synergy * .35},
    status: {minimum: 0, target: 2, weight: .2 + t.counter * .45},
    physical: {minimum: 1, target: 2, weight: .5},
    special: {minimum: 1, target: 2, weight: .5},
  };
  for (const [role, target] of Object.entries(roleTargets) as Array<[DraftRole, RoleTarget]>) target.weight = clamp(target.weight * (1 + (genome.roles[role] ?? 0)), .05, 2);
  const expectedWeight = .45 + t.risk * .25;
  const worstWeight = .3 - t.risk * .2;
  const downsideWeight = 1 - expectedWeight - worstWeight;
  return {
    ...profile,
    preferredRoles: Object.keys(roleTargets).filter(role => roleTargets[role as DraftRole]!.minimum > 0) as DraftRole[],
    roleTargets,
    economics: {
      starPremium: clamp01(t.stars + (genome.economics.starPremium ?? 0)),
      cashUtility: clamp01(t.value + (genome.economics.cashUtility ?? 0)),
      bidAggression: clamp01((t.risk + t.stars) / 2 + (genome.economics.bidAggression ?? 0)),
      marketAwareness: clamp01((t.counter + t.value) / 2 + (genome.economics.marketAwareness ?? 0)),
    },
    tactics: tactical(profile.id, expectedWeight, downsideWeight, worstWeight, {
      aggression: clampBias(scaleBias(t.risk) + (genome.tactics.aggression ?? 0)),
      setupBias: clampBias(scaleBias(t.risk) * .8 + (genome.tactics.setupBias ?? 0)),
      pivotBias: clampBias(scaleBias((t.synergy + t.flexibility) / 2) * .7 + (genome.tactics.pivotBias ?? 0)),
      recoveryBias: clampBias(-scaleBias(t.risk) * .65 + (genome.tactics.recoveryBias ?? 0)),
      statusBias: clampBias(scaleBias(t.counter) * .55 + (genome.tactics.statusBias ?? 0)),
      teraBias: clampBias(scaleBias(t.risk) * .6 + (genome.tactics.teraBias ?? 0)),
      switchBias: clampBias(scaleBias(t.flexibility) * .55 + (genome.tactics.switchBias ?? 0)),
    }),
    learning: {
      rate: clamp(genome.learning.rate ?? profile.learning.rate, .05, .8),
      exploration: clamp(profile.development.exploration + (genome.learning.exploration ?? 0), .05, .9),
      memoryDecay: clamp(genome.learning.memoryDecay ?? profile.learning.memoryDecay, .5, .99),
    },
    genome,
    configurationMemory: profile.configurationMemory ?? {moves: {}, items: {}},
    strategyProgram: cloneStrategyProgram(profile.strategyProgram),
    tacticalMemory: cloneTacticalMemory(profile.tacticalMemory),
  };
}

export function classifyEmergentStyle(profile: ManagerProfile): {label: string; confidence: number} {
  const t = profile.traits;
  const candidates = [
    {label: "高方差进攻", score: t.risk - .5},
    {label: "稳健控制", score: .5 - t.risk},
    {label: "核心集中", score: (t.stars - t.value) / 2},
    {label: "价值深度", score: (t.value - t.stars) / 2},
    {label: "体系构筑", score: t.synergy - .5},
    {label: "对手针对", score: t.counter - .5},
    {label: "灵活轮换", score: t.flexibility - .5},
    {label: "固定核心", score: .5 - t.flexibility},
  ].sort((a, b) => b.score - a.score);
  const confidence = Math.max(0, Math.min(1, candidates[0].score * 3));
  if (profile.development.seasons < 2 || candidates[0].score < .06) return {label: "未定型", confidence};
  const second = candidates[1].score >= candidates[0].score - .035 && candidates[1].score >= .06 ? `／${candidates[1].label}` : "";
  return {label: `${candidates[0].label}${second}`, confidence};
}

function tactical(id: string, expectedWeight: number, downsideWeight: number, worstWeight: number, biases: Partial<AiTacticalProfile> = {}): AiTacticalProfile {
  return {id, expectedWeight, downsideWeight, worstWeight, aggression: 0, setupBias: 0, pivotBias: 0, recoveryBias: 0, statusBias: 0, teraBias: 0, switchBias: 0, ...biases};
}

function scaleBias(value: number): number { return Math.max(-1, Math.min(1, (value - .5) * 2)); }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }

export function normalizedTraitWeights(traits: ManagerTraits): ManagerTraits {
  const total = Object.values(traits).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  return Object.fromEntries(Object.entries(traits).map(([key, value]) => [key, Math.max(0, value) / total])) as unknown as ManagerTraits;
}

export function roleTargetValue(profile: ManagerProfile, roleCounts: Partial<Record<DraftRole, number>>, candidateRoles: ReadonlySet<DraftRole>, rosterSize: number): number {
  const remainingSlots = Math.max(0, 8 - rosterSize);
  let score = 0;
  let totalWeight = 0;
  for (const [role, target] of Object.entries(profile.roleTargets) as Array<[DraftRole, RoleTarget]>) {
    const count = roleCounts[role] ?? 0;
    totalWeight += target.weight;
    if (candidateRoles.has(role) && count < target.target) score += target.weight * (count < target.minimum ? 1.4 : .7);
    if (!candidateRoles.has(role) && count < target.minimum && remainingSlots <= target.minimum - count) score -= target.weight * 1.6;
  }
  return totalWeight ? score / totalWeight : 0;
}

export function cloneManagerProfile(value: ManagerProfile): ManagerProfile {
  return {
    ...value,
    traits: {...value.traits},
    preferredRoles: [...value.preferredRoles],
    roleTargets: Object.fromEntries(Object.entries(value.roleTargets).map(([role, target]) => [role, {...target}])),
    economics: {...value.economics},
    tactics: {...value.tactics},
    learning: {...value.learning},
    development: {
      ...value.development,
      strategies: Object.fromEntries(Object.entries(value.development.strategies).map(([trait, posterior]) => [trait, {...posterior}])) as Record<keyof ManagerTraits, StrategyPosterior>,
      styleHistory: value.development.styleHistory.map(entry => ({...entry})),
    },
    genome: {
      economics: {...(value.genome?.economics ?? {})},
      tactics: {...(value.genome?.tactics ?? {})},
      roles: {...(value.genome?.roles ?? {})},
      learning: {...(value.genome?.learning ?? {})},
      configuration: {...(value.genome?.configuration ?? {})},
      systems: {...(value.genome?.systems ?? {})},
      organization: {...(value.genome?.organization ?? {})},
    },
    configurationMemory: {
      moves: Object.fromEntries(Object.entries(value.configurationMemory?.moves ?? {}).map(([id, posterior]) => [id, {...posterior}])),
      items: Object.fromEntries(Object.entries(value.configurationMemory?.items ?? {}).map(([id, posterior]) => [id, {...posterior}])),
    },
    strategyProgram: cloneStrategyProgram(value.strategyProgram),
    matchupMemory: value.matchupMemory ? Object.fromEntries(Object.entries(value.matchupMemory).map(([opponent, memory]) => [opponent, {...memory, familyScores: {...memory.familyScores}}])) : {},
    tacticalMemory: cloneTacticalMemory(value.tacticalMemory),
  };
}

export function clampTrait(value: number): number { return Math.max(.1, Math.min(.9, value)); }

export function emptyGenome(): ManagerGenome { return {economics: {}, tactics: {}, roles: {}, learning: {}, configuration: {}, systems: {}, organization: {}}; }
function clampBias(value: number): number { return clamp(value, -1, 1); }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
