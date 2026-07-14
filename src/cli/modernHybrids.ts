import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {Dex, Teams, toID} from "pokemon-showdown";
import type {ModdedDex} from "pokemon-showdown/dist/sim/dex";
import type {PokemonSet} from "pokemon-showdown/dist/sim/teams";
import {loadBenchmarkPool, benchmarkTeamPath} from "../eval/benchmarkPool";
import {analyzePublicLog, mergeCounts} from "../eval/logAnalysis";
import {runBattle} from "../showdown/battle";
import {booleanArg, parseArgs, numberArg, stringArg} from "../showdown/args";
import {AI_VERSION, type AiStrategy} from "../showdown/choice";
import {loadTeam, writeTeam} from "../showdown/team";

interface NamedTeam {
  id: string;
  name: string;
  sets: PokemonSet[];
  packed: string;
}

export interface PairResult {
  teamX: string;
  teamY: string;
  games: number;
  xWins: number;
  yWins: number;
  draws: number;
  technicalDraws: number;
  averageTurns: number;
  gameResults?: PairGameResult[];
  xKos?: Record<string, number>;
  xFailureReasons?: Record<string, number>;
}

export interface PairGameResult {
  gameIndex: number;
  orientation: "x-as-team-a" | "x-as-team-b";
  xScore: number | null;
  technical: boolean;
  turns: number;
}

interface HybridResult {
  id: string;
  sourceTeam: string;
  sourcePokemon: string;
  hostId: string;
  hostName: string;
  replacedPokemon: string;
  replacementSlot: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  technicalDraws: number;
  score: number;
  scoreLowerBound: number;
  scoreTechnicalDrawHalf: number;
  scoreUpperBound: number;
  hostBaselineScore: number;
  delta: number;
  pairedDeltaLow: number | null;
  pairedDeltaHigh: number | null;
  pairedSeedPairs: number;
  averageTurns: number;
  killContribution: Record<string, number>;
  failureReasons: Record<string, number>;
  matchups: PairResult[];
}

