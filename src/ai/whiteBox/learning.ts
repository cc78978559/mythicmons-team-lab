import {clampTrait, type ManagerDevelopment, type ManagerTraits, type StrategyPosterior} from "../../draft/managerProfiles";
import {LEARNING_SHADOW_PARAMETERS} from "./parameters";

export const WHITE_BOX_LEARNING_VERSION = "white-box-learning-v1";

export interface WhiteBoxLearningEvidence {
  trait: keyof ManagerTraits;
  value: number;
  reason: string;
}

export interface WhiteBoxLearningInput {
  managerId: string;
  traits: ManagerTraits;
  development: ManagerDevelopment;
  evidence: readonly WhiteBoxLearningEvidence[];
  parameters?: Readonly<Record<string, number>>;
}

export interface WhiteBoxTraitLearningTrace {
  trait: keyof ManagerTraits;
  evidence: number;
  reason: string;
  beforeTrait: number;
  rawAfterTrait: number;
  afterTrait: number;
  requestedDelta: number;
  appliedDelta: number;
  capped: boolean;
  prior: StrategyPosterior;
  retainedSamples: number;
  posteriorAfter: StrategyPosterior;
  rollback: {trait: number; posterior: StrategyPosterior};
}

export interface WhiteBoxLearningTrace {
  version: typeof WHITE_BOX_LEARNING_VERSION;
  managerId: string;
  parameters: Record<string, number>;
  seasonBefore: number;
  seasonAfter: number;
  exploration: {before: number; rawAfter: number; after: number; floorApplied: boolean};
  traits: WhiteBoxTraitLearningTrace[];
}

export function evaluateWhiteBoxLearning(input: WhiteBoxLearningInput): WhiteBoxLearningTrace {
  const parameters = LEARNING_SHADOW_PARAMETERS.snapshot(input.parameters).values;
  const evidence = new Map(input.evidence.map(entry => [entry.trait, entry]));
  const traits = (Object.keys(input.traits) as Array<keyof ManagerTraits>).map(trait => {
    const observed = evidence.get(trait);
    if (!observed) throw new Error(`Missing learning evidence for ${trait}`);
    if (!Number.isFinite(observed.value) || observed.value < 0 || observed.value > 1) throw new Error(`Learning evidence for ${trait} must be within 0..1`);
    const prior = input.development.strategies[trait];
    const retainedSamples = Math.max(parameters["learning.minimumsamples"], prior.effectiveSamples * parameters["learning.priorretention"]);
    const effectiveSamples = Math.min(parameters["learning.maximumsamples"], retainedSamples + parameters["learning.samplesperseason"]);
    const mean = (prior.mean * retainedSamples + observed.value * parameters["learning.samplesperseason"]) / effectiveSamples;
    const confidence = clamp01((effectiveSamples - parameters["learning.minimumsamples"]) / parameters["learning.confidencespan"]);
    const posteriorAfter = {mean, confidence, effectiveSamples};
    const rawAfterTrait = clampTrait(.5 + (mean - .5) * confidence * parameters["learning.traitgain"]);
    const requestedDelta = rawAfterTrait - input.traits[trait];
    const appliedDelta = clamp(requestedDelta, -parameters["learning.maximumtraitdelta"], parameters["learning.maximumtraitdelta"]);
    const afterTrait = clampTrait(input.traits[trait] + appliedDelta);
    return {
      trait,
      evidence: observed.value,
      reason: observed.reason,
      beforeTrait: input.traits[trait],
      rawAfterTrait,
      afterTrait,
      requestedDelta,
      appliedDelta,
      capped: appliedDelta !== requestedDelta,
      prior: {...prior},
      retainedSamples,
      posteriorAfter,
      rollback: {trait: input.traits[trait], posterior: {...prior}},
    };
  });
  const seasonAfter = input.development.seasons + 1;
  const rawAfter = parameters["learning.explorationstart"] * Math.exp(-seasonAfter / parameters["learning.explorationdecayseasons"]);
  const explorationAfter = Math.max(parameters["learning.explorationfloor"], rawAfter);
  return {
    version: WHITE_BOX_LEARNING_VERSION,
    managerId: input.managerId,
    parameters,
    seasonBefore: input.development.seasons,
    seasonAfter,
    exploration: {before: input.development.exploration, rawAfter, after: explorationAfter, floorApplied: explorationAfter !== rawAfter},
    traits,
  };
}

function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function clamp01(value: number): number { return clamp(value, 0, 1); }
