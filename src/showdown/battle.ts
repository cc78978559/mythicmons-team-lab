import fs from "node:fs";
import path from "node:path";
import {BattleStream, Teams} from "pokemon-showdown";
import {
  AI_VERSION,
  chooseAction,
  createBattleAiContext,
  recordAiChoice,
  updateAiContextFromPublicLine,
  type AiStrategy,
  type AiDecisionTrace,
  type AiTacticalProfile,
  type AiOpponentModel,
  type BattleAiContext,
  type ChoiceRequest,
} from "./choice";
import {seedToShowdownSeed} from "./seed";

export interface BattleInput {
  format: string;
  teamA: string;
  teamB: string;
  seed: string | number;
  gameIndex: number;
  outDir: string;
  maxTurns: number;
  idleTimeoutMs?: number;
  wallClockTimeoutMs?: number;
  ai: AiStrategy;
  openTeamSheets?: boolean;
  traceAiDecisions?: boolean;
  aiProfiles?: Partial<Record<"p1" | "p2", Partial<AiTacticalProfile>>>;
  aiOpponentModels?: Partial<Record<"p1" | "p2", Partial<AiOpponentModel>>>;
}

export interface BattleResult {
  gameIndex: number;
  winner: string | null;
  turns: number;
  ended: boolean;
  seed: [number, number, number, number];
  rawLogPath: string;
  publicLogPath: string;
  endDataPath: string;
  decisionLogPath: string;
  ai: AiStrategy;
  openTeamSheets: boolean;
  traceAiDecisions: boolean;
  timeout: boolean;
  adjudication: MaxTurnAdjudication | null;
  stalled: boolean;
  stallReason: string | null;
  errors: string[];
  choiceRetries: number;
}

export interface MaxTurnAdjudication {
  rule: "remaining-pokemon-then-hp";
  winnerSide: "p1" | "p2" | null;
  reason: "remaining-pokemon" | "remaining-hp" | "exact-tie";
  remainingPokemon: Record<"p1" | "p2", number>;
  remainingHpScore: Record<"p1" | "p2", number>;
}

