import {Dex, toID} from "pokemon-showdown";
import type {ModdedDex} from "pokemon-showdown/dist/sim/dex";
import type {Move} from "pokemon-showdown/dist/sim/dex-moves";
import type {PokemonSet} from "pokemon-showdown/dist/sim/teams";
import {compareWhiteBoxShadow, evaluateWhiteBoxDecision, type WhiteBoxDecisionTrace} from "../ai/whiteBox/decision";
import {BATTLE_SHADOW_PARAMETERS} from "../ai/whiteBox/parameters";

export type AiStrategy = "first" | "damage" | "basic" | "tactical" | "search";
export type PlayerId = "p1" | "p2";
export const AI_VERSION = "stateful-choice-v13-personality-v2";
const BATTLE_SHADOW_VALUES = BATTLE_SHADOW_PARAMETERS.snapshot().values;
const INVALID_MOVE_SCORE = Number.NEGATIVE_INFINITY;
type BoostStat = "atk" | "def" | "spa" | "spd" | "spe" | "accuracy" | "evasion";

export interface ChoiceRequest {
  wait?: boolean;
  active?: Array<{
    moves?: Array<{id: string; move: string; disabled?: boolean; pp?: number; target?: string}>;
    trapped?: boolean;
    canTerastallize?: string;
  }>;
  forceSwitch?: boolean[];
  teamPreview?: boolean;
  side?: {
    id?: PlayerId;
    pokemon?: Array<{
      ident: string;
      details?: string;
      condition: string;
      active?: boolean;
      stats?: Partial<Record<"atk" | "def" | "spa" | "spd" | "spe", number>>;
      moves?: string[];
      item?: string;
      ability?: string;
      teraType?: string;
      terastallized?: string;
    }>;
  };
}

interface RequestPokemon {
  ident: string;
  details?: string;
  condition: string;
  active?: boolean;
  stats?: Partial<Record<"atk" | "def" | "spa" | "spd" | "spe", number>>;
  moves?: string[];
  item?: string;
  ability?: string;
  teraType?: string;
  terastallized?: string;
}

export interface BattleAiContext {
  active: Record<PlayerId, KnownActive | null>;
  dex: ModdedDex;
  weather: string | null;
  fieldConditions: Set<string>;
  sideConditions: Record<PlayerId, Record<string, number>>;
  lastMove: Record<PlayerId, string | null>;
  avoidMoves: Record<PlayerId, Set<string>>;
  teraUsed: Record<PlayerId, boolean>;
  teraTypes: Record<PlayerId, Map<string, string>>;
  pendingMoveActor: Record<PlayerId, string | null>;
  requestActiveIdentity: Record<PlayerId, string | null>;
  movesChosenThisEntry: Record<PlayerId, number>;
  consecutiveVoluntarySwitches: Record<PlayerId, number>;
  revealedMoves: Record<PlayerId, Map<string, Set<string>>>;
  pendingWish: Record<PlayerId, boolean>;
  wishSetTurn: Record<PlayerId, number | null>;
  destinyBondBlocked: Record<PlayerId, boolean>;
  turn: number;
  openTeamSheets: boolean;
  teamSheets: Record<PlayerId, PokemonSet[]>;
  fainted: Record<PlayerId, Set<string>>;
  roster: Record<PlayerId, Map<string, KnownActive>>;
  lastDecision: Record<PlayerId, AiDecisionTrace | null>;
  tacticalProfile: AiTacticalProfile;
  opponentModel: AiOpponentModel;
}

export interface BattleAiOptions {
  openTeamSheets?: boolean;
  teams?: Partial<Record<PlayerId, PokemonSet[]>>;
  tacticalProfile?: Partial<AiTacticalProfile>;
  opponentModel?: Partial<AiOpponentModel>;
}

export interface AiOpponentModel {
  confidence: number;
  switchRate: number;
  moveUsage: Record<string, number>;
  moveUsageBySpecies: Record<string, Record<string, number>>;
}

export const EMPTY_OPPONENT_MODEL: AiOpponentModel = {
  confidence: 0,
  switchRate: 0,
  moveUsage: {},
  moveUsageBySpecies: {},
};

export interface AiTacticalProfile {
  id: string;
  expectedWeight: number;
  downsideWeight: number;
  worstWeight: number;
  aggression: number;
  setupBias: number;
  pivotBias: number;
  recoveryBias: number;
  statusBias: number;
  teraBias: number;
  switchBias: number;
}

export const DEFAULT_TACTICAL_PROFILE: AiTacticalProfile = {
  id: "default",
  expectedWeight: .55,
  downsideWeight: .25,
  worstWeight: .2,
  aggression: 0,
  setupBias: 0,
  pivotBias: 0,
  recoveryBias: 0,
  statusBias: 0,
  teraBias: 0,
  switchBias: 0,
};

export interface KnownActive {
  name: string;
  species: string;
  hpPercent: number | null;
  status: string | null;
  boosts: Record<BoostStat, number>;
  abilities: Set<string>;
  items: Set<string>;
  volatiles: Set<string>;
  teraType: string | null;
  hasActed: boolean;
  stats: Partial<Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>>;
  movePp: Map<string, number>;
}

export interface AiDecisionTrace {
  decisionOrdinal?: number;
  turn: number;
  playerId: PlayerId;
  strategy: "search";
  selected: string;
  incumbentSelected?: string;
  intervention?: {
    selected: string;
    applied: true;
  };
  battleContext?: {
    ownSpecies: string | null;
    opponentSpecies: string | null;
  };
  personalityId: string;
  opponentModel: {
    confidence: number;
    switchRate: number;
    activeSpecies: string | null;
    activeMoveSamples: number;
    fallbackMoveSamples: number;
  };
  whiteBoxShadow?: {
    comparison: ReturnType<typeof compareWhiteBoxShadow>;
    trace: WhiteBoxDecisionTrace;
  };
  candidates: Array<{
    choice: string;
    score: number;
    expected: number;
    downside: number;
    worst: number;
    baseScore: number;
    personalityAdjustment: number;
    responses: Array<{response: string; policyShare: number; value: number}>;
  }>;
}

export function createBattleAiContext(format: string, options: BattleAiOptions = {}): BattleAiContext {
  const formatData = Dex.formats.get(format);
  const gameType = formatData.gameType || "singles";
  const openTeamSheets = options.openTeamSheets ?? false;
  if (gameType !== "singles") {
    throw new Error(`AI strategy only supports singles formats; ${format} is ${gameType}`);
  }
  const dex = Dex.mod(formatData.mod || `gen${formatData.gen || 9}`);
  const teamSheets = {
    p1: openTeamSheets ? options.teams?.p1?.map(clonePokemonSet) ?? [] : [],
    p2: openTeamSheets ? options.teams?.p2?.map(clonePokemonSet) ?? [] : [],
  };
  return {
    dex,
    active: {
      p1: null,
      p2: null,
    },
    weather: null,
    fieldConditions: new Set(),
    sideConditions: {p1: {}, p2: {}},
    lastMove: {p1: null, p2: null},
    avoidMoves: {p1: new Set(), p2: new Set()},
    teraUsed: {p1: false, p2: false},
    teraTypes: {p1: new Map(), p2: new Map()},
    pendingMoveActor: {p1: null, p2: null},
    requestActiveIdentity: {p1: null, p2: null},
    movesChosenThisEntry: {p1: 0, p2: 0},
    consecutiveVoluntarySwitches: {p1: 0, p2: 0},
    revealedMoves: {p1: new Map(), p2: new Map()},
    pendingWish: {p1: false, p2: false},
    wishSetTurn: {p1: null, p2: null},
    destinyBondBlocked: {p1: false, p2: false},
    turn: 0,
    openTeamSheets,
    teamSheets,
    fainted: {p1: new Set(), p2: new Set()},
    roster: {
      p1: buildInitialRoster(teamSheets.p1, dex),
      p2: buildInitialRoster(teamSheets.p2, dex),
    },
    lastDecision: {p1: null, p2: null},
    tacticalProfile: normalizeTacticalProfile(options.tacticalProfile),
    opponentModel: normalizeOpponentModel(options.opponentModel),
  };
}

export function normalizeOpponentModel(model: Partial<AiOpponentModel> = {}): AiOpponentModel {
  const moveUsage = Object.fromEntries(Object.entries(model.moveUsage ?? {})
    .map(([move, count]) => [toID(move), Math.max(0, Number.isFinite(count) ? count : 0)] as const)
    .filter(([move, count]) => Boolean(move) && count > 0));
  return {
    confidence: clamp(model.confidence ?? 0, 0, 1),
    switchRate: clamp(model.switchRate ?? 0, 0, 1),
    moveUsage,
    moveUsageBySpecies: Object.fromEntries(Object.entries(model.moveUsageBySpecies ?? {}).map(([species, usage]) => [toID(species), Object.fromEntries(Object.entries(usage)
      .map(([move, count]) => [toID(move), Math.max(0, Number.isFinite(count) ? count : 0)] as const)
      .filter(([move, count]) => Boolean(move) && count > 0))])),
  };
}

export function normalizeTacticalProfile(profile: Partial<AiTacticalProfile> = {}): AiTacticalProfile {
  const expectedWeight = Math.max(0, profile.expectedWeight ?? DEFAULT_TACTICAL_PROFILE.expectedWeight);
  const downsideWeight = Math.max(0, profile.downsideWeight ?? DEFAULT_TACTICAL_PROFILE.downsideWeight);
  const worstWeight = Math.max(0, profile.worstWeight ?? DEFAULT_TACTICAL_PROFILE.worstWeight);
  const total = expectedWeight + downsideWeight + worstWeight || 1;
  return {
    ...DEFAULT_TACTICAL_PROFILE,
    ...profile,
    expectedWeight: expectedWeight / total,
    downsideWeight: downsideWeight / total,
    worstWeight: worstWeight / total,
    aggression: clamp(profile.aggression ?? 0, -1, 1),
    setupBias: clamp(profile.setupBias ?? 0, -1, 1),
    pivotBias: clamp(profile.pivotBias ?? 0, -1, 1),
    recoveryBias: clamp(profile.recoveryBias ?? 0, -1, 1),
    statusBias: clamp(profile.statusBias ?? 0, -1, 1),
    teraBias: clamp(profile.teraBias ?? 0, -1, 1),
    switchBias: clamp(profile.switchBias ?? 0, -1, 1),
  };
}

export function chooseAction(request: ChoiceRequest, playerId: PlayerId, strategy: AiStrategy, context: BattleAiContext): string {
  context.lastDecision[playerId] = null;
  if (request.wait) return "wait";
  if (request.teamPreview) return chooseTeamPreview(request, context, strategy);
  syncOwnRequestState(request, playerId, context);

  if (request.forceSwitch?.some(Boolean)) {
    const switchIndex = bestSwitch(request, playerId, context);
    return switchIndex ? `switch ${switchIndex}` : "pass";
  }

  if (strategy === "first") return chooseFirst(request);
  if (strategy === "damage") return chooseDamage(request, playerId, context);
  if (strategy === "search") return chooseSearch(request, playerId, context);
  if (strategy === "tactical") return chooseTactical(request, playerId, context);
  return chooseBasic(request, playerId, context);
}

export function recordAiChoice(context: BattleAiContext, playerId: PlayerId, choice: string, request?: ChoiceRequest): void {
  const match = choice.match(/^move\s+([^\s]+)/);
  if (!match) {
    if (choice.startsWith("switch ")) {
      context.pendingMoveActor[playerId] = null;
      context.requestActiveIdentity[playerId] = null;
      context.movesChosenThisEntry[playerId] = 0;
      if (!request?.forceSwitch?.some(Boolean)) context.consecutiveVoluntarySwitches[playerId] += 1;
    }
    return;
  }
  context.lastMove[playerId] = toID(match[1]);
  context.consecutiveVoluntarySwitches[playerId] = 0;
  const requestedActive = ownActive(request ?? {});
  const actorName = requestedActive ? parseIdent(requestedActive.ident).name : context.active[playerId]?.name ?? null;
  context.pendingMoveActor[playerId] = actorName;
  context.movesChosenThisEntry[playerId] += 1;
  const active = context.active[playerId];
  if (active && actorName && toID(active.name) === toID(actorName)) active.hasActed = true;
}

