import crypto from "node:crypto";
import {cloneManagerProfile, emptyGenome, materializeManagerProfile, type DraftRole, type ManagerConfigurationGenome, type ManagerEconomics, type ManagerOrganizationGenome, type ManagerProfile, type ManagerSystemGenome, type ManagerTraits} from "./managerProfiles";
import {crossoverStrategyPrograms, mutateStrategyProgram} from "./strategyProgram";

export interface LineageIdentity {
  lineageId: string;
  generation: number;
  parentLineageIds: string[];
  founderId: string;
  birthSeason: number;
  niche: string;
  mutations: string[];
}

export interface ObservedBehavior {
  pace: number;
  lineupVariation: number;
  starInvestment: number;
  roleBreadth: number;
  rosterTurnover: number;
  knockoutPressure: number;
  backgroundReliance?: number;
  configurationAggression?: number;
  systemConcentration?: number;
}

export interface EvolutionCompetitor {
  slotId: string;
  profile: ManagerProfile;
  lineage: LineageIdentity;
  points: number;
  rank: number;
  behavior: ObservedBehavior;
  playoffScore?: number;
  champion?: boolean;
}

export interface EvolutionDescendant {
  slotId: string;
  profile: ManagerProfile;
  lineage: LineageIdentity;
  parentSlotId: string;
  secondParentSlotId?: string;
  ecologicalFitness: number;
  protectedCopy: boolean;
}

interface Species {id: string; centroid: number[]; members: EvolutionCompetitor[]}

const TRAITS = ["risk", "stars", "synergy", "counter", "value", "flexibility"] as const;
const ECONOMICS: Array<keyof ManagerEconomics> = ["starPremium", "cashUtility", "bidAggression", "marketAwareness"];
const CONFIGURATION: Array<keyof ManagerConfigurationGenome> = ["speedInvestment", "bulkBias", "statusMoveBias", "coverageBias", "accuracyRisk", "choiceItemBias", "recoveryItemBias"];
const SYSTEMS: Array<keyof ManagerSystemGenome> = ["weather", "trickRoom", "balance", "offense", "stall", "hazardPressure", "pivotCycle", "setupCore"];
const ORGANIZATION: Array<keyof ManagerOrganizationGenome> = ["scarceConcentration", "backgroundReliance", "continuity", "experimentation", "rebuildPatience"];
const TACTICS = ["aggression", "setupBias", "pivotBias", "recoveryBias", "statusBias", "teraBias", "switchBias"] as const;
const ROLES: DraftRole[] = ["hazards", "removal", "recovery", "pivot", "setup", "priority", "screens", "status", "physical", "special"];
const PROGRAM_INPUTS = ["baseline", "strength", "price", "roleBreadth", "typeOverlap", "speed", "bulk", "accuracy", "usage", "production", "teamResult", "opponentPressure", "rosterSize", "tacticalConfidence", "historicalWinRate", "opponentLeadConcentration", "opponentSwitchRate"];

export function founderLineage(managerId: string): LineageIdentity {
  return {lineageId: `founder:${managerId}`, generation: 0, parentLineageIds: [], founderId: managerId, birthSeason: 0, niche: "unobserved", mutations: []};
}

export function clusterBehaviorSpecies(competitors: readonly EvolutionCompetitor[], threshold = .34): Species[] {
  const species: Species[] = [];
  for (const competitor of [...competitors].sort((a, b) => a.slotId.localeCompare(b.slotId))) {
    const vector = behaviorVector(competitor.behavior);
    const closest = species.map(entry => ({entry, distance: euclidean(vector, entry.centroid)})).sort((a, b) => a.distance - b.distance)[0];
    if (!closest || closest.distance > threshold) {
      species.push({id: "", centroid: vector, members: [competitor]});
    } else {
      closest.entry.members.push(competitor);
      closest.entry.centroid = meanVector(closest.entry.members.map(member => behaviorVector(member.behavior)));
    }
  }
  for (const entry of species) entry.id = `species-${digest(entry.centroid.map(value => value.toFixed(2)).join(":" )).slice(0, 8)}`;
  return species;
}

