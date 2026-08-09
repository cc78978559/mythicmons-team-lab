export const FORMAL_VALIDATION_VERSION = "formal-validation-v1.4-conditional-mechanism-clusters";

export type ValidationDirection = "better" | "neutral" | "worse";

export interface FormalValidationCaseResult {
  id: string;
  domainId: string;
  managerId: string;
  ruleId: string;
  environment: string;
  phase: "early" | "mid" | "late";
  direction: ValidationDirection;
  expectedDirection: Exclude<ValidationDirection, "neutral">;
  outcomeChanged: boolean;
  sourceVerified: boolean;
  prefixVerified: boolean;
  interventionVerified: boolean;
}

export interface FormalValidationGate {
  targetCases: number;
  minimumCasesPerEnvironment: number;
  minimumDecisiveCases: number;
  familywiseAlpha: number;
}

export interface FormalValidationDomainResult {
  domainId: string;
  cases: number;
  environments: Record<string, {cases: number; supports: number; contradictions: number; neutral: number}>;
  phases: Record<string, number>;
  supports: number;
  contradictions: number;
  neutral: number;
  decisive: number;
  supportRate: number | null;
  oneSidedP: number;
  holmAdjustedP: number;
  coverageComplete: boolean;
  environmentConsistent: boolean;
  technicalIntegrity: boolean;
  disposition: "limited-canary-eligible" | "rejected" | "inconclusive" | "blocked";
  reasons: string[];
}

export function formalMechanismKey(input: {
  target: string;
  effect: number;
  predicates: readonly {feature: string; operator: "gte" | "lt"}[];
}): string {
  const direction = input.effect > 0 ? "worse" : "better";
  const condition = [...input.predicates]
    .map(predicate => `${predicate.feature}-${predicate.operator}`)
    .sort()
    .join("+");
  return `${input.target}__${direction}__${condition}`;
}

export function hasExactFormalValidationIntegrity(result: Pick<FormalValidationCaseResult, "sourceVerified" | "prefixVerified" | "interventionVerified">): boolean {
  return result.sourceVerified === true && result.prefixVerified === true && result.interventionVerified === true;
}

export function evaluateFormalValidation(
  domainIds: readonly string[],
  results: readonly FormalValidationCaseResult[],
  environments: readonly string[],
  gate: FormalValidationGate,
): FormalValidationDomainResult[] {
  validateGate(gate);
  const rows = domainIds.map(domainId => evaluateDomain(domainId, results.filter(result => result.domainId === domainId), environments, gate));
  applyHolm(rows);
  for (const row of rows) {
    const significant = row.holmAdjustedP <= gate.familywiseAlpha;
    if (!row.technicalIntegrity) row.disposition = "blocked";
    else if (!row.coverageComplete || row.decisive < gate.minimumDecisiveCases) row.disposition = "inconclusive";
    else if (significant && row.environmentConsistent && row.supports > row.contradictions) row.disposition = "limited-canary-eligible";
    else if (row.contradictions > row.supports || (row.decisive >= gate.minimumDecisiveCases && row.oneSidedP > .5)) row.disposition = "rejected";
    else row.disposition = "inconclusive";
    if (!row.coverageComplete) row.reasons.push("frozen coverage target was not met");
    if (row.decisive < gate.minimumDecisiveCases) row.reasons.push("too few winner-changing interventions");
    if (!row.environmentConsistent) row.reasons.push("direction did not remain positive in every environment");
    if (!significant) row.reasons.push("Holm-adjusted directional evidence did not cross the familywise gate");
    if (!row.technicalIntegrity) row.reasons.push("one or more exact-counterfactual integrity checks failed");
  }
  return rows.sort((left, right) => left.domainId.localeCompare(right.domainId));
}

function evaluateDomain(domainId: string, results: FormalValidationCaseResult[], environments: readonly string[], gate: FormalValidationGate): FormalValidationDomainResult {
  const technicalIntegrity = results.every(hasExactFormalValidationIntegrity);
  const supports = results.filter(result => result.direction === result.expectedDirection).length;
  const contradictions = results.filter(result => result.direction !== "neutral" && result.direction !== result.expectedDirection).length;
  const neutral = results.length - supports - contradictions, decisive = supports + contradictions;
  const environmentRows = Object.fromEntries(environments.map(environment => {
    const subset = results.filter(result => result.environment === environment);
    const localSupports = subset.filter(result => result.direction === result.expectedDirection).length;
    const localContradictions = subset.filter(result => result.direction !== "neutral" && result.direction !== result.expectedDirection).length;
    return [environment, {cases: subset.length, supports: localSupports, contradictions: localContradictions, neutral: subset.length - localSupports - localContradictions}];
  }));
  const phases: Record<string, number> = {early: 0, mid: 0, late: 0};
  for (const result of results) phases[result.phase] = (phases[result.phase] ?? 0) + 1;
  return {
    domainId,
    cases: results.length,
    environments: environmentRows,
    phases,
    supports,
    contradictions,
    neutral,
    decisive,
    supportRate: decisive ? round(supports / decisive) : null,
    oneSidedP: exactOneSidedBinomial(supports, decisive),
    holmAdjustedP: 1,
    coverageComplete: results.length >= gate.targetCases && environments.every(environment => environmentRows[environment].cases >= gate.minimumCasesPerEnvironment),
    environmentConsistent: environments.every(environment => environmentRows[environment].supports > environmentRows[environment].contradictions),
    technicalIntegrity,
    disposition: "inconclusive",
    reasons: [],
  };
}

function applyHolm(rows: FormalValidationDomainResult[]): void {
  const ordered = [...rows].sort((left, right) => left.oneSidedP - right.oneSidedP || left.domainId.localeCompare(right.domainId));
  let prior = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const adjusted = Math.min(1, (ordered.length - index) * ordered[index].oneSidedP);
    prior = Math.max(prior, adjusted);
    ordered[index].holmAdjustedP = round(prior);
  }
}

export function exactOneSidedBinomial(successes: number, trials: number): number {
  if (!Number.isInteger(successes) || !Number.isInteger(trials) || successes < 0 || trials < successes) throw new Error("Invalid exact-binomial inputs");
  if (!trials) return 1;
  let probability = 0;
  for (let value = successes; value <= trials; value += 1) probability += combination(trials, value) * 0.5 ** trials;
  return round(Math.min(1, probability));
}

function combination(total: number, selected: number): number {
  const count = Math.min(selected, total - selected);
  let value = 1;
  for (let index = 1; index <= count; index += 1) value = value * (total - count + index) / index;
  return value;
}

function validateGate(gate: FormalValidationGate): void {
  if (!Number.isInteger(gate.targetCases) || gate.targetCases < 1 || !Number.isInteger(gate.minimumCasesPerEnvironment) || gate.minimumCasesPerEnvironment < 1 || !Number.isInteger(gate.minimumDecisiveCases) || gate.minimumDecisiveCases < 1 || !Number.isFinite(gate.familywiseAlpha) || gate.familywiseAlpha <= 0 || gate.familywiseAlpha >= 1) throw new Error("Invalid formal-validation gate");
}

function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
