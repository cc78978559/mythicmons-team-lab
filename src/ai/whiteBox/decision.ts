export const WHITE_BOX_DECISION_VERSION = "white-box-decision-v1";

export type WhiteBoxContributionSource =
  | "competence"
  | "goal"
  | "risk"
  | "personality"
  | "relationship"
  | "memory"
  | "context"
  | "tie-break";

export interface WhiteBoxContribution {
  id: string;
  group: string;
  source: WhiteBoxContributionSource;
  value: number;
  reason: string;
}

export interface WhiteBoxCandidate {
  id: string;
  hardRejections?: string[];
  rational: WhiteBoxContribution[];
  style?: WhiteBoxContribution[];
  diagnostics?: Readonly<Record<string, number>>;
}

export interface WhiteBoxDecisionInput {
  decisionId: string;
  candidates: WhiteBoxCandidate[];
  reasonableBand: number;
  styleContributionLimit: number;
}

export interface WhiteBoxCandidateTrace {
  id: string;
  eligible: boolean;
  reasonable: boolean;
  hardRejections: string[];
  rationalScore: number | null;
  rawStyleScore: number | null;
  appliedStyleScore: number | null;
  finalScore: number | null;
  contributions: WhiteBoxContribution[];
  diagnostics?: Record<string, number>;
}

export interface WhiteBoxDecisionTrace {
  version: typeof WHITE_BOX_DECISION_VERSION;
  decisionId: string;
  selected: string | null;
  reasonableBand: number;
  styleContributionLimit: number;
  candidates: WhiteBoxCandidateTrace[];
}

export interface WhiteBoxShadowSummary {
  version: typeof WHITE_BOX_DECISION_VERSION;
  decisionId: string;
  comparison: ReturnType<typeof compareWhiteBoxShadow>;
  candidateCount: number;
  reasonableCount: number;
  hardRejectedCount: number;
  candidates: WhiteBoxCandidateTrace[];
  reasonableBand: number;
  styleContributionLimit: number;
  policyVersion?: string;
  parameters?: Record<string, number>;
}

/**
 * Evaluates a decision without executing it. Goals and risk belong to rational
 * utility; personality and memory only distinguish candidates inside the
 * reasonable band. This keeps style from overriding legality or competence.
 */
export function evaluateWhiteBoxDecision(input: WhiteBoxDecisionInput): WhiteBoxDecisionTrace {
  validateInput(input);
  const ids = new Set<string>();
  const traces: WhiteBoxCandidateTrace[] = input.candidates.map((candidate): WhiteBoxCandidateTrace => {
    if (!candidate.id.trim()) throw new Error("White-box candidate id cannot be empty");
    if (ids.has(candidate.id)) throw new Error(`Duplicate white-box candidate id: ${candidate.id}`);
    ids.add(candidate.id);
    validateContributions(candidate.id, [...candidate.rational, ...(candidate.style ?? [])]);
    validateDiagnostics(candidate.id, candidate.diagnostics);
    const hardRejections = [...(candidate.hardRejections ?? [])];
    const eligible = hardRejections.length === 0;
    return {
      id: candidate.id,
      eligible,
      reasonable: false,
      hardRejections,
      rationalScore: eligible ? round(sum(candidate.rational)) : null,
      rawStyleScore: eligible ? round(sum(candidate.style ?? [])) : null,
      appliedStyleScore: eligible ? 0 : null,
      finalScore: eligible ? 0 : null,
      contributions: [...candidate.rational, ...(candidate.style ?? [])].map(entry => ({...entry, value: round(entry.value)})),
      diagnostics: candidate.diagnostics ? mapDiagnostics(candidate.diagnostics) : undefined,
    };
  });

  const eligible = traces.filter(trace => trace.eligible);
  const bestRational = eligible.length ? Math.max(...eligible.map(trace => trace.rationalScore!)) : null;
  for (const trace of eligible) {
    trace.reasonable = bestRational !== null && bestRational - trace.rationalScore! <= input.reasonableBand;
    if (!trace.reasonable) {
      trace.appliedStyleScore = 0;
      trace.finalScore = null;
      continue;
    }
    trace.appliedStyleScore = round(clamp(trace.rawStyleScore!, -input.styleContributionLimit, input.styleContributionLimit));
    trace.finalScore = round(trace.rationalScore! + trace.appliedStyleScore);
  }

  const selected = eligible
    .filter(trace => trace.reasonable)
    .sort((left, right) => right.finalScore! - left.finalScore! || right.rationalScore! - left.rationalScore! || left.id.localeCompare(right.id))[0]?.id ?? null;

  return {
    version: WHITE_BOX_DECISION_VERSION,
    decisionId: input.decisionId,
    selected,
    reasonableBand: input.reasonableBand,
    styleContributionLimit: input.styleContributionLimit,
    candidates: traces.sort((left, right) => {
      if (left.finalScore === null) return right.finalScore === null ? left.id.localeCompare(right.id) : 1;
      if (right.finalScore === null) return -1;
      return right.finalScore - left.finalScore || left.id.localeCompare(right.id);
    }),
  };
}

