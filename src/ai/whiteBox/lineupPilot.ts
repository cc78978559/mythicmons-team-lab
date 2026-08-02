import fs from "node:fs";
import path from "node:path";
import type {ShadowExperimentCase} from "./shadowExperimentPlanner";

export type PilotEra = "early" | "middle" | "late";
export type PilotOutcome = "win" | "loss" | "draw";
export type PilotScaleBand = "low" | "medium" | "high";
export type PilotMarginBand = "razor" | "close" | "wide";

export interface LineupPilotCase extends ShadowExperimentCase {
  seriesId: string;
  sourceOutcome: PilotOutcome;
  era: PilotEra;
  scaleBand: PilotScaleBand;
  marginBand: PilotMarginBand;
  assetMix: string[];
}

export interface LineupPilotPlan {
  schemaVersion: 1;
  source: string;
  requested: number;
  available: number;
  selected: LineupPilotCase[];
  coverage: {
    eras: Record<PilotEra, number>;
    outcomes: Record<PilotOutcome, number>;
    scaleBands: Record<PilotScaleBand, number>;
    marginBands: Record<PilotMarginBand, number>;
    managers: number;
    seasons: number;
  };
}

export function buildLineupPilotPlan(
  cases: readonly ShadowExperimentCase[],
  sourceRoot: string,
  requested = 30,
): LineupPilotPlan {
  if (!Number.isInteger(requested) || requested < 1 || requested > 100) {
    throw new Error("requested lineup pilot samples must be 1..100");
  }
  const source = path.resolve(sourceRoot);
  const eligible = cases
    .filter(entry => entry.domain === "lineup" && entry.kind === "boundary-agreement" && entry.boundedScenario)
    .map(entry => enrich(entry, source))
    .sort(compareCases);
  const selected: LineupPilotCase[] = [];
  const managers = new Map<string, number>();
  const seasons = new Map<number, number>();
  while (selected.length < requested) {
    const candidates = eligible
      .filter(entry => !selected.includes(entry) && (managers.get(entry.actor) ?? 0) < 2 && (seasons.get(entry.season) ?? 0) < 3)
      .sort((left, right) =>
        selectionLoad(left, selected) - selectionLoad(right, selected)
        || (managers.get(left.actor) ?? 0) - (managers.get(right.actor) ?? 0)
        || (seasons.get(right.season) ?? 0) - (seasons.get(left.season) ?? 0)
        || compareCases(left, right));
    if (!candidates.length) break;
    const entry = candidates[0];
    selected.push(entry);
    managers.set(entry.actor, (managers.get(entry.actor) ?? 0) + 1);
    seasons.set(entry.season, (seasons.get(entry.season) ?? 0) + 1);
  }
  // Preserve manager diversity first, then fill sparse strata without silently
  // shrinking a requested pilot when the strict caps are the only blocker.
  for (const entry of eligible) {
    if (selected.length >= requested) break;
    if (selected.includes(entry) || (managers.get(entry.actor) ?? 0) >= 3 || (seasons.get(entry.season) ?? 0) >= 4) continue;
    selected.push(entry);
    managers.set(entry.actor, (managers.get(entry.actor) ?? 0) + 1);
    seasons.set(entry.season, (seasons.get(entry.season) ?? 0) + 1);
  }
  return {
    schemaVersion: 1,
    source,
    requested,
    available: eligible.length,
    selected,
    coverage: {
      eras: counts(selected, ["early", "middle", "late"], entry => entry.era),
      outcomes: counts(selected, ["win", "loss", "draw"], entry => entry.sourceOutcome),
      scaleBands: counts(selected, ["low", "medium", "high"], entry => entry.scaleBand),
      marginBands: counts(selected, ["razor", "close", "wide"], entry => entry.marginBand),
      managers: new Set(selected.map(entry => entry.actor)).size,
      seasons: new Set(selected.map(entry => entry.season)).size,
    },
  };
}

