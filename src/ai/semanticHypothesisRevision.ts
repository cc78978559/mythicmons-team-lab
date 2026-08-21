import crypto from "node:crypto";
import {formalMechanismKey, formalMechanismSemanticKey} from "./formalValidation";
import {MANAGER_PROGRAM_V2_LANGUAGE, validateManagerProgramV2, type ManagerProgramPredicate, type ManagerProgramRuleV2, type ManagerProgramSampleV2, type ManagerProgramV2} from "./managerProgramV2";

type SemanticRevisionOperation = NonNullable<ManagerProgramRuleV2["lineage"]>["operation"];

export interface SemanticRevisionCandidate {
  rule: ManagerProgramRuleV2;
  discoverySupport: number;
  validationSupport: number;
  discoveryClusters: number;
  validationClusters: number;
  discoveryMean: number;
  validationMean: number;
  score: number;
}

export const SEMANTIC_STRUCTURAL_FEATURES = new Set(["answerRedundancyDelta", "blindSpotResilienceDelta", "opponentStructureLoadDelta", "opponentStructureResponseDelta", "roleBreadthDelta", "roleCompressionDelta", "structuralSinglePointDelta"]);

export function deriveSemanticHypothesisRevisions(input: {
  parent: ManagerProgramRuleV2;
  samples: readonly ManagerProgramSampleV2[];
  seed: string;
  maxPredicates?: number;
  limit?: number;
}): SemanticRevisionCandidate[] {
  validateParent(input.parent);
  const maxPredicates = integer(input.maxPredicates ?? 2, 1, 3, "maxPredicates"), limit = integer(input.limit ?? 4, 1, 16, "limit");
  const targetSamples = input.samples.filter(sample => sample.domain === "battle" && sample.action === input.parent.target);
  const featureNames = [...new Set(targetSamples.flatMap(sample => Object.keys(sample.features)))].sort();
  const thresholds = new Map(featureNames.map(feature => [feature, quantiles(targetSamples.map(sample => sample.features[feature]).filter(Number.isFinite))]));
  const proposals = new Map<string, {predicates: ManagerProgramPredicate[]; operation: SemanticRevisionOperation}>();
  const add = (predicates: ManagerProgramPredicate[], operation: "tighten-boundary" | "add-context" | "replace-context") => {
    const normalized = normalizePredicates(predicates);
    if (!normalized.length || normalized.length > maxPredicates || samePredicates(normalized, input.parent.predicates)) return;
    proposals.set(predicateIdentity(normalized), {predicates: normalized, operation});
  };

  for (let index = 0; index < input.parent.predicates.length; index += 1) {
    const current = input.parent.predicates[index];
    for (const threshold of thresholds.get(current.feature) ?? []) {
      const narrows = current.operator === "gte" ? threshold > current.threshold : threshold < current.threshold;
      if (!narrows) continue;
      const predicates = input.parent.predicates.map((value, predicateIndex) => predicateIndex === index ? {...value, threshold} : {...value});
      add(predicates, "tighten-boundary");
    }
  }

  for (const feature of featureNames.filter(value => !input.parent.predicates.some(predicate => predicate.feature === value))) {
    for (const threshold of thresholds.get(feature) ?? []) for (const operator of ["gte", "lt"] as const) {
      const context = {feature, operator, threshold};
      if (input.parent.predicates.length < maxPredicates) add([...input.parent.predicates, context], "add-context");
      else for (let index = 0; index < input.parent.predicates.length; index += 1) add(input.parent.predicates.map((value, predicateIndex) => predicateIndex === index ? context : {...value}), "replace-context");
    }
  }

  const parentSemanticKey = formalMechanismSemanticKey(input.parent), expectedSign = Math.sign(input.parent.effect);
  const ranked = [...proposals.values()].flatMap(proposal => {
    const matching = targetSamples.filter(sample => proposal.predicates.every(predicate => matches(predicate, sample.features)));
    const discovery = matching.filter(sample => split(sample.clusterId, input.seed) < .7), validation = matching.filter(sample => split(sample.clusterId, input.seed) >= .7);
    const discoveryClusters = new Set(discovery.map(sample => sample.clusterId)).size, validationClusters = new Set(validation.map(sample => sample.clusterId)).size;
    if (discovery.length < 18 || validation.length < 8 || discoveryClusters < 6 || validationClusters < 3) return [];
    const discoveryMean = mean(discovery.map(sample => sample.localValueDelta)), validationMean = mean(validation.map(sample => sample.localValueDelta));
    if (Math.sign(discoveryMean) !== expectedSign || Math.sign(validationMean) !== expectedSign || Math.abs(validationMean) < .01) return [];
    const pooledMean = mean(matching.map(sample => sample.localValueDelta)), effect = round(clamp(pooledMean * matching.length / (matching.length + 20), -.35, .35));
    if (!effect || Math.sign(effect) !== expectedSign) return [];
    const variance = mean(matching.map(sample => (sample.localValueDelta - pooledMean) ** 2)), uncertainty = round(clamp(Math.sqrt(variance / matching.length), 0, 1));
    const evidenceIds = discovery.slice(0, 24).concat(validation.slice(0, 8)).map(sample => sample.id), evidenceSha256 = digest({parent: input.parent.id, predicates: proposal.predicates, discovery: discovery.map(sample => sample.id), validation: validation.map(sample => sample.id)});
    const rule: ManagerProgramRuleV2 = {id: `semantic-${digest([input.parent.id, proposal.predicates, effect, evidenceSha256]).slice(0, 20)}`, domain: "battle", target: input.parent.target, predicates: proposal.predicates, effect, support: matching.length, uncertainty, authority: "local-value-observational", evidenceIds, lineage: {kind: "semantic-revision", parentRuleId: input.parent.id, parentMechanismKey: formalMechanismKey(input.parent), operation: proposal.operation, evidenceSha256}};
    if (formalMechanismSemanticKey(rule) === parentSemanticKey) return [];
    const agreement = Math.min(Math.abs(discoveryMean), Math.abs(validationMean)), drift = Math.abs(discoveryMean - validationMean), score = round(agreement * Math.log1p(matching.length) / (1 + drift + uncertainty));
    return [{rule, discoverySupport: discovery.length, validationSupport: validation.length, discoveryClusters, validationClusters, discoveryMean: round(discoveryMean), validationMean: round(validationMean), score}];
  }).sort((left, right) => right.score - left.score || right.validationSupport - left.validationSupport || left.rule.id.localeCompare(right.rule.id));
  const selected: SemanticRevisionCandidate[] = [], addDistinct = (candidate: SemanticRevisionCandidate | undefined) => { if (candidate && !selected.some(value => value.rule.id === candidate.rule.id) && selected.length < limit) selected.push(candidate); };
  addDistinct(ranked[0]);
  addDistinct(ranked.find(candidate => candidate.rule.predicates.some(predicate => SEMANTIC_STRUCTURAL_FEATURES.has(predicate.feature))));
  for (const operation of ["tighten-boundary", "add-context", "replace-context"] as const) addDistinct(ranked.find(candidate => candidate.rule.lineage?.operation === operation));
  for (const candidate of ranked) addDistinct(candidate);
  return selected;
}

