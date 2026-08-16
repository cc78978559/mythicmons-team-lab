import crypto from "node:crypto";

export const RELATIONAL_BATTLE_POLICY_VERSION = "relational-battle-policy-v1" as const;
export const RELATIONAL_BATTLE_ENCODER_VERSION = "relational-battle-encoder-v1" as const;

export const JOINT_BATTLE_FEATURES = [
  "candidateHp", "immediateDamage", "incomingMean", "incomingWorst", "koProbability", "speedWinProbability",
  "typePressure", "statusPressure", "recoveryAccess", "priorityAccess", "pivotAccess", "setupAccess", "hazardImpact",
  "roleCoverageDelta", "blindSpotDelta", "safeFollowupBreadth", "informationConfidence", "shortValue", "longValue",
  "uncertainty", "terminalRisk",
] as const;

export type JointBattleFeature = typeof JOINT_BATTLE_FEATURES[number];
export type JointBattleActionKind = "move" | "switch";
export type JointBattleNodeKind = "own-active" | "opponent-active" | "candidate" | "opponent-response" | "team-role" | "field";
export type JointBattleEdgeKind = "takes-response" | "threatens" | "speed-relation" | "type-relation" | "role-coverage" | "field-relation";

export interface JointBattleCandidateV1 {
  id: string;
  actionKind: JointBattleActionKind;
  target: string;
  legal: true;
  values: Record<JointBattleFeature, number>;
  knownMask: string;
}

export interface JointBattleDecisionSnapshotV1 {
  schemaVersion: 1;
  version: typeof RELATIONAL_BATTLE_POLICY_VERSION;
  encoderVersion: typeof RELATIONAL_BATTLE_ENCODER_VERSION;
  authority: "shadow-diagnostic-only";
  activationStatus: "shadow-only";
  formalActivationAllowed: false;
  domain: "battle-action";
  actionKinds: ["move", "switch"];
  informationMode: "open-sheet" | "closed-sheet";
  turn: number;
  playerId: "p1" | "p2";
  nodes: Array<{id: string; kind: JointBattleNodeKind; publicLabel: string}>;
  edges: Array<{source: string; target: string; kind: JointBattleEdgeKind; value: number; known: boolean}>;
  candidates: JointBattleCandidateV1[];
  legacyFallback: {candidateId: string; source: "legacy-search"; mandatoryWhenAllCandidatesVetoed: true};
  modeAuxiliary: {label: string; confidence: number; authority: "diagnostic-only"; routingAllowed: false} | null;
  encoderInputSha256: string;
  sha256: string;
}

export type JointBattleDecisionSnapshotInput = Omit<JointBattleDecisionSnapshotV1, "schemaVersion" | "version" | "encoderVersion" | "authority" | "activationStatus" | "formalActivationAllowed" | "domain" | "actionKinds" | "encoderInputSha256" | "sha256">;

export interface JointBattleShadowRecommendation {
  authority: "shadow-diagnostic-only";
  activationStatus: "shadow-only";
  formalActivationAllowed: false;
  routingAllowed: false;
  candidateId: string;
  usedLegacyFallback: boolean;
  vetoes: Record<string, string[]>;
  score: number | null;
}

export function buildJointBattleDecisionSnapshot(input: JointBattleDecisionSnapshotInput): JointBattleDecisionSnapshotV1 {
  const normalized = normalizeInput(input), encoderInputSha256 = digest(normalized);
  const core = {schemaVersion: 1 as const, version: RELATIONAL_BATTLE_POLICY_VERSION, encoderVersion: RELATIONAL_BATTLE_ENCODER_VERSION, authority: "shadow-diagnostic-only" as const, activationStatus: "shadow-only" as const, formalActivationAllowed: false as const, domain: "battle-action" as const, actionKinds: ["move", "switch"] as ["move", "switch"], ...normalized, encoderInputSha256};
  const snapshot = {...core, sha256: digest(core)};
  assertJointBattleDecisionSnapshot(snapshot);
  return snapshot;
}

