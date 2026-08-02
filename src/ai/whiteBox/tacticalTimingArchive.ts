import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

type Side = "p1" | "p2";

interface BattleState {
  hp: Record<Side, Map<string, number>>;
  status: Record<Side, Set<string>>;
  active: Record<Side, string | null>;
  sideConditions: Record<Side, Set<string>>;
  fieldConditions: Set<string>;
  weather: string | null;
}

interface StateView {
  ownRemaining: number;
  opponentRemaining: number;
  materialAdvantage: number;
  ownTeamHp: number;
  opponentTeamHp: number;
  hpAdvantage: number;
  ownActiveHp: number;
  opponentActiveHp: number;
  ownStatused: number;
  opponentStatused: number;
  ownSideConditions: number;
  opponentSideConditions: number;
  fieldConditions: number;
  weatherActive: boolean;
}

export interface TacticalTimingRow {
  season: number;
  gameId: string;
  decisionOrdinal: number;
  managerId: string;
  side: Side;
  context: StateView & {turn: number; progress: number};
  choice: {
    evidence: "full-trace" | "compact-all-decisions" | "compact-key-decision";
    kind: "move" | "switch" | "other";
    target: string | null;
    terastallize: boolean;
    candidates: number | null;
    reasonableCandidates: number | null;
    switchCandidates: number | null;
    shadowAgrees: boolean | null;
    rationalRank: number | null;
    selectionMargin: number | null;
    marginBasis: "rational-score" | "final-score" | "unavailable";
    styleChangedRationalWinner: boolean | null;
  };
  outcome: {
    won: boolean;
    nextTurn: WindowOutcome;
    nextThreeTurns: WindowOutcome;
  };
}

interface WindowOutcome {
  ownFaints: number;
  opponentFaints: number;
  materialDelta: number;
  hpAdvantageDelta: number;
  selectedActiveSurvived: boolean;
}

export interface TacticalTimingArchive {
  schemaVersion: 1;
  representationVersion: 1;
  causalBoundary: {
    context: "public battle state captured before the selected turn";
    choice: "contemporaneous AI decision trace";
    outcome: "post-decision observation; activation-ineligible as an input";
  };
  source: {root: string; games: number; evidenceSha256: string};
  coverage: {seasons: number[]; games: number; decisions: number; managers: number; fullTraceGames: number; compactAllDecisionGames: number; compactKeyDecisionGames: number; unavailableGames: number; fullTraceDecisions: number; compactAllDecisions: number; compactKeyDecisions: number; unmatchedDecisions: number};
  rows: TacticalTimingRow[];
}