export function validateSemanticRevisionRule(rule: ManagerProgramRuleV2, parent: ManagerProgramRuleV2): void {
  const program: ManagerProgramV2 = {schemaVersion: 2, language: MANAGER_PROGRAM_V2_LANGUAGE, activationStatus: "shadow-only", managerId: "semantic-revision-audit", revision: 0, rules: [rule], history: [], limits: {maxRules: 1, maxPredicates: 3, maxEvaluatedRules: 1}, evidence: {decisionDossierPolicy: "semantic-revision-audit", positionModelSha256: "0".repeat(64), corpusSignature: "0".repeat(64)}};
  validateManagerProgramV2(program);
  if (rule.lineage?.parentRuleId !== parent.id || rule.lineage.parentMechanismKey !== formalMechanismKey(parent) || formalMechanismSemanticKey(rule) === formalMechanismSemanticKey(parent)) throw new Error(`Invalid semantic revision relation: ${rule.id}`);
}

function validateParent(parent: ManagerProgramRuleV2): void { if (parent.domain !== "battle" || !parent.id || !parent.predicates.length || !parent.effect) throw new Error("Semantic revision requires a directional battle parent"); }
function normalizePredicates(values: readonly ManagerProgramPredicate[]): ManagerProgramPredicate[] { return [...values].map(value => ({...value, threshold: round(value.threshold)})).sort((left, right) => left.feature.localeCompare(right.feature) || left.operator.localeCompare(right.operator) || left.threshold - right.threshold); }
function samePredicates(left: readonly ManagerProgramPredicate[], right: readonly ManagerProgramPredicate[]): boolean { return predicateIdentity(normalizePredicates(left)) === predicateIdentity(normalizePredicates(right)); }
function predicateIdentity(values: readonly ManagerProgramPredicate[]): string { return values.map(value => `${value.feature}:${value.operator}:${value.threshold}`).join("|"); }
function quantiles(values: number[]): number[] { if (values.length < 8) return []; const sorted = [...values].sort((a, b) => a - b); return [...new Set([.2, .35, .5, .65, .8].map(value => round(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * value))])))].filter(value => value > sorted[0] && value < sorted.at(-1)!); }
function matches(predicate: ManagerProgramPredicate, features: Record<string, number>): boolean { const value = features[predicate.feature]; return Number.isFinite(value) && (predicate.operator === "gte" ? value >= predicate.threshold : value < predicate.threshold); }
function split(clusterId: string, seed: string): number { return Number.parseInt(digest(`${seed}:${clusterId}`).slice(0, 12), 16) / 0xffffffffffff; }
function mean(values: readonly number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function digest(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function integer(value: number, minimum: number, maximum: number, label: string): number { if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${label} must be ${minimum}..${maximum}`); return value; }