export function updateAiContextFromPublicLine(context: BattleAiContext, line: string): void {
  if (!line.startsWith("|")) return;
  const parts = line.split("|");
  const event = parts[1];
  if (event === "-weather") {
    const weather = toID(parts[2]);
    const nextWeather = weather && weather !== "none" ? weather : null;
    if (nextWeather !== context.weather) {
      context.avoidMoves.p1.clear();
      context.avoidMoves.p2.clear();
      context.weather = nextWeather;
    }
    return;
  }
  if (event === "-sidestart" || event === "-sideend") {
    const side = parseSide(parts[2]);
    if (!side) return;
    const condition = toID(parts[3]?.replace(/^move:\s*/i, ""));
    if (!condition) return;
    if (event === "-sideend") {
      delete context.sideConditions[side][condition];
    } else {
      context.sideConditions[side][condition] = (context.sideConditions[side][condition] ?? 0) + 1;
    }
    return;
  }
  if (event === "-fieldstart" || event === "-fieldend") {
    const condition = toID(parts[2]?.replace(/^move:\s*/i, ""));
    if (condition) {
      if (event === "-fieldstart") context.fieldConditions.add(condition);
      else context.fieldConditions.delete(condition);
    }
    return;
  }
  if (event === "-clearallboost") {
    for (const side of ["p1", "p2"] as const) {
      const active = context.active[side];
      if (active) clearBoosts(active.boosts);
    }
    return;
  }
  if (event === "turn") {
    context.turn = Number(parts[2]) || context.turn;
    for (const side of ["p1", "p2"] as const) {
      const setTurn = context.wishSetTurn[side];
      if (setTurn !== null && context.turn >= setTurn + 2) {
        context.pendingWish[side] = false;
        context.wishSetTurn[side] = null;
      }
    }
    return;
  }

  const ident = parseIdent(parts[2]);
  if (ident.side !== "p1" && ident.side !== "p2") return;

  if (event === "switch" || event === "drag") {
    const species = speciesFromDetails(parts[3]) || ident.name;
    const previous = context.active[ident.side];
    if (previous) {
      context.roster[ident.side].set(rosterKey(previous.name, previous.species), cloneKnownActive(previous));
    }
    const sameActive = previous && toID(previous.name) === toID(ident.name) && toID(previous.species) === toID(species);
    const stored = findRosterState(context, ident.side, ident.name, species);
    const next = activateRosterState(stored, ident.name, species, parts[4]);
    if (context.openTeamSheets && !stored) applyOpenTeamSheet(next, ident.side, context);
    next.teraType = context.teraTypes[ident.side].get(toID(ident.name)) ?? null;
    const batonPassed = parts.some(part => /\[from\] Baton Pass/i.test(part));
    if (batonPassed && previous) {
      next.boosts = {...previous.boosts};
      if (previous.volatiles.has("substitute")) next.volatiles.add("substitute");
    }
    const pendingActorMatches = toID(context.pendingMoveActor[ident.side] ?? "") === toID(ident.name);
    next.hasActed = sameActive ? previous.hasActed : pendingActorMatches;
    context.active[ident.side] = next;
    context.roster[ident.side].set(rosterKey(next.name, next.species), next);
    if (!sameActive) context.destinyBondBlocked[ident.side] = false;
    if (pendingActorMatches) context.pendingMoveActor[ident.side] = null;
    context.avoidMoves[ident.side].clear();
    context.avoidMoves[opponentOf(ident.side)].clear();
    return;
  }

  const known = context.active[ident.side];
  if (event === "faint") {
    context.fainted[ident.side].add(toID(ident.name));
    if (known && toID(known.name) === toID(ident.name)) known.hpPercent = 0;
    return;
  }
  if (event === "move") {
    const moveId = toID(parts[3]);
    context.lastMove[ident.side] = moveId;
    rememberRevealedMove(context, ident.side, ident.name, moveId);
    if (known?.movePp.has(moveId)) known.movePp.set(moveId, Math.max(0, (known.movePp.get(moveId) ?? 1) - 1));
    const usedMove = context.dex.moves.get(moveId);
    if (known && usedMove.self?.volatileStatus === "mustrecharge") known.volatiles.add("mustrecharge");
    if (moveId === "wish") {
      context.pendingWish[ident.side] = true;
      context.wishSetTurn[ident.side] = context.turn;
    }
    if (moveId !== "destinybond") context.destinyBondBlocked[ident.side] = false;
    if (known && toID(known.name) === toID(ident.name)) known.hasActed = true;
    if (toID(context.pendingMoveActor[ident.side] ?? "") === toID(ident.name)) context.pendingMoveActor[ident.side] = null;
    return;
  }
  if (event === "-terastallize") {
    context.teraUsed[ident.side] = true;
    if (known) {
      known.teraType = parts[3] || null;
      if (known.teraType) context.teraTypes[ident.side].set(toID(known.name), known.teraType);
    }
    return;
  }
  if (!known) return;

  if (event === "-damage" || event === "-heal") {
    known.hpPercent = hpPercentFromCondition(parts[3]) ?? known.hpPercent;
    known.status = statusFromCondition(parts[3]) ?? known.status;
    if (event === "-heal" && parts.some(part => /move: Wish/i.test(part))) {
      context.pendingWish[ident.side] = false;
      context.wishSetTurn[ident.side] = null;
    }
    return;
  }
  if (event === "-status") {
    known.status = toID(parts[3]) || null;
    return;
  }
  if (event === "-curestatus") {
    known.status = null;
    return;
  }
  if (event === "-ability") {
    addKnownAbility(known, parts[3], context.dex);
    return;
  }
  if (event === "-item") {
    addKnownItem(known, parts[3], context.dex);
    return;
  }
  if (event === "-enditem") {
    removeKnownItem(known, parts[3], context.dex);
    return;
  }
  if (event === "-activate") {
    const abilityPart = parts.find(part => part.startsWith("ability: "));
    if (abilityPart) addKnownAbility(known, abilityPart.slice("ability: ".length), context.dex);
    return;
  }
  if (event === "-start" || event === "-end") {
    const volatile = toID(parts[3]?.replace(/^(move|ability):\s*/i, ""));
    if (volatile) {
      if (event === "-start") known.volatiles.add(volatile);
      else known.volatiles.delete(volatile);
    }
    return;
  }
  if (event === "-singlemove" && toID(parts[3]) === "destinybond") {
    context.destinyBondBlocked[ident.side] = true;
    return;
  }
  if (event === "-boost" || event === "-unboost" || event === "-setboost") {
    const stat = parseBoostStat(parts[3]);
    const amount = Number(parts[4]);
    if (!stat || !Number.isFinite(amount)) return;
    if (event === "-setboost") known.boosts[stat] = clamp(amount, -6, 6);
    else known.boosts[stat] = clamp(known.boosts[stat] + (event === "-boost" ? amount : -amount), -6, 6);
    return;
  }
  if (event === "-clearboost") {
    clearBoosts(known.boosts);
    return;
  }
  if (event === "-clearpositiveboost") {
    for (const stat of boostStats()) known.boosts[stat] = Math.min(0, known.boosts[stat]);
    return;
  }
  if (event === "-clearnegativeboost") {
    for (const stat of boostStats()) known.boosts[stat] = Math.max(0, known.boosts[stat]);
    return;
  }
  if (event === "-invertboost") {
    for (const stat of boostStats()) known.boosts[stat] *= -1;
    return;
  }
  if (event === "-immune") {
    const abilityPart = parts.find(part => part.startsWith("[from] ability: "));
    if (abilityPart) addKnownAbility(known, abilityPart.slice("[from] ability: ".length), context.dex);
    const attacker = opponentOf(ident.side);
    const failedMove = context.lastMove[attacker];
    if (failedMove) context.avoidMoves[attacker].add(failedMove);
    return;
  }
  if (event === "cant") {
    if (toID(parts[3]) === "recharge") known.volatiles.delete("mustrecharge");
    const abilityPart = parts.find(part => part.startsWith("ability: "));
    if (abilityPart) addKnownAbility(known, abilityPart.slice("ability: ".length), context.dex);
    const sourcePart = parts.find(part => part.startsWith("[of] "));
    const source = parseIdent(sourcePart?.slice("[of] ".length));
    const blockedMove = toID(parts[4]);
    if ((source.side === "p1" || source.side === "p2") && blockedMove && abilityPart) {
      context.avoidMoves[source.side].add(blockedMove);
    }
    return;
  }
  if (event === "-fail" && parts.some(part => /Desolate Land|Primordial Sea/i.test(part))) {
    const failedMove = context.lastMove[ident.side];
    if (failedMove) context.avoidMoves[ident.side].add(failedMove);
  }
}

function chooseFirst(request: ChoiceRequest): string {
  const move = availableMoves(request)[0];
  if (move) return `move ${move.id || move.move}`;

  if (isTrapped(request)) return fallbackMoveChoice(request);
  const switchIndex = firstAvailableSwitch(request);
  return switchIndex ? `switch ${switchIndex}` : "pass";
}

function chooseDamage(request: ChoiceRequest, playerId: PlayerId, context: BattleAiContext): string {
  const move = bestMove(request, playerId, context);
  if (move) return moveChoice(move, request, playerId, context, "damage");

  if (isTrapped(request)) return "pass";
  const switchIndex = firstAvailableSwitch(request);
  if (switchIndex) return `switch ${switchIndex}`;
  return fallbackMoveChoice(request);
}

function chooseBasic(request: ChoiceRequest, playerId: PlayerId, context: BattleAiContext): string {
  const active = ownActive(request);
  const hpPercent = active ? hpPercentFromCondition(active.condition) : null;
  const best = bestMove(request, playerId, context);
  const bestScore = best ? estimateMoveScore(best, request, playerId, context) : 0;

  if (bestScore <= 0 && !isTrapped(request)) {
    const switchIndex = bestSwitch(request, playerId, context);
    if (switchIndex) return `switch ${switchIndex}`;
  }

  if (shouldSwitchForSurvival(request, playerId, context, hpPercent, bestScore, best)) {
    const switchIndex = bestSwitch(request, playerId, context);
    if (switchIndex) return `switch ${switchIndex}`;
  }

  if (best) return moveChoice(best, request, playerId, context, "basic");

  if (isTrapped(request)) return fallbackMoveChoice(request);
  const switchIndex = bestSwitch(request, playerId, context);
  if (switchIndex) return `switch ${switchIndex}`;
  return fallbackMoveChoice(request);
}

function chooseTactical(request: ChoiceRequest, playerId: PlayerId, context: BattleAiContext): string {
  const batonPlan = chooseBatonPassPlan(request, playerId, context);
  if (batonPlan) return batonPlan;
  const move = bestTacticalMove(request, playerId, context);
  const moveScore = move ? estimateTacticalMoveScore(move, request, playerId, context) : 0;
  const active = ownActive(request);
  const hpPercent = active ? hpPercentFromCondition(active.condition) : null;

  if (moveScore <= 0 && !isTrapped(request)) {
    const switchIndex = bestSwitch(request, playerId, context);
    if (switchIndex) return `switch ${switchIndex}`;
  }

  if (shouldSwitchForSurvival(request, playerId, context, hpPercent, moveScore, move)) {
    const switchIndex = bestSwitch(request, playerId, context);
    if (switchIndex) return `switch ${switchIndex}`;
  }

  if (move) return moveChoice(move, request, playerId, context, "tactical");

  if (isTrapped(request)) return fallbackMoveChoice(request);
  const switchIndex = bestSwitch(request, playerId, context);
  if (switchIndex) return `switch ${switchIndex}`;
  return fallbackMoveChoice(request);
}

type SearchAction =
  | {kind: "move"; choice: string; move: {id: string; move: string}; teraType?: string; prior: number}
  | {kind: "switch"; choice: string; candidate: RequestPokemon & {index: number}; prior: number};

type SearchResponse =
  | {kind: "move"; moveId: string; teraType?: string; policyShare: number}
  | {kind: "switch"; set: PokemonSet; policyShare: number};
type UnweightedSearchResponse =
  | {kind: "move"; moveId: string; teraType?: string}
  | {kind: "switch"; set: PokemonSet};

function chooseSearch(request: ChoiceRequest, playerId: PlayerId, context: BattleAiContext): string {
  const actions = searchActions(request, playerId, context);
  if (!actions.length) return fallbackMoveChoice(request);
  const responses = opponentSearchResponses(request, playerId, context);
  const ranked = actions.map(action => {
    const outcomes = responses.length
      ? responses.map(response => ({
          response,
          value: evaluateSearchOutcome(action, response, request, playerId, context),
        }))
      : [{response: null, value: action.prior}];
    const values = outcomes.map(outcome => outcome.value);
    const expected = outcomes.reduce((total, outcome) => {
      return total + outcome.value * (outcome.response?.policyShare ?? 1);
    }, 0);
    const worst = Math.min(...values);
    const downside = weightedDownside(outcomes.map(outcome => ({
      value: outcome.value,
      weight: outcome.response?.policyShare ?? 1,
    })), 0.35);
    const profile = context.tacticalProfile;
    const baseScore = expected * profile.expectedWeight + downside * profile.downsideWeight + worst * profile.worstWeight;
    const personalityAdjustment = tacticalPersonalityAdjustment(action, context);
    return {action, outcomes, expected, worst, downside, baseScore, personalityAdjustment, score: baseScore + personalityAdjustment};
  });
  ranked.sort((left, right) => right.score - left.score || left.action.choice.localeCompare(right.action.choice));
  const selected = ranked[0].action.choice;
  const whiteBoxTrace = evaluateWhiteBoxDecision({
    decisionId: `battle:${context.turn}:${playerId}`,
    reasonableBand: BATTLE_SHADOW_VALUES["battle.reasonableband"],
    styleContributionLimit: BATTLE_SHADOW_VALUES["battle.stylelimit"],
    candidates: ranked.map(entry => ({
      id: entry.action.choice,
      rational: [
        {id: "battle.expected", group: "expected", source: "competence", value: entry.expected * context.tacticalProfile.expectedWeight, reason: "Expected outcome value"},
        {id: "battle.downside", group: "risk", source: "risk", value: entry.downside * context.tacticalProfile.downsideWeight, reason: "Weighted downside value"},
        {id: "battle.worst", group: "risk", source: "risk", value: entry.worst * context.tacticalProfile.worstWeight, reason: "Worst-response value"},
      ],
      style: [
        {id: "battle.personality", group: "personality", source: "personality", value: entry.personalityAdjustment, reason: `Tactical profile ${context.tacticalProfile.id}`},
      ],
    })),
  });
  context.lastDecision[playerId] = {
    turn: context.turn,
    playerId,
    strategy: "search",
    selected,
    battleContext: {ownSpecies: context.active[playerId]?.species ?? null, opponentSpecies: context.active[opponentOf(playerId)]?.species ?? null},
    personalityId: context.tacticalProfile.id,
    opponentModel: opponentModelTrace(context, playerId),
    whiteBoxShadow: {comparison: compareWhiteBoxShadow(whiteBoxTrace, selected), trace: whiteBoxTrace},
    candidates: ranked.map(entry => ({
      choice: entry.action.choice,
      score: roundDecisionValue(entry.score),
      expected: roundDecisionValue(entry.expected),
      downside: roundDecisionValue(entry.downside),
      worst: roundDecisionValue(entry.worst),
      baseScore: roundDecisionValue(entry.baseScore),
      personalityAdjustment: roundDecisionValue(entry.personalityAdjustment),
      responses: entry.outcomes.map(outcome => ({
        response: outcome.response ? searchResponseLabel(outcome.response) : "unknown",
        policyShare: roundDecisionValue(outcome.response?.policyShare ?? 1),
        value: roundDecisionValue(outcome.value),
      })),
    })),
  };
  return selected;
}

function opponentModelTrace(context: BattleAiContext, playerId: PlayerId): AiDecisionTrace["opponentModel"] {
  const species = context.active[opponentOf(playerId)]?.species ?? null;
  const scoped = species ? context.opponentModel.moveUsageBySpecies[toID(species)] : undefined;
  return {
    confidence: roundDecisionValue(context.opponentModel.confidence),
    switchRate: roundDecisionValue(context.opponentModel.switchRate),
    activeSpecies: species,
    activeMoveSamples: Object.values(scoped ?? {}).reduce((sum, count) => sum + count, 0),
    fallbackMoveSamples: Object.values(context.opponentModel.moveUsage).reduce((sum, count) => sum + count, 0),
  };
}

function tacticalPersonalityAdjustment(action: SearchAction, context: BattleAiContext): number {
  const profile = context.tacticalProfile;
  if (action.kind === "switch") {
    return clamp(profile.switchBias * 9 - profile.aggression * 3, -15, 15);
  }
  const move = context.dex.moves.get(action.move.id || action.move.move);
  let adjustment = move.category === "Status" ? profile.statusBias * 5 : profile.aggression * 4;
  if (move.selfSwitch) adjustment += profile.pivotBias * 8;
  if (move.flags.heal) adjustment += profile.recoveryBias * 8;
  if (move.boosts || move.self?.boosts || setupBoosts(move.id)) adjustment += profile.setupBias * 8;
  if (action.teraType) adjustment += profile.teraBias * 8;
  return clamp(adjustment, -15, 15);
}

function searchActions(request: ChoiceRequest, playerId: PlayerId, context: BattleAiContext): SearchAction[] {
  const actions: SearchAction[] = [];
  const batonPlan = chooseBatonPassPlan(request, playerId, context);
  for (const move of availableMoves(request)) {
    const score = estimateTacticalMoveScore(move, request, playerId, context);
    if (!Number.isFinite(score)) continue;
    const choice = `move ${move.id || move.move}`;
    actions.push({kind: "move", choice, move, prior: clamp(score, -250, 300) + (batonPlan === choice ? 45 : 0)});
    const teraType = request.active?.[0]?.canTerastallize;
    if (teraType && !context.teraUsed[playerId]) {
      const own = context.active[playerId];
      const previousTera = own?.teraType ?? null;
      if (own) own.teraType = teraType;
      try {
        const teraScore = estimateTacticalMoveScore(move, request, playerId, context);
        if (Number.isFinite(teraScore)) {
          const teraChoice = `${choice} terastallize`;
          actions.push({
            kind: "move",
            choice: teraChoice,
            move,
            teraType,
            prior: clamp(teraScore, -250, 300) + (batonPlan === teraChoice ? 45 : 0),
          });
        }
      } finally {
        if (own) own.teraType = previousTera;
      }
    }
  }
  if (!isTrapped(request)) {
    for (const candidate of switchCandidates(request)) {
      actions.push({
        kind: "switch",
        choice: `switch ${candidate.index}`,
        candidate,
        prior: searchSwitchPrior(candidate, request, playerId, context),
      });
    }
  }
  if (!actions.length) {
    const move = availableMoves(request)[0];
    if (move) actions.push({kind: "move", choice: `move ${move.id || move.move}`, move, prior: -100});
  }
  return actions;
}

function opponentSearchResponses(request: ChoiceRequest, playerId: PlayerId, context: BattleAiContext): SearchResponse[] {
  const opponentId = opponentOf(playerId);
  const active = context.active[opponentId];
  if (!active) return [];
  const weighted: Array<{response: UnweightedSearchResponse; weight: number}> = [];
  const activeSheet = context.openTeamSheets ? findTeamSheet(context, opponentId, active.name, active.species) : undefined;
  const legalMoveIds = legalOpponentMoveIds(context, opponentId, active);
  for (const moveId of legalMoveIds) {
    const weight = opponentMoveResponseWeight(moveId, request, playerId, context)
      * learnedMoveMultiplier(moveId, legalMoveIds, context.opponentModel, active.species);
    weighted.push({response: {kind: "move", moveId}, weight});
    const move = context.dex.moves.get(moveId);
    if (!context.teraUsed[opponentId] && activeSheet?.teraType && move.category !== "Status") {
      weighted.push({response: {kind: "move", moveId, teraType: activeSheet.teraType}, weight: weight * 0.35});
    }
  }
  if (context.openTeamSheets && opponentCanSwitch(active, playerId, context)) {
    for (const set of context.teamSheets[opponentId]) {
      const name = set.name || set.species;
      if (context.fainted[opponentId].has(toID(name))) continue;
      if (toID(name) === toID(active.name) || toID(set.species) === toID(active.species)) continue;
      const switchState = knownSwitchState(set, opponentId, context);
      if (switchState.hpPercent === 0) continue;
      weighted.push({
        response: {kind: "switch", set},
        weight: opponentSwitchResponseWeight(set, request, playerId, context)
          * learnedSwitchMultiplier(context.opponentModel),
      });
    }
  }
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  return weighted.map(entry => ({...entry.response, policyShare: entry.weight / Math.max(0.001, total)}) as SearchResponse);
}

