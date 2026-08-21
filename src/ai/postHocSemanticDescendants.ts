import crypto from "node:crypto";
import {formalMechanismKey, formalMechanismSemanticKey} from "./formalValidation";
import type {FormalSemanticDomainDiagnostic, FormalSemanticDiagnostics, FormalSemanticPredicate} from "./formalSemanticDiagnostics";
import type {ManagerProgramPredicate, ManagerProgramRuleV2, ManagerProgramSampleV2, ManagerProgramV2} from "./managerProgramV2";
import {validateSemanticRevisionRule} from "./semanticHypothesisRevision";

export interface PostHocSemanticDescendant {
  rule: ManagerProgramRuleV2;
  domainId: string;
  independentDiscoverySamples: number;
  independentValidationSamples: number;
  independentDiscoveryClusters: number;
  independentValidationClusters: number;
  discoveryMean: number;
  validationMean: number;
  applicability: number;
  observationalScore: number;
}

export type SemanticResearchDisposition = "explore" | "replicate" | "stage5-screen" | "retire";

export interface PostHocDiagnosticSeedReadiness {
  eligible: boolean;
  decisive: number;
  supports: number;
  contradictions: number;
  minimumDecisive: 5;
  minimumSupports: 2;
  reasons: string[];
}

export function assessPostHocDiagnosticSeed(domain: FormalSemanticDomainDiagnostic): PostHocDiagnosticSeedReadiness {
  const minimumDecisive = 5 as const, minimumSupports = 2 as const;
  const supports = domain.outcomes.support, contradictions = domain.outcomes.contradiction, decisive = supports + contradictions, reasons: string[] = [];
  if (decisive < minimumDecisive) reasons.push("insufficient-decisive-counterexamples");
  if (supports < minimumSupports) reasons.push("insufficient-support-shape");
  if (contradictions < 1) reasons.push("no-counterexample-boundary");
  return {eligible: reasons.length === 0, decisive, supports, contradictions, minimumDecisive, minimumSupports, reasons};
}

export function derivePostHocSemanticDescendants(input: {
  parent: ManagerProgramRuleV2;
  diagnostic: FormalSemanticDiagnostics;
  domain: FormalSemanticDomainDiagnostic;
  samples: readonly ManagerProgramSampleV2[];
  seed: string;
  maxPredicates?: number;
  limit?: number;
}): PostHocSemanticDescendant[] {
  const maxPredicates = integer(input.maxPredicates ?? 2, 1, 3), limit = integer(input.limit ?? 12, 1, 32);
  const samples = input.samples.filter(sample => sample.domain === "battle" && sample.action === input.parent.target);
  if (samples.length < 26 || input.domain.domainId === "" || !assessPostHocDiagnosticSeed(input.domain).eligible) return [];
  const shapes = hypothesisShapes(input.domain, maxPredicates), proposals = new Map<string, ManagerProgramPredicate[]>();
  for (const shape of shapes) {
    const thresholds = shape.map(predicate => independentThresholds(samples, predicate.feature));
    if (thresholds.some(values => !values.length)) continue;
    for (const predicates of products(shape, thresholds)) proposals.set(predicateIdentity(predicates), predicates);
  }
  const expectedSign = Math.sign(input.parent.effect), excludedSourceSetSha256 = digest(input.diagnostic.excludedValidationFingerprints), ranked: PostHocSemanticDescendant[] = [];
  for (const predicates of proposals.values()) {
    const matching = samples.filter(sample => predicates.every(predicate => matches(predicate, sample.features))), discovery = matching.filter(sample => split(sample.clusterId, `${input.seed}:discovery`) < .7), validation = matching.filter(sample => split(sample.clusterId, `${input.seed}:discovery`) >= .7);
    const discoveryClusters = new Set(discovery.map(sample => sample.clusterId)).size, validationClusters = new Set(validation.map(sample => sample.clusterId)).size;
    if (discovery.length < 18 || validation.length < 8 || discoveryClusters < 6 || validationClusters < 3) continue;
    const discoveryMean = mean(discovery.map(sample => sample.localValueDelta)), validationMean = mean(validation.map(sample => sample.localValueDelta));
    if (Math.sign(discoveryMean) !== expectedSign || Math.sign(validationMean) !== expectedSign || Math.abs(validationMean) < .01) continue;
    const pooledMean = mean(matching.map(sample => sample.localValueDelta)), effect = round(clamp(pooledMean * matching.length / (matching.length + 20), -.35, .35));
    if (!effect || Math.sign(effect) !== expectedSign) continue;
    const variance = mean(matching.map(sample => (sample.localValueDelta - pooledMean) ** 2)), uncertainty = round(clamp(Math.sqrt(variance / matching.length), 0, 1));
    const evidenceIds = discovery.slice(0, 24).concat(validation.slice(0, 8)).map(sample => sample.id), evidenceSha256 = digest({parent: input.parent.id, predicates, discovery: discovery.map(sample => sample.id), validation: validation.map(sample => sample.id)}), shapeSha256 = digest(predicates.map(({feature, operator}) => ({feature, operator})));
    const operation = revisionOperation(input.parent.predicates, predicates), rule: ManagerProgramRuleV2 = {id: `atlas-child-${digest([input.parent.id, predicates, effect, evidenceSha256, input.diagnostic.sha256]).slice(0, 20)}`, domain: "battle", target: input.parent.target, predicates, effect, support: matching.length, uncertainty, authority: "local-value-observational", evidenceIds, lineage: {kind: "semantic-revision", parentRuleId: input.parent.id, parentMechanismKey: formalMechanismKey(input.parent), operation, evidenceSha256, hypothesisSeed: {authority: "post-hoc-hypothesis-generation-only", diagnosticSha256: input.diagnostic.sha256, domainId: input.domain.domainId, shapeSha256, excludedSourceSetSha256}}};
    if (formalMechanismSemanticKey(rule) === formalMechanismSemanticKey(input.parent)) continue;
    validateSemanticRevisionRule(rule, input.parent);
    const agreement = Math.min(Math.abs(discoveryMean), Math.abs(validationMean)), drift = Math.abs(discoveryMean - validationMean), observationalScore = round(agreement * Math.log1p(matching.length) / (1 + drift + uncertainty));
    ranked.push({rule, domainId: input.domain.domainId, independentDiscoverySamples: discovery.length, independentValidationSamples: validation.length, independentDiscoveryClusters: discoveryClusters, independentValidationClusters: validationClusters, discoveryMean: round(discoveryMean), validationMean: round(validationMean), applicability: round(matching.length / samples.length), observationalScore});
  }
  ranked.sort((left, right) => right.observationalScore - left.observationalScore || right.independentValidationSamples - left.independentValidationSamples || left.rule.id.localeCompare(right.rule.id));
  const selected: PostHocSemanticDescendant[] = [], add = (value: PostHocSemanticDescendant | undefined) => { if (value && !selected.some(row => row.rule.id === value.rule.id) && selected.length < limit) selected.push(value); };
  add(ranked[0]); add(ranked.find(value => value.applicability < .25)); add(ranked.find(value => value.applicability >= .25 && value.applicability < .65)); add(ranked.find(value => value.applicability >= .65));
  for (const shape of [...new Set(ranked.map(value => value.rule.predicates.map(predicate => `${predicate.feature}:${predicate.operator}`).join("&")))]) add(ranked.find(value => value.rule.predicates.map(predicate => `${predicate.feature}:${predicate.operator}`).join("&") === shape));
  for (const value of ranked) add(value);
  return selected;
}