export function evolveManagerPopulation(competitors: readonly EvolutionCompetitor[], season: number, seed: string, historical: readonly EvolutionCompetitor[] = []): EvolutionDescendant[] {
  if (!competitors.length) return [];
  const activeLineages = new Set(competitors.map(entry => entry.lineage.lineageId));
  const population = [...competitors, ...historical.filter(entry => !activeLineages.has(entry.lineage.lineageId))];
  const maxPoints = Math.max(1, ...population.map(entry => entry.points));
  const species = clusterBehaviorSpecies(population);
  const speciesBySlot = new Map(species.flatMap(group => group.members.map(member => [member.slotId, group] as const)));
  const fitness = new Map(population.map(entry => {
    const group = speciesBySlot.get(entry.slotId)!;
    const frequencyProtection = 1 / Math.sqrt(group.members.length);
    const competitive = .2 + .8 * entry.points / maxPoints;
    const rankStability = 1 / Math.sqrt(Math.max(1, entry.rank));
    const postseason = clamp(entry.playoffScore ?? 0, 0, 1);
    return [entry.slotId, competitive * .55 + postseason * .2 + rankStability * .1 + frequencyProtection * .15] as const;
  }));

  const protectedParents = species.map(group => ({
    parent: [...group.members].sort((a, b) => fitness.get(b.slotId)! - fitness.get(a.slotId)! || a.slotId.localeCompare(b.slotId))[0],
    protectedCopy: true,
  }));
  for (const parent of competitors.filter(entry => entry.champion || entry.rank === 1)) if (!protectedParents.some(selection => selection.parent.lineage.lineageId === parent.lineage.lineageId)) protectedParents.push({parent, protectedCopy: true});
  const selections: Array<{parent: EvolutionCompetitor; protectedCopy: boolean}> = protectedParents.sort((a, b) => Number(Boolean(b.parent.champion)) - Number(Boolean(a.parent.champion)) || fitness.get(b.parent.slotId)! - fitness.get(a.parent.slotId)!).slice(0, competitors.length);
  const offspringCap = Math.max(2, Math.ceil(competitors.length * .1));
  const counts = new Map<string, number>();
  for (const selection of selections) counts.set(selection.parent.slotId, 1);
  while (selections.length < competitors.length) {
    const eligible = population.filter(entry => (counts.get(entry.slotId) ?? 0) < offspringCap);
    const parent = weightedPick(eligible.length ? eligible : population, entry => fitness.get(entry.slotId)!, `${seed}:${season}:parent:${selections.length}`);
    selections.push({parent, protectedCopy: false});
    counts.set(parent.slotId, (counts.get(parent.slotId) ?? 0) + 1);
  }

  const slots = [...competitors].sort((a, b) => a.slotId.localeCompare(b.slotId));
  return slots.map((slot, index) => {
    const {parent, protectedCopy} = selections[index];
    const group = speciesBySlot.get(parent.slotId)!;
    const crossover = !protectedCopy && unit(`${seed}:${season}:cross:${slot.slotId}`) < .12;
    const second = crossover ? weightedPick(population.filter(entry => entry.lineage.lineageId !== parent.lineage.lineageId), entry => fitness.get(entry.slotId)!, `${seed}:${season}:mate:${slot.slotId}`) : undefined;
    const child = inheritProfile(parent.profile, second?.profile, slot.profile, `${seed}:${season}:child:${slot.slotId}`);
    const mutations = protectedCopy ? ["protected-elite-copy"] : mutateProfile(child, `${seed}:${season}:mutation:${slot.slotId}`);
    const parentIds = [parent.lineage.lineageId, ...(second ? [second.lineage.lineageId] : [])];
    return {
      slotId: slot.slotId,
      profile: materializeManagerProfile(child),
      lineage: {
        lineageId: `s${season + 1}:${slot.slotId}:${digest(`${parentIds.join("+")}:${mutations.join(",")}`).slice(0, 12)}`,
        generation: Math.max(slot.lineage.generation, parent.lineage.generation, second?.lineage.generation ?? 0) + 1,
        parentLineageIds: parentIds,
        founderId: parent.lineage.founderId,
        birthSeason: season + 1,
        niche: group.id,
        mutations,
      },
      parentSlotId: parent.slotId,
      secondParentSlotId: second?.slotId,
      ecologicalFitness: fitness.get(parent.slotId)!,
      protectedCopy,
    };
  });
}

