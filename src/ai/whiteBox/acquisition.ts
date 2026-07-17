import type {WhiteBoxCandidate, WhiteBoxContribution} from "./decision";

export interface WhiteBoxAcquisitionTraits {
  risk: number;
  stars: number;
  synergy: number;
  counter: number;
  value: number;
  flexibility: number;
}

export interface WhiteBoxAcquisitionInput {
  id: string;
  commonStrength: number;
  roleFit: number;
  synergy: number;
  counter: number;
  flexibility: number;
  value: number;
  star: number;
  risk: number;
  traitWeights: WhiteBoxAcquisitionTraits;
  systemFit: number;
  programAdjustment: number;
  completionValue?: number;
  exploration?: number;
  publicPreference?: number;
  hardRejections?: string[];
}

export function buildAcquisitionWhiteBoxCandidate(input: WhiteBoxAcquisitionInput): WhiteBoxCandidate {
  const neutralWeight = 1 / 6;
  const neutralFit = (input.synergy + input.counter + input.flexibility + input.value + input.star + input.risk) * neutralWeight * 1.8;
  const rational: WhiteBoxContribution[] = [
    contribution("acquire.strength", "strength", "competence", input.commonStrength * .7, "General candidate strength"),
    contribution("acquire.rolefit", "roles", "goal", input.roleFit * .35, "Declared roster role targets"),
    contribution("acquire.completion", "planning", "goal", input.completionValue ?? 0, "Bounded look-ahead for completing the roster"),
    contribution("acquire.neutralfit", "fit", "competence", neutralFit, "Candidate fit under a neutral manager profile"),
    contribution("acquire.system", "strategy", "goal", input.systemFit * .3, "Current explicit team-system fit"),
    contribution("acquire.program", "strategy", "goal", input.programAdjustment, "Bounded strategy-program adjustment"),
  ];
  const style: WhiteBoxContribution[] = [
    contribution("acquire.synergy", "personality", "personality", input.synergy * (input.traitWeights.synergy - neutralWeight) * 1.8, "Synergy preference relative to neutral"),
    contribution("acquire.counter", "personality", "personality", input.counter * (input.traitWeights.counter - neutralWeight) * 1.8, "Counter-building preference relative to neutral"),
    contribution("acquire.flexibility", "personality", "personality", input.flexibility * (input.traitWeights.flexibility - neutralWeight) * 1.8, "Functional-breadth preference relative to neutral"),
    contribution("acquire.value", "personality", "personality", input.value * (input.traitWeights.value - neutralWeight) * 1.8, "Strength-per-cost preference relative to neutral"),
    contribution("acquire.star", "personality", "personality", input.star * (input.traitWeights.stars - neutralWeight) * 1.8, "Premium-member preference relative to neutral"),
    contribution("acquire.risk", "personality", "personality", input.risk * (input.traitWeights.risk - neutralWeight) * 1.8, "Volatility preference relative to neutral"),
    contribution("acquire.public", "strategy", "context", input.publicPreference ?? 0, "Preference for public registration depth"),
    contribution("acquire.exploration", "exploration", "tie-break", input.exploration ?? 0, "Seeded bounded exploration"),
  ];
  return {id: input.id, hardRejections: [...(input.hardRejections ?? [])], rational, style};
}

export function whiteBoxAcquisitionTotal(candidate: WhiteBoxCandidate): number {
  return [...candidate.rational, ...(candidate.style ?? [])].reduce((total, entry) => total + entry.value, 0);
}

function contribution(id: string, group: string, source: WhiteBoxContribution["source"], value: number, reason: string): WhiteBoxContribution {
  return {id, group, source, value, reason};
}