export function selectManagerSemanticDescendant(program: ManagerProgramV2, candidates: readonly ManagerProgramRuleV2[], seed: string): ManagerProgramRuleV2 | null {
  if (!candidates.length) return null;
  return [...candidates].sort((left, right) => managerSemanticPreference(program, right, seed) - managerSemanticPreference(program, left, seed) || left.id.localeCompare(right.id))[0];
}

export function assignManagerSemanticDescendants(programs: readonly ManagerProgramV2[], candidates: readonly ManagerProgramRuleV2[], seed: string): Map<string, ManagerProgramRuleV2> {
  const assignments = new Map<string, ManagerProgramRuleV2>(); if (!programs.length || !candidates.length) return assignments;
  const available = new Set(programs.map(program => program.managerId)), byId = new Map(programs.map(program => [program.managerId, program])), load = new Map(candidates.map(candidate => [candidate.id, 0]));
  for (const candidate of candidates) {
    const manager = [...available].map(id => byId.get(id)!).sort((left, right) => managerSemanticPreference(right, candidate, seed) - managerSemanticPreference(left, candidate, seed) || left.managerId.localeCompare(right.managerId))[0];
    if (!manager) break; assignments.set(manager.managerId, candidate); available.delete(manager.managerId); load.set(candidate.id, 1);
  }
  for (const manager of [...available].map(id => byId.get(id)!).sort((left, right) => hashUnit(`${seed}:${left.managerId}:allocation-order`) - hashUnit(`${seed}:${right.managerId}:allocation-order`) || left.managerId.localeCompare(right.managerId))) {
    const selected = [...candidates].sort((left, right) => allocationScore(manager, right) - allocationScore(manager, left) || left.id.localeCompare(right.id))[0]; assignments.set(manager.managerId, selected); load.set(selected.id, (load.get(selected.id) ?? 0) + 1);
  }
  return assignments;
  function allocationScore(program: ManagerProgramV2, rule: ManagerProgramRuleV2): number { return managerSemanticPreference(program, rule, seed) - Math.log1p(load.get(rule.id) ?? 0) * .18; }
}

