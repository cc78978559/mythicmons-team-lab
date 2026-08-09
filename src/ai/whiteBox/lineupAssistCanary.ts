import fs from "node:fs";
import path from "node:path";

type DecisionRecord = {
  actor?: string;
  stage?: string;
  selected?: unknown;
  context?: {
    seriesId?: string;
    policy?: string;
    lineupAssistPolicy?: {
      approvalSha256?: string;
      applied?: boolean;
      candidateId?: string | null;
      reasons?: string[];
    };
  };
};

type Series = {id: string; left: string; right: string; leftPairs: number; rightPairs: number};
type Season = {season: number; champion?: {id?: string}; standings?: Array<{id: string; points: number; seriesWins: number; seriesLosses: number}>; league?: Series[]; playoffs?: unknown};

export interface LineupAssistCanarySummary {
  schemaVersion: 1;
  seasons: number[];
  approvalSha256: string;
  decisions: {evaluated: number; applied: number; applicationRate: number; reasons: Record<string, number>; managersApplied: number; bySeason: Record<string, number>};
  direct: {matchedApplications: number; lineupDivergences: number; better: number; neutral: number; worse: number; missingSeries: number};
  evidence: {decisive: number; improvementP: number; regressionP: number; conclusion: "deployment-supported" | "deployment-harmful" | "not-replicated" | "insufficient-applications" | "safety-blocked"; disposition: "renew" | "retire" | "investigate"};
  divergence: {lineups: number; series: number; seriesOutcomes: number; managers: number};
  outcomes: {controlChampions: string[]; canaryChampions: string[]; managerPointDelta: Record<string, number>; improvedManagers: number; neutralManagers: number; worseManagers: number};
  safety: {controlApprovalLeaks: number; canaryMissingApprovalEvaluations: number; approvalHashMismatches: number; valid: boolean};
}

export function auditLineupAssistCanary(controlRoot: string, canaryRoot: string, seasons: readonly number[], approvalSha256: string): LineupAssistCanarySummary {
  const reasons: Record<string, number> = {}, bySeason: Record<string, number> = {}, appliedManagers = new Set<string>(), divergentManagers = new Set<string>(), divergentSeries = new Set<string>(), outcomeDivergences = new Set<string>();
  const pointDelta: Record<string, number> = {}, controlChampions: string[] = [], canaryChampions: string[] = [];
  let evaluated = 0, applied = 0, lineupDivergences = 0, controlLeaks = 0, missingEvaluations = 0, hashMismatches = 0;
  let directMatched = 0, directLineupDivergences = 0, directBetter = 0, directNeutral = 0, directWorse = 0, directMissingSeries = 0;
  for (const seasonNumber of seasons) {
    const controlSeason = readSeason(controlRoot, seasonNumber), canarySeason = readSeason(canaryRoot, seasonNumber);
    const controlDecisions = lineupDecisions(controlRoot, seasonNumber), canaryDecisions = lineupDecisions(canaryRoot, seasonNumber);
    const controlByKey = new Map(controlDecisions.map(record => [decisionKey(record), record]));
    const canaryByKey = new Map(canaryDecisions.map(record => [decisionKey(record), record]));
    const controlSeries = seriesMap(controlSeason), canarySeries = seriesMap(canarySeason);
    controlLeaks += controlDecisions.filter(record => record.context?.lineupAssistPolicy).length;
    missingEvaluations += canaryDecisions.filter(record => !record.context?.lineupAssistPolicy).length;
    for (const record of canaryDecisions) {
      const policy = record.context?.lineupAssistPolicy;
      if (!policy) continue;
      evaluated += 1;
      if (policy.approvalSha256 !== approvalSha256) hashMismatches += 1;
      if (policy.applied) {
        applied += 1;
        bySeason[String(seasonNumber)] = (bySeason[String(seasonNumber)] ?? 0) + 1;
        if (record.actor) appliedManagers.add(record.actor);
        const control = controlByKey.get(decisionKey(record));
        if (control) {
          directMatched += 1;
          if (JSON.stringify(control.selected) !== JSON.stringify(record.selected)) directLineupDivergences += 1;
        }
        const id = record.context?.seriesId, actor = record.actor;
        const left = id ? controlSeries.get(id) : undefined, right = id ? canarySeries.get(id) : undefined;
        if (!left || !right || !actor) directMissingSeries += 1;
        else {
          const delta = managerSeriesScore(right, actor) - managerSeriesScore(left, actor);
          if (delta > 0) directBetter += 1; else if (delta < 0) directWorse += 1; else directNeutral += 1;
        }
      }
      for (const reason of policy.reasons ?? []) reasons[reason] = (reasons[reason] ?? 0) + 1;
      const control = controlByKey.get(decisionKey(record));
      if (control && JSON.stringify(control.selected) !== JSON.stringify(record.selected)) {
        lineupDivergences += 1;
        if (record.actor) divergentManagers.add(record.actor);
        if (record.context?.seriesId) divergentSeries.add(`${seasonNumber}:${record.context.seriesId}`);
      }
    }
    for (const scopedId of divergentSeries) {
      const [scopedSeason, ...idParts] = scopedId.split(":"), id = idParts.join(":");
      if (Number(scopedSeason) !== seasonNumber) continue;
      const left = controlSeries.get(id), right = canarySeries.get(id);
      if (left && right && seriesWinner(left) !== seriesWinner(right)) outcomeDivergences.add(scopedId);
    }
    for (const standing of canarySeason.standings ?? []) {
      const control = (controlSeason.standings ?? []).find(entry => entry.id === standing.id);
      if (control) pointDelta[standing.id] = (pointDelta[standing.id] ?? 0) + standing.points - control.points;
    }
    controlChampions.push(String(controlSeason.champion?.id ?? ""));
    canaryChampions.push(String(canarySeason.champion?.id ?? ""));
  }
  const deltas = Object.values(pointDelta), safety = {controlApprovalLeaks: controlLeaks, canaryMissingApprovalEvaluations: missingEvaluations, approvalHashMismatches: hashMismatches, valid: controlLeaks === 0 && missingEvaluations === 0 && hashMismatches === 0};
  const decisive = directBetter + directWorse, improvementP = binomialTail(decisive, directBetter), regressionP = binomialTail(decisive, directWorse);
  const conclusion = !safety.valid ? "safety-blocked" : applied < 12 ? "insufficient-applications" : directBetter > directWorse && improvementP <= .1 ? "deployment-supported" : directWorse > directBetter && regressionP <= .1 ? "deployment-harmful" : "not-replicated";
  const disposition = conclusion === "deployment-supported" ? "renew" : conclusion === "deployment-harmful" || conclusion === "not-replicated" ? "retire" : "investigate";
  return {
    schemaVersion: 1,
    seasons: [...seasons],
    approvalSha256,
    decisions: {evaluated, applied, applicationRate: evaluated ? round(applied / evaluated) : 0, reasons: sortRecord(reasons), managersApplied: appliedManagers.size, bySeason},
    direct: {matchedApplications: directMatched, lineupDivergences: directLineupDivergences, better: directBetter, neutral: directNeutral, worse: directWorse, missingSeries: directMissingSeries},
    evidence: {decisive, improvementP: round(improvementP), regressionP: round(regressionP), conclusion, disposition},
    divergence: {lineups: lineupDivergences, series: divergentSeries.size, seriesOutcomes: outcomeDivergences.size, managers: divergentManagers.size},
    outcomes: {controlChampions, canaryChampions, managerPointDelta: sortRecord(pointDelta), improvedManagers: deltas.filter(value => value > 0).length, neutralManagers: deltas.filter(value => value === 0).length, worseManagers: deltas.filter(value => value < 0).length},
    safety,
  };
}

