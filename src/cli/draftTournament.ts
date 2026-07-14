import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {Dex, Teams, toID} from "pokemon-showdown";
import type {PokemonSet} from "pokemon-showdown/dist/sim/teams";
import {compileSandboxTeam} from "../sandbox/compiler";
import {installCompiledSandbox} from "../sandbox/installer";
import type {SandboxTeam} from "../sandbox/types";
import {loadBenchmarkPool, benchmarkTeamPath} from "../eval/benchmarkPool";
import {analyzePublicLog, mergeCounts} from "../eval/logAnalysis";
import {runBattle} from "../showdown/battle";
import {loadTeam, writeTeam} from "../showdown/team";
import {boundedDraftJitter, thirdRoundReversalOrder} from "../draft/scoring";
import {DRAFT_GENERATIONS, draftGenerationSource} from "../draft/customRegistry";

type PoolMode = "custom" | "modern" | "combined" | "grand";
type Side = "p1" | "p2";

interface Candidate {
  id: string;
  name: string;
  source: string;
  set: PokemonSet;
  types: string[];
  stats: {hp: number; atk: number; def: number; spa: number; spd: number; spe: number};
  roles: Set<string>;
  strength: number;
  tier: "Elite" | "Premium" | "Standard";
  cost: number;
}

interface Drafter {
  id: string;
  name: string;
  weights: {power: number; bulk: number; speed: number; utility: number; synergy: number};
  preferredRoles: string[];
  picks: Candidate[];
  budgetUsed: number;
}

const mode = parseMode(process.env.DRAFT_POOL || "custom");
const seed = process.env.DRAFT_SEED || "mythic-dream-draft-v1";
const gamesPerOrientation = Number(process.env.DRAFT_GAMES || 4);
const playoffGamesPerOrientation = Number(process.env.DRAFT_PLAYOFF_GAMES || 4);
const generatedPoolTarget = Number(process.env.DRAFT_GENERATED_POOL || 120);
const budgetCap = Number(process.env.DRAFT_BUDGET || 18);
const outDir = path.resolve(process.env.DRAFT_OUT || `output/draft-tournament-${mode}`);
const maxTurns = Number(process.env.DRAFT_MAX_TURNS || 180);

const customSources = DRAFT_GENERATIONS.map(generation => [generation.toUpperCase(), draftGenerationSource(generation)] as const);

const drafters: Drafter[] = [
  {id: "balance", name: "均衡构筑AI", weights: {power: 1, bulk: 1, speed: 0.8, utility: 1.2, synergy: 1.5}, preferredRoles: ["pivot", "removal", "recovery", "hazards"], picks: [], budgetUsed: 0},
  {id: "offense", name: "强攻压制AI", weights: {power: 1.6, bulk: 0.35, speed: 1.25, utility: 0.55, synergy: 0.9}, preferredRoles: ["setup", "priority", "pivot"], picks: [], budgetUsed: 0},
  {id: "defense", name: "耐久消耗AI", weights: {power: 0.45, bulk: 1.7, speed: 0.25, utility: 1.25, synergy: 1.4}, preferredRoles: ["recovery", "status", "removal", "hazards"], picks: [], budgetUsed: 0},
  {id: "speed", name: "高速节奏AI", weights: {power: 1.05, bulk: 0.35, speed: 1.8, utility: 1, synergy: 0.9}, preferredRoles: ["pivot", "priority", "screens"], picks: [], budgetUsed: 0},
  {id: "control", name: "场地控制AI", weights: {power: 0.55, bulk: 1, speed: 0.6, utility: 1.8, synergy: 1.3}, preferredRoles: ["hazards", "removal", "screens", "status"], picks: [], budgetUsed: 0},
  {id: "adaptive", name: "反制适应AI", weights: {power: 0.9, bulk: 0.9, speed: 0.9, utility: 1.1, synergy: 1.8}, preferredRoles: ["pivot", "recovery", "setup", "status"], picks: [], budgetUsed: 0},
];

