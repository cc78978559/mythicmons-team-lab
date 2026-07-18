import crypto from "node:crypto";
import {evolveManagerPopulation, type EvolutionCompetitor, type EvolutionDescendant} from "./naturalEvolution";
import {countProgramNodes, strategyProgramBehavior, strategyProgramHash} from "./strategyProgram";
import {strategyProgramOpportunityDistance, type ManagerProgramOpportunities, type ProgramOpportunityDistance} from "./strategyProgramOpportunity";

export type EvolutionPhase = "stable" | "pressure" | "burst" | "consolidating";

export interface ManagerEvolutionState {
  managerId: string;
  phase: EvolutionPhase;
  pressure: number;
  pressureReservoir: number;
  stableSeasons: number;
  lastBurstSeason: number | null;
  cooldownUntilSeason: number;
  burstCount: number;
  lastTriggerReasons: string[];
}

export interface PunctuatedEvolutionConfig {
  triggerThreshold: number;
  warningThreshold: number;
  minimumStableSeasons: number;
  cooldownSeasons: number;
  maxBurstManagers: number;
  environmentalShock: number;
  minimumCandidates: number;
  maximumCandidates: number;
}

export interface EvolutionCandidateSummary {
  lineageId: string;
  parentSlotId: string;
  secondParentSlotId?: string;
  mutations: string[];
  ecologicalFitness: number;
  programHash: string;
  programNodes: number;
  programBehaviorHash: string;
  programBehaviorDistance: number;
  programOpportunity: ProgramOpportunityDistance;
  programSelected: boolean;
  score: number;
  selected: boolean;
}

export interface ManagerEvolutionDecision {
  managerId: string;
  before: ManagerEvolutionState;
  after: ManagerEvolutionState;
  instantaneousPressure: number;
  triggerScore: number;
  eligible: boolean;
  selected: boolean;
  reasons: string[];
  candidates: EvolutionCandidateSummary[];
}

export interface PunctuatedEvolutionResult {
  schemaVersion: 1;
  mode: "punctuated";
  season: number;
  budget: {
    globalPressure: number;
    environmentalShock: number;
    burstSlots: number;
    candidateCount: number;
    cheapEvaluations: number;
    retainedDescendants: number;
    retainedProgramCandidates: number;
  };
  state: Record<string, ManagerEvolutionState>;
  decisions: ManagerEvolutionDecision[];
  descendants: EvolutionDescendant[];
  programDescendants: EvolutionDescendant[];
}

export const DEFAULT_PUNCTUATED_EVOLUTION_CONFIG: PunctuatedEvolutionConfig = {
  triggerThreshold: .58,
  warningThreshold: .42,
  minimumStableSeasons: 2,
  cooldownSeasons: 3,
  maxBurstManagers: 2,
  environmentalShock: 0,
  minimumCandidates: 4,
  maximumCandidates: 8,
};