function inheritProfile(parent: ManagerProfile, second: ManagerProfile | undefined, slot: ManagerProfile, seed: string): ManagerProfile {
  const child = cloneManagerProfile(parent);
  child.id = slot.id;
  child.name = slot.name;
  child.tactics.id = slot.id;
  child.matchupMemory = {...child.matchupMemory, ...cloneManagerProfile(slot).matchupMemory};
  delete child.matchupMemory[slot.id];
  child.development.styleHistory = [...parent.development.styleHistory];
  if (second) {
    for (const trait of TRAITS) if (unit(`${seed}:inherit:${trait}`) < .5) {
      child.traits[trait] = second.traits[trait];
      child.development.strategies[trait] = {...second.development.strategies[trait], confidence: second.development.strategies[trait].confidence * .8};
    }
    const secondGenome = second.genome ?? emptyGenome();
    const genome = child.genome ?? emptyGenome();
    for (const key of ECONOMICS) if (unit(`${seed}:economics:${key}`) < .5 && secondGenome.economics[key] !== undefined) genome.economics[key] = secondGenome.economics[key];
    for (const key of TACTICS) if (unit(`${seed}:tactics:${key}`) < .5 && secondGenome.tactics[key] !== undefined) genome.tactics[key] = secondGenome.tactics[key];
    for (const role of ROLES) if (unit(`${seed}:roles:${role}`) < .5 && secondGenome.roles[role] !== undefined) genome.roles[role] = secondGenome.roles[role];
    for (const key of CONFIGURATION) if (unit(`${seed}:configuration:${key}`) < .5 && secondGenome.configuration[key] !== undefined) genome.configuration[key] = secondGenome.configuration[key];
    for (const key of SYSTEMS) if (unit(`${seed}:systems:${key}`) < .5 && secondGenome.systems[key] !== undefined) genome.systems[key] = secondGenome.systems[key];
    for (const key of ORGANIZATION) if (unit(`${seed}:organization:${key}`) < .5 && secondGenome.organization[key] !== undefined) genome.organization[key] = secondGenome.organization[key];
    child.genome = genome;
    if (/^(1|true|yes)$/i.test(process.env.V4_PROGRAM_EVOLUTION || "false")) child.strategyProgram = crossoverStrategyPrograms(child.strategyProgram, second.strategyProgram, `${seed}:program-crossover`);
  }
  return child;
}

