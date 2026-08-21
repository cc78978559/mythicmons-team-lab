import crypto from "node:crypto";
import path from "node:path";
import {JOINT_BATTLE_SHADOW_SOURCE_VERSION, type JointBattleShadowSourceAuthority} from "./jointBattleShadowCorpus";
import {RELATIONAL_BATTLE_ENCODER_VERSION, RELATIONAL_BATTLE_POLICY_VERSION} from "./relationalBattlePolicy";
import {UNIFIED_DECISION_RECORD_VERSION} from "../draft/unifiedDecisionRecord";

export const PRODUCTION_SHADOW_SOURCE_AUTHORITY_VERSION = "production-shadow-source-authority-v1" as const;

export interface ProductionShadowSourceAuthorityManifestV1 {
  schemaVersion: 1;
  version: typeof PRODUCTION_SHADOW_SOURCE_AUTHORITY_VERSION;
  authority: "production-shadow-source-authority-manifest";
  status: "proposed" | "approved";
  policyVersion: typeof RELATIONAL_BATTLE_POLICY_VERSION;
  sourceAuthority: JointBattleShadowSourceAuthority;
  lineage: {sourceSystem: string; sourceGeneration: string; purpose: "joint-shadow-corpus-extraction-only"; parentManifestSha256: string | null};
  recordContract: {version: typeof UNIFIED_DECISION_RECORD_VERSION; encoderVersion: typeof RELATIONAL_BATTLE_ENCODER_VERSION; schemaSha256: string};
  isolation: {informationModes: ["closed-sheet", "open-sheet"]; familyClusterModeIsolation: true; familySplitIsolation: true};
  input: {archive: string; archiveSha256: string; logicalSourceSha256: string};
  output: {root: string; retention: "retain-until-manual-safe-gc"; recovery: "stale-lock-and-orphan-temp-only"; overwrite: "reject-different-signed-archive"};
  signingAuthority: {id: string; scheme: "sha256-content-envelope"; approvalReferenceSha256: string};
  prohibitions: {trainingAllowed: false; routingAllowed: false; formalActivationAllowed: false; stage4EvidenceAllowed: false; stage5EvidenceAllowed: false; canaryAllowed: false};
  sha256: string;
}

export function productionShadowRecordSchemaSha256(): string { return digest({unifiedDecisionRecordVersion: UNIFIED_DECISION_RECORD_VERSION, policyVersion: RELATIONAL_BATTLE_POLICY_VERSION, encoderVersion: RELATIONAL_BATTLE_ENCODER_VERSION, sourceVersion: JOINT_BATTLE_SHADOW_SOURCE_VERSION, requiredBindings: ["decisionInputSha256", "jointRelationalSnapshot", "jointBattleShadow", "legacyFallback", "informationMode", "familyClusterId"]}); }

export function buildProductionShadowSourceAuthorityManifest(input: Omit<ProductionShadowSourceAuthorityManifestV1, "schemaVersion" | "version" | "authority" | "policyVersion" | "prohibitions" | "sha256">): ProductionShadowSourceAuthorityManifestV1 {
  const core = {schemaVersion: 1 as const, version: PRODUCTION_SHADOW_SOURCE_AUTHORITY_VERSION, authority: "production-shadow-source-authority-manifest" as const, policyVersion: RELATIONAL_BATTLE_POLICY_VERSION, ...structuredClone(input), prohibitions: {trainingAllowed: false as const, routingAllowed: false as const, formalActivationAllowed: false as const, stage4EvidenceAllowed: false as const, stage5EvidenceAllowed: false as const, canaryAllowed: false as const}};
  const manifest = {...core, sha256: digest(core)};
  assertProductionShadowSourceAuthorityManifest(manifest);
  return manifest;
}

export function assertProductionShadowSourceAuthorityManifest(manifest: ProductionShadowSourceAuthorityManifestV1): void {
  if (manifest.schemaVersion !== 1 || manifest.version !== PRODUCTION_SHADOW_SOURCE_AUTHORITY_VERSION || manifest.authority !== "production-shadow-source-authority-manifest" || manifest.policyVersion !== RELATIONAL_BATTLE_POLICY_VERSION || !["proposed", "approved"].includes(manifest.status) || !["signed-research-family-corpus", "synthetic-test"].includes(manifest.sourceAuthority)) throw new Error("Unsupported production shadow source authority manifest");
  const {sha256, ...core} = manifest;
  if (!hex(sha256) || digest(core) !== sha256) throw new Error("Production shadow source authority manifest signature mismatch");
  if (!manifest.lineage.sourceSystem.trim() || !manifest.lineage.sourceGeneration.trim() || manifest.lineage.purpose !== "joint-shadow-corpus-extraction-only" || manifest.lineage.parentManifestSha256 !== null && !hex(manifest.lineage.parentManifestSha256)) throw new Error("Invalid production shadow source lineage");
  if (manifest.recordContract.version !== UNIFIED_DECISION_RECORD_VERSION || manifest.recordContract.encoderVersion !== RELATIONAL_BATTLE_ENCODER_VERSION || manifest.recordContract.schemaSha256 !== productionShadowRecordSchemaSha256()) throw new Error("Production shadow record schema binding mismatch");
  if (manifest.isolation.informationModes.join("|") !== "closed-sheet|open-sheet" || manifest.isolation.familyClusterModeIsolation !== true || manifest.isolation.familySplitIsolation !== true) throw new Error("Production shadow isolation contract mismatch");
  if (!path.isAbsolute(manifest.input.archive) || !hex(manifest.input.archiveSha256) || !hex(manifest.input.logicalSourceSha256) || !path.isAbsolute(manifest.output.root) || manifest.output.retention !== "retain-until-manual-safe-gc" || manifest.output.recovery !== "stale-lock-and-orphan-temp-only" || manifest.output.overwrite !== "reject-different-signed-archive") throw new Error("Production shadow archive or output policy mismatch");
  if (!manifest.signingAuthority.id.trim() || manifest.signingAuthority.scheme !== "sha256-content-envelope" || !hex(manifest.signingAuthority.approvalReferenceSha256)) throw new Error("Invalid production shadow signing authority");
  if (Object.values(manifest.prohibitions).some(Boolean)) throw new Error("Production shadow authority attempted to grant a prohibited capability");
}

export function assertApprovedProductionShadowSourceAuthority(manifest: ProductionShadowSourceAuthorityManifestV1, expected: {inputArchive: string; inputArchiveSha256: string; logicalSourceSha256: string; outputRoot: string; sourceAuthority: JointBattleShadowSourceAuthority; signingAuthority: string}): void {
  assertProductionShadowSourceAuthorityManifest(manifest);
  if (manifest.status !== "approved") throw new Error("Production shadow source authority manifest is not approved");
  if (path.normalize(manifest.input.archive) !== path.normalize(expected.inputArchive) || manifest.input.archiveSha256 !== expected.inputArchiveSha256 || manifest.input.logicalSourceSha256 !== expected.logicalSourceSha256 || path.normalize(manifest.output.root) !== path.normalize(expected.outputRoot) || manifest.sourceAuthority !== expected.sourceAuthority || manifest.signingAuthority.id !== expected.signingAuthority) throw new Error("Production shadow source authority binding mismatch");
}

function digest(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function hex(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