export function learnedMoveMultiplier(moveId: string, legalMoveIds: readonly string[], model: AiOpponentModel, opponentSpecies?: string): number {
  if (model.confidence <= 0 || legalMoveIds.length === 0) return 1;
  const scopedUsage = opponentSpecies ? model.moveUsageBySpecies[toID(opponentSpecies)] : undefined;
  const usage = scopedUsage && Object.keys(scopedUsage).length ? scopedUsage : model.moveUsage;
  const total = Object.values(usage).reduce((sum, count) => sum + count, 0);
  if (total <= 0) return 1;
  const smoothing = .5;
  const observedShare = ((usage[toID(moveId)] ?? 0) + smoothing) / (total + smoothing * legalMoveIds.length);
  const uniformShare = 1 / legalMoveIds.length;
  const empiricalRatio = clamp(observedShare / uniformShare, .3, 3);
  return 1 + model.confidence * (empiricalRatio - 1);
}

export function learnedSwitchMultiplier(model: AiOpponentModel): number {
  if (model.confidence <= 0) return 1;
  const empiricalRatio = clamp((model.switchRate + .02) / .1, .35, 3);
  return 1 + model.confidence * (empiricalRatio - 1);
}

function opponentMoveResponseWeight(
  moveId: string,
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
): number {
  const move = context.dex.moves.get(moveId);
  const opponent = context.active[opponentOf(playerId)];
  const own = context.active[playerId];
  const damage = estimateIncomingMoveDamagePercent(moveId, request, playerId, context) ?? 0;
  let weight = 1 + clamp(damage / 22, 0, 5);
  if (!move.exists) return weight;
  if (move.priority > 0 && own?.hpPercent !== null && own?.hpPercent !== undefined && own.hpPercent <= 35) weight += 2;
  if (move.selfSwitch) weight += 1.5;
  if (move.category === "Status") {
    if (move.flags.heal && opponent?.hpPercent !== null && opponent?.hpPercent !== undefined && opponent.hpPercent <= 65) weight += 3;
    if (["willowisp", "thunderwave", "toxic", "spore", "sleeppowder"].includes(move.id) && !own?.status) weight += 2;
    if (setupBoosts(move.id) && (opponent?.hpPercent ?? 100) >= 55) weight += 1.5;
    if (["taunt", "encore", "haze"].includes(move.id)) weight += 1;
  }
  return weight;
}

function opponentSwitchResponseWeight(
  set: PokemonSet,
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
): number {
  const switched = knownSwitchState(set, opponentOf(playerId), context);
  const scores = availableMoves(request).map(move => {
    return scoreMoveAgainstTemporaryOpponent(move, request, playerId, context, switched);
  }).filter(Number.isFinite);
  const bestIncoming = scores.length ? Math.max(...scores) : 100;
  const candidate = requestPokemonFromSheet(set);
  const own = context.active[playerId];
  const pressure = own ? candidateOffensivePressure(candidate, own, context.dex) : 0;
  return 0.75 + clamp((150 - bestIncoming) / 35, 0, 4) + clamp(pressure / 100, 0, 2.5);
}

function legalOpponentMoveIds(context: BattleAiContext, playerId: PlayerId, active: KnownActive): string[] {
  if (active.volatiles.has("mustrecharge")) return ["recharge"];
  let moves = revealedMoveIds(context, playerId, active).filter(moveId => {
    const move = context.dex.moves.get(moveId);
    if (!move.exists) return false;
    if ((active.movePp.get(moveId) ?? 1) <= 0) return false;
    if (move.category === "Status" && (active.volatiles.has("taunt") || active.items.has("assaultvest"))) return false;
    return true;
  });
  if (["choiceband", "choicescarf", "choicespecs"].some(item => active.items.has(item)) && active.hasActed) {
    const lockedMove = context.lastMove[playerId];
    if (lockedMove && moves.includes(lockedMove)) moves = [lockedMove];
  }
  return moves;
}

function opponentCanSwitch(active: KnownActive, searchingPlayer: PlayerId, context: BattleAiContext): boolean {
  if (active.volatiles.has("mustrecharge") || active.volatiles.has("trapped") || active.volatiles.has("partiallytrapped")) return false;
  const trapper = context.active[searchingPlayer];
  if (!trapper) return true;
  if (trapper.abilities.has("shadowtag") && !active.abilities.has("shadowtag") && !activeTypes(context.dex, active).includes("Ghost")) return false;
  if (trapper.abilities.has("arenatrap")) {
    const types = activeTypes(context.dex, active);
    if (!types.includes("Flying") && !active.abilities.has("levitate") && !active.items.has("airballoon")) return false;
  }
  if (trapper.abilities.has("magnetpull") && activeTypes(context.dex, active).includes("Steel")) return false;
  return true;
}

function opponentStatusConsequence(
  moveId: string,
  action: SearchAction,
  targetRequest: RequestPokemon | undefined,
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
): number {
  const move = context.dex.moves.get(moveId);
  if (!move.exists || move.category !== "Status") return 0;
  const opponent = context.active[opponentOf(playerId)];
  const target = targetRequest ? knownFromRequestPokemon(targetRequest, context.dex) : context.active[playerId];
  const ownMove = action.kind === "move" ? context.dex.moves.get(action.move.id || action.move.move) : null;
  if (["protect", "detect", "kingsshield", "spikyshield", "banefulbunker"].includes(move.id)) {
    return action.kind === "move" && ownMove?.target !== "self" ? Math.max(25, action.prior * 0.8) : 0;
  }
  if (move.flags.heal) {
    const missing = 100 - (opponent?.hpPercent ?? 100);
    return missing * 0.9;
  }
  if (move.id === "haze") return positiveBoostTotal(context.active[playerId]?.boosts ?? createZeroBoosts()) * 18;
  if (move.id === "taunt") return action.kind === "move" && ownMove?.category === "Status" ? 90 : 12;
  if (move.id === "encore") return context.lastMove[playerId] ? 35 : 10;
  const setup = setupBoosts(move.id);
  if (setup) return Object.values(setup).reduce((sum, amount) => sum + (amount ?? 0) * 18, 0);
  if (["reflect", "lightscreen", "auroraveil"].includes(move.id)) return 30;
  if (!target || statusMoveBlockedForTarget(move.id, target, context.dex)) return 0;
  if (["spore", "sleeppowder", "hypnosis", "lovelykiss", "sing"].includes(move.id)) return 75;
  if (move.id === "willowisp") {
    const physical = ownMove?.category === "Physical" || (targetRequest?.stats?.atk ?? 0) > (targetRequest?.stats?.spa ?? 0);
    return physical ? 58 : 28;
  }
  if (move.id === "thunderwave") return 48;
  if (["toxic", "poisonpowder"].includes(move.id)) return 42;
  if (["leechseed", "saltcure"].includes(move.id)) return 35;
  return 8;
}

function knownFromRequestPokemon(pokemon: RequestPokemon, dex: ModdedDex): KnownActive {
  const species = speciesFromDetails(pokemon.details) || pokemon.ident.split(":").slice(1).join(":").trim();
  const known = createKnownActive(parseIdent(pokemon.ident).name, species, pokemon.condition);
  addKnownAbility(known, pokemon.ability ?? "", dex);
  addKnownItem(known, pokemon.item ?? "", dex);
  known.stats = {...pokemon.stats};
  return known;
}

function statusMoveBlockedForTarget(moveId: string, target: KnownActive, dex: ModdedDex): boolean {
  const types = activeTypes(dex, target);
  if (["spore", "sleeppowder", "poisonpowder"].includes(moveId) &&
    (types.includes("Grass") || target.abilities.has("overcoat") || target.items.has("safetygoggles"))) return true;
  if (["spore", "sleeppowder", "hypnosis", "lovelykiss", "sing"].includes(moveId) &&
    ["comatose", "insomnia", "vitalspirit"].some(ability => target.abilities.has(ability))) return true;
  if (moveId === "willowisp" && (types.includes("Fire") || target.abilities.has("waterveil") || target.abilities.has("waterbubble"))) return true;
  if (moveId === "thunderwave" && (!dex.getImmunity("Electric", types) || target.abilities.has("limber"))) return true;
  if (["toxic", "poisonpowder"].includes(moveId) && (types.includes("Poison") || types.includes("Steel") || target.abilities.has("immunity"))) return true;
  return false;
}

function evaluateJointAction(
  action: SearchAction,
  response: SearchResponse,
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
): number {
  if (action.kind === "move") return evaluateMoveResponse(action, response, request, playerId, context);
  return evaluateSwitchResponse(action, response, request, playerId, context);
}

function evaluateSearchOutcome(
  action: SearchAction,
  response: SearchResponse,
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
): number {
  const opponent = context.active[opponentOf(playerId)];
  const own = context.active[playerId];
  const previousTera = opponent?.teraType ?? null;
  const previousOwnTera = own?.teraType ?? null;
  if (opponent && response.kind === "move" && response.teraType) opponent.teraType = response.teraType;
  if (own && action.kind === "move" && action.teraType) own.teraType = action.teraType;
  try {
    return boundedSearchValue(
      evaluateJointAction(action, response, request, playerId, context) +
      continuationValue(action, response, request, playerId, context),
    );
  } finally {
    if (opponent) opponent.teraType = previousTera;
    if (own) own.teraType = previousOwnTera;
  }
}

function evaluateMoveResponse(
  action: Extract<SearchAction, {kind: "move"}>,
  response: SearchResponse,
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
): number {
  let value = action.prior;
  if (response.kind === "switch") {
    const switched = knownSwitchState(response.set, opponentOf(playerId), context);
    value = scoreMoveAgainstTemporaryOpponent(action.move, request, playerId, context, switched);
    if (action.move.id === "fakeout") value -= 80;
    return value;
  }

  let incoming = estimateIncomingMoveDamagePercent(response.moveId, request, playerId, context) ?? 0;
  const hp = context.active[playerId]?.hpPercent ?? hpPercentFromCondition(ownActive(request)?.condition ?? "") ?? 100;
  const actsFirst = moveActsFirstAgainst(action.move, response.moveId, request, playerId, context);
  const move = context.dex.moves.get(action.move.id || action.move.move);
  const roleValue = uniqueActiveRoleValue(request, context.dex);
  const outgoing = estimateOwnMoveDamagePercent(action.move, request, playerId, context);
  const opponentHp = context.active[opponentOf(playerId)]?.hpPercent ?? 100;
  if (["protect", "detect", "kingsshield", "spikyshield", "banefulbunker"].includes(move.id)) {
    const blocked = context.dex.moves.get(response.moveId).category !== "Status" ? incoming : 0;
    return value + Math.min(60, blocked * 0.8);
  }
  if (move.flags.heal && actsFirst) incoming = Math.max(0, incoming - Math.min(50, 100 - hp));
  if (move.category !== "Status" && actsFirst && outgoing >= opponentHp) return value + 120;
  value -= opponentStatusConsequence(response.moveId, action, ownActive(request), request, playerId, context);
  if (!actsFirst && incoming >= hp) return Math.min(value, 0) - 180 - roleValue;
  value -= incoming * 1.15;
  if (incoming >= hp * 0.9 && !actsFirst) value -= 150 + roleValue;
  if (move.category === "Status" && incoming >= hp * 0.65 && !actsFirst) value -= 70;
  if (actsFirst && move.priority > 0) value += 8;
  return value;
}

function evaluateSwitchResponse(
  action: Extract<SearchAction, {kind: "switch"}>,
  response: SearchResponse,
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
): number {
  let value = action.prior;
  if (response.kind === "move") {
    const species = speciesFromDetails(action.candidate.details) || action.candidate.ident.split(":").slice(1).join(":").trim();
    const abilities = sourceAbilityIds(context.dex, action.candidate.ability);
    const defense = defensiveTypeScore(context.dex, species, context.active[opponentOf(playerId)]?.species ?? "", [response.moveId], abilities);
    value += defense;
    const move = context.dex.moves.get(response.moveId);
    const roleValue = uniqueRoleValue(action.candidate, request, context.dex);
    value -= opponentStatusConsequence(response.moveId, action, action.candidate, request, playerId, context);
    if (move.exists && defense < -20 && hpPercentFromCondition(action.candidate.condition) !== null) value -= roleValue;
    return value;
  }
  const opponent = knownSwitchState(response.set, opponentOf(playerId), context);
  return value + candidateOffensivePressure(action.candidate, opponent, context.dex) * 0.35;
}

function continuationValue(
  action: SearchAction,
  response: SearchResponse,
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
): number {
  if (action.kind === "switch") {
    const opponent = response.kind === "switch"
      ? knownSwitchState(response.set, opponentOf(playerId), context)
      : context.active[opponentOf(playerId)];
    if (!opponent) return 0;
    const pressure = candidateOffensivePressure(action.candidate, opponent, context.dex);
    return clamp(pressure * 0.12, 0, 24);
  }

  if (response.kind === "switch") {
    const switched = knownSwitchState(response.set, opponentOf(playerId), context);
    return clamp(bestFollowUpScoreAgainst(switched, request, playerId, context) * 0.18, -30, 45);
  }

  const move = context.dex.moves.get(action.move.id || action.move.move);
  if (!move.exists) return 0;
  const incoming = estimateIncomingMoveDamagePercent(response.moveId, request, playerId, context) ?? 0;
  const ownHp = context.active[playerId]?.hpPercent ?? hpPercentFromCondition(ownActive(request)?.condition ?? "") ?? 100;
  const opponent = context.active[opponentOf(playerId)];
  const opponentHp = opponent?.hpPercent ?? 100;
  const actsFirst = moveActsFirstAgainst(action.move, response.moveId, request, playerId, context);
  const outgoing = estimateOwnMoveDamagePercent(action.move, request, playerId, context);

  if (outgoing >= opponentHp && actsFirst) return 0;
  if (incoming >= ownHp && !actsFirst) return 0;
  if (move.category === "Status") return clamp(action.prior * 0.1, 0, 24);

  const ownSurvival = clamp((ownHp - incoming) / Math.max(1, ownHp), 0, 1);
  const opponentSurvival = clamp((opponentHp - outgoing) / Math.max(1, opponentHp), 0, 1);
  const followUp = Math.max(0, ...availableMoves(request).map(candidate => {
    return estimateTacticalMoveScore(candidate, request, playerId, context);
  }).filter(Number.isFinite));
  return clamp(followUp * 0.18 * ownSurvival * (1.2 - opponentSurvival * 0.2), 0, 45);
}

function bestFollowUpScoreAgainst(
  opponent: KnownActive,
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
): number {
  const opponentId = opponentOf(playerId);
  const previous = context.active[opponentId];
  context.active[opponentId] = opponent;
  try {
    return Math.max(0, ...availableMoves(request).map(move => {
      return estimateTacticalMoveScore(move, request, playerId, context);
    }).filter(Number.isFinite));
  } finally {
    context.active[opponentId] = previous;
  }
}

function weightedDownside(outcomes: Array<{value: number; weight: number}>, mass: number): number {
  const ordered = [...outcomes].sort((left, right) => left.value - right.value);
  let remaining = mass;
  let total = 0;
  for (const outcome of ordered) {
    if (remaining <= 0) break;
    const used = Math.min(remaining, outcome.weight);
    total += outcome.value * used;
    remaining -= used;
  }
  if (remaining > 0 && ordered.length) total += ordered.at(-1)!.value * remaining;
  return total / Math.max(0.001, mass);
}

function searchResponseLabel(response: SearchResponse): string {
  return response.kind === "move"
    ? `move ${response.moveId}${response.teraType ? ` terastallize ${response.teraType}` : ""}`
    : `switch ${response.set.name || response.set.species}`;
}

