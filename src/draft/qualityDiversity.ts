export interface QualityDiversityCandidate<T> {
  id: string;
  behavior: number[];
  quality: number;
  season: number;
  payload: T;
}

export function updateQualityDiversityArchive<T>(
  existing: readonly QualityDiversityCandidate<T>[],
  incoming: readonly QualityDiversityCandidate<T>[],
  capacity = 300,
): QualityDiversityCandidate<T>[] {
  const merged = new Map<string, QualityDiversityCandidate<T>>();
  for (const candidate of [...existing, ...incoming]) {
    const previous = merged.get(candidate.id);
    if (!previous || candidate.quality > previous.quality || candidate.season > previous.season) merged.set(candidate.id, candidate);
  }
  const pool = [...merged.values()];
  if (pool.length <= capacity) return pool.sort((a, b) => b.quality - a.quality || a.id.localeCompare(b.id));
  const qualities = pool.map(candidate => candidate.quality);
  const minQuality = Math.min(...qualities);
  const qualityRange = Math.max(1e-9, Math.max(...qualities) - minQuality);
  const selected: QualityDiversityCandidate<T>[] = [pool.sort((a, b) => b.quality - a.quality || a.id.localeCompare(b.id))[0]];
  const remaining = new Set(pool.filter(candidate => candidate !== selected[0]));
  while (selected.length < capacity && remaining.size) {
    const next = [...remaining].map(candidate => {
      const novelty = Math.min(...selected.map(reference => distance(candidate.behavior, reference.behavior)));
      const quality = (candidate.quality - minQuality) / qualityRange;
      return {candidate, score: quality * .4 + novelty * .6};
    }).sort((a, b) => b.score - a.score || b.candidate.quality - a.candidate.quality || a.candidate.id.localeCompare(b.candidate.id))[0].candidate;
    selected.push(next);
    remaining.delete(next);
  }
  return selected;
}

function distance(left: number[], right: number[]): number {
  const size = Math.max(left.length, right.length, 1);
  let sum = 0;
  for (let index = 0; index < size; index += 1) sum += ((left[index] ?? 0) - (right[index] ?? 0)) ** 2;
  return Math.sqrt(sum / size);
}
