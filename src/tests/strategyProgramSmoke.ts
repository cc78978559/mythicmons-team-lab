import assert from "node:assert/strict";
import {
  countProgramNodes,
  crossoverStrategyPrograms,
  evaluateStrategyProgram,
  mutateStrategyProgram,
  noviceStrategyProgram,
  STRATEGY_PROGRAM_INPUTS,
  strategyProgramBehavior,
  strategyProgramBehaviorDistance,
  strategyProgramHash,
  validateStrategyProgram,
} from "../draft/strategyProgram";
import {StrategyProgramOpportunityCollector, strategyProgramOpportunityDistance} from "../draft/strategyProgramOpportunity";

const inputs = ["price", "power", "need", "coverage", "evidence"];
const noviceA = noviceStrategyProgram();
const noviceB = noviceStrategyProgram();
assert.equal(strategyProgramHash(noviceA), strategyProgramHash(noviceB));
assert.equal(evaluateStrategyProgram(noviceA, "acquire", {price: 3}).value, 0);

let evolved = noviceA;
for (let generation = 0; generation < 40; generation += 1) {
  const previous = evolved;
  const first = mutateStrategyProgram(evolved, `program-smoke-${generation}`, inputs);
  const replay = mutateStrategyProgram(evolved, `program-smoke-${generation}`, inputs);
  assert.equal(strategyProgramHash(first.program), strategyProgramHash(replay.program));
  evolved = first.program;
  validateStrategyProgram(evolved);
  assert(first.mutation.includes("semantic-noop") || strategyProgramBehaviorDistance(previous, evolved) > 0);
  for (const [entrypoint, expression] of Object.entries(evolved.entrypoints)) for (const key of inputKeys(expression)) assert(STRATEGY_PROGRAM_INPUTS[entrypoint as keyof typeof STRATEGY_PROGRAM_INPUTS].includes(key), `${entrypoint} must not depend on unavailable input ${key}`);
}
assert.notEqual(strategyProgramHash(evolved), strategyProgramHash(noviceA));
assert(countProgramNodes(evolved) > countProgramNodes(noviceA));
assert(strategyProgramBehavior(evolved).nonZero > 0);
assert(strategyProgramBehaviorDistance(noviceA, evolved) > 0);

const crossed = crossoverStrategyPrograms(evolved, noviceA, "program-crossover");
validateStrategyProgram(crossed);
const trace = evaluateStrategyProgram(crossed, "acquire", {price: 2, power: .8, need: .4});
assert(Number.isFinite(trace.value));
assert(trace.nodes <= crossed.limits.maxNodes);

const invalid = noviceStrategyProgram();
invalid.limits.maxNodes = 2;
assert.throws(() => validateStrategyProgram(invalid), /Invalid strategy program envelope/);
const opportunities = new StrategyProgramOpportunityCollector();
for (let index = 0; index < 40; index += 1) opportunities.record("manager-01", "acquire", {baseline: index / 400, price: index % 2, strength: .5});
const opportunitySnapshot = opportunities.snapshot(1), acquire = opportunitySnapshot.managers[0].entrypoints.acquire!;
assert.equal(acquire.observations, 40);
assert.equal(acquire.samples.length, 24);
const expressive = noviceStrategyProgram(); expressive.entrypoints.acquire = {op: "input", key: "price"};
const observedDistance = strategyProgramOpportunityDistance(noviceStrategyProgram(), expressive, opportunitySnapshot.managers[0]);
assert(observedDistance.distance > 0);
assert(observedDistance.choicePotential > 0);
assert.equal(observedDistance.observedEntrypoints, 1);
const boundary = mutateStrategyProgram(noviceStrategyProgram(), "observed-boundary-smoke", STRATEGY_PROGRAM_INPUTS.acquire, opportunitySnapshot.managers[0].entrypoints);
assert.match(boundary.mutation, /^program\.acquire\.observed-boundary\./);
assert(strategyProgramOpportunityDistance(noviceStrategyProgram(), boundary.program, opportunitySnapshot.managers[0]).choicePotential > 0);
console.log("Typed strategy program smoke test passed");

function inputKeys(value: any): string[] {
  if (value.op === "input") return [value.key];
  if (value.op === "constant") return [];
  if ("value" in value) return inputKeys(value.value);
  if ("condition" in value) return [...inputKeys(value.condition), ...inputKeys(value.whenTrue), ...inputKeys(value.whenFalse)];
  return [...inputKeys(value.left), ...inputKeys(value.right)];
}