async function main(): Promise<void> {
  if (!Number.isInteger(gamesPerOrientation) || gamesPerOrientation < 1) throw new Error("DRAFT_GAMES must be a positive integer");
  fs.mkdirSync(outDir, {recursive: true});
  const registry = loadCustomRegistry();
  const compiled = compileSandboxTeam(registry.team);
  installCompiledSandbox(compiled, process.cwd(), {backup: false, replaceConflicts: true});
  const dex = Dex.mod("mythicmons");
  const candidates = [
    ...(mode === "modern" ? [] : customCandidates(compiled.team, registry.sources, dex)),
    ...(mode === "custom" ? [] : modernCandidates(dex)),
  ];
  if (mode === "grand") candidates.push(...generatedCandidates(dex, candidates, generatedPoolTarget));
  classifyCandidates(candidates, dex);
  if (candidates.length < 36) throw new Error(`Draft pool requires at least 36 unique candidates; found ${candidates.length}`);

  const draftLog = runSnakeDraft(candidates, dex);
  for (const drafter of drafters) {
    const teamDir = path.join(outDir, "teams", drafter.id);
    writeTeam(drafter.picks.map(pick => pick.set), path.join(teamDir, "team.export.txt"), "export");
    writeTeam(drafter.picks.map(pick => pick.set), path.join(teamDir, "team.json"), "json");
  }
  fs.writeFileSync(path.join(outDir, "draft.json"), `${JSON.stringify({mode, seed, candidateCount: candidates.length, picks: draftLog}, null, 2)}\n`, "utf8");
  const tournament = await runTournament(compiled.formatId);
  fs.writeFileSync(path.join(outDir, "tournament.json"), `${JSON.stringify(tournament, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "report.md"), tournamentReport(draftLog, tournament), "utf8");
  fs.writeFileSync(path.join(outDir, "spectator.json"), `${JSON.stringify(spectatorData(tournament), null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "spectator-report.md"), spectatorReport(tournament), "utf8");
  console.log(JSON.stringify({mode, candidateCount: candidates.length, games: tournament.totalGames, champion: tournament.playoffs.champion}, null, 2));
  console.log(`Report: ${path.join(outDir, "report.md")}`);
}

function loadCustomRegistry(): {team: SandboxTeam; sources: string[]} {
  const loaded = customSources.map(([generation, sourcePath]) => ({generation, team: JSON.parse(fs.readFileSync(path.resolve(sourcePath), "utf8")) as SandboxTeam}));
  return {
    team: {
      name: "G1-G6 Dream Draft Registry",
      customMoves: loaded.flatMap(entry => entry.team.customMoves ?? []),
      customAbilities: loaded.flatMap(entry => entry.team.customAbilities ?? []),
      customItems: loaded.flatMap(entry => entry.team.customItems ?? []),
      members: loaded.flatMap(entry => entry.team.members),
    },
    sources: loaded.flatMap(entry => entry.team.members.map(() => entry.generation)),
  };
}

function customCandidates(sets: PokemonSet[], sources: string[], dex: ReturnType<typeof Dex.mod>): Candidate[] {
  return sets.map((set, index) => makeCandidate(`custom-${toID(set.name || set.species)}`, set.name || set.species, sources[index], set, dex));
}

function modernCandidates(dex: ReturnType<typeof Dex.mod>): Candidate[] {
  const pool = loadBenchmarkPool("benchmarks/gen9expanded/index.json");
  const bySpecies = new Map<string, {set: PokemonSet; source: string}>();
  for (const benchmark of pool.benchmarks) {
    for (const set of loadTeam(benchmarkTeamPath(pool, benchmark.team)).sets) {
      const id = toID(set.species);
      if (!bySpecies.has(id)) bySpecies.set(id, {set, source: `现代:${benchmark.name}`});
    }
  }
  return [...bySpecies.entries()].map(([id, entry]) => makeCandidate(`modern-${id}`, entry.set.name || entry.set.species, entry.source, normalizeOpenStats(entry.set), dex));
}

function generatedCandidates(dex: ReturnType<typeof Dex.mod>, existing: Candidate[], target: number): Candidate[] {
  const excluded = new Set(existing.filter(candidate => candidate.id.startsWith("modern-")).map(candidate => toID(candidate.set.species)));
  const generated = new Map<string, Candidate>();
  for (let attempt = 0; generated.size < target && attempt < target * 20; attempt += 1) {
    const digest = crypto.createHash("sha256").update(`${seed}:generated:${attempt}`).digest();
    const generatorSeed = `${digest.readUInt32BE(0)},${digest.readUInt32BE(4)},${digest.readUInt32BE(8)},${digest.readUInt32BE(12)}` as `${number},${string}`;
    const generator = Teams.getGenerator("gen9randombattle", generatorSeed);
    for (const set of generator.getTeam() as PokemonSet[]) {
      const speciesId = toID(set.species);
      if (excluded.has(speciesId) || generated.has(speciesId)) continue;
      generated.set(speciesId, makeCandidate(`generated-${speciesId}`, set.species, "Showdown成熟随机配置", normalizeOpenStats(set), dex));
      if (generated.size >= target) break;
    }
  }
  return [...generated.values()];
}

function makeCandidate(id: string, name: string, source: string, set: PokemonSet, dex: ReturnType<typeof Dex.mod>): Candidate {
  const species = dex.species.get(set.species);
  const moves = set.moves.map(move => dex.moves.get(move));
  const roles = new Set<string>();
  const ids = new Set(moves.map(move => move.id));
  if (["stealthrock", "spikes", "toxicspikes", "stickyweb", "ceaselessedge"].some(move => ids.has(move))) roles.add("hazards");
  if (["defog", "rapidspin", "tidyup", "mortalspin"].some(move => ids.has(move))) roles.add("removal");
  if (moves.some(move => move.flags.heal) || ["regenerator"].includes(toID(set.ability))) roles.add("recovery");
  if (["uturn", "voltswitch", "flipturn", "partingshot", "batonpass"].some(move => ids.has(move))) roles.add("pivot");
  if (moves.some(move => move.boosts || move.self?.boosts) || ["nastyplot", "swordsdance", "dragondance", "shellsmash", "tidyup"].some(move => ids.has(move))) roles.add("setup");
  if (moves.some(move => move.priority > 0)) roles.add("priority");
  if (["reflect", "lightscreen", "auroraveil"].some(move => ids.has(move))) roles.add("screens");
  if (["toxic", "willowisp", "thunderwave", "nuzzle", "yawn", "spore", "sleeppowder"].some(move => ids.has(move))) roles.add("status");
  if (moves.some(move => move.category === "Physical")) roles.add("physical");
  if (moves.some(move => move.category === "Special")) roles.add("special");
  return {id, name, source, set: cloneSet(set), types: [...species.types], stats: {...species.baseStats}, roles, strength: 0, tier: "Standard", cost: 1};
}

function normalizeOpenStats(source: PokemonSet): PokemonSet {
  const set = cloneSet(source);
  const stats = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
  set.level = 100;
  set.evs = Object.fromEntries(stats.map(stat => [stat, 252])) as PokemonSet["evs"];
  set.ivs = Object.fromEntries(stats.map(stat => [stat, source.ivs?.[stat] === 0 ? 0 : 31])) as PokemonSet["ivs"];
  return set;
}

function classifyCandidates(candidates: Candidate[], dex: ReturnType<typeof Dex.mod>): void {
  for (const candidate of candidates) candidate.strength = candidateStrength(candidate, dex);
  const ranked = [...candidates].sort((a, b) => b.strength - a.strength);
  const eliteCount = Math.min(12, Math.max(6, Math.round(candidates.length * 0.07)));
  const premiumCount = Math.min(42, Math.max(18, Math.round(candidates.length * 0.2)));
  ranked.forEach((candidate, index) => {
    if (index < eliteCount) { candidate.tier = "Elite"; candidate.cost = 5; }
    else if (index < eliteCount + premiumCount) { candidate.tier = "Premium"; candidate.cost = 3; }
    else { candidate.tier = "Standard"; candidate.cost = 1; }
  });
}

function candidateStrength(candidate: Candidate, dex: ReturnType<typeof Dex.mod>): number {
  const abilities = sourceEffectIds(dex.abilities.get(candidate.set.ability), "mythicSourceAbilities");
  const items = sourceEffectIds(dex.items.get(candidate.set.item), "mythicSourceItems");
  let physical = candidate.stats.atk;
  let special = candidate.stats.spa;
  if (abilities.has("hugepower") || abilities.has("purepower")) physical *= 2;
  if (abilities.has("guts")) physical *= 1.35;
  if (items.has("choiceband")) physical *= 1.5;
  if (items.has("choicespecs")) special *= 1.5;
  if (items.has("lifeorb")) { physical *= 1.3; special *= 1.3; }
  const technicianMulti = abilities.has("technician") && abilities.has("skilllink") ? 35 : 0;
  const setup = candidate.roles.has("setup") ? 20 : 0;
  const priority = candidate.roles.has("priority") ? 10 : 0;
  const utility = candidate.roles.size * 7;
  let physicalBulk = candidate.stats.hp * candidate.stats.def;
  let specialBulk = candidate.stats.hp * candidate.stats.spd;
  if (abilities.has("furcoat")) physicalBulk *= 2;
  if (abilities.has("icescales")) specialBulk *= 2;
  return Math.max(physical, special) * 0.8 + candidate.stats.spe * 0.55 + Math.sqrt(physicalBulk + specialBulk) * 0.65 + utility + technicianMulti + setup + priority;
}

function sourceEffectIds(effect: unknown, field: "mythicSourceAbilities" | "mythicSourceItems"): Set<string> {
  const record = effect as {[key: string]: unknown; id?: string};
  const ids = Array.isArray(record[field]) ? record[field] as string[] : [record.id || ""];
  return new Set(ids.map(toID).filter(Boolean));
}

function runSnakeDraft(candidates: Candidate[], dex: ReturnType<typeof Dex.mod>) {
  const available = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const log = [];
  let overallPick = 0;
  const lottery = [...drafters].sort((a, b) => seededTie(`lottery:${a.id}`, 0) - seededTie(`lottery:${b.id}`, 0));
  const roundOrders = thirdRoundReversalOrder(lottery.length, 6);
  for (let round = 1; round <= 6; round += 1) {
    const order = roundOrders[round - 1].map(index => lottery[index]);
    for (const drafter of order) {
      const eligible = [...available.values()].filter(candidate => canDraft(drafter, candidate));
      if (!eligible.length) throw new Error(`No budget-eligible candidates remain for ${drafter.name}`);
      const ranked = eligible.map(candidate => scoreCandidate(drafter, candidate, dex, available)).sort((a, b) => b.total - a.total || seededTie(a.candidate.id, overallPick) - seededTie(b.candidate.id, overallPick));
      const selected = ranked[0];
      drafter.picks.push(selected.candidate);
      drafter.budgetUsed += selected.candidate.cost;
      available.delete(selected.candidate.id);
      overallPick += 1;
      log.push({round, overallPick, draftSlot: lottery.indexOf(drafter) + 1, drafterId: drafter.id, drafterName: drafter.name, candidateId: selected.candidate.id, pokemon: selected.candidate.name, source: selected.candidate.source, tier: selected.candidate.tier, cost: selected.candidate.cost, budgetAfterPick: drafter.budgetUsed, score: round3(selected.total), reasons: selected.reasons});
    }
  }
  return log;
}

function canDraft(drafter: Drafter, candidate: Candidate): boolean {
  if (candidate.tier === "Elite" && drafter.picks.filter(pick => pick.tier === "Elite").length >= 2) return false;
  const remainingSlots = 6 - drafter.picks.length - 1;
  return drafter.budgetUsed + candidate.cost + remainingSlots <= budgetCap;
}

function scoreCandidate(drafter: Drafter, candidate: Candidate, dex: ReturnType<typeof Dex.mod>, available: Map<string, Candidate>) {
  const power = Math.max(candidate.stats.atk, candidate.stats.spa) / 150;
  const bulk = (candidate.stats.hp / 120 + candidate.stats.def / 130 + candidate.stats.spd / 130) / 3;
  const speed = candidate.stats.spe / 150;
  const utility = candidate.roles.size / 6;
  const synergy = teamSynergy(drafter, candidate, dex);
  const scarcity = roleScarcity(drafter, candidate, available);
  const counter = counterDraftValue(drafter, candidate, dex);
  const lookahead = completionLookahead(drafter, candidate, available, dex);
  const jitter = boundedDraftJitter(seed, `${drafter.id}:${candidate.id}`, drafter.picks.length);
  const parts = {
    power: power * drafter.weights.power,
    bulk: bulk * drafter.weights.bulk,
    speed: speed * drafter.weights.speed,
    utility: utility * drafter.weights.utility,
    synergy: synergy * drafter.weights.synergy,
    scarcity,
    counter,
    lookahead,
  };
  const reasons = Object.entries(parts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key, value]) => `${key} ${round3(value)}`);
  return {candidate, total: Object.values(parts).reduce((sum, value) => sum + value, 0) + jitter, reasons};
}

