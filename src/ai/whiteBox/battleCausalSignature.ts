import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

interface TurnSignature {turn: number; actions: string[]; effects: {damage: number; heal: number; status: number; faint: number; switches: number; moves: number}}
interface GameSignature {
  game: string;
  managerSide: "p1" | "p2";
  teamDelta: {removed: string[]; added: string[]};
  participation: {control: string[]; experiment: string[]; removedUsed: string[]; addedUsed: string[]};
  outcome: {controlWinner: string | null; experimentWinner: string | null; controlTurns: number; experimentTurns: number; changed: boolean};
  firstActionDivergence: number | null;
  behavioralReconvergence: number | null;
  classification: "no-observable-battle-change" | "unused-substitution" | "behavior-reconverged" | "trajectory-change-outcome-neutral" | "outcome-changing";
  chain: {control: TurnSignature[]; experiment: TurnSignature[]};
  totals: {control: TurnSignature["effects"]; experiment: TurnSignature["effects"]};
}
export interface LineupBattleCausalSignature {
  schemaVersion: 1;
  available: boolean;
  reason?: string;
  seriesId: string;
  managerId: string;
  games: GameSignature[];
  summary: {games: number; outcomeChanges: number; actionDivergences: number; unusedSubstitutions: number; reconvergences: number; earliestDivergenceTurn: number | null};
}

export function buildLineupBattleCausalSignature(controlRoot: string, experimentRoot: string, season: number, decisionId: string, managerId: string): LineupBattleCausalSignature {
  const seriesId = parseSeriesId(decisionId, managerId), seasonName = `season-${String(season).padStart(2, "0")}`;
  const controlSeries = path.join(controlRoot, seasonName, "battles", seriesId), experimentSeries = path.join(experimentRoot, seasonName, "battles", seriesId);
  if (!fs.existsSync(controlSeries) || !fs.existsSync(experimentSeries)) return {schemaVersion: 1, available: false, reason: "series-battle-directory-missing", seriesId, managerId, games: [], summary: emptySummary()};
  const controlGames = discoverGames(controlSeries), experimentGames = discoverGames(experimentSeries), names = [...new Set([...controlGames.keys(), ...experimentGames.keys()])].sort();
  const games: GameSignature[] = [];
  for (const name of names) {
    const control = controlGames.get(name), experiment = experimentGames.get(name);
    if (!control || !experiment) throw new Error(`Battle branch game mismatch for ${seriesId}/${name}`);
    games.push(compareGame(name, control, experiment, managerId));
  }
  const divergences = games.map(game => game.firstActionDivergence).filter((turn): turn is number => turn !== null);
  return {
    schemaVersion: 1, available: true, seriesId, managerId, games,
    summary: {
      games: games.length,
      outcomeChanges: games.filter(game => game.outcome.changed).length,
      actionDivergences: divergences.length,
      unusedSubstitutions: games.filter(game => game.classification === "unused-substitution").length,
      reconvergences: games.filter(game => game.behavioralReconvergence !== null).length,
      earliestDivergenceTurn: divergences.length ? Math.min(...divergences) : null,
    },
  };
}

function compareGame(name: string, controlDirectory: string, experimentDirectory: string, managerId: string): GameSignature {
  const controlEnd = read<any>(path.join(controlDirectory, "end.json")), experimentEnd = read<any>(path.join(experimentDirectory, "end.json"));
  const managerSide = sideFor(controlEnd, managerId);
  if (sideFor(experimentEnd, managerId) !== managerSide) throw new Error(`Manager side changed in ${name}`);
  const controlTeam = teamNames(controlEnd, managerSide), experimentTeam = teamNames(experimentEnd, managerSide);
  const removed = controlTeam.filter(member => !experimentTeam.includes(member)), added = experimentTeam.filter(member => !controlTeam.includes(member));
  const controlTurns = parseTurns(readLog(controlDirectory)), experimentTurns = parseTurns(readLog(experimentDirectory));
  const controlParticipation = participation(controlTurns, managerSide), experimentParticipation = participation(experimentTurns, managerSide);
  const first = firstDivergence(controlTurns, experimentTurns), reconvergence = first === null ? null : findReconvergence(controlTurns, experimentTurns, first);
  const outcomeChanged = controlEnd.winner !== experimentEnd.winner;
  const noChangedMemberUsed = !removed.some(member => controlParticipation.has(member)) && !added.some(member => experimentParticipation.has(member));
  const classification: GameSignature["classification"] = outcomeChanged ? "outcome-changing" : first === null ? noChangedMemberUsed ? "unused-substitution" : "no-observable-battle-change" : reconvergence !== null ? "behavior-reconverged" : "trajectory-change-outcome-neutral";
  return {
    game: name, managerSide, teamDelta: {removed, added},
    participation: {control: [...controlParticipation].sort(), experiment: [...experimentParticipation].sort(), removedUsed: removed.filter(member => controlParticipation.has(member)), addedUsed: added.filter(member => experimentParticipation.has(member))},
    outcome: {controlWinner: controlEnd.winner ?? null, experimentWinner: experimentEnd.winner ?? null, controlTurns: Number(controlEnd.turns ?? 0), experimentTurns: Number(experimentEnd.turns ?? 0), changed: outcomeChanged},
    firstActionDivergence: first, behavioralReconvergence: reconvergence, classification,
    chain: {control: chain(controlTurns, first), experiment: chain(experimentTurns, first)},
    totals: {control: totals(controlTurns), experiment: totals(experimentTurns)},
  };
}

