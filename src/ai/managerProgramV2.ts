import crypto from "node:crypto";

export const MANAGER_PROGRAM_V2_LANGUAGE = "manager-program-v2.0-conditional-mechanisms";

export type ManagerProgramDomain = "acquire" | "configure" | "lineup" | "battle" | "research";
export type ManagerProgramEvidenceAuthority = "historical-observational" | "local-value-observational" | "exact-counterfactual";
export type ManagerProgramPredicate = {feature: string; operator: "gte" | "lt"; threshold: number};

export interface ManagerProgramRuleV2 {
  id: string;
  domain: ManagerProgramDomain;
  target: string;
  predicates: ManagerProgramPredicate[];
  effect: number;
  support: number;
  uncertainty: number;
  authority: ManagerProgramEvidenceAuthority;
  evidenceIds: string[];
  lineage?: {
    kind: "semantic-revision";
    parentRuleId: string;
    parentMechanismKey: string;
    operation: "tighten-boundary" | "add-context" | "replace-context";
    evidenceSha256: string;
    hypothesisSeed?: {
      authority: "post-hoc-hypothesis-generation-only";
      diagnosticSha256: string;
      domainId: string;
      shapeSha256: string;
      excludedSourceSetSha256: string;
    };
  };
}

export interface ManagerProgramRevisionV2 {
  revision: number;
  hypothesisId: string;
  target: string;
  predicates: ManagerProgramPredicate[];
  discoveryGain: number;
  validationGain: number;
  accepted: boolean;
  reason: "validated-local-improvement" | "validation-regression" | "insufficient-support" | "no-candidate";
  evidenceAuthority: ManagerProgramEvidenceAuthority;
}

export interface ManagerProgramV2 {
  schemaVersion: 2;
  language: typeof MANAGER_PROGRAM_V2_LANGUAGE;
  activationStatus: "shadow-only";
  managerId: string;
  revision: number;
  rules: ManagerProgramRuleV2[];
  history: ManagerProgramRevisionV2[];
  limits: {maxRules: number; maxPredicates: number; maxEvaluatedRules: number};
  evidence: {decisionDossierPolicy: string; positionModelSha256: string; corpusSignature: string};
}

export interface ManagerProgramSampleV2 {
  id: string;
  battleId: string;
  clusterId: string;
  domain: ManagerProgramDomain;
  action: string;
  features: Record<string, number>;
  localValueDelta: number;
  authority: "local-value-observational";
}

export interface ManagerProgramTraceV2 {
  programHash: string;
  managerId: string;
  domain: ManagerProgramDomain;
  target: string;
  value: number;
  evaluatedRules: number;
  matchedRules: Array<{id: string; effect: number}>;
}

export interface ManagerProgramEvolutionV2 {
  program: ManagerProgramV2;
  proposals: number;
  accepted: number;
  rejected: number;
  discoveryMseBefore: number;
  discoveryMseAfter: number;
  validationMseBefore: number;
  validationMseAfter: number;
}

interface CandidateRule {
  domain: ManagerProgramDomain;
  target: string;
  predicates: ManagerProgramPredicate[];
  effect: number;
  support: number;
  uncertainty: number;
  discoveryGain: number;
  evidenceIds: string[];
}

interface CandidateDiscoveryCache {
  samples: readonly ManagerProgramSampleV2[];
  byTarget: Map<string, ManagerProgramSampleV2[]>;
  targets: string[];
  predicates: ManagerProgramPredicate[];
  predicateMasks: Map<string, Uint32Array>;
}

export function noviceManagerProgramV2(managerId: string, evidence: ManagerProgramV2["evidence"]): ManagerProgramV2 {
  if (!managerId || !evidence.decisionDossierPolicy || !/^[a-f0-9]{64}$/i.test(evidence.positionModelSha256) || !/^[a-f0-9]{64}$/i.test(evidence.corpusSignature)) throw new Error("Invalid manager-program V2 novice envelope");
  const program: ManagerProgramV2 = {schemaVersion: 2, language: MANAGER_PROGRAM_V2_LANGUAGE, activationStatus: "shadow-only", managerId, revision: 0, rules: [], history: [], limits: {maxRules: 12, maxPredicates: 2, maxEvaluatedRules: 32}, evidence: {...evidence}};
  validateManagerProgramV2(program);
  return program;
}

