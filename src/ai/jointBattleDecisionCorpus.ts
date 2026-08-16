import crypto from "node:crypto";
import {assertJointBattleCandidate, RELATIONAL_BATTLE_ENCODER_VERSION, type JointBattleCandidateV1} from "./relationalBattlePolicy";

export const JOINT_BATTLE_DECISION_CORPUS_VERSION = "joint-battle-decision-corpus-v1" as const;
export type JointBattleCorpusSplit = "train" | "validation" | "test";

export interface JointBattleDecisionObservationV1 {
  decisionId: string;
  candidateId: string;
  familyId: string;
  familyClusterId: string;
  environment: string;
  split: JointBattleCorpusSplit;
  candidate: JointBattleCandidateV1;
  shortUtility: number;
  terminalUtility: 0 | .5 | 1;
  uncertainty: number;
  terminalRisk: number;
  sourceAuthority: "signed-research-family" | "synthetic-test";
  sourceFingerprint: string;
  branchFingerprint: string;
  legacySwitchAuxiliary?: {authority: "switch-v3-auxiliary-training-only"; encoderVersion: "relational-switch-encoder-v1"; sourceFingerprint: string; validationEvidenceAllowed: false};
}

export interface JointBattleDecisionCorpusV1 {
  schemaVersion: 1;
  version: typeof JOINT_BATTLE_DECISION_CORPUS_VERSION;
  encoderVersion: typeof RELATIONAL_BATTLE_ENCODER_VERSION;
  authority: "joint-shadow-training-only";
  activationStatus: "shadow-only";
  formalActivationAllowed: false;
  sourceAuthority: "signed-research-family-corpus" | "synthetic-test";
  rows: JointBattleDecisionObservationV1[];
  metrics: {decisions: number; candidates: number; moveCandidates: number; switchCandidates: number; families: number; familyClusters: number; legacyAuxiliaryCandidates: number; splits: Record<string, number>};
  sha256: string;
}

export function buildJointBattleDecisionCorpus(rows: readonly JointBattleDecisionObservationV1[], sourceAuthority: JointBattleDecisionCorpusV1["sourceAuthority"]): JointBattleDecisionCorpusV1 {
  validateRows(rows, sourceAuthority);
  const ordered = [...rows].map(row => structuredClone(row)).sort((a, b) => a.decisionId.localeCompare(b.decisionId) || a.candidateId.localeCompare(b.candidateId));
  const metrics = {decisions: new Set(ordered.map(row => row.decisionId)).size, candidates: ordered.length, moveCandidates: ordered.filter(row => row.candidate.actionKind === "move").length, switchCandidates: ordered.filter(row => row.candidate.actionKind === "switch").length, families: new Set(ordered.map(row => row.familyId)).size, familyClusters: new Set(ordered.map(row => row.familyClusterId)).size, legacyAuxiliaryCandidates: ordered.filter(row => row.legacySwitchAuxiliary).length, splits: counts(ordered.map(row => row.split))};
  const core = {schemaVersion: 1 as const, version: JOINT_BATTLE_DECISION_CORPUS_VERSION, encoderVersion: RELATIONAL_BATTLE_ENCODER_VERSION, authority: "joint-shadow-training-only" as const, activationStatus: "shadow-only" as const, formalActivationAllowed: false as const, sourceAuthority, rows: ordered, metrics};
  const corpus = {...core, sha256: digest(core)};
  assertJointBattleDecisionCorpus(corpus);
  return corpus;
}

export function assertJointBattleDecisionCorpus(corpus: JointBattleDecisionCorpusV1): void {
  if (corpus.schemaVersion !== 1 || corpus.version !== JOINT_BATTLE_DECISION_CORPUS_VERSION || corpus.encoderVersion !== RELATIONAL_BATTLE_ENCODER_VERSION || corpus.authority !== "joint-shadow-training-only" || corpus.activationStatus !== "shadow-only" || corpus.formalActivationAllowed !== false || !["signed-research-family-corpus", "synthetic-test"].includes(corpus.sourceAuthority)) throw new Error("Unsupported joint battle decision corpus");
  const {sha256, ...core} = corpus;
  if (!hex(sha256) || digest(core) !== sha256) throw new Error("Joint battle decision corpus signature mismatch");
  validateRows(corpus.rows, corpus.sourceAuthority);
  const expected = buildMetrics(corpus.rows);
  if (JSON.stringify(expected) !== JSON.stringify(corpus.metrics)) throw new Error("Joint battle decision corpus metrics mismatch");
}

