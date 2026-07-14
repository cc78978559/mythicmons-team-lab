export interface BenchmarkPool {
  id: string;
  format: string;
  description?: string;
  benchmarks: BenchmarkEntry[];
}

export interface BenchmarkEntry {
  id: string;
  name: string;
  archetype: string;
  team: string;
  weight?: number;
}

export interface LogAnalysis {
  p1Kos: Record<string, number>;
  p2Kos: Record<string, number>;
  p1Faints: Record<string, number>;
  p2Faints: Record<string, number>;
  p1HazardsTaken: number;
  p2HazardsTaken: number;
  p1StatusesTaken: number;
  p2StatusesTaken: number;
  p1SideConditions: Record<string, number>;
  p2SideConditions: Record<string, number>;
  failureSignals: Record<string, number>;
}

export interface RateInterval {
  low: number;
  high: number;
}

export interface MatchupSummary {
  benchmarkId: string;
  benchmarkName: string;
  archetype: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  stalled: number;
  timeouts: number;
  technicalDraws: number;
  scoredGames: number;
  winRate: number;
  resultScore: number;
  winRateInterval: RateInterval;
  sampleWarning?: string;
  averageTurns: number;
  weightedScore: number;
  killContribution: Record<string, number>;
  deathsByOpponent: Record<string, number>;
  failureReasons: Record<string, number>;
  resultPaths: string[];
}

export interface EvaluationSummary {
  candidate: string;
  benchmarkPool: string;
  format: string;
  seed: string;
  ai: string;
  openTeamSheets: boolean;
  provenance: {
    nodeVersion: string;
    showdownVersion: string;
    aiVersion: string;
    openTeamSheets: boolean;
    aiDecisionTraceEnabled: boolean;
    candidateHash: string;
    benchmarkPoolHash: string;
    sandboxModHash: string | null;
  };
  gamesPerBenchmark: number;
  totalGames: number;
  stalledGames: number;
  timeoutGames: number;
  technicalDraws: number;
  scoredGames: number;
  overallWinRate: number;
  overallResultScore: number;
  overallWinRateInterval: RateInterval;
  sampleWarning?: string;
  averageTurns: number;
  relativeScore: number | null;
  matchupConsistency: number | null;
  archetypes: Record<string, {
    games: number;
    wins: number;
    losses: number;
    draws: number;
    stalled: number;
    timeouts: number;
    technicalDraws: number;
    scoredGames: number;
    winRate: number;
    resultScore: number;
    averageTurns: number;
  }>;
  keyMatchups: {
    best: Array<{benchmarkId: string; name: string; archetype: string; winRate: number}>;
    worst: Array<{benchmarkId: string; name: string; archetype: string; winRate: number}>;
  };
  killContribution: Record<string, number>;
  failureReasons: Record<string, number>;
  matchups: MatchupSummary[];
}