export function compareWhiteBoxShadow(trace: WhiteBoxDecisionTrace, incumbent: string): {incumbent: string; shadow: string | null; agrees: boolean} {
  return {incumbent, shadow: trace.selected, agrees: trace.selected === incumbent};
}

export function summarizeWhiteBoxShadow(trace: WhiteBoxDecisionTrace, incumbent: string, maximumCandidates = 5): WhiteBoxShadowSummary {
  if (!Number.isInteger(maximumCandidates) || maximumCandidates < 1) throw new Error("maximumCandidates must be a positive integer");
  const retained = new Map<string, WhiteBoxCandidateTrace>();
  for (const candidate of trace.candidates.slice(0, maximumCandidates)) retained.set(candidate.id, candidate);
  for (const id of [incumbent, trace.selected]) {
    const candidate = trace.candidates.find(entry => entry.id === id);
    if (candidate) retained.set(candidate.id, candidate);
  }
  return {
    version: trace.version,
    decisionId: trace.decisionId,
    comparison: compareWhiteBoxShadow(trace, incumbent),
    candidateCount: trace.candidates.length,
    reasonableCount: trace.candidates.filter(candidate => candidate.reasonable).length,
    hardRejectedCount: trace.candidates.filter(candidate => !candidate.eligible).length,
    reasonableBand: trace.reasonableBand,
    styleContributionLimit: trace.styleContributionLimit,
    candidates: [...retained.values()].map(candidate => ({
      ...candidate,
      hardRejections: [...candidate.hardRejections],
      contributions: candidate.contributions.map(contribution => ({...contribution})),
      diagnostics: candidate.diagnostics ? {...candidate.diagnostics} : undefined,
    })),
  };
}

function validateInput(input: WhiteBoxDecisionInput): void {
  if (!input.decisionId.trim()) throw new Error("White-box decision id cannot be empty");
  if (!Number.isFinite(input.reasonableBand) || input.reasonableBand < 0) throw new Error("reasonableBand must be finite and non-negative");
  if (!Number.isFinite(input.styleContributionLimit) || input.styleContributionLimit < 0) throw new Error("styleContributionLimit must be finite and non-negative");
}

function validateContributions(candidateId: string, contributions: WhiteBoxContribution[]): void {
  const ids = new Set<string>();
  for (const contribution of contributions) {
    if (!contribution.id.trim() || !contribution.group.trim() || !contribution.reason.trim()) throw new Error(`Incomplete contribution for ${candidateId}`);
    if (!Number.isFinite(contribution.value)) throw new Error(`Non-finite contribution ${contribution.id} for ${candidateId}`);
    if (ids.has(contribution.id)) throw new Error(`Duplicate contribution ${contribution.id} for ${candidateId}`);
    ids.add(contribution.id);
  }
}

function validateDiagnostics(candidateId: string, diagnostics: Readonly<Record<string, number>> | undefined): void {
  if (!diagnostics) return;
  for (const [id, value] of Object.entries(diagnostics)) {
    if (!id.trim()) throw new Error(`Empty diagnostic id for ${candidateId}`);
    if (!Number.isFinite(value)) throw new Error(`Non-finite diagnostic ${id} for ${candidateId}`);
  }
}

function mapDiagnostics(diagnostics: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(diagnostics).sort(([left], [right]) => left.localeCompare(right)).map(([id, value]) => [id, round(value)]));
}

function sum(contributions: WhiteBoxContribution[]): number {
  return contributions.reduce((total, contribution) => total + contribution.value, 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}
