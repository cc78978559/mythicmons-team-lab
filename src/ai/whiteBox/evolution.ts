import crypto from "node:crypto";
import {cloneManagerProfile, emptyGenome, type DraftRole, type ManagerProfile, type ManagerTraits} from "../../draft/managerProfiles";
import {mutateStrategyProgram, strategyProgramHash} from "../../draft/strategyProgram";
import {EVOLUTION_SHADOW_PARAMETERS} from "./parameters";

export const WHITE_BOX_EVOLUTION_VERSION = "white-box-evolution-v1";

const TRAITS = ["risk", "stars", "synergy", "counter", "value", "flexibility"] as const;
const ECONOMICS = ["starPremium", "cashUtility", "bidAggression", "marketAwareness"] as const;
const TACTICS = ["aggression", "setupBias", "pivotBias", "recoveryBias", "statusBias", "teraBias", "switchBias"] as const;
const ROLES: DraftRole[] = ["hazards", "removal", "recovery", "pivot", "setup", "priority", "screens", "status", "physical", "special"];
const CONFIGURATION = ["speedInvestment", "bulkBias", "statusMoveBias", "coverageBias", "accuracyRisk", "choiceItemBias", "recoveryItemBias"] as const;
const SYSTEMS = ["weather", "trickRoom", "balance", "offense", "stall", "hazardPressure", "pivotCycle", "setupCore"] as const;
const ORGANIZATION = ["scarceConcentration", "backgroundReliance", "continuity", "experimentation", "rebuildPatience"] as const;
const PROGRAM_INPUTS = ["baseline", "strength", "price", "roleBreadth", "typeOverlap", "speed", "bulk", "accuracy", "usage", "production", "teamResult", "opponentPressure", "rosterSize", "tacticalConfidence", "historicalWinRate", "opponentLeadConcentration", "opponentSwitchRate"];

export interface WhiteBoxEvolutionChange {path: string; before: number | null; rawAfter: number | null; after: number | null; delta: number | null; clipped: boolean}
export interface WhiteBoxEvolutionGate {path: string; draw: number; threshold: number; triggered: boolean}

export interface WhiteBoxEvolutionTrace {
  version: typeof WHITE_BOX_EVOLUTION_VERSION;
  eventId: string;
  parameters: Record<string, number>;
  selection: {previousLineageId: string; parentLineageId: string; secondParentLineageId: string | null; protectedCopy: boolean; ecologicalFitness: number; replacementReason: string};
  crossover: {draw: number; threshold: number; triggered: boolean};
  inheritanceChanges: WhiteBoxEvolutionChange[];
  mutation: {gates: WhiteBoxEvolutionGate[]; changes: WhiteBoxEvolutionChange[]; declared: string[]; programBefore: string; programAfter: string};
}

export function evolutionUnit(seed: string): number {
  return Number.parseInt(crypto.createHash("sha256").update(seed).digest("hex").slice(0, 13), 16) / 0x10000000000000;
}

