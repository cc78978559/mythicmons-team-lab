import crypto from "node:crypto";

export function boundedDraftJitter(seed: string, value: string, pick: number): number {
  const raw = Number.parseInt(crypto.createHash("sha256").update(`${seed}:${pick}:${value}`).digest("hex").slice(0, 8), 16);
  return raw / 1e12;
}

export function thirdRoundReversalOrder(teamCount: number, rounds: number): number[][] {
  const forward = Array.from({length: teamCount}, (_, index) => index);
  const reverse = [...forward].reverse();
  return Array.from({length: rounds}, (_, index) => {
    const round = index + 1;
    const usesForward = round === 1 || round >= 4 && round % 2 === 0;
    return [...(usesForward ? forward : reverse)];
  });
}
