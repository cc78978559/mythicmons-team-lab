import assert from "node:assert/strict";
import {aggregateStrategyProgramReplicas, type StrategyProgramReplicaSample} from "../ai/whiteBox/strategyProgramReplication";

assert.equal(aggregateStrategyProgramReplicas([sample(1, 1), sample(2, 1), sample(3, 0)]).conclusion, "stable-benefit-in-source");
assert.equal(aggregateStrategyProgramReplicas([sample(1, -1), sample(2, -1), sample(3, 0)]).conclusion, "stable-regression-in-source");
assert.equal(aggregateStrategyProgramReplicas([sample(1, 1), sample(2, -1), sample(3, 0)]).conclusion, "environment-sensitive");
assert.equal(aggregateStrategyProgramReplicas([sample(1, 0), sample(2, 0), sample(3, 0)]).conclusion, "no-observed-effect");
assert.equal(aggregateStrategyProgramReplicas([sample(1, 1), sample(2, 1)]).conclusion, "insufficient-replicas");
assert.throws(() => aggregateStrategyProgramReplicas([sample(1, 1), sample(1, 1)]), /unique/);
console.log("Strategy-program candidate replication smoke passed");

function sample(index: number, direction: number): StrategyProgramReplicaSample { return {continuationSalt: `replica-${index}`, sourceVerified: true, prefixVerified: true, sourceSeason: 2, horizonSeasons: 2, managerId: "manager-01", candidateProgramHash: "candidate", decisionDifferences: direction ? 3 : 0, delta: {points: direction * 3, rankImprovement: direction, titles: 0, cash: direction}}; }
