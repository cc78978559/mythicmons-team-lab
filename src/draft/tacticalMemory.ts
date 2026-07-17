import fs from "node:fs";
import type {AiOpponentModel} from "../showdown/choice";

export interface TacticalPosterior {
  mean: number;
  confidence: number;
  effectiveSamples: number;
}

export interface TacticalEpisode {
  id: string;
  opponentId: string;
  result: "win" | "loss" | "draw";
  turns: number;
  ownLead: string | null;
  opponentLead: string | null;
  ownContributions: Record<string, number>;
  ownMoveImpact: Record<string, number>;
  opponentMoves: Record<string, number>;
  opponentMovesByFamily?: Record<string, Record<string, number>>;
  opponentSwitches: number;
  decisiveEvents: string[];
}

export interface OpponentTacticalMemory {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  lastSeason: number;
  leadCounts: Record<string, number>;
  familyImpact: Record<string, TacticalPosterior>;
  moveImpact: Record<string, TacticalPosterior>;
  opponentMoveCounts: Record<string, number>;
  opponentMoveCountsByFamily?: Record<string, Record<string, number>>;
  opponentSwitches: number;
  observedTurns: number;
  episodes: TacticalEpisode[];
}

export interface TacticalMemory {
  version: 1;
  opponents: Record<string, OpponentTacticalMemory>;
}

export type TacticalMemoryBehaviorPolicy = "cumulative" | "seasonal-decay";

export interface TacticalEpisodeInput {
  id: string;
  opponentId: string;
  publicLogPath: string;
  perspective: "p1" | "p2";
  familyByName: ReadonlyMap<string, string>;
}

export function emptyTacticalMemory(): TacticalMemory {
  return {version: 1, opponents: {}};
}

export function extractTacticalEpisode(input: TacticalEpisodeInput): TacticalEpisode {
  const lines = fs.readFileSync(input.publicLogPath, "utf8").split(/\r?\n/);
  const ownPlayer = input.perspective;
  const opponentPlayer = ownPlayer === "p1" ? "p2" : "p1";
  const contributions: Record<string, number> = {};
  const moveImpact: Record<string, number> = {};
  const opponentMoves: Record<string, number> = {};
  const opponentMovesByFamily: Record<string, Record<string, number>> = {};
  const participants = new Set<string>();
  const fainted = new Set<string>();
  const lastMove: Partial<Record<"p1" | "p2", {actor: string; move: string}>> = {};
  const active: Partial<Record<"p1" | "p2", string>> = {};
  const activeFamily: Partial<Record<"p1" | "p2", string>> = {};
  const recoilFainted = new Set<string>();
  const decisiveEvents: string[] = [];
  let ownLead: string | null = null;
  let opponentLead: string | null = null;
  let opponentSwitches = 0;
  let turns = 0;
  let winner: string | null = null;

  for (const line of lines) {
    const turn = line.match(/^\|turn\|(\d+)/);
    if (turn) { turns = Number(turn[1]); continue; }
    const win = line.match(/^\|win\|(.+)/);
    if (win) { winner = win[1]; continue; }
    const switchEvent = line.match(/^\|(switch|drag)\|p([12])a: ([^|]+)\|([^|]+)/);
    if (switchEvent) {
      const player = `p${switchEvent[2]}` as "p1" | "p2";
      const name = switchEvent[3];
      const family = player === ownPlayer ? ownFamily(name, input.familyByName) : opponentFamily(name, switchEvent[4]);
      active[player] = name;
      activeFamily[player] = family;
      if (player === ownPlayer) {
        participants.add(family);
        contributions[family] ??= 0;
        ownLead ??= family;
      } else {
        if (opponentLead === null) opponentLead = family;
        else opponentSwitches += 1;
      }
      continue;
    }
    const moveEvent = line.match(/^\|move\|p([12])a: ([^|]+)\|([^|]+)/);
    if (moveEvent) {
      const player = `p${moveEvent[1]}` as "p1" | "p2";
      const actor = moveEvent[2], move = normalize(moveEvent[3]);
      lastMove[player] = {actor, move};
      if (player === ownPlayer) {
        const family = ownFamily(actor, input.familyByName);
        participants.add(family);
        contributions[family] = (contributions[family] ?? 0) + .015;
        moveImpact[move] = (moveImpact[move] ?? 0) + .01;
      } else {
        opponentMoves[move] = (opponentMoves[move] ?? 0) + 1;
        const family = activeFamily[player] ?? opponentFamily(actor, actor);
        const familyMoves = opponentMovesByFamily[family] ?? {};
        familyMoves[move] = (familyMoves[move] ?? 0) + 1;
        opponentMovesByFamily[family] = familyMoves;
      }
      continue;
    }
    const faintEvent = line.match(/^\|faint\|p([12])a: ([^|]+)/);
    if (faintEvent) {
      const player = `p${faintEvent[1]}` as "p1" | "p2";
      if (player === ownPlayer) {
        const family = ownFamily(faintEvent[2], input.familyByName);
        fainted.add(family);
        contributions[family] = (contributions[family] ?? 0) - .35;
      } else {
        const opponentSource = lastMove[opponentPlayer];
        const opponentSelfFainted = opponentSource && normalize(opponentSource.actor) === normalize(faintEvent[2]) && (SELF_KO_MOVES.has(opponentSource.move) || recoilFainted.has(normalize(faintEvent[2])));
        if (opponentSelfFainted && active[ownPlayer]) {
          const family = ownFamily(active[ownPlayer]!, input.familyByName);
          const tradeCredit = SELF_KO_MOVES.has(opponentSource.move) ? .45 : .2;
          contributions[family] = (contributions[family] ?? 0) + tradeCredit;
          decisiveEvents.push(`${family}:absorbed-self-ko:${opponentFamily(faintEvent[2], faintEvent[2])}:from:${opponentSource.move}`);
        } else if (lastMove[ownPlayer]) {
          const source = lastMove[ownPlayer]!;
          const family = ownFamily(source.actor, input.familyByName);
          contributions[family] = (contributions[family] ?? 0) + 1;
          moveImpact[source.move] = (moveImpact[source.move] ?? 0) + 1;
          decisiveEvents.push(`${family}:ko:${opponentFamily(faintEvent[2], faintEvent[2])}:with:${source.move}`);
        }
      }
      continue;
    }
    const recoil = line.match(/^\|-damage\|p[12]a: ([^|]+)\|0 fnt\|\[from\] Recoil/i);
    if (recoil) { recoilFainted.add(normalize(recoil[1])); continue; }
    const item = line.match(/^\|-enditem\|p([12])a: ([^|]+)\|([^|]+)/);
    if (item && `p${item[1]}` === ownPlayer) decisiveEvents.push(`${ownFamily(item[2], input.familyByName)}:consumed:${normalize(item[3])}`);
    const weather = line.match(/^\|-weather\|([^|]+)/);
    if (weather && normalize(weather[1]) !== "none") decisiveEvents.push(`weather:${normalize(weather[1])}`);
  }

  for (const family of participants) if (!fainted.has(family)) contributions[family] = (contributions[family] ?? 0) + .12;
  const result = winner === null ? "draw" : winner === (ownPlayer === "p1" ? "Team A" : "Team B") ? "win" : "loss";
  return {
    id: input.id,
    opponentId: input.opponentId,
    result,
    turns,
    ownLead,
    opponentLead,
    ownContributions: Object.fromEntries(Object.entries(contributions).map(([family, value]) => [family, bounded(value / 2)])),
    ownMoveImpact: Object.fromEntries(Object.entries(moveImpact).map(([move, value]) => [move, bounded(value / 2)])),
    opponentMoves,
    opponentMovesByFamily,
    opponentSwitches,
    decisiveEvents: decisiveEvents.slice(-16),
  };
}