export function evaluateManagerProgramV2(program: ManagerProgramV2, domain: ManagerProgramDomain, target: string, features: Record<string, number>): ManagerProgramTraceV2 {
  validateManagerProgramV2(program);
  if (!target || !finiteRecord(features)) throw new Error("Invalid manager-program V2 evaluation request");
  const {value, evaluatedRules, matchedRules} = programValue(program, domain, target, features);
  return {programHash: managerProgramV2Hash(program), managerId: program.managerId, domain, target, value: round(value), evaluatedRules, matchedRules};
}

export function evolveManagerProgramV2(input: {
  program: ManagerProgramV2;
  discovery: readonly ManagerProgramSampleV2[];
  validation: readonly ManagerProgramSampleV2[];
  seed: string;
  revisions?: number;
}): ManagerProgramEvolutionV2 {
  let program = structuredClone(input.program);
  validateManagerProgramV2(program);
  validateSamples(input.discovery);
  validateSamples(input.validation);
  const revisions = integer(input.revisions ?? 6, 1, program.limits.maxRules * 2, "revisions");
  const discoveryBefore = mse(program, input.discovery), validationBefore = mse(program, input.validation);
  const discoveryCache = createCandidateDiscoveryCache(input.discovery);
  let accepted = 0;
  for (let attempt = 0; attempt < revisions && program.rules.length < program.limits.maxRules; attempt += 1) {
    const candidates = discoverCandidates(program, input.discovery, discoveryCache);
    if (!candidates.length) {
      program.history.push({revision: program.revision + 1, hypothesisId: `none:${attempt}`, target: "none", predicates: [], discoveryGain: 0, validationGain: 0, accepted: false, reason: "no-candidate", evidenceAuthority: "local-value-observational"});
      program.revision += 1;
      continue;
    }
    const frontier = candidates.slice(0, Math.min(12, candidates.length));
    const exploration = Math.max(.05, .45 / Math.sqrt(1 + program.history.length));
    const chosen = [...frontier].sort((left, right) => candidateUtility(right, exploration, `${input.seed}:${attempt}`) - candidateUtility(left, exploration, `${input.seed}:${attempt}`) || candidateIdentity(left).localeCompare(candidateIdentity(right)))[0];
    const rule = materializeRule(chosen), candidateProgram = structuredClone(program); candidateProgram.rules.push(rule);
    const validationGain = mse(program, input.validation) - mse(candidateProgram, input.validation);
    const enough = chosen.support >= 18;
    const accept = enough && chosen.discoveryGain > 1e-7 && validationGain > 1e-7;
    program.history.push({revision: program.revision + 1, hypothesisId: rule.id, target: chosen.target, predicates: chosen.predicates, discoveryGain: round(chosen.discoveryGain), validationGain: round(validationGain), accepted: accept, reason: !enough ? "insufficient-support" : accept ? "validated-local-improvement" : "validation-regression", evidenceAuthority: "local-value-observational"});
    if (accept) { program.rules.push(rule); accepted += 1; }
    program.revision += 1;
  }
  validateManagerProgramV2(program);
  return {program, proposals: program.history.length - input.program.history.length, accepted, rejected: program.history.length - input.program.history.length - accepted, discoveryMseBefore: round(discoveryBefore), discoveryMseAfter: round(mse(program, input.discovery)), validationMseBefore: round(validationBefore), validationMseAfter: round(mse(program, input.validation))};
}

export function managerProgramV2Hash(program: ManagerProgramV2): string { return digest(program); }

