import {cloneTacticalMemory, type OpponentTacticalMemory, type TacticalEpisode, type TacticalMemory, type TacticalMemoryBehaviorPolicy, type TacticalPosterior} from "../../draft/tacticalMemory";
import {MEMORY_SHADOW_PARAMETERS} from "./parameters";

export const WHITE_BOX_MEMORY_VERSION = "white-box-memory-v1";

export interface PosteriorUpdateTrace {
  episodeId: string;
  opponentId: string;
  kind: "family" | "move";
  key: string;
  evidence: number;
  before: TacticalPosterior;
  after: TacticalPosterior;
}

export interface TacticalMemoryTrace {
  version: typeof WHITE_BOX_MEMORY_VERSION;
  season: number;
  parameters: Record<string, number>;
  decay: number;
  episodes: number;
  opponents: string[];
  decayEvents: Array<{opponentId: string; episodeId: string; familyPosteriors: number; movePosteriors: number}>;
  posteriorUpdates: PosteriorUpdateTrace[];
  decisiveEvents: number;
  behaviorPolicy: TacticalMemoryBehaviorPolicy;
  behaviorDecayEvents: Array<{opponentId: string; episodeId: string; gamesBefore: number; gamesAfter: number}>;
}

export interface ConfigurationPosteriorTrace {
  version: typeof WHITE_BOX_MEMORY_VERSION;
  id: string;
  evidence: number;
  weight: number;
  parameters: Record<string, number>;
  before: {mean: number; confidence: number; effectiveSamples: number};
  retainedSamples: number;
  after: {mean: number; confidence: number; effectiveSamples: number};
  rollback: {mean: number; confidence: number; effectiveSamples: number};
}

export interface ConfigurationEvidenceTrace {
  version: typeof WHITE_BOX_MEMORY_VERSION;
  kind: "move" | "item";
  contributions: Array<{id: string; value: number; reason: string}>;
  baseEvidence: number;
  programAdjustment: number;
  evidence: number;
}

export function buildTacticalMemoryTrace(previous: TacticalMemory | undefined, episodes: TacticalEpisode[], season: number, decay: number, actual: TacticalMemory, behaviorPolicy: TacticalMemoryBehaviorPolicy = "cumulative"): TacticalMemoryTrace {
  const parameters = MEMORY_SHADOW_PARAMETERS.snapshot().values;
  const memory = cloneTacticalMemory(previous), decayEvents: TacticalMemoryTrace["decayEvents"] = [], behaviorDecayEvents: TacticalMemoryTrace["behaviorDecayEvents"] = [], posteriorUpdates: PosteriorUpdateTrace[] = [];
  for (const episode of episodes) {
    const current = memory.opponents[episode.opponentId] ?? emptyOpponent(season);
    if (current.games > 0 && current.lastSeason < season) {
      decayPosteriors(current.familyImpact, decay, parameters);
      decayPosteriors(current.moveImpact, decay, parameters);
      decayEvents.push({opponentId: episode.opponentId, episodeId: episode.id, familyPosteriors: Object.keys(current.familyImpact).length, movePosteriors: Object.keys(current.moveImpact).length});
      if (behaviorPolicy === "seasonal-decay") {
        const gamesBefore = current.games;
        decayBehavior(current, decay);
        behaviorDecayEvents.push({opponentId: episode.opponentId, episodeId: episode.id, gamesBefore, gamesAfter: current.games});
      }
    }
    current.games += 1; current.wins += episode.result === "win" ? 1 : 0; current.losses += episode.result === "loss" ? 1 : 0; current.draws += episode.result === "draw" ? 1 : 0; current.lastSeason = season;
    if (episode.opponentLead) current.leadCounts[episode.opponentLead] = (current.leadCounts[episode.opponentLead] ?? 0) + 1;
    for (const [family, impact] of Object.entries(episode.ownContributions)) {
      const before = current.familyImpact[family] ?? zeroPosterior(), after = updatePosterior(before, impact, parameters);
      current.familyImpact[family] = after; posteriorUpdates.push({episodeId: episode.id, opponentId: episode.opponentId, kind: "family", key: family, evidence: impact, before: {...before}, after: {...after}});
    }
    for (const [move, impact] of Object.entries(episode.ownMoveImpact)) {
      const before = current.moveImpact[move] ?? zeroPosterior(), after = updatePosterior(before, impact, parameters);
      current.moveImpact[move] = after; posteriorUpdates.push({episodeId: episode.id, opponentId: episode.opponentId, kind: "move", key: move, evidence: impact, before: {...before}, after: {...after}});
    }
    for (const [move, count] of Object.entries(episode.opponentMoves)) current.opponentMoveCounts[move] = (current.opponentMoveCounts[move] ?? 0) + count;
    current.opponentMoveCountsByFamily ??= {};
    for (const [family, moves] of Object.entries(episode.opponentMovesByFamily ?? {})) {const counts=current.opponentMoveCountsByFamily[family]??{};for(const [move,count] of Object.entries(moves))counts[move]=(counts[move]??0)+count;current.opponentMoveCountsByFamily[family]=counts;}
    current.opponentSwitches += episode.opponentSwitches; current.observedTurns += episode.turns;
    current.episodes = [...current.episodes, episode].slice(-parameters["memory.tactical.episodelimit"]);
    memory.opponents[episode.opponentId] = current;
  }
  if (JSON.stringify(memory) !== JSON.stringify(actual)) throw new Error(`White-box tactical memory replay drifted in season ${season}`);
  return {version: WHITE_BOX_MEMORY_VERSION, season, parameters, decay, episodes: episodes.length, opponents: [...new Set(episodes.map(episode => episode.opponentId))].sort(), decayEvents, posteriorUpdates, decisiveEvents: episodes.reduce((sum, episode) => sum + episode.decisiveEvents.length, 0), behaviorPolicy, behaviorDecayEvents};
}

