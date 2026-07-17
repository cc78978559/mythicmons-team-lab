import crypto from "node:crypto";

export interface ManagerLifecyclePolicy {
  maturitySeasons: number;
  fertilityMaxSeasons: number;
  retirementMinSeasons: number;
  retirementHardSeasons: number;
  retirementBasePercent: number;
  retirementGrowthPercent: number;
}

export interface ManagerLifecycleAssessment {
  careerSeasons: number;
  phase: "juvenile" | "fertile" | "post-fertility" | "retirement-eligible" | "forced-retirement";
  parentEligible: boolean;
  retirementProbability: number;
  retirementRoll: number;
  retires: boolean;
  reason?: "probabilistic" | "hard-limit";
}

export function assessManagerLifecycle(careerSeasons: number, policy: ManagerLifecyclePolicy, seed: string): ManagerLifecycleAssessment {
  validateLifecyclePolicy(policy);
  const retirementRoll = deterministicUnit(`${seed}:retirement`);
  const forced = careerSeasons >= policy.retirementHardSeasons;
  const retirementProbability = careerSeasons < policy.retirementMinSeasons ? 0 : forced ? 1 : Math.min(.95, (policy.retirementBasePercent + (careerSeasons - policy.retirementMinSeasons) * policy.retirementGrowthPercent) / 100);
  const retires = forced || retirementRoll < retirementProbability;
  const parentEligible = !retires && careerSeasons >= policy.maturitySeasons && careerSeasons <= policy.fertilityMaxSeasons;
  const phase = forced ? "forced-retirement" : careerSeasons >= policy.retirementMinSeasons ? "retirement-eligible" : careerSeasons > policy.fertilityMaxSeasons ? "post-fertility" : careerSeasons >= policy.maturitySeasons ? "fertile" : "juvenile";
  return {careerSeasons, phase, parentEligible, retirementProbability, retirementRoll, retires, reason: retires ? forced ? "hard-limit" : "probabilistic" : undefined};
}

export function validateLifecyclePolicy(policy: ManagerLifecyclePolicy): void {
  if (policy.maturitySeasons < 0 || policy.fertilityMaxSeasons < policy.maturitySeasons) throw new Error("Lifecycle fertility window is invalid");
  if (policy.retirementMinSeasons < policy.maturitySeasons || policy.retirementHardSeasons < policy.retirementMinSeasons) throw new Error("Lifecycle retirement window is invalid");
  if (policy.retirementBasePercent < 0 || policy.retirementBasePercent > 100 || policy.retirementGrowthPercent < 0 || policy.retirementGrowthPercent > 100) throw new Error("Lifecycle retirement percentages are invalid");
}

function deterministicUnit(seed: string): number { return parseInt(crypto.createHash("sha256").update(seed).digest("hex").slice(0, 13), 16) / 0x10000000000000; }