export function validateManagerProgramV2(program: ManagerProgramV2): void {
  if (program.schemaVersion !== 2 || program.language !== MANAGER_PROGRAM_V2_LANGUAGE || program.activationStatus !== "shadow-only" || !program.managerId || !Number.isInteger(program.revision) || program.revision < 0) throw new Error(`Invalid manager-program V2 envelope: ${program.managerId}`);
  if (!Number.isInteger(program.limits.maxRules) || program.limits.maxRules < 1 || program.limits.maxRules > 64 || !Number.isInteger(program.limits.maxPredicates) || program.limits.maxPredicates < 1 || program.limits.maxPredicates > 3 || !Number.isInteger(program.limits.maxEvaluatedRules) || program.limits.maxEvaluatedRules < program.limits.maxRules || program.limits.maxEvaluatedRules > 128) throw new Error(`Invalid manager-program V2 limits: ${program.managerId}`);
  if (program.rules.length > program.limits.maxRules || new Set(program.rules.map(rule => rule.id)).size !== program.rules.length) throw new Error(`Invalid manager-program V2 rule collection: ${program.managerId}`);
  for (const rule of program.rules) {
    if (!rule.id || !rule.target || !isManagerProgramDomain(rule.domain) || !rule.predicates.length || rule.predicates.length > program.limits.maxPredicates || !Number.isFinite(rule.effect) || Math.abs(rule.effect) > 1 || !Number.isInteger(rule.support) || rule.support < 1 || !Number.isFinite(rule.uncertainty) || rule.uncertainty < 0 || rule.uncertainty > 1 || rule.authority !== "local-value-observational" || rule.evidenceIds.length > 32) throw new Error(`Invalid manager-program V2 rule: ${rule.id}`);
    for (const predicate of rule.predicates) if (!predicate.feature || (predicate.operator !== "gte" && predicate.operator !== "lt") || !Number.isFinite(predicate.threshold)) throw new Error(`Invalid manager-program V2 predicate: ${rule.id}`);
    if (rule.lineage && (rule.lineage.kind !== "semantic-revision" || !rule.lineage.parentRuleId || !rule.lineage.parentMechanismKey || !["tighten-boundary", "add-context", "replace-context"].includes(rule.lineage.operation) || !/^[a-f0-9]{64}$/i.test(rule.lineage.evidenceSha256) || rule.lineage.hypothesisSeed && (rule.lineage.hypothesisSeed.authority !== "post-hoc-hypothesis-generation-only" || !rule.lineage.hypothesisSeed.domainId || !/^[a-f0-9]{64}$/i.test(rule.lineage.hypothesisSeed.diagnosticSha256) || !/^[a-f0-9]{64}$/i.test(rule.lineage.hypothesisSeed.shapeSha256) || !/^[a-f0-9]{64}$/i.test(rule.lineage.hypothesisSeed.excludedSourceSetSha256)))) throw new Error(`Invalid manager-program V2 lineage: ${rule.id}`);
  }
  if (program.history.length !== program.revision || program.history.some((entry, index) => entry.revision !== index + 1 || !entry.hypothesisId || !Number.isFinite(entry.discoveryGain) || !Number.isFinite(entry.validationGain))) throw new Error(`Invalid manager-program V2 revision history: ${program.managerId}`);
  if (!program.evidence.decisionDossierPolicy || !/^[a-f0-9]{64}$/i.test(program.evidence.positionModelSha256) || !/^[a-f0-9]{64}$/i.test(program.evidence.corpusSignature)) throw new Error(`Invalid manager-program V2 evidence binding: ${program.managerId}`);
}

export function managerProgramV2Behavior(program: ManagerProgramV2): {rules: number; domains: ManagerProgramDomain[]; targets: string[]; scopedTargets: string[]; conditionalPairs: number; hash: string} {
  validateManagerProgramV2(program);
  const domains = [...new Set(program.rules.map(rule => rule.domain))].sort(), targets = [...new Set(program.rules.map(rule => rule.target))].sort(), scopedTargets = [...new Set(program.rules.map(rule => `${rule.domain}:${rule.target}`))].sort();
  return {rules: program.rules.length, domains, targets, scopedTargets, conditionalPairs: program.rules.filter(rule => rule.predicates.length > 1).length, hash: digest(program.rules.map(rule => [rule.domain, rule.target, rule.predicates, rule.effect]))};
}

function createCandidateDiscoveryCache(samples: readonly ManagerProgramSampleV2[]): CandidateDiscoveryCache {
  const featureNames = [...new Set(samples.flatMap(sample => Object.keys(sample.features)))].sort(), byTarget = new Map<string, ManagerProgramSampleV2[]>();
  for (const sample of samples) { const key = `${sample.domain}\0${sample.action}`, values = byTarget.get(key) ?? []; values.push(sample); byTarget.set(key, values); }
  const predicates = featureNames.flatMap(feature => quantiles(samples.map(sample => sample.features[feature]).filter(Number.isFinite)).flatMap(threshold => ([{feature, operator: "gte" as const, threshold}, {feature, operator: "lt" as const, threshold}])));
  return {samples, byTarget, targets: [...byTarget.keys()].sort(), predicates, predicateMasks: new Map()};
}