type ReplacementMode = "all" | "role";

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
  hazards: 5,
  removal: 5,
  recovery: 3,
  wish: 4,
  pivot: 4,
  setup: 3,
  baton: 6,
  weather: 10,
  weatherRain: 2,
  weatherSun: 2,
  weatherSnow: 2,
  weatherSand: 2,
  trickRoom: 6,
  screens: 4,
  status: 2,
  priority: 2,
  physical: 2,
  special: 2,
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const poolPath = stringArg(args, "benchmarks", "benchmarks/gen9ou/index.json");
  const g1Path = stringArg(args, "g1", "output/g1/recompiled-current/team.export.txt");
  const g2Path = stringArg(args, "g2", "output/g2/recompiled-current/team.export.txt");
  const format = stringArg(args, "format", "gen9mythicmonssandbox");
  const seed = stringArg(args, "seed", "modern-hybrids-v1");
  const games = numberArg(args, "games", 10, {integer: true, min: 1});
  const maxTurns = numberArg(args, "maxTurns", 200, {integer: true, min: 1});
  const outDir = path.resolve(stringArg(args, "out", "output/modern-hybrids"));
  const ai = parseAi(stringArg(args, "ai", "search"));
  const openTeamSheets = booleanArg(args, "open-team-sheets", ai === "search");
  const traceAiDecisions = booleanArg(args, "ai-trace", false);
  const dryRun = booleanArg(args, "dry-run", false);
  const rebuild = booleanArg(args, "rebuild", false);
  const replacementMode = parseReplacementMode(stringArg(args, "replacement-mode", "all"));
  if (!Number.isInteger(games) || games < 2 || games % 2 !== 0) {
    throw new Error("--games must be a positive even number so each seed is run in both orientations");
  }
  if (rebuild) {
    rebuildExistingSummary(outDir);
    return;
  }

  const pool = loadBenchmarkPool(poolPath);
  const modernTeams = pool.benchmarks.map(entry => {
    const loaded = loadTeam(benchmarkTeamPath(pool, entry.team));
    return {id: entry.id, name: entry.name, sets: loaded.sets, packed: loaded.packed};
  });
  const sources = [
    ...loadTeam(g1Path).sets.map(set => ({sourceTeam: "G1", set})),
    ...loadTeam(g2Path).sets.map(set => ({sourceTeam: "G2", set})),
  ];
  if (sources.length !== 12) throw new Error(`Expected 12 G1/G2 Pokemon, found ${sources.length}`);
  fs.mkdirSync(outDir, {recursive: true});

  const dex = dexForFormat(format);
  const plannedHybrids = sources.flatMap(source => modernTeams.flatMap(host => {
    return replacementSlots(source.set, host.sets, dex, replacementMode).map(replacementSlot => ({
      source,
      host,
      replacementSlot,
    }));
  }));
  const replacementPlan = plannedHybrids.map(({source, host, replacementSlot}) => ({
      sourceTeam: source.sourceTeam,
      sourcePokemon: source.set.name || source.set.species,
      hostId: host.id,
      replacementSlot: replacementSlot + 1,
      replacedPokemon: host.sets[replacementSlot].name || host.sets[replacementSlot].species,
  }));
  fs.writeFileSync(path.join(outDir, "replacement-plan.json"), `${JSON.stringify(replacementPlan, null, 2)}\n`, "utf8");
  if (dryRun) {
    console.table(replacementPlan);
    return;
  }
  const baselineDir = path.join(outDir, "baseline-round-robin");
  const baselinePairs: PairResult[] = [];
  for (let left = 0; left < modernTeams.length; left += 1) {
    for (let right = left + 1; right < modernTeams.length; right += 1) {
      const teamX = modernTeams[left];
      const teamY = modernTeams[right];
      console.log(`[baseline] ${teamX.id} vs ${teamY.id}`);
      baselinePairs.push(await runBalancedPair(
        teamX,
        teamY,
        games,
        format,
        ai,
        openTeamSheets,
        traceAiDecisions,
        `${seed}:baseline:${teamX.id}:${teamY.id}`,
        maxTurns,
        path.join(baselineDir, `${teamX.id}-vs-${teamY.id}`),
      ));
    }
  }
  const baselineScores = baselinePoolScores(modernTeams, baselinePairs, games);

  const hostReferenceMatchups: Record<string, PairResult[]> = {};
  const hostReferenceScores: Record<string, number> = {};
  for (const host of modernTeams) {
    const referenceResults: PairResult[] = [];
    for (const opponent of modernTeams) {
      console.log(`[reference] ${host.id} vs ${opponent.id}`);
      referenceResults.push(await runBalancedPair(
        host,
        opponent,
        games,
        format,
        ai,
        openTeamSheets,
        traceAiDecisions,
        commonComparisonSeed(seed, host.id, opponent.id),
        maxTurns,
        path.join(outDir, "host-references", host.id, opponent.id),
      ));
    }
    hostReferenceMatchups[host.id] = referenceResults;
    hostReferenceScores[host.id] = summarizeCandidate(referenceResults).score;
  }

  const hybridResults: HybridResult[] = [];
  for (const {source, host, replacementSlot} of plannedHybrids) {
      const replaced = host.sets[replacementSlot];
      const hybridSets = host.sets.map((set, index) => index === replacementSlot ? cloneSet(source.set) : cloneSet(set));
      const sourceName = source.set.name || source.set.species;
      const hybridId = `${source.sourceTeam.toLowerCase()}-${toID(sourceName)}-in-${host.id}-slot${replacementSlot + 1}`;
      const hybrid: NamedTeam = {
        id: hybridId,
        name: `${host.name} + ${sourceName}`,
        sets: hybridSets,
        packed: Teams.pack(hybridSets),
      };
      const hybridDir = path.join(outDir, "hybrids", hybridId);
      writeTeam(hybridSets, path.join(hybridDir, "team.export.txt"), "export");
      writeTeam(hybridSets, path.join(hybridDir, "team.json"), "json");

      const matchups: PairResult[] = [];
      for (const opponent of modernTeams) {
        console.log(`[hybrid ${hybridResults.length + 1}/${plannedHybrids.length}] ${hybridId} vs ${opponent.id}`);
        matchups.push(await runBalancedPair(
          hybrid,
          opponent,
          games,
          format,
          ai,
          openTeamSheets,
          traceAiDecisions,
          commonComparisonSeed(seed, host.id, opponent.id),
          maxTurns,
          path.join(hybridDir, "matchups", opponent.id),
        ));
      }
      const totals = summarizeCandidate(matchups);
      const hostBaselineScore = hostReferenceScores[host.id];
      const paired = pairedDeltaSummary(matchups, hostReferenceMatchups[host.id]);
      const killContribution = mergePairCounts(matchups, "xKos");
      const failureReasons = mergePairCounts(matchups, "xFailureReasons");
      hybridResults.push({
        id: hybridId,
        sourceTeam: source.sourceTeam,
        sourcePokemon: sourceName,
        hostId: host.id,
        hostName: host.name,
        replacedPokemon: replaced.name || replaced.species,
        replacementSlot: replacementSlot + 1,
        games: totals.games,
        wins: totals.wins,
        losses: totals.losses,
        draws: totals.draws,
        technicalDraws: totals.technicalDraws,
        score: totals.score,
        scoreLowerBound: totals.scoreLowerBound,
        scoreTechnicalDrawHalf: totals.scoreTechnicalDrawHalf,
        scoreUpperBound: totals.scoreUpperBound,
        hostBaselineScore,
        delta: paired.mean,
        pairedDeltaLow: paired.low,
        pairedDeltaHigh: paired.high,
        pairedSeedPairs: paired.pairs,
        averageTurns: totals.averageTurns,
        killContribution,
        failureReasons,
        matchups,
      });
      fs.writeFileSync(path.join(hybridDir, "summary.json"), `${JSON.stringify(hybridResults.at(-1), null, 2)}\n`, "utf8");
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    format,
    ai,
    aiVersion: AI_VERSION,
    openTeamSheets,
    traceAiDecisions,
    seed,
    gamesPerMatchup: games,
    independentSeedPairsPerMatchup: games / 2,
    orientationPolicy: "paired seeds, half games in each orientation",
    comparisonSeedPolicy: "host reference and every replacement variant share host/opponent/gameIndex seeds",
    replacementMode,
    replacementPolicyVersion: replacementMode === "all" ? "all-six-slots-v1" : "role-vector-v2",
    rulesetNotice: format === pool.format
      ? `Runs use ${format}`
      : `Benchmark teams originate from ${pool.format}, but all matrix battles run in ${format}; results are sandbox-modern, not strict OU legality claims`,
    modernTeamCount: modernTeams.length,
    sourcePokemonCount: sources.length,
    hybridTeamCount: hybridResults.length,
    baselinePairs,
    baselineScores,
    hostReferenceMatchups,
    hostReferenceScores,
    hybridResults,
    sourceSummary: summarizeSources(hybridResults),
    benchmarkCoverage: benchmarkCoverage(pool.benchmarks.map(benchmark => benchmark.archetype)),
    provenance: createMatrixProvenance(format, poolPath, modernTeams, sources, replacementPlan),
  };
  fs.writeFileSync(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "report.md"), renderReport(summary), "utf8");
  console.log(`Report: ${path.join(outDir, "report.md")}`);
}