export function updateTacticalMemory(previous: TacticalMemory | undefined, episodes: TacticalEpisode[], season: number, decay = .85, behaviorPolicy: TacticalMemoryBehaviorPolicy = "cumulative"): TacticalMemory {
  const memory = cloneTacticalMemory(previous);
  for (const episode of episodes) {
    const current = memory.opponents[episode.opponentId] ?? emptyOpponentMemory(season);
    if (current.games > 0 && current.lastSeason < season) {
      decayPosteriors(current.familyImpact, decay);
      decayPosteriors(current.moveImpact, decay);
      if (behaviorPolicy === "seasonal-decay") decayBehavior(current, decay);
    }
    current.games += 1;
    current.wins += episode.result === "win" ? 1 : 0;
    current.losses += episode.result === "loss" ? 1 : 0;
    current.draws += episode.result === "draw" ? 1 : 0;
    current.lastSeason = season;
    if (episode.opponentLead) current.leadCounts[episode.opponentLead] = (current.leadCounts[episode.opponentLead] ?? 0) + 1;
    for (const [family, impact] of Object.entries(episode.ownContributions)) current.familyImpact[family] = updatePosterior(current.familyImpact[family], impact);
    for (const [move, impact] of Object.entries(episode.ownMoveImpact)) current.moveImpact[move] = updatePosterior(current.moveImpact[move], impact);
    for (const [move, count] of Object.entries(episode.opponentMoves)) current.opponentMoveCounts[move] = (current.opponentMoveCounts[move] ?? 0) + count;
    current.opponentMoveCountsByFamily ??= {};
    for (const [family, moves] of Object.entries(episode.opponentMovesByFamily ?? {})) {
      const familyCounts = current.opponentMoveCountsByFamily[family] ?? {};
      for (const [move, count] of Object.entries(moves)) familyCounts[move] = (familyCounts[move] ?? 0) + count;
      current.opponentMoveCountsByFamily[family] = familyCounts;
    }
    current.opponentSwitches += episode.opponentSwitches;
    current.observedTurns += episode.turns;
    current.episodes = [...current.episodes, episode].slice(-32);
    memory.opponents[episode.opponentId] = current;
  }
  return memory;
}

