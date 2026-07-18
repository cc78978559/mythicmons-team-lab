import crypto from "node:crypto";

export type ProgramEntrypoint = "acquire" | "configure" | "lineup" | "battle" | "learn";
export type ProgramExpression =
  | {op: "constant"; value: number}
  | {op: "input"; key: string}
  | {op: "negate" | "absolute"; value: ProgramExpression}
  | {op: "add" | "subtract" | "multiply" | "divide" | "minimum" | "maximum" | "greater" | "less"; left: ProgramExpression; right: ProgramExpression}
  | {op: "choose"; condition: ProgramExpression; whenTrue: ProgramExpression; whenFalse: ProgramExpression};

export interface StrategyProgram {
  version: 1;
  entrypoints: Record<ProgramEntrypoint, ProgramExpression>;
  limits: {maxNodes: number; maxDepth: number};
}

export interface ProgramTrace {hash: string; entrypoint: ProgramEntrypoint; value: number; nodes: number; inputs: Record<string, number>}
export interface ProgramBehaviorFingerprint {schemaVersion: 1; values: number[]; hash: string; nonZero: number; range: number}

const ENTRYPOINTS: ProgramEntrypoint[] = ["acquire", "configure", "lineup", "battle", "learn"];
const BINARY = ["add", "subtract", "multiply", "divide", "minimum", "maximum", "greater", "less"] as const;
export const STRATEGY_PROGRAM_INPUTS: Record<ProgramEntrypoint, readonly string[]> = {
  acquire: ["baseline", "strength", "price", "roleBreadth", "speed", "bulk", "rosterSize"],
  configure: ["baseline", "strength", "accuracy", "speed", "bulk", "roleBreadth"],
  lineup: ["baseline", "strength", "roleBreadth", "rosterSize", "opponentPressure"],
  battle: ["baseline", "strength", "opponentPressure", "rosterSize", "tacticalConfidence", "historicalWinRate", "opponentLeadConcentration", "opponentSwitchRate"],
  learn: ["baseline", "usage", "production", "teamResult"],
};
const BEHAVIOR_LEVELS = [.15, .5, .85] as const;

export function noviceStrategyProgram(): StrategyProgram {
  return {version: 1, entrypoints: Object.fromEntries(ENTRYPOINTS.map(entry => [entry, {op: "constant", value: 0}])) as StrategyProgram["entrypoints"], limits: {maxNodes: 96, maxDepth: 12}};
}

export function cloneStrategyProgram(program: StrategyProgram | undefined): StrategyProgram {
  return program ? JSON.parse(JSON.stringify(program)) as StrategyProgram : noviceStrategyProgram();
}

export function evaluateStrategyProgram(program: StrategyProgram | undefined, entrypoint: ProgramEntrypoint, inputs: Record<string, number>): ProgramTrace {
  const active = program ?? noviceStrategyProgram();
  validateStrategyProgram(active);
  let visited = 0;
  const evaluate = (expression: ProgramExpression, depth: number): number => {
    visited += 1;
    if (visited > active.limits.maxNodes || depth > active.limits.maxDepth) throw new Error("Strategy program exceeded its resource limit");
    if (expression.op === "constant") return finite(expression.value);
    if (expression.op === "input") return finite(inputs[expression.key] ?? 0);
    if ("value" in expression) return expression.op === "negate" ? -evaluate(expression.value, depth + 1) : Math.abs(evaluate(expression.value, depth + 1));
    if ("condition" in expression) return evaluate(expression.condition, depth + 1) > 0 ? evaluate(expression.whenTrue, depth + 1) : evaluate(expression.whenFalse, depth + 1);
    const left = evaluate(expression.left, depth + 1), right = evaluate(expression.right, depth + 1);
    if (expression.op === "add") return bounded(left + right);
    if (expression.op === "subtract") return bounded(left - right);
    if (expression.op === "multiply") return bounded(left * right);
    if (expression.op === "divide") return Math.abs(right) < 1e-9 ? 0 : bounded(left / right);
    if (expression.op === "minimum") return Math.min(left, right);
    if (expression.op === "maximum") return Math.max(left, right);
    if (expression.op === "greater") return left > right ? 1 : -1;
    return left < right ? 1 : -1;
  };
  const value = bounded(evaluate(active.entrypoints[entrypoint], 1));
  return {hash: strategyProgramHash(active), entrypoint, value, nodes: visited, inputs: {...inputs}};
}