function roleScarcity(drafter: Drafter, candidate: Candidate, available: Map<string, Candidate>): number {
  let score = 0;
  for (const role of drafter.preferredRoles) {
    if (!candidate.roles.has(role) || drafter.picks.some(pick => pick.roles.has(role))) continue;
    const supply = [...available.values()].filter(option => option.roles.has(role)).length;
    score += Math.max(0.08, 0.7 - supply / Math.max(1, available.size));
  }
  return score;
}

function counterDraftValue(drafter: Drafter, candidate: Candidate, dex: ReturnType<typeof Dex.mod>): number {
  const opponents = drafters.filter(other => other !== drafter).flatMap(other => other.picks);
  if (!opponents.length) return 0;
  const attackTypes = candidate.set.moves.map(move => dex.moves.get(move)).filter(move => move.category !== "Status").map(move => move.type);
  let score = 0;
  for (const threat of opponents) {
    if (attackTypes.some(type => dex.getEffectiveness(type, threat.types) > 0)) score += 0.035;
    if (threat.types.some(type => dex.getEffectiveness(type, candidate.types) <= 0)) score += 0.018;
    if (threat.stats.spe > 120 && candidate.stats.spe > threat.stats.spe) score += 0.025;
  }
  return Math.min(0.65, score);
}