export function tacticalFamilyValue(memory: TacticalMemory | undefined, opponentId: string, family: string): number {
  const posterior = memory?.opponents[opponentId]?.familyImpact[family];
  return posterior ? posterior.mean * posterior.confidence : 0;
}

export function tacticalSignals(memory: TacticalMemory | undefined, opponentId: string): {confidence: number; historicalWinRate: number; opponentLeadConcentration: number; opponentSwitchRate: number} {
  const opponent = memory?.opponents[opponentId];
  if (!opponent?.games) return {confidence: 0, historicalWinRate: .5, opponentLeadConcentration: 0, opponentSwitchRate: 0};
  const leadMaximum = Math.max(0, ...Object.values(opponent.leadCounts));
  const posteriorConfidence = average(Object.values(opponent.familyImpact).map(value => value.confidence));
  return {
    confidence: Math.min(1, opponent.games / 12) * (.5 + posteriorConfidence * .5),
    historicalWinRate: (opponent.wins + opponent.draws * .5) / opponent.games,
    opponentLeadConcentration: leadMaximum / opponent.games,
    opponentSwitchRate: opponent.opponentSwitches / Math.max(1, opponent.observedTurns),
  };
}

export function tacticalOpponentModel(memory: TacticalMemory | undefined, opponentId: string, options: {minimumConfidence?: number} = {}): AiOpponentModel {
  const signals = tacticalSignals(memory, opponentId);
  const minimumConfidence = options.minimumConfidence ?? 0;
  if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1) throw new Error("minimumConfidence must be within 0..1");
  const opponent = memory?.opponents[opponentId];
  return {
    confidence: signals.confidence + 1e-12 >= minimumConfidence ? signals.confidence : 0,
    switchRate: signals.opponentSwitchRate,
    moveUsage: {...(opponent?.opponentMoveCounts ?? {})},
    moveUsageBySpecies: JSON.parse(JSON.stringify(opponent?.opponentMoveCountsByFamily ?? {})) as Record<string, Record<string, number>>,
  };
}

export function cloneTacticalMemory(value: TacticalMemory | undefined): TacticalMemory {
  if (!value) return emptyTacticalMemory();
  return JSON.parse(JSON.stringify(value)) as TacticalMemory;
}

function emptyOpponentMemory(season: number): OpponentTacticalMemory {
  return {games: 0, wins: 0, losses: 0, draws: 0, lastSeason: season, leadCounts: {}, familyImpact: {}, moveImpact: {}, opponentMoveCounts: {}, opponentMoveCountsByFamily: {}, opponentSwitches: 0, observedTurns: 0, episodes: []};
}

function updatePosterior(previous: TacticalPosterior | undefined, evidence: number): TacticalPosterior {
  const prior = previous ?? {mean: 0, confidence: 0, effectiveSamples: 0};
  const samples = Math.min(24, prior.effectiveSamples + 1);
  return {mean: bounded((prior.mean * prior.effectiveSamples + evidence) / Math.max(1, samples)), confidence: Math.min(1, samples / 8), effectiveSamples: samples};
}

function decayPosteriors(values: Record<string, TacticalPosterior>, decay: number): void {
  for (const posterior of Object.values(values)) {
    posterior.mean *= decay;
    posterior.effectiveSamples *= decay;
    posterior.confidence = Math.min(1, posterior.effectiveSamples / 8);
  }
}

function decayBehavior(memory: OpponentTacticalMemory, decay: number): void {
  memory.games *= decay; memory.wins *= decay; memory.losses *= decay; memory.draws *= decay;
  scaleCounts(memory.leadCounts, decay); scaleCounts(memory.opponentMoveCounts, decay);
  for (const counts of Object.values(memory.opponentMoveCountsByFamily ?? {})) scaleCounts(counts, decay);
  memory.opponentSwitches *= decay; memory.observedTurns *= decay;
}

function scaleCounts(values: Record<string, number>, scale: number): void { for (const key of Object.keys(values)) values[key] *= scale; }

function ownFamily(name: string, familyByName: ReadonlyMap<string, string>): string {
  return familyByName.get(normalize(name)) ?? normalize(name);
}

function opponentFamily(name: string, details: string): string {
  if (/^Red-/i.test(name)) return normalize(name);
  return normalize(details.split(",")[0] || name);
}

function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
const SELF_KO_MOVES = new Set(["explosion", "selfdestruct", "mistyexplosion", "finalgambit", "memento"]);
function bounded(value: number): number { return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0)); }
function average(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
