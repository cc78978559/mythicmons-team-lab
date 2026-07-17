import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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
  normalizeOpponentModel,
} from "./choice";
import {seedToShowdownSeed} from "./seed";
import {evaluateBattleAssistGate} from "../ai/whiteBox/battle";
import {buildBattleAssistScope} from "../ai/whiteBox/battleScope";

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
  aiOpponentModelShadows?: Record<string, Partial<Record<"p1" | "p2", Partial<AiOpponentModel>>>>;
  aiOpponentModelPolicy?: string;
  explicitSeed?: [number, number, number, number];
  decisionIntervention?: BattleDecisionIntervention;
  battleAssistScopes?: string[];
  battleAssistApprovalSha256?: string;
}

export interface BattleDecisionIntervention {
  decisionOrdinal: number;
  playerId: "p1" | "p2";
  turn: number;
  expectedIncumbent: string;
  selected: string;
}

export interface BattleReplayInput {
  schemaVersion: 1;
  aiVersion: string;
  format: string;
  teamA: string;
  teamB: string;
  seed: [number, number, number, number];
  maxTurns: number;
  idleTimeoutMs: number;
  wallClockTimeoutMs: number;
  ai: AiStrategy;
  openTeamSheets: boolean;
  traceAiDecisions: boolean;
  aiProfiles: Record<"p1" | "p2", AiTacticalProfile>;
  aiOpponentModels: Record<"p1" | "p2", AiOpponentModel>;
  aiOpponentModelShadows?: Record<string, Record<"p1" | "p2", AiOpponentModel>>;
  aiOpponentModelPolicy?: string;
  battleAssistScopes?: string[];
  battleAssistApprovalSha256?: string;
}

export interface BattleReplayCapsule {
  schemaVersion: 1;
  sha256: string;
  input: BattleReplayInput;
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
  replayInputPath: string;
  replayInputSha256: string;
  ai: AiStrategy;
  openTeamSheets: boolean;
  traceAiDecisions: boolean;
  timeout: boolean;
  adjudication: MaxTurnAdjudication | null;
  stalled: boolean;
  stallReason: string | null;
  errors: string[];
  choiceRetries: number;
  decisionInterventionApplied: boolean;
  battleAssistApplications: number;
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
  const seed = input.explicitSeed ? validateShowdownSeed(input.explicitSeed) : seedToShowdownSeed(input.seed, input.gameIndex);
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
  const battleAssistScopes=normalizeBattleAssistScopes(input.battleAssistScopes);
  const battleAssistApprovalSha256=normalizeOptionalSha256(input.battleAssistApprovalSha256);
  if(battleAssistScopes.length&&(input.ai!=="search"||!traceAiDecisions))throw new Error("Battle assist scopes require search AI with decision tracing enabled");
  if(battleAssistScopes.length&&input.decisionIntervention)throw new Error("Battle assist scopes cannot be combined with a decision intervention");
  validateDecisionIntervention(input.decisionIntervention, input.ai, traceAiDecisions);
  const interventionState = {applied: false};
  const assistState={applications:0};
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
  const battleDir = path.join(input.outDir, `game-${String(input.gameIndex + 1).padStart(4, "0")}`);
  fs.mkdirSync(battleDir, {recursive: true});
  const replayInputPath = path.join(battleDir, "replay-input.json");
  const replayCapsule = createBattleReplayCapsule({
    schemaVersion: 1,
    aiVersion: AI_VERSION,
    format: input.format,
    teamA: input.teamA,
    teamB: input.teamB,
    seed,
    maxTurns: input.maxTurns,
    idleTimeoutMs,
    wallClockTimeoutMs,
    ai: input.ai,
    openTeamSheets,
    traceAiDecisions,
    aiProfiles: {p1: aiContexts.p1.tacticalProfile, p2: aiContexts.p2.tacticalProfile},
    aiOpponentModels: {p1: aiContexts.p1.opponentModel, p2: aiContexts.p2.opponentModel},
    aiOpponentModelShadows: normalizeOpponentModelShadows(input.aiOpponentModelShadows),
    aiOpponentModelPolicy: input.aiOpponentModelPolicy,
    battleAssistScopes,
    battleAssistApprovalSha256,
  });
  fs.writeFileSync(replayInputPath, `${JSON.stringify(replayCapsule, null, 2)}\n`, "utf8");
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
          flushPendingRequests(stream, pendingRequests, input.ai, aiContexts, decisionTraces, traceAiDecisions, input.decisionIntervention, interventionState,battleAssistScopes,assistState);
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
          flushPendingRequests(stream, pendingRequests, input.ai, aiContexts, decisionTraces, traceAiDecisions, input.decisionIntervention, interventionState,battleAssistScopes,assistState);
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

  let streamFailure: unknown;
  try {
    await streamReader;
  } catch (error) {
    streamFailure = error;
    stream.destroy();
  } finally {
    stopTimers();
  }

