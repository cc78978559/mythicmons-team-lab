import crypto from "node:crypto";
import {RELATIONAL_ENCODER_VERSION, RELATIONAL_SWITCH_FEATURES, relationalKnown, type RelationalDecisionCandidateV1, type RelationalSwitchFeature} from "./relationalDecision";

export const MANAGER_PROGRAM_V3_LANGUAGE = "manager-program-v3.0-relational" as const;
export const MANAGER_PROGRAM_V3_LIMITS = {maxRules: 16, maxConditions: 4, maxTerms: 8, maxEvaluatedItems: 128} as const;
export const MANAGER_PROGRAM_V3_RELATION_PATHS = ["edges.takes-response", "edges.threatens", "edges.speed-relation", "edges.type-relation", "edges.role-coverage", "edges.enters-field"] as const;
export type RelationalReducer = "identity" | "min" | "max" | "mean" | "weightedMean" | "countAbove";
export type RelationalComparator = "gte" | "lt";
export type RelationalTransform = "linear" | "hinge";

export interface ManagerProgramConditionV3 {path: string; reducer: RelationalReducer; operator: RelationalComparator; threshold: number; auxiliaryThreshold?: number}
export interface ManagerProgramTermV3 {path: string; reducer: RelationalReducer; transform: RelationalTransform; weight: number; hinge?: number; auxiliaryThreshold?: number}
export interface ManagerProgramRuleV3 {id: string; conditions: ManagerProgramConditionV3[]; terms: ManagerProgramTermV3[]; lineage: {operation: "mutate" | "delete" | "replace" | "crossover"; parents: string[]; evidenceClusters: string[]}}
export interface ManagerProgramV3 {
  schemaVersion: 3;
  language: typeof MANAGER_PROGRAM_V3_LANGUAGE;
  activationStatus: "shadow-only";
  domain: "switch";
  managerId: string;
  revision: number;
  rules: ManagerProgramRuleV3[];
  limits: typeof MANAGER_PROGRAM_V3_LIMITS;
  evidence: {encoderVersion: typeof RELATIONAL_ENCODER_VERSION; corpusSignature: string; familySplitSignature: string};
  ancestry: string[];
}

export interface RelationalCandidateSampleV3 {
  decisionId: string;
  candidateId: string;
  familyId: string;
  clusterId: string;
  environment: string;
  split: "train" | "validation" | "test" | "formal";
  candidate: RelationalDecisionCandidateV1;
  relationValues?: Record<string, number[]>;
  incumbentSearchScore: number;
  shortUtility: number;
  terminalUtility: 0 | .5 | 1;
}

export interface ManagerProgramEvaluationV3 {
  decisions: number;
  pairwiseAccuracy: number;
  terminalBrier: number;
  calibrationError: number;
  complexity: number;
}

export interface ManagerProgramEvolutionV3 {
  program: ManagerProgramV3;
  proposals: number;
  accepted: number;
  rejected: number;
  discovery: {before: ManagerProgramEvaluationV3; after: ManagerProgramEvaluationV3};
  validation: {before: ManagerProgramEvaluationV3; after: ManagerProgramEvaluationV3};
}

export interface ManagerProgramPromotionV3 {
  eligible: boolean;
  accuracyGain: number;
  clusterBootstrapProbability: number;
  reasons: string[];
  program: ManagerProgramEvaluationV3;
  incumbent: ManagerProgramEvaluationV3;
}

export function noviceManagerProgramV3(managerId: string, evidence: ManagerProgramV3["evidence"]): ManagerProgramV3 {
  const program: ManagerProgramV3 = {schemaVersion: 3, language: MANAGER_PROGRAM_V3_LANGUAGE, activationStatus: "shadow-only", domain: "switch", managerId, revision: 0, rules: [], limits: MANAGER_PROGRAM_V3_LIMITS, evidence: {...evidence}, ancestry: []};
  validateManagerProgramV3(program);
  return program;
}

export function evaluateManagerProgramV3(program: ManagerProgramV3, candidate: RelationalDecisionCandidateV1, relationValues: Record<string, number[]> = {}): {score: number; evaluatedItems: number; matchedRules: string[]} {
  validateManagerProgramV3(program);
  return evaluateManagerProgramV3Unchecked(program, candidate, relationValues);
}

