import fs from "node:fs";
import path from "node:path";
import {analyzePublicLog, mergeCounts} from "../src/eval/logAnalysis";

type SimulationSummary = {
  results: Array<{winner: string | null; turns: number; publicLogPath: string; timeout: boolean}>;
};

const roots = [
  {dir: "output/g2-vs-g1/g2-as-a", g2Side: "p1" as const},
  {dir: "output/g2-vs-g1/g1-as-a", g2Side: "p2" as const},
];
const g2Kos: Record<string, number> = {};
const g1Kos: Record<string, number> = {};
const g2Failures: Record<string, number> = {};
const g1Failures: Record<string, number> = {};
const actions: Record<string, number> = {};
let g2Wins = 0;
let g1Wins = 0;
let technicalDraws = 0;

for (const root of roots) {
  const summary = JSON.parse(fs.readFileSync(path.join(root.dir, "summary.json"), "utf8")) as SimulationSummary;
  for (const result of summary.results) {
    const analysis = analyzePublicLog(result.publicLogPath, result.winner, result.turns);
    const g2Analysis = analyzePublicLog(result.publicLogPath, result.winner, result.turns, root.g2Side);
    const g1Analysis = analyzePublicLog(result.publicLogPath, result.winner, result.turns, root.g2Side === "p1" ? "p2" : "p1");
    const g2Won = result.winner === (root.g2Side === "p1" ? "Team A" : "Team B");
    const g1Won = result.winner === (root.g2Side === "p1" ? "Team B" : "Team A");
    if (g2Won) g2Wins += 1;
    else if (g1Won) g1Wins += 1;
    else technicalDraws += 1;
    mergeCounts(g2Kos, root.g2Side === "p1" ? analysis.p1Kos : analysis.p2Kos);
    mergeCounts(g1Kos, root.g2Side === "p1" ? analysis.p2Kos : analysis.p1Kos);
    mergeCounts(g2Failures, g2Analysis.failureSignals);
    mergeCounts(g1Failures, g1Analysis.failureSignals);

    const log = fs.readFileSync(result.publicLogPath, "utf8");
    for (const line of log.split(/\r?\n/)) {
      const match = line.match(/^\|move\|(p[12])a: (G[12] [^|]+)\|([^|]+)/);
      if (!match) continue;
      const logicalTeam = match[2].startsWith("G2 ") ? "G2" : "G1";
      const key = `${logicalTeam}:${match[2]}:${match[3]}`;
      actions[key] = (actions[key] ?? 0) + 1;
    }
  }
}

const topActions = Object.entries(actions).sort((a, b) => b[1] - a[1]).slice(0, 30);
console.log(JSON.stringify({g2Wins, g1Wins, technicalDraws, g2Kos, g1Kos, g2Failures, g1Failures, topActions}, null, 2));