function discoverCandidates(program: ManagerProgramV2, samples: readonly ManagerProgramSampleV2[], cache = createCandidateDiscoveryCache(samples)): CandidateRule[] {
  if (samples.length < 18) return [];
  if (cache.samples !== samples) throw new Error("Manager-program candidate cache/sample mismatch");
  const current = new Map(samples.map(sample => [sample.id, programValue(program, sample.domain, sample.action, sample.features).value]));
  const singles = cache.targets.flatMap(key => { const [domain, target] = key.split("\0") as [ManagerProgramDomain, string]; return cache.predicates.map(predicate => fitCandidate(cache.byTarget.get(key)!, samples.length, current, domain, target, [predicate], cache)).filter((value): value is CandidateRule => Boolean(value)); }).sort(compareCandidate);
  const compoundSeeds = singles.slice(0, Math.min(12, singles.length));
  const compounds = compoundSeeds.flatMap(seed => cache.predicates.filter(predicate => predicate.feature !== seed.predicates[0].feature).map(predicate => fitCandidate(cache.byTarget.get(`${seed.domain}\0${seed.target}`)!, samples.length, current, seed.domain, seed.target, [seed.predicates[0], predicate], cache)).filter((value): value is CandidateRule => Boolean(value))).sort(compareCandidate).slice(0, 32);
  const existing = new Set([...program.rules.map(rule => rule.id), ...program.history.map(entry => entry.hypothesisId)]);
  return [...singles, ...compounds].filter(candidate => !existing.has(materializeRule(candidate).id)).sort(compareCandidate);
}

function fitCandidate(targetSamples: readonly ManagerProgramSampleV2[], totalSamples: number, current: Map<string, number>, domain: ManagerProgramDomain, target: string, predicates: ManagerProgramPredicate[], cache: CandidateDiscoveryCache): CandidateRule | null {
  const masks = predicates.map(predicate => predicateMask(cache, targetSamples, domain, target, predicate)); let support = 0, residualSum = 0, residualSquareSum = 0, before = 0; const evidenceIds: string[] = [];
  visitMaskIntersection(masks, targetSamples.length, index => { const sample = targetSamples[index], residual = sample.localValueDelta - (current.get(sample.id) ?? 0); support += 1; residualSum += residual; residualSquareSum += residual ** 2; before += residual ** 2; if (evidenceIds.length < 32) evidenceIds.push(sample.id); });
  if (support < 18) return null;
  const rawEffect = residualSum / support, effect = clamp(rawEffect * support / (support + 20), -.35, .35);
  if (Math.abs(effect) < 1e-5) return null;
  let after = 0; visitMaskIntersection(masks, targetSamples.length, index => { const sample = targetSamples[index]; after += (sample.localValueDelta - bounded((current.get(sample.id) ?? 0) + effect)) ** 2; });
  const discoveryGain = (before - after) / totalSamples;
  if (discoveryGain <= 0) return null;
  const variance = Math.max(0, residualSquareSum / support - rawEffect ** 2), uncertainty = clamp(Math.sqrt(variance / support), 0, 1);
  return {domain, target, predicates, effect: round(effect), support, uncertainty: round(uncertainty), discoveryGain, evidenceIds};
}

function predicateMask(cache: CandidateDiscoveryCache, samples: readonly ManagerProgramSampleV2[], domain: ManagerProgramDomain, target: string, predicate: ManagerProgramPredicate): Uint32Array {
  const key = `${domain}\0${target}\0${predicate.feature}\0${predicate.operator}\0${predicate.threshold}`, prior = cache.predicateMasks.get(key); if (prior) return prior;
  const mask = new Uint32Array(Math.ceil(samples.length / 32)); for (let index = 0; index < samples.length; index += 1) if (matches(predicate, samples[index].features)) mask[index >>> 5] |= 1 << (index & 31); cache.predicateMasks.set(key, mask); return mask;
}
function visitMaskIntersection(masks: readonly Uint32Array[], length: number, visit: (index: number) => void): void {
  if (!masks.length) return; for (let wordIndex = 0; wordIndex < masks[0].length; wordIndex += 1) { let word = masks[0][wordIndex]; for (let index = 1; index < masks.length && word; index += 1) word &= masks[index][wordIndex]; while (word) { const bit = 31 - Math.clz32(word & -word), sampleIndex = (wordIndex << 5) + bit; if (sampleIndex < length) visit(sampleIndex); word &= word - 1; } }
}

