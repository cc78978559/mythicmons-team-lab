import crypto from "node:crypto";
import {assertJointBattleDecisionCorpus, buildJointBattleDecisionCorpus, type JointBattleCorpusSplit, type JointBattleDecisionCorpusV1, type JointBattleDecisionObservationV1} from "./jointBattleDecisionCorpus";
import {auditRelationalBattleShadowRecords, type RelationalBattleShadowAcceptanceSummary} from "./relationalBattleShadowAcceptance";
import type {JointBattleDecisionSnapshotV1} from "./relationalBattlePolicy";
import type {UnifiedDecisionRecord} from "../draft/unifiedDecisionRecord";

export const JOINT_BATTLE_SHADOW_SOURCE_VERSION = "joint-battle-shadow-source-v1" as const;
export const JOINT_BATTLE_SHADOW_ARCHIVE_VERSION = "joint-battle-shadow-corpus-archive-v1" as const;
export type JointBattleShadowSourceAuthority = "signed-research-family-corpus" | "synthetic-test";

export interface JointBattleShadowSourceCandidateLabel {
  candidateId: string;
  shortUtility: number;
  terminalUtility: 0 | .5 | 1;
  uncertainty: number;
  terminalRisk: number;
  branchFingerprint: string;
}

export interface JointBattleShadowSourceEntry {
  record: UnifiedDecisionRecord;
  familyId: string;
  familyClusterId: string;
  environment: string;
  split: JointBattleCorpusSplit;
  sourceFingerprint: string;
  labels: JointBattleShadowSourceCandidateLabel[];
}

export interface JointBattleShadowSourceV1 {
  schemaVersion: 1;
  version: typeof JOINT_BATTLE_SHADOW_SOURCE_VERSION;
  authority: "signed-joint-shadow-source";
  activationStatus: "shadow-only";
  formalActivationAllowed: false;
  sourceAuthority: JointBattleShadowSourceAuthority;
  entries: JointBattleShadowSourceEntry[];
  sha256: string;
}

export interface JointBattleShadowCorpusArchiveV1 {
  schemaVersion: 1;
  version: typeof JOINT_BATTLE_SHADOW_ARCHIVE_VERSION;
  authority: "joint-shadow-corpus-extraction";
  activationStatus: "shadow-only";
  formalActivationAllowed: false;
  routingAllowed: false;
  sourceSha256: string;
  authorityManifestSha256: string;
  acceptance: RelationalBattleShadowAcceptanceSummary;
  informationModes: {openSheet: number; closedSheet: number};
  corpus: JointBattleDecisionCorpusV1;
  sha256: string;
}

export function buildJointBattleShadowSource(entries: readonly JointBattleShadowSourceEntry[], sourceAuthority: JointBattleShadowSourceAuthority): JointBattleShadowSourceV1 {
  const normalized = normalizeEntries(entries), core = {schemaVersion: 1 as const, version: JOINT_BATTLE_SHADOW_SOURCE_VERSION, authority: "signed-joint-shadow-source" as const, activationStatus: "shadow-only" as const, formalActivationAllowed: false as const, sourceAuthority, entries: normalized};
  const source = {...core, sha256: digest(core)};
  assertJointBattleShadowSource(source);
  return source;
}

export function assertJointBattleShadowSource(source: JointBattleShadowSourceV1): void {
  if (source.schemaVersion !== 1 || source.version !== JOINT_BATTLE_SHADOW_SOURCE_VERSION || source.authority !== "signed-joint-shadow-source" || source.activationStatus !== "shadow-only" || source.formalActivationAllowed !== false || !["signed-research-family-corpus", "synthetic-test"].includes(source.sourceAuthority)) throw new Error("Unsupported joint battle shadow source");
  const {sha256, ...core} = source;
  if (!hex(sha256) || digest(core) !== sha256) throw new Error("Joint battle shadow source signature mismatch");
  const normalized = normalizeEntries(source.entries);
  if (JSON.stringify(normalized) !== JSON.stringify(source.entries)) throw new Error("Joint battle shadow source is not canonical");
  const acceptance = auditRelationalBattleShadowRecords(source.entries.map(entry => entry.record));
  if (!acceptance.healthy) throw new Error(`Joint battle shadow source record acceptance failed: ${acceptance.issues.map(issue => issue.code).join(",")}`);
  validateAuthority(source);
}

