import type {PokemonSet} from "pokemon-showdown/dist/sim/teams";
import type {EvaluationSummary} from "../eval/types";
import type {SandboxTeam} from "../sandbox/types";

export type VariantKind = "item" | "ability" | "move" | "evs";

export interface TeamVariant {
  id: string;
  kind: VariantKind;
  memberIndex: number;
  memberName: string;
  description: string;
  team: PokemonSet[];
}

export interface SandboxTeamVariant extends Omit<TeamVariant, "team"> {
  sandbox: SandboxTeam;
}

export interface VariantResult {
  variant: Omit<TeamVariant, "team">;
  evaluation: EvaluationSummary;
  delta: {
    winRate: number;
    relativeScore: number | null;
    averageTurns: number;
  };
}

export interface VariantExperimentSummary {
  candidate: string;
  benchmarkPool: string;
  format: string;
  seed: string;
  ai: string;
  gamesPerBenchmark: number;
  baseline: EvaluationSummary;
  variants: VariantResult[];
  skipped: Array<{
    id: string;
    description: string;
    reasons: string[];
  }>;
}
