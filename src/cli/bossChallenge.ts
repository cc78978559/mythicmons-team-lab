import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {Dex, Teams, toID} from "pokemon-showdown";
import type {PokemonSet} from "pokemon-showdown/dist/sim/teams";
import {compileSandboxTeam} from "../sandbox/compiler";
import {installCompiledSandbox} from "../sandbox/installer";
import type {SandboxTeam} from "../sandbox/types";
import {runBattle} from "../showdown/battle";
import type {AiTacticalProfile} from "../showdown/choice";
import {extractKeyBattleDecisions} from "../draft/battleDecisionExtractor";
import {RED_BOSS, assertBossAssetsExcluded, initialBossState, recordBossChallenge, volunteerChallengeOrder, type BossQualifierEntrant, type BossState} from "../draft/bossLeague";
import {extractTacticalEpisode, tacticalFamilyValue, updateTacticalMemory, type TacticalEpisode, type TacticalMemory} from "../draft/tacticalMemory";

interface StoredMember {
  assetId: string;
  family: string;
  pokemon: string;
  scarcity: string;
  economicClass: "background" | "limited" | "unique";
  configuredSet: PokemonSet;
  appearances: number;
  kos: number;
  roles: string[];
}

interface StoredRoster {
  managerId: string;
  manager: string;
  tactics: AiTacticalProfile;
  traits: Record<string, number>;
  members: StoredMember[];
  tacticalMemory?: TacticalMemory;
}

interface Challenger extends BossQualifierEntrant {
  name: string;
  tactics: AiTacticalProfile;
  roster: StoredMember[];
  lineup: StoredMember[];
  tacticalMemory?: TacticalMemory;
}

interface SeriesResult {
  id: string;
  left: string;
  right: string;
  leftWins: number;
  rightWins: number;
  draws: number;
  winner: string | null;
  games: Array<Record<string, unknown>>;
}

const leagueDir = path.resolve(argument("league", "output/draft-league-v12-final"));
const season = Number(argument("season", "9"));
const outDir = path.resolve(argument("out", "output/boss-red-open-test"));
const snapshotDir = path.resolve(argument("registry", path.join(leagueDir, "config-snapshots", "51ae32b4b2940e7fb43ea4561091489fb5749cd6d6a2743fa2738a816a4b99c5")));
const bossPath = path.resolve(argument("boss", "data/bosses/g1-red.json"));
const seed = argument("seed", "red-boss-challenge-v1");
const maxTurns = Number(argument("max-turns", "180"));
const completeTestField = /^(1|true|yes)$/i.test(argument("complete-test-field", "false"));
const learningPath = argument("learning", path.join(leagueDir, `season-${String(season).padStart(2, "0")}`, "tactical-learning.json"));

