import {Dex, Teams} from "pokemon-showdown";
import type {ModdedDex} from "pokemon-showdown/dist/sim/dex";
import type {PokemonSet} from "pokemon-showdown/dist/sim/teams";

export interface TeamStructureSnapshot {
  roleBreadth: number;
  roleCompression: number;
  structuralSinglePoints: number;
  answerRedundancy: number;
  blindSpotResilience: number;
  opponentStructureResponse: number;
  opponentStructureLoad: number;
}

export interface TeamStructurePair {p1: TeamStructureSnapshot; p2: TeamStructureSnapshot}

const allRoles = ["hazards", "removal", "recovery", "pivot", "setup", "priority", "screens", "status", "physical", "special"] as const;
const structuralRoles = ["hazards", "removal", "recovery", "pivot"] as const;
const utilityRoles = new Set<string>(["hazards", "removal", "recovery", "pivot", "setup", "priority", "screens", "status"]);

export function teamStructuresFromReplay(value: any): TeamStructurePair {
  const input = value?.input ?? value, format = String(input?.format ?? ""), p1 = Teams.unpack(String(input?.teamA ?? "")), p2 = Teams.unpack(String(input?.teamB ?? ""));
  if (!format || !p1?.length || !p2?.length) throw new Error("Replay does not contain two public team sheets");
  return buildTeamStructurePair(Dex.forFormat(format), p1, p2);
}

export function buildTeamStructurePair(dex: ModdedDex, p1: readonly PokemonSet[], p2: readonly PokemonSet[]): TeamStructurePair {
  if (!p1.length || !p2.length) throw new Error("Team structure requires two non-empty teams");
  return {p1: describe(dex, p1, p2), p2: describe(dex, p2, p1)};
}

function describe(dex: ModdedDex, own: readonly PokemonSet[], opponent: readonly PokemonSet[]): TeamStructureSnapshot {
  const ownMembers = own.map(set => member(dex, set)), opponents = opponent.map(set => member(dex, set)), roleCounts = counts(ownMembers.flatMap(value => [...value.roles]));
  const roleBreadth = new Set(ownMembers.flatMap(value => [...value.roles])).size / allRoles.length;
  const roleCompression = ownMembers.reduce((total, value) => total + Math.max(0, [...value.roles].filter(role => utilityRoles.has(role)).length - 1), 0) / Math.max(1, ownMembers.length * 3);
  const structuralSinglePoints = structuralRoles.filter(role => roleCounts[role] === 1).length / structuralRoles.length;
  const capacities = opponents.map(target => ownMembers.map(attacker => capacity(matchupPressure(dex, attacker, target))).sort((left, right) => right - left));
  const best = capacities.map(values => values[0] ?? 0), second = capacities.map(values => values[1] ?? 0), structuralWeights = opponents.map(value => [...value.roles].filter(role => utilityRoles.has(role)).length), structuralWeight = structuralWeights.reduce((sum, value) => sum + value, 0);
  const weightedStructural = (values: number[]) => structuralWeight > 0 ? values.reduce((sum, value, index) => sum + value * structuralWeights[index], 0) / structuralWeight : mean(values);
  return {
    roleBreadth: round(roleBreadth),
    roleCompression: round(roleCompression),
    structuralSinglePoints: round(structuralSinglePoints),
    answerRedundancy: round(Math.min(...second)),
    blindSpotResilience: round(Math.min(...best)),
    opponentStructureResponse: round(weightedStructural(best)),
    opponentStructureLoad: round(weightedStructural(best.map((value, index) => Math.max(0, value - second[index])))),
  };
}

interface Member {types: string[]; stats: {atk: number; def: number; spa: number; spd: number}; moves: Array<ReturnType<ModdedDex["moves"]["get"]>>; roles: Set<string>}

function member(dex: ModdedDex, set: PokemonSet): Member {
  const species = dex.species.get(set.species), moves = set.moves.map(name => dex.moves.get(name)).filter(move => move.exists), ids = new Set(moves.map(move => move.id)), roles = new Set<string>();
  if (["stealthrock", "spikes", "toxicspikes", "stickyweb", "ceaselessedge"].some(id => ids.has(id))) roles.add("hazards");
  if (["defog", "rapidspin", "tidyup", "mortalspin"].some(id => ids.has(id))) roles.add("removal");
  if (moves.some(move => move.flags.heal) || String(set.ability).toLowerCase().replace(/[^a-z0-9]/g, "") === "regenerator") roles.add("recovery");
  if (["uturn", "voltswitch", "flipturn", "partingshot", "batonpass"].some(id => ids.has(id))) roles.add("pivot");
  if (moves.some(move => positiveBoost(move.boosts) || positiveBoost(move.self?.boosts))) roles.add("setup");
  if (moves.some(move => move.priority > 0)) roles.add("priority");
  if (["reflect", "lightscreen", "auroraveil"].some(id => ids.has(id))) roles.add("screens");
  if (["toxic", "willowisp", "thunderwave", "nuzzle", "yawn", "spore", "sleeppowder"].some(id => ids.has(id))) roles.add("status");
  if (moves.some(move => move.category === "Physical")) roles.add("physical");
  if (moves.some(move => move.category === "Special")) roles.add("special");
  return {types: [...species.types], stats: {atk: species.baseStats.atk, def: species.baseStats.def, spa: species.baseStats.spa, spd: species.baseStats.spd}, moves, roles};
}

function matchupPressure(dex: ModdedDex, attacker: Member, target: Member): number {
  let best = 0;
  for (const move of attacker.moves) {
    if (move.category === "Status" || move.basePower <= 0 || !dex.getImmunity(move.type, target.types)) continue;
    const effectiveness = 2 ** dex.getEffectiveness(move.type, target.types), stab = attacker.types.includes(move.type) ? 1.5 : 1, attack = move.category === "Physical" ? attacker.stats.atk : attacker.stats.spa, defense = move.category === "Physical" ? target.stats.def : target.stats.spd;
    best = Math.max(best, move.basePower / 100 * stab * effectiveness * Math.sqrt(Math.max(1, attack) / Math.max(1, defense)));
  }
  return best;
}

function positiveBoost(boosts: unknown): boolean { return Boolean(boosts && typeof boosts === "object" && Object.values(boosts as Record<string, number>).some(value => Number(value) > 0)); }
function capacity(pressure: number): number { return pressure / (1 + pressure); }
function counts(values: string[]): Record<string, number> { const result: Record<string, number> = {}; for (const value of values) result[value] = (result[value] ?? 0) + 1; return result; }
function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
