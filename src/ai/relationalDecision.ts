import crypto from "node:crypto";

export const RELATIONAL_DECISION_SNAPSHOT_VERSION = "relational-decision-snapshot-v1" as const;
export const RELATIONAL_ENCODER_VERSION = "relational-switch-encoder-v1" as const;

export const RELATIONAL_SWITCH_FEATURES = [
  "candidateHp", "entryDamage", "entryKoRisk", "incomingMean", "incomingWorst", "priorityKoRisk",
  "bestOutput", "koProbability", "speedWinProbability", "stabResistance", "coverageResistance", "statusRisk",
  "recoveryAccess", "priorityAccess", "pivotAccess", "hazardRemovalAccess", "setupAccess", "switchPressure",
  "boostSacrificeCost", "roleRedundancy", "blindSpotDelta", "answerCoverageDelta", "safeFollowupBreadth", "informationConfidence",
] as const;

export type RelationalSwitchFeature = typeof RELATIONAL_SWITCH_FEATURES[number];
export type RelationalNodeKind = "own-active" | "opponent-active" | "candidate" | "opponent-response" | "team-role";
export type RelationalEdgeKind = "takes-response" | "threatens" | "speed-relation" | "type-relation" | "role-coverage" | "enters-field";

export interface RelationalDecisionNodeV1 {
  id: string;
  kind: RelationalNodeKind;
  publicLabel: string;
}

export interface RelationalDecisionEdgeV1 {
  source: string;
  target: string;
  kind: RelationalEdgeKind;
  value: number;
  known: boolean;
}

export interface RelationalDecisionCandidateV1 {
  id: string;
  actionKind: "move" | "switch";
  target: string;
  values: Record<RelationalSwitchFeature, number>;
  knownMask: string;
}

export interface RelationalDecisionSnapshotV1 {
  schemaVersion: 1;
  version: typeof RELATIONAL_DECISION_SNAPSHOT_VERSION;
  encoderVersion: typeof RELATIONAL_ENCODER_VERSION;
  domain: "battle-action";
  primaryResearchDomain: "switch";
  informationMode: "open-sheet" | "closed-sheet";
  turn: number;
  playerId: "p1" | "p2";
  nodes: RelationalDecisionNodeV1[];
  edges: RelationalDecisionEdgeV1[];
  candidates: RelationalDecisionCandidateV1[];
  encoderInputSha256: string;
  sha256: string;
}

export type RelationalDecisionSnapshotInput = Omit<RelationalDecisionSnapshotV1, "schemaVersion" | "version" | "encoderVersion" | "domain" | "primaryResearchDomain" | "encoderInputSha256" | "sha256">;

export function buildRelationalDecisionSnapshot(input: RelationalDecisionSnapshotInput): RelationalDecisionSnapshotV1 {
  const normalized = normalizeInput(input);
  const encoderInputSha256 = digest(normalized);
  const core = {schemaVersion: 1 as const, version: RELATIONAL_DECISION_SNAPSHOT_VERSION, encoderVersion: RELATIONAL_ENCODER_VERSION, domain: "battle-action" as const, primaryResearchDomain: "switch" as const, ...normalized, encoderInputSha256};
  const snapshot: RelationalDecisionSnapshotV1 = {...core, sha256: digest(core)};
  assertRelationalDecisionSnapshot(snapshot);
  return snapshot;
}

export function assertRelationalDecisionSnapshot(snapshot: RelationalDecisionSnapshotV1): void {
  if (snapshot.schemaVersion !== 1 || snapshot.version !== RELATIONAL_DECISION_SNAPSHOT_VERSION || snapshot.encoderVersion !== RELATIONAL_ENCODER_VERSION || snapshot.domain !== "battle-action" || snapshot.primaryResearchDomain !== "switch") throw new Error("Unsupported relational decision snapshot");
  const {sha256, ...core} = snapshot;
  if (!hex(sha256) || digest(core) !== sha256) throw new Error("Relational decision snapshot signature mismatch");
  const {schemaVersion: _schemaVersion, version: _version, encoderVersion: _encoderVersion, domain: _domain, primaryResearchDomain: _primaryResearchDomain, encoderInputSha256, ...input} = core;
  if (!hex(encoderInputSha256) || digest(input) !== encoderInputSha256) throw new Error("Relational decision encoder input signature mismatch");
  normalizeInput(input);
}