export function buildTacticalTimingArchive(sourceRoot: string): TacticalTimingArchive {
  const root = path.resolve(sourceRoot), games = discoverGames(root), rows: TacticalTimingRow[] = [];
  const evidence: Array<{file: string; end: string; log: string; decisions: string}> = [];
  let fullTraceGames = 0, compactAllDecisionGames = 0, compactKeyDecisionGames = 0, unavailableGames = 0, fullTraceDecisions = 0, compactAllDecisions = 0, compactKeyDecisions = 0, unmatchedDecisions = 0;
  for (const directory of games) {
    const endFile = path.join(directory, "end.json"), logFile = path.join(directory, "public.log.gz"), decisionsFile = path.join(directory, "ai-decisions.json.gz"), timingFile = path.join(directory, "ai-timing.json.gz"), summaryFile = path.join(directory, "ai-summary.json");
    const relative = path.relative(root, directory).replaceAll("\\", "/"), end = read<any>(endFile);
    const evidenceFile = fs.existsSync(decisionsFile) ? decisionsFile : fs.existsSync(timingFile) ? timingFile : fs.existsSync(summaryFile) ? summaryFile : null;
    evidence.push({file: relative, end: hashFile(endFile), log: hashFile(logFile), decisions: evidenceFile ? hashFile(evidenceFile) : "missing"});
    if (!evidenceFile) { unavailableGames++; continue; }
    const full = evidenceFile === decisionsFile, compactAll = evidenceFile === timingFile;
    const decisions = full ? readGzipJson<any[]>(decisionsFile) : compactAll ? readGzipJson<any>(timingFile).decisions ?? [] : read<any>(summaryFile).keyDecisions ?? [];
    if (full) { fullTraceGames++; fullTraceDecisions += decisions.length; } else if (compactAll) { compactAllDecisionGames++; compactAllDecisions += decisions.length; } else { compactKeyDecisionGames++; compactKeyDecisions += decisions.length; }
    const timeline = parseTimeline(readGzip(logFile), end), season = seasonFromPath(`${root}/${relative}`);
    for (const [index, decision] of decisions.entries()) {
      const side = decision.playerId as Side, turn = Number(decision.turn), start = timeline.start.get(turn);
      if ((side !== "p1" && side !== "p2") || !start) { unmatchedDecisions++; continue; }
      const selectedActive = start.active[side], one = timeline.end.get(turn) ?? start;
      const finalWindowTurn = Math.min(timeline.lastTurn, turn + 2), three = timeline.end.get(finalWindowTurn) ?? one;
      rows.push({
        season, gameId: relative, decisionOrdinal: Number(decision.decisionOrdinal ?? index + 1), managerId: String(decision.personalityId ?? end.aiProfiles?.[side] ?? side), side,
        context: {...view(start, side), turn, progress: round(turn / Math.max(1, Number(end.turns ?? timeline.lastTurn)))},
        choice: choiceSummary(decision, full ? "full-trace" : compactAll ? "compact-all-decisions" : "compact-key-decision"),
        outcome: {
          won: String(end.winner ?? "") === String(end[side] ?? (side === "p1" ? "Team A" : "Team B")),
          nextTurn: window(view(start, side), view(one, side), one, side, selectedActive),
          nextThreeTurns: window(view(start, side), view(three, side), three, side, selectedActive),
        },
      });
    }
  }
  rows.sort((a, b) => a.season - b.season || a.gameId.localeCompare(b.gameId) || a.decisionOrdinal - b.decisionOrdinal || a.side.localeCompare(b.side));
  const seasons = [...new Set(rows.map(row => row.season))].sort((a, b) => a - b), managers = new Set(rows.map(row => row.managerId));
  return {
    schemaVersion: 1, representationVersion: 1,
    causalBoundary: {context: "public battle state captured before the selected turn", choice: "contemporaneous AI decision trace", outcome: "post-decision observation; activation-ineligible as an input"},
    source: {root, games: games.length, evidenceSha256: hashText(stableStringify(evidence))},
    coverage: {seasons, games: games.length, decisions: rows.length, managers: managers.size, fullTraceGames, compactAllDecisionGames, compactKeyDecisionGames, unavailableGames, fullTraceDecisions, compactAllDecisions, compactKeyDecisions, unmatchedDecisions}, rows,
  };
}

export function tacticalTimingSummary(archive: TacticalTimingArchive): Record<string, unknown> {
  const choices = countBy(archive.rows.map(row => row.choice.kind));
  const styleChanges = archive.rows.filter(row => row.choice.styleChangedRationalWinner === true).length;
  const close = archive.rows.filter(row => row.choice.selectionMargin !== null && Math.abs(row.choice.selectionMargin) <= 12).length;
  const marginBasis = countBy(archive.rows.map(row => row.choice.marginBasis));
  const allDecisionRows = archive.rows.filter(row => row.choice.evidence !== "compact-key-decision"), allDecisionManagers = [...new Set(allDecisionRows.map(row => row.managerId))];
  const outcomes = new Map<string, Set<boolean>>();
  for (const row of allDecisionRows) { const set = outcomes.get(row.managerId) ?? new Set<boolean>(); set.add(row.outcome.won); outcomes.set(row.managerId, set); }
  const managersWithBothOutcomes = [...outcomes.values()].filter(values => values.size > 1).length;
  const readiness = {
    allDecisionRows: allDecisionRows.length,
    managersWithAllDecisionEvidence: allDecisionManagers.length,
    managersWithBothOutcomes,
    populationFrameAvailable: archive.coverage.compactAllDecisionGames > 0,
    currentUse: archive.coverage.compactAllDecisionGames > 0 ? "prospective-observational-screen" : "parser-validation-and-bounded-retrospective-only",
    blockers: [...(archive.coverage.compactAllDecisionGames > 0 ? [] : ["no-compact-all-decision-population-frame"]), ...(archive.coverage.unmatchedDecisions ? ["unmatched-decision-times"] : [])],
  };
  return {schemaVersion: 1, source: archive.source, coverage: archive.coverage, choices, marginBasis, styleChanges, closeScoreDecisions: close, readiness, compressedEstimateTokens: Math.ceil(Buffer.byteLength(JSON.stringify({coverage: archive.coverage, choices, marginBasis, styleChanges, close, readiness})) / 4)};
}