export function extractJointBattleShadowCorpus(source: JointBattleShadowSourceV1, authorityManifestSha256: string): JointBattleShadowCorpusArchiveV1 {
  assertJointBattleShadowSource(source);
  if (!hex(authorityManifestSha256)) throw new Error("Joint battle shadow corpus requires a signed authority manifest");
  const acceptance = auditRelationalBattleShadowRecords(source.entries.map(entry => entry.record));
  if (!acceptance.healthy) throw new Error(`Joint battle shadow record acceptance failed: ${acceptance.issues.map(issue => issue.code).join(",")}`);
  const rows = source.entries.flatMap(entry => rowsFromEntry(entry, source.sourceAuthority)), corpus = buildJointBattleDecisionCorpus(rows, source.sourceAuthority);
  const informationModes = {openSheet: source.entries.filter(entry => informationMode(entry) === "open-sheet").length, closedSheet: source.entries.filter(entry => informationMode(entry) === "closed-sheet").length};
  const core = {schemaVersion: 1 as const, version: JOINT_BATTLE_SHADOW_ARCHIVE_VERSION, authority: "joint-shadow-corpus-extraction" as const, activationStatus: "shadow-only" as const, formalActivationAllowed: false as const, routingAllowed: false as const, sourceSha256: source.sha256, authorityManifestSha256, acceptance, informationModes, corpus};
  const archive = {...core, sha256: digest(core)};
  assertJointBattleShadowCorpusArchive(archive);
  return archive;
}

export function assertJointBattleShadowCorpusArchive(archive: JointBattleShadowCorpusArchiveV1): void {
  if (archive.schemaVersion !== 1 || archive.version !== JOINT_BATTLE_SHADOW_ARCHIVE_VERSION || archive.authority !== "joint-shadow-corpus-extraction" || archive.activationStatus !== "shadow-only" || archive.formalActivationAllowed !== false || archive.routingAllowed !== false || !hex(archive.sourceSha256) || !hex(archive.authorityManifestSha256)) throw new Error("Unsupported joint battle shadow corpus archive");
  const {sha256, ...core} = archive;
  if (!hex(sha256) || digest(core) !== sha256) throw new Error("Joint battle shadow corpus archive signature mismatch");
  assertJointBattleDecisionCorpus(archive.corpus);
  if (!archive.acceptance.healthy || archive.acceptance.records < 1 || archive.acceptance.accepted !== archive.acceptance.records || archive.acceptance.rejected !== 0) throw new Error("Joint battle shadow corpus archive has unhealthy acceptance");
  const expected = {openSheet: new Set(archive.corpus.rows.filter(row => row.informationMode === "open-sheet").map(row => row.decisionId)).size, closedSheet: new Set(archive.corpus.rows.filter(row => row.informationMode === "closed-sheet").map(row => row.decisionId)).size};
  if (JSON.stringify(expected) !== JSON.stringify(archive.informationModes)) throw new Error("Joint battle shadow corpus mode metrics mismatch");
}

function rowsFromEntry(entry: JointBattleShadowSourceEntry, authority: JointBattleShadowSourceAuthority): JointBattleDecisionObservationV1[] {
  const snapshot = entry.record.provenance.jointRelationalSnapshot as JointBattleDecisionSnapshotV1, labels = new Map(entry.labels.map(label => [label.candidateId, label])), mode = informationMode(entry);
  return snapshot.candidates.map(candidate => {
    const label = labels.get(candidate.id)!;
    return {decisionId: entry.record.decisionId, candidateId: candidate.id, familyId: entry.familyId, familyClusterId: entry.familyClusterId, environment: entry.environment, informationMode: mode, split: entry.split, candidate: structuredClone(candidate), shortUtility: label.shortUtility, terminalUtility: label.terminalUtility, uncertainty: label.uncertainty, terminalRisk: label.terminalRisk, sourceAuthority: authority === "synthetic-test" ? "synthetic-test" : "signed-research-family", sourceFingerprint: entry.sourceFingerprint, branchFingerprint: label.branchFingerprint};
  });
}

