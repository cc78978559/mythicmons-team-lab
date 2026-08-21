import {assertJointBattleDecisionSnapshot, recommendJointBattleShadow, type JointBattleDecisionSnapshotV1, type JointBattleShadowRecommendation} from "./relationalBattlePolicy";
import {assertUnifiedDecisionRecord, decisionInputProjection, type UnifiedDecisionRecord} from "../draft/unifiedDecisionRecord";

export const RELATIONAL_BATTLE_SHADOW_ACCEPTANCE_VERSION = "relational-battle-shadow-acceptance-v1" as const;

export interface RelationalBattleShadowAcceptanceSummary {
  schemaVersion: 1;
  version: typeof RELATIONAL_BATTLE_SHADOW_ACCEPTANCE_VERSION;
  authority: "read-only-shadow-diagnostic";
  activationStatus: "shadow-only";
  formalActivationAllowed: false;
  records: number;
  accepted: number;
  rejected: number;
  candidates: {move: number; switch: number};
  informationModes: {openSheet: number; closedSheet: number};
  recommendations: {diagnostic: number; legacyFallback: number};
  healthy: boolean;
  issues: Array<{code: string; count: number}>;
}

export function auditRelationalBattleShadowRecords(records: readonly UnifiedDecisionRecord[]): RelationalBattleShadowAcceptanceSummary {
  const counts = new Map<string, number>(), candidates = {move: 0, switch: 0}, informationModes = {openSheet: 0, closedSheet: 0}, recommendations = {diagnostic: 0, legacyFallback: 0};
  if (!records.length) counts.set("shadow-no-records", 1);
  let accepted = 0;
  for (const record of records) {
    try {
      const {snapshot, recommendation} = assertShadowRecord(record);
      accepted += 1;
      for (const candidate of snapshot.candidates) candidates[candidate.actionKind] += 1;
      informationModes[snapshot.informationMode === "open-sheet" ? "openSheet" : "closedSheet"] += 1;
      recommendations.diagnostic += 1;
      if (recommendation.usedLegacyFallback) recommendations.legacyFallback += 1;
    } catch (error) {
      const code = issueCode(error);
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  const issues = [...counts].map(([code, count]) => ({code, count})).sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
  return {schemaVersion: 1, version: RELATIONAL_BATTLE_SHADOW_ACCEPTANCE_VERSION, authority: "read-only-shadow-diagnostic", activationStatus: "shadow-only", formalActivationAllowed: false, records: records.length, accepted, rejected: records.length - accepted, candidates, informationModes, recommendations, healthy: issues.length === 0, issues};
}

function assertShadowRecord(record: UnifiedDecisionRecord): {snapshot: JointBattleDecisionSnapshotV1; recommendation: JointBattleShadowRecommendation} {
  assertUnifiedDecisionRecord(record);
  if (record.domain !== "battle" || record.information.timing !== "contemporaneous") throw new Error("shadow-wrong-domain");
  if (containsJointDiagnostic(decisionInputProjection(record))) throw new Error("shadow-input-leakage");
  const snapshot = record.provenance.jointRelationalSnapshot as JointBattleDecisionSnapshotV1 | null | undefined;
  const recommendation = record.provenance.jointBattleShadow as JointBattleShadowRecommendation | null | undefined;
  if (!snapshot || !recommendation) throw new Error("shadow-missing-diagnostic");
  assertJointBattleDecisionSnapshot(snapshot);
  if (snapshot.informationMode !== record.information.mode) throw new Error("shadow-information-mode-mismatch");
  const optionIds = record.options.map(option => option.id).sort(), candidateIds = snapshot.candidates.map(candidate => candidate.id).sort();
  if (JSON.stringify(optionIds) !== JSON.stringify(candidateIds)) throw new Error("shadow-candidate-incomplete");
  if (typeof record.selected !== "string" || record.selected !== snapshot.legacyFallback.candidateId) throw new Error("shadow-legacy-selection-mismatch");
  const expected = recommendJointBattleShadow(snapshot);
  if (JSON.stringify(expected) !== JSON.stringify(recommendation)) throw new Error("shadow-recommendation-mismatch");
  if (recommendation.routingAllowed !== false || recommendation.formalActivationAllowed !== false || snapshot.modeAuxiliary && snapshot.modeAuxiliary.routingAllowed !== false) throw new Error("shadow-routing-enabled");
  return {snapshot, recommendation};
}

function containsJointDiagnostic(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsJointDiagnostic);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => key === "jointRelationalSnapshot" || key === "jointBattleShadow" || containsJointDiagnostic(child));
}

function issueCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("shadow-")) return message;
  if (/known mask|Unknown joint battle feature|Unknown joint battle feature must be zero/i.test(message)) return "shadow-known-mask-invalid";
  if (/Joint battle .*signature mismatch/i.test(message)) return "shadow-snapshot-signature-invalid";
  if (/Unified decision .*signature mismatch/i.test(message)) return "shadow-record-signature-invalid";
  if (/Unsupported joint battle decision snapshot/i.test(message)) return "shadow-snapshot-contract-invalid";
  if (/Unsupported unified decision record/i.test(message)) return "shadow-record-contract-invalid";
  return "shadow-contract-invalid";
}