  const rawLogPath = path.join(battleDir, "raw.log");
  const publicLogPath = path.join(battleDir, "public.log");
  const endDataPath = path.join(battleDir, "end.json");
  const decisionLogPath = path.join(battleDir, "ai-decisions.json");

  fs.writeFileSync(rawLogPath, rawBlocks.join("\n\n"), "utf8");
  fs.writeFileSync(publicLogPath, publicLines.join("\n"), "utf8");
  fs.writeFileSync(decisionLogPath, `${JSON.stringify(decisionTraces, null, 2)}\n`, "utf8");
  fs.writeFileSync(endDataPath, `${JSON.stringify({winner, turns, ended, timeout, adjudication, stalled, stallReason, errors, choiceRetries, seed, ai: input.ai, aiVersion: AI_VERSION, replayInput: path.basename(replayInputPath), replayInputSha256: replayCapsule.sha256, decisionIntervention: input.decisionIntervention ?? null, decisionInterventionApplied: interventionState.applied, battleAssistScopes,battleAssistApprovalSha256, battleAssistApplications:assistState.applications, aiProfiles: {p1: aiContexts.p1.tacticalProfile.id, p2: aiContexts.p2.tacticalProfile.id}, aiOpponentModelConfidence: {p1: aiContexts.p1.opponentModel.confidence, p2: aiContexts.p2.opponentModel.confidence}, openTeamSheets, traceAiDecisions, aiDecisionCount: decisionTraces.length, ...endData}, null, 2)}\n`, "utf8");

  if (streamFailure) throw streamFailure;
  if (input.decisionIntervention && !interventionState.applied) {
    throw new Error(`Battle decision intervention ${input.decisionIntervention.decisionOrdinal} was not reached`);
  }

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
    replayInputPath,
    replayInputSha256: replayCapsule.sha256,
    ai: input.ai,
    openTeamSheets,
    traceAiDecisions,
    timeout,
    adjudication,
    stalled,
    stallReason,
    errors,
    choiceRetries,
    decisionInterventionApplied: interventionState.applied,
    battleAssistApplications:assistState.applications,
  };
}

export function createBattleReplayCapsule(input: BattleReplayInput): BattleReplayCapsule {
  validateBattleReplayInput(input);
  const cloned = JSON.parse(JSON.stringify(input)) as BattleReplayInput;
  return {schemaVersion: 1, sha256: replayInputDigest(cloned), input: cloned};
}

export function loadBattleReplayCapsule(file: string): BattleReplayCapsule {
  const capsule = JSON.parse(fs.readFileSync(file, "utf8")) as BattleReplayCapsule;
  if (capsule.schemaVersion !== 1 || capsule.input?.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(capsule.sha256 ?? "")) {
    throw new Error(`Invalid battle replay capsule: ${file}`);
  }
  validateBattleReplayInput(capsule.input);
  const actual = replayInputDigest(capsule.input);
  if (actual !== capsule.sha256) throw new Error(`Battle replay capsule hash mismatch: ${file}`);
  return capsule;
}