export function mutateStrategyProgram(program: StrategyProgram | undefined, seed: string, availableInputs: readonly string[]): {program: StrategyProgram; mutation: string} {
  const previousProgram = cloneStrategyProgram(program);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const attemptSeed = `${seed}:attempt:${attempt}`;
    const result = mutateOnce(previousProgram, attemptSeed, availableInputs);
    if (strategyProgramBehaviorDistance(previousProgram, result.program) > 1e-9) return result;
  }
  return {program: previousProgram, mutation: `program.semantic-noop:${strategyProgramHash(previousProgram).slice(0, 10)}`};
}

function mutateOnce(program: StrategyProgram, seed: string, availableInputs: readonly string[]): {program: StrategyProgram; mutation: string} {
  const next = cloneStrategyProgram(program);
  const entrypoint = ENTRYPOINTS[index(seed, "entrypoint", ENTRYPOINTS.length)];
  const previous = next.entrypoints[entrypoint];
  const mode = index(seed, "mode", 5);
  const constant = unit(`${seed}:constant`) * 2 - 1;
  const compatibleInputs = STRATEGY_PROGRAM_INPUTS[entrypoint].filter(key => availableInputs.includes(key));
  const input: ProgramExpression = compatibleInputs.length ? {op: "input", key: compatibleInputs[index(seed, "input", compatibleInputs.length)]} : {op: "constant", value: constant};
  if (mode === 0) next.entrypoints[entrypoint] = input;
  else if (mode === 1) next.entrypoints[entrypoint] = {op: BINARY[index(seed, "binary", BINARY.length)], left: previous, right: input};
  else if (mode === 2) next.entrypoints[entrypoint] = {op: unit(`${seed}:unary`) < .5 ? "negate" : "absolute", value: previous};
  else if (mode === 3) next.entrypoints[entrypoint] = {op: "choose", condition: input, whenTrue: previous, whenFalse: {op: "constant", value: constant}};
  else next.entrypoints[entrypoint] = replaceLeaf(previous, input, index(seed, "leaf", countLeaves(previous)));
  if (countNodes(next.entrypoints[entrypoint]) > next.limits.maxNodes || expressionDepth(next.entrypoints[entrypoint]) > next.limits.maxDepth) next.entrypoints[entrypoint] = previous;
  validateStrategyProgram(next);
  return {program: next, mutation: `program.${entrypoint}.${mode}:${strategyProgramHash(next).slice(0, 10)}`};
}

export function crossoverStrategyPrograms(primary: StrategyProgram | undefined, secondary: StrategyProgram | undefined, seed: string): StrategyProgram {
  const child = cloneStrategyProgram(primary), donor = cloneStrategyProgram(secondary);
  for (const entrypoint of ENTRYPOINTS) if (unit(`${seed}:${entrypoint}`) < .35) child.entrypoints[entrypoint] = cloneExpression(donor.entrypoints[entrypoint]);
  validateStrategyProgram(child);
  return child;
}

export function validateStrategyProgram(program: StrategyProgram): void {
  if (program.version !== 1 || !program.entrypoints || !program.limits || program.limits.maxNodes < 8 || program.limits.maxNodes > 256 || program.limits.maxDepth < 3 || program.limits.maxDepth > 24) throw new Error("Invalid strategy program envelope");
  for (const entrypoint of ENTRYPOINTS) {
    if (!program.entrypoints[entrypoint]) throw new Error(`Missing strategy entrypoint ${entrypoint}`);
    if (countNodes(program.entrypoints[entrypoint]) > program.limits.maxNodes || expressionDepth(program.entrypoints[entrypoint]) > program.limits.maxDepth) throw new Error(`Strategy entrypoint ${entrypoint} exceeds limits`);
  }
}