function completionLookahead(drafter: Drafter, candidate: Candidate, available: Map<string, Candidate>, dex: ReturnType<typeof Dex.mod>): number {
  const shadow: Drafter = {...drafter, picks: [...drafter.picks, candidate], budgetUsed: drafter.budgetUsed + candidate.cost};
  const pool = [...available.values()].filter(option => option.id !== candidate.id);
  let accumulated = 0;
  while (shadow.picks.length < 6) {
    const best = pool.filter(option => !shadow.picks.includes(option) && canDraft(shadow, option)).map(option => ({option, value: option.strength / 240 + teamSynergy(shadow, option, dex)})).sort((a, b) => b.value - a.value)[0];
    if (!best) break;
    shadow.picks.push(best.option);
    shadow.budgetUsed += best.option.cost;
    accumulated += best.value;
  }
  return accumulated / Math.max(1, 6 - drafter.picks.length) * 0.12;
}

function teamSynergy(drafter: Drafter, candidate: Candidate, dex: ReturnType<typeof Dex.mod>): number {
  if (!drafter.picks.length) return 0.7;
  let score = 0.5;
  for (const role of drafter.preferredRoles) {
    if (candidate.roles.has(role) && !drafter.picks.some(pick => pick.roles.has(role))) score += 0.32;
  }
  const physical = drafter.picks.filter(pick => pick.roles.has("physical")).length;
  const special = drafter.picks.filter(pick => pick.roles.has("special")).length;
  if (candidate.roles.has(physical <= special ? "physical" : "special")) score += 0.22;
  for (const type of candidate.types) {
    const duplicates = drafter.picks.filter(pick => pick.types.includes(type)).length;
    score -= duplicates * 0.14;
  }
  for (const attackType of dex.types.names()) {
    const weakCount = drafter.picks.filter(pick => dex.getEffectiveness(attackType, pick.types) > 0).length;
    if (weakCount >= 2 && dex.getEffectiveness(attackType, candidate.types) <= 0) score += 0.08 * weakCount;
    if (weakCount >= 2 && dex.getEffectiveness(attackType, candidate.types) > 0) score -= 0.1 * weakCount;
  }
  return score;
}

