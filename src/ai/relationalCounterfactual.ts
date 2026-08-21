import crypto from "node:crypto";
import type {AiDecisionTrace} from "../showdown/choice";
import type {BattleResult} from "../showdown/battle";
import {predictPairedPositionValue, type PositionValueModel} from "./positionValue";
import {assertRelationalDecisionCandidate, assertRelationalDecisionSnapshot, RELATIONAL_ENCODER_VERSION, type RelationalDecisionCandidateV1} from "./relationalDecision";
import type {RelationalCandidateSampleV3} from "./managerProgramV3";

export const RELATIONAL_COUNTERFACTUAL_CORPUS_VERSION = "relational-counterfactual-corpus-v1" as const;

export interface RelationalBranchObservation {
  decisionId: string;
  candidateId: string;
  familyId: string;
  clusterId: string;
  environment: string;
  split: RelationalCandidateSampleV3["split"];
  candidate: RelationalDecisionCandidateV1;
  relationValues?: Record<string, number[]>;
  incumbentSearchScore: number;
  shortUtility: number;
  terminalUtility: 0 | .5 | 1;
  sourceFingerprint: string;
  branchFingerprint: string;
}

export interface RelationalCounterfactualCorpusV1 {
  schemaVersion: 1;
  version: typeof RELATIONAL_COUNTERFACTUAL_CORPUS_VERSION;
  encoderVersion: typeof RELATIONAL_ENCODER_VERSION;
  authority: "training-dual-horizon-exact-counterfactual";
  shortHorizonTeacher: {modelSha256: string; evaluationSha256: string; authority: "qualified-stage2" | "exploratory-unqualified" | "synthetic-test"; vsLegacyLogLossPercent: number; bootstrapProbabilityBetterThanLegacy: number};
  columns: {
    decisionId: string[]; candidateId: string[]; familyId: string[]; clusterId: string[]; environment: string[]; split: RelationalCandidateSampleV3["split"][];
    candidate: RelationalDecisionCandidateV1[]; relationValues: Record<string, number[]>[]; incumbentSearchScore: number[]; shortUtility: number[]; terminalUtility: Array<0 | .5 | 1>; sourceFingerprint: string[]; branchFingerprint: string[];
  };
  metrics: {decisions: number; candidates: number; families: number; clusters: number; environments: Record<string, number>; splits: Record<string, number>};
  sha256: string;
}

export function buildRelationalCounterfactualCorpus(rows: readonly RelationalBranchObservation[], shortHorizonTeacher: RelationalCounterfactualCorpusV1["shortHorizonTeacher"]): RelationalCounterfactualCorpusV1 {
  validateRows(rows);
  const ordered = [...rows].sort((a, b) => a.decisionId.localeCompare(b.decisionId) || a.candidateId.localeCompare(b.candidateId));
  const columns: RelationalCounterfactualCorpusV1["columns"] = {
    decisionId: ordered.map(row => row.decisionId), candidateId: ordered.map(row => row.candidateId), familyId: ordered.map(row => row.familyId), clusterId: ordered.map(row => row.clusterId), environment: ordered.map(row => row.environment), split: ordered.map(row => row.split), candidate: ordered.map(row => structuredClone(row.candidate)), relationValues: ordered.map(row => structuredClone(row.relationValues ?? {})), incumbentSearchScore: ordered.map(row => round(row.incumbentSearchScore)), shortUtility: ordered.map(row => round(row.shortUtility)), terminalUtility: ordered.map(row => row.terminalUtility), sourceFingerprint: ordered.map(row => row.sourceFingerprint), branchFingerprint: ordered.map(row => row.branchFingerprint),
  };
  const metrics = {decisions: new Set(columns.decisionId).size, candidates: ordered.length, families: new Set(columns.familyId).size, clusters: new Set(columns.clusterId).size, environments: counts(columns.environment), splits: counts(columns.split)};
  if (!hex(shortHorizonTeacher.modelSha256) || !hex(shortHorizonTeacher.evaluationSha256) || !Number.isFinite(shortHorizonTeacher.vsLegacyLogLossPercent) || shortHorizonTeacher.bootstrapProbabilityBetterThanLegacy < 0 || shortHorizonTeacher.bootstrapProbabilityBetterThanLegacy > 1) throw new Error("Invalid relational short-horizon teacher binding");
  const core = {schemaVersion: 1 as const, version: RELATIONAL_COUNTERFACTUAL_CORPUS_VERSION, encoderVersion: RELATIONAL_ENCODER_VERSION, authority: "training-dual-horizon-exact-counterfactual" as const, shortHorizonTeacher: {...shortHorizonTeacher}, columns, metrics};
  const corpus: RelationalCounterfactualCorpusV1 = {...core, sha256: digest(core)};
  assertRelationalCounterfactualCorpus(corpus);
  return corpus;
}

