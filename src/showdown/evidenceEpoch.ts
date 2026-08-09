import crypto from "node:crypto";
import {LEAGUE_MECHANICS} from "./mechanics";

export const EVIDENCE_EPOCH_POLICY_VERSION = "evidence-epoch-v2";
export const LEAGUE_CONFIGURATION_POLICY_VERSION = "league-configuration-v1";

export interface EvidenceContext {
  registryHash?: string | null;
  configurationPolicyVersion?: string | null;
}

export interface EvidenceEpoch {
  schemaVersion: 1;
  policyVersion: "evidence-epoch-v1" | typeof EVIDENCE_EPOCH_POLICY_VERSION;
  battlePolicy: {
    aiVersion: string;
    showdownVersion: string;
    mechanics: typeof LEAGUE_MECHANICS;
    stateEncoderVersion: "showdown-request-state-v1" | "position-snapshot-v1";
    candidateGeneratorVersion: string;
    outcomeLabelVersion: "terminal-or-max-turn-adjudication-v1";
  };
  policySha256: string;
  content: {
    format: string;
    formatSha256: string;
    sandboxModId: string;
    registryHash: string | null;
    configurationPolicyVersion: string | null;
  };
  contentSha256: string;
  epochSha256: string;
  formalContextComplete: boolean;
  missingFormalContext: string[];
}

export type EvidenceEpochCompatibility = "exact-compatible" | "transferable-prior" | "historical-only" | "invalid";

export interface EvidenceEpochClassification {
  compatibility: EvidenceEpochCompatibility;
  reason: string;
  formalActivationAllowed: boolean;
}

export function buildEvidenceEpoch(aiVersion: string, format: string, context: EvidenceContext = {}): EvidenceEpoch {
  const battlePolicy: EvidenceEpoch["battlePolicy"] = {
    aiVersion,
    showdownVersion: showdownVersion(),
    mechanics: {...LEAGUE_MECHANICS},
    stateEncoderVersion: "position-snapshot-v1",
    candidateGeneratorVersion: aiVersion,
    outcomeLabelVersion: "terminal-or-max-turn-adjudication-v1",
  };
  const policySha256 = sha256({policyVersion: EVIDENCE_EPOCH_POLICY_VERSION, battlePolicy});
  const registryHash = normalizeOptionalValue(context.registryHash);
  const configurationPolicyVersion = normalizeOptionalValue(context.configurationPolicyVersion);
  const content: EvidenceEpoch["content"] = {
    format,
    formatSha256: sha256(format),
    sandboxModId: format.split("@@@", 1)[0].trim().toLowerCase(),
    registryHash,
    configurationPolicyVersion,
  };
  const contentSha256 = sha256(content);
  const missingFormalContext = [
    ...(!registryHash ? ["registryHash"] : []),
    ...(!configurationPolicyVersion ? ["configurationPolicyVersion"] : []),
  ];
  const core = {schemaVersion: 1 as const, policyVersion: EVIDENCE_EPOCH_POLICY_VERSION as typeof EVIDENCE_EPOCH_POLICY_VERSION, battlePolicy, policySha256, content, contentSha256};
  return {
    ...core,
    epochSha256: sha256(core),
    formalContextComplete: missingFormalContext.length === 0,
    missingFormalContext,
  };
}

export function validateEvidenceEpoch(epoch: EvidenceEpoch): string[] {
  if (!epoch || epoch.schemaVersion !== 1 || !["evidence-epoch-v1", EVIDENCE_EPOCH_POLICY_VERSION].includes(epoch.policyVersion)) return ["unsupported evidence epoch schema or policy"];
  const errors: string[] = [], policySha256 = sha256({policyVersion: epoch.policyVersion, battlePolicy: epoch.battlePolicy}), contentSha256 = sha256(epoch.content);
  const core = {schemaVersion: 1 as const, policyVersion: epoch.policyVersion, battlePolicy: epoch.battlePolicy, policySha256, content: epoch.content, contentSha256};
  const missingFormalContext = [...(!epoch.content.registryHash ? ["registryHash"] : []), ...(!epoch.content.configurationPolicyVersion ? ["configurationPolicyVersion"] : [])];
  if (epoch.policySha256 !== policySha256) errors.push("policy signature mismatch");
  if (epoch.contentSha256 !== contentSha256) errors.push("content signature mismatch");
  if (epoch.epochSha256 !== sha256(core)) errors.push("epoch signature mismatch");
  if (epoch.formalContextComplete !== (missingFormalContext.length === 0) || canonicalJson(epoch.missingFormalContext) !== canonicalJson(missingFormalContext)) errors.push("formal context declaration mismatch");
  return errors;
}

export function classifyEvidenceEpoch(epoch: EvidenceEpoch | null | undefined, expected: EvidenceEpoch): EvidenceEpochClassification {
  if (!epoch) return {compatibility: "historical-only", reason: "missing evidence epoch", formalActivationAllowed: false};
  const errors = validateEvidenceEpoch(epoch);
  if (errors.length) return {compatibility: "invalid", reason: errors.join("; "), formalActivationAllowed: false};
  if (epoch.policySha256 !== expected.policySha256) return {compatibility: "historical-only", reason: "battle policy differs from the current evidence era", formalActivationAllowed: false};
  if (epoch.contentSha256 !== expected.contentSha256) return {compatibility: "transferable-prior", reason: "policy matches but formal content context differs", formalActivationAllowed: false};
  if (!epoch.formalContextComplete) return {compatibility: "exact-compatible", reason: `formal context incomplete: ${epoch.missingFormalContext.join(", ")}`, formalActivationAllowed: false};
  return {compatibility: "exact-compatible", reason: "policy and content signatures match", formalActivationAllowed: true};
}

export function sha256(value: unknown): string {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeOptionalValue(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.toLowerCase() !== "live" ? normalized : null;
}

function showdownVersion(): string {
  const value = (require("pokemon-showdown/package.json") as {version?: unknown}).version;
  if (typeof value !== "string" || !value.trim()) throw new Error("Unable to determine Pokemon Showdown version");
  return value.trim();
}