function replayInputDigest(input: BattleReplayInput): string {
  return crypto.createHash("sha256").update(canonicalJson(input)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateBattleReplayInput(input: BattleReplayInput): void {
  if (input.schemaVersion !== 1) throw new Error("Unsupported battle replay input schema");
  if (!input.aiVersion || !input.format || !input.teamA || !input.teamB) throw new Error("Incomplete battle replay input");
  validateShowdownSeed(input.seed);
  if (!Number.isInteger(input.maxTurns) || input.maxTurns < 1) throw new Error("Invalid replay maxTurns");
  if (!Number.isFinite(input.idleTimeoutMs) || input.idleTimeoutMs <= 0 || !Number.isFinite(input.wallClockTimeoutMs) || input.wallClockTimeoutMs <= 0) throw new Error("Invalid replay timeout");
  if (!input.aiProfiles?.p1 || !input.aiProfiles?.p2 || !input.aiOpponentModels?.p1 || !input.aiOpponentModels?.p2) throw new Error("Incomplete replay AI state");
  for (const [policy, models] of Object.entries(input.aiOpponentModelShadows ?? {})) {
    if (!policy || !models?.p1 || !models?.p2) throw new Error("Incomplete replay shadow opponent model");
  }
  if (input.aiOpponentModelPolicy !== undefined && !input.aiOpponentModelPolicy.trim()) throw new Error("Invalid replay opponent-model policy");
}

function normalizeOpponentModelShadows(value: BattleInput["aiOpponentModelShadows"]): BattleReplayInput["aiOpponentModelShadows"] {
  if (!value || !Object.keys(value).length) return undefined;
  return Object.fromEntries(Object.entries(value).map(([policy, models]) => [policy, {p1: normalizeOpponentModel(models.p1), p2: normalizeOpponentModel(models.p2)}]));
}

function validateShowdownSeed(seed: [number, number, number, number]): [number, number, number, number] {
  if (!Array.isArray(seed) || seed.length !== 4 || seed.some(value => !Number.isInteger(value) || value < 0 || value > 0xffffffff)) {
    throw new Error("Showdown seed must contain four unsigned 32-bit integers");
  }
  return [...seed] as [number, number, number, number];
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
  intervention?: BattleDecisionIntervention,
  interventionState: {applied: boolean} = {applied: false},
  battleAssistScopes:readonly string[]=[],
  assistState:{applications:number}={applications:0},
): void {
  for (const playerId of ["p1", "p2"] as const) {
    const request = pendingRequests[playerId];
    if (!request) continue;
    delete pendingRequests[playerId];
    const aiContext = aiContexts[playerId];
    let choice = chooseAction(request, playerId, ai, aiContext);
    const trace = aiContext.lastDecision[playerId];
    if (trace && traceAiDecisions) {
      trace.decisionOrdinal = decisionTraces.length + 1;
      if(battleAssistScopes.length)choice=applyApprovedBattleAssist(trace,choice,new Set(battleAssistScopes),assistState);
      if (intervention?.decisionOrdinal === trace.decisionOrdinal) {
        choice = applyBattleDecisionIntervention(trace, choice, playerId, intervention, interventionState);
      }
      decisionTraces.push(trace);
    }
    if (choice === "wait") continue;
    recordAiChoice(aiContext, playerId, choice, request);
    stream.write(`>${playerId} ${choice}`);
  }
}

export function applyApprovedBattleAssist(trace:AiDecisionTrace,incumbent:string,approvedScopes:ReadonlySet<string>,state:{applications:number}):string{
  const shadow=trace.whiteBoxShadow?.comparison.shadow;if(!shadow||shadow===incumbent)return incumbent;
  const incumbentCandidate=trace.whiteBoxShadow?.trace.candidates.find(entry=>entry.id===incumbent),selectedCandidate=trace.whiteBoxShadow?.trace.candidates.find(entry=>entry.id===shadow),scope=buildBattleAssistScope({ownSpecies:trace.battleContext?.ownSpecies,opponentSpecies:trace.battleContext?.opponentSpecies,incumbent,selected:shadow,incumbentTarget:trace.actionTargets?.[incumbent],selectedTarget:trace.actionTargets?.[shadow],incumbentCandidate}),gate=evaluateBattleAssistGate(incumbentCandidate,selectedCandidate),approved=approvedScopes.has(scope.id),applied=approved&&gate.recommended;
  trace.assistPolicy={scopeId:scope.id,approved,gateRecommended:gate.recommended,applied,reasons:[...gate.hardRejections]};
  if(!applied)return incumbent;
  trace.policyIncumbentSelected=incumbent;trace.selected=shadow;state.applications+=1;return shadow;
}

export function applyBattleDecisionIntervention(
  trace: AiDecisionTrace,
  incumbent: string,
  playerId: "p1" | "p2",
  intervention: BattleDecisionIntervention,
  state: {applied: boolean},
): string {
  if (state.applied) throw new Error("Battle decision intervention was applied more than once");
  if (trace.decisionOrdinal !== intervention.decisionOrdinal || playerId !== intervention.playerId || trace.turn !== intervention.turn) {
    throw new Error(`Battle decision intervention target mismatch at ordinal ${intervention.decisionOrdinal}`);
  }
  if (incumbent !== intervention.expectedIncumbent) {
    throw new Error(`Battle decision intervention incumbent mismatch: expected ${intervention.expectedIncumbent}, received ${incumbent}`);
  }
  const candidate = trace.whiteBoxShadow?.trace.candidates.find(entry => entry.id === intervention.selected);
  if (!candidate?.eligible || !candidate.reasonable || candidate.finalScore === null) {
    throw new Error(`Battle decision intervention selected an ineligible candidate: ${intervention.selected}`);
  }
  trace.incumbentSelected = incumbent;
  trace.selected = intervention.selected;
  trace.intervention = {selected: intervention.selected, applied: true};
  state.applied = true;
  return intervention.selected;
}

function validateDecisionIntervention(intervention: BattleDecisionIntervention | undefined, ai: AiStrategy, traceAiDecisions: boolean): void {
  if (!intervention) return;
  if (ai !== "search" || !traceAiDecisions) throw new Error("Battle decision intervention requires search AI with decision tracing enabled");
  if (!Number.isInteger(intervention.decisionOrdinal) || intervention.decisionOrdinal < 1) throw new Error("Invalid battle decision intervention ordinal");
  if (!Number.isInteger(intervention.turn) || intervention.turn < 0 || !intervention.expectedIncumbent || !intervention.selected) throw new Error("Incomplete battle decision intervention target");
}

function normalizeBattleAssistScopes(values:readonly string[]|undefined):string[]{const unique=[...new Set(values??[])].sort();if(unique.some(value=>!/^[a-f0-9]{24}$/.test(value)))throw new Error("Battle assist scopes must be 24-character lowercase hex ids");return unique;}
function normalizeOptionalSha256(value:string|undefined):string|undefined{if(value===undefined||value==="")return undefined;if(!/^[a-f0-9]{64}$/.test(value))throw new Error("Battle assist approval SHA-256 must be lowercase hexadecimal");return value;}