async function runBalancedPair(
  teamX: NamedTeam,
  teamY: NamedTeam,
  games: number,
  format: string,
  ai: AiStrategy,
  openTeamSheets: boolean,
  traceAiDecisions: boolean,
  seed: string,
  maxTurns: number,
  outDir: string,
): Promise<PairResult> {
  let xWins = 0;
  let yWins = 0;
  let draws = 0;
  let technicalDraws = 0;
  let totalTurns = 0;
  const gameResults: PairGameResult[] = [];
  const xKos: Record<string, number> = {};
  const xFailureReasons: Record<string, number> = {};
  const pairs = games / 2;
  for (let gameIndex = 0; gameIndex < pairs; gameIndex += 1) {
    const first = await runBattle({
      format, teamA: teamX.packed, teamB: teamY.packed, seed, gameIndex,
      outDir: path.join(outDir, "x-as-team-a"), maxTurns, ai, openTeamSheets, traceAiDecisions,
    });
    const second = await runBattle({
      format, teamA: teamY.packed, teamB: teamX.packed, seed, gameIndex,
      outDir: path.join(outDir, "x-as-team-b"), maxTurns, ai, openTeamSheets, traceAiDecisions,
    });
    for (const [result, xIsTeamA] of [[first, true], [second, false]] as const) {
      totalTurns += result.turns;
      const technical = result.stalled || result.timeout || !result.ended;
      if (technical) technicalDraws += 1;
      if (!result.winner) draws += 1;
      else if ((result.winner === "Team A") === xIsTeamA) xWins += 1;
      else yWins += 1;
      const xScore = technical || !result.winner
        ? technical ? null : 0.5
        : (result.winner === "Team A") === xIsTeamA ? 1 : 0;
      gameResults.push({
        gameIndex,
        orientation: xIsTeamA ? "x-as-team-a" : "x-as-team-b",
        xScore,
        technical,
        turns: result.turns,
      });
      const analysis = analyzePublicLog(result.publicLogPath, result.winner, result.turns, xIsTeamA ? "p1" : "p2");
      mergeCounts(xKos, xIsTeamA ? analysis.p1Kos : analysis.p2Kos);
      mergeCounts(xFailureReasons, analysis.failureSignals);
    }
  }
  return {
    teamX: teamX.id,
    teamY: teamY.id,
    games,
    xWins,
    yWins,
    draws,
    technicalDraws,
    averageTurns: totalTurns / games,
    gameResults,
    xKos,
    xFailureReasons,
  };
}