function roundDecisionValue(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function boundedSearchValue(value: number): number {
  if (!Number.isFinite(value)) return -160;
  return clamp(value, -400, 500);
}

function scoreMoveAgainstTemporaryOpponent(
  move: {id: string; move: string},
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
  opponent: KnownActive,
): number {
  const opponentId = opponentOf(playerId);
  const previous = context.active[opponentId];
  context.active[opponentId] = opponent;
  try {
    return boundedSearchValue(estimateTacticalMoveScore(move, request, playerId, context));
  } finally {
    context.active[opponentId] = previous;
  }
}

function searchSwitchPrior(
  candidate: RequestPokemon & {index: number},
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
): number {
  const hp = hpPercentFromCondition(candidate.condition) ?? 0;
  const species = speciesFromDetails(candidate.details) || candidate.ident.split(":").slice(1).join(":").trim();
  const abilities = sourceAbilityIds(context.dex, candidate.ability);
  const items = sourceItemIds(context.dex, candidate.item);
  const opponent = context.active[opponentOf(playerId)];
  const moveIds = opponent ? revealedMoveIds(context, opponentOf(playerId), opponent) : [];
  const defense = opponent ? defensiveTypeScore(context.dex, species, opponent.species, moveIds, abilities) : 0;
  const hazards = entryHazardPenalty(context, playerId, species, abilities, items);
  const offense = opponent ? candidateOffensivePressure(candidate, opponent, context.dex) : 0;
  const tempoCost = 70 + Math.min(120, context.consecutiveVoluntarySwitches[playerId] * 30);
  return hp + defense - hazards + offense * 0.3 - tempoCost -
    uniqueRoleValue(candidate, request, context.dex) * Math.max(0, (45 - hp) / 45);
}

function candidateOffensivePressure(candidate: RequestPokemon, opponent: KnownActive, dex: ModdedDex): number {
  const species = dex.species.get(speciesFromDetails(candidate.details) || candidate.ident.split(":").slice(1).join(":").trim());
  let best = 0;
  for (const moveName of candidate.moves ?? []) {
    const move = dex.moves.get(moveName);
    if (!move.exists || move.category === "Status") continue;
    const immunity = dex.getImmunity(move.type, activeTypes(dex, opponent));
    if (!immunity) continue;
    const effectiveness = Math.pow(2, dex.getEffectiveness(move.type, activeTypes(dex, opponent)));
    const attackingStat = move.category === "Physical" ? species.baseStats.atk : species.baseStats.spa;
    best = Math.max(best, (move.basePower || variablePowerFallback(move.id)) * effectiveness * attackingStat / 100);
  }
  return clamp(best, 0, 220);
}

function moveActsFirstAgainst(
  moveRef: {id: string; move: string},
  opponentMoveId: string,
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
): boolean {
  const active = ownActive(request);
  const own = context.active[playerId];
  const opponent = context.active[opponentOf(playerId)];
  if (!active || !own || !opponent) return false;
  const move = context.dex.moves.get(moveRef.id || moveRef.move);
  const opponentMove = context.dex.moves.get(opponentMoveId);
  if (!move.exists || !opponentMove.exists) return false;
  const abilities = sourceAbilityIds(context.dex, active.ability);
  const ownPriority = effectiveMovePriority(move, abilities, own);
  const opponentPriority = effectiveMovePriority(opponentMove, opponent.abilities, opponent);
  if (ownPriority !== opponentPriority) return ownPriority > opponentPriority;
  const ownItems = sourceItemIds(context.dex, active.item);
  let ownSpeed = effectiveBattleSpeed(active.stats?.spe ?? own.stats.spe ?? 100, own, abilities, ownItems, context, playerId);
  let opponentSpeed = effectiveBattleSpeed(
    opponent.stats.spe ?? context.dex.species.get(opponent.species).baseStats.spe * 2 + 99,
    opponent,
    opponent.abilities,
    opponent.items,
    context,
    opponentOf(playerId),
  );
  return context.fieldConditions.has("trickroom") ? ownSpeed < opponentSpeed : ownSpeed > opponentSpeed;
}

function effectiveBattleSpeed(
  baseSpeed: number,
  active: KnownActive,
  abilities: Set<string>,
  items: Set<string>,
  context: BattleAiContext,
  playerId: PlayerId,
): number {
  let speed = baseSpeed * boostMultiplier(active.boosts.spe);
  if (active.status === "par" && !abilities.has("quickfeet")) speed *= 0.5;
  if (abilities.has("quickfeet") && active.status) speed *= 1.5;
  if (items.has("choicescarf")) speed *= 1.5;
  if (items.has("ironball")) speed *= 0.5;
  if (abilities.has("unburden") && items.size === 0) speed *= 2;
  if (["raindance", "primordialsea"].includes(context.weather ?? "") && abilities.has("swiftswim")) speed *= 2;
  if (["sunnyday", "desolateland"].includes(context.weather ?? "") && abilities.has("chlorophyll")) speed *= 2;
  if (context.weather === "sandstorm" && abilities.has("sandrush")) speed *= 2;
  if (["snow", "hail"].includes(context.weather ?? "") && abilities.has("slushrush")) speed *= 2;
  if (context.sideConditions[playerId].tailwind) speed *= 2;
  return speed;
}

function knownActiveFromSheet(set: PokemonSet, dex: ModdedDex): KnownActive {
  const active = createKnownActive(set.name || set.species, set.species, "100/100");
  addKnownAbility(active, set.ability, dex);
  addKnownItem(active, set.item, dex);
  active.stats = statsFromSet(set, dex);
  active.movePp = movePpFromSet(set, dex);
  return active;
}

function knownSwitchState(set: PokemonSet, playerId: PlayerId, context: BattleAiContext): KnownActive {
  const stored = findRosterState(context, playerId, set.name || set.species, set.species);
  return stored ? cloneKnownActive(stored) : knownActiveFromSheet(set, context.dex);
}

function requestPokemonFromSheet(set: PokemonSet): RequestPokemon {
  return {
    ident: set.name || set.species,
    details: set.species,
    condition: "100/100",
    moves: [...set.moves],
    item: set.item,
    ability: set.ability,
  };
}

function uniqueActiveRoleValue(request: ChoiceRequest, dex: ModdedDex): number {
  const active = ownActive(request);
  return active ? uniqueRoleValue(active, request, dex) : 0;
}

function uniqueRoleValue(candidate: RequestPokemon, request: ChoiceRequest, dex: ModdedDex): number {
  const candidateRoles = strategicRoles(candidate.moves ?? [], candidate.ability, dex);
  let value = 0;
  for (const role of candidateRoles) {
    const alternatives = (request.side?.pokemon ?? []).filter(pokemon => {
      return !pokemon.active && !pokemon.condition.endsWith(" fnt") && strategicRoles(pokemon.moves ?? [], pokemon.ability, dex).has(role);
    });
    if (!alternatives.length) value += 12;
  }
  return value;
}

function strategicRoles(moves: string[], abilityName: string | undefined, dex: ModdedDex): Set<string> {
  const ids = new Set(moves.map(toID));
  const roles = new Set<string>();
  if (["stealthrock", "spikes", "toxicspikes", "stickyweb"].some(move => ids.has(move))) roles.add("hazards");
  if (["rapidspin", "defog", "mortalspin", "tidyup"].some(move => ids.has(move))) roles.add("removal");
  if (["raindance", "sunnyday", "snowscape", "sandstorm"].some(move => ids.has(move))) roles.add("weather");
  if (ids.has("trickroom")) roles.add("trickroom");
  if (ids.has("batonpass")) roles.add("batonpass");
  const abilities = sourceAbilityIds(dex, abilityName);
  if (["drizzle", "drought", "desolateland", "snowwarning", "sandstream"].some(ability => abilities.has(ability))) roles.add("weather");
  return roles;
}

function chooseBatonPassPlan(
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
): string | null {
  const moves = availableMoves(request);
  const moveById = new Map(moves.map(move => [toID(move.id || move.move), move]));
  if (!moveById.has("batonpass")) return null;
  const active = context.active[playerId];
  const own = ownActive(request);
  const candidates = switchCandidates(request);
  if (!active || !own || !candidates.length) return null;

  const recipientValue = Math.max(...candidates.map(candidate => batonPassRecipientPotential(candidate, active, context.dex)));
  if (recipientValue <= 0) return null;

  const hp = active.hpPercent ?? hpPercentFromCondition(own.condition) ?? 100;
  const incoming = estimateIncomingDamagePercent(request, playerId, context);
  const likelyKo = incoming !== null && incoming >= hp * 0.85;
  const dangerous = incoming !== null && incoming >= Math.max(25, hp * 0.45);
  const boostValue = transferableBoostValue(active.boosts, candidates, context.dex);
  const hasSubstitute = active.volatiles.has("substitute");

  if (boostValue >= 24 && (likelyKo || hp <= 55 || boostValue >= 42)) return "move batonpass";
  if (boostValue >= 14 && dangerous) return "move batonpass";

  const abilities = sourceAbilityIds(context.dex, own.ability);
  const protect = moveById.get("protect");
  if (protect && abilities.has("speedboost") && active.boosts.spe < 2 && context.lastMove[playerId] !== "protect" && !likelyKo) {
    return "move protect";
  }

  const substitute = moveById.get("substitute");
  if (substitute && !hasSubstitute && hp >= 65 && (incoming === null || incoming < 30)) return "move substitute";

  const setupMoves = moves
    .filter(move => setupBoosts(toID(move.id || move.move)))
    .map(move => ({move, score: prospectiveSetupValue(toID(move.id || move.move), active, candidates, context.dex)}))
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score || toID(left.move.id || left.move.move).localeCompare(toID(right.move.id || right.move.move)));
  if (setupMoves.length && hp >= 45 && !likelyKo && boostValue < 42) {
    return `move ${setupMoves[0].move.id || setupMoves[0].move.move}`;
  }

  if (boostValue > 0) return "move batonpass";
  return null;
}

function batonPassRecipientPotential(candidate: RequestPokemon, passer: KnownActive, dex: ModdedDex): number {
  const hp = hpPercentFromCondition(candidate.condition) ?? 0;
  if (hp <= 0) return 0;
  const moves = (candidate.moves ?? []).map(move => dex.moves.get(move)).filter(move => move.exists);
  const physical = moves.some(move => move.category === "Physical");
  const special = moves.some(move => move.category === "Special");
  if (!physical && !special) return 0;
  const species = dex.species.get(speciesFromDetails(candidate.details) || candidate.ident.split(":").slice(1).join(":").trim());
  let score = hp * 0.2;
  if (physical) score += (candidate.stats?.atk ?? species.baseStats.atk * 2 + 99) / 20;
  if (special) score += (candidate.stats?.spa ?? species.baseStats.spa * 2 + 99) / 20;
  if (passer.boosts.atk > 0 && physical) score += passer.boosts.atk * 10;
  if (passer.boosts.spa > 0 && special) score += passer.boosts.spa * 10;
  if (passer.boosts.spe > 0) score += passer.boosts.spe * 6;
  return score;
}

function transferableBoostValue(boosts: Record<BoostStat, number>, candidates: RequestPokemon[], dex: ModdedDex): number {
  const moves = candidates.flatMap(candidate => candidate.moves ?? []).map(move => dex.moves.get(move));
  const usesPhysical = moves.some(move => move.exists && move.category === "Physical");
  const usesSpecial = moves.some(move => move.exists && move.category === "Special");
  return (usesPhysical ? Math.max(0, boosts.atk) * 10 : 0) +
    (usesSpecial ? Math.max(0, boosts.spa) * 10 : 0) +
    Math.max(0, boosts.def) * 5 + Math.max(0, boosts.spd) * 5 +
    Math.max(0, boosts.spe) * 7 + Math.max(0, boosts.accuracy) * 4 + Math.max(0, boosts.evasion) * 4;
}

function prospectiveSetupValue(
  moveId: string,
  active: KnownActive,
  candidates: RequestPokemon[],
  dex: ModdedDex,
): number {
  const boosts = setupBoosts(moveId);
  if (!boosts) return 0;
  const moves = candidates.flatMap(candidate => candidate.moves ?? []).map(move => dex.moves.get(move));
  const usesPhysical = moves.some(move => move.exists && move.category === "Physical");
  const usesSpecial = moves.some(move => move.exists && move.category === "Special");
  let score = 0;
  for (const [stat, amount] of Object.entries(boosts) as Array<[BoostStat, number]>) {
    const available = Math.max(0, Math.min(amount, 6 - active.boosts[stat]));
    if (stat === "atk" && usesPhysical) score += available * 10;
    else if (stat === "spa" && usesSpecial) score += available * 10;
    else if (stat === "spe") score += available * 7;
    else if (stat === "def" || stat === "spd") score += available * 5;
    else if (stat === "accuracy" || stat === "evasion") score += available * 4;
  }
  return score;
}

function fallbackMoveChoice(request: ChoiceRequest): string {
  const move = availableMoves(request)[0];
  return move ? `move ${move.id || move.move}` : "pass";
}

function shouldSwitchForSurvival(
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
  hpPercent: number | null,
  bestMoveScore: number,
  bestMove: {id: string; move: string} | null,
): boolean {
  if (request.active?.[0]?.trapped) return false;
  if (!bestSwitch(request, playerId, context)) return false;

  const opponent = context.active[opponentOf(playerId)];
  if (!opponent) return hpPercent !== null && hpPercent <= 18 && bestMoveScore < 80;

  const incomingDamage = estimateIncomingDamagePercent(request, playerId, context);
  if (hpPercent !== null && incomingDamage !== null && incomingDamage >= hpPercent * 0.9) {
    const actsFirst = bestMove ? ownMoveActsFirst(bestMove, request, playerId, context) : false;
    if (!actsFirst || bestMoveScore < 120) return true;
  }

  if (hpPercent === null || hpPercent > 28) return false;

  // If the active can likely deal decisive damage, attacking is often better than a blind switch.
  return bestMoveScore < 90;
}

function estimateIncomingDamagePercent(request: ChoiceRequest, playerId: PlayerId, context: BattleAiContext): number | null {
  const opponent = context.active[opponentOf(playerId)];
  const own = context.active[playerId];
  const active = ownActive(request);
  if (!opponent || !own || !active) return null;
  const moveIds = revealedMoveIds(context, opponentOf(playerId), opponent);
  const estimates = moveIds
    .map(moveId => estimateIncomingMoveDamagePercent(moveId, request, playerId, context))
    .filter((damage): damage is number => damage !== null);
  return estimates.length ? Math.max(...estimates) : null;
}