export async function runBattle(input: BattleInput): Promise<BattleResult> {
  const stream = new BattleStream();
  const seed = seedToShowdownSeed(input.seed, input.gameIndex);
  const rawBlocks: string[] = [];
  const publicLines: string[] = [];
  let turns = 0;
  let winner: string | null = null;
  let ended = false;
  let endData: Record<string, unknown> = {};
  let timeout = false;
  let adjudication: MaxTurnAdjudication | null = null;
  let stalled = false;
  let stallReason: string | null = null;
  const errors: string[] = [];
  const decisionTraces: AiDecisionTrace[] = [];
  let choiceRetries = 0;
  const openTeamSheets = input.openTeamSheets ?? false;
  const traceAiDecisions = input.traceAiDecisions ?? false;
  const teams = {
    p1: Teams.unpack(input.teamA) ?? [],
    p2: Teams.unpack(input.teamB) ?? [],
  };
  const aiContexts = {
    p1: createBattleAiContext(input.format, {openTeamSheets, teams, tacticalProfile: input.aiProfiles?.p1, opponentModel: input.aiOpponentModels?.p1}),
    p2: createBattleAiContext(input.format, {openTeamSheets, teams, tacticalProfile: input.aiProfiles?.p2, opponentModel: input.aiOpponentModels?.p2}),
  };
  const pendingRequests: Partial<Record<"p1" | "p2", ChoiceRequest>> = {};
  const latestRequests: Partial<Record<"p1" | "p2", ChoiceRequest>> = {};
  const rejectedChoices = new Set<"p1" | "p2">();
  const idleTimeoutMs = input.idleTimeoutMs ?? 5000;
  const wallClockTimeoutMs = input.wallClockTimeoutMs ?? 30000;
  let idleTimer: NodeJS.Timeout | undefined;
  let wallClockTimer: NodeJS.Timeout | undefined;

  const stopTimers = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (wallClockTimer) clearTimeout(wallClockTimer);
  };
  const abortAsStalled = (reason: string) => {
    if (ended || timeout || stalled) return;
    stalled = true;
    stallReason = reason;
    stream.destroy();
  };
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => abortAsStalled(`idle timeout after ${idleTimeoutMs}ms`), idleTimeoutMs);
  };

  const streamReader = (async () => {
    for await (const output of stream) {
      resetIdleTimer();
      rawBlocks.push(output);
      const lines = output.split("\n");
      const messageType = lines[0];

      if (messageType === "sideupdate") {
        const queued = queueBattleSideUpdate(lines, pendingRequests, rejectedChoices);
        const playerId = lines[1];
        if ((playerId === "p1" || playerId === "p2") && pendingRequests[playerId]?.side?.pokemon) latestRequests[playerId] = pendingRequests[playerId];
        if (queued && !errors.length && !timeout && !stalled) {
          choiceRetries += 1;
          flushPendingRequests(stream, pendingRequests, input.ai, aiContexts, decisionTraces, traceAiDecisions);
        }
      } else if (messageType === "update") {
        for (const line of publicUpdateLines(lines.slice(1))) {
          if (!line) continue;
          publicLines.push(line);
          updateAiContextFromPublicLine(aiContexts.p1, line);
          updateAiContextFromPublicLine(aiContexts.p2, line);
          if (isProtocolError(line)) {
            errors.push(line);
            stream.destroy();
            break;
          }
          if (line.startsWith("|turn|")) {
            turns = Number(line.split("|")[2]) || turns;
            if (turns >= input.maxTurns && !timeout) {
              timeout = true;
              adjudication = adjudicateMaxTurns(latestRequests);
              if (adjudication) {
                ended = true;
                winner = adjudication.winnerSide === "p1" ? "Team A" : adjudication.winnerSide === "p2" ? "Team B" : null;
                stallReason = `maxTurns adjudicated: ${input.maxTurns} (${adjudication.reason})`;
              } else {
                stallReason = `maxTurns reached without complete side state: ${input.maxTurns}`;
              }
              stream.destroy();
              break;
            }
          }
          if (line.startsWith("|win|")) {
            winner = line.split("|")[2] || null;
          }
        }
        if (!errors.length && !timeout && !stalled) {
          flushPendingRequests(stream, pendingRequests, input.ai, aiContexts, decisionTraces, traceAiDecisions);
        }
      } else if (messageType === "end") {
        ended = true;
        const json = lines.slice(1).join("\n").trim();
        if (json) {
          endData = JSON.parse(json) as Record<string, unknown>;
          if (typeof endData.winner === "string") winner = endData.winner;
          if (typeof endData.turns === "number") turns = endData.turns;
        }
        break;
      }
    }
  })();

  resetIdleTimer();
  wallClockTimer = setTimeout(() => abortAsStalled(`wall-clock timeout after ${wallClockTimeoutMs}ms`), wallClockTimeoutMs);
  stream.write(`>start ${JSON.stringify({
    formatid: input.format,
    seed,
    p1: {name: "Team A", team: input.teamA},
    p2: {name: "Team B", team: input.teamB},
  })}`);

  await streamReader;
  stopTimers();

  const battleDir = path.join(input.outDir, `game-${String(input.gameIndex + 1).padStart(4, "0")}`);
  fs.mkdirSync(battleDir, {recursive: true});

  const rawLogPath = path.join(battleDir, "raw.log");
  const publicLogPath = path.join(battleDir, "public.log");
  const endDataPath = path.join(battleDir, "end.json");
  const decisionLogPath = path.join(battleDir, "ai-decisions.json");

  fs.writeFileSync(rawLogPath, rawBlocks.join("\n\n"), "utf8");
  fs.writeFileSync(publicLogPath, publicLines.join("\n"), "utf8");
  fs.writeFileSync(decisionLogPath, `${JSON.stringify(decisionTraces, null, 2)}\n`, "utf8");
  fs.writeFileSync(endDataPath, `${JSON.stringify({winner, turns, ended, timeout, adjudication, stalled, stallReason, errors, choiceRetries, seed, ai: input.ai, aiVersion: AI_VERSION, aiProfiles: {p1: aiContexts.p1.tacticalProfile.id, p2: aiContexts.p2.tacticalProfile.id}, aiOpponentModelConfidence: {p1: aiContexts.p1.opponentModel.confidence, p2: aiContexts.p2.opponentModel.confidence}, openTeamSheets, traceAiDecisions, aiDecisionCount: decisionTraces.length, ...endData}, null, 2)}\n`, "utf8");

  if (errors.length) {
    throw new Error(`Battle protocol error in game ${input.gameIndex + 1}:\n${errors.join("\n")}`);
  }

  return {
    gameIndex: input.gameIndex,
    winner,
    turns,
    ended,
    seed,
    rawLogPath,
    publicLogPath,
    endDataPath,
    decisionLogPath,
    ai: input.ai,
    openTeamSheets,
    traceAiDecisions,
    timeout,
    adjudication,
    stalled,
    stallReason,
    errors,
    choiceRetries,
  };
}