export function runPunctuatedEvolution(input: {
  competitors: readonly EvolutionCompetitor[];
  season: number;
  seed: string;
  historical?: readonly EvolutionCompetitor[];
  previousState?: Readonly<Record<string, ManagerEvolutionState>>;
  programOpportunities?: Readonly<Record<string, ManagerProgramOpportunities>>;
  config?: Partial<PunctuatedEvolutionConfig>;
}): PunctuatedEvolutionResult {
  const config = normalizeConfig(input.config);
  const competitors = [...input.competitors].sort((a, b) => a.slotId.localeCompare(b.slotId));
  const globalPressure = mean(competitors.map(entry => instantaneousPressure(entry, competitors.length)));
  const provisional = competitors.map(competitor => assessManager(competitor, competitors.length, input.season, input.previousState?.[competitor.slotId], config));
  const eligible = provisional.filter(entry => entry.eligible).sort((a, b) => b.triggerScore - a.triggerScore || seededOrder(input.seed, input.season, a.managerId) - seededOrder(input.seed, input.season, b.managerId));
  const severity = Math.max(config.environmentalShock, clamp01((globalPressure - config.warningThreshold) / Math.max(.01, 1 - config.warningThreshold) + config.environmentalShock * .75));
  const desiredSlots = eligible.length ? Math.max(1, Math.ceil(severity * config.maxBurstManagers)) : 0;
  const burstSlots = Math.min(config.maxBurstManagers, desiredSlots, eligible.length);
  const selectedIds = eligible.slice(0, burstSlots).map(entry => entry.managerId);
  const selected = new Set(selectedIds);
  const candidateCount = burstSlots ? Math.round(config.minimumCandidates + (config.maximumCandidates - config.minimumCandidates) * severity) : 0;
  const candidatesByManager = new Map<string, EvolutionDescendant[]>();

  for (let index = 0; index < candidateCount; index += 1) {
    const descendants = evolveManagerPopulation(competitors, input.season, `${input.seed}:burst-candidate:${index}`, input.historical ?? [], {targetSlotIds: selectedIds, protectedCopies: false, programOpportunities: Object.fromEntries(selectedIds.map(managerId => [managerId, input.programOpportunities?.[managerId]?.entrypoints ?? {}]))});
    for (const descendant of descendants) candidatesByManager.set(descendant.slotId, [...(candidatesByManager.get(descendant.slotId) ?? []), descendant]);
  }

  const winners: EvolutionDescendant[] = [], programWinners: EvolutionDescendant[] = [];
  const decisions = provisional.map(decision => {
    const isSelected = selected.has(decision.managerId);
    const incumbent = competitors.find(entry => entry.slotId === decision.managerId)!;
    const candidates = (candidatesByManager.get(decision.managerId) ?? []).map(descendant => ({descendant, score: candidateScore(descendant), programOpportunity: strategyProgramOpportunityDistance(incumbent.profile.strategyProgram, descendant.profile.strategyProgram, input.programOpportunities?.[decision.managerId])})).sort((a, b) => b.score - a.score || a.descendant.lineage.lineageId.localeCompare(b.descendant.lineage.lineageId));
    const programCandidate = [...candidates].filter(candidate => candidate.programOpportunity.choicePotential > 0 && strategyProgramHash(candidate.descendant.profile.strategyProgram!) !== strategyProgramHash(incumbent.profile.strategyProgram!)).sort((left, right) => programCandidateScore(right) - programCandidateScore(left) || left.descendant.lineage.lineageId.localeCompare(right.descendant.lineage.lineageId))[0];
    if (isSelected && candidates[0]) winners.push(candidates[0].descendant);
    if (isSelected && programCandidate) programWinners.push(programCandidate.descendant);
    const reasons = isSelected ? [...decision.reasons, `dynamic-budget-selected:${burstSlots}`] : decision.reasons;
    const after: ManagerEvolutionState = isSelected
      ? {...decision.after, phase: "burst", pressureReservoir: 0, stableSeasons: 0, lastBurstSeason: input.season, cooldownUntilSeason: input.season + config.cooldownSeasons, burstCount: decision.after.burstCount + 1, lastTriggerReasons: reasons}
      : decision.after;
    return {
      ...decision,
      after,
      selected: isSelected,
      reasons,
      candidates: candidates.map((candidate, index) => {
        const behavior = strategyProgramBehavior(candidate.descendant.profile.strategyProgram);
        return {
          lineageId: candidate.descendant.lineage.lineageId,
          parentSlotId: candidate.descendant.parentSlotId,
          secondParentSlotId: candidate.descendant.secondParentSlotId,
          mutations: candidate.descendant.lineage.mutations,
          ecologicalFitness: candidate.descendant.ecologicalFitness,
          programHash: strategyProgramHash(candidate.descendant.profile.strategyProgram!),
          programNodes: countProgramNodes(candidate.descendant.profile.strategyProgram!),
          programBehaviorHash: behavior.hash,
          programBehaviorDistance: candidate.descendant.programBehaviorDistance,
          programOpportunity: candidate.programOpportunity,
          programSelected: isSelected && candidate.descendant.lineage.lineageId === programCandidate?.descendant.lineage.lineageId,
          score: candidate.score,
          selected: index === 0 && isSelected,
        };
      }),
    };
  });

  return {
    schemaVersion: 1,
    mode: "punctuated",
    season: input.season,
    budget: {globalPressure, environmentalShock: config.environmentalShock, burstSlots, candidateCount, cheapEvaluations: burstSlots * candidateCount, retainedDescendants: winners.length, retainedProgramCandidates: programWinners.length},
    state: Object.fromEntries(decisions.map(entry => [entry.managerId, entry.after])),
    decisions,
    descendants: winners,
    programDescendants: programWinners,
  };
}

