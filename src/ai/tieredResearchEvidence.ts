export const TIERED_RESEARCH_EVIDENCE_POLICY = "stage4-tiered-evidence-v1" as const;

export function assertStage4FullEvidenceAdmission(summary: any): void {
  const policy = summary?.evidencePolicy, canary = summary?.qualityCanary;
  if (policy?.stage5Admission !== "full-only" || policy?.promotion !== "manager-selected-full-counterfactual" || policy?.trainingAuthority !== "screening-and-learning-only" || policy?.fullAuthority !== "exact-counterfactual-single-environment") throw new Error("Stage 5 requires the Stage-4 full-only evidence policy");
  if (canary?.outcomeParity !== true || canary?.researchDirectionStable !== true || canary?.hiddenInformationBoundary !== "verified-by-training-artifact-contract" || canary?.effectiveSampleRate !== 1 || !Number.isInteger(canary?.trainingExplorationBattles) || canary.trainingExplorationBattles < 1 || canary.trainingParityMatches !== canary.trainingExplorationBattles || canary.validTrainingSamples !== canary.trainingExplorationBattles || canary.fullReplicationBattles !== canary.trainingExplorationBattles * 2) throw new Error("Stage 5 requires a complete Stage-4 quality-equivalence canary");
}