async function runTournament(format: string) {
  const standings = new Map(drafters.map(drafter => [drafter.id, {id: drafter.id, name: drafter.name, played: 0, wins: 0, losses: 0, draws: 0, points: 0, kos: 0, smallWins: 0, smallLosses: 0, gameDiff: 0}]));
  const pokemonKos: Record<string, number> = {};
  const matches = [];
  for (let i = 0; i < drafters.length; i += 1) {
    for (let j = i + 1; j < drafters.length; j += 1) {
      const left = drafters[i];
      const right = drafters[j];
      const summary = {left: left.id, right: right.id, leftWins: 0, rightWins: 0, draws: 0, games: [] as unknown[]};
      for (const orientation of ["left-p1", "right-p1"] as const) {
        for (let gameIndex = 0; gameIndex < gamesPerOrientation; gameIndex += 1) {
          const leftSide: Side = orientation === "left-p1" ? "p1" : "p2";
          const result = await runBattle({
            format,
            teamA: Teams.pack((orientation === "left-p1" ? left : right).picks.map(pick => pick.set)),
            teamB: Teams.pack((orientation === "left-p1" ? right : left).picks.map(pick => pick.set)),
            seed: `${seed}:${left.id}:${right.id}:paired:${gameIndex}`,
            gameIndex,
            outDir: path.join(outDir, "matches", `${left.id}-vs-${right.id}`, orientation),
            maxTurns,
            ai: "search",
            openTeamSheets: true,
          });
          const leftWon = result.winner === (leftSide === "p1" ? "Team A" : "Team B");
          const rightWon = result.winner === (leftSide === "p1" ? "Team B" : "Team A");
          if (leftWon) summary.leftWins += 1;
          else if (rightWon) summary.rightWins += 1;
          else summary.draws += 1;
          const analysis = analyzePublicLog(result.publicLogPath, result.winner, result.turns);
          mergeCounts(pokemonKos, analysis.p1Kos);
          mergeCounts(pokemonKos, analysis.p2Kos);
          const p1Kos = Object.values(analysis.p1Kos).reduce((sum, count) => sum + count, 0);
          const p2Kos = Object.values(analysis.p2Kos).reduce((sum, count) => sum + count, 0);
          standings.get(left.id)!.kos += leftSide === "p1" ? p1Kos : p2Kos;
          standings.get(right.id)!.kos += leftSide === "p1" ? p2Kos : p1Kos;
          summary.games.push({orientation, gameIndex, winner: leftWon ? left.id : rightWon ? right.id : null, turns: result.turns, highlights: extractHighlights(result.publicLogPath, leftSide === "p1" ? left.id : right.id, leftSide === "p1" ? right.id : left.id)});
        }
      }
      applyMatchPoints(standings.get(left.id)!, standings.get(right.id)!, summary.leftWins, summary.rightWins);
      matches.push(summary);
    }
  }
  const table = [...standings.values()].sort((a, b) => b.points - a.points || b.gameDiff - a.gameDiff || b.smallWins - a.smallWins || b.kos - a.kos || a.name.localeCompare(b.name));
  const playoffs = await runPlayoffs(format, table.map(entry => entry.id));
  return {mode, seed, rulesVersion: 2, gamesPerOrientation, playoffGamesPerOrientation, totalGames: matches.length * gamesPerOrientation * 2 + playoffs.totalGames, scoring: {matchWin: 3, matchDraw: 1, matchLoss: 0}, standings: table, matches, playoffs, pokemonKos};
}

