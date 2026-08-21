import assert from "node:assert/strict";
import {assertStage4FullEvidenceAdmission, TIERED_RESEARCH_EVIDENCE_POLICY} from "../ai/tieredResearchEvidence";

const summary = {
  evidencePolicy: {
    id: TIERED_RESEARCH_EVIDENCE_POLICY,
    stage5Admission: "full-only",
    promotion: "manager-selected-full-counterfactual",
    trainingAuthority: "screening-and-learning-only",
    fullAuthority: "exact-counterfactual-single-environment",
  },
  qualityCanary: {
    outcomeParity: true,
    researchDirectionStable: true,
    hiddenInformationBoundary: "verified-by-training-artifact-contract",
    effectiveSampleRate: 1,
    trainingExplorationBattles: 8,
    trainingParityMatches: 8,
    validTrainingSamples: 8,
    fullReplicationBattles: 16,
  },
};

assert.doesNotThrow(() => assertStage4FullEvidenceAdmission(summary));
assert.throws(() => assertStage4FullEvidenceAdmission({...summary, evidencePolicy: {...summary.evidencePolicy, stage5Admission: "training"}}), /full-only evidence policy/);
assert.throws(() => assertStage4FullEvidenceAdmission({...summary, qualityCanary: {...summary.qualityCanary, outcomeParity: false}}), /quality-equivalence canary/);
assert.throws(() => assertStage4FullEvidenceAdmission({...summary, qualityCanary: {...summary.qualityCanary, fullReplicationBattles: 15}}), /quality-equivalence canary/);

console.log("Tiered research evidence smoke passed: full-only admission and quality-equivalence failures close safely");