function materializeRule(candidate: CandidateRule): ManagerProgramRuleV2 {
  return {id: `mp2-${digest([candidate.domain, candidate.target, candidate.predicates, candidate.effect, candidate.evidenceIds]).slice(0, 20)}`, domain: candidate.domain, target: candidate.target, predicates: candidate.predicates.map(value => ({...value})), effect: candidate.effect, support: candidate.support, uncertainty: candidate.uncertainty, authority: "local-value-observational", evidenceIds: [...candidate.evidenceIds]};
}
function mse(program: ManagerProgramV2, samples: readonly ManagerProgramSampleV2[]): number { return samples.length ? mean(samples.map(sample => (programValue(program, sample.domain, sample.action, sample.features).value - sample.localValueDelta) ** 2)) : 0; }
function candidateUtility(candidate: CandidateRule, exploration: number, seed: string): number { return candidate.discoveryGain + exploration * candidate.uncertainty * hashUnit(`${seed}:${candidateIdentity(candidate)}`) / Math.sqrt(candidate.support); }
function compareCandidate(left: CandidateRule, right: CandidateRule): number { return right.discoveryGain - left.discoveryGain || right.support - left.support || candidateIdentity(left).localeCompare(candidateIdentity(right)); }
function candidateIdentity(candidate: {domain: ManagerProgramDomain; target: string; predicates: ManagerProgramPredicate[]}): string { return `${candidate.domain}|${candidate.target}|${candidate.predicates.map(predicate => `${predicate.feature}:${predicate.operator}:${round(predicate.threshold)}`).join("&")}`; }
function matches(predicate: ManagerProgramPredicate, features: Record<string, number>): boolean { const value = features[predicate.feature]; return Number.isFinite(value) && (predicate.operator === "gte" ? value >= predicate.threshold : value < predicate.threshold); }
function programValue(program: ManagerProgramV2, domain: ManagerProgramDomain, target: string, features: Record<string, number>): {value: number; evaluatedRules: number; matchedRules: Array<{id: string; effect: number}>} {
  let value = 0, evaluatedRules = 0; const matchedRules: Array<{id: string; effect: number}> = [];
  for (const rule of program.rules) { if (++evaluatedRules > program.limits.maxEvaluatedRules) throw new Error("Manager-program V2 evaluation budget exceeded"); if (rule.domain !== domain || (rule.target !== "*" && rule.target !== target) || !rule.predicates.every(predicate => matches(predicate, features))) continue; value = bounded(value + rule.effect); matchedRules.push({id: rule.id, effect: rule.effect}); }
  return {value: round(value), evaluatedRules, matchedRules};
}
function quantiles(values: number[]): number[] { if (values.length < 4) return []; const sorted = [...values].sort((a, b) => a - b); return [...new Set([.25, .5, .75].map(q => round(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))])))].filter((value, index, all) => value > sorted[0] && value < sorted.at(-1)! && all.indexOf(value) === index); }
function validateSamples(samples: readonly ManagerProgramSampleV2[]): void { if (new Set(samples.map(sample => sample.id)).size !== samples.length) throw new Error("Duplicate manager-program V2 samples"); for (const sample of samples) if (!sample.id || !sample.battleId || !sample.clusterId || !isManagerProgramDomain(sample.domain) || !sample.action || !finiteRecord(sample.features) || !Number.isFinite(sample.localValueDelta) || Math.abs(sample.localValueDelta) > 1 || sample.authority !== "local-value-observational") throw new Error(`Invalid manager-program V2 sample: ${sample.id}`); }
function isManagerProgramDomain(value: unknown): value is ManagerProgramDomain { return ["acquire", "configure", "lineup", "battle", "research"].includes(String(value)); }
function finiteRecord(value: Record<string, number>): boolean { return Object.values(value).every(Number.isFinite); }
function bounded(value: number): number { return clamp(value, -1, 1); }
function mean(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function digest(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function hashUnit(value: string): number { return Number.parseInt(crypto.createHash("sha256").update(value).digest("hex").slice(0, 12), 16) / 0xffffffffffff; }
function integer(value: number, minimum: number, maximum: number, label: string): number { if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${label} must be ${minimum}..${maximum}`); return value; }