function evaluateManagerProgramV3Unchecked(program: ManagerProgramV3, candidate: RelationalDecisionCandidateV1, relationValues: Record<string, number[]>): {score: number; evaluatedItems: number; matchedRules: string[]} {
  let score = 0, evaluatedItems = 0;
  const matchedRules: string[] = [];
  for (const rule of program.rules) {
    const conditionResults: boolean[] = [];
    for (const condition of rule.conditions) {
      if (++evaluatedItems > program.limits.maxEvaluatedItems) throw new Error("Manager Program V3 evaluation budget exceeded");
      const value = relationalValue(candidate, relationValues, condition.path, condition.reducer, condition.auxiliaryThreshold);
      conditionResults.push(value !== null && (condition.operator === "gte" ? value >= condition.threshold : value < condition.threshold));
    }
    if (!conditionResults.every(Boolean)) continue;
    matchedRules.push(rule.id);
    for (const term of rule.terms) {
      if (++evaluatedItems > program.limits.maxEvaluatedItems) throw new Error("Manager Program V3 evaluation budget exceeded");
      const value = relationalValue(candidate, relationValues, term.path, term.reducer, term.auxiliaryThreshold);
      if (value === null) continue;
      score += term.weight * (term.transform === "hinge" ? Math.max(0, value - (term.hinge ?? 0)) : value);
    }
  }
  return {score: round(clamp(score, -8, 8)), evaluatedItems, matchedRules};
}

export function evolveManagerProgramV3(input: {program: ManagerProgramV3; discovery: readonly RelationalCandidateSampleV3[]; validation: readonly RelationalCandidateSampleV3[]; population?: readonly ManagerProgramV3[]; seed: string; generations?: number}): ManagerProgramEvolutionV3 {
  validateSamples(input.discovery, "train"); validateSamples(input.validation, "validation");
  let program = structuredClone(input.program), accepted = 0, rejected = 0;
  const beforeDiscovery = evaluateProgram(program, input.discovery), beforeValidation = evaluateProgram(program, input.validation); let currentDiscovery = beforeDiscovery, currentValidation = beforeValidation;
  const generations = integer(input.generations ?? 24, 1, 256, "generations"), mutationContext = {samples: input.discovery, paths: discoveredPathOrder(input.discovery)};
  for (let generation = 0; generation < generations; generation += 1) {
    const proposal = mutateProgram(program, mutationContext, input.population ?? [], `${input.seed}:${generation}`), nextDiscovery = evaluateProgram(proposal, input.discovery), nextValidation = evaluateProgram(proposal, input.validation);
    const shortImproves = nextValidation.pairwiseAccuracy > currentValidation.pairwiseAccuracy + 1e-9;
    const brierSafe = nextValidation.terminalBrier <= currentValidation.terminalBrier + .002 + 1e-12;
    const qualityImproves = nextDiscovery.pairwiseAccuracy > currentDiscovery.pairwiseAccuracy || nextDiscovery.terminalBrier < currentDiscovery.terminalBrier || nextDiscovery.calibrationError < currentDiscovery.calibrationError || nextValidation.terminalBrier < currentValidation.terminalBrier || nextValidation.calibrationError < currentValidation.calibrationError;
    const dominatedByCurrent = paretoDominates(currentDiscovery, nextDiscovery) && paretoDominates(currentValidation, nextValidation);
    if (shortImproves && brierSafe && qualityImproves && !dominatedByCurrent) { program = proposal; currentDiscovery = nextDiscovery; currentValidation = nextValidation; accepted += 1; } else rejected += 1;
  }
  validateManagerProgramV3(program);
  return {program, proposals: accepted + rejected, accepted, rejected, discovery: {before: beforeDiscovery, after: currentDiscovery}, validation: {before: beforeValidation, after: currentValidation}};
}