function parseTimeline(log: string, end: any): {start: Map<number, BattleState>; end: Map<number, BattleState>; lastTurn: number} {
  let state = initialState(end), currentTurn = 0;
  const start = new Map<number, BattleState>(), finish = new Map<number, BattleState>();
  for (const line of log.split(/\r?\n/)) {
    const parts = line.split("|"), type = parts[1];
    if (type === "turn") {
      if (currentTurn > 0) finish.set(currentTurn, cloneState(state));
      currentTurn = Number(parts[2]) || currentTurn; start.set(currentTurn, cloneState(state)); continue;
    }
    applyEvent(state, type, parts);
  }
  if (currentTurn > 0) finish.set(currentTurn, cloneState(state));
  return {start, end: finish, lastTurn: Math.max(0, ...start.keys())};
}

function initialState(end: any): BattleState {
  const hp = {p1: new Map<string, number>(), p2: new Map<string, number>()}, status = {p1: new Set<string>(), p2: new Set<string>()};
  for (const side of ["p1", "p2"] as Side[]) for (const member of end[`${side}team`] ?? []) hp[side].set(id(member.name ?? member.species), 1);
  return {hp, status, active: {p1: null, p2: null}, sideConditions: {p1: new Set(), p2: new Set()}, fieldConditions: new Set(), weather: null};
}

function applyEvent(state: BattleState, type: string, parts: string[]): void {
  if (type === "switch" || type === "drag" || type === "replace") {
    const side = player(parts[2]); if (!side) return;
    const key = id(parts[2].split(":").slice(1).join(":")); state.active[side] = key; state.hp[side].set(key, condition(parts[4])); return;
  }
  if (type === "-damage" || type === "-heal" || type === "-sethp") {
    for (let index = 2; index + 1 < parts.length; index += 2) {
      const side = player(parts[index]); if (!side || !looksLikeCondition(parts[index + 1])) continue;
      const key = id(parts[index].split(":").slice(1).join(":")); state.hp[side].set(key, condition(parts[index + 1]));
    }
    return;
  }
  if (type === "faint") { const side = player(parts[2]); if (side) state.hp[side].set(id(parts[2].split(":").slice(1).join(":")), 0); return; }
  if (type === "-status" || type === "-curestatus") {
    const side = player(parts[2]); if (!side) return; const key = id(parts[2].split(":").slice(1).join(":"));
    if (type === "-status") state.status[side].add(key); else state.status[side].delete(key); return;
  }
  if (type === "-sidestart" || type === "-sideend") {
    const side = player(parts[2]); if (!side) return; const key = id(parts[3]);
    if (type === "-sidestart") state.sideConditions[side].add(key); else state.sideConditions[side].delete(key); return;
  }
  if (type === "-fieldstart") state.fieldConditions.add(id(parts[2]));
  else if (type === "-fieldend") state.fieldConditions.delete(id(parts[2]));
  else if (type === "-weather") state.weather = !parts[2] || id(parts[2]) === "none" ? null : id(parts[2]);
}

function view(state: BattleState, side: Side): StateView {
  const opponent: Side = side === "p1" ? "p2" : "p1", ownHp = [...state.hp[side].values()], opponentHp = [...state.hp[opponent].values()];
  const ownRemaining = ownHp.filter(value => value > 0).length, opponentRemaining = opponentHp.filter(value => value > 0).length;
  const ownTeamHp = averageSix(ownHp), opponentTeamHp = averageSix(opponentHp);
  return {ownRemaining, opponentRemaining, materialAdvantage: ownRemaining - opponentRemaining, ownTeamHp, opponentTeamHp, hpAdvantage: round(ownTeamHp - opponentTeamHp), ownActiveHp: activeHp(state, side), opponentActiveHp: activeHp(state, opponent), ownStatused: state.status[side].size, opponentStatused: state.status[opponent].size, ownSideConditions: state.sideConditions[side].size, opponentSideConditions: state.sideConditions[opponent].size, fieldConditions: state.fieldConditions.size, weatherActive: state.weather !== null};
}

