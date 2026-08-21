import {buildJointBattleDecisionSnapshot, JOINT_BATTLE_FEATURES, jointBattleKnownMask, recommendJointBattleShadow, type JointBattleCandidateV1, type JointBattleDecisionSnapshotV1, type JointBattleFeature, type JointBattleShadowRecommendation} from "./relationalBattlePolicy";
import {relationalKnown as legacyKnown, type RelationalDecisionSnapshotV1, type RelationalSwitchFeature} from "./relationalDecision";

export interface JointBattleShadowCandidateInput {
  id: string;
  actionKind: "move" | "switch";
  target: string;
  expected: number;
  worst: number;
  baseScore: number;
  outcomeValues: number[];
}

export interface JointBattleShadowAdapterInput {
  informationMode: "open-sheet" | "closed-sheet";
  turn: number;
  playerId: "p1" | "p2";
  legacySelected: string;
  modeLabel: string;
  legacySnapshot: RelationalDecisionSnapshotV1;
  candidates: JointBattleShadowCandidateInput[];
}

export interface JointBattleShadowAdapterResult {
  snapshot: JointBattleDecisionSnapshotV1;
  recommendation: JointBattleShadowRecommendation;
}

export function buildJointBattleShadowAdapter(input: JointBattleShadowAdapterInput): JointBattleShadowAdapterResult {
  const legacyCandidates = new Map(input.legacySnapshot.candidates.map(candidate => [candidate.id, candidate])), candidates = input.candidates.map(candidate => jointCandidate(candidate, legacyCandidates.get(candidate.id)));
  const nodes = input.legacySnapshot.nodes.map(node => ({...node, kind: node.kind === "opponent-response" ? "opponent-response" as const : node.kind}));
  const edges = input.legacySnapshot.edges.map(edge => ({...edge, kind: edge.kind === "enters-field" ? "field-relation" as const : edge.kind}));
  const snapshot = buildJointBattleDecisionSnapshot({informationMode: input.informationMode, turn: input.turn, playerId: input.playerId, nodes, edges, candidates, legacyFallback: {candidateId: input.legacySelected, source: "legacy-search", mandatoryWhenAllCandidatesVetoed: true}, modeAuxiliary: {label: input.modeLabel, confidence: 1, authority: "diagnostic-only", routingAllowed: false}});
  return {snapshot, recommendation: recommendJointBattleShadow(snapshot)};
}

function jointCandidate(input: JointBattleShadowCandidateInput, legacy?: RelationalDecisionSnapshotV1["candidates"][number]): JointBattleCandidateV1 {
  const values = Object.fromEntries(JOINT_BATTLE_FEATURES.map(feature => [feature, 0])) as Record<JointBattleFeature, number>, known = new Set<JointBattleFeature>();
  set(values, known, "shortValue", bounded(input.expected));
  set(values, known, "longValue", bounded(input.baseScore));
  const outcomes = input.outcomeValues.filter(Number.isFinite).map(bounded), spread = outcomes.length ? Math.max(...outcomes) - Math.min(...outcomes) : 2;
  set(values, known, "uncertainty", bounded01(spread / 2));
  set(values, known, "terminalRisk", bounded01((1 - bounded(input.worst)) / 2));
  set(values, known, "informationConfidence", input.actionKind === "switch" && legacy && legacyValueKnown(legacy, "informationConfidence") ? bounded01(legacy.values.informationConfidence) : .5);
  if (legacy) {
    copyLegacy(legacy, values, known, "candidateHp", "candidateHp");
    copyLegacy(legacy, values, known, "incomingMean", "incomingMean");
    copyLegacy(legacy, values, known, "incomingWorst", "incomingWorst");
    copyLegacy(legacy, values, known, "koProbability", "koProbability");
    copyLegacy(legacy, values, known, "speedWinProbability", "speedWinProbability");
    copyLegacy(legacy, values, known, "recoveryAccess", "recoveryAccess");
    copyLegacy(legacy, values, known, "priorityAccess", "priorityAccess");
    copyLegacy(legacy, values, known, "pivotAccess", "pivotAccess");
    copyLegacy(legacy, values, known, "setupAccess", "setupAccess");
    copyLegacy(legacy, values, known, "blindSpotDelta", "blindSpotDelta");
    copyLegacy(legacy, values, known, "safeFollowupBreadth", "safeFollowupBreadth");
    copyLegacy(legacy, values, known, "answerCoverageDelta", "roleCoverageDelta");
    if (legacyValueKnown(legacy, "entryDamage")) set(values, known, "hazardImpact", bounded(-legacy.values.entryDamage));
  }
  return {id: input.id, actionKind: input.actionKind, target: input.target, legal: true, values, knownMask: jointBattleKnownMask(known)};
}

function copyLegacy(candidate: RelationalDecisionSnapshotV1["candidates"][number], values: Record<JointBattleFeature, number>, known: Set<JointBattleFeature>, source: RelationalSwitchFeature, target: JointBattleFeature): void { if (legacyValueKnown(candidate, source)) set(values, known, target, bounded(candidate.values[source])); }
function legacyValueKnown(candidate: RelationalDecisionSnapshotV1["candidates"][number], feature: RelationalSwitchFeature): boolean { return legacyKnown(candidate.knownMask, feature); }
function set(values: Record<JointBattleFeature, number>, known: Set<JointBattleFeature>, feature: JointBattleFeature, value: number): void { values[feature] = value; known.add(feature); }
function bounded(value: number): number { return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0)); }
function bounded01(value: number): number { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1)); }
