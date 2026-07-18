import type {StrategyProgramCounterfactualSample} from "./strategyProgramAggregation";
import type {StrategyProgramReplicationConclusion} from "./strategyProgramReplication";

export interface StrategyProgramScreeningResult {seed: string; managerId: string; operator: StrategyProgramCounterfactualSample["operator"]; candidateProgramHash: string; sourceDelta: StrategyProgramCounterfactualSample["delta"]; replicationConclusion: StrategyProgramReplicationConclusion}

export function selectBeneficialStrategyProgramSamples(samples: readonly StrategyProgramCounterfactualSample[]): StrategyProgramCounterfactualSample[] {
  return samples.filter(sample => competitiveDirection(sample.delta) > 0).sort((left, right) => left.seed.localeCompare(right.seed) || left.managerId.localeCompare(right.managerId));
}

export function summarizeStrategyProgramScreening(results: readonly StrategyProgramScreeningResult[]) {
  const stable = results.filter(result => result.replicationConclusion === "stable-benefit-in-source").length;
  const regression = results.filter(result => result.replicationConclusion === "stable-regression-in-source").length;
  const sensitive = results.filter(result => result.replicationConclusion === "environment-sensitive").length;
  const noEffect = results.filter(result => result.replicationConclusion === "no-observed-effect").length;
  const incomplete = results.filter(result => result.replicationConclusion === "insufficient-replicas").length;
  const conclusion = !results.length ? "no-source-benefits" : incomplete ? "incomplete" : stable ? "stable-candidates-found" : "no-stable-candidate";
  return {schemaVersion: 1 as const, conclusion, metrics: {screened: results.length, stable, regression, sensitive, noEffect, incomplete, survivalRate: results.length ? stable / results.length : 0}, candidates: results.map(result => structuredClone(result))};
}

function competitiveDirection(delta: StrategyProgramCounterfactualSample["delta"]): number { if (delta.titles !== 0) return Math.sign(delta.titles); if (delta.points !== 0) return Math.sign(delta.points); if (delta.rankImprovement !== 0) return Math.sign(delta.rankImprovement); return 0; }