function baselinePoolScores(teams: NamedTeam[], pairs: PairResult[], games: number): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const team of teams) {
    let points = games * 0.5;
    let total = games;
    for (const pair of pairs) {
      const completedDraws = Math.max(0, pair.draws - pair.technicalDraws);
      const scoredGames = pair.games - pair.technicalDraws;
      if (pair.teamX === team.id) {
        points += pair.xWins + completedDraws * 0.5;
        total += scoredGames;
      } else if (pair.teamY === team.id) {
        points += pair.yWins + completedDraws * 0.5;
        total += scoredGames;
      }
    }
    scores[team.id] = points / total;
  }
  return scores;
}

export function summarizeCandidate(matchups: PairResult[]) {
  const games = matchups.reduce((sum, result) => sum + result.games, 0);
  const wins = matchups.reduce((sum, result) => sum + result.xWins, 0);
  const losses = matchups.reduce((sum, result) => sum + result.yWins, 0);
  const draws = matchups.reduce((sum, result) => sum + result.draws, 0);
  const technicalDraws = matchups.reduce((sum, result) => sum + result.technicalDraws, 0);
  const totalTurns = matchups.reduce((sum, result) => sum + result.averageTurns * result.games, 0);
  const completedDraws = Math.max(0, draws - technicalDraws);
  const scoredGames = Math.max(1, wins + losses + completedDraws);
  const completedPoints = wins + completedDraws * 0.5;
  return {
    games,
    wins,
    losses,
    draws,
    technicalDraws,
    score: completedPoints / scoredGames,
    scoreLowerBound: completedPoints / Math.max(1, games),
    scoreTechnicalDrawHalf: (completedPoints + technicalDraws * 0.5) / Math.max(1, games),
    scoreUpperBound: (completedPoints + technicalDraws) / Math.max(1, games),
    averageTurns: totalTurns / games,
  };
}

