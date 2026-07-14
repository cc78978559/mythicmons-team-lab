export const DRAFT_GENERATIONS = ["g1", "g2", "g3", "g4", "g5", "g6"] as const;

export function draftGenerationSource(generation: typeof DRAFT_GENERATIONS[number]): string {
  return `data/draft/${generation}-six-team.json`;
}