export function adjudicateMaxTurns(requests: Partial<Record<"p1" | "p2", ChoiceRequest>>): MaxTurnAdjudication | null {
  const p1 = remainingTeamState(requests.p1), p2 = remainingTeamState(requests.p2);
  if (!p1 || !p2) return null;
  const remainingPokemon = {p1: p1.remainingPokemon, p2: p2.remainingPokemon};
  const remainingHpScore = {p1: p1.remainingHpScore, p2: p2.remainingHpScore};
  if (p1.remainingPokemon !== p2.remainingPokemon) {
    return {rule: "remaining-pokemon-then-hp", winnerSide: p1.remainingPokemon > p2.remainingPokemon ? "p1" : "p2", reason: "remaining-pokemon", remainingPokemon, remainingHpScore};
  }
  const hpDifference = p1.remainingHpScore - p2.remainingHpScore;
  if (Math.abs(hpDifference) > 1e-9) {
    return {rule: "remaining-pokemon-then-hp", winnerSide: hpDifference > 0 ? "p1" : "p2", reason: "remaining-hp", remainingPokemon, remainingHpScore};
  }
  return {rule: "remaining-pokemon-then-hp", winnerSide: null, reason: "exact-tie", remainingPokemon, remainingHpScore};
}

function remainingTeamState(request: ChoiceRequest | undefined): {remainingPokemon: number; remainingHpScore: number} | null {
  const pokemon = request?.side?.pokemon;
  if (!pokemon?.length) return null;
  let remainingPokemon = 0, remainingHpScore = 0;
  for (const member of pokemon) {
    const match = member.condition.match(/^(\d+)\/(\d+)/);
    if (!match) {
      if (/^0 fnt/.test(member.condition)) continue;
      return null;
    }
    const current = Number(match[1]), maximum = Number(match[2]);
    if (!Number.isFinite(current) || !Number.isFinite(maximum) || maximum <= 0) return null;
    if (current <= 0) continue;
    remainingPokemon += 1;
    remainingHpScore += Math.min(current, maximum) / maximum;
  }
  return {remainingPokemon, remainingHpScore};
}

function publicUpdateLines(lines: string[]): string[] {
  const publicLines: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("|split|")) {
      publicLines.push(line);
      continue;
    }

    const publicBranch = lines[index + 2];
    if (publicBranch !== undefined) {
      publicLines.push(publicBranch);
      index += 2;
    }
  }
  return publicLines;
}

function isProtocolError(line: string): boolean {
  return line.startsWith("|error|") ||
    line.includes("Invalid choice") ||
    line.includes("Unavailable choice") ||
    line.includes("bigerror") ||
    line.includes("TypeError") ||
    line.includes("doesn't exist");
}

export function queueBattleSideUpdate(
  lines: string[],
  pendingRequests: Partial<Record<"p1" | "p2", ChoiceRequest>>,
  rejectedChoices: Set<"p1" | "p2">,
): boolean {
  const playerId = lines[1];
  if (playerId !== "p1" && playerId !== "p2") return false;
  const choiceRejected = lines.slice(2).some(line => line.startsWith("|error|") && (line.includes("Unavailable choice") || line.includes("Invalid choice")));
  if (choiceRejected) rejectedChoices.add(playerId);
  let hasRequest = false;

  for (const line of lines.slice(2)) {
    if (!line.startsWith("|request|")) continue;
    hasRequest = true;
    const payload = line.slice("|request|".length);
    if (!payload || payload === "null") {
      delete pendingRequests[playerId];
      continue;
    }

    pendingRequests[playerId] = JSON.parse(payload) as ChoiceRequest;
  }
  return hasRequest && rejectedChoices.delete(playerId);
}

function flushPendingRequests(
  stream: BattleStream,
  pendingRequests: Partial<Record<"p1" | "p2", ChoiceRequest>>,
  ai: AiStrategy,
  aiContexts: Record<"p1" | "p2", BattleAiContext>,
  decisionTraces: AiDecisionTrace[],
  traceAiDecisions: boolean,
): void {
  for (const playerId of ["p1", "p2"] as const) {
    const request = pendingRequests[playerId];
    if (!request) continue;
    delete pendingRequests[playerId];
    const aiContext = aiContexts[playerId];
    const choice = chooseAction(request, playerId, ai, aiContext);
    const trace = aiContext.lastDecision[playerId];
    if (trace && traceAiDecisions) decisionTraces.push(trace);
    if (choice === "wait") continue;
    recordAiChoice(aiContext, playerId, choice, request);
    stream.write(`>${playerId} ${choice}`);
  }
}