function enrich(entry: ShadowExperimentCase, source: string): LineupPilotCase {
  const decisionSeriesId = seriesFromDecision(entry.decisionId);
  const seriesId = canonicalSeriesId(decisionSeriesId);
  const seasonFile = path.join(source, `season-${String(entry.season).padStart(2, "0")}`, "season.json");
  const season = JSON.parse(fs.readFileSync(seasonFile, "utf8"));
  const series = allSeries(season).find(candidate => String(candidate.id) === seriesId);
  if (!series) throw new Error(`Series ${seriesId} not found for ${entry.decisionId}`);
  return {
    ...entry,
    seriesId,
    sourceOutcome: outcome(series, entry.actor),
    era: entry.season <= 7 ? "early" : entry.season <= 14 ? "middle" : "late",
    scaleBand: scaleBand(Number(entry.boundedScenario!.styleScale)),
    marginBand: Math.abs(entry.finalMargin) <= .001 ? "razor" : Math.abs(entry.finalMargin) <= .01 ? "close" : "wide",
    assetMix: [...new Set([...assets(entry.incumbent), ...assets(entry.boundedScenario!.selected)].map(assetKind))].sort(),
  };
}

function allSeries(season: any): any[] {
  const playoffs = season.playoffs ?? {};
  return [
    ...(season.league ?? []),
    ...(playoffs.playIns ?? []),
    ...(playoffs.quarters ?? []),
    ...(playoffs.semifinals ?? []),
    ...(playoffs.final ? [playoffs.final] : []),
  ].filter(Boolean);
}

function outcome(series: any, actor: string): PilotOutcome {
  const opponent = String(series.left) === actor ? String(series.right) : String(series.left);
  const actorPairs = String(series.left) === actor ? Number(series.leftPairs ?? 0) : Number(series.rightPairs ?? 0);
  const opponentPairs = String(series.left) === actor ? Number(series.rightPairs ?? 0) : Number(series.leftPairs ?? 0);
  if (actorPairs !== opponentPairs) return actorPairs > opponentPairs ? "win" : "loss";
  let actorGames = 0, opponentGames = 0;
  for (const game of series.games ?? []) {
    if (String(game.winner) === actor) actorGames++;
    else if (String(game.winner) === opponent) opponentGames++;
  }
  return actorGames === opponentGames ? "draw" : actorGames > opponentGames ? "win" : "loss";
}

function seriesFromDecision(decisionId: string): string {
  const match = /^lineup:(.+):manager-\d+$/.exec(decisionId);
  if (!match) throw new Error(`Unsupported lineup decision id: ${decisionId}`);
  return match[1];
}
function canonicalSeriesId(seriesId: string): string { return seriesId.replace(/-tiebreak-\d+$/, ""); }

function assets(lineup: string): string[] { return String(lineup).split("+").filter(Boolean); }
function assetKind(asset: string): string {
  if (asset.startsWith("custom-")) return "custom";
  if (asset.startsWith("background-")) return "background";
  if (asset.startsWith("official-")) return "special";
  return "other";
}
function scaleBand(value: number): PilotScaleBand { return value <= 1.1 ? "low" : value <= 1.3 ? "medium" : "high"; }
function compareCases(left: LineupPilotCase, right: LineupPilotCase): number {
  return Math.abs(left.finalMargin) - Math.abs(right.finalMargin)
    || left.season - right.season
    || left.actor.localeCompare(right.actor)
    || left.id.localeCompare(right.id);
}
function selectionLoad(entry: LineupPilotCase, selected: readonly LineupPilotCase[]): number {
  return selected.filter(value => value.era === entry.era).length
    + selected.filter(value => value.sourceOutcome === entry.sourceOutcome).length
    + selected.filter(value => value.scaleBand === entry.scaleBand).length
    + selected.filter(value => value.marginBand === entry.marginBand).length;
}
function counts<T extends string>(
  values: readonly LineupPilotCase[],
  keys: readonly T[],
  selector: (entry: LineupPilotCase) => T,
): Record<T, number> {
  return Object.fromEntries(keys.map(key => [key, values.filter(entry => selector(entry) === key).length])) as Record<T, number>;
}