export function relationalKnown(mask: string, feature: RelationalSwitchFeature): boolean {
  if (!/^[0-9a-f]{6}$/.test(mask)) throw new Error(`Invalid relational known mask: ${mask}`);
  return Boolean(Number.parseInt(mask, 16) & (1 << RELATIONAL_SWITCH_FEATURES.indexOf(feature)));
}

export function relationalKnownMask(features: Iterable<RelationalSwitchFeature>): string {
  let mask = 0;
  for (const feature of features) {
    const index = RELATIONAL_SWITCH_FEATURES.indexOf(feature);
    if (index < 0) throw new Error(`Unknown relational feature: ${feature}`);
    mask |= 1 << index;
  }
  return (mask >>> 0).toString(16).padStart(6, "0");
}

export function assertRelationalDecisionCandidate(candidate: RelationalDecisionCandidateV1): void {
  if (!candidate.id || !candidate.target || !/^[0-9a-f]{6}$/.test(candidate.knownMask) || !["move", "switch"].includes(candidate.actionKind)) throw new Error(`Invalid relational decision candidate: ${candidate.id}`);
  for (const feature of RELATIONAL_SWITCH_FEATURES) {
    const value = candidate.values[feature];
    if (!Number.isFinite(value) || value < -1 || value > 1) throw new Error(`Invalid relational feature ${candidate.id}/${feature}`);
    if (!relationalKnown(candidate.knownMask, feature) && value !== 0) throw new Error(`Unknown relational feature must be zero: ${candidate.id}/${feature}`);
  }
}

function normalizeInput(input: RelationalDecisionSnapshotInput): RelationalDecisionSnapshotInput {
  if ((input.playerId !== "p1" && input.playerId !== "p2") || !Number.isInteger(input.turn) || input.turn < 0 || !["open-sheet", "closed-sheet"].includes(input.informationMode)) throw new Error("Invalid relational decision identity");
  const nodes = input.nodes.map(node => ({...node})).sort((a, b) => a.id.localeCompare(b.id));
  const nodeIds = new Set(nodes.map(node => node.id));
  if (nodeIds.size !== nodes.length || nodes.some(node => !node.id || !node.publicLabel || !["own-active", "opponent-active", "candidate", "opponent-response", "team-role"].includes(node.kind))) throw new Error("Invalid relational decision nodes");
  const edges = input.edges.map(edge => ({...edge, value: round(edge.value)})).sort((a, b) => `${a.source}\0${a.target}\0${a.kind}`.localeCompare(`${b.source}\0${b.target}\0${b.kind}`));
  if (edges.some(edge => !nodeIds.has(edge.source) || !nodeIds.has(edge.target) || !Number.isFinite(edge.value) || edge.value < -1 || edge.value > 1 || !["takes-response", "threatens", "speed-relation", "type-relation", "role-coverage", "enters-field"].includes(edge.kind))) throw new Error("Invalid relational decision edges");
  const candidates = input.candidates.map(candidate => ({...candidate, values: Object.fromEntries(RELATIONAL_SWITCH_FEATURES.map(feature => [feature, round(candidate.values[feature])])) as Record<RelationalSwitchFeature, number>})).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(candidates.map(candidate => candidate.id)).size !== candidates.length || candidates.some(candidate => !nodeIds.has(`candidate:${candidate.id}`))) throw new Error("Invalid relational decision candidates");
  candidates.forEach(assertRelationalDecisionCandidate);
  return {informationMode: input.informationMode, turn: input.turn, playerId: input.playerId, nodes, edges, candidates};
}

function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function digest(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function hex(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