function estimateIncomingMoveDamagePercent(
  opponentMoveId: string,
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
): number | null {
  const opponent = context.active[opponentOf(playerId)];
  const own = context.active[playerId];
  const active = ownActive(request);
  if (!opponent || !own || !active) return null;
  const move = context.dex.moves.get(opponentMoveId);
  if (!move.exists || move.category === "Status") return 0;

  const attackerAbilities = opponent.abilities;
  const profile = dynamicMoveProfile(move, undefined, opponent, own, context);
  const moveType = effectiveMoveType(profile.type, Boolean(move.flags.sound), attackerAbilities).type;
  const targetTypes = activeTypes(context.dex, own);
  if (!moveBypassesTypeImmunity(moveType, attackerAbilities) && !context.dex.getImmunity(moveType, targetTypes)) return 0;
  const priority = effectiveMovePriority(move, attackerAbilities, opponent);
  if (knownAbilityBlocksMove(
    own,
    {type: moveType, flags: move.flags, priority, target: move.target},
    context.dex,
    attackerAbilities,
  )) return 0;

  const opponentSpecies = context.dex.species.get(opponent.species);
  const ownSpecies = context.dex.species.get(speciesFromDetails(active.details) || active.ident.split(":").slice(1).join(":").trim());
  const attackingStat = move.id === "bodypress" ? "def" : move.category === "Physical" ? "atk" : "spa";
  const defendingStat = ["psyshock", "psystrike", "secretsword"].includes(move.id)
    ? "def"
    : move.category === "Physical" ? "def" : "spd";
  let attack = (opponent.stats[attackingStat] ?? opponentSpecies.baseStats[attackingStat] * 2 + 99) *
    boostMultiplier(opponent.boosts[attackingStat]);
  let defense = active.stats?.[defendingStat] ?? ownSpecies.baseStats[defendingStat] * 2 + 99;
  const ownItems = sourceItemIds(context.dex, active.item);
  const attackerItems = opponent.items;
  if (defendingStat === "spd" && ownItems.has("assaultvest")) defense *= 1.5;
  if (ownItems.has("eviolite") && ownSpecies.nfe) defense *= 1.5;
  if (move.category === "Physical" && move.id !== "bodypress" && attackerAbilities.has("hugepower")) attack *= 2;
  if (move.category === "Physical" && move.id !== "bodypress" && attackerAbilities.has("purepower")) attack *= 2;
  if (move.category === "Physical" && move.id !== "bodypress" && attackerAbilities.has("guts") && opponent.status) attack *= 1.5;
  if (move.category === "Physical" && move.id !== "bodypress" && attackerItems.has("choiceband")) attack *= 1.5;
  if (move.category === "Special" && attackerItems.has("choicespecs")) attack *= 1.5;

  const fixedDamage = fixedDamageValue(move.id, 100, own.hpPercent);
  if (fixedDamage !== null) {
    const maxHp = maxHpFromCondition(active.condition) ?? own.stats.hp ?? ownSpecies.baseStats.hp * 2 + 204;
    return (fixedDamage / Math.max(1, maxHp)) * 100;
  }

  let incomingBasePower = profile.basePower || variablePowerFallback(move.id);
  if (attackerAbilities.has("technician") && incomingBasePower > 0 && incomingBasePower <= 60) incomingBasePower *= 1.5;
  if (attackerAbilities.has("toughclaws") && move.flags.contact) incomingBasePower *= 1.3;
  if (attackerAbilities.has("ironfist") && move.flags.punch) incomingBasePower *= 1.2;
  if (attackerAbilities.has("strongjaw") && move.flags.bite) incomingBasePower *= 1.5;
  const hitCount = expectedHitCount(move.multihit, attackerAbilities.has("skilllink"), false);
  const baseDamage = (((42 * Math.max(1, incomingBasePower) * attack / Math.max(1, defense)) / 50) + 2) * hitCount;
  const typeStage = context.dex.getEffectiveness(moveType, targetTypes);
  let modifier = Math.pow(2, typeStage);
  modifier *= stabMultiplier(moveType, opponentSpecies.types, opponent.teraType, attackerAbilities.has("adaptability"));
  modifier *= weatherDamageModifier(moveType, context.weather) * profile.turnModifier;
  modifier *= defensiveAbilityModifier(own, move, moveType, typeStage, attackerAbilities);
  if (move.category === "Physical" && opponent.status === "brn" && !attackerAbilities.has("guts")) modifier *= 0.5;
  if (attackerItems.has("lifeorb")) modifier *= 1.3;
  if (move.category === "Physical" && context.sideConditions[playerId].reflect) modifier *= 0.5;
  if (move.category === "Special" && context.sideConditions[playerId].lightscreen) modifier *= 0.5;
  if (context.sideConditions[playerId].auroraveil) modifier *= 0.5;
  if (profile.accuracy !== true && !attackerAbilities.has("noguard")) modifier *= profile.accuracy / 100;
  const maxHp = maxHpFromCondition(active.condition) ?? own.stats.hp ?? ownSpecies.baseStats.hp * 2 + 204;
  return (baseDamage * modifier / Math.max(1, maxHp)) * 100;
}

function estimateOwnMoveDamagePercent(
  moveRef: {id: string; move: string},
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
): number {
  const active = ownActive(request);
  const own = context.active[playerId];
  const opponent = context.active[opponentOf(playerId)];
  if (!active || !own || !opponent) return 0;
  const move = context.dex.moves.get(moveRef.id || moveRef.move);
  if (!move.exists || move.category === "Status") return 0;

  const ownAbilities = sourceAbilityIds(context.dex, active.ability);
  const ownItems = sourceItemIds(context.dex, active.item);
  const ownSpecies = context.dex.species.get(speciesFromDetails(active.details) || active.ident.split(":").slice(1).join(":").trim());
  const opponentSpecies = context.dex.species.get(opponent.species);
  const profile = dynamicMoveProfile(move, active, own, opponent, context);
  const effectiveMove = effectiveMoveType(profile.type, Boolean(move.flags.sound), ownAbilities);
  const targetTypes = activeTypes(context.dex, opponent);
  if (!moveBypassesTypeImmunity(effectiveMove.type, ownAbilities) && !context.dex.getImmunity(effectiveMove.type, targetTypes)) return 0;
  const priority = effectiveMovePriority(move, ownAbilities, own);
  if (knownAbilityBlocksMove(opponent, {type: effectiveMove.type, flags: move.flags, priority, target: move.target}, context.dex, ownAbilities)) return 0;

  const attackingStat = move.id === "bodypress" ? "def" : move.category === "Physical" ? "atk" : "spa";
  const defendingStat = ["psyshock", "psystrike", "secretsword"].includes(move.id)
    ? "def"
    : move.category === "Physical" ? "def" : "spd";
  let attack = move.id === "foulplay"
    ? opponent.stats.atk ?? opponentSpecies.baseStats.atk * 2 + 99
    : active.stats?.[attackingStat] ?? own.stats[attackingStat] ?? ownSpecies.baseStats[attackingStat] * 2 + 99;
  attack *= boostMultiplier(move.id === "foulplay" ? opponent.boosts.atk : own.boosts[attackingStat]);
  let defense = opponent.stats[defendingStat] ?? opponentSpecies.baseStats[defendingStat] * 2 + 99;
  defense *= boostMultiplier(opponent.boosts[defendingStat]);
  if (defendingStat === "spd" && opponent.items.has("assaultvest")) defense *= 1.5;
  if (opponent.items.has("eviolite") && opponentSpecies.nfe) defense *= 1.5;
  if (move.category === "Physical" && move.id !== "bodypress" && move.id !== "foulplay" && ownAbilities.has("hugepower")) attack *= 2;
  if (move.category === "Physical" && move.id !== "bodypress" && move.id !== "foulplay" && ownAbilities.has("purepower")) attack *= 2;
  if (move.category === "Physical" && ownAbilities.has("guts") && own.status) attack *= 1.5;
  if (move.category === "Physical" && ownItems.has("choiceband")) attack *= 1.5;
  if (move.category === "Special" && ownItems.has("choicespecs")) attack *= 1.5;

  const fixedDamage = fixedDamageValue(move.id, levelFromDetails(active.details), opponent.hpPercent);
  if (fixedDamage !== null) return (fixedDamage / Math.max(1, opponent.stats.hp ?? opponentSpecies.baseStats.hp * 2 + 204)) * 100;

  let power = profile.basePower || variablePowerFallback(move.id);
  if (ownAbilities.has("technician") && power > 0 && power <= 60) power *= 1.5;
  if (ownAbilities.has("toughclaws") && move.flags.contact) power *= 1.3;
  if (ownAbilities.has("ironfist") && move.flags.punch) power *= 1.2;
  if (ownAbilities.has("strongjaw") && move.flags.bite) power *= 1.5;
  const levelFactor = Math.floor((2 * levelFromDetails(active.details)) / 5) + 2;
  const hitCount = expectedHitCount(move.multihit, ownAbilities.has("skilllink"), ownItems.has("loadeddice"));
  const baseDamage = (((levelFactor * Math.max(1, power) * attack / Math.max(1, defense)) / 50) + 2) * hitCount;
  const typeStage = context.dex.getEffectiveness(effectiveMove.type, targetTypes);
  let modifier = Math.pow(2, typeStage);
  if (typeStage < 0 && ownAbilities.has("tintedlens")) modifier *= 2;
  modifier *= stabMultiplier(effectiveMove.type, ownSpecies.types, own.teraType, ownAbilities.has("adaptability"));
  modifier *= weatherDamageModifier(effectiveMove.type, context.weather) * profile.turnModifier;
  modifier *= defensiveAbilityModifier(opponent, move, effectiveMove.type, typeStage, ownAbilities);
  if (move.category === "Physical" && own.status === "brn" && !ownAbilities.has("guts") && move.id !== "facade") modifier *= 0.5;
  if (ownItems.has("lifeorb")) modifier *= 1.3;
  if (move.category === "Physical" && context.sideConditions[opponentOf(playerId)].reflect) modifier *= 0.5;
  if (move.category === "Special" && context.sideConditions[opponentOf(playerId)].lightscreen) modifier *= 0.5;
  if (context.sideConditions[opponentOf(playerId)].auroraveil) modifier *= 0.5;
  if (profile.accuracy !== true && !ownAbilities.has("noguard")) modifier *= profile.accuracy / 100;
  return clamp((baseDamage * modifier / Math.max(1, opponent.stats.hp ?? opponentSpecies.baseStats.hp * 2 + 204)) * 100, 0, 400);
}

function ownMoveActsFirst(
  moveRef: {id: string; move: string},
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
): boolean {
  const active = ownActive(request);
  const own = context.active[playerId];
  const opponent = context.active[opponentOf(playerId)];
  if (!active || !own || !opponent) return false;
  const move = context.dex.moves.get(moveRef.id || moveRef.move);
  const opponentMoves = revealedMoveIds(context, opponentOf(playerId), opponent)
    .map(moveId => context.dex.moves.get(moveId))
    .filter(opponentMove => opponentMove.exists && opponentMove.category !== "Status");
  if (!move.exists || !opponentMoves.length) return false;
  const abilities = sourceAbilityIds(context.dex, active.ability);
  const ownPriority = effectiveMovePriority(move, abilities, own);
  const opponentPriority = Math.max(...opponentMoves.map(opponentMove => {
    return effectiveMovePriority(opponentMove, opponent.abilities, opponent);
  }));
  if (ownPriority !== opponentPriority) return ownPriority > opponentPriority;

  const ownItems = sourceItemIds(context.dex, active.item);
  const ownSpeed = effectiveBattleSpeed(active.stats?.spe ?? own.stats.spe ?? 100, own, abilities, ownItems, context, playerId);
  const opponentSpeed = effectiveBattleSpeed(
    opponent.stats.spe ?? context.dex.species.get(opponent.species).baseStats.spe * 2 + 99,
    opponent,
    opponent.abilities,
    opponent.items,
    context,
    opponentOf(playerId),
  );
  return context.fieldConditions.has("trickroom") ? ownSpeed < opponentSpeed : ownSpeed > opponentSpeed;
}

function bestMove(request: ChoiceRequest, playerId: PlayerId, context: BattleAiContext) {
  const moves = availableMoves(request);
  if (!moves.length) return null;

  const ranked = moves
    .map(move => ({move, score: estimateMoveScore(move, request, playerId, context)}))
    .filter(entry => Number.isFinite(entry.score));
  ranked.sort((a, b) => b.score - a.score || (a.move.id || a.move.move).localeCompare(b.move.id || b.move.move));
  return ranked[0]?.move ?? null;
}

function bestTacticalMove(request: ChoiceRequest, playerId: PlayerId, context: BattleAiContext) {
  const moves = availableMoves(request);
  if (!moves.length) return null;

  const ranked = moves
    .map(move => ({move, score: estimateTacticalMoveScore(move, request, playerId, context)}))
    .filter(entry => Number.isFinite(entry.score));
  ranked.sort((a, b) => b.score - a.score || (a.move.id || a.move.move).localeCompare(b.move.id || b.move.move));
  return ranked[0]?.move ?? null;
}

function estimateMoveScore(
  moveRef: {id: string; move: string; target?: string},
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
): number {
  const move = context.dex.moves.get(moveRef.id || moveRef.move);
  if (!move.exists) return 0;

  if (context.avoidMoves[playerId].has(move.id)) return INVALID_MOVE_SCORE;
  if (["fakeout", "firstimpression"].includes(move.id) && context.movesChosenThisEntry[playerId] > 0) {
    return INVALID_MOVE_SCORE;
  }
  if (move.category === "Status") return statefulStatusMoveScore(move.id, request, playerId, context);

  const active = ownActive(request);
  const ownAbilities = sourceAbilityIds(context.dex, active?.ability);
  const ownItems = sourceItemIds(context.dex, active?.item);
  const opponent = context.active[opponentOf(playerId)];
  const moveProfile = dynamicMoveProfile(move, active, context.active[playerId], opponent, context);
  const fixedDamage = fixedDamageValue(
    move.id,
    levelFromDetails(active?.details),
    opponent?.hpPercent,
  );
  const reactiveScore = reactiveDamageMoveScore(move.id, request, playerId, context);
  if (["counter", "mirrorcoat", "metalburst"].includes(move.id) && reactiveScore === null) {
    return INVALID_MOVE_SCORE;
  }
  let score = moveProfile.basePower || variablePowerFallback(move.id);
  if (score <= 0) return INVALID_MOVE_SCORE;
  const effectiveMove = effectiveMoveType(moveProfile.type, Boolean(move.flags.sound), ownAbilities);
  if (weatherBlocksMove(effectiveMove.type, context.weather)) return INVALID_MOVE_SCORE;
  score *= effectiveMove.powerModifier * moveProfile.turnModifier * weatherDamageModifier(effectiveMove.type, context.weather);
  if (ownAbilities.has("technician") && move.basePower > 0 && move.basePower <= 60) score *= 1.5;
  if (ownAbilities.has("toughclaws") && move.flags.contact) score *= 1.3;
  if (ownAbilities.has("ironfist") && move.flags.punch) score *= 1.2;
  if (ownAbilities.has("strongjaw") && move.flags.bite) score *= 1.5;
  if (ownAbilities.has("sharpness") && move.flags.slicing) score *= 1.5;
  if (ownAbilities.has("megalauncher") && move.flags.pulse) score *= 1.5;
  if (ownAbilities.has("punkrock") && move.flags.sound) score *= 1.3;
  if (ownAbilities.has("sheerforce") && (move.hasSheerForce || move.secondaries?.length)) score *= 1.3;

  const ownStats = active?.stats ?? {};
  const ownSpecies = speciesFromDetails(active?.details) || active?.ident.split(":").slice(1).join(":").trim() || "";
  const ownTypes = context.dex.species.get(ownSpecies).types ?? [];
  score *= stabMultiplier(effectiveMove.type, ownTypes, context.active[playerId]?.teraType, ownAbilities.has("adaptability"));

  let typeStage = 0;
  if (opponent) {
    const opponentTypes = activeTypes(context.dex, opponent);
    if (!moveBypassesTypeImmunity(effectiveMove.type, ownAbilities) && !context.dex.getImmunity(effectiveMove.type, opponentTypes)) {
      return INVALID_MOVE_SCORE;
    }
    const priority = effectiveMovePriority(move, ownAbilities, context.active[playerId]);
    if (knownAbilityBlocksMove(
      opponent,
      {type: effectiveMove.type, flags: move.flags, priority, target: move.target},
      context.dex,
      ownAbilities,
    )) return INVALID_MOVE_SCORE;
    if (fixedDamage !== null) {
      score = fixedDamage;
      if (moveProfile.accuracy !== true && !ownAbilities.has("noguard")) {
        score *= Math.min(1, moveProfile.accuracy / 100);
      }
      if (effectiveMovePriority(move, ownAbilities, context.active[playerId]) > 0) score *= 1.08;
      return score;
    }
    if (reactiveScore !== null) return reactiveScore;
    typeStage = context.dex.getEffectiveness(effectiveMove.type, opponentTypes);
    score *= Math.pow(2, typeStage);
    if (typeStage < 0 && ownAbilities.has("tintedlens")) score *= 2;
    if (typeStage > 0 && ownAbilities.has("neuroforce")) score *= 1.25;
    if (typeStage > 0 && ownItems.has("expertbelt")) score *= 1.2;
  }

  if (move.category === "Physical") {
    const usesDefense = move.id === "bodypress";
    const usesTargetAttack = move.id === "foulplay";
    const attackStage = opponent?.abilities.has("unaware") && !bypassesAbilities(ownAbilities)
      ? 0
      : usesDefense ? context.active[playerId]?.boosts.def : context.active[playerId]?.boosts.atk;
    const attackingStat = usesTargetAttack && opponent
      ? boostedStat(context.dex.species.get(opponent.species).baseStats.atk * 2 + 99, opponent.boosts.atk)
      : boostedStat(usesDefense ? ownStats.def : ownStats.atk, attackStage);
    score *= statRatio(
      context.dex,
      attackingStat,
      opponent,
      "def",
      ownAbilities.has("unaware"),
    );
    if (!usesDefense && !usesTargetAttack && ownAbilities.has("hugepower")) score *= 2;
    if (!usesDefense && !usesTargetAttack && ownAbilities.has("purepower")) score *= 2;
    if (!usesDefense && !usesTargetAttack && ownAbilities.has("hustle")) score *= 1.5;
    if (!usesDefense && !usesTargetAttack && ownAbilities.has("guts") && context.active[playerId]?.status) score *= 1.5;
    if (context.active[playerId]?.status === "brn" && !ownAbilities.has("guts") && move.id !== "facade") score *= 0.5;
    if (!usesDefense && !usesTargetAttack && ownItems.has("choiceband")) score *= 1.5;
    if (ownItems.has("muscleband")) score *= 1.1;
  } else if (move.category === "Special") {
    const attackStage = opponent?.abilities.has("unaware") && !bypassesAbilities(ownAbilities)
      ? 0
      : context.active[playerId]?.boosts.spa;
    score *= statRatio(
      context.dex,
      boostedStat(ownStats.spa, attackStage),
      opponent,
      ["psyshock", "psystrike", "secretsword"].includes(move.id) ? "def" : "spd",
      ownAbilities.has("unaware"),
    );
    if (ownItems.has("choicespecs")) score *= 1.5;
    if (ownItems.has("wiseglasses")) score *= 1.1;
  }

  if (ownItems.has("lifeorb")) score *= 1.3;
  score *= defensiveAbilityModifier(opponent, move, effectiveMove.type, typeStage, ownAbilities);
  if (move.category === "Physical" && context.sideConditions[opponentOf(playerId)].reflect) score *= 0.5;
  if (move.category === "Special" && context.sideConditions[opponentOf(playerId)].lightscreen) score *= 0.5;
  if (context.sideConditions[opponentOf(playerId)].auroraveil) score *= 0.5;
  score *= expectedHitCount(move.multihit, ownAbilities.has("skilllink"), ownItems.has("loadeddice"));
  if (effectiveMovePriority(move, ownAbilities, context.active[playerId]) > 0) score *= 1.08;
  if (moveProfile.accuracy !== true && !ownAbilities.has("noguard")) {
    let accuracy = moveProfile.accuracy / 100;
    if (ownAbilities.has("compoundeyes")) accuracy *= 1.3;
    if (ownAbilities.has("hustle") && move.category === "Physical") accuracy *= 0.8;
    if (ownItems.has("widelens")) accuracy *= 1.1;
    accuracy *= accuracyStageMultiplier(
      context.active[playerId]?.boosts.accuracy ?? 0,
      opponent?.boosts.evasion ?? 0,
    );
    score *= Math.min(1, accuracy);
  }
  if (move.selfSwitch) score *= 1.05;
  if (move.recoil) score *= 0.88;
  if (move.selfdestruct) score *= 0.55;
  if (move.self?.volatileStatus === "mustrecharge") score *= 0.72;

  return score;
}