function validateRows(rows: readonly JointBattleDecisionObservationV1[], corpusAuthority: JointBattleDecisionCorpusV1["sourceAuthority"]): void {
  if (!rows.length || new Set(rows.map(row => `${row.decisionId}\0${row.candidateId}`)).size !== rows.length) throw new Error("Joint battle rows are empty or duplicated");
  const splitByFamily = new Map<string, JointBattleCorpusSplit>(), splitByCluster = new Map<string, JointBattleCorpusSplit>(), clusterByDecision = new Map<string, string>();
  for (const row of rows) {
    assertJointBattleCandidate(row.candidate);
    if (!row.decisionId || row.candidate.id !== row.candidateId || !row.familyId || !row.familyClusterId || !row.environment || !["train", "validation", "test"].includes(row.split) || !Number.isFinite(row.shortUtility) || row.shortUtility < -1 || row.shortUtility > 1 || ![0, .5, 1].includes(row.terminalUtility) || !between(row.uncertainty) || !between(row.terminalRisk) || !hex(row.sourceFingerprint) || !hex(row.branchFingerprint)) throw new Error(`Invalid joint battle row: ${row.decisionId}/${row.candidateId}`);
    if (corpusAuthority === "signed-research-family-corpus" && row.sourceAuthority !== "signed-research-family") throw new Error("Joint battle source authority mismatch");
    if (corpusAuthority === "synthetic-test" && row.sourceAuthority !== "synthetic-test") throw new Error("Joint battle synthetic authority mismatch");
    const familySplit = splitByFamily.get(row.familyId), clusterSplit = splitByCluster.get(row.familyClusterId), decisionCluster = clusterByDecision.get(row.decisionId);
    if (familySplit && familySplit !== row.split) throw new Error(`Joint battle family split leakage: ${row.familyId}`);
    if (clusterSplit && clusterSplit !== row.split) throw new Error(`Joint battle family-cluster split leakage: ${row.familyClusterId}`);
    if (decisionCluster && decisionCluster !== row.familyClusterId) throw new Error(`Joint battle decision crossed family clusters: ${row.decisionId}`);
    splitByFamily.set(row.familyId, row.split); splitByCluster.set(row.familyClusterId, row.split); clusterByDecision.set(row.decisionId, row.familyClusterId);
    if (row.legacySwitchAuxiliary && (row.split !== "train" || row.candidate.actionKind !== "switch" || row.legacySwitchAuxiliary.authority !== "switch-v3-auxiliary-training-only" || row.legacySwitchAuxiliary.encoderVersion !== "relational-switch-encoder-v1" || row.legacySwitchAuxiliary.validationEvidenceAllowed !== false || !hex(row.legacySwitchAuxiliary.sourceFingerprint))) throw new Error("Switch-only V3 evidence is auxiliary training data only");
  }
  if (!rows.some(row => row.candidate.actionKind === "move") || !rows.some(row => row.candidate.actionKind === "switch")) throw new Error("Joint battle corpus must contain move and switch candidates");
}

function buildMetrics(rows: readonly JointBattleDecisionObservationV1[]): JointBattleDecisionCorpusV1["metrics"] { return {decisions: new Set(rows.map(row => row.decisionId)).size, candidates: rows.length, moveCandidates: rows.filter(row => row.candidate.actionKind === "move").length, switchCandidates: rows.filter(row => row.candidate.actionKind === "switch").length, families: new Set(rows.map(row => row.familyId)).size, familyClusters: new Set(rows.map(row => row.familyClusterId)).size, legacyAuxiliaryCandidates: rows.filter(row => row.legacySwitchAuxiliary).length, splits: counts(rows.map(row => row.split))}; }
function counts(values: readonly string[]): Record<string, number> { const result: Record<string, number> = {}; for (const value of values) result[value] = (result[value] ?? 0) + 1; return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b))); }
function between(value: number): boolean { return Number.isFinite(value) && value >= 0 && value <= 1; }
function digest(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function hex(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