function rebuildExistingSummary(outDir: string): void {
  const summaryPath = path.join(outDir, "summary.json");
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as {
    gamesPerMatchup: number;
    baselinePairs: PairResult[];
    baselineScores: Record<string, number>;
    hybridResults: HybridResult[];
    sourceSummary: ReturnType<typeof summarizeSources>;
    format: string;
    ai: AiStrategy;
    aiVersion: string;
  };
  const teams = Object.keys(summary.baselineScores).map(id => ({id})) as NamedTeam[];
  summary.baselineScores = baselinePoolScores(teams, summary.baselinePairs, summary.gamesPerMatchup);
  summary.hybridResults = summary.hybridResults.map(result => {
    const totals = summarizeCandidate(result.matchups);
    const hostBaselineScore = summary.baselineScores[result.hostId];
    return {
      ...result,
      ...totals,
      hostBaselineScore,
      delta: totals.score - hostBaselineScore,
      pairedDeltaLow: result.pairedDeltaLow ?? null,
      pairedDeltaHigh: result.pairedDeltaHigh ?? null,
      pairedSeedPairs: result.pairedSeedPairs ?? 0,
      killContribution: result.killContribution ?? mergePairCounts(result.matchups, "xKos"),
      failureReasons: result.failureReasons ?? mergePairCounts(result.matchups, "xFailureReasons"),
    };
  });
  summary.sourceSummary = summarizeSources(summary.hybridResults);
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "report.md"), renderReport(summary), "utf8");
  for (const result of summary.hybridResults) {
    fs.writeFileSync(path.join(outDir, "hybrids", result.id, "summary.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  console.log(`Rebuilt report: ${path.join(outDir, "report.md")}`);
}

function bestRoleReplacement(source: PokemonSet, host: PokemonSet[], dex: ModdedDex): number {
  const sourceRole = roleVector(source, dex);
  const ranked = host.map((set, index) => ({index, distance: roleDistance(sourceRole, roleVector(set, dex))}));
  ranked.sort((left, right) => left.distance - right.distance || left.index - right.index);
  return ranked[0].index;
}

function replacementSlots(source: PokemonSet, host: PokemonSet[], dex: ModdedDex, mode: ReplacementMode): number[] {
  if (mode === "all") return host.map((_, index) => index);
  return [bestRoleReplacement(source, host, dex)];
}

function commonComparisonSeed(seed: string, hostId: string, opponentId: string): string {
  return `${seed}:comparison:${hostId}:${opponentId}`;
}

export function pairedDeltaSummary(matchups: PairResult[], references: PairResult[]): {
  mean: number;
  low: number | null;
  high: number | null;
  pairs: number;
} {
  const referenceByOpponent = new Map(references.map(reference => [reference.teamY, reference]));
  const clusterDeltas: number[] = [];
  for (const matchup of matchups) {
    const reference = referenceByOpponent.get(matchup.teamY);
    if (!reference?.gameResults || !matchup.gameResults) continue;
    const referenceGames = new Map(reference.gameResults.map(game => [`${game.gameIndex}:${game.orientation}`, game]));
    const byIndex = new Map<number, number[]>();
    for (const game of matchup.gameResults) {
      const baseline = referenceGames.get(`${game.gameIndex}:${game.orientation}`);
      if (game.xScore === null || baseline?.xScore === null || baseline?.xScore === undefined) continue;
      const values = byIndex.get(game.gameIndex) ?? [];
      values.push(game.xScore - baseline.xScore);
      byIndex.set(game.gameIndex, values);
    }
    for (const values of byIndex.values()) clusterDeltas.push(average(values));
  }
  if (!clusterDeltas.length) return {mean: 0, low: null, high: null, pairs: 0};
  const mean = average(clusterDeltas);
  if (clusterDeltas.length < 2) return {mean, low: null, high: null, pairs: clusterDeltas.length};
  const variance = clusterDeltas.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (clusterDeltas.length - 1);
  const margin = 1.96 * Math.sqrt(variance / clusterDeltas.length);
  return {mean, low: mean - margin, high: mean + margin, pairs: clusterDeltas.length};
}

function mergePairCounts(matchups: PairResult[], key: "xKos" | "xFailureReasons"): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const matchup of matchups) mergeCounts(counts, matchup[key] ?? {});
  return counts;
}