function parseTurns(log: string): TurnSignature[] {
  const rows = new Map<number, TurnSignature>(), active = new Map<string, string>(); let turn = 0;
  const row = () => { const existing = rows.get(turn) ?? {turn, actions: [], effects: zeroEffects()}; rows.set(turn, existing); return existing; };
  for (const line of log.split(/\r?\n/)) {
    const parts = line.split("|"); if (parts[1] === "turn") { turn = Number(parts[2]) || turn; row(); continue; }
    const current = row(), type = parts[1];
    if (type === "switch" || type === "drag" || type === "replace") {
      const side = player(parts[2]), species = displaySpecies(parts[3] || parts[2]); active.set(side, species);
      current.actions.push(`switch:${side}:${species}`); current.effects.switches++; continue;
    }
    if (type === "move") { current.actions.push(`move:${player(parts[2])}:${parts[3]}:${player(parts[4])}`); current.effects.moves++; continue; }
    if (type === "cant") { current.actions.push(`cant:${player(parts[2])}:${parts[3] ?? ""}`); continue; }
    if (type === "-terastallize") { current.actions.push(`tera:${player(parts[2])}:${parts[3]}`); continue; }
    if (type === "-damage") current.effects.damage++;
    else if (type === "-heal") current.effects.heal++;
    else if (type === "-status" || type === "-curestatus") current.effects.status++;
    else if (type === "faint") current.effects.faint++;
  }
  return [...rows.values()].filter(entry => entry.actions.length || Object.values(entry.effects).some(Boolean)).sort((left, right) => left.turn - right.turn);
}

function firstDivergence(control: TurnSignature[], experiment: TurnSignature[]): number | null {
  const turns = [...new Set([...control.map(row => row.turn), ...experiment.map(row => row.turn)])].sort((a, b) => a - b);
  for (const turn of turns) if (actionKey(find(control, turn)) !== actionKey(find(experiment, turn))) return turn;
  return null;
}
function findReconvergence(control: TurnSignature[], experiment: TurnSignature[], after: number): number | null {
  const maximum = Math.max(control.at(-1)?.turn ?? 0, experiment.at(-1)?.turn ?? 0);
  for (let turn = after + 1; turn < maximum; turn++) {
    const first = actionKey(find(control, turn)), second = actionKey(find(experiment, turn));
    const nextFirst = actionKey(find(control, turn + 1)), nextSecond = actionKey(find(experiment, turn + 1));
    if (first && first === second && nextFirst && nextFirst === nextSecond) return turn;
  }
  return null;
}
function chain(rows: TurnSignature[], first: number | null): TurnSignature[] { if (first === null) return []; return rows.filter(row => row.turn >= first && row.turn <= first + 2).map(row => ({turn: row.turn, actions: [...row.actions], effects: {...row.effects}})); }
function totals(rows: TurnSignature[]): TurnSignature["effects"] { return rows.reduce((sum, row) => { for (const key of Object.keys(sum) as Array<keyof typeof sum>) sum[key] += row.effects[key]; return sum; }, zeroEffects()); }
function participation(rows: TurnSignature[], side: string): Set<string> { const found = new Set<string>(); for (const row of rows) for (const action of row.actions) { const match = action.match(/^switch:([^:]+):(.+)$/); if (match?.[1] === side) found.add(match[2]); } return found; }
function discoverGames(series: string): Map<string, string> { const games = new Map<string, string>(); const visit = (directory: string): void => { for (const entry of fs.readdirSync(directory, {withFileTypes: true})) { const target = path.join(directory, entry.name); if (entry.isDirectory()) visit(target); else if (entry.name === "end.json" && fs.existsSync(path.join(directory, "public.log.gz"))) games.set(path.relative(series, directory).replaceAll("\\", "/"), directory); } }; visit(series); return games; }
function readLog(directory: string): string { return zlib.gunzipSync(fs.readFileSync(path.join(directory, "public.log.gz"))).toString("utf8"); }
function sideFor(end: any, managerId: string): "p1" | "p2" { if (end.aiProfiles?.p1 === managerId) return "p1"; if (end.aiProfiles?.p2 === managerId) return "p2"; throw new Error(`Manager ${managerId} is absent from battle profiles`); }
function teamNames(end: any, side: "p1" | "p2"): string[] { return (end[`${side}team`] ?? []).map((member: any) => String(member.name ?? member.species)).sort(); }
function parseSeriesId(decisionId: string, managerId: string): string { const prefix = "lineup:", suffix = `:${managerId}`; if (!decisionId.startsWith(prefix) || !decisionId.endsWith(suffix)) throw new Error(`Cannot parse lineup decision ${decisionId}`); return decisionId.slice(prefix.length, -suffix.length); }
function displaySpecies(value: string): string { return value.split(",")[0].trim(); }
function player(value: string | undefined): string { return value?.match(/^(p[12])/)?.[1] ?? ""; }
function find(rows: TurnSignature[], turn: number): TurnSignature | undefined { return rows.find(row => row.turn === turn); }
function actionKey(row: TurnSignature | undefined): string { return row?.actions.join("|") ?? ""; }
function zeroEffects(): TurnSignature["effects"] { return {damage: 0, heal: 0, status: 0, faint: 0, switches: 0, moves: 0}; }
function emptySummary(): LineupBattleCausalSignature["summary"] { return {games: 0, outcomeChanges: 0, actionDivergences: 0, unusedSubstitutions: 0, reconvergences: 0, earliestDivergenceTurn: null}; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