export function evaluateProgram(program: ManagerProgramV3, samples: readonly RelationalCandidateSampleV3[], useIncumbent = false): ManagerProgramEvaluationV3 {
  validateManagerProgramV3(program);
  const groups = groupDecisions(samples); let correct = 0, pairs = 0, brier = 0, calibration = 0;
  for (const group of groups.values()) {
    const scored = group.map(sample => ({sample, score: useIncumbent ? sample.incumbentSearchScore : evaluateManagerProgramV3Unchecked(program, sample.candidate, sample.relationValues ?? {}).score}));
    for (let left = 0; left < scored.length; left += 1) for (let right = left + 1; right < scored.length; right += 1) {
      const truth = Math.sign(scored[left].sample.shortUtility - scored[right].sample.shortUtility); if (!truth) continue;
      const predicted = Math.sign(scored[left].score - scored[right].score); pairs += 1; if (predicted === truth) correct += 1; else if (!predicted) correct += .5;
    }
    const selected = [...scored].sort((a, b) => b.score - a.score || a.sample.candidateId.localeCompare(b.sample.candidateId))[0];
    const probability = logistic(selected.score), outcome = selected.sample.terminalUtility;
    brier += (probability - outcome) ** 2; calibration += Math.abs(probability - outcome);
  }
  const decisions = groups.size;
  return {decisions, pairwiseAccuracy: round(pairs ? correct / pairs : .5), terminalBrier: round(decisions ? brier / decisions : .25), calibrationError: round(decisions ? calibration / decisions : .5), complexity: programComplexity(program)};
}

export function assessManagerProgramV3Promotion(program: ManagerProgramV3, test: readonly RelationalCandidateSampleV3[], seed = "v3-promotion", bootstrapIterations = 1000, teacherQualified = true): ManagerProgramPromotionV3 {
  validateSamples(test, "test");
  const evaluated = evaluateProgram(program, test), incumbent = evaluateProgram(program, test, true), accuracyGain = round(evaluated.pairwiseAccuracy - incumbent.pairwiseAccuracy);
  const families = [...new Set(test.map(sample => sample.familyId))].sort(), gains = families.map(family => evaluateProgram(program, test.filter(sample => sample.familyId === family)).pairwiseAccuracy - evaluateProgram(program, test.filter(sample => sample.familyId === family), true).pairwiseAccuracy);
  let wins = 0;
  for (let iteration = 0; iteration < bootstrapIterations; iteration += 1) { let sum = 0; for (let draw = 0; draw < gains.length; draw += 1) sum += gains[Math.floor(hashUnit(`${seed}:${iteration}:${draw}`) * gains.length)]; if (sum / Math.max(1, gains.length) >= .03) wins += 1; }
  const clusterBootstrapProbability = round(wins / bootstrapIterations), reasons: string[] = [];
  if (accuracyGain < .03) reasons.push("untouched-test-accuracy-gain-below-0.03");
  if (clusterBootstrapProbability <= .9) reasons.push("family-bootstrap-probability-not-above-0.9");
  if (!teacherQualified) reasons.push("short-horizon-teacher-unqualified");
  return {eligible: !reasons.length, accuracyGain, clusterBootstrapProbability, reasons, program: evaluated, incumbent};
}

export function managerProgramV3Hash(program: ManagerProgramV3): string { validateManagerProgramV3(program); return digest(program); }

