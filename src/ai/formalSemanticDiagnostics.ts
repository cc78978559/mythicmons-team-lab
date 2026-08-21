import crypto from "node:crypto";

export const FORMAL_SEMANTIC_DIAGNOSTICS_VERSION = "formal-semantic-diagnostics-v1";
export const FORMAL_SEMANTIC_DIAGNOSTICS_AUTHORITY = "post-hoc-hypothesis-generation-only" as const;
export type FormalSemanticOutcome = "support" | "contradiction" | "neutral";

export interface FormalSemanticDiagnosticCase {
  id: string;
  domainId: string;
  environment: string;
  clusterId: string;
  phase: "early" | "mid" | "late";
  outcome: FormalSemanticOutcome;
  sourceFingerprint: string;
  features: Record<string, number>;
}

export interface FormalSemanticPredicate {feature: string; operator: "gte" | "lt"; threshold: number}
export interface FormalSemanticHint {
  predicates: FormalSemanticPredicate[];
  supportsInside: number;
  contradictionsInside: number;
  neutralInside: number;
  supportsOutside: number;
  contradictionsOutside: number;
  supportCoverage: number;
  descriptivePrecision: number;
  balancedAccuracy: number;
  score: number;
  insideEnvironments: Record<string, Record<FormalSemanticOutcome, number>>;
  insidePhases: Record<string, Record<FormalSemanticOutcome, number>>;
}

export interface FormalSemanticDomainDiagnostic {
  domainId: string;
  cases: number;
  decisive: number;
  outcomes: Record<FormalSemanticOutcome, number>;
  environments: Record<string, Record<FormalSemanticOutcome, number>>;
  phases: Record<string, Record<FormalSemanticOutcome, number>>;
  featureContrasts: Array<{feature: string; supportMean: number | null; contradictionMean: number | null; neutralMean: number | null; decisiveMeanGap: number | null; supportRange: [number, number] | null; contradictionRange: [number, number] | null}>;
  singleConditionHints: FormalSemanticHint[];
  interactionHints: FormalSemanticHint[];
  decisiveCases: Array<{id: string; environment: string; phase: "early" | "mid" | "late"; outcome: "support" | "contradiction"; features: Record<string, number>}>;
  limitations: string[];
}

export interface FormalSemanticDiagnostics {
  schemaVersion: 1;
  version: typeof FORMAL_SEMANTIC_DIAGNOSTICS_VERSION;
  authority: typeof FORMAL_SEMANTIC_DIAGNOSTICS_AUTHORITY;
  generatedAt: string;
  bindings: {freezeSha256: string; planSha256: string; resultsSha256: string; frontierSha256: string};
  cases: number;
  domains: FormalSemanticDomainDiagnostic[];
  excludedValidationFingerprints: string[];
  prohibitedUses: ["stage4-support-count", "stage5-validation", "policy-activation"];
  sha256: string;
}

export function diagnoseFormalSemantics(input: {cases: readonly FormalSemanticDiagnosticCase[]; bindings: FormalSemanticDiagnostics["bindings"]; generatedAt?: string}): FormalSemanticDiagnostics {
  validateCases(input.cases); validateBindings(input.bindings);
  const domainIds = [...new Set(input.cases.map(value => value.domainId))].sort(), domains = domainIds.map(domainId => diagnoseDomain(domainId, input.cases.filter(value => value.domainId === domainId)));
  const core = {schemaVersion: 1 as const, version: FORMAL_SEMANTIC_DIAGNOSTICS_VERSION as typeof FORMAL_SEMANTIC_DIAGNOSTICS_VERSION, authority: FORMAL_SEMANTIC_DIAGNOSTICS_AUTHORITY, generatedAt: input.generatedAt ?? new Date().toISOString(), bindings: {...input.bindings}, cases: input.cases.length, domains, excludedValidationFingerprints: [...new Set(input.cases.map(value => value.sourceFingerprint))].sort(), prohibitedUses: ["stage4-support-count", "stage5-validation", "policy-activation"] as FormalSemanticDiagnostics["prohibitedUses"]};
  return {...core, sha256: canonicalSha(core)};
}

