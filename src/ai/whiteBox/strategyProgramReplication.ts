export type StrategyProgramReplicationConclusion = "insufficient-replicas" | "no-observed-effect" | "stable-benefit-in-source" | "stable-regression-in-source" | "environment-sensitive";

export interface StrategyProgramReplicaSample {
  continuationSalt: string;
  sourceVerified: boolean;
  prefixVerified: boolean;
  sourceSeason: number;
  horizonSeasons: number;
  managerId: string;
  candidateProgramHash: string;
  decisionDifferences: number;
  delta: {points: number; rankImprovement: number; titles: number; cash: number};
}

export interface StrategyProgramReplicationAggregate {
  schemaVersion: 1;
  conclusion: StrategyProgramReplicationConclusion;
  candidate: {managerId: string; programHash: string; sourceSeason: number; horizonSeasons: number};
  metrics: {replicas: number; better: number; neutral: number; worse: number; decisionDivergence: number; meanPointsDelta: number; meanRankImprovement: number; meanTitlesDelta: number; meanCashDelta: number};
  samples: StrategyProgramReplicaSample[];
}

export function aggregateStrategyProgramReplicas(samples: readonly StrategyProgramReplicaSample[]): StrategyProgramReplicationAggregate {
  if (!samples.length) throw new Error("Strategy-program replication requires at least one sample");
  const first = samples[0], salts = new Set<string>();
  for (const sample of samples) {
    if (!sample.continuationSalt || salts.has(sample.continuationSalt)) throw new Error("Replica continuation salts must be non-empty and unique");
    salts.add(sample.continuationSalt);
    if (!sample.sourceVerified || !sample.prefixVerified) throw new Error(`Unverified strategy-program replica ${sample.continuationSalt}`);
    if (sample.managerId !== first.managerId || sample.candidateProgramHash !== first.candidateProgramHash || sample.sourceSeason !== first.sourceSeason || sample.horizonSeasons !== first.horizonSeasons) throw new Error("Strategy-program replicas do not isolate the same candidate and source");
    if (!Number.isInteger(sample.decisionDifferences) || sample.decisionDifferences < 0 || !Object.values(sample.delta).every(Number.isFinite)) throw new Error(`Malformed strategy-program replica ${sample.continuationSalt}`);
  }
  const directions = samples.map(sample => competitiveDirection(sample.delta));
  const better = directions.filter(value => value > 0).length, neutral = directions.filter(value => value === 0).length, worse = directions.filter(value => value < 0).length;
  const threshold = Math.ceil(samples.length * 2 / 3);
  const metrics = {
    replicas: samples.length, better, neutral, worse,
    decisionDivergence: samples.filter(sample => sample.decisionDifferences > 0).length,
    meanPointsDelta: round(mean(samples.map(sample => sample.delta.points))),
    meanRankImprovement: round(mean(samples.map(sample => sample.delta.rankImprovement))),
    meanTitlesDelta: round(mean(samples.map(sample => sample.delta.titles))),
    meanCashDelta: round(mean(samples.map(sample => sample.delta.cash))),
  };
  const conclusion: StrategyProgramReplicationConclusion = samples.length < 3 ? "insufficient-replicas"
    : better + worse === 0 ? "no-observed-effect"
    : better >= threshold && worse === 0 && metrics.meanPointsDelta >= 0 && metrics.meanTitlesDelta >= 0 ? "stable-benefit-in-source"
    : worse >= threshold && better === 0 ? "stable-regression-in-source"
    : "environment-sensitive";
  return {schemaVersion: 1, conclusion, candidate: {managerId: first.managerId, programHash: first.candidateProgramHash, sourceSeason: first.sourceSeason, horizonSeasons: first.horizonSeasons}, metrics, samples: samples.map(sample => structuredClone(sample))};
}

function competitiveDirection(delta: StrategyProgramReplicaSample["delta"]): number { if (delta.titles !== 0) return Math.sign(delta.titles); if (delta.points !== 0) return Math.sign(delta.points); if (delta.rankImprovement !== 0) return Math.sign(delta.rankImprovement); return 0; }
function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