function createMatrixProvenance(
  format: string,
  poolPath: string,
  modernTeams: NamedTeam[],
  sources: Array<{sourceTeam: string; set: PokemonSet}>,
  replacementPlan: Array<Record<string, unknown>>,
) {
  const showdownPackagePath = path.join(process.cwd(), "node_modules", "pokemon-showdown", "package.json");
  const showdownVersion = JSON.parse(fs.readFileSync(showdownPackagePath, "utf8")).version as string;
  const sandboxRoot = path.join(process.cwd(), "node_modules", "pokemon-showdown", "dist", "data", "mods", "mythicmons");
  const customFormatsPath = path.join(process.cwd(), "node_modules", "pokemon-showdown", "dist", "config", "custom-formats.js");
  return {
    nodeVersion: process.version,
    showdownVersion,
    aiVersion: AI_VERSION,
    format,
    benchmarkPoolHash: sha256(JSON.stringify({manifest: fs.readFileSync(poolPath, "utf8"), teams: modernTeams.map(team => [team.id, team.packed])})),
    sourceTeamHash: sha256(JSON.stringify(sources.map(source => [source.sourceTeam, source.set]))),
    replacementPlanHash: sha256(JSON.stringify(replacementPlan)),
    sandboxModHash: fs.existsSync(sandboxRoot) ? hashDirectory(sandboxRoot) : null,
    customFormatsHash: fs.existsSync(customFormatsPath) ? sha256(fs.readFileSync(customFormatsPath)) : null,
  };
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

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function benchmarkCoverage(archetypes: string[]) {
  const counts: Record<string, number> = {};
  for (const archetype of archetypes) counts[archetype] = (counts[archetype] ?? 0) + 1;
  const warnings = Object.entries(counts)
    .filter(([, count]) => count < 3)
    .map(([archetype, count]) => `${archetype} has only ${count} benchmark team(s); target at least 3`);
  return {archetypeCounts: counts, warnings};
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
  if (hasAny(abilities, ["allmovesplusonepriority", "statusmovesplusonepriority", "magicbouncestatuspriority"])) vector.priority = 1;
  return vector;
}

function roleDistance(left: RoleVector, right: RoleVector): number {
  return (Object.keys(ROLE_WEIGHTS) as RoleKey[]).reduce((sum, key) => {
    return sum + Math.abs(left[key] - right[key]) * ROLE_WEIGHTS[key];
  }, 0);
}

function sourceAbilityIds(dex: ModdedDex, abilityName: string): Set<string> {
  const id = toID(abilityName);
  const ability = dex.abilities.get(id) as unknown as {mythicSourceAbilities?: readonly string[]};
  return new Set([id, ...(ability.mythicSourceAbilities ?? []).map(toID)]);
}

function hasAny(values: Set<string>, candidates: string[]): boolean {
  return candidates.some(candidate => values.has(candidate));
}

function cloneSet(set: PokemonSet): PokemonSet {
  return JSON.parse(JSON.stringify(set)) as PokemonSet;
}

function dexForFormat(format: string): ModdedDex {
  const formatData = Dex.formats.get(format);
  return Dex.mod(formatData.mod || `gen${formatData.gen || 9}`);
}

function summarizeSources(results: HybridResult[]) {
  const grouped = new Map<string, HybridResult[]>();
  for (const result of results) {
    const entries = grouped.get(result.sourcePokemon) ?? [];
    entries.push(result);
    grouped.set(result.sourcePokemon, entries);
  }
  return [...grouped.entries()].map(([sourcePokemon, entries]) => {
    const ordered = [...entries].sort((a, b) => a.delta - b.delta);
    const best = ordered.at(-1)!;
    const worst = ordered[0];
    return {
      sourcePokemon,
      sourceTeam: entries[0].sourceTeam,
      averageScore: average(entries.map(entry => entry.score)),
      averageDelta: average(entries.map(entry => entry.delta)),
      medianDelta: median(entries.map(entry => entry.delta)),
      bestHost: best.hostId,
      bestSlot: best.replacementSlot,
      bestDelta: best.delta,
      worstHost: worst.hostId,
      worstSlot: worst.replacementSlot,
      worstDelta: worst.delta,
      technicalDraws: entries.reduce((sum, entry) => sum + entry.technicalDraws, 0),
    };
  }).sort((a, b) => b.averageDelta - a.averageDelta);
}

function renderReport(summary: {
  format: string;
  ai: AiStrategy;
  aiVersion: string;
  openTeamSheets?: boolean;
  traceAiDecisions?: boolean;
  gamesPerMatchup: number;
  independentSeedPairsPerMatchup?: number;
  replacementMode?: ReplacementMode;
  rulesetNotice?: string;
  benchmarkCoverage?: {archetypeCounts: Record<string, number>; warnings: string[]};
  baselineScores: Record<string, number>;
  baselinePairs: PairResult[];
  hybridResults: HybridResult[];
  sourceSummary: ReturnType<typeof summarizeSources>;
}): string {
  const lines = [
    "# Sandbox Modern Hybrid Matrix",
    "",
    `- Format: ${summary.format}`,
    `- AI: ${summary.ai}`,
    `- AI version: ${summary.aiVersion}`,
    `- Open team sheets: ${summary.openTeamSheets ?? false}`,
    `- AI decision trace: ${summary.traceAiDecisions ?? false}`,
    `- Games per matchup: ${summary.gamesPerMatchup} (paired orientations)`,
    `- Independent seed pairs per matchup: ${summary.independentSeedPairsPerMatchup ?? summary.gamesPerMatchup / 2}`,
    `- Replacement mode: ${summary.replacementMode ?? "legacy-role"}`,
    `- Ruleset notice: ${summary.rulesetNotice ?? "legacy report; inspect format before interpreting legality"}`,
    "",
    "## Baseline modern teams",
    "",
    "| Team | Pool score |",
    "|---|---:|",
  ];
  for (const [team, score] of Object.entries(summary.baselineScores).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${team} | ${percent(score)} |`);
  }
  if (summary.benchmarkCoverage?.warnings.length) {
    lines.push("", "## Coverage warnings", "", ...summary.benchmarkCoverage.warnings.map(warning => `- ${warning}`));
  }
  lines.push("", "## G1/G2 Pokemon contribution", "", "| Pokemon | Group | Average score | Average delta | Median delta | Best host/slot | Best delta | Worst host/slot | Worst delta | Tech |", "|---|---|---:|---:|---:|---|---:|---|---:|---:|");
  for (const row of summary.sourceSummary) {
    lines.push(`| ${row.sourcePokemon} | ${row.sourceTeam} | ${percent(row.averageScore)} | ${signedPercent(row.averageDelta)} | ${signedPercent(row.medianDelta)} | ${row.bestHost}/${row.bestSlot} | ${signedPercent(row.bestDelta)} | ${row.worstHost}/${row.worstSlot} | ${signedPercent(row.worstDelta)} | ${row.technicalDraws} |`);
  }
  lines.push("", "## Hybrid teams", "", "| Hybrid | Replaced | Score | Tech bounds | Host baseline | Paired delta (95% CI) | W-L-D-T | Source KOs | Avg turns |", "|---|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of [...summary.hybridResults].sort((a, b) => b.delta - a.delta)) {
    const interval = row.pairedDeltaLow === null || row.pairedDeltaHigh === null
      ? signedPercent(row.delta)
      : `${signedPercent(row.delta)} [${signedPercent(row.pairedDeltaLow)}, ${signedPercent(row.pairedDeltaHigh)}]`;
    lines.push(`| ${row.id} | ${row.replacedPokemon} | ${percent(row.score)} | ${percent(row.scoreLowerBound)}-${percent(row.scoreUpperBound)} | ${percent(row.hostBaselineScore)} | ${interval} | ${row.wins}-${row.losses}-${row.draws}-${row.technicalDraws} | ${row.killContribution[row.sourcePokemon] ?? 0} | ${row.averageTurns.toFixed(1)} |`);
  }
  lines.push("", "Primary score excludes technical draws; bounds treat every technical draw as a loss or win. Delta uses common-random-number seed pairs against the matching host reference.", "");
  return lines.join("\n");
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function signedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} pp`;
}

function parseAi(value: string): AiStrategy {
  if (value === "first" || value === "damage" || value === "basic" || value === "tactical" || value === "search") return value;
  throw new Error("--ai must be one of: basic, damage, first, search, tactical");
}

function parseReplacementMode(value: string): ReplacementMode {
  if (value === "all" || value === "role") return value;
  throw new Error("--replacement-mode must be one of: all, role");
}

if (require.main === module) {
  void main().catch(error => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