function mutateProfile(profile: ManagerProfile, seed: string): string[] {
  const mutations: string[] = [];
  const genome = profile.genome ?? emptyGenome();
  for (const trait of TRAITS) if (unit(`${seed}:trait-gate:${trait}`) < .22) {
    const delta = signedDelta(`${seed}:trait:${trait}`, .12);
    profile.traits[trait] = clamp(profile.traits[trait] + delta, .1, .9);
    const posterior = profile.development.strategies[trait];
    posterior.mean = clamp(posterior.mean + delta * .65, 0, 1);
    posterior.confidence *= .75;
    posterior.effectiveSamples = Math.max(2, posterior.effectiveSamples * .85);
    mutations.push(`trait.${trait}${signed(delta)}`);
  }
  for (const key of ECONOMICS) if (unit(`${seed}:economics-gate:${key}`) < .12) {
    const delta = signedDelta(`${seed}:economics:${key}`, .1);
    genome.economics[key] = clamp((genome.economics[key] ?? 0) + delta, -.35, .35);
    mutations.push(`economics.${key}${signed(delta)}`);
  }
  for (const key of TACTICS) if (unit(`${seed}:tactics-gate:${key}`) < .1) {
    const delta = signedDelta(`${seed}:tactics:${key}`, .16);
    genome.tactics[key] = clamp((genome.tactics[key] ?? 0) + delta, -.5, .5);
    mutations.push(`tactics.${key}${signed(delta)}`);
  }
  for (const role of ROLES) if (unit(`${seed}:role-gate:${role}`) < .08) {
    const delta = signedDelta(`${seed}:role:${role}`, .2);
    genome.roles[role] = clamp((genome.roles[role] ?? 0) + delta, -.6, .8);
    mutations.push(`role.${role}${signed(delta)}`);
  }
  for (const key of CONFIGURATION) if (unit(`${seed}:configuration-gate:${key}`) < .08) {
    const delta = signedDelta(`${seed}:configuration:${key}`, .18);
    genome.configuration[key] = clamp((genome.configuration[key] ?? 0) + delta, -.7, .7);
    mutations.push(`configuration.${key}${signed(delta)}`);
  }
  for (const key of SYSTEMS) if (unit(`${seed}:systems-gate:${key}`) < .07) {
    const delta = signedDelta(`${seed}:systems:${key}`, .18);
    genome.systems[key] = clamp((genome.systems[key] ?? 0) + delta, -.7, .8);
    mutations.push(`systems.${key}${signed(delta)}`);
  }
  for (const key of ORGANIZATION) if (unit(`${seed}:organization-gate:${key}`) < .08) {
    const delta = signedDelta(`${seed}:organization:${key}`, .15);
    genome.organization[key] = clamp((genome.organization[key] ?? 0) + delta, -.6, .7);
    mutations.push(`organization.${key}${signed(delta)}`);
  }
  if (unit(`${seed}:learning-rate-gate`) < .08) {
    genome.learning.rate = clamp((genome.learning.rate ?? profile.learning.rate) + signedDelta(`${seed}:learning-rate`, .08), .05, .8);
    mutations.push("learning.rate");
  }
  if (unit(`${seed}:memory-gate`) < .08) {
    genome.learning.memoryDecay = clamp((genome.learning.memoryDecay ?? profile.learning.memoryDecay) + signedDelta(`${seed}:memory`, .06), .5, .99);
    mutations.push("learning.memoryDecay");
  }
  if (unit(`${seed}:explore-gate`) < .1) {
    const delta = signedDelta(`${seed}:explore`, .08);
    genome.learning.exploration = clamp((genome.learning.exploration ?? 0) + delta, -.25, .25);
    mutations.push(`learning.exploration${signed(delta)}`);
  }
  profile.genome = genome;
  if (/^(1|true|yes)$/i.test(process.env.V4_PROGRAM_EVOLUTION || "false") && unit(`${seed}:program-gate`) < .7) {
    const evolved = mutateStrategyProgram(profile.strategyProgram, `${seed}:program`, PROGRAM_INPUTS);
    profile.strategyProgram = evolved.program;
    mutations.push(evolved.mutation);
  }
  if (!mutations.length) mutations.push("conservative-copy");
  return mutations;
}

function behaviorVector(value: ObservedBehavior): number[] { return [value.pace, value.lineupVariation, value.starInvestment, value.roleBreadth, value.rosterTurnover, value.knockoutPressure, value.backgroundReliance ?? 0, value.configurationAggression ?? 0, value.systemConcentration ?? 0].map(entry => clamp(entry, 0, 1)); }
function meanVector(values: number[][]): number[] { return values[0].map((_, index) => values.reduce((sum, vector) => sum + vector[index], 0) / values.length); }
function euclidean(left: number[], right: number[]): number { return Math.sqrt(left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0) / left.length); }
function signedDelta(seed: string, scale: number): number { return (unit(seed) * 2 - 1) * scale; }
function signed(value: number): string { return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`; }

function weightedPick<T>(values: readonly T[], weight: (value: T) => number, seed: string): T {
  if (!values.length) throw new Error("Cannot select a parent from an empty population");
  const total = values.reduce((sum, value) => sum + Math.max(.0001, weight(value)), 0);
  let cursor = unit(seed) * total;
  for (const value of values) {
    cursor -= Math.max(.0001, weight(value));
    if (cursor <= 0) return value;
  }
  return values[values.length - 1];
}

function unit(seed: string): number { return Number.parseInt(digest(seed).slice(0, 13), 16) / 0x10000000000000; }
function digest(value: string): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