function managerSemanticPreference(program: ManagerProgramV2, rule: ManagerProgramRuleV2, seed: string): number {
  const featureUse = new Map<string, number>(), targetUse = new Map<string, number>();
  for (const rule of program.rules) { targetUse.set(rule.target, (targetUse.get(rule.target) ?? 0) + 1); for (const predicate of rule.predicates) featureUse.set(predicate.feature, (featureUse.get(predicate.feature) ?? 0) + 1); }
  const historyFeatures = new Set(program.history.flatMap(entry => entry.predicates.map(predicate => predicate.feature)));
  const familiar = rule.predicates.reduce((sum, predicate) => sum + Math.log1p(featureUse.get(predicate.feature) ?? 0), 0), researched = rule.predicates.filter(predicate => historyFeatures.has(predicate.feature)).length, target = Math.log1p(targetUse.get(rule.target) ?? 0), structural = rule.predicates.filter(predicate => /role|structure|blindSpot|answerRedundancy/i.test(predicate.feature)).length;
  return round(familiar * .3 + researched * .2 + target * .2 + structural * .1 + (1 - rule.uncertainty) * .15 + hashUnit(`${seed}:${program.managerId}:${rule.id}:explore`) * .2);
}

export function classifySemanticResearchEvidence(input: {supports: number; contradictions: number; neutral: number; managers: number; supportingManagers: number; independentSources: number}): SemanticResearchDisposition {
  if (input.contradictions >= 2 || input.supports === 0 && input.supports + input.contradictions + input.neutral >= 6) return "retire";
  if (input.supports >= 2 && input.contradictions === 0 && input.supportingManagers >= 2 && input.independentSources >= 4) return "stage5-screen";
  if (input.supports >= 1 && input.contradictions === 0 && input.independentSources >= 2) return "replicate";
  return "explore";
}

function hypothesisShapes(domain: FormalSemanticDomainDiagnostic, maxPredicates: number): Array<Array<Pick<FormalSemanticPredicate, "feature" | "operator">>> {
  const hints = [...domain.interactionHints, ...domain.singleConditionHints].filter(hint => hint.supportsInside > hint.contradictionsInside && hint.supportCoverage >= .5), result = new Map<string, Array<Pick<FormalSemanticPredicate, "feature" | "operator">>>();
  for (const hint of hints) { const shape = hint.predicates.slice(0, maxPredicates).map(({feature, operator}) => ({feature, operator})).sort((a, b) => a.feature.localeCompare(b.feature) || a.operator.localeCompare(b.operator)); if (shape.length) result.set(shape.map(value => `${value.feature}:${value.operator}`).join("&"), shape); }
  return [...result.values()].slice(0, 8);
}
function independentThresholds(samples: readonly ManagerProgramSampleV2[], feature: string): number[] { const values = samples.map(sample => sample.features[feature]).filter(Number.isFinite).sort((a, b) => a - b); if (values.length < 12) return []; const unique = [...new Set(values)], quantile = (rows: number[], q: number) => round(rows[Math.min(rows.length - 1, Math.floor((rows.length - 1) * q))]); return [...new Set([.1, .25, .4, .5, .6, .75, .9].flatMap(q => [quantile(values, q), quantile(unique, q)]))].filter(value => value > values[0] && value < values.at(-1)!); }
function products(shapes: Array<Pick<FormalSemanticPredicate, "feature" | "operator">>, thresholds: number[][]): ManagerProgramPredicate[][] { let rows: ManagerProgramPredicate[][] = [[]]; for (let index = 0; index < shapes.length; index += 1) rows = rows.flatMap(row => thresholds[index].map(threshold => [...row, {...shapes[index], threshold}])); return rows.map(row => row.sort((a, b) => a.feature.localeCompare(b.feature) || a.operator.localeCompare(b.operator) || a.threshold - b.threshold)); }
function revisionOperation(parent: readonly ManagerProgramPredicate[], child: readonly ManagerProgramPredicate[]): "tighten-boundary" | "add-context" | "replace-context" { const parentFeatures = new Set(parent.map(value => value.feature)), childFeatures = new Set(child.map(value => value.feature)); if (child.every(value => parentFeatures.has(value.feature))) return "tighten-boundary"; if ([...parentFeatures].every(value => childFeatures.has(value)) && child.length > parent.length) return "add-context"; return "replace-context"; }
function predicateIdentity(values: readonly ManagerProgramPredicate[]): string { return values.map(value => `${value.feature}:${value.operator}:${value.threshold}`).join("|"); }
function matches(predicate: ManagerProgramPredicate, features: Record<string, number>): boolean { const value = features[predicate.feature]; return Number.isFinite(value) && (predicate.operator === "gte" ? value >= predicate.threshold : value < predicate.threshold); }
function split(clusterId: string, seed: string): number { return Number.parseInt(digest(`${seed}:${clusterId}`).slice(0, 12), 16) / 0xffffffffffff; }
function hashUnit(value: string): number { return Number.parseInt(digest(value).slice(0, 12), 16) / 0xffffffffffff; }
function mean(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function integer(value: number, minimum: number, maximum: number): number { if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`integer must be ${minimum}..${maximum}`); return value; }
function digest(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