export function validateFormalSemanticDiagnostics(value: FormalSemanticDiagnostics): void {
  const {sha256, ...core} = value;
  if (value.schemaVersion !== 1 || value.version !== FORMAL_SEMANTIC_DIAGNOSTICS_VERSION || value.authority !== FORMAL_SEMANTIC_DIAGNOSTICS_AUTHORITY || canonicalSha(core) !== sha256 || value.cases !== value.domains.reduce((sum, domain) => sum + domain.cases, 0) || JSON.stringify(value.prohibitedUses) !== JSON.stringify(["stage4-support-count", "stage5-validation", "policy-activation"]) || new Set(value.excludedValidationFingerprints).size !== value.excludedValidationFingerprints.length) throw new Error("Invalid formal semantic diagnostics envelope");
  validateBindings(value.bindings);
  for (const domain of value.domains) if (!domain.domainId || domain.cases !== Object.values(domain.outcomes).reduce((sum, count) => sum + count, 0) || domain.decisive !== domain.outcomes.support + domain.outcomes.contradiction || domain.decisiveCases.length !== domain.decisive || domain.decisiveCases.some(row => !row.id || !["support", "contradiction"].includes(row.outcome) || !Object.values(row.features).every(Number.isFinite)) || [...domain.singleConditionHints, ...domain.interactionHints].some(hint => !hint.predicates.length || hint.predicates.length > 2 || hint.supportsInside + hint.supportsOutside !== domain.outcomes.support || hint.contradictionsInside + hint.contradictionsOutside !== domain.outcomes.contradiction)) throw new Error(`Invalid formal semantic domain diagnostic: ${domain.domainId}`);
}

function diagnoseDomain(domainId: string, rows: readonly FormalSemanticDiagnosticCase[]): FormalSemanticDomainDiagnostic {
  const outcomes = outcomeCounts(rows), environments = groupedCounts(rows, row => row.environment), phases = groupedCounts(rows, row => row.phase), supports = rows.filter(row => row.outcome === "support"), contradictions = rows.filter(row => row.outcome === "contradiction"), neutrals = rows.filter(row => row.outcome === "neutral"), features = [...new Set(rows.flatMap(row => Object.keys(row.features)))].sort();
  const featureContrasts = features.map(feature => ({feature, supportMean: averageFeature(supports, feature), contradictionMean: averageFeature(contradictions, feature), neutralMean: averageFeature(neutrals, feature), decisiveMeanGap: supports.length && contradictions.length ? round(mean(supports.map(row => row.features[feature])) - mean(contradictions.map(row => row.features[feature]))) : null, supportRange: range(supports.map(row => row.features[feature])), contradictionRange: range(contradictions.map(row => row.features[feature]))})).sort((left, right) => Math.abs(right.decisiveMeanGap ?? 0) - Math.abs(left.decisiveMeanGap ?? 0) || left.feature.localeCompare(right.feature));
  const singleCandidates = features.flatMap(feature => candidateThresholds(rows.map(row => row.features[feature])).flatMap(threshold => ([evaluateHint(rows, [{feature, operator: "lt", threshold}]), evaluateHint(rows, [{feature, operator: "gte", threshold}])]))).filter((value): value is FormalSemanticHint => Boolean(value)).sort(compareHints);
  const singleConditionHints = distinctHints(singleCandidates, 8, true), interactionBase = distinctHints(singleCandidates, 12, true), interactionCandidates: FormalSemanticHint[] = [];
  for (let left = 0; left < interactionBase.length; left += 1) for (let right = left + 1; right < interactionBase.length; right += 1) {
    if (interactionBase[left].predicates[0].feature === interactionBase[right].predicates[0].feature) continue;
    const hint = evaluateHint(rows, [interactionBase[left].predicates[0], interactionBase[right].predicates[0]]); if (hint) interactionCandidates.push(hint);
  }
  const decisiveCases = rows.filter(row => row.outcome !== "neutral").map(row => ({id: row.id, environment: row.environment, phase: row.phase, outcome: row.outcome as "support" | "contradiction", features: {...row.features}})).sort((left, right) => left.environment.localeCompare(right.environment) || left.phase.localeCompare(right.phase) || left.outcome.localeCompare(right.outcome) || left.id.localeCompare(right.id));
  return {domainId, cases: rows.length, decisive: supports.length + contradictions.length, outcomes, environments, phases, featureContrasts: featureContrasts.slice(0, 12), singleConditionHints, interactionHints: distinctHints(interactionCandidates.sort(compareHints), 8, true), decisiveCases, limitations: ["These boundaries were selected after observing the same formal outcomes and are descriptive, not confirmatory.", "Neutral cases did not change the winner and are retained only as applicability context.", "Any descendant hypothesis must exclude every listed formal source fingerprint and be validated on a new signed evidence generation."]};
}