function statusMoveScore(moveId: string): number {
  if (["stealthrock", "spikes", "toxicspikes", "stickyweb"].includes(moveId)) return 55;
  if (["swordsdance", "nastyplot", "dragondance", "calmmind", "coil", "bulkup", "cottondefense", "agility", "quiverdance"].includes(moveId)) return 45;
  if (["recover", "roost", "softboiled", "moonlight", "synthesis", "wish", "protect", "substitute"].includes(moveId)) return 28;
  if (["willowisp", "thunderwave", "toxic", "encore", "taunt", "haze", "destinybond"].includes(moveId)) return 35;
  if (["batonpass"].includes(moveId)) return 24;
  if (["leechseed", "reflect", "lightscreen", "auroraveil", "tailwind", "trickroom", "raindance", "sunnyday", "snowscape", "sandstorm"].includes(moveId)) return 45;
  return 8;
}

function statefulStatusMoveScore(moveId: string, request: ChoiceRequest, playerId: PlayerId, context: BattleAiContext): number {
  const active = context.active[playerId];
  const opponent = context.active[opponentOf(playerId)];
  const hpPercent = active?.hpPercent ?? hpPercentFromCondition(ownActive(request)?.condition ?? "");
  let score = statusMoveScore(moveId);

  if (statusMoveWouldFail(moveId, request, playerId, context)) return INVALID_MOVE_SCORE;

  const hazardLimit = hazardLayerLimit(moveId);
  if (hazardLimit) {
    const layers = context.sideConditions[opponentOf(playerId)][moveId] ?? 0;
    return layers >= hazardLimit ? INVALID_MOVE_SCORE : score + (hazardLimit - layers) * 8;
  }

  const setup = setupBoosts(moveId);
  if (setup && active) {
    const useful = Object.entries(setup).some(([stat, amount]) => amount > 0 && active.boosts[stat as BoostStat] < 6);
    if (!useful) return INVALID_MOVE_SCORE;
    score += Object.entries(setup).reduce((total, [stat, amount]) => {
      return total + Math.max(0, Math.min(amount, 6 - active.boosts[stat as BoostStat])) * 10;
    }, 0);
  }

  if (moveId === "batonpass") {
    if (!switchCandidates(request).length) return INVALID_MOVE_SCORE;
    const boosts = active ? positiveBoostTotal(active.boosts) : 0;
    return boosts > 0 || active?.volatiles.has("substitute") ? 45 + boosts * 12 : 6;
  }
  if (moveId === "substitute") {
    if (active?.volatiles.has("substitute") || (hpPercent !== null && hpPercent <= 30)) return INVALID_MOVE_SCORE;
  }
  if (["protect", "detect", "kingsshield", "spikyshield", "banefulbunker"].includes(moveId) && context.lastMove[playerId] === moveId) {
    return 2;
  }
  if (["recover", "roost", "softboiled", "moonlight", "synthesis", "slackoff", "milkdrink"].includes(moveId)) {
    if (hpPercent !== null && hpPercent >= 88) return 2;
    if (hpPercent !== null && hpPercent <= 50) score += 55;
  }
  if (moveId === "wish" && hpPercent !== null) {
    if (context.pendingWish[playerId]) return INVALID_MOVE_SCORE;
    score += hpPercent <= 65 ? 38 : 4;
  }
  if (moveId === "destinybond" && context.destinyBondBlocked[playerId]) return INVALID_MOVE_SCORE;
  if (moveId === "haze") {
    return opponent && positiveBoostTotal(opponent.boosts) >= 2 ? 85 : 4;
  }
  if (["willowisp", "thunderwave", "toxic", "spore", "sleeppowder"].includes(moveId) && opponent?.status) {
    return 2;
  }
  if (moveId === "taunt" && opponent?.volatiles.has("taunt")) return 2;
  if (moveId === "trickroom") {
    if (context.fieldConditions.has("trickroom")) return 2;
    return shouldSetTrickRoom(request, playerId, context) ? 280 : 35;
  }

  if (moveId === "leechseed") {
    if (opponent?.volatiles.has("leechseed")) return 2;
    return 58;
  }

  if (["reflect", "lightscreen", "auroraveil", "tailwind"].includes(moveId)) {
    return context.sideConditions[playerId][moveId] ? 2 : 65;
  }

  if (moveId === "defog") {
    return damagingHazardCount(context.sideConditions[playerId]) > 0 ? 90 : 8;
  }

  if (["healingwish", "lunardance", "memento"].includes(moveId)) {
    return switchCandidates(request).length && hpPercent !== null && hpPercent <= 35 ? 110 : 5;
  }

  const weather = weatherForMove(moveId);
  if (weather && context.weather === weather) return INVALID_MOVE_SCORE;
  if (weather) return weatherSetupScore(request, weather, context.weather);
  return score;
}

function statusMoveWouldFail(moveId: string, request: ChoiceRequest, playerId: PlayerId, context: BattleAiContext): boolean {
  const opponent = context.active[opponentOf(playerId)];
  if (!opponent) return false;
  const move = context.dex.moves.get(moveId);
  const types = activeTypes(context.dex, opponent);
  const ownAbilities = sourceAbilityIds(context.dex, ownActive(request)?.ability);
  const targetsOpponent = !["self", "allySide", "allyTeam", "foeSide", "all"].includes(move.target);
  const powderMove = ["spore", "sleeppowder", "stunspore", "poisonpowder", "ragepowder", "cottonspore"].includes(moveId);
  const sleepMove = ["spore", "sleeppowder", "hypnosis", "sing", "lovelykiss", "darkvoid", "grasswhistle"].includes(moveId);
  if (moveId === "toxic" && !ownAbilities.has("corrosion") && (types.includes("Poison") || types.includes("Steel"))) return true;
  if (moveId === "willowisp" && types.includes("Fire")) return true;
  if (moveId === "thunderwave" && (types.includes("Ground") || types.includes("Electric"))) return true;
  if (["spore", "sleeppowder", "stunspore", "poisonpowder", "leechseed"].includes(moveId) && types.includes("Grass")) return true;
  if (powderMove && (opponent.abilities.has("overcoat") || opponent.items.has("safetygoggles"))) return true;
  if (sleepMove && ["comatose", "insomnia", "purifyingsalt", "vitalspirit"].some(ability => opponent.abilities.has(ability))) return true;
  if (moveId === "thunderwave" && ["comatose", "limber", "purifyingsalt"].some(ability => opponent.abilities.has(ability))) return true;
  if (moveId === "willowisp" && ["comatose", "purifyingsalt", "waterbubble", "waterveil"].some(ability => opponent.abilities.has(ability))) return true;
  if (moveId === "toxic" && ["comatose", "immunity", "pastelveil", "purifyingsalt"].some(ability => opponent.abilities.has(ability))) return true;
  if (move.flags.reflectable && opponent.abilities.has("magicbounce")) return true;
  if (targetsOpponent && opponent.abilities.has("goodasgold")) return true;
  if (targetsOpponent && ownAbilities.has("prankster") && !context.dex.getImmunity("prankster", types)) return true;
  return false;
}

function shouldSetTrickRoom(request: ChoiceRequest, playerId: PlayerId, context: BattleAiContext): boolean {
  const ownSpeeds = (request.side?.pokemon ?? [])
    .filter(pokemon => !pokemon.condition.endsWith(" fnt"))
    .map(pokemon => pokemon.stats?.spe ?? context.dex.species.get(speciesFromDetails(pokemon.details)).baseStats.spe)
    .filter((speed): speed is number => Number.isFinite(speed));
  const ownMedian = ownSpeeds.length ? [...ownSpeeds].sort((a, b) => a - b)[Math.floor(ownSpeeds.length / 2)] : 100;
  const opponent = context.active[opponentOf(playerId)];
  const opponentSpeed = opponent ? context.dex.species.get(opponent.species).baseStats.spe * 2 + 99 : 200;
  return ownMedian < opponentSpeed;
}

function weatherSetupScore(request: ChoiceRequest, weather: string, currentWeather: string | null): number {
  const moves = new Set((request.side?.pokemon ?? []).flatMap(pokemon => pokemon.moves ?? []));
  const targetSynergy = weatherSynergyScore(moves, weather);
  if (currentWeather && currentWeather !== weather) {
    const currentSynergy = weatherSynergyScore(moves, currentWeather);
    if (targetSynergy < currentSynergy + 20) return INVALID_MOVE_SCORE;
  }
  return 62 + targetSynergy;
}

function weatherSynergyScore(moves: Set<string>, weather: string): number {
  let score = moves.has("weatherball") ? 20 : 0;
  if (weather === "raindance" && (moves.has("thunder") || moves.has("hurricane"))) score += 15;
  if (weather === "sunnyday" && (moves.has("solarbeam") || moves.has("solarblade"))) score += 15;
  if ((weather === "snow" || weather === "hail") && moves.has("blizzard")) score += 15;
  return score;
}

function damagingHazardCount(conditions: Record<string, number>): number {
  return ["stealthrock", "spikes", "toxicspikes", "stickyweb"]
    .reduce((total, hazard) => total + (conditions[hazard] ?? 0), 0);
}

function estimateTacticalMoveScore(
  moveRef: {id: string; move: string; target?: string},
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
): number {
  const base = estimateMoveScore(moveRef, request, playerId, context);
  if (!Number.isFinite(base)) return INVALID_MOVE_SCORE;
  const moveId = moveRef.id || context.dex.moves.get(moveRef.move).id || moveRef.move;
  const active = ownActive(request);
  const hpPercent = active ? hpPercentFromCondition(active.condition) : null;
  const activeMoves = new Set((request.active?.[0]?.moves ?? []).map(move => move.id));
  const hasBatonPassPlan = activeMoves.has("batonpass");
  const knownActive = context.active[playerId];
  const opponent = context.active[opponentOf(playerId)];
  const boostTotal = knownActive ? positiveBoostTotal(knownActive.boosts) : 0;

  let bonus = 0;
  if (["fakeout", "firstimpression"].includes(moveId) && context.movesChosenThisEntry[playerId] === 0) bonus += 35;
  if (moveId === "stealthrock" && hpAtLeast(hpPercent, 45)) bonus += 25;
  if (moveId === "substitute" && hasBatonPassPlan && hpAtLeast(hpPercent, 60)) bonus += 55;
  if (moveId === "protect" && hasBatonPassPlan && hpAtLeast(hpPercent, 45) && context.lastMove[playerId] !== "protect") bonus += 38;
  if (["coil", "bulkup", "swordsdance", "dragondance", "calmmind", "agility", "cottondefense", "quiverdance"].includes(moveId)) {
    bonus += hasBatonPassPlan ? Math.max(0, 60 - boostTotal * 10) : 20;
    if (hpPercent !== null && hpPercent < 45) bonus -= 35;
  }
  if (moveId === "batonpass") {
    bonus += switchCandidates(request).length
      ? boostTotal >= 4 ? 90 : boostTotal >= 2 ? 65 : hpPercent !== null && hpPercent <= 55 ? 35 : 0
      : -100;
  }
  if (["recover", "roost", "softboiled", "moonlight", "synthesis"].includes(moveId)) {
    bonus += hpPercent !== null && hpPercent <= 55 ? 70 : -10;
  }
  if (moveId === "wish") bonus += hpPercent !== null && hpPercent <= 65 ? 55 : 12;
  if (moveId === "haze") bonus += opponent && positiveBoostTotal(opponent.boosts) >= 2 ? 40 : -30;
  if (moveId === "destinybond") bonus += hpPercent !== null && hpPercent <= 35 ? 90 : 5;
  if (["willowisp", "thunderwave", "toxic", "encore", "taunt"].includes(moveId)) bonus += 20;
  if (moveId === "rapidspin" && damagingHazardCount(context.sideConditions[playerId]) > 0) bonus += 75;

  return Math.max(0, base + bonus);
}

function hpAtLeast(hpPercent: number | null, threshold: number): boolean {
  return hpPercent === null || hpPercent >= threshold;
}

function statRatio(
  dex: ModdedDex,
  ownStat: number | undefined,
  opponent: KnownActive | null | undefined,
  defensiveStat: "def" | "spd",
  ignoreDefenseBoost = false,
): number {
  if (!ownStat || !opponent) return 1;
  const opponentSpecies = dex.species.get(opponent.species);
  let defense = opponent.stats[defensiveStat] ?? (opponentSpecies.baseStats[defensiveStat] || 100) * 2 + 99;
  if (defensiveStat === "spd" && opponent.items.has("assaultvest")) defense *= 1.5;
  if (opponent.items.has("eviolite") && opponentSpecies.nfe) defense *= 1.5;
  const boostedDefense = defense * boostMultiplier(ignoreDefenseBoost ? 0 : opponent.boosts[defensiveStat]);
  return clamp(ownStat / Math.max(1, boostedDefense), 0.4, 2.1);
}