function readSeason(root: string, season: number): Season { return read<Season>(path.join(root, seasonDirectory(season), "season.json")); }
function lineupDecisions(root: string, season: number): DecisionRecord[] { return read<{records: DecisionRecord[]}>(path.join(root, seasonDirectory(season), "decision-ledger.json")).records.filter(record => record.stage === "lineup"); }
function decisionKey(record: DecisionRecord): string { return `${record.context?.seriesId ?? ""}:${record.actor ?? ""}`; }
function seriesMap(season: Season): Map<string, Series> { const output = new Map<string, Series>(); for (const entry of [...(season.league ?? []), ...collectSeries(season.playoffs)]) output.set(entry.id, entry); return output; }
function collectSeries(value: unknown): Series[] { if (Array.isArray(value)) return value.flatMap(collectSeries); if (!value || typeof value !== "object") return []; const record = value as Record<string, unknown>; const own = typeof record.id === "string" && typeof record.left === "string" && typeof record.right === "string" ? [record as unknown as Series] : []; return [...own, ...Object.values(record).flatMap(collectSeries)]; }
function seriesWinner(value: Series): string { return value.leftPairs > value.rightPairs ? value.left : value.rightPairs > value.leftPairs ? value.right : "draw"; }
function managerSeriesScore(value: Series, manager: string): number { const winner = seriesWinner(value); return winner === "draw" ? .5 : winner === manager ? 1 : 0; }
function seasonDirectory(season: number): string { return `season-${String(season).padStart(2, "0")}`; }
function read<T>(file: string): T { if (!fs.existsSync(file)) throw new Error(`Missing lineup canary artifact: ${file}`); return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function sortRecord<T>(value: Record<string, T>): Record<string, T> { return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))); }
function round(value: number): number { return Math.round(value * 1e6) / 1e6; }
function binomialTail(trials: number, successes: number): number { if (!trials) return 1; let total = 0; for (let value = successes; value <= trials; value += 1) total += combination(trials, value); return total / 2 ** trials; }
function combination(n: number, k: number): number { let value = 1; for (let index = 1; index <= Math.min(k, n - k); index += 1) value = value * (n - index + 1) / index; return value; }
