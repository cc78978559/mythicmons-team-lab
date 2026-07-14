export function seedToShowdownSeed(seed: number | string, gameIndex = 0): [number, number, number, number] {
  let state = hashSeed(`${seed}:${gameIndex}`) || 0x9e3779b9;
  const out: number[] = [];

  for (let i = 0; i < 4; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out.push(state >>> 0);
  }

  return out as [number, number, number, number];
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