function normalizeEntries(entries: readonly JointBattleShadowSourceEntry[]): JointBattleShadowSourceEntry[] {
  if (!entries.length || new Set(entries.map(entry => entry.record.decisionId)).size !== entries.length) throw new Error("Joint battle shadow source records are empty or duplicated");
  const normalized = entries.map(entry => ({...structuredClone(entry), familyId: entry.familyId.trim(), familyClusterId: entry.familyClusterId.trim(), environment: entry.environment.trim(), labels: [...entry.labels].map(label => ({...label})).sort((a, b) => a.candidateId.localeCompare(b.candidateId))})).sort((a, b) => a.record.decisionId.localeCompare(b.record.decisionId));
  const familyModes = new Map<string, string>(), clusterModes = new Map<string, string>();
  for (const entry of normalized) {
    if (!entry.familyId || !entry.familyClusterId || !entry.environment || !["train", "validation", "test"].includes(entry.split) || !hex(entry.sourceFingerprint)) throw new Error(`Invalid joint battle shadow source entry: ${entry.record.decisionId}`);
    const snapshot = entry.record.provenance.jointRelationalSnapshot as JointBattleDecisionSnapshotV1 | undefined;
    if (!snapshot) throw new Error(`Missing joint battle shadow snapshot: ${entry.record.decisionId}`);
    const mode = String(snapshot.informationMode);
    if (!["open-sheet", "closed-sheet"].includes(mode)) throw new Error(`Invalid joint battle shadow information mode: ${entry.record.decisionId}`);
    const candidateIds = snapshot.candidates.map(candidate => candidate.id).sort(), labelIds = entry.labels.map(label => label.candidateId).sort();
    if (new Set(labelIds).size !== labelIds.length || JSON.stringify(candidateIds) !== JSON.stringify(labelIds)) throw new Error(`Joint battle shadow labels are incomplete: ${entry.record.decisionId}`);
    for (const label of entry.labels) if (!Number.isFinite(label.shortUtility) || label.shortUtility < -1 || label.shortUtility > 1 || ![0, .5, 1].includes(label.terminalUtility) || !between(label.uncertainty) || !between(label.terminalRisk) || !hex(label.branchFingerprint)) throw new Error(`Invalid joint battle shadow label: ${entry.record.decisionId}/${label.candidateId}`);
    if (familyModes.has(entry.familyId) && familyModes.get(entry.familyId) !== mode) throw new Error(`Joint battle shadow family crossed information modes: ${entry.familyId}`);
    if (clusterModes.has(entry.familyClusterId) && clusterModes.get(entry.familyClusterId) !== mode) throw new Error(`Joint battle shadow family-cluster crossed information modes: ${entry.familyClusterId}`);
    familyModes.set(entry.familyId, mode); clusterModes.set(entry.familyClusterId, mode);
  }
  return normalized;
}

function validateAuthority(source: JointBattleShadowSourceV1): void {
  if (source.sourceAuthority === "synthetic-test" && source.entries.some(entry => !entry.sourceFingerprint)) throw new Error("Invalid synthetic joint battle shadow authority");
}
function informationMode(entry: JointBattleShadowSourceEntry): "open-sheet" | "closed-sheet" { return (entry.record.provenance.jointRelationalSnapshot as JointBattleDecisionSnapshotV1).informationMode; }
function between(value: number): boolean { return Number.isFinite(value) && value >= 0 && value <= 1; }
function digest(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function hex(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