export function relationalCounterfactualSamples(corpus: RelationalCounterfactualCorpusV1): RelationalCandidateSampleV3[] {
  assertRelationalCounterfactualCorpus(corpus);
  return corpus.columns.decisionId.map((decisionId, index) => ({decisionId, candidateId: corpus.columns.candidateId[index], familyId: corpus.columns.familyId[index], clusterId: corpus.columns.clusterId[index], environment: corpus.columns.environment[index], split: corpus.columns.split[index], candidate: structuredClone(corpus.columns.candidate[index]), relationValues: structuredClone(corpus.columns.relationValues[index]), incumbentSearchScore: corpus.columns.incumbentSearchScore[index], shortUtility: corpus.columns.shortUtility[index], terminalUtility: corpus.columns.terminalUtility[index]}));
}

export function assertRelationalCounterfactualCorpus(corpus: RelationalCounterfactualCorpusV1): void {
  if (corpus.schemaVersion !== 1 || corpus.version !== RELATIONAL_COUNTERFACTUAL_CORPUS_VERSION || corpus.encoderVersion !== RELATIONAL_ENCODER_VERSION || corpus.authority !== "training-dual-horizon-exact-counterfactual" || !corpus.shortHorizonTeacher) throw new Error("Unsupported relational counterfactual corpus");
  const {sha256, ...core} = corpus; if (!hex(sha256) || digest(core) !== sha256) throw new Error("Relational counterfactual corpus signature mismatch");
  const lengths = Object.values(corpus.columns).map(column => column.length); if (!lengths.length || new Set(lengths).size !== 1) throw new Error("Relational counterfactual columns are misaligned");
  const rows = relationalRowsWithoutRecursiveValidation(corpus); validateRows(rows);
  if (corpus.metrics.decisions !== new Set(corpus.columns.decisionId).size || corpus.metrics.candidates !== lengths[0] || corpus.metrics.families !== new Set(corpus.columns.familyId).size || corpus.metrics.clusters !== new Set(corpus.columns.clusterId).size || JSON.stringify(corpus.metrics.environments) !== JSON.stringify(counts(corpus.columns.environment)) || JSON.stringify(corpus.metrics.splits) !== JSON.stringify(counts(corpus.columns.split))) throw new Error("Relational counterfactual metrics mismatch");
}

export function deriveDualHorizonUtility(input: {traces: readonly AiDecisionTrace[]; controlledPlayer: "p1" | "p2"; interventionOrdinal: number; result: Pick<BattleResult, "winner" | "ended">; model: PositionValueModel}): {shortUtility: number; terminalUtility: 0 | .5 | 1; checkpoint: "third-controlled-decision" | "terminal"} {
  const terminalUtility = outcomeUtility(input.result.winner, input.controlledPlayer);
  const start = input.traces.findIndex(trace => trace.decisionOrdinal === input.interventionOrdinal && trace.playerId === input.controlledPlayer);
  if (start < 0) throw new Error("Dual-horizon intervention trace is missing");
  const ownLater = input.traces.slice(start + 1).filter(trace => trace.playerId === input.controlledPlayer && trace.positionSnapshot);
  const own = ownLater[2];
  if (!own?.positionSnapshot) return {shortUtility: terminalUtility * 2 - 1, terminalUtility, checkpoint: "terminal"};
  const opponentId = input.controlledPlayer === "p1" ? "p2" : "p1";
  const opponent = [...input.traces].reverse().find(trace => trace.playerId === opponentId && trace.positionSnapshot && trace.turn <= own.turn);
  if (!opponent?.positionSnapshot) throw new Error("Dual-horizon opponent checkpoint is missing");
  return {shortUtility: round(predictPairedPositionValue(own.positionSnapshot, opponent.positionSnapshot, input.model, undefined, undefined, own.relationalSnapshot, opponent.relationalSnapshot) * 2 - 1), terminalUtility, checkpoint: "third-controlled-decision"};
}

