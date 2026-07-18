import assert from "node:assert/strict";
import {selectBeneficialStrategyProgramSamples, summarizeStrategyProgramScreening} from "../ai/whiteBox/strategyProgramScreening";
import type {StrategyProgramCounterfactualSample} from "../ai/whiteBox/strategyProgramAggregation";

const samples = [sample("worse", -1), sample("better-b", 1), sample("neutral", 0), sample("better-a", 1)];
assert.deepEqual(selectBeneficialStrategyProgramSamples(samples).map(value => value.seed), ["better-a", "better-b"]);
assert.equal(summarizeStrategyProgramScreening([]).conclusion, "no-source-benefits");
assert.equal(summarizeStrategyProgramScreening([{seed: "a", managerId: "m", operator: "observed-boundary-v1", candidateProgramHash: "p", sourceDelta: samples[1].delta, replicationConclusion: "stable-benefit-in-source"}]).conclusion, "stable-candidates-found");
assert.equal(summarizeStrategyProgramScreening([{seed: "a", managerId: "m", operator: "observed-boundary-v1", candidateProgramHash: "p", sourceDelta: samples[1].delta, replicationConclusion: "environment-sensitive"}]).conclusion, "no-stable-candidate");
console.log("Strategy-program candidate screening smoke passed");

function sample(seed: string, direction: number): StrategyProgramCounterfactualSample { return {seed, managerId: "manager", operator: "observed-boundary-v1", sourceSeason: 2, activationSeason: 3, evaluationSeason: 4, horizonSeasons: 2, sourceVerified: true, prefixVerified: true, parentProgramHash: "parent", candidateProgramHash: `candidate-${seed}`, behaviorDistance: .1, opportunityDistance: .1, choicePotential: .1, operatorMutations: ["program.acquire.observed-boundary.speed@0.5:+2"], decisionEffects: {ledgerCompared: 1, ledgerSelectionDifferences: 1, ledgerRecordSetDifferences: 0, programSignalsCompared: 1, programSignalDifferences: 1, battleCompared: 1, battleChoiceDifferences: 1, battleRecordSetDifferences: 0}, delta: {points: direction * 3, rankImprovement: direction, titles: 0, cash: 0}}; }