export function evaluateConfigurationPosterior(id: string, priorInput: {mean: number; confidence: number; effectiveSamples: number} | undefined, evidence: number, weight: number): ConfigurationPosteriorTrace {
  const parameters = MEMORY_SHADOW_PARAMETERS.snapshot().values, before = priorInput ?? {mean: .5, confidence: 0, effectiveSamples: 2};
  const retainedSamples = Math.max(parameters["memory.configuration.minimumsamples"], before.effectiveSamples * parameters["memory.configuration.priorretention"]);
  const effectiveSamples = Math.min(parameters["memory.configuration.maximumsamples"], retainedSamples + weight);
  const after = {mean: (before.mean * retainedSamples + evidence * weight) / effectiveSamples, confidence: clamp01((effectiveSamples - parameters["memory.configuration.minimumsamples"]) / parameters["memory.configuration.confidencespan"]), effectiveSamples};
  return {version: WHITE_BOX_MEMORY_VERSION, id, evidence, weight, parameters, before: {...before}, retainedSamples, after, rollback: {...before}};
}

export function evaluateConfigurationEvidence(input: {kind: "move" | "item"; teamResult: number; production: number; eventRate?: number; koRate?: number; triggerRate?: number; programValue?: number}): ConfigurationEvidenceTrace {
  const contributions = input.kind === "move" ? [
    {id: "configuration.team", value: input.teamResult * .15, reason: "Team result"},
    {id: "configuration.events", value: Math.min(1, input.eventRate ?? 0) * .45, reason: "Attributed move events per use"},
    {id: "configuration.kos", value: Math.min(1, (input.koRate ?? 0) * 2) * .25, reason: "Attributed knockouts per use"},
    {id: "configuration.production", value: input.production * .15, reason: "Member production"},
  ] : [
    {id: "configuration.team", value: input.teamResult * .2, reason: "Team result"},
    {id: "configuration.production", value: input.production * .55, reason: "Member production"},
    {id: "configuration.triggers", value: Math.min(1, input.triggerRate ?? 0) * .25, reason: "Item triggers per appearance"},
  ];
  const baseEvidence = clamp01(contributions.reduce((sum, entry) => sum + entry.value, 0));
  const programAdjustment = input.kind === "move" ? (input.programValue ?? 0) * MEMORY_SHADOW_PARAMETERS.snapshot().values["memory.configuration.programweight"] : 0;
  return {version: WHITE_BOX_MEMORY_VERSION, kind: input.kind, contributions, baseEvidence, programAdjustment, evidence: clamp01(baseEvidence + programAdjustment)};
}

function updatePosterior(prior:TacticalPosterior,evidence:number,p:Record<string,number>):TacticalPosterior{const samples=Math.min(p["memory.tactical.maximumsamples"],prior.effectiveSamples+1);return{mean:bounded((prior.mean*prior.effectiveSamples+evidence)/Math.max(1,samples)),confidence:Math.min(1,samples/p["memory.tactical.confidencesamples"]),effectiveSamples:samples};}
function decayPosteriors(values:Record<string,TacticalPosterior>,decay:number,p:Record<string,number>):void{for(const posterior of Object.values(values)){posterior.mean*=decay;posterior.effectiveSamples*=decay;posterior.confidence=Math.min(1,posterior.effectiveSamples/p["memory.tactical.confidencesamples"]);}}
function decayBehavior(memory:OpponentTacticalMemory,decay:number):void{memory.games*=decay;memory.wins*=decay;memory.losses*=decay;memory.draws*=decay;scaleCounts(memory.leadCounts,decay);scaleCounts(memory.opponentMoveCounts,decay);for(const counts of Object.values(memory.opponentMoveCountsByFamily??{}))scaleCounts(counts,decay);memory.opponentSwitches*=decay;memory.observedTurns*=decay;}
function scaleCounts(values:Record<string,number>,scale:number):void{for(const key of Object.keys(values))values[key]*=scale;}
function emptyOpponent(season:number):OpponentTacticalMemory{return{games:0,wins:0,losses:0,draws:0,lastSeason:season,leadCounts:{},familyImpact:{},moveImpact:{},opponentMoveCounts:{},opponentMoveCountsByFamily:{},opponentSwitches:0,observedTurns:0,episodes:[]};}
function zeroPosterior():TacticalPosterior{return{mean:0,confidence:0,effectiveSamples:0};}
function bounded(value:number):number{return Math.max(-1,Math.min(1,Number.isFinite(value)?value:0));}
function clamp01(value:number):number{return Math.max(0,Math.min(1,value));}
