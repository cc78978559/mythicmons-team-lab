export const AI_PIPELINE_VERSION = "ai-pipeline-v1.0-stage0-stage5";
export type PipelineStageId = "stage0" | "stage1" | "stage2" | "stage3" | "stage4" | "stage5";
export type PipelineStageState = "complete" | "missing" | "running" | "failed" | "blocked";
export type PipelineMilestone = "repair-pipeline" | "current-era-evidence" | "research-iteration" | "limited-canary" | "activation-ready";

export interface PipelineStageSnapshot {
  id: PipelineStageId;
  name: string;
  dependencies: PipelineStageId[];
  artifactAvailable: boolean;
  runStatus: string | null;
  semanticHealthy: boolean;
  authority: "evidence-policy" | "historical-observational" | "shadow-only" | "validation-only";
  authorityReady: boolean;
  inputSignature: string | null;
  metrics: Record<string, unknown>;
  issues: Array<{severity: "error" | "warning"; code: string; message: string}>;
}

export interface PipelineStageEvaluation extends PipelineStageSnapshot {
  state: PipelineStageState;
  dependencyHealthy: boolean;
}

export interface PipelineEvaluation {
  version: typeof AI_PIPELINE_VERSION;
  operationalHealthy: boolean;
  researchComplete: boolean;
  pipelineCycleComplete: boolean;
  researchMaturity: "candidate-ready" | "iteration-required" | "blocked";
  formalActivationReady: boolean;
  limitedCanaryEligibleDomains: string[];
  nextStage: PipelineStageId | null;
  nextMilestones: PipelineMilestone[];
  stages: PipelineStageEvaluation[];
  blockers: Array<{stage: PipelineStageId; code: string; message: string}>;
  warnings: Array<{stage: PipelineStageId; code: string; message: string}>;
}

export interface PipelinePreflightSnapshot {
  stages: Array<{id: PipelineStageId; state: PipelineStageState}>;
  specialists: Array<{stage: PipelineStageId; healthy: boolean}>;
}

export function evaluatePipeline(input: readonly PipelineStageSnapshot[]): PipelineEvaluation {
  const expected: PipelineStageId[] = ["stage0", "stage1", "stage2", "stage3", "stage4", "stage5"];
  if (input.length !== expected.length || input.some((stage, index) => stage.id !== expected[index])) throw new Error("Pipeline stages must be ordered stage0..stage5 exactly once");
  const states = new Map<PipelineStageId, PipelineStageState>(), stages: PipelineStageEvaluation[] = [];
  for (const stage of input) {
    const dependencyHealthy = stage.dependencies.every(dependency => states.get(dependency) === "complete");
    let state: PipelineStageState;
    if (!stage.artifactAvailable) state = "missing";
    else if (stage.runStatus === "running") state = "running";
    else if (["failed", "interrupted"].includes(String(stage.runStatus))) state = "failed";
    else if (!stage.semanticHealthy || !dependencyHealthy) state = "blocked";
    else state = "complete";
    states.set(stage.id, state); stages.push({...stage, dependencyHealthy, state});
  }
  const blockers = stages.flatMap(stage => [
    ...(stage.state === "complete" ? [] : [{stage: stage.id, code: `stage-${stage.state}`, message: `${stage.name} is ${stage.state}`}]),
    ...stage.issues.filter(issue => issue.severity === "error").map(issue => ({stage: stage.id, code: issue.code, message: issue.message})),
  ]);
  const warnings = stages.flatMap(stage => stage.issues.filter(issue => issue.severity === "warning").map(issue => ({stage: stage.id, code: issue.code, message: issue.message})));
  const stage5 = stages[5], eligible = Array.isArray(stage5.metrics.limitedCanaryEligibleDomains) ? stage5.metrics.limitedCanaryEligibleDomains.map(String) : [];
  const operationalHealthy = stages.every(stage => stage.state === "complete");
  const formalActivationReady = operationalHealthy && stages[0].authorityReady && stages[1].authorityReady && eligible.length > 0;
  const pipelineCycleComplete = operationalHealthy && stage5.semanticHealthy;
  const researchMaturity = !pipelineCycleComplete ? "blocked" : eligible.length ? "candidate-ready" : "iteration-required";
  const nextMilestones: PipelineMilestone[] = !operationalHealthy
    ? ["repair-pipeline"]
    : formalActivationReady
      ? ["limited-canary", "activation-ready"]
      : [
          ...(!stages[0].authorityReady || !stages[1].authorityReady ? ["current-era-evidence" as const] : []),
          ...(!eligible.length ? ["research-iteration" as const] : []),
          ...(eligible.length ? ["limited-canary" as const] : []),
        ];
  return {
    version: AI_PIPELINE_VERSION,
    operationalHealthy,
    researchComplete: pipelineCycleComplete,
    pipelineCycleComplete,
    researchMaturity,
    formalActivationReady,
    limitedCanaryEligibleDomains: eligible,
    nextStage: stages.find(stage => stage.state !== "complete")?.id ?? null,
    nextMilestones,
    stages,
    blockers,
    warnings,
  };
}

export function repairPreflightBlockers(value: PipelinePreflightSnapshot, firstPlanned: PipelineStageId | null): string[] {
  const expected: PipelineStageId[] = ["stage0", "stage1", "stage2", "stage3", "stage4", "stage5"], cutoff = firstPlanned ? expected.indexOf(firstPlanned) : expected.length, blockers: string[] = [];
  if (cutoff < 0) return [`Unknown repair stage: ${firstPlanned}`];
  for (const id of expected.slice(0, cutoff)) {
    const stage = value.stages.find(candidate => candidate.id === id), specialist = value.specialists.find(candidate => candidate.stage === id);
    if (!stage || stage.state !== "complete") blockers.push(`${id} is ${stage?.state ?? "missing from preflight"}`);
    if (!specialist || !specialist.healthy) blockers.push(`${id} specialist doctor failed or is missing`);
  }
  return blockers;
}
