import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {Dex, Teams, toID} from "pokemon-showdown";
import type {ModdedDex} from "pokemon-showdown/dist/sim/dex";
import type {PokemonSet} from "pokemon-showdown/dist/sim/teams";
import {loadBenchmarkPool, benchmarkTeamPath} from "../src/eval/benchmarkPool";
import {analyzePublicLog, mergeCounts} from "../src/eval/logAnalysis";
import {runBattle} from "../src/showdown/battle";
import {loadTeam, writeTeam} from "../src/showdown/team";
import type {AiStrategy} from "../src/showdown/choice";

interface NamedTeam {
  id: string;
  name: string;
  sets: PokemonSet[];
  packed: string;
}

interface PairGameResult {
  gameIndex: number;
  orientation: "x-as-team-a" | "x-as-team-b";
  xScore: number | null;
  technical: boolean;
  turns: number;
}

interface PairResult {
  teamX: string;
  teamY: string;
  games: number;
  xWins: number;
  yWins: number;
  draws: number;
  technicalDraws: number;
  averageTurns: number;
  gameResults: PairGameResult[];
  xKos: Record<string, number>;
  xFailureReasons: Record<string, number>;
}

type RoleKey = keyof RoleVector;
type RoleVector = {
  hazards: number;
  removal: number;
  recovery: number;
  wish: number;
  pivot: number;
  setup: number;
  baton: number;
  weather: number;
  weatherRain: number;
  weatherSun: number;
  weatherSnow: number;
  weatherSand: number;
  trickRoom: number;
  screens: number;
  status: number;
  priority: number;
  physical: number;
  special: number;
};

const ROLE_WEIGHTS: Record<RoleKey, number> = {
  hazards: 4,
  removal: 4,
  recovery: 3,
  wish: 4,
  pivot: 3,
  setup: 3,
  baton: 5,
  weather: 4,
  weatherRain: 5,
  weatherSun: 5,
  weatherSnow: 5,
  weatherSand: 5,
  trickRoom: 5,
  screens: 4,
  status: 2,
  priority: 2,
  physical: 2,
  special: 2,
};

const format = "gen9mythicmonssandbox";
const ai: AiStrategy = "search";
const games = Number(process.env.AUDIT_GAMES || 2);
const maxTurns = 160;
const sourceTeamPath = process.env.SOURCE_TEAM_PATH || "output/g1-beedrill/team.export.txt";
const auditName = process.env.AUDIT_NAME || "G1 Beedrill";
const seed = process.env.AUDIT_SEED || "g1-beedrill-role-audit-v1";
const outDir = path.resolve(process.env.AUDIT_OUT || path.join("output", "g1-beedrill-role-audit"));
const replacementOverrides = process.env.AUDIT_REPLACEMENTS
  ? JSON.parse(process.env.AUDIT_REPLACEMENTS) as Record<string, number>
  : {};