export function buildWhiteBoxEvolutionTrace(input: {
  eventId: string;
  previousLineageId: string;
  parentLineageId: string;
  secondParentLineageId?: string;
  protectedCopy: boolean;
  ecologicalFitness: number;
  crossoverSeed: string;
  mutationSeed: string;
  primaryParent: ManagerProfile;
  inherited: ManagerProfile;
  mutated: ManagerProfile;
  declaredMutations: string[];
  programEvolution: boolean;
}): WhiteBoxEvolutionTrace {
  const parameters = EVOLUTION_SHADOW_PARAMETERS.snapshot().values;
  const crossoverDraw = evolutionUnit(input.crossoverSeed);
  const replay = replayMutation(input.inherited, input.mutationSeed, input.programEvolution, input.protectedCopy, parameters);
  const actualSnapshot = parameterSnapshot(input.mutated);
  const replaySnapshot = parameterSnapshot(replay.profile);
  if (JSON.stringify(actualSnapshot) !== JSON.stringify(replaySnapshot) || strategyProgramHash(input.mutated.strategyProgram!) !== strategyProgramHash(replay.profile.strategyProgram!) || JSON.stringify(input.declaredMutations) !== JSON.stringify(replay.declared)) {
    throw new Error(`White-box evolution replay drifted for ${input.eventId}`);
  }
  return {
    version: WHITE_BOX_EVOLUTION_VERSION,
    eventId: input.eventId,
    parameters,
    selection: {
      previousLineageId: input.previousLineageId,
      parentLineageId: input.parentLineageId,
      secondParentLineageId: input.secondParentLineageId ?? null,
      protectedCopy: input.protectedCopy,
      ecologicalFitness: input.ecologicalFitness,
      replacementReason: input.protectedCopy ? "species-elite-or-champion-protection" : "fitness-weighted-offspring-selection",
    },
    crossover: {draw: crossoverDraw, threshold: parameters["evolution.crossoverrate"], triggered: !input.protectedCopy && crossoverDraw < parameters["evolution.crossoverrate"]},
    inheritanceChanges: diffSnapshots(parameterSnapshot(input.primaryParent), parameterSnapshot(input.inherited)),
    mutation: {gates: replay.gates, changes: diffSnapshots(parameterSnapshot(input.inherited), actualSnapshot, replay.rawValues), declared: [...input.declaredMutations], programBefore: strategyProgramHash(input.inherited.strategyProgram!), programAfter: strategyProgramHash(input.mutated.strategyProgram!)},
  };
}

function replayMutation(source: ManagerProfile, seed: string, programEvolution: boolean, protectedCopy: boolean, p: Record<string, number>) {
  const profile = cloneManagerProfile(source), gates: WhiteBoxEvolutionGate[] = [], rawValues: Record<string, number> = {}, declared: string[] = [];
  if (protectedCopy) return {profile, gates, rawValues, declared: ["protected-elite-copy"]};
  const genome = profile.genome ?? emptyGenome();
  for (const trait of TRAITS) gate(`trait.${trait}`, `${seed}:trait-gate:${trait}`, p["evolution.traitrate"], () => {
    const delta = signedDelta(`${seed}:trait:${trait}`, p["evolution.traitscale"]), path = `traits.${trait}`, raw = profile.traits[trait] + delta;
    rawValues[path] = raw; profile.traits[trait] = clamp(raw, .1, .9);
    const posterior = profile.development.strategies[trait];
    const rawMean = posterior.mean + delta * .65, rawSamples = posterior.effectiveSamples * .85;
    rawValues[`posterior.${trait}.mean`] = rawMean; rawValues[`posterior.${trait}.effectiveSamples`] = rawSamples;
    posterior.mean = clamp(rawMean, 0, 1); posterior.confidence *= .75; posterior.effectiveSamples = Math.max(2, rawSamples);
    declared.push(`trait.${trait}${signed(delta)}`);
  });
  for (const key of ECONOMICS) gene(`economics.${key}`, `${seed}:economics-gate:${key}`, `${seed}:economics:${key}`, p["evolution.economicsrate"], p["evolution.economicsscale"], -.35, .35, genome.economics, key);
  for (const key of TACTICS) gene(`tactics.${key}`, `${seed}:tactics-gate:${key}`, `${seed}:tactics:${key}`, p["evolution.tacticsrate"], p["evolution.tacticsscale"], -.5, .5, genome.tactics, key);
  for (const key of ROLES) gene(`roles.${key}`, `${seed}:role-gate:${key}`, `${seed}:role:${key}`, p["evolution.rolerate"], p["evolution.rolescale"], -.6, .8, genome.roles, key, `role.${key}`);
  for (const key of CONFIGURATION) gene(`configuration.${key}`, `${seed}:configuration-gate:${key}`, `${seed}:configuration:${key}`, p["evolution.configurationrate"], p["evolution.configurationscale"], -.7, .7, genome.configuration, key);
  for (const key of SYSTEMS) gene(`systems.${key}`, `${seed}:systems-gate:${key}`, `${seed}:systems:${key}`, p["evolution.systemsrate"], p["evolution.systemsscale"], -.7, .8, genome.systems, key);
  for (const key of ORGANIZATION) gene(`organization.${key}`, `${seed}:organization-gate:${key}`, `${seed}:organization:${key}`, p["evolution.organizationrate"], p["evolution.organizationscale"], -.6, .7, genome.organization, key);
  gate("learning.rate", `${seed}:learning-rate-gate`, p["evolution.learningrate"], () => {const raw=(genome.learning.rate ?? profile.learning.rate)+signedDelta(`${seed}:learning-rate`,.08);rawValues["genome.learning.rate"]=raw;genome.learning.rate=clamp(raw,.05,.8);declared.push("learning.rate");});
  gate("learning.memoryDecay", `${seed}:memory-gate`, p["evolution.learningrate"], () => {const raw=(genome.learning.memoryDecay ?? profile.learning.memoryDecay)+signedDelta(`${seed}:memory`,.06);rawValues["genome.learning.memoryDecay"]=raw;genome.learning.memoryDecay=clamp(raw,.5,.99);declared.push("learning.memoryDecay");});
  gate("learning.exploration", `${seed}:explore-gate`, p["evolution.explorationrate"], () => {const delta=signedDelta(`${seed}:explore`,.08),raw=(genome.learning.exploration??0)+delta;rawValues["genome.learning.exploration"]=raw;genome.learning.exploration=clamp(raw,-.25,.25);declared.push(`learning.exploration${signed(delta)}`);});
  profile.genome = genome;
  if (programEvolution) gate("strategyProgram", `${seed}:program-gate`, p["evolution.programrate"], () => {const evolved=mutateStrategyProgram(profile.strategyProgram!,`${seed}:program`,PROGRAM_INPUTS);profile.strategyProgram=evolved.program;declared.push(evolved.mutation);});
  if (!declared.length) declared.push("conservative-copy");
  return {profile, gates, rawValues, declared};

  function gate(path: string, gateSeed: string, threshold: number, apply: () => void): void {const draw=evolutionUnit(gateSeed),triggered=draw<threshold;gates.push({path,draw,threshold,triggered});if(triggered)apply();}
  function gene(path: string, gateSeed: string, deltaSeed: string, rate: number, scale: number, min: number, max: number, target: Record<string, number | undefined>, key: string, declaredPath = path): void {gate(path,gateSeed,rate,()=>{const delta=signedDelta(deltaSeed,scale),full=`genome.${path}`,raw=(target[key]??0)+delta;rawValues[full]=raw;target[key]=clamp(raw,min,max);declared.push(`${declaredPath}${signed(delta)}`);});}
}