function evaluateHint(rows: readonly FormalSemanticDiagnosticCase[], predicates: FormalSemanticPredicate[]): FormalSemanticHint | null {
  const inside = rows.filter(row => predicates.every(predicate => matches(predicate, row.features))), outside = rows.filter(row => !predicates.every(predicate => matches(predicate, row.features))), supportsInside = count(inside, "support"), contradictionsInside = count(inside, "contradiction"), neutralInside = count(inside, "neutral"), supportsOutside = count(outside, "support"), contradictionsOutside = count(outside, "contradiction"), totalSupports = supportsInside + supportsOutside, totalContradictions = contradictionsInside + contradictionsOutside, decisiveInside = supportsInside + contradictionsInside, decisiveOutside = supportsOutside + contradictionsOutside;
  if (!totalSupports || !totalContradictions || decisiveInside < 2 || decisiveOutside < 1 || !supportsInside) return null;
  const supportCoverage = supportsInside / totalSupports, descriptivePrecision = supportsInside / decisiveInside, trueNegativeRate = contradictionsOutside / totalContradictions, balancedAccuracy = (supportCoverage + trueNegativeRate) / 2, complexityPenalty = predicates.length === 1 ? 1 : .92, score = balancedAccuracy * descriptivePrecision * Math.sqrt(supportCoverage) * complexityPenalty;
  return {predicates: [...predicates].sort((a, b) => a.feature.localeCompare(b.feature) || a.operator.localeCompare(b.operator) || a.threshold - b.threshold).map(value => ({...value, threshold: round(value.threshold)})), supportsInside, contradictionsInside, neutralInside, supportsOutside, contradictionsOutside, supportCoverage: round(supportCoverage), descriptivePrecision: round(descriptivePrecision), balancedAccuracy: round(balancedAccuracy), score: round(score), insideEnvironments: groupedCounts(inside, row => row.environment), insidePhases: groupedCounts(inside, row => row.phase)};
}

function compareHints(left: FormalSemanticHint, right: FormalSemanticHint): number { return right.score - left.score || right.supportsInside - left.supportsInside || left.contradictionsInside - right.contradictionsInside || hintIdentity(left).localeCompare(hintIdentity(right)); }
function distinctHints(values: FormalSemanticHint[], limit: number, semanticShape = false): FormalSemanticHint[] { const seen = new Set<string>(), result: FormalSemanticHint[] = []; for (const value of values) { const identity = semanticShape ? value.predicates.map(predicate => `${predicate.feature}:${predicate.operator}`).join("&") : hintIdentity(value); if (seen.has(identity)) continue; seen.add(identity); result.push(value); if (result.length >= limit) break; } return result; }
function hintIdentity(value: FormalSemanticHint): string { return value.predicates.map(predicate => `${predicate.feature}:${predicate.operator}:${predicate.threshold}`).join("&"); }
function candidateThresholds(values: number[]): number[] { const sorted = [...new Set(values.filter(Number.isFinite).sort((a, b) => a - b))]; const thresholds: number[] = []; for (let index = 1; index < sorted.length; index += 1) thresholds.push(round((sorted[index - 1] + sorted[index]) / 2)); return thresholds; }
function outcomeCounts(rows: readonly FormalSemanticDiagnosticCase[]): Record<FormalSemanticOutcome, number> { return {support: count(rows, "support"), contradiction: count(rows, "contradiction"), neutral: count(rows, "neutral")}; }
function groupedCounts(rows: readonly FormalSemanticDiagnosticCase[], key: (row: FormalSemanticDiagnosticCase) => string): Record<string, Record<FormalSemanticOutcome, number>> { const result: Record<string, Record<FormalSemanticOutcome, number>> = {}; for (const value of [...new Set(rows.map(key))].sort()) result[value] = outcomeCounts(rows.filter(row => key(row) === value)); return result; }
function count(rows: readonly FormalSemanticDiagnosticCase[], outcome: FormalSemanticOutcome): number { return rows.filter(row => row.outcome === outcome).length; }
function averageFeature(rows: readonly FormalSemanticDiagnosticCase[], feature: string): number | null { const values = rows.map(row => row.features[feature]).filter(Number.isFinite); return values.length ? round(mean(values)) : null; }
function range(values: number[]): [number, number] | null { const finite = values.filter(Number.isFinite); return finite.length ? [round(Math.min(...finite)), round(Math.max(...finite))] : null; }
function matches(predicate: FormalSemanticPredicate, features: Record<string, number>): boolean { const value = features[predicate.feature]; return Number.isFinite(value) && (predicate.operator === "gte" ? value >= predicate.threshold : value < predicate.threshold); }
function validateCases(rows: readonly FormalSemanticDiagnosticCase[]): void { if (!rows.length || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Formal semantic diagnostics require unique cases"); for (const row of rows) if (!row.id || !row.domainId || !row.environment || !row.clusterId || !["early", "mid", "late"].includes(row.phase) || !["support", "contradiction", "neutral"].includes(row.outcome) || !/^[a-f0-9]{64}$/i.test(row.sourceFingerprint) || Object.keys(row.features).length === 0 || !Object.values(row.features).every(Number.isFinite)) throw new Error(`Invalid formal semantic diagnostic case: ${row.id}`); }
function validateBindings(value: FormalSemanticDiagnostics["bindings"]): void { for (const [key, hash] of Object.entries(value)) if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error(`Invalid formal semantic diagnostics binding: ${key}`); }
function mean(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function canonicalSha(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function canonical(value: any): any { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value; }