function applyMatchPoints(left: {played: number; wins: number; losses: number; draws: number; points: number; smallWins: number; smallLosses: number; gameDiff: number}, right: {played: number; wins: number; losses: number; draws: number; points: number; smallWins: number; smallLosses: number; gameDiff: number}, leftWins: number, rightWins: number) {
  left.played += 1; right.played += 1;
  left.smallWins += leftWins; left.smallLosses += rightWins; left.gameDiff = left.smallWins - left.smallLosses;
  right.smallWins += rightWins; right.smallLosses += leftWins; right.gameDiff = right.smallWins - right.smallLosses;
  if (leftWins > rightWins) { left.wins += 1; right.losses += 1; left.points += 3; }
  else if (rightWins > leftWins) { right.wins += 1; left.losses += 1; right.points += 3; }
  else { left.draws += 1; right.draws += 1; left.points += 1; right.points += 1; }
}

async function runPlayoffs(format: string, seeds: string[]) {
  const semiA = await runPlayoffSeries(format, seeds[0], seeds[3], "semifinal-1", 1, 4);
  const semiB = await runPlayoffSeries(format, seeds[1], seeds[2], "semifinal-2", 2, 3);
  const finalASeed = semiA.winner === seeds[0] ? 1 : 4;
  const finalBSeed = semiB.winner === seeds[1] ? 2 : 3;
  const final = await runPlayoffSeries(format, semiA.winner, semiB.winner, "final", finalASeed, finalBSeed);
  return {semiFinals: [semiA, semiB], final, champion: {id: final.winner, name: drafters.find(drafter => drafter.id === final.winner)!.name}, totalGames: semiA.games.length + semiB.games.length + final.games.length};
}

async function runPlayoffSeries(format: string, leftId: string, rightId: string, label: string, leftSeed: number, rightSeed: number) {
  const left = drafters.find(drafter => drafter.id === leftId)!;
  const right = drafters.find(drafter => drafter.id === rightId)!;
  let leftWins = 0;
  let rightWins = 0;
  const games = [];
  for (const orientation of ["left-p1", "right-p1"] as const) {
    for (let gameIndex = 0; gameIndex < playoffGamesPerOrientation; gameIndex += 1) {
      const leftSide: Side = orientation === "left-p1" ? "p1" : "p2";
      const result = await runBattle({format, teamA: Teams.pack((orientation === "left-p1" ? left : right).picks.map(pick => pick.set)), teamB: Teams.pack((orientation === "left-p1" ? right : left).picks.map(pick => pick.set)), seed: `${seed}:playoff:${label}:paired:${gameIndex}`, gameIndex, outDir: path.join(outDir, "playoffs", label, orientation), maxTurns, ai: "search", openTeamSheets: true});
      const leftWon = result.winner === (leftSide === "p1" ? "Team A" : "Team B");
      const rightWon = result.winner === (leftSide === "p1" ? "Team B" : "Team A");
      if (leftWon) leftWins += 1;
      else if (rightWon) rightWins += 1;
      games.push({orientation, gameIndex, winner: leftWon ? left.id : rightWon ? right.id : null, turns: result.turns, highlights: extractHighlights(result.publicLogPath, leftSide === "p1" ? left.id : right.id, leftSide === "p1" ? right.id : left.id)});
    }
  }
  const winner = leftWins > rightWins ? left.id : rightWins > leftWins ? right.id : leftSeed < rightSeed ? left.id : right.id;
  return {label, left: left.id, right: right.id, leftSeed, rightSeed, leftWins, rightWins, tieBreak: leftWins === rightWins ? "higher-league-seed" : null, winner, games};
}

