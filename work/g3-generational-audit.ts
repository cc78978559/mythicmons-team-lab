import fs from "node:fs";
import path from "node:path";
import {Teams} from "pokemon-showdown";
import {analyzePublicLog, mergeCounts} from "../src/eval/logAnalysis";
import {runBattle} from "../src/showdown/battle";
import {writeTeam} from "../src/showdown/team";
import {compileSandboxTeam} from "../src/sandbox/compiler";
import {installCompiledSandbox} from "../src/sandbox/installer";
import type {SandboxTeam} from "../src/sandbox/types";

type Generation = "G1" | "G2" | "G3" | "G4";
type Side = "p1" | "p2";

const gamesPerOrientation = Number(process.env.GENERATION_GAMES || 25);
const outDir = path.resolve(process.env.GENERATION_OUT || "output/g3-generational-audit");
const sources: Array<{generation: Generation; path: string}> = [
  {generation: "G1", path: path.resolve("../g1-six-team/g1-six-team.json")},
  {generation: "G2", path: path.resolve("../g2-six-team/g2-six-team.json")},
  {generation: "G3", path: path.resolve("../g3-six-team/g3-six-team.json")},
  {generation: "G4", path: path.resolve("../g4-six-team/g4-six-team.json")},
];

async function main(): Promise<void> {
  if (!Number.isInteger(gamesPerOrientation) || gamesPerOrientation < 1) {
    throw new Error(`GENERATION_GAMES must be a positive integer; received ${gamesPerOrientation}`);
  }
  const teams = sources.map(source => JSON.parse(fs.readFileSync(source.path, "utf8")) as SandboxTeam);
  const combined: SandboxTeam = {
    name: "G1 G2 G3 Combined Battle Registry",
    customMoves: teams.flatMap(team => team.customMoves ?? []),
    customAbilities: teams.flatMap(team => team.customAbilities ?? []),
    customItems: teams.flatMap(team => team.customItems ?? []),
    members: teams.flatMap(team => team.members),
  };
  const compiled = compileSandboxTeam(combined);
  installCompiledSandbox(compiled, process.cwd(), {backup: false, replaceConflicts: true});
  fs.mkdirSync(outDir, {recursive: true});

  const generationTeams = new Map<Generation, ReturnType<typeof compiled.team.slice>>();
  let offset = 0;
  for (const source of sources) {
    const sets = compiled.team.slice(offset, offset + 6);
    generationTeams.set(source.generation, sets);
    writeTeam(sets, path.join(outDir, `${source.generation.toLowerCase()}.export.txt`), "export");
    offset += 6;
  }

  const results = [];
  for (const [generationA, generationB] of [["G1", "G4"], ["G2", "G4"], ["G3", "G4"]] as const) {
    results.push(await auditPair(generationTeams, compiled.formatId, generationA, generationB));
  }
  const summary = {
    format: compiled.formatId,
    gamesPerOrientation,
    totalGames: results.length * gamesPerOrientation * 2,
    results,
    warnings: compiled.manifest.warnings,
  };
  fs.writeFileSync(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

async function auditPair(
  generationTeams: Map<Generation, ReturnType<typeof Teams.unpack>>,
  format: string,
  generationA: Generation,
  generationB: Generation,
) {
  const teamA = generationTeams.get(generationA);
  const teamB = generationTeams.get(generationB);
  if (!teamA || !teamB) throw new Error(`Missing compiled team for ${generationA} or ${generationB}`);
  const generationAKos: Record<string, number> = {};
  const generationBKos: Record<string, number> = {};
  const generationAFailures: Record<string, number> = {};
  const generationBFailures: Record<string, number> = {};
  let generationAWins = 0;
  let generationBWins = 0;
  let technicalDraws = 0;
  let turns = 0;

  for (const orientation of ["generation-a-as-team-a", "generation-b-as-team-a"] as const) {
    const generationASide: Side = orientation === "generation-a-as-team-a" ? "p1" : "p2";
    for (let gameIndex = 0; gameIndex < gamesPerOrientation; gameIndex += 1) {
      const result = await runBattle({
        format,
        teamA: Teams.pack(orientation === "generation-a-as-team-a" ? teamA : teamB),
        teamB: Teams.pack(orientation === "generation-a-as-team-a" ? teamB : teamA),
        seed: `${generationA.toLowerCase()}-vs-${generationB.toLowerCase()}-${orientation}-mega-sol-v2`,
        gameIndex,
        outDir: path.join(outDir, `${generationA.toLowerCase()}-vs-${generationB.toLowerCase()}`, orientation),
        maxTurns: 160,
        ai: "search",
        openTeamSheets: true,
      });
      turns += result.turns;
      const generationAWon = result.winner === (generationASide === "p1" ? "Team A" : "Team B");
      const generationBWon = result.winner === (generationASide === "p1" ? "Team B" : "Team A");
      if (generationAWon) generationAWins += 1;
      else if (generationBWon) generationBWins += 1;
      else technicalDraws += 1;
      const analysis = analyzePublicLog(result.publicLogPath, result.winner, result.turns);
      const generationAAnalysis = analyzePublicLog(result.publicLogPath, result.winner, result.turns, generationASide);
      const generationBSide: Side = generationASide === "p1" ? "p2" : "p1";
      const generationBAnalysis = analyzePublicLog(result.publicLogPath, result.winner, result.turns, generationBSide);
      mergeCounts(generationAKos, generationASide === "p1" ? analysis.p1Kos : analysis.p2Kos);
      mergeCounts(generationBKos, generationASide === "p1" ? analysis.p2Kos : analysis.p1Kos);
      mergeCounts(generationAFailures, generationAAnalysis.failureSignals);
      mergeCounts(generationBFailures, generationBAnalysis.failureSignals);
    }
  }
  const decisive = generationAWins + generationBWins;
  return {
    generationA,
    generationB,
    games: gamesPerOrientation * 2,
    generationAWins,
    generationBWins,
    technicalDraws,
    generationADecisiveWinRate: decisive ? generationAWins / decisive : null,
    generationAHalfDrawScore: (generationAWins + technicalDraws / 2) / (gamesPerOrientation * 2),
    averageTurns: turns / (gamesPerOrientation * 2),
    generationAKos,
    generationBKos,
    generationAFailures,
    generationBFailures,
  };
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
