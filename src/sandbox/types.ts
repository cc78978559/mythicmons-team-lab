export interface StatsTable {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface SandboxTeam {
  name: string;
  members: SandboxMember[];
  customMoves?: SandboxMove[];
  customAbilities?: SandboxNamedEffect[];
  customItems?: SandboxNamedEffect[];
}

export interface SandboxMember {
  id: string;
  nickname?: string;
  species: string;
  level?: number;
  gender?: string;
  nature?: string;
  teraType?: string;
  types?: string[];
  baseStats?: StatsTable;
  evs?: Partial<StatsTable>;
  ivs?: Partial<StatsTable>;
  abilities?: string[];
  items?: string[];
  moves: Array<string | SandboxMoveRef>;
}

export interface SandboxMoveRef {
  id: string;
}

export interface SandboxMove {
  id: string;
  name?: string;
  entry?: string;
  type: string;
  category: "Physical" | "Special" | "Status";
  basePower?: number;
  accuracy?: number | true;
  pp?: number;
  priority?: number;
  target?: string;
  flags?: Record<string, number>;
}

export interface SandboxNamedEffect {
  id: string;
  name?: string;
  desc?: string;
  shortDesc?: string;
  entry?: string;
}

export interface CompiledSandbox {
  formatId: string;
  modId: string;
  formatName: string;
  team: import("pokemon-showdown/dist/sim/teams").PokemonSet[];
  files: Record<string, string>;
  manifest: {
    syntheticAbilities: string[];
    syntheticItems: string[];
    syntheticSpecies: string[];
    customAbilities: string[];
    customItems: string[];
    customMoves: string[];
    warnings: string[];
  };
}