async function main(): Promise<void> {
  if (!Number.isInteger(games) || games < 2 || games % 2 !== 0) {
    throw new Error(`AUDIT_GAMES must be an even integer of at least 2; received ${games}`);
  }
  fs.mkdirSync(outDir, {recursive: true});
  const pool = loadBenchmarkPool("benchmarks/gen9ou/index.json");
  const modernTeams = pool.benchmarks.map(entry => {
    const loaded = loadTeam(benchmarkTeamPath(pool, entry.team));
    return {id: entry.id, name: entry.name, sets: loaded.sets, packed: loaded.packed};
  });
  const source = loadTeam(sourceTeamPath).sets[0];
  const dex = dexForFormat(format);

  const sourceRole = roleVector(source, dex);
  const plan = modernTeams.map(host => {
    const ranked = host.sets.map((set, index) => ({
      index,
      distance: roleDistance(sourceRole, roleVector(set, dex)),
      replacedPokemon: set.name || set.species,
      replacedSpecies: set.species,
      replacedMoves: set.moves,
    })).sort((left, right) => left.distance - right.distance || left.index - right.index);
    const selected = replacementOverrides[host.id] === undefined
      ? ranked[0]
      : ranked.find(entry => entry.index === replacementOverrides[host.id]);
    if (!selected) throw new Error(`Invalid replacement slot for ${host.id}: ${replacementOverrides[host.id]}`);
    return {
      hostId: host.id,
      hostName: host.name,
      replacementSlot: selected.index,
      replacementSlotDisplay: selected.index + 1,
      roleDistance: selected.distance,
      replacedPokemon: selected.replacedPokemon,
      replacedSpecies: selected.replacedSpecies,
      replacedMoves: selected.replacedMoves,
    };
  });
  fs.writeFileSync(path.join(outDir, "replacement-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  const hostResults = [];
  for (const replacement of plan) {
    const host = modernTeams.find(team => team.id === replacement.hostId);
    if (!host) throw new Error(`Missing host ${replacement.hostId}`);
    const hybridSets = host.sets.map(cloneSet);
    hybridSets[replacement.replacementSlot] = cloneSet(source);
    const hybrid: NamedTeam = {
      id: `${toID(auditName) || "source"}-in-${host.id}`,
      name: `${auditName} in ${host.name}`,
      sets: hybridSets,
      packed: Teams.pack(hybridSets),
    };
    const hybridDir = path.join(outDir, "hybrids", hybrid.id);
    writeTeam(hybrid.sets, path.join(hybridDir, "team.export.txt"), "export");
    writeTeam(hybrid.sets, path.join(hybridDir, "team.json"), "json");

    const baselinePairs: PairResult[] = [];
    const hybridPairs: PairResult[] = [];
    for (const opponent of modernTeams.filter(team => team.id !== host.id)) {
      const pairSeed = `${seed}:${host.id}:${opponent.id}`;
      baselinePairs.push(await runBalancedPair(host, opponent, pairSeed, path.join(hybridDir, "baseline-vs", opponent.id)));
      hybridPairs.push(await runBalancedPair(hybrid, opponent, pairSeed, path.join(hybridDir, "hybrid-vs", opponent.id)));
    }
    const baseline = summarizePairs(baselinePairs);
    const hybridSummary = summarizePairs(hybridPairs);
    hostResults.push({
      ...replacement,
      hybridId: hybrid.id,
      baseline,
      hybrid: hybridSummary,
      deltaScore: round(hybridSummary.score - baseline.score),
      pairedDelta: pairedDeltaSummary(hybridPairs, baselinePairs),
      killContribution: mergePairSetCounts(hybridPairs, "xKos"),
      failureReasons: mergePairSetCounts(hybridPairs, "xFailureReasons"),
    });
    fs.writeFileSync(path.join(hybridDir, "summary.json"), `${JSON.stringify(hostResults.at(-1), null, 2)}\n`, "utf8");
  }

  const aggregate = {
    source: {
      auditName,
      sourceTeamPath: path.resolve(sourceTeamPath),
      name: source.name || source.species,
      species: source.species,
      item: source.item,
      ability: source.ability,
      moves: source.moves,
      role: sourceRole,
    },
    format,
    ai,
    gamesPerMatchup: games,
    maxTurns,
    seed,
    plan,
    hostResults,
    aggregate: {
      averageBaselineScore: round(average(hostResults.map(result => result.baseline.score))),
      averageHybridScore: round(average(hostResults.map(result => result.hybrid.score))),
      averageDeltaScore: round(average(hostResults.map(result => result.deltaScore))),
      bestHost: [...hostResults].sort((a, b) => b.deltaScore - a.deltaScore)[0]?.hostId ?? null,
      worstHost: [...hostResults].sort((a, b) => a.deltaScore - b.deltaScore)[0]?.hostId ?? null,
    },
    provenance: {
      showdownVersion: JSON.parse(fs.readFileSync(path.join("node_modules", "pokemon-showdown", "package.json"), "utf8")).version,
      sandboxModHash: hashDirectory(path.join("node_modules", "pokemon-showdown", "dist", "data", "mods", "mythicmons")),
    },
  };
  fs.writeFileSync(path.join(outDir, "summary.json"), `${JSON.stringify(aggregate, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "report.md"), renderReport(aggregate), "utf8");
  console.log(JSON.stringify(aggregate.aggregate, null, 2));
  console.log(`Report: ${path.join(outDir, "report.md")}`);
}

async function runBalancedPair(teamX: NamedTeam, teamY: NamedTeam, pairSeed: string, pairDir: string): Promise<PairResult> {
  let xWins = 0;
  let yWins = 0;
  let draws = 0;
  let technicalDraws = 0;
  let totalTurns = 0;
  const gameResults: PairGameResult[] = [];
  const xKos: Record<string, number> = {};
  const xFailureReasons: Record<string, number> = {};
  for (let gameIndex = 0; gameIndex < games / 2; gameIndex += 1) {
    const first = await runBattle({
      format, teamA: teamX.packed, teamB: teamY.packed, seed: pairSeed, gameIndex,
      outDir: path.join(pairDir, "x-as-team-a"), maxTurns, ai, openTeamSheets: true, traceAiDecisions: false,
    });
    const second = await runBattle({
      format, teamA: teamY.packed, teamB: teamX.packed, seed: pairSeed, gameIndex,
      outDir: path.join(pairDir, "x-as-team-b"), maxTurns, ai, openTeamSheets: true, traceAiDecisions: false,
    });
    for (const [result, xIsTeamA] of [[first, true], [second, false]] as const) {
      totalTurns += result.turns;
      const technical = result.stalled || result.timeout || !result.ended;
      if (technical) technicalDraws += 1;
      if (!result.winner) draws += 1;
      else if ((result.winner === "Team A") === xIsTeamA) xWins += 1;
      else yWins += 1;
      gameResults.push({
        gameIndex,
        orientation: xIsTeamA ? "x-as-team-a" : "x-as-team-b",
        xScore: technical || !result.winner ? technical ? null : 0.5 : (result.winner === "Team A") === xIsTeamA ? 1 : 0,
        technical,
        turns: result.turns,
      });
      const analysis = analyzePublicLog(result.publicLogPath, result.winner, result.turns, xIsTeamA ? "p1" : "p2");
      mergeCounts(xKos, xIsTeamA ? analysis.p1Kos : analysis.p2Kos);
      mergeCounts(xFailureReasons, analysis.failureSignals);
    }
  }
  return {teamX: teamX.id, teamY: teamY.id, games, xWins, yWins, draws, technicalDraws, averageTurns: totalTurns / games, gameResults, xKos, xFailureReasons};
}

function summarizePairs(pairs: PairResult[]) {
  const scores = pairs.flatMap(pair => pair.gameResults.map(game => game.xScore).filter((score): score is number => score !== null));
  return {
    games: pairs.reduce((total, pair) => total + pair.games, 0),
    scoredGames: scores.length,
    wins: pairs.reduce((total, pair) => total + pair.xWins, 0),
    losses: pairs.reduce((total, pair) => total + pair.yWins, 0),
    draws: pairs.reduce((total, pair) => total + pair.draws, 0),
    technicalDraws: pairs.reduce((total, pair) => total + pair.technicalDraws, 0),
    score: round(average(scores)),
    averageTurns: round(average(pairs.map(pair => pair.averageTurns))),
  };
}

function pairedDeltaSummary(matchups: PairResult[], references: PairResult[]) {
  const referenceByOpponent = new Map(references.map(reference => [reference.teamY, reference]));
  const deltas: number[] = [];
  for (const matchup of matchups) {
    const reference = referenceByOpponent.get(matchup.teamY);
    if (!reference) continue;
    const referenceGames = new Map(reference.gameResults.map(game => [`${game.gameIndex}:${game.orientation}`, game]));
    for (const game of matchup.gameResults) {
      const baseline = referenceGames.get(`${game.gameIndex}:${game.orientation}`);
      if (game.xScore === null || baseline?.xScore === null || baseline?.xScore === undefined) continue;
      deltas.push(game.xScore - baseline.xScore);
    }
  }
  return {
    mean: round(average(deltas)),
    pairs: deltas.length,
  };
}

function roleVector(set: PokemonSet, dex: ModdedDex): RoleVector {
  const ids = new Set((set.moves ?? []).map(toID));
  const vector: RoleVector = {
    hazards: hasAny(ids, ["stealthrock", "spikes", "toxicspikes", "stickyweb"]) ? 1 : 0,
    removal: hasAny(ids, ["rapidspin", "defog", "mortalspin", "tidyup", "courtchange"]) ? 1 : 0,
    recovery: hasAny(ids, ["recover", "roost", "softboiled", "slackoff", "synthesis", "morningsun", "moonlight", "rest", "shoreup", "strengthsap", "milkdrink"]) ? 1 : 0,
    wish: ids.has("wish") ? 1 : 0,
    pivot: hasAny(ids, ["uturn", "g1persianuturn", "voltswitch", "flipturn", "partingshot", "chillyreception", "teleport", "memento"]) ? 1 : 0,
    setup: hasAny(ids, ["swordsdance", "nastyplot", "dragondance", "calmmind", "coil", "bulkup", "cottondefense", "agility", "quiverdance", "shellsmash", "irondefense", "tidyup"]) ? 1 : 0,
    baton: ids.has("batonpass") ? 1 : 0,
    weather: hasAny(ids, ["raindance", "sunnyday", "snowscape", "hail", "sandstorm"]) ? 1 : 0,
    weatherRain: ids.has("raindance") ? 1 : 0,
    weatherSun: ids.has("sunnyday") ? 1 : 0,
    weatherSnow: ids.has("snowscape") || ids.has("hail") ? 1 : 0,
    weatherSand: ids.has("sandstorm") ? 1 : 0,
    trickRoom: ids.has("trickroom") ? 1 : 0,
    screens: hasAny(ids, ["reflect", "lightscreen", "auroraveil", "tailwind"]) ? 1 : 0,
    status: hasAny(ids, ["toxic", "willowisp", "thunderwave", "yawn", "spore", "sleeppowder", "leechseed", "taunt", "encore", "haze", "destinybond", "memento", "snarl", "chillingwater"]) ? 1 : 0,
    priority: 0,
    physical: 0,
    special: 0,
  };
  let damaging = 0;
  for (const moveName of set.moves ?? []) {
    const move = dex.moves.get(moveName);
    if (!move.exists || move.category === "Status") continue;
    damaging += 1;
    if (move.category === "Physical") vector.physical += 1;
    else vector.special += 1;
    if (move.priority > 0) vector.priority = 1;
  }
  if (damaging) {
    vector.physical /= damaging;
    vector.special /= damaging;
  }
  const abilities = sourceAbilityIds(dex, set.ability);
  if (hasAny(abilities, ["drizzle", "primordialsea"])) vector.weatherRain = 1;
  if (hasAny(abilities, ["drought", "desolateland", "orichalcumpulse"])) vector.weatherSun = 1;
  if (hasAny(abilities, ["snowwarning"])) vector.weatherSnow = 1;
  if (hasAny(abilities, ["sandstream"])) vector.weatherSand = 1;
  if (vector.weatherRain || vector.weatherSun || vector.weatherSnow || vector.weatherSand) vector.weather = 1;
  if (hasAny(abilities, ["regenerator"])) vector.pivot = 1;
  if (hasAny(abilities, ["speedboost", "moody"])) vector.setup = 1;
  if (hasAny(abilities, ["prankster", "magicbounce", "magicbouncestatuspriority"])) vector.status = 1;
  if (hasAny(abilities, ["statusmovesplusonepriority", "magicbouncestatuspriority"])) vector.priority = 1;
  return vector;
}

function roleDistance(left: RoleVector, right: RoleVector): number {
  return round((Object.keys(ROLE_WEIGHTS) as RoleKey[]).reduce((sum, key) => {
    return sum + Math.abs(left[key] - right[key]) * ROLE_WEIGHTS[key];
  }, 0));
}

function dexForFormat(formatId: string): ModdedDex {
  const formatData = Dex.formats.get(formatId);
  return Dex.mod(formatData.mod || `gen${formatData.gen || 9}`);
}

function sourceAbilityIds(dex: ModdedDex, abilityName = ""): Set<string> {
  const ability = dex.abilities.get(abilityName);
  const ids = new Set<string>([ability.id].filter(Boolean));
  const source = (ability as unknown as {mythicSourceAbilities?: string[]}).mythicSourceAbilities ?? [];
  for (const id of source) ids.add(toID(id));
  return ids;
}

function mergePairSetCounts(pairs: PairResult[], key: "xKos" | "xFailureReasons"): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const pair of pairs) mergeCounts(counts, pair[key] ?? {});
  return counts;
}

function hasAny(values: Set<string>, candidates: string[]): boolean {
  return candidates.some(candidate => values.has(candidate));
}

function cloneSet(set: PokemonSet): PokemonSet {
  return JSON.parse(JSON.stringify(set)) as PokemonSet;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function hashDirectory(root: string): string {
  const hash = crypto.createHash("sha256");
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).replace(/\\/g, "/");
      hash.update(relative);
      if (entry.isDirectory()) visit(absolute);
      else hash.update(fs.readFileSync(absolute));
    }
  };
  visit(root);
  return hash.digest("hex");
}

function renderReport(summary: {
  source: {auditName: string; name: string; species: string; item: string; ability: string; moves: string[]; role: RoleVector};
  hostResults: Array<{
    hostId: string;
    hostName: string;
    replacementSlotDisplay: number;
    replacedPokemon: string;
    replacedSpecies: string;
    roleDistance: number;
    baseline: ReturnType<typeof summarizePairs>;
    hybrid: ReturnType<typeof summarizePairs>;
    deltaScore: number;
    pairedDelta: {mean: number; pairs: number};
    killContribution: Record<string, number>;
    failureReasons: Record<string, number>;
  }>;
  aggregate: Record<string, unknown>;
  gamesPerMatchup: number;
  ai: AiStrategy;
  maxTurns: number;
}): string {
  const lines = [
    `# ${summary.source.auditName} Role Replacement Audit`,
    "",
    `AI: ${summary.ai}`,
    `Games per matchup: ${summary.gamesPerMatchup}`,
    `Max turns: ${summary.maxTurns}`,
    "",
    "## Source role",
    "",
    `Pokemon: ${summary.source.name} (${summary.source.species})`,
    `Ability: ${summary.source.ability}`,
    `Item: ${summary.source.item}`,
    `Moves: ${summary.source.moves.join(", ")}`,
    `Role vector: ${JSON.stringify(summary.source.role)}`,
    "",
    "## Aggregate",
    "",
    "```json",
    JSON.stringify(summary.aggregate, null, 2),
    "```",
    "",
    "## Host results",
    "",
    "| Host | Replaced | Slot | Distance | Baseline | Hybrid | Delta | Paired delta |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const result of summary.hostResults) {
    lines.push(`| ${result.hostName} | ${result.replacedPokemon} (${result.replacedSpecies}) | ${result.replacementSlotDisplay} | ${result.roleDistance} | ${result.baseline.score} | ${result.hybrid.score} | ${result.deltaScore} | ${result.pairedDelta.mean} |`);
  }
  return `${lines.join("\n")}\n`;
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