async function main(): Promise<void> {
  fs.mkdirSync(outDir, {recursive: true});
  const bossSource = readJson<SandboxTeam>(bossPath);
  validateRedSource(bossSource);
  const registrySources = fs.readdirSync(snapshotDir).filter(file => /^g\d.*\.json$/i.test(file)).sort().map(file => readJson<SandboxTeam>(path.join(snapshotDir, file)));
  const combined: SandboxTeam = {
    name: "League registry plus G1 Red boss",
    members: [...registrySources.flatMap(source => source.members), ...bossSource.members],
    customMoves: [...registrySources.flatMap(source => source.customMoves ?? []), ...(bossSource.customMoves ?? [])],
    customAbilities: [...registrySources.flatMap(source => source.customAbilities ?? []), ...(bossSource.customAbilities ?? [])],
    customItems: [...registrySources.flatMap(source => source.customItems ?? []), ...(bossSource.customItems ?? [])],
  };
  const compiled = compileSandboxTeam(combined, {namespace: "bossredg1"});
  installCompiledSandbox(compiled, process.cwd(), {backup: false, replaceConflicts: true});
  const dex = Dex.mod(compiled.modId);
  const bossTeam = compiled.team.slice(-bossSource.members.length);
  assert.equal(bossTeam.length, 6, "Red must have six members");

  const seasonDir = path.join(leagueDir, `season-${String(season).padStart(2, "0")}`);
  const seasonData = readJson<{standings: Array<{id: string; name: string; points: number; pairWins: number; pairLosses: number; kos: number}>}>(path.join(seasonDir, "season.json"));
  const standingsById = new Map(seasonData.standings.map(entry => [entry.id, entry]));
  const rosters = loadRosters(path.join(seasonDir, "rosters"));
  assertBossAssetsExcluded(rosters.flatMap(roster => roster.members.map(member => member.assetId)), [RED_BOSS]);
  const ownershipBefore = scarceOwnership(rosters);
  const backgrounds = deduplicateBackgrounds(rosters.flatMap(roster => roster.members));
  const importedLearning = loadImportedLearning(learningPath);
  const adjustments: Array<Record<string, unknown>> = [];
  const challengers = rosters.map(roster => {
    const standing = standingsById.get(roster.managerId);
    if (!standing) throw new Error(`Missing standing for ${roster.managerId}`);
    const tacticalMemory = importedLearning.get(roster.managerId) ?? roster.tacticalMemory;
    const adjusted = adjustBackground(roster, backgrounds, bossTeam, dex, tacticalMemory);
    adjustments.push(adjusted.record);
    return {
      id: roster.managerId,
      name: roster.manager,
      seed: seasonData.standings.findIndex(entry => entry.id === roster.managerId) + 1,
      tactics: roster.tactics,
      roster: adjusted.members,
      lineup: chooseLineup(adjusted.members, bossTeam, dex, tacticalMemory, RED_BOSS.id),
      tacticalMemory,
    };
  }).sort((left, right) => left.seed - right.seed);
  const ownershipAfter = scarceOwnership(challengers.map(team => ({managerId: team.id, members: team.roster})));
  if (ownershipBefore !== ownershipAfter) throw new Error("Special/scarce asset ownership changed during boss preparation");

  const bossTactics: AiTacticalProfile = {id: "boss-red", expectedWeight: .58, downsideWeight: .17, worstWeight: .25, aggression: .16, setupBias: .02, pivotBias: -.02, recoveryBias: .04, statusBias: .02, teraBias: 0, switchBias: .06};
  const volunteerDecisions = challengers.map(team => ({manager: team.id, boss: RED_BOSS.id, preference: 1, estimatedFit: lineupFit(team.roster, bossTeam, dex, team.tacticalMemory), rationale: ["当前赛季只有一个可挑战 Boss，因此列为第一志愿", "胜算估计只决定备战方案，不影响同一志愿内的抽签概率"]}));
  const order = volunteerChallengeOrder(challengers.map(team => ({id: team.id, seed: team.seed, preference: 1})), `${seed}:season:${season}:${RED_BOSS.id}`).map(entry => challenger(entry.id, challengers));
  const attempts: Array<{challenger: string; challengerName: string; defeated: boolean; series: SeriesResult}> = [];
  let state = loadBossState();
  let rewardWinner: string | null = null;
  let rewardPoints = 0;
  for (const team of order) {
    if (!state.active && !completeTestField) break;
    team.lineup = chooseLineup(team.roster, bossTeam, dex, team.tacticalMemory, RED_BOSS.id);
    const series = await playSymmetricSeries(`red-challenge-${String(attempts.length + 1).padStart(2, "0")}-${team.id}`, team.id, "boss-red", team.lineup.map(member => member.configuredSet), bossTeam, team.tactics, bossTactics, compiled.formatId, 3, false);
    const defeated = series.winner === team.id;
    attempts.push({challenger: team.id, challengerName: team.name, defeated, series});
    const resolution = state.active ? recordBossChallenge(RED_BOSS, state, season, team.id, defeated) : {state, points: 0};
    state = resolution.state;
    if (defeated && rewardWinner === null) {
      rewardWinner = team.id;
      rewardPoints = resolution.points;
    }
  }
  fs.writeFileSync(path.join(outDir, "boss-state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  const adjustedStandings = seasonData.standings.map(entry => ({...entry, points: entry.points + (entry.id === rewardWinner ? rewardPoints : 0)})).sort((left, right) => right.points - left.points || (right.pairWins - right.pairLosses) - (left.pairWins - left.pairLosses) || right.kos - left.kos);
  const report = {
    schemaVersion: 1,
    source: {leagueDir, season, registry: snapshotDir},
    boss: {id: RED_BOSS.id, name: RED_BOSS.name, laprasMoves: bossTeam.find(set => set.name === "Red-Lapras")?.moves, rewardPoints: RED_BOSS.rewardPoints},
    rules: {eligibility: "all-active-teams", entryCost: 0, standingsRequirement: null, order: "manager-preferences-then-public-lottery", sideSwapped: true, bossPairs: 3, tieDefeatsBoss: false, stopAfterFirstDefeat: !completeTestField, completeTestField, bossAssetsAcquirable: false},
    preparation: {backgroundAdjustments: adjustments, specialOwnershipUnchanged: true, ownershipDigest: ownershipBefore},
    challengeWindow: {eligibleTeams: challengers.length, volunteerDecisions, lotterySeed: `${seed}:season:${season}:${RED_BOSS.id}`, order: order.map(team => team.id), attempts, cancelledAfterDefeat: challengers.length - attempts.length},
    outcome: {defeated: !state.active, defeatedBy: rewardWinner, rewardPoints, state},
    adjustedStandings,
  };
  fs.writeFileSync(path.join(outDir, "result.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeBossLearning(challengers, attempts);
  fs.writeFileSync(path.join(outDir, "summary.md"), summary(report), "utf8");
  console.log(JSON.stringify({eligibleTeams: challengers.length, attempts: attempts.length, bossDefeated: !state.active, defeatedBy: rewardWinner, rewardPoints, output: outDir}, null, 2));
}

async function playSymmetricSeries(id: string, leftId: string, rightId: string, leftTeam: PokemonSet[], rightTeam: PokemonSet[], leftTactics: AiTacticalProfile, rightTactics: AiTacticalProfile, format: string, minimumPairs: number, extendTies: boolean, seedWinner: string | null = null): Promise<SeriesResult> {
  let leftWins = 0, rightWins = 0, draws = 0;
  const games: Array<Record<string, unknown>> = [];
  const maximumPairs = minimumPairs + (extendTies ? 3 : 0);
  for (let pair = 0; pair < maximumPairs; pair += 1) {
    for (const orientation of ["left-p1", "right-p1"] as const) {
      const leftIsP1 = orientation === "left-p1";
      const result = await runBattle({
        format,
        teamA: Teams.pack(leftIsP1 ? leftTeam : rightTeam),
        teamB: Teams.pack(leftIsP1 ? rightTeam : leftTeam),
        seed: `${seed}:${id}:pair:${pair}`,
        gameIndex: pair,
        outDir: path.join(outDir, "battles", id, orientation),
        maxTurns,
        ai: "search",
        aiProfiles: leftIsP1 ? {p1: leftTactics, p2: rightTactics} : {p1: rightTactics, p2: leftTactics},
        openTeamSheets: true,
        traceAiDecisions: true,
      });
      const winningId = result.winner === "Team A" ? (leftIsP1 ? leftId : rightId) : result.winner === "Team B" ? (leftIsP1 ? rightId : leftId) : null;
      if (winningId === leftId) leftWins += 1;
      else if (winningId === rightId) rightWins += 1;
      else draws += 1;
      games.push({pair: pair + 1, orientation, winner: winningId, turns: result.turns, timeout: result.timeout, stalled: result.stalled, keyDecisions: extractKeyBattleDecisions(result.decisionLogPath, 5)});
    }
    if (pair + 1 >= minimumPairs && leftWins !== rightWins) break;
  }
  const winner = leftWins > rightWins ? leftId : rightWins > leftWins ? rightId : seedWinner;
  return {id, left: leftId, right: rightId, leftWins, rightWins, draws, winner, games};
}

function chooseLineup(members: StoredMember[], opponent: PokemonSet[], dex: ReturnType<typeof Dex.mod>, memory?: TacticalMemory, opponentId = "unknown"): StoredMember[] {
  return [...members].map(member => ({member, score: memberScore(member, opponent, dex) + tacticalFamilyValue(memory, opponentId, member.family) * 2})).sort((left, right) => right.score - left.score || left.member.family.localeCompare(right.member.family)).slice(0, 6).map(entry => entry.member);
}

function lineupFit(members: StoredMember[], opponent: PokemonSet[], dex: ReturnType<typeof Dex.mod>, memory?: TacticalMemory): number {
  const selected = chooseLineup(members, opponent, dex, memory, RED_BOSS.id);
  return Number((selected.reduce((sum, member) => sum + memberScore(member, opponent, dex), 0) / selected.length).toFixed(3));
}

function memberScore(member: StoredMember, opponent: PokemonSet[], dex: ReturnType<typeof Dex.mod>): number {
  const species = dex.species.get(member.configuredSet.species);
  const stats = species.baseStats;
  const history = member.kos / Math.max(4, member.appearances);
  const roleBreadth = new Set(member.roles).size;
  const coverage = member.configuredSet.moves.reduce((sum, moveName) => {
    const move = dex.moves.get(moveName);
    if (!move.exists || move.category === "Status") return sum + (move.id === "raindance" || move.id === "sunnyday" ? .5 : .2);
    const best = Math.max(...opponent.map(set => {
      const target = dex.species.get(set.species);
      return Math.pow(2, dex.getEffectiveness(move.type, target.types));
    }));
    return sum + best * Math.max(40, move.basePower) / 100;
  }, 0);
  return (stats.hp + stats.def + stats.spd) / 180 + Math.max(stats.atk, stats.spa) / 70 + stats.spe / 160 + coverage + history * 2 + roleBreadth * .08;
}

function adjustBackground(roster: StoredRoster, pool: StoredMember[], boss: PokemonSet[], dex: ReturnType<typeof Dex.mod>, memory?: TacticalMemory): {members: StoredMember[]; record: Record<string, unknown>} {
  const members = roster.members.map(member => ({...member, configuredSet: {...member.configuredSet}}));
  const currentBackgrounds = members.filter(member => member.economicClass === "background");
  if (!currentBackgrounds.length) return {members, record: {manager: roster.managerId, changed: false, reason: "no-background-slot"}};
  const learnedScore = (member: StoredMember) => memberScore(member, boss, dex) + tacticalFamilyValue(memory, RED_BOSS.id, member.family) * 2;
  const worst = [...currentBackgrounds].sort((left, right) => learnedScore(left) - learnedScore(right))[0];
  const families = new Set(members.map(member => member.family));
  const best = pool.filter(member => !families.has(member.family)).map(member => ({member, score: learnedScore(member)})).sort((left, right) => right.score - left.score)[0];
  const oldScore = learnedScore(worst);
  if (!best || best.score < oldScore * 1.05) return {members, record: {manager: roster.managerId, changed: false, retained: worst.pokemon, score: oldScore}};
  members.splice(members.indexOf(worst), 1, {...best.member, assetId: `background:${best.member.family}`, economicClass: "background", scarcity: "standard"});
  return {members, record: {manager: roster.managerId, changed: true, released: worst.pokemon, registered: best.member.pokemon, before: oldScore, after: best.score, protectedSpecialAssets: true}};
}

function loadRosters(rosterDir: string): StoredRoster[] {
  return fs.readdirSync(rosterDir, {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => readJson<StoredRoster>(path.join(rosterDir, entry.name, "roster.json")));
}

function deduplicateBackgrounds(members: StoredMember[]): StoredMember[] {
  const byFamily = new Map<string, StoredMember>();
  for (const member of members) if (member.economicClass === "background" && !byFamily.has(member.family)) byFamily.set(member.family, member);
  return [...byFamily.values()];
}

function scarceOwnership(rosters: Array<{managerId: string; members: StoredMember[]}>): string {
  const rows = rosters.flatMap(roster => roster.members.filter(member => member.economicClass !== "background").map(member => `${member.assetId}:${roster.managerId}`)).sort();
  return crypto.createHash("sha256").update(rows.join("\n")).digest("hex");
}

function challenger(id: string, teams: Challenger[]): Challenger {
  const found = teams.find(team => team.id === id);
  if (!found) throw new Error(`Unknown challenger ${id}`);
  return found;
}

function loadBossState(): BossState {
  const statePath = path.join(outDir, "boss-state.json");
  return fs.existsSync(statePath) ? readJson<BossState>(statePath) : initialBossState(RED_BOSS);
}

function loadImportedLearning(filePath: string): Map<string, TacticalMemory> {
  if (!filePath) return new Map();
  const parsed = readJson<{managers?: Array<{id: string; tacticalMemory: TacticalMemory}>}>(path.resolve(filePath));
  return new Map((parsed.managers ?? []).map(manager => [manager.id, manager.tacticalMemory]));
}

function writeBossLearning(challengers: Challenger[], attempts: Array<{challenger: string; challengerName: string; defeated: boolean; series: SeriesResult}>): void {
  const managers = challengers.map(team => {
    const attempt = attempts.find(entry => entry.challenger === team.id);
    if (!attempt) return {id: team.id, tacticalMemory: team.tacticalMemory, episodes: 0, learned: false};
    const familyByName = new Map<string, string>();
    for (const member of team.roster) {
      for (const name of [member.pokemon, member.family, member.configuredSet.name, member.configuredSet.species]) if (name) familyByName.set(toID(name), member.family);
    }
    const episodes: TacticalEpisode[] = [];
    for (const orientation of ["left-p1", "right-p1"] as const) {
      const battleDir = path.join(outDir, "battles", attempt.series.id, orientation);
      if (!fs.existsSync(battleDir)) continue;
      for (const entry of fs.readdirSync(battleDir, {withFileTypes: true}).filter(value => value.isDirectory() && /^game-/.test(value.name)).sort((left, right) => left.name.localeCompare(right.name))) {
        const publicLogPath = path.join(battleDir, entry.name, "public.log");
        if (!fs.existsSync(publicLogPath)) continue;
        episodes.push(extractTacticalEpisode({id: `${attempt.series.id}:${orientation}:${entry.name}`, opponentId: RED_BOSS.id, publicLogPath, perspective: orientation === "left-p1" ? "p1" : "p2", familyByName}));
      }
    }
    const tacticalMemory = updateTacticalMemory(team.tacticalMemory, episodes, season, .85);
    return {id: team.id, tacticalMemory, episodes: episodes.length, learned: true, wins: episodes.filter(episode => episode.result === "win").length, decisiveEvents: episodes.reduce((sum, episode) => sum + episode.decisiveEvents.length, 0)};
  });
  fs.writeFileSync(path.join(outDir, "boss-learning.json"), `${JSON.stringify({schemaVersion: 1, season, bossId: RED_BOSS.id, sourceResult: path.join(outDir, "result.json"), managers}, null, 2)}\n`, "utf8");
}

function validateRedSource(source: SandboxTeam): void {
  if (source.members.length !== 6) throw new Error("G1 Red configuration must contain exactly six members");
  const lapras = source.members.find(member => member.id === "boss-red-lapras");
  if (!lapras || !lapras.moves.some(move => typeof move === "string" && toID(move) === "raindance") || lapras.moves.some(move => typeof move === "string" && toID(move) === "haze")) throw new Error("Red-Lapras must use Rain Dance and not Haze");
  if (source.members.some(member => !member.id.startsWith("boss-red-"))) throw new Error("Every Red member must use the protected boss-red namespace");
}

function summary(report: any): string {
  const attempts = report.challengeWindow.attempts as Array<{challengerName: string; defeated: boolean; series: SeriesResult}>;
  const lines = ["# G1 Boss Red open challenge", "", `- Eligible teams: ${report.challengeWindow.eligibleTeams}`, `- Attempts completed: ${attempts.length}`, `- Red defeated: ${report.outcome.defeated ? "yes" : "no"}`, `- Defeated by: ${report.outcome.defeatedBy ?? "none"}`, `- League points awarded: ${report.outcome.rewardPoints}`, `- Lapras moves: ${report.boss.laprasMoves.join(", ")}`, `- Special asset ownership unchanged: yes`, "", "## Attempts", ""];
  for (const attempt of attempts) lines.push(`- ${attempt.challengerName}: ${attempt.series.leftWins}-${attempt.series.rightWins}${attempt.defeated ? " (victory)" : ""}`);
  return `${lines.join("\n")}\n`;
}

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

const assert = {equal<T>(actual: T, expected: T, message: string): void { if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`); }};

main().catch(error => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