function tournamentReport(draftLog: ReturnType<typeof runSnakeDraft>, tournament: Awaited<ReturnType<typeof runTournament>>): string {
  const lines = [`# 自选锦标赛 V2`, ``, `- 候选池：${mode}`, `- 种子：${seed}`, `- 总对局：${tournament.totalGames}`, `- 规则：随机签位、3RR蛇形、Elite最多2只、预算${budgetCap}、配对换边、前4季后赛`, ``, `## 选秀结果`, ``];
  for (const drafter of drafters) lines.push(`- **${drafter.name}**（预算${drafter.budgetUsed}/${budgetCap}）：${drafter.picks.map(pick => `${pick.name}[${pick.tier}/${pick.cost}]（${pick.source}）`).join("、")}`);
  lines.push(``, `## 常规赛积分榜`, ``, `| 排名 | AI | 场 | 胜 | 平 | 负 | 分 | 小局差 | 击倒 |`, `| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
  tournament.standings.forEach((entry, index) => lines.push(`| ${index + 1} | ${entry.name} | ${entry.played} | ${entry.wins} | ${entry.draws} | ${entry.losses} | ${entry.points} | ${entry.gameDiff} | ${entry.kos} |`));
  lines.push(``, `## 季后赛`, ``, `- 半决赛1：${tournament.playoffs.semiFinals[0].left} ${tournament.playoffs.semiFinals[0].leftWins}:${tournament.playoffs.semiFinals[0].rightWins} ${tournament.playoffs.semiFinals[0].right}`, `- 半决赛2：${tournament.playoffs.semiFinals[1].left} ${tournament.playoffs.semiFinals[1].leftWins}:${tournament.playoffs.semiFinals[1].rightWins} ${tournament.playoffs.semiFinals[1].right}`, `- 决赛：${tournament.playoffs.final.left} ${tournament.playoffs.final.leftWins}:${tournament.playoffs.final.rightWins} ${tournament.playoffs.final.right}`, `- **冠军：${tournament.playoffs.champion.name}**`);
  lines.push(``, `## 选秀顺序`, ``);
  for (const pick of draftLog) lines.push(`${pick.overallPick}. 第${pick.round}轮 ${pick.drafterName}：${pick.pokemon} [${pick.reasons.join("；")}]`);
  return `${lines.join("\n")}\n`;
}

function extractHighlights(logPath: string, p1Team: string, p2Team: string) {
  const lines = fs.readFileSync(logPath, "utf8").split(/\r?\n/);
  let turn = 0;
  const leads: string[] = [];
  const keyEvents: string[] = [];
  const seenEvents = new Set<string>();
  const knockouts: Array<{turn: number; pokemon: string; killer: string | null; score: string}> = [];
  const alive = {p1: 6, p2: 6};
  let lastMove: {side: "p1" | "p2"; user: string; move: string} | null = null;
  let lastKiller = "";
  let streak = 0;
  for (const line of lines) {
    const parts = line.split("|");
    const event = parts[1];
    if (event === "turn") { turn = Number(parts[2]); continue; }
    if ((event === "switch" || event === "drag") && leads.length < 2) leads.push(`${sideLabel(parts[2], p1Team, p2Team)}首发${pokemonName(parts[2])}`);
    if (event === "move") {
      const side = parts[2].startsWith("p1") ? "p1" : "p2";
      lastMove = {side, user: pokemonName(parts[2]), move: parts[3]};
    }
    if (event === "faint") {
      const faintSide = parts[2].startsWith("p1") ? "p1" : "p2";
      alive[faintSide] -= 1;
      const killer = lastMove && lastMove.side !== faintSide ? lastMove.user : null;
      if (killer && killer === lastKiller) streak += 1;
      else { lastKiller = killer || ""; streak = killer ? 1 : 0; }
      knockouts.push({turn, pokemon: pokemonName(parts[2]), killer, score: `${alive.p1}-${alive.p2}`});
      if (streak >= 2 && keyEvents.length < 8) keyEvents.push(`第${turn}回合：${killer}完成连续第${streak}次击倒，存活比分${alive.p1}-${alive.p2}`);
    }
    if ((event === "-sidestart" || event === "-sideend") && keyEvents.length < 8) addUniqueEvent(keyEvents, seenEvents, `${event}:${parts[2]}:${parts[3]}`, `第${turn}回合：${sideLabel(parts[2], p1Team, p2Team)}${event === "-sidestart" ? "布置" : "清除"}${cleanEffect(parts[3])}`);
    if ((event === "-fieldstart" || event === "-fieldend" || event === "-weather") && !parts.includes("[upkeep]") && keyEvents.length < 8) addUniqueEvent(keyEvents, seenEvents, `${event}:${parts[2]}`, `第${turn}回合：场地变化 ${cleanEffect(parts[2])}`);
    if (event === "-boost" && Number(parts[4]) >= 2 && keyEvents.length < 8) keyEvents.push(`第${turn}回合：${pokemonName(parts[2])}的${parts[3]}提升${parts[4]}级`);
    if (event === "-enditem" && keyEvents.length < 8 && /Focus Sash|White Herb|Berry|Gem/.test(parts[3] || "")) keyEvents.push(`第${turn}回合：${pokemonName(parts[2])}消耗${parts[3]}`);
    if (event === "-status" && keyEvents.length < 8) keyEvents.push(`第${turn}回合：${pokemonName(parts[2])}陷入${parts[3]}`);
  }
  const first = knockouts[0];
  const last = knockouts.at(-1);
  return {
    opening: leads.join("；") || "首发信息缺失",
    firstKo: first ? `第${first.turn}回合：${first.killer || "间接伤害"}击倒${first.pokemon}` : null,
    keyEvents,
    closing: knockouts.slice(-3).map(ko => `第${ko.turn}回合 ${ko.killer || "间接伤害"}→${ko.pokemon}（${ko.score}）`),
    finalState: last ? `第${last.turn}回合结束，存活比分${last.score}` : `共${turn}回合，无击倒记录`,
  };
}

function addUniqueEvent(events: string[], seen: Set<string>, key: string, description: string): void {
  if (seen.has(key)) return;
  seen.add(key);
  events.push(description);
}

function sideLabel(token: string, p1Team: string, p2Team: string): string {
  return token.startsWith("p1") ? `${p1Team}：` : `${p2Team}：`;
}

function pokemonName(token: string): string {
  return token.replace(/^p[12][a-z]?:\s*/, "").trim();
}

function cleanEffect(value = ""): string {
  return value.replace(/^(move|ability):\s*/, "");
}

function spectatorData(tournament: any) {
  const summarize = (series: any) => ({left: series.left, right: series.right, score: `${series.leftWins}:${series.rightWins}`, representativeGame: [...series.games].sort((a: any, b: any) => b.turns - a.turns)[0], games: series.games});
  return {champion: tournament.playoffs.champion, league: tournament.matches.map(summarize), playoffs: {semiFinals: tournament.playoffs.semiFinals.map(summarize), final: summarize(tournament.playoffs.final)}};
}

function spectatorReport(tournament: any): string {
  const names = new Map(drafters.map(drafter => [drafter.id, drafter.name]));
  const lines = [`# 自选锦标赛观赛简报`, ``, `## 常规赛`, ``];
  for (const match of tournament.matches) {
    const representative = [...match.games].sort((a: any, b: any) => b.turns - a.turns)[0];
    lines.push(`### ${names.get(match.left)} ${match.leftWins}:${match.rightWins} ${names.get(match.right)}`, ``, `代表局：${representative.turns}回合，${representative.highlights.opening}。`, representative.highlights.firstKo ? `首次击倒：${representative.highlights.firstKo}。` : "无首次击倒记录。", ...representative.highlights.keyEvents.slice(0, 5).map((event: string) => `- ${event}`), `残局：${representative.highlights.closing.join("；") || representative.highlights.finalState}`, ``);
  }
  lines.push(`## 季后赛`, ``);
  for (const series of [...tournament.playoffs.semiFinals, tournament.playoffs.final]) {
    const representative = [...series.games].sort((a: any, b: any) => b.turns - a.turns)[0];
    lines.push(`### ${series.label}：${names.get(series.left)} ${series.leftWins}:${series.rightWins} ${names.get(series.right)}`, ``, `${representative.highlights.opening}。${representative.highlights.firstKo || "无击倒"}。`, ...representative.highlights.keyEvents.slice(0, 6).map((event: string) => `- ${event}`), `晋级：**${names.get(series.winner)}**${series.tieBreak ? `（${series.tieBreak}）` : ""}`, ``);
  }
  lines.push(`## 冠军`, ``, `**${tournament.playoffs.champion.name}**`);
  return `${lines.join("\n")}\n`;
}

function parseMode(value: string): PoolMode {
  if (value === "custom" || value === "modern" || value === "combined" || value === "grand") return value;
  throw new Error("DRAFT_POOL must be custom, modern, combined, or grand");
}

function seededTie(value: string, pick: number): number {
  return Number.parseInt(crypto.createHash("sha256").update(`${seed}:${pick}:${value}`).digest("hex").slice(0, 8), 16);
}

function cloneSet(set: PokemonSet): PokemonSet {
  return JSON.parse(JSON.stringify(set)) as PokemonSet;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