function moveChoice(
  moveRef: {id: string; move: string},
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
  strategy: AiStrategy,
): string {
  const moveId = moveRef.id || moveRef.move;
  const suffix = strategy !== "first" && shouldTerastallize(moveId, request, playerId, context) ? " terastallize" : "";
  return `move ${moveId}${suffix}`;
}

function shouldTerastallize(moveId: string, request: ChoiceRequest, playerId: PlayerId, context: BattleAiContext): boolean {
  const teraType = request.active?.[0]?.canTerastallize;
  if (!teraType || context.teraUsed[playerId]) return false;
  const active = ownActive(request);
  const ownKnown = context.active[playerId];
  const opponent = context.active[opponentOf(playerId)];
  const hp = ownKnown?.hpPercent ?? hpPercentFromCondition(active?.condition ?? "");
  const move = context.dex.moves.get(moveId);
  if (!move.exists || move.category === "Status") return false;
  const ownAbilities = sourceAbilityIds(context.dex, active?.ability);
  const offensiveType = move.id === "terablast"
    ? teraType
    : effectiveMoveType(move.type, Boolean(move.flags.sound), ownAbilities).type;

  const opponentMoveId = context.lastMove[opponentOf(playerId)];
  if (opponentMoveId && active) {
    const opponentMove = context.dex.moves.get(opponentMoveId);
    const ownSpecies = context.dex.species.get(speciesFromDetails(active.details) || active.ident.split(":").slice(1).join(":").trim());
    if (opponentMove.exists && ownSpecies.exists) {
      const currentTypes = ownKnown ? activeTypes(context.dex, ownKnown) : ownSpecies.types;
      const currentImmune = context.dex.getImmunity(opponentMove.type, currentTypes);
      const teraImmune = context.dex.getImmunity(opponentMove.type, [teraType]);
      const currentStage = currentImmune ? context.dex.getEffectiveness(opponentMove.type, currentTypes) : -6;
      const teraStage = teraImmune ? context.dex.getEffectiveness(opponentMove.type, [teraType]) : -6;
      if (currentStage > 0 && teraStage < currentStage && (hp === null || hp <= 72)) return true;
    }
  }

  return offensiveType === teraType && (move.basePower || 0) >= 70 && opponent?.hpPercent !== null &&
    opponent?.hpPercent !== undefined && opponent.hpPercent <= 55 && (hp === null || hp >= 25);
}

function knownAbilityBlocksMove(
  opponent: KnownActive,
  move: {
    type: string;
    flags: {sound?: number; bullet?: number; wind?: number};
    priority?: number;
    target?: string;
  },
  dex: ModdedDex,
  attackerAbilities: Set<string> = new Set(),
): boolean {
  if (["moldbreaker", "teravolt", "turboblaze"].some(ability => attackerAbilities.has(ability))) return false;
  const typeImmunities: Record<string, string[]> = {
    Water: ["dryskin", "stormdrain", "waterabsorb"],
    Electric: ["lightningrod", "motordrive", "voltabsorb"],
    Fire: ["flashfire", "wellbakedbody"],
    Grass: ["sapsipper"],
    Ground: ["eartheater", "levitate"],
  };
  if ((typeImmunities[move.type] ?? []).some(ability => opponent.abilities.has(ability))) return true;
  if (move.flags.sound && opponent.abilities.has("soundproof")) return true;
  if (move.flags.bullet && opponent.abilities.has("bulletproof")) return true;
  if (move.flags.wind && opponent.abilities.has("windrider")) return true;
  const priorityBlocked = (move.priority ?? 0) > 0 &&
    !["self", "allySide", "allyTeam"].includes(move.target ?? "normal") &&
    ["armortail", "dazzling", "queenlymajesty"].some(ability => opponent.abilities.has(ability));
  if (priorityBlocked) return true;
  if (opponent.abilities.has("wonderguard")) {
    return dex.getEffectiveness(move.type, activeTypes(dex, opponent)) <= 0;
  }
  return false;
}

function activeTypes(dex: ModdedDex, active: KnownActive): string[] {
  return active.teraType ? [active.teraType] : [...dex.species.get(active.species).types];
}

function moveBypassesTypeImmunity(type: string, abilities: Set<string>): boolean {
  return (type === "Normal" || type === "Fighting") && (abilities.has("scrappy") || abilities.has("mindseye"));
}

function effectiveMovePriority(move: Move, abilities: Set<string>, user: KnownActive | null): number {
  let priority = move.priority || 0;
  if (abilities.has("allmovesplusonepriority")) priority += 1;
  if (abilities.has("allmovesminusonepriority")) priority -= 1;
  if (move.category === "Status" && abilities.has("prankster")) priority += 1;
  if (move.flags.heal && abilities.has("triage")) priority += 3;
  if (move.type === "Flying" && abilities.has("galewings") && user?.hpPercent === 100) priority += 1;
  return priority;
}

function weatherBlocksMove(type: string, weather: string | null): boolean {
  return (weather === "desolateland" && type === "Water") || (weather === "primordialsea" && type === "Fire");
}

function variablePowerFallback(moveId: string): number {
  if (["seismictoss", "nightshade", "dragonrage", "sonicboom"].includes(moveId)) return 70;
  if (["counter", "mirrorcoat", "metalburst", "endeavor", "superfang", "naturesmadness", "ruination"].includes(moveId)) return 65;
  if (["storedpower", "powertrip", "electroball", "gyroball", "heavyslam", "heatcrash", "flail", "reversal"].includes(moveId)) return 60;
  return 8;
}

function fixedDamageValue(moveId: string, level: number, targetHpPercent: number | null | undefined): number | null {
  if (moveId === "seismictoss" || moveId === "nightshade") return level;
  if (moveId === "dragonrage") return 40;
  if (moveId === "sonicboom") return 20;
  if (["superfang", "naturesmadness", "ruination"].includes(moveId)) {
    return Math.max(1, (targetHpPercent ?? 100) * 0.5);
  }
  return null;
}

function reactiveDamageMoveScore(
  moveId: string,
  request: ChoiceRequest,
  playerId: PlayerId,
  context: BattleAiContext,
): number | null {
  if (!["counter", "mirrorcoat", "metalburst"].includes(moveId)) return null;
  const opponentMoveId = context.lastMove[opponentOf(playerId)];
  if (!opponentMoveId) return null;
  const opponentMove = context.dex.moves.get(opponentMoveId);
  const categoryMatches = moveId === "counter"
    ? opponentMove.category === "Physical"
    : moveId === "mirrorcoat" ? opponentMove.category === "Special" : opponentMove.category !== "Status";
  if (!opponentMove.exists || !categoryMatches) return null;
  const incoming = estimateIncomingMoveDamagePercent(opponentMoveId, request, playerId, context);
  if (incoming === null || incoming <= 0) return null;
  return clamp(incoming * (moveId === "metalburst" ? 1.5 : 2), 25, 180);
}

function dynamicMoveProfile(
  move: Move,
  active: RequestPokemon | undefined,
  ownKnown: KnownActive | null,
  opponent: KnownActive | null,
  context: BattleAiContext,
): {type: string; basePower: number; accuracy: number | true; turnModifier: number} {
  let type = move.type;
  let basePower = move.basePower;
  let accuracy = move.accuracy;
  let turnModifier = 1;
  const weatherTypes: Record<string, string> = {
    raindance: "Water", primordialsea: "Water",
    sunnyday: "Fire", desolateland: "Fire",
    sandstorm: "Rock", snow: "Ice", hail: "Ice",
  };

  if (move.id === "weatherball" && context.weather && weatherTypes[context.weather]) {
    type = weatherTypes[context.weather];
    basePower *= 2;
  }
  if (move.id === "terablast" && ownKnown?.teraType) type = ownKnown.teraType;
  if (move.id === "revelationdance" && ownKnown) type = activeTypes(context.dex, ownKnown)[0] || type;

  if (move.id === "facade" && ownKnown?.status) basePower = 140;
  if (move.id === "hex" && opponent?.status) basePower = 130;
  if (move.id === "venoshock" && (opponent?.status === "psn" || opponent?.status === "tox")) basePower = 130;
  if (move.id === "brine" && opponent?.hpPercent !== null && opponent?.hpPercent !== undefined && opponent.hpPercent <= 50) basePower = 130;
  if (move.id === "storedpower" || move.id === "powertrip") basePower = 20 + positiveBoostTotal(ownKnown?.boosts ?? createZeroBoosts()) * 20;
  if (move.id === "eruption" || move.id === "waterspout") {
    const hp = ownKnown?.hpPercent ?? hpPercentFromCondition(active?.condition ?? "") ?? 100;
    basePower = Math.max(1, Math.floor(150 * hp / 100));
  }

  if (["solarbeam", "solarblade"].includes(move.id) && !["sunnyday", "desolateland"].includes(context.weather ?? "")) {
    turnModifier = ["raindance", "primordialsea", "sandstorm", "snow", "hail"].includes(context.weather ?? "") ? 0.25 : 0.5;
  }
  if ((move.id === "thunder" || move.id === "hurricane") && ["raindance", "primordialsea"].includes(context.weather ?? "")) accuracy = true;
  if ((move.id === "thunder" || move.id === "hurricane") && ["sunnyday", "desolateland"].includes(context.weather ?? "")) accuracy = 50;
  if (move.id === "blizzard" && ["snow", "hail"].includes(context.weather ?? "")) accuracy = true;

  return {type, basePower, accuracy, turnModifier};
}

function weatherDamageModifier(type: string, weather: string | null): number {
  if (["raindance", "primordialsea"].includes(weather ?? "")) {
    if (type === "Water") return 1.5;
    if (type === "Fire") return 0.5;
  }
  if (["sunnyday", "desolateland"].includes(weather ?? "")) {
    if (type === "Fire") return 1.5;
    if (type === "Water") return 0.5;
  }
  return 1;
}

function stabMultiplier(type: string, originalTypes: readonly string[], teraType: string | null | undefined, adaptability: boolean): number {
  const originalStab = originalTypes.includes(type);
  const teraStab = teraType === type;
  if (teraStab && originalStab) return adaptability ? 2.25 : 2;
  if (teraStab || originalStab) return adaptability ? 2 : 1.5;
  return 1;
}

function defensiveAbilityModifier(
  opponent: KnownActive | null,
  move: Move,
  moveType: string,
  typeStage: number,
  attackerAbilities: Set<string>,
): number {
  if (!opponent || bypassesAbilities(attackerAbilities)) return 1;
  let modifier = 1;
  if (move.category === "Physical" && opponent.abilities.has("furcoat")) modifier *= 0.5;
  if (move.category === "Special" && opponent.abilities.has("icescales")) modifier *= 0.5;
  if (move.category === "Physical" && opponent.status && opponent.abilities.has("marvelscale")) modifier /= 1.5;
  if (opponent.hpPercent === 100 && (opponent.abilities.has("multiscale") || opponent.abilities.has("shadowshield"))) modifier *= 0.5;
  if ((moveType === "Fire" || moveType === "Ice") && opponent.abilities.has("thickfat")) modifier *= 0.5;
  if (moveType === "Fire" && opponent.abilities.has("waterbubble")) modifier *= 0.5;
  if (opponent.abilities.has("fluffy")) {
    if (move.flags.contact) modifier *= 0.5;
    if (moveType === "Fire") modifier *= 2;
  }
  if (typeStage > 0 && ["filter", "prismarmor", "solidrock"].some(ability => opponent.abilities.has(ability))) modifier *= 0.75;
  if (moveType === "Ghost" && opponent.abilities.has("purifyingsalt")) modifier *= 0.5;
  if (move.flags.sound && opponent.abilities.has("punkrock")) modifier *= 0.5;
  return modifier;
}

function bypassesAbilities(abilities: Set<string>): boolean {
  return ["moldbreaker", "teravolt", "turboblaze"].some(ability => abilities.has(ability));
}

function accuracyStageMultiplier(accuracyStage: number, evasionStage: number): number {
  const stage = clamp(accuracyStage - evasionStage, -6, 6);
  return stage >= 0 ? (3 + stage) / 3 : 3 / (3 - stage);
}

function createZeroBoosts(): Record<BoostStat, number> {
  return {atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0};
}

function sourceAbilityIds(dex: ModdedDex, abilityName = ""): Set<string> {
  const id = toID(abilityName);
  if (!id) return new Set();
  const ability = dex.abilities.get(id) as unknown as {mythicSourceAbilities?: readonly string[]};
  return new Set([id, ...(ability.mythicSourceAbilities ?? []).map(toID)]);
}

function sourceItemIds(dex: ModdedDex, itemName = ""): Set<string> {
  const id = toID(itemName);
  if (!id) return new Set();
  const item = dex.items.get(id) as unknown as {mythicSourceItems?: readonly string[]};
  return new Set([id, ...(item.mythicSourceItems ?? []).map(toID)]);
}

function effectiveMoveType(type: string, isSoundMove: boolean, abilities: Set<string>): {type: string; powerModifier: number} {
  if (abilities.has("normalize")) return {type: "Normal", powerModifier: 1.2};
  if (type === "Normal") {
    const conversions: Array<[string, string]> = [
      ["aerilate", "Flying"],
      ["galvanize", "Electric"],
      ["pixilate", "Fairy"],
      ["refrigerate", "Ice"],
    ];
    for (const [ability, convertedType] of conversions) {
      if (abilities.has(ability)) return {type: convertedType, powerModifier: 1.2};
    }
  }
  if (isSoundMove && abilities.has("liquidvoice")) return {type: "Water", powerModifier: 1};
  return {type, powerModifier: 1};
}

function expectedHitCount(
  multihit: number | readonly number[] | null | undefined,
  skillLink = false,
  loadedDice = false,
): number {
  if (typeof multihit === "number") return multihit;
  if (Array.isArray(multihit) && multihit.length >= 2) {
    if (skillLink) return multihit[1];
    if (loadedDice && multihit[0] === 2 && multihit[1] === 5) return 4.5;
    return (multihit[0] + multihit[1]) / 2;
  }
  return 1;
}

function boostedStat(stat: number | undefined, stage = 0): number | undefined {
  return stat === undefined ? undefined : stat * boostMultiplier(stage);
}

function boostMultiplier(stage = 0): number {
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
}

function bestSwitch(request: ChoiceRequest, playerId: PlayerId, context: BattleAiContext): number | null {
  const candidates = switchCandidates(request);
  if (!candidates.length) return null;

  const opponent = context.active[opponentOf(playerId)];
  const batonPasser = context.lastMove[playerId] === "batonpass" ? context.active[playerId] : null;
  const opponentMoveIds = opponent ? revealedMoveIds(context, opponentOf(playerId), opponent) : [];
  const ranked = candidates.map(candidate => {
    const hp = hpPercentFromCondition(candidate.condition) ?? 0;
    const species = speciesFromDetails(candidate.details) || candidate.ident.split(":").slice(1).join(":").trim();
    const candidateAbilities = sourceAbilityIds(context.dex, candidate.ability);
    const candidateItems = sourceItemIds(context.dex, candidate.item);
    const defensiveScore = opponent
      ? defensiveTypeScore(context.dex, species, opponent.species, opponentMoveIds, candidateAbilities)
      : 0;
    const hazardPenalty = entryHazardPenalty(context, playerId, species, candidateAbilities, candidateItems);
    const passBonus = batonPasser ? batonPassRecipientScore(candidate, batonPasser, context.dex) : 0;
    return {
      index: candidate.index,
      score: hp + defensiveScore + passBonus - hazardPenalty,
    };
  });

  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked[0]?.index ?? null;
}

function entryHazardPenalty(
  context: BattleAiContext,
  playerId: PlayerId,
  speciesName: string,
  abilities: Set<string>,
  items: Set<string>,
): number {
  if (items.has("heavydutyboots")) return 0;
  const conditions = context.sideConditions[playerId];
  const types = context.dex.species.get(speciesName).types;
  let penalty = 0;
  if (conditions.stealthrock) penalty += 12.5 * Math.pow(2, context.dex.getEffectiveness("Rock", types));
  const grounded = !types.includes("Flying") && !abilities.has("levitate");
  if (grounded && conditions.spikes) penalty += [0, 12.5, 16.7, 25][Math.min(3, conditions.spikes)] ?? 25;
  if (grounded && conditions.toxicspikes && !types.includes("Poison") && !types.includes("Steel")) penalty += 8;
  if (grounded && conditions.stickyweb) penalty += 4;
  return penalty;
}

