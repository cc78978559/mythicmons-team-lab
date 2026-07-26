import fs from "node:fs";
import path from "node:path";
import {strategyProgramBehavior, strategyProgramHash, type StrategyProgram} from "./strategyProgram";

export interface LeagueHealthSnapshot {
  season: number;
  transactions: number;
  publicAdjustments?: number;
  scarceTransactions?: number;
  teamsWithMidseasonLiquidity: number;
  averageFinalCash: number;
  auctionMode?: "sequential" | "portfolio";
  equalTopBidRate?: number;
  auctionTieRate: number;
  lateToEarlyPriceRatio: number;
  unusedRosterRate: number;
  behaviorSpecies: number;
  programSpecies?: number;
  warnings: string[];
}

export function auditLeagueSeason(seasonDir: string): LeagueHealthSnapshot {
  const season = read<{season: number; transactions?: Array<{type?: string}>}>(path.join(seasonDir, "season.json"));
  const decisions = read<{records: Array<{stage: string; context: Record<string, any>}>}>(path.join(seasonDir, "decision-ledger.json")).records;
  const evolution = read<{descendants: Array<{lineage: {niche: string}; program?: {hash: string}}>}>(path.join(seasonDir, "evolution.json"));
  const profileFile = path.join(seasonDir, "manager-profiles.json");
  const profiles = fs.existsSync(profileFile) ? read<{managers?: Array<{strategyProgram?: StrategyProgram}>}>(profileFile).managers ?? [] : [];
  const programs = profiles.map(profile => profile.strategyProgram).filter((program): program is StrategyProgram => Boolean(program));
  const rosterRoot = path.join(seasonDir, "rosters");
  const rosters = fs.readdirSync(rosterRoot).map(manager => read<{budget: number; members: Array<{appearances: number}>}>(path.join(rosterRoot, manager, "roster.json")));
  const auctions = decisions.filter(record => record.stage === "auction").map((record, index) => {
    const bids = Array.isArray(record.context.bids) ? record.context.bids.filter((bid: any) => Number(bid.bid) > 0).sort((a: any, b: any) => b.bid - a.bid) : [];
    const price = Number(record.context.criticalBidPrice ?? record.context.opportunityCostPrice ?? bids[0]?.bid ?? 0);
    const tied = bids.length > 1 && Number(bids[0].bid) === Number(bids[1].bid);
    return {lot: Number(record.context.lot ?? index + 1), price, tied};
  });
  const portfolioAuction = decisions.some(record => record.stage === "auction" && record.context.mode === "portfolio");
  const third = Math.max(1, Math.floor(auctions.length / 3));
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const early = average(auctions.slice(0, third).map(entry => entry.price));
  const late = average(auctions.slice(-third).map(entry => entry.price));
  const totalMembers = rosters.reduce((sum, roster) => sum + roster.members.length, 0);
  const programEvolution = /^(1|true|yes)$/i.test(process.env.V4_PROGRAM_EVOLUTION || "false");
  const publicAdjustments = season.transactions?.filter(entry => entry.type === "background-registration").length ?? 0;
  const scarceTransactions = (season.transactions?.length ?? 0) - publicAdjustments;
  const equalTopBidRate = auctions.length ? auctions.filter(entry => entry.tied).length / auctions.length : 0;
  const snapshot: LeagueHealthSnapshot = {
    season: season.season,
    transactions: season.transactions?.length ?? 0,
    publicAdjustments,
    scarceTransactions,
    teamsWithMidseasonLiquidity: rosters.filter(roster => roster.budget >= 2).length,
    averageFinalCash: average(rosters.map(roster => roster.budget)),
    auctionMode: portfolioAuction ? "portfolio" : "sequential",
    equalTopBidRate,
    // Portfolio allocation uses continuous utility and global constraints, so equal
    // integer bids do not invoke the sequential auction's seeded tie-break.
    auctionTieRate: portfolioAuction ? 0 : equalTopBidRate,
    lateToEarlyPriceRatio: portfolioAuction ? 1 : early > 0 ? late / early : 1,
    unusedRosterRate: totalMembers ? rosters.reduce((sum, roster) => sum + roster.members.filter(member => member.appearances === 0).length, 0) / totalMembers : 0,
    behaviorSpecies: programs.length
      ? new Set(programs.map(program => strategyProgramBehavior(program).hash)).size
      : new Set(evolution.descendants.map(entry => entry.lineage.niche)).size,
    programSpecies: programs.length
      ? new Set(programs.map(strategyProgramHash)).size
      : new Set(evolution.descendants.map(entry => entry.program?.hash).filter(Boolean)).size,
    warnings: [],
  };
  if (programEvolution ? scarceTransactions < Math.max(1, Math.floor(rosters.length / 10)) && publicAdjustments === 0 : snapshot.transactions < 5) snapshot.warnings.push("low-midseason-activity");
  if (!programEvolution && snapshot.teamsWithMidseasonLiquidity < Math.ceil(rosters.length / 3)) snapshot.warnings.push("liquidity-collapse");
  if (snapshot.auctionTieRate > .2) snapshot.warnings.push("auction-tie-dominance");
  if (!portfolioAuction && snapshot.lateToEarlyPriceRatio < .4) snapshot.warnings.push("auction-timing-cliff");
  if (snapshot.unusedRosterRate > .1) snapshot.warnings.push("dead-roster-capacity");
  if (season.season >= 4 && snapshot.behaviorSpecies < 2) snapshot.warnings.push("behavior-convergence");
  return snapshot;
}

function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