function choiceSummary(decision: any, evidence: TacticalTimingRow["choice"]["evidence"]): TacticalTimingRow["choice"] {
  const selected = String(decision.selected ?? ""), trace = decision.whiteBoxShadow?.trace, candidates: any[] = Array.isArray(trace?.candidates) ? trace.candidates : [];
  const ranked = candidates.filter(candidate => candidate.eligible !== false && Number.isFinite(Number(candidate.rationalScore))).sort((a, b) => Number(b.rationalScore) - Number(a.rationalScore));
  const rationalRankIndex = ranked.findIndex(candidate => candidate.id === selected), selectedScore = rationalRankIndex >= 0 ? Number(ranked[rationalRankIndex].rationalScore) : null;
  const bestAlternative = ranked.find(candidate => candidate.id !== selected), rationalMargin = selectedScore === null || !bestAlternative ? null : round(selectedScore - Number(bestAlternative.rationalScore));
  const kind = selected.startsWith("switch ") ? "switch" : selected.startsWith("move ") ? "move" : "other", full = evidence === "full-trace";
  return {evidence, kind, target: decision.actionTargets?.[selected] ?? selected.split(" ")[1] ?? null, terastallize: /\bterastallize\b/.test(selected), candidates: full ? candidates.length : null, reasonableCandidates: full ? candidates.filter(candidate => candidate.reasonable).length : null, switchCandidates: full ? candidates.filter(candidate => String(candidate.id).startsWith("switch ")).length : null, shadowAgrees: typeof decision.whiteBoxShadow?.comparison?.agrees === "boolean" ? decision.whiteBoxShadow.comparison.agrees : null, rationalRank: rationalRankIndex < 0 ? null : rationalRankIndex + 1, selectionMargin: full ? rationalMargin : Number.isFinite(Number(decision.margin)) ? round(Number(decision.margin)) : null, marginBasis: full ? "rational-score" : Number.isFinite(Number(decision.margin)) ? "final-score" : "unavailable", styleChangedRationalWinner: ranked.length ? selected !== ranked[0].id : null};
}

function window(before: StateView, after: StateView, state: BattleState, side: Side, selectedActive: string | null): WindowOutcome {
  return {ownFaints: before.ownRemaining - after.ownRemaining, opponentFaints: before.opponentRemaining - after.opponentRemaining, materialDelta: after.materialAdvantage - before.materialAdvantage, hpAdvantageDelta: round(after.hpAdvantage - before.hpAdvantage), selectedActiveSurvived: selectedActive === null || (state.hp[side].get(selectedActive) ?? 0) > 0};
}

function discoverGames(root: string): string[] {
  const found: string[] = [], visit = (directory: string): void => { for (const entry of fs.readdirSync(directory, {withFileTypes: true})) { const target = path.join(directory, entry.name); if (entry.isDirectory()) visit(target); else if (entry.name === "end.json" && fs.existsSync(path.join(directory, "public.log.gz"))) found.push(directory); } };
  visit(root); return found.sort();
}
function cloneState(value: BattleState): BattleState { return {hp: {p1: new Map(value.hp.p1), p2: new Map(value.hp.p2)}, status: {p1: new Set(value.status.p1), p2: new Set(value.status.p2)}, active: {...value.active}, sideConditions: {p1: new Set(value.sideConditions.p1), p2: new Set(value.sideConditions.p2)}, fieldConditions: new Set(value.fieldConditions), weather: value.weather}; }
function activeHp(state: BattleState, side: Side): number { const key = state.active[side]; return key ? round(state.hp[side].get(key) ?? 0) : 0; }
function condition(value: string): number { if (/\bfnt\b/.test(value)) return 0; const match = value.match(/(\d+)\/(\d+)/); if (match) return round(Number(match[1]) / Math.max(1, Number(match[2]))); const percent = value.match(/(\d+(?:\.\d+)?)%/); return percent ? round(Number(percent[1]) / 100) : 1; }
function looksLikeCondition(value: string): boolean { return /(?:\d+\/\d+|\d+(?:\.\d+)?%|\bfnt\b)/.test(value); }
function averageSix(values: number[]): number { return round(values.reduce((sum, value) => sum + value, 0) / Math.max(6, values.length)); }
function player(value: string | undefined): Side | null { const match = value?.match(/^(p[12])/); return match ? match[1] as Side : null; }
function id(value: unknown): string { return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function seasonFromPath(value: string): number { return Number(value.match(/season-(\d+)/)?.[1] ?? 0); }
function round(value: number): number { return Math.round(value * 1e6) / 1e6; }
function hashFile(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function hashText(value: string): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function stableStringify(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify((value as any)[key])}`).join(",")}}`; return JSON.stringify(value); }
function countBy(values: string[]): Record<string, number> { const result: Record<string, number> = {}; for (const value of values) result[value] = (result[value] ?? 0) + 1; return result; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function readGzip(file: string): string { return zlib.gunzipSync(fs.readFileSync(file)).toString("utf8"); }
function readGzipJson<T>(file: string): T { return JSON.parse(readGzip(file)) as T; }