export function assertJointBattleDecisionSnapshot(snapshot: JointBattleDecisionSnapshotV1): void {
  if (snapshot.schemaVersion !== 1 || snapshot.version !== RELATIONAL_BATTLE_POLICY_VERSION || snapshot.encoderVersion !== RELATIONAL_BATTLE_ENCODER_VERSION || snapshot.authority !== "shadow-diagnostic-only" || snapshot.activationStatus !== "shadow-only" || snapshot.formalActivationAllowed !== false || snapshot.domain !== "battle-action" || snapshot.actionKinds.join("|") !== "move|switch") throw new Error("Unsupported joint battle decision snapshot");
  const {sha256, ...core} = snapshot;
  if (!hex(sha256) || digest(core) !== sha256) throw new Error("Joint battle decision signature mismatch");
  const {schemaVersion: _schemaVersion, version: _version, encoderVersion: _encoderVersion, authority: _authority, activationStatus: _activationStatus, formalActivationAllowed: _formalActivationAllowed, domain: _domain, actionKinds: _actionKinds, encoderInputSha256, ...input} = core;
  if (!hex(encoderInputSha256) || digest(input) !== encoderInputSha256) throw new Error("Joint battle encoder input signature mismatch");
  normalizeInput(input);
}

export function jointBattleKnownMask(features: Iterable<JointBattleFeature>): string {
  let mask = 0;
  for (const feature of features) { const index = JOINT_BATTLE_FEATURES.indexOf(feature); if (index < 0) throw new Error(`Unknown joint battle feature: ${feature}`); mask |= 1 << index; }
  return (mask >>> 0).toString(16).padStart(6, "0");
}

export function jointBattleKnown(mask: string, feature: JointBattleFeature): boolean {
  if (!/^[0-9a-f]{6}$/.test(mask)) throw new Error(`Invalid joint battle known mask: ${mask}`);
  return Boolean(Number.parseInt(mask, 16) & (1 << JOINT_BATTLE_FEATURES.indexOf(feature)));
}

export function assertJointBattleCandidate(candidate: JointBattleCandidateV1): void {
  if (!candidate.id || !candidate.target || candidate.legal !== true || !["move", "switch"].includes(candidate.actionKind) || !/^[0-9a-f]{6}$/.test(candidate.knownMask)) throw new Error(`Invalid joint battle candidate: ${candidate.id}`);
  for (const feature of JOINT_BATTLE_FEATURES) { const value = candidate.values[feature]; if (!Number.isFinite(value) || value < -1 || value > 1) throw new Error(`Invalid joint battle feature: ${candidate.id}/${feature}`); if (!jointBattleKnown(candidate.knownMask, feature) && value !== 0) throw new Error(`Unknown joint battle feature must be zero: ${candidate.id}/${feature}`); }
}

export function recommendJointBattleShadow(snapshot: JointBattleDecisionSnapshotV1): JointBattleShadowRecommendation {
  assertJointBattleDecisionSnapshot(snapshot);
  const vetoes = Object.fromEntries(snapshot.candidates.map(candidate => [candidate.id, safetyVetoes(candidate)])), safe = snapshot.candidates.filter(candidate => vetoes[candidate.id].length === 0);
  if (!safe.length) return {authority: "shadow-diagnostic-only", activationStatus: "shadow-only", formalActivationAllowed: false, routingAllowed: false, candidateId: snapshot.legacyFallback.candidateId, usedLegacyFallback: true, vetoes, score: null};
  const ranked = safe.map(candidate => ({candidate, score: jointScore(candidate)})).sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id));
  return {authority: "shadow-diagnostic-only", activationStatus: "shadow-only", formalActivationAllowed: false, routingAllowed: false, candidateId: ranked[0].candidate.id, usedLegacyFallback: false, vetoes, score: round(ranked[0].score)};
}