function batonPassRecipientScore(candidate: RequestPokemon, passer: KnownActive, dex: ModdedDex): number {
  const moves = (candidate.moves ?? []).map(move => dex.moves.get(move)).filter(move => move.exists);
  let score = 0;
  if (passer.boosts.atk > 0 && moves.some(move => move.category === "Physical")) score += passer.boosts.atk * 12;
  if (passer.boosts.spa > 0 && moves.some(move => move.category === "Special")) score += passer.boosts.spa * 12;
  if (passer.boosts.accuracy > 0 && moves.some(move => typeof move.accuracy === "number" && move.accuracy < 100)) {
    score += passer.boosts.accuracy * 8;
  }
  if (passer.boosts.spe > 0) score += passer.boosts.spe * 5;
  if (passer.volatiles.has("substitute")) score += 8;
  return score;
}

function defensiveTypeScore(
  dex: ModdedDex,
  ownSpecies: string,
  opponentSpecies: string,
  opponentMoveIds: string[],
  ownAbilities: Set<string>,
): number {
  const ownTypes = dex.species.get(ownSpecies).types;
  if (opponentMoveIds.length) {
    const scores = opponentMoveIds.map(opponentMoveId => {
      const move = dex.moves.get(opponentMoveId);
      if (!move.exists || move.category === "Status") return 0;
      if (!dex.getImmunity(move.type, ownTypes) || abilityGrantsTypeImmunity(ownAbilities, move.type)) return 45;
      return -dex.getEffectiveness(move.type, ownTypes) * 24;
    });
    return Math.min(...scores);
  }
  const opponentTypes = dex.species.get(opponentSpecies).types;
  let score = 0;
  for (const type of opponentTypes) {
    const stage = dex.getEffectiveness(type, ownTypes);
    score -= stage * 18;
  }
  return score;
}

function abilityGrantsTypeImmunity(abilities: Set<string>, type: string): boolean {
  const mapping: Record<string, string[]> = {
    Water: ["dryskin", "stormdrain", "waterabsorb"],
    Electric: ["lightningrod", "motordrive", "voltabsorb"],
    Fire: ["flashfire", "wellbakedbody"],
    Grass: ["sapsipper"],
    Ground: ["eartheater", "levitate"],
  };
  return (mapping[type] ?? []).some(id => abilities.has(id));
}

function chooseTeamPreview(request: ChoiceRequest, context: BattleAiContext, strategy: AiStrategy): string {
  const count = request.side?.pokemon?.length ?? 0;
  if (count <= 0) return "team 1";
  if (strategy === "first") return `team ${Array.from({length: count}, (_, index) => index + 1).join(", ")}`;
  const ranked = (request.side?.pokemon ?? []).map((pokemon, index) => ({
    index: index + 1,
    score: leadScore(pokemon, context.dex),
  }));
  ranked.sort((left, right) => right.score - left.score || left.index - right.index);
  return `team ${ranked.map(entry => entry.index).join(", ")}`;
}

function leadScore(pokemon: RequestPokemon, dex: ModdedDex): number {
  const moves = new Set((pokemon.moves ?? []).map(toID));
  const abilities = sourceAbilityIds(dex, pokemon.ability);
  const items = sourceItemIds(dex, pokemon.item);
  let score = 0;
  if (moves.has("trickroom")) score += 80;
  if (["stealthrock", "spikes", "toxicspikes", "stickyweb"].some(move => moves.has(move))) score += 48;
  if (["raindance", "sunnyday", "snowscape", "sandstorm"].some(move => moves.has(move))) score += 42;
  if (moves.has("batonpass")) score += 55;
  if (moves.has("fakeout")) score += 24;
  if (moves.has("uturn") || moves.has("voltswitch") || moves.has("flipturn")) score += 18;
  if (moves.has("reflect") || moves.has("lightscreen") || moves.has("auroraveil")) score += 25;
  if (["drizzle", "drought", "snowwarning", "sandstream"].some(ability => abilities.has(ability))) score += 45;
  if (abilities.has("intimidate")) score += 25;
  if (abilities.has("magicbounce")) score += 20;
  if (abilities.has("speedboost") && moves.has("batonpass")) score += 25;
  if (items.has("focussash")) score += 8;
  return score;
}

function availableMoves(request: ChoiceRequest) {
  return request.active?.[0]?.moves?.filter(candidate => {
    return !candidate.disabled && candidate.pp !== 0;
  }) ?? [];
}

function isTrapped(request: ChoiceRequest): boolean {
  return Boolean(request.active?.[0]?.trapped);
}

function ownActive(request: ChoiceRequest) {
  return request.side?.pokemon?.find(pokemon => pokemon.active);
}

function firstAvailableSwitch(request: ChoiceRequest): number | null {
  return switchCandidates(request)[0]?.index ?? null;
}

function switchCandidates(request: ChoiceRequest): Array<RequestPokemon & {index: number}> {
  const pokemon = request.side?.pokemon ?? [];
  const candidates = [];
  for (let i = 0; i < pokemon.length; i += 1) {
    const candidate = pokemon[i];
    if (candidate.active) continue;
    const hp = hpPercentFromCondition(candidate.condition);
    if (candidate.condition.endsWith(" fnt") || hp === 0) continue;
    candidates.push({...candidate, index: i + 1});
  }
  return candidates;
}

function opponentOf(playerId: PlayerId): PlayerId {
  return playerId === "p1" ? "p2" : "p1";
}

function parseIdent(raw = ""): {side: PlayerId | "unknown"; name: string} {
  const side = raw.startsWith("p1") ? "p1" : raw.startsWith("p2") ? "p2" : "unknown";
  const name = raw.includes(":") ? raw.split(":").slice(1).join(":").trim() : raw.trim();
  return {side, name: name || "unknown"};
}

function speciesFromDetails(details = ""): string {
  return details.split(",")[0]?.trim() ?? "";
}

function levelFromDetails(details = ""): number {
  const match = details.match(/(?:^|,)\s*L(\d+)(?:,|$)/i);
  const level = match ? Number(match[1]) : 100;
  return Number.isFinite(level) ? clamp(level, 1, 100) : 100;
}

function hpPercentFromCondition(condition = ""): number | null {
  if (!condition || condition.endsWith(" fnt")) return condition.endsWith(" fnt") ? 0 : null;
  const hpPart = condition.split(" ")[0];
  if (hpPart.includes("/")) {
    const [current, max] = hpPart.split("/").map(Number);
    if (Number.isFinite(current) && Number.isFinite(max) && max > 0) {
      return (current / max) * 100;
    }
  }
  const numeric = Number(hpPart);
  return Number.isFinite(numeric) ? numeric : null;
}

function maxHpFromCondition(condition = ""): number | null {
  const hpPart = condition.split(" ")[0];
  if (!hpPart.includes("/")) return null;
  const max = Number(hpPart.split("/")[1]);
  return Number.isFinite(max) && max > 0 ? max : null;
}

function statusFromCondition(condition = ""): string | null {
  const status = condition.split(" ").slice(1).find(part => ["brn", "frz", "par", "psn", "slp", "tox"].includes(toID(part)));
  return status ? toID(status) : null;
}

function createKnownActive(name: string, species: string, condition = ""): KnownActive {
  return {
    name,
    species,
    hpPercent: hpPercentFromCondition(condition),
    status: statusFromCondition(condition),
    boosts: {atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0},
    abilities: new Set(),
    items: new Set(),
    volatiles: new Set(),
    teraType: null,
    hasActed: false,
    stats: {},
    movePp: new Map(),
  };
}

function buildInitialRoster(sets: PokemonSet[], dex: ModdedDex): Map<string, KnownActive> {
  const roster = new Map<string, KnownActive>();
  for (const set of sets) {
    const known = knownActiveFromSheet(set, dex);
    roster.set(rosterKey(set.name || set.species, set.species), known);
  }
  return roster;
}

function rosterKey(name: string, species: string): string {
  return toID(name) || toID(species);
}

function findRosterState(
  context: BattleAiContext,
  playerId: PlayerId,
  name: string,
  species: string,
): KnownActive | undefined {
  const direct = context.roster[playerId].get(rosterKey(name, species));
  if (direct) return direct;
  return [...context.roster[playerId].values()].find(known => {
    return toID(known.name) === toID(name) || toID(known.species) === toID(species);
  });
}

function activateRosterState(
  stored: KnownActive | undefined,
  name: string,
  species: string,
  condition: string,
): KnownActive {
  const next = stored ? cloneKnownActive(stored) : createKnownActive(name, species, condition);
  next.name = name;
  next.species = species;
  next.hpPercent = hpPercentFromCondition(condition) ?? next.hpPercent;
  if (condition) next.status = statusFromCondition(condition);
  next.boosts = createZeroBoosts();
  next.volatiles = new Set();
  next.hasActed = false;
  return next;
}

function cloneKnownActive(known: KnownActive): KnownActive {
  return {
    ...known,
    boosts: {...known.boosts},
    abilities: new Set(known.abilities),
    items: new Set(known.items),
    volatiles: new Set(known.volatiles),
    stats: {...known.stats},
    movePp: new Map(known.movePp),
  };
}

function statsFromSet(
  set: PokemonSet,
  dex: ModdedDex,
): Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number> {
  const species = dex.species.get(set.species);
  const level = set.level || 100;
  const nature = dex.natures.get(set.nature) as unknown as {plus?: string; minus?: string};
  const result = {} as Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>;
  for (const stat of ["hp", "atk", "def", "spa", "spd", "spe"] as const) {
    const base = species.baseStats[stat];
    const iv = set.ivs?.[stat] ?? 31;
    const ev = set.evs?.[stat] ?? 0;
    const core = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100);
    if (stat === "hp") {
      result.hp = species.id === "shedinja" ? 1 : core + level + 10;
      continue;
    }
    const modifier = nature.plus === stat ? 1.1 : nature.minus === stat ? 0.9 : 1;
    result[stat] = Math.floor((core + 5) * modifier);
  }
  return result;
}

function movePpFromSet(set: PokemonSet, dex: ModdedDex): Map<string, number> {
  const pp = new Map<string, number>();
  for (const moveName of set.moves) {
    const move = dex.moves.get(moveName) as Move & {noPPBoosts?: boolean};
    if (!move.exists) continue;
    pp.set(move.id, move.noPPBoosts ? move.pp : Math.floor(move.pp * 8 / 5));
  }
  return pp;
}

function syncOwnRequestState(request: ChoiceRequest, playerId: PlayerId, context: BattleAiContext): void {
  const active = ownActive(request);
  if (!active) return;
  const activeName = parseIdent(active.ident).name;
  const activeSpecies = speciesFromDetails(active.details) || activeName;
  const activeIdentity = `${toID(activeName)}:${toID(activeSpecies)}`;
  if (context.requestActiveIdentity[playerId] !== activeIdentity) {
    context.requestActiveIdentity[playerId] = activeIdentity;
    context.movesChosenThisEntry[playerId] = 0;
  }
  let known = context.active[playerId];
  if (!known || toID(known.name) !== toID(activeName) || toID(known.species) !== toID(activeSpecies)) {
    known = createKnownActive(
      activeName,
      activeSpecies,
      active.condition,
    );
    context.active[playerId] = known;
  }
  known.hpPercent = hpPercentFromCondition(active.condition) ?? known.hpPercent;
  known.status = statusFromCondition(active.condition) ?? known.status;
  if (active.terastallized) {
    known.teraType = active.terastallized;
    context.teraTypes[playerId].set(toID(activeName), active.terastallized);
  }
  if (active.ability) addKnownAbility(known, active.ability, context.dex);
  if (active.item) addKnownItem(known, active.item, context.dex);
  context.roster[playerId].set(rosterKey(known.name, known.species), known);
}

function addKnownAbility(known: KnownActive, abilityName: string, dex: ModdedDex): void {
  for (const ability of sourceAbilityIds(dex, abilityName)) known.abilities.add(ability);
}

function addKnownItem(known: KnownActive, itemName: string, dex: ModdedDex): void {
  for (const item of sourceItemIds(dex, itemName)) known.items.add(item);
}

function removeKnownItem(known: KnownActive, itemName: string, dex: ModdedDex): void {
  const removed = sourceItemIds(dex, itemName);
  for (const item of removed) known.items.delete(item);
  if (removed.has(toID(itemName)) && removed.size > 1) known.items.delete(toID(itemName));
}

function rememberRevealedMove(
  context: BattleAiContext,
  playerId: PlayerId,
  pokemonName: string,
  moveId: string,
): void {
  if (!moveId) return;
  const key = toID(pokemonName);
  const moves = context.revealedMoves[playerId].get(key) ?? new Set<string>();
  moves.add(moveId);
  context.revealedMoves[playerId].set(key, moves);
}

function revealedMoveIds(context: BattleAiContext, playerId: PlayerId, active: KnownActive): string[] {
  const moves = new Set(context.revealedMoves[playerId].get(toID(active.name)) ?? []);
  if (context.openTeamSheets) {
    const sheet = findTeamSheet(context, playerId, active.name, active.species);
    for (const move of sheet?.moves ?? []) moves.add(toID(move));
  }
  const lastMove = context.lastMove[playerId];
  if (lastMove) moves.add(lastMove);
  return [...moves];
}

function findTeamSheet(
  context: BattleAiContext,
  playerId: PlayerId,
  name: string,
  species: string,
): PokemonSet | undefined {
  return context.teamSheets[playerId].find(set => {
    return toID(set.name || "") === toID(name) || toID(set.species) === toID(species);
  });
}

function applyOpenTeamSheet(active: KnownActive, playerId: PlayerId, context: BattleAiContext): void {
  const sheet = findTeamSheet(context, playerId, active.name, active.species);
  if (!sheet) return;
  addKnownAbility(active, sheet.ability, context.dex);
  addKnownItem(active, sheet.item, context.dex);
  active.stats = statsFromSet(sheet, context.dex);
  active.movePp = movePpFromSet(sheet, context.dex);
}

function clonePokemonSet(set: PokemonSet): PokemonSet {
  return JSON.parse(JSON.stringify(set)) as PokemonSet;
}

function parseSide(raw = ""): PlayerId | null {
  if (raw.startsWith("p1")) return "p1";
  if (raw.startsWith("p2")) return "p2";
  return null;
}

function parseBoostStat(raw = ""): BoostStat | null {
  const stat = toID(raw) as BoostStat;
  return boostStats().includes(stat) ? stat : null;
}

function boostStats(): BoostStat[] {
  return ["atk", "def", "spa", "spd", "spe", "accuracy", "evasion"];
}

function clearBoosts(boosts: Record<BoostStat, number>): void {
  for (const stat of boostStats()) boosts[stat] = 0;
}

function positiveBoostTotal(boosts: Record<BoostStat, number>): number {
  return boostStats().reduce((total, stat) => total + Math.max(0, boosts[stat]), 0);
}

function setupBoosts(moveId: string): Partial<Record<BoostStat, number>> | null {
  const setups: Record<string, Partial<Record<BoostStat, number>>> = {
    agility: {spe: 2},
    bulkup: {atk: 1, def: 1},
    calmmind: {spa: 1, spd: 1},
    coil: {atk: 1, def: 1, accuracy: 1},
    cottondefense: {def: 3},
    dragondance: {atk: 1, spe: 1},
    nastyplot: {spa: 2},
    quiverdance: {spa: 1, spd: 1, spe: 1},
    shellsmash: {atk: 2, spa: 2, spe: 2},
    swordsdance: {atk: 2},
  };
  return setups[moveId] ?? null;
}

function hazardLayerLimit(moveId: string): number {
  if (moveId === "spikes") return 3;
  if (moveId === "toxicspikes") return 2;
  if (moveId === "stealthrock" || moveId === "stickyweb") return 1;
  return 0;
}

function weatherForMove(moveId: string): string | null {
  if (moveId === "raindance") return "raindance";
  if (moveId === "sunnyday") return "sunnyday";
  if (moveId === "snowscape" || moveId === "hail") return "snow";
  if (moveId === "sandstorm") return "sandstorm";
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