function parameterSnapshot(profile: ManagerProfile): Record<string, number> {
  const values: Record<string, number> = {};
  for (const trait of TRAITS) {values[`traits.${trait}`]=profile.traits[trait];const posterior=profile.development.strategies[trait];values[`posterior.${trait}.mean`]=posterior.mean;values[`posterior.${trait}.confidence`]=posterior.confidence;values[`posterior.${trait}.effectiveSamples`]=posterior.effectiveSamples;}
  const genome=profile.genome??emptyGenome();
  for(const [group,record] of Object.entries(genome)) for(const [key,value] of Object.entries(record)) if(typeof value==="number") values[`genome.${group}.${key}`]=value;
  return Object.fromEntries(Object.entries(values).sort(([a],[b])=>a.localeCompare(b)));
}

function diffSnapshots(before: Record<string, number>, after: Record<string, number>, rawValues: Record<string, number> = {}): WhiteBoxEvolutionChange[] {
  return [...new Set([...Object.keys(before),...Object.keys(after),...Object.keys(rawValues)])].sort().filter(path=>before[path]!==after[path]||(rawValues[path]!==undefined&&rawValues[path]!==after[path])).map(path=>{const left=before[path]??null,right=after[path]??null,raw=rawValues[path]??right;return {path,before:left,rawAfter:raw,after:right,delta:left===null||right===null?null:right-left,clipped:raw!==right};});
}

function signedDelta(seed:string,scale:number):number{return(evolutionUnit(seed)*2-1)*scale;}
function signed(value:number):string{return`${value>=0?"+":""}${value.toFixed(3)}`;}
function clamp(value:number,min:number,max:number):number{return Math.max(min,Math.min(max,value));}
