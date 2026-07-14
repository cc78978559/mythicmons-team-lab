export const DRAFT_GENERATIONS = ["g1", "g2", "g3", "g4", "g5", "g6"] as const;
export const RETIRED_DRAFT_MEMBER_IDS = new Set(["g1wigglytuff"]);

export function draftGenerationSource(generation: typeof DRAFT_GENERATIONS[number]): string {
  return `data/draft/${generation}-six-team.json`;
}
