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
console.log("Typed strategy program smoke test passed");

function inputKeys(value: any): string[] {
  if (value.op === "input") return [value.key];
  if (value.op === "constant") return [];
  if ("value" in value) return inputKeys(value.value);
  if ("condition" in value) return [...inputKeys(value.condition), ...inputKeys(value.whenTrue), ...inputKeys(value.whenFalse)];
  return [...inputKeys(value.left), ...inputKeys(value.right)];
}