export function validateManagerProgramV3(program: ManagerProgramV3): void {
  if (program.schemaVersion !== 3 || program.language !== MANAGER_PROGRAM_V3_LANGUAGE || program.activationStatus !== "shadow-only" || program.domain !== "switch" || !program.managerId || !Number.isInteger(program.revision) || program.revision < 0) throw new Error("Invalid Manager Program V3 envelope");
  if (JSON.stringify(program.limits) !== JSON.stringify(MANAGER_PROGRAM_V3_LIMITS) || !hex(program.evidence.corpusSignature) || !hex(program.evidence.familySplitSignature) || program.evidence.encoderVersion !== RELATIONAL_ENCODER_VERSION || program.rules.length > program.limits.maxRules || new Set(program.rules.map(rule => rule.id)).size !== program.rules.length) throw new Error(`Invalid Manager Program V3 binding: ${program.managerId}`);
  for (const rule of program.rules) {
    if (!rule.id || rule.conditions.length > program.limits.maxConditions || !rule.terms.length || rule.terms.length > program.limits.maxTerms || !["mutate", "delete", "replace", "crossover"].includes(rule.lineage.operation) || rule.lineage.parents.some(parent => !hex(parent))) throw new Error(`Invalid Manager Program V3 rule: ${rule.id}`);
    for (const condition of rule.conditions) validateExpression(condition.path, condition.reducer, condition.threshold, condition.auxiliaryThreshold);
    for (const term of rule.terms) { validateExpression(term.path, term.reducer, term.weight, term.auxiliaryThreshold); if (!["linear", "hinge"].includes(term.transform) || Math.abs(term.weight) > 4 || term.hinge !== undefined && (!Number.isFinite(term.hinge) || Math.abs(term.hinge) > 1)) throw new Error(`Invalid Manager Program V3 term: ${rule.id}`); }
  }
  if (program.ancestry.some(value => !hex(value))) throw new Error(`Invalid Manager Program V3 ancestry: ${program.managerId}`);
}

function mutateProgram(program: ManagerProgramV3, context: {samples: readonly RelationalCandidateSampleV3[]; paths: readonly string[]}, population: readonly ManagerProgramV3[], seed: string): ManagerProgramV3 {
  const {samples, paths} = context, next = structuredClone(program), operationIndex = Math.floor(hashUnit(`${seed}:operation`) * 4), path = paths[Math.floor(hashUnit(`${seed}:path`) * paths.length)] ?? `candidate.${RELATIONAL_SWITCH_FEATURES[0]}`;
  const termReducer = path.startsWith("candidate.") ? "identity" : reducerFromSeed(`${seed}:term-reducer`), termAuxiliary = auxiliaryThreshold(samples, path, termReducer, `${seed}:term-auxiliary`), termValues = samples.map(sample => samplePathValue(sample, path, termReducer, termAuxiliary)).filter((value): value is number => value !== null), termThreshold = quantileFromSeed(termValues, `${seed}:term-threshold`);
  const correlation = covariance(samples.map(sample => [samplePathValue(sample, path, termReducer, termAuxiliary), sample.shortUtility] as const).filter((entry): entry is readonly [number, number] => entry[0] !== null));
  const weight = clamp((correlation < 0 ? -1 : 1) * (.15 + hashUnit(`${seed}:weight`) * 1.35), -2, 2), parentHash = managerProgramV3Hash(program);
  if (operationIndex === 1 && next.rules.length) next.rules.splice(Math.floor(hashUnit(`${seed}:delete`) * next.rules.length), 1);
  else if (operationIndex === 3 && population.length) {
    const donor = population[Math.floor(hashUnit(`${seed}:donor`) * population.length)];
    if (donor.rules.length && next.rules.length < next.limits.maxRules) next.rules.push({...structuredClone(donor.rules[Math.floor(hashUnit(`${seed}:donor-rule`) * donor.rules.length)]), lineage: {operation: "crossover", parents: [parentHash, managerProgramV3Hash(donor)], evidenceClusters: evidenceClusters(samples, seed)}});
  } else {
    const conditionCount = Math.floor(hashUnit(`${seed}:condition-count`) * (next.limits.maxConditions + 1));
    const conditions = Array.from({length: conditionCount}, (_, index): ManagerProgramConditionV3 => {
      const conditionPath = paths[(paths.indexOf(path) + index) % paths.length], reducer = conditionPath.startsWith("candidate.") ? "identity" : reducerFromSeed(`${seed}:condition-reducer:${index}`), auxiliary = auxiliaryThreshold(samples, conditionPath, reducer, `${seed}:condition-auxiliary:${index}`), threshold = quantileFromSeed(samples.map(sample => samplePathValue(sample, conditionPath, reducer, auxiliary)).filter((value): value is number => value !== null), `${seed}:condition-threshold:${index}`);
      return {path: conditionPath, reducer, operator: hashUnit(`${seed}:operator:${index}`) < .5 ? "gte" : "lt", threshold, ...(auxiliary !== undefined ? {auxiliaryThreshold: auxiliary} : {})};
    });
    const term: ManagerProgramTermV3 = {path, reducer: termReducer, transform: hashUnit(`${seed}:transform`) < .5 ? "linear" : "hinge", weight, ...(termAuxiliary !== undefined ? {auxiliaryThreshold: termAuxiliary} : {}), ...(hashUnit(`${seed}:transform`) >= .5 ? {hinge: termThreshold} : {})};
    const operation = operationIndex === 2 && next.rules.length ? "replace" : "mutate";
    const ruleBase = {conditions, terms: [term], lineage: {operation, parents: [parentHash], evidenceClusters: evidenceClusters(samples, seed)}} satisfies Omit<ManagerProgramRuleV3, "id">;
    const rule: ManagerProgramRuleV3 = {...ruleBase, id: `mp3-${digest(ruleBase).slice(0, 20)}`};
    if (operation === "replace") next.rules[Math.floor(hashUnit(`${seed}:replace`) * next.rules.length)] = rule; else if (next.rules.length < next.limits.maxRules) next.rules.push(rule); else next.rules[Math.floor(hashUnit(`${seed}:replace-full`) * next.rules.length)] = rule;
  }
  next.revision += 1; next.ancestry = [...new Set([...next.ancestry, parentHash])].slice(-64);
  next.rules = deduplicateRules(next.rules).slice(0, next.limits.maxRules);
  return next;
}

