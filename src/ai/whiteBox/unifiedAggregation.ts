import {evaluateWhiteBoxCounterfactualBatch, type WhiteBoxCounterfactualBatch, type WhiteBoxCounterfactualSample} from "./counterfactualBatch";

export type UnifiedEvidenceStage = "workflow-validation" | "preliminary" | "extended-validation" | "formal-review";
export type UnifiedEvidenceConclusion = "blocked" | "continue-sampling" | "reject-hypothesis" | "candidate-for-activation-review";

export interface UnifiedEvidenceAggregate {
  schemaVersion: 1;
  hypothesisId: string;
  domain: string;
  thresholds: {workflowSamples: 3; preliminarySamples: 10; preliminarySeeds: 5; activationSamples: number; activationSeeds: number};
  stage: UnifiedEvidenceStage;
  conclusion: UnifiedEvidenceConclusion;
  activationEligible: boolean;
  batch: WhiteBoxCounterfactualBatch;
}

export function aggregateUnifiedEvidence(hypothesisId: string, domain: string, samples: readonly WhiteBoxCounterfactualSample[], options: {activationSamples?: number; activationSeeds?: number} = {}): UnifiedEvidenceAggregate {
  const activationSamples = integer(options.activationSamples ?? 30, 10, 1000, "activationSamples"), activationSeeds = integer(options.activationSeeds ?? 10, 5, activationSamples, "activationSeeds");
  const batch = evaluateWhiteBoxCounterfactualBatch(samples, activationSamples), count = batch.metrics.samples, seeds = batch.metrics.seeds;
  const stage: UnifiedEvidenceStage = count < 3 ? "workflow-validation" : count < 10 || seeds < 5 ? "preliminary" : count < activationSamples || seeds < activationSeeds ? "extended-validation" : "formal-review";
  const fatal = batch.issues.some(issue => issue.severity === "fatal"), enough = count >= activationSamples && seeds >= activationSeeds;
  const activationEligible = !fatal && enough && batch.promotion === "candidate-for-assist";
  const conclusion: UnifiedEvidenceConclusion = fatal ? "blocked" : enough && batch.promotion === "reject-current-rule" ? "reject-hypothesis" : activationEligible ? "candidate-for-activation-review" : "continue-sampling";
  return {schemaVersion: 1, hypothesisId, domain, thresholds: {workflowSamples: 3, preliminarySamples: 10, preliminarySeeds: 5, activationSamples, activationSeeds}, stage, conclusion, activationEligible, batch};
}

export function unifiedEvidenceAggregateMarkdown(value: UnifiedEvidenceAggregate): string {
  const metrics = value.batch.metrics;
  return ["# 统一反事实假设聚合", "", `- 假设：${value.hypothesisId}`, `- 领域：${value.domain}`, `- 阶段：${value.stage}`, `- 结论：${value.conclusion}`, `- 样本/种子：${metrics.samples}/${metrics.seeds}`, `- 更好/持平/更差：${metrics.better}/${metrics.neutral}/${metrics.worse}`, `- 平均积分差：${signed(metrics.meanPointsDelta)}`, `- 平均排名改善：${signed(metrics.meanRankImprovement)}`, `- 正式门槛：${value.thresholds.activationSamples}例且${value.thresholds.activationSeeds}种子`, "", "该结论只针对一个去重后的决策假设。不同领域或不同选择结构不会混合聚合，也不会自动激活正式行为。", ""].join("\n");
}

function integer(value: number, min: number, max: number, name: string): number { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function signed(value: number): string { return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`; }
