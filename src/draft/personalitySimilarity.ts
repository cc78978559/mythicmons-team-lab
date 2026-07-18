import type {ManagerProfile} from "./managerProfiles";
import {strategyProgramBehaviorDistance} from "./strategyProgram";

const CONFIGURATION_KEYS = ["speedInvestment", "bulkBias", "statusMoveBias", "coverageBias", "accuracyRisk", "choiceItemBias", "recoveryItemBias"] as const;
const SYSTEM_KEYS = ["weather", "trickRoom", "balance", "offense", "stall", "hazardPressure", "pivotCycle", "setupCore"] as const;
const ORGANIZATION_KEYS = ["scarceConcentration", "backgroundReliance", "continuity", "experimentation", "rebuildPatience"] as const;

export interface PersonalitySimilarityEvidence {similarity: number; parameterDistance: number; roleDistance: number; programDistance: number}

export function personalitySimilarity(left: ManagerProfile, right: ManagerProfile): PersonalitySimilarityEvidence {
  const parameterDistance = meanDistance(parameterVector(left), parameterVector(right));
  const roleDistance = jaccardDistance(new Set(left.preferredRoles), new Set(right.preferredRoles));
  const programDistance = strategyDistance(left, right);
  const distance = parameterDistance * .7 + roleDistance * .1 + programDistance * .2;
  return {similarity: clamp(1 - distance), parameterDistance, roleDistance, programDistance};
}

function parameterVector(profile: ManagerProfile): number[] {
  const traits = profile.traits, economics = profile.economics, learning = profile.learning, tactics = profile.tactics, genome = profile.genome;
  return [
    traits.risk, traits.stars, traits.synergy, traits.counter, traits.value, traits.flexibility,
    economics.starPremium, economics.cashUtility, economics.bidAggression, economics.marketAwareness,
    learning.rate, learning.exploration, learning.memoryDecay,
    tactics.expectedWeight, tactics.downsideWeight, tactics.worstWeight,
    normalizedBias(tactics.aggression), normalizedBias(tactics.setupBias), normalizedBias(tactics.pivotBias), normalizedBias(tactics.recoveryBias), normalizedBias(tactics.statusBias), normalizedBias(tactics.teraBias), normalizedBias(tactics.switchBias),
    ...CONFIGURATION_KEYS.map(key => genome?.configuration[key] ?? .5),
    ...SYSTEM_KEYS.map(key => genome?.systems[key] ?? .5),
    ...ORGANIZATION_KEYS.map(key => genome?.organization[key] ?? .5),
  ].map(clamp);
}

function strategyDistance(left: ManagerProfile, right: ManagerProfile): number {
  return strategyProgramBehaviorDistance(left.strategyProgram, right.strategyProgram);
}

function meanDistance(left: number[], right: number[]): number { const length = Math.max(left.length, right.length); return average(Array.from({length}, (_, index) => Math.abs((left[index] ?? .5) - (right[index] ?? .5)))); }
function jaccardDistance(left: Set<string>, right: Set<string>): number { const union = new Set([...left, ...right]); if (!union.size) return 0; let intersection = 0; for (const value of left) if (right.has(value)) intersection += 1; return 1 - intersection / union.size; }
function normalizedBias(value: number): number { return (value + 1) / 2; }
function average(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function clamp(value: number): number { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : .5)); }