export function branchRelationValues(trace: AiDecisionTrace, candidateId: string): Record<string, number[]> {
  const snapshot = trace.relationalSnapshot; if (!snapshot) throw new Error("V3 relation snapshot is absent from branch source"); assertRelationalDecisionSnapshot(snapshot);
  const candidateNode = `candidate:${candidateId}`;
  return Object.fromEntries(["takes-response", "threatens", "speed-relation", "type-relation", "role-coverage", "enters-field"].map(kind => [`edges.${kind}`, snapshot.edges.filter(edge => edge.source === candidateNode && edge.kind === kind && edge.known).map(edge => edge.value)]));
}

export function familySplit(familyIds: readonly string[], declared?: string): RelationalCandidateSampleV3["split"] {
  if (declared === "train" || declared === "validation" || declared === "test") return declared;
  if (declared === "holdout" || declared === "formal") return "formal";
  const bucket = Number.parseInt(digest([...familyIds].sort()).slice(0, 8), 16) % 100;
  return bucket < 70 ? "train" : bucket < 85 ? "validation" : "test";
}

function validateRows(rows: readonly RelationalBranchObservation[]): void {
  if (!rows.length || new Set(rows.map(row => `${row.decisionId}\0${row.candidateId}`)).size !== rows.length) throw new Error("Relational counterfactual rows are empty or duplicated");
  const splitByFamily = new Map<string, string>();
  for (const row of rows) {
    assertRelationalDecisionCandidate(row.candidate);
    if (!row.decisionId || !row.candidateId || row.candidate.id !== row.candidateId || row.candidate.actionKind !== "switch" || !row.familyId || !row.clusterId || !row.environment || !["train", "validation", "test", "formal"].includes(row.split) || !Number.isFinite(row.incumbentSearchScore) || !Number.isFinite(row.shortUtility) || row.shortUtility < -1 || row.shortUtility > 1 || ![0, .5, 1].includes(row.terminalUtility) || !hex(row.sourceFingerprint) || !hex(row.branchFingerprint)) throw new Error(`Invalid relational counterfactual row: ${row.decisionId}/${row.candidateId}`);
    const prior = splitByFamily.get(row.familyId); if (prior && prior !== row.split) throw new Error(`Family split leakage: ${row.familyId}`); splitByFamily.set(row.familyId, row.split);
  }
  const decisionClusters = new Map<string, Set<string>>(); for (const row of rows) { const values = decisionClusters.get(row.decisionId) ?? new Set(); values.add(`${row.clusterId}:${row.split}`); decisionClusters.set(row.decisionId, values); }
  if ([...decisionClusters.values()].some(values => values.size !== 1)) throw new Error("Candidate cluster crossed a corpus split");
}

function relationalRowsWithoutRecursiveValidation(corpus: RelationalCounterfactualCorpusV1): RelationalBranchObservation[] { return corpus.columns.decisionId.map((decisionId, index) => ({decisionId, candidateId: corpus.columns.candidateId[index], familyId: corpus.columns.familyId[index], clusterId: corpus.columns.clusterId[index], environment: corpus.columns.environment[index], split: corpus.columns.split[index], candidate: corpus.columns.candidate[index], relationValues: corpus.columns.relationValues[index], incumbentSearchScore: corpus.columns.incumbentSearchScore[index], shortUtility: corpus.columns.shortUtility[index], terminalUtility: corpus.columns.terminalUtility[index], sourceFingerprint: corpus.columns.sourceFingerprint[index], branchFingerprint: corpus.columns.branchFingerprint[index]})); }
function outcomeUtility(winner: string | null, playerId: "p1" | "p2"): 0 | .5 | 1 { if (!winner) return .5; const own = playerId === "p1" ? "Team A" : "Team B"; return winner === own ? 1 : 0; }
function counts(values: readonly string[]): Record<string, number> { const result: Record<string, number> = {}; for (const value of values) result[value] = (result[value] ?? 0) + 1; return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b))); }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function digest(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function hex(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