function assessManager(competitor: EvolutionCompetitor, managerCount: number, season: number, previous: ManagerEvolutionState | undefined, config: PunctuatedEvolutionConfig): Omit<ManagerEvolutionDecision, "selected" | "candidates"> {
  const before = previous ?? initialState(competitor.slotId);
  const instant = instantaneousPressure(competitor, managerCount);
  const reservoir = clamp01(before.pressureReservoir * .68 + instant * .32 + config.environmentalShock * .35);
  const triggerScore = clamp01(instant * .55 + reservoir * .45 + config.environmentalShock * .35);
  const stableSeasons = before.stableSeasons + 1;
  const coolingDown = season <= before.cooldownUntilSeason;
  const eligible = !coolingDown && stableSeasons >= config.minimumStableSeasons && triggerScore >= config.triggerThreshold;
  const reasons = [
    ...(competitor.rank > 1 ? [`rank-pressure:${competitor.rank}`] : ["rank-protected"]),
    ...(competitor.champion ? ["champion-relief"] : []),
    ...(reservoir >= config.warningThreshold ? ["pressure-accumulated"] : []),
    ...(config.environmentalShock > 0 ? [`environmental-shock:${config.environmentalShock.toFixed(2)}`] : []),
    ...(coolingDown ? [`cooldown-until:${before.cooldownUntilSeason}`] : []),
  ];
  const phase: EvolutionPhase = coolingDown ? "consolidating" : triggerScore >= config.warningThreshold ? "pressure" : "stable";
  const after: ManagerEvolutionState = {...before, phase, pressure: instant, pressureReservoir: reservoir, stableSeasons, lastTriggerReasons: reasons};
  return {managerId: competitor.slotId, before, after, instantaneousPressure: instant, triggerScore, eligible, reasons};
}

function instantaneousPressure(competitor: EvolutionCompetitor, managerCount: number): number {
  const rankPressure = (competitor.rank - 1) / Math.max(1, managerCount - 1);
  const playoffRelief = clamp01(competitor.playoffScore ?? 0);
  const traitMismatch = behaviorMismatch(competitor);
  return clamp01(rankPressure * .55 + (1 - playoffRelief) * .2 + traitMismatch * .25 - (competitor.champion ? .25 : 0));
}

function behaviorMismatch(competitor: EvolutionCompetitor): number {
  const {traits} = competitor.profile;
  const expected = [traits.risk, traits.flexibility, traits.stars, (traits.synergy + traits.flexibility) / 2, 1 - traits.value, (traits.counter + traits.risk) / 2];
  const observed = [competitor.behavior.pace, competitor.behavior.lineupVariation, competitor.behavior.starInvestment, competitor.behavior.roleBreadth, competitor.behavior.rosterTurnover, competitor.behavior.knockoutPressure];
  return mean(expected.map((value, index) => Math.abs(value - observed[index])));
}

function candidateScore(descendant: EvolutionDescendant): number {
  const mutationCount = descendant.lineage.mutations.filter(entry => !entry.includes("copy") && entry !== "conservative-copy").length;
  const usefulNovelty = Math.min(4, mutationCount) / 4;
  const instability = Math.max(0, mutationCount - 7) / 10;
  return descendant.ecologicalFitness * .78 + usefulNovelty * .12 + descendant.programBehaviorDistance * .1 - instability;
}
function programCandidateScore(candidate: {descendant: EvolutionDescendant; programOpportunity: ProgramOpportunityDistance}): number { return candidate.programOpportunity.choicePotential * .8 + candidate.programOpportunity.distance * .1 + candidate.descendant.ecologicalFitness * .1; }

function initialState(managerId: string): ManagerEvolutionState {
  return {managerId, phase: "stable", pressure: 0, pressureReservoir: 0, stableSeasons: 0, lastBurstSeason: null, cooldownUntilSeason: 0, burstCount: 0, lastTriggerReasons: []};
}

function normalizeConfig(config: Partial<PunctuatedEvolutionConfig> | undefined): PunctuatedEvolutionConfig {
  const value = {...DEFAULT_PUNCTUATED_EVOLUTION_CONFIG, ...config};
  return {...value, triggerThreshold: clamp01(value.triggerThreshold), warningThreshold: clamp01(value.warningThreshold), environmentalShock: clamp01(value.environmentalShock), minimumStableSeasons: Math.max(1, Math.floor(value.minimumStableSeasons)), cooldownSeasons: Math.max(0, Math.floor(value.cooldownSeasons)), maxBurstManagers: Math.max(1, Math.floor(value.maxBurstManagers)), minimumCandidates: Math.max(1, Math.floor(value.minimumCandidates)), maximumCandidates: Math.max(value.minimumCandidates, Math.floor(value.maximumCandidates))};
}

function seededOrder(seed: string, season: number, managerId: string): number { return parseInt(crypto.createHash("sha256").update(`${seed}:${season}:${managerId}`).digest("hex").slice(0, 8), 16); }
function mean(values: readonly number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