export function strategyProgramHash(program: StrategyProgram): string { return crypto.createHash("sha256").update(JSON.stringify(program)).digest("hex"); }
export function countProgramNodes(program: StrategyProgram): number { return ENTRYPOINTS.reduce((sum, entrypoint) => sum + countNodes(program.entrypoints[entrypoint]), 0); }
export function strategyProgramBehavior(program: StrategyProgram | undefined): ProgramBehaviorFingerprint {
  const values = ENTRYPOINTS.flatMap(entrypoint => BEHAVIOR_LEVELS.map((level, probeIndex) => evaluateStrategyProgram(program, entrypoint, Object.fromEntries(STRATEGY_PROGRAM_INPUTS[entrypoint].map((key, keyIndex) => [key, BEHAVIOR_LEVELS[(probeIndex + keyIndex) % BEHAVIOR_LEVELS.length]]))).value));
  const minimum = Math.min(...values), maximum = Math.max(...values);
  return {schemaVersion: 1, values, hash: crypto.createHash("sha256").update(JSON.stringify(values)).digest("hex"), nonZero: values.filter(value => Math.abs(value) > 1e-9).length, range: maximum - minimum};
}
export function strategyProgramBehaviorDistance(left: StrategyProgram | undefined, right: StrategyProgram | undefined): number {
  const a = strategyProgramBehavior(left).values, b = strategyProgramBehavior(right).values;
  return a.reduce((sum, value, index) => sum + Math.abs(value - b[index]) / 8, 0) / a.length;
}

function replaceLeaf(expression: ProgramExpression, replacement: ProgramExpression, target: number, cursor = {value: 0}): ProgramExpression {
  if (expression.op === "constant" || expression.op === "input") return cursor.value++ === target ? replacement : expression;
  if ("value" in expression) return {...expression, value: replaceLeaf(expression.value, replacement, target, cursor)};
  if ("condition" in expression) return {...expression, condition: replaceLeaf(expression.condition, replacement, target, cursor), whenTrue: replaceLeaf(expression.whenTrue, replacement, target, cursor), whenFalse: replaceLeaf(expression.whenFalse, replacement, target, cursor)};
  return {...expression, left: replaceLeaf(expression.left, replacement, target, cursor), right: replaceLeaf(expression.right, replacement, target, cursor)};
}
function countNodes(expression: ProgramExpression): number { return expression.op === "constant" || expression.op === "input" ? 1 : "value" in expression ? 1 + countNodes(expression.value) : "condition" in expression ? 1 + countNodes(expression.condition) + countNodes(expression.whenTrue) + countNodes(expression.whenFalse) : 1 + countNodes(expression.left) + countNodes(expression.right); }
function countLeaves(expression: ProgramExpression): number { return expression.op === "constant" || expression.op === "input" ? 1 : "value" in expression ? countLeaves(expression.value) : "condition" in expression ? countLeaves(expression.condition) + countLeaves(expression.whenTrue) + countLeaves(expression.whenFalse) : countLeaves(expression.left) + countLeaves(expression.right); }
function expressionDepth(expression: ProgramExpression): number { return expression.op === "constant" || expression.op === "input" ? 1 : "value" in expression ? 1 + expressionDepth(expression.value) : "condition" in expression ? 1 + Math.max(expressionDepth(expression.condition), expressionDepth(expression.whenTrue), expressionDepth(expression.whenFalse)) : 1 + Math.max(expressionDepth(expression.left), expressionDepth(expression.right)); }
function cloneExpression<T extends ProgramExpression>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function finite(value: number): number { return Number.isFinite(value) ? value : 0; }
function bounded(value: number): number { return Math.max(-4, Math.min(4, finite(value))); }
function unit(seed: string): number { return Number.parseInt(crypto.createHash("sha256").update(seed).digest("hex").slice(0, 13), 16) / 0x10000000000000; }
function index(seed: string, suffix: string, length: number): number { return Math.min(length - 1, Math.floor(unit(`${seed}:${suffix}`) * length)); }