function safetyVetoes(candidate: JointBattleCandidateV1): string[] {
  const reasons: string[] = [];
  if (!jointBattleKnown(candidate.knownMask, "shortValue") || !jointBattleKnown(candidate.knownMask, "longValue")) reasons.push("unknown-value-horizon");
  if (jointBattleKnown(candidate.knownMask, "terminalRisk") && candidate.values.terminalRisk >= .95) reasons.push("terminal-risk");
  if (jointBattleKnown(candidate.knownMask, "uncertainty") && candidate.values.uncertainty >= .98) reasons.push("uncertainty-limit");
  return reasons;
}

function jointScore(candidate: JointBattleCandidateV1): number { return candidate.values.shortValue * .45 + candidate.values.longValue * .55 - Math.max(0, candidate.values.uncertainty) * .2 - Math.max(0, candidate.values.terminalRisk) * .4; }

function normalizeInput(input: JointBattleDecisionSnapshotInput): JointBattleDecisionSnapshotInput {
  if (!Number.isInteger(input.turn) || input.turn < 0 || !["p1", "p2"].includes(input.playerId) || !["open-sheet", "closed-sheet"].includes(input.informationMode)) throw new Error("Invalid joint battle decision identity");
  const nodes = input.nodes.map(node => ({...node})).sort((a, b) => a.id.localeCompare(b.id)), nodeIds = new Set(nodes.map(node => node.id));
  if (nodeIds.size !== nodes.length || nodes.some(node => !node.id || !node.publicLabel || !["own-active", "opponent-active", "candidate", "opponent-response", "team-role", "field"].includes(node.kind))) throw new Error("Invalid joint battle nodes");
  const edges = input.edges.map(edge => ({...edge, value: round(edge.value)})).sort((a, b) => `${a.source}\0${a.target}\0${a.kind}`.localeCompare(`${b.source}\0${b.target}\0${b.kind}`));
  if (edges.some(edge => !nodeIds.has(edge.source) || !nodeIds.has(edge.target) || !Number.isFinite(edge.value) || edge.value < -1 || edge.value > 1 || !["takes-response", "threatens", "speed-relation", "type-relation", "role-coverage", "field-relation"].includes(edge.kind))) throw new Error("Invalid joint battle edges");
  const candidates = input.candidates.map(candidate => ({...candidate, values: Object.fromEntries(JOINT_BATTLE_FEATURES.map(feature => [feature, round(candidate.values[feature])])) as Record<JointBattleFeature, number>})).sort((a, b) => a.id.localeCompare(b.id));
  if (!candidates.length || new Set(candidates.map(candidate => candidate.id)).size !== candidates.length || candidates.some(candidate => !nodeIds.has(`candidate:${candidate.id}`))) throw new Error("Invalid joint battle candidates");
  candidates.forEach(assertJointBattleCandidate);
  if (!candidates.some(candidate => candidate.id === input.legacyFallback.candidateId) || input.legacyFallback.source !== "legacy-search" || input.legacyFallback.mandatoryWhenAllCandidatesVetoed !== true) throw new Error("Invalid joint battle legacy fallback");
  if (input.modeAuxiliary && (!input.modeAuxiliary.label || input.modeAuxiliary.confidence < 0 || input.modeAuxiliary.confidence > 1 || input.modeAuxiliary.authority !== "diagnostic-only" || input.modeAuxiliary.routingAllowed !== false)) throw new Error("Invalid joint battle mode auxiliary");
  return {informationMode: input.informationMode, turn: input.turn, playerId: input.playerId, nodes, edges, candidates, legacyFallback: {...input.legacyFallback}, modeAuxiliary: input.modeAuxiliary ? {...input.modeAuxiliary, confidence: round(input.modeAuxiliary.confidence)} : null};
}

function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function digest(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function hex(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