function relationalValue(candidate: RelationalDecisionCandidateV1, relations: Record<string, number[]>, path: string, reducer: RelationalReducer, auxiliaryThreshold?: number): number | null {
  const feature = path.startsWith("candidate.") ? path.slice("candidate.".length) as RelationalSwitchFeature : null;
  let values: number[];
  if (feature && RELATIONAL_SWITCH_FEATURES.includes(feature)) { if (!relationalKnown(candidate.knownMask, feature)) return null; values = [candidate.values[feature]]; }
  else values = relations[path]?.filter(Number.isFinite) ?? [];
  if (!values.length) return null;
  if (reducer === "identity") return values[0]; if (reducer === "min") return Math.min(...values); if (reducer === "max") return Math.max(...values); if (reducer === "mean") return average(values);
  if (reducer === "weightedMean") return values.reduce((sum, value, index) => sum + value * (index + 1), 0) / (values.length * (values.length + 1) / 2);
  return values.filter(value => value >= (auxiliaryThreshold ?? 0)).length / values.length;
}

function validateExpression(path: string, reducer: RelationalReducer, numeric: number, auxiliary?: number): void { const candidate = path.startsWith("candidate.") ? path.slice("candidate.".length) : null, validPath = candidate ? RELATIONAL_SWITCH_FEATURES.includes(candidate as RelationalSwitchFeature) : MANAGER_PROGRAM_V3_RELATION_PATHS.includes(path as typeof MANAGER_PROGRAM_V3_RELATION_PATHS[number]); if (!validPath || !["identity", "min", "max", "mean", "weightedMean", "countAbove"].includes(reducer) || !Number.isFinite(numeric) || auxiliary !== undefined && !Number.isFinite(auxiliary)) throw new Error(`Invalid Manager Program V3 expression: ${path}`); }
function validateSamples(samples: readonly RelationalCandidateSampleV3[], split: RelationalCandidateSampleV3["split"]): void { if (!samples.length || new Set(samples.map(sample => `${sample.decisionId}\0${sample.candidateId}`)).size !== samples.length || samples.some(sample => sample.split !== split || !sample.decisionId || !sample.familyId || !sample.clusterId || !sample.environment || !Number.isFinite(sample.incumbentSearchScore) || !Number.isFinite(sample.shortUtility) || sample.shortUtility < -1 || sample.shortUtility > 1 || ![0, .5, 1].includes(sample.terminalUtility))) throw new Error(`Invalid Manager Program V3 ${split} samples`); }
function groupDecisions(samples: readonly RelationalCandidateSampleV3[]): Map<string, RelationalCandidateSampleV3[]> { const groups = new Map<string, RelationalCandidateSampleV3[]>(); for (const sample of samples) { const group = groups.get(sample.decisionId) ?? []; group.push(sample); groups.set(sample.decisionId, group); } return groups; }
function discoveredPathOrder(samples: readonly RelationalCandidateSampleV3[]): string[] { const availableRelations = MANAGER_PROGRAM_V3_RELATION_PATHS.filter(path => samples.some(sample => (sample.relationValues?.[path]?.length ?? 0) > 0)), paths = [...RELATIONAL_SWITCH_FEATURES.map(feature => `candidate.${feature}`), ...availableRelations]; return paths.sort((a, b) => pathSignal(samples, b) - pathSignal(samples, a) || a.localeCompare(b)); }
function pathSignal(samples: readonly RelationalCandidateSampleV3[], path: string): number { return Math.abs(covariance(samples.map(sample => [samplePathValue(sample, path, path.startsWith("candidate.") ? "identity" : "mean"), sample.shortUtility] as const).filter((entry): entry is readonly [number, number] => entry[0] !== null))); }
function samplePathValue(sample: RelationalCandidateSampleV3, path: string, reducer: RelationalReducer, auxiliary?: number): number | null { return relationalValue(sample.candidate, sample.relationValues ?? {}, path, reducer, auxiliary); }
function auxiliaryThreshold(samples: readonly RelationalCandidateSampleV3[], path: string, reducer: RelationalReducer, seed: string): number | undefined { if (reducer !== "countAbove") return undefined; const values = samples.flatMap(sample => path.startsWith("candidate.") ? [samplePathValue(sample, path, "identity")].filter((value): value is number => value !== null) : (sample.relationValues?.[path] ?? []).filter(Number.isFinite)); return quantileFromSeed(values, seed); }
function quantileFromSeed(values: readonly number[], seed: string): number { const ordered = [...values].sort((a, b) => a - b); return ordered.length ? ordered[Math.floor(hashUnit(seed) * ordered.length)] : 0; }
function evidenceClusters(samples: readonly RelationalCandidateSampleV3[], seed: string): string[] { return [...new Set(samples.filter(sample => hashUnit(`${seed}:${sample.clusterId}`) < .2).map(sample => sample.clusterId))].sort().slice(0, 32); }
function deduplicateRules(rules: readonly ManagerProgramRuleV3[]): ManagerProgramRuleV3[] { const seen = new Set<string>(); return rules.filter(rule => { const key = digest([rule.conditions, rule.terms]); if (seen.has(key)) return false; seen.add(key); return true; }); }
function paretoDominates(left: ManagerProgramEvaluationV3, right: ManagerProgramEvaluationV3): boolean { const noWorse = left.pairwiseAccuracy >= right.pairwiseAccuracy && left.terminalBrier <= right.terminalBrier && left.calibrationError <= right.calibrationError && left.complexity <= right.complexity; const better = left.pairwiseAccuracy > right.pairwiseAccuracy || left.terminalBrier < right.terminalBrier || left.calibrationError < right.calibrationError || left.complexity < right.complexity; return noWorse && better; }
function programComplexity(program: ManagerProgramV3): number { return program.rules.reduce((sum, rule) => sum + 1 + rule.conditions.length + rule.terms.length, 0); }
function reducerFromSeed(seed: string): RelationalReducer { const values: RelationalReducer[] = ["identity", "min", "max", "mean", "weightedMean", "countAbove"]; return values[Math.floor(hashUnit(seed) * values.length)]; }
function covariance(values: readonly (readonly [number, number])[]): number { if (!values.length) return 0; const x = average(values.map(value => value[0])), y = average(values.map(value => value[1])); return average(values.map(value => (value[0] - x) * (value[1] - y))); }
function logistic(value: number): number { return 1 / (1 + Math.exp(-value)); }
function average(values: readonly number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function digest(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function hex(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
function hashUnit(value: string): number { return Number.parseInt(digest(value).slice(0, 12), 16) / 0xffffffffffff; }
function integer(value: number, minimum: number, maximum: number, label: string): number { if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${label} must be ${minimum}..${maximum}`); return value; }
