import crypto from "node:crypto";
import {validateManagerProgramV2, type ManagerProgramRuleV2, type ManagerProgramV2} from "./managerProgramV2";
import {formalMechanismKey, type FormalValidationDomainResult} from "./formalValidation";

export const AUTONOMOUS_RESEARCH_VERSION = "autonomous-research-v1.1-formal-feedback";
export type AutonomousResearchIntent = "test-program-mechanism" | "replicate-support" | "resolve-contradiction" | "map-neutral-boundary" | "resolve-formal-inconclusive";
export type AutonomousResearchDirection = "better" | "neutral" | "worse";
export interface AutonomousResearchFormalFeedback {mechanismKey: string; disposition: FormalValidationDomainResult["disposition"]; generations: number; cases: number; supports: number; contradictions: number; neutral: number; reasons: string[]}

export interface AutonomousResearchObservation {
  id: string;
  questionId: string;
  ruleId: string;
  round: number;
  caseId: string;
  direction: AutonomousResearchDirection;
  expectedDirection: Exclude<AutonomousResearchDirection, "neutral">;
  supportsHypothesis: boolean;
  outcomeChanged: boolean;
  authority: "exact-counterfactual-single-environment";
  sourceFingerprint: string;
}

export interface AutonomousResearchManagerState {
  schemaVersion: 1;
  version: typeof AUTONOMOUS_RESEARCH_VERSION;
  activationStatus: "shadow-only";
  managerId: string;
  revision: number;
  completedRounds: number;
  observations: AutonomousResearchObservation[];
  usedCaseIds: string[];
}

export interface AutonomousResearchQuestion {
  id: string;
  managerId: string;
  round: number;
  ruleId: string;
  target: string;
  predicates: ManagerProgramRuleV2["predicates"];
  programEffect: number;
  expectedInterventionDirection: Exclude<AutonomousResearchDirection, "neutral">;
  intent: AutonomousResearchIntent;
  feasibleCases: number;
  score: number;
  components: {uncertainty: number; evidenceNeed: number; contradiction: number; applicability: number; programImpact: number; exploration: number};
  evidenceAuthority: "program-local-value-observational";
}

export interface AutonomousResearchAgenda {
  schemaVersion: 1;
  version: typeof AUTONOMOUS_RESEARCH_VERSION;
  activationStatus: "shadow-only";
  managerId: string;
  round: number;
  selected: AutonomousResearchQuestion | null;
  ranked: AutonomousResearchQuestion[];
  blockedRules: Array<{ruleId: string; reason: "no-executable-counterfactual" | "formal-validation-rejected" | "formal-validation-complete"}>;
}

export interface AutonomousResearchResult {
  questionId: string;
  managerId: string;
  ruleId: string;
  round: number;
  caseId: string;
  direction: AutonomousResearchDirection;
  expectedDirection: Exclude<AutonomousResearchDirection, "neutral">;
  outcomeChanged: boolean;
  sourceVerified: boolean;
  prefixVerified: boolean;
  interventionVerified: boolean;
  sourceFingerprint: string;
}

export function createAutonomousResearchState(managerId: string): AutonomousResearchManagerState {
  if (!managerId) throw new Error("Autonomous research state requires managerId");
  return {schemaVersion: 1, version: AUTONOMOUS_RESEARCH_VERSION, activationStatus: "shadow-only", managerId, revision: 0, completedRounds: 0, observations: [], usedCaseIds: []};
}

export function buildAutonomousResearchAgenda(input: {program: ManagerProgramV2; state: AutonomousResearchManagerState; round: number; feasibleCases: Readonly<Record<string, number>>; seed: string; formalFeedback?: Readonly<Record<string, AutonomousResearchFormalFeedback>>}): AutonomousResearchAgenda {
  validateManagerProgramV2(input.program); validateAutonomousResearchState(input.state);
  if (input.program.managerId !== input.state.managerId || input.round !== input.state.completedRounds + 1) throw new Error(`Autonomous research state mismatch: ${input.state.managerId}`);
  const blockedRules: AutonomousResearchAgenda["blockedRules"] = [], questions: AutonomousResearchQuestion[] = [];
  for (const rule of input.program.rules) {
    const feedback = input.formalFeedback?.[formalMechanismKey(rule)];
    if (feedback?.disposition === "rejected") { blockedRules.push({ruleId: rule.id, reason: "formal-validation-rejected"}); continue; }
    if (feedback?.disposition === "limited-canary-eligible") { blockedRules.push({ruleId: rule.id, reason: "formal-validation-complete"}); continue; }
    const feasibleCases = Math.max(0, Math.floor(input.feasibleCases[rule.id] ?? 0));
    if (!feasibleCases) { blockedRules.push({ruleId: rule.id, reason: "no-executable-counterfactual"}); continue; }
    const history = input.state.observations.filter(value => value.ruleId === rule.id), supports = history.filter(value => value.supportsHypothesis).length, contradicts = history.filter(value => value.direction !== "neutral" && !value.supportsHypothesis).length, neutrals = history.filter(value => value.direction === "neutral").length;
    const intent: AutonomousResearchIntent = feedback?.disposition === "inconclusive" || feedback?.disposition === "blocked" ? "resolve-formal-inconclusive" : contradicts ? "resolve-contradiction" : supports ? "replicate-support" : neutrals ? "map-neutral-boundary" : "test-program-mechanism";
    const components = {
      uncertainty: round(clamp(rule.uncertainty + 1 / Math.sqrt(1 + rule.support), 0, 1)),
      evidenceNeed: round(Math.max(1 / Math.sqrt(1 + history.length), feedback?.disposition === "inconclusive" || feedback?.disposition === "blocked" ? .85 : 0)),
      contradiction: round(history.length ? contradicts / history.length : 0),
      applicability: round(clamp(Math.log1p(feasibleCases) / Math.log(65), 0, 1)),
      programImpact: round(Math.min(1, Math.abs(rule.effect) / .2)),
      exploration: round(hashUnit(`${input.seed}:${input.state.managerId}:${input.round}:${rule.id}`)),
    };
    const score = round(.24 * components.uncertainty + .22 * components.evidenceNeed + .2 * components.contradiction + .14 * components.applicability + .15 * components.programImpact + .05 * components.exploration);
    questions.push({id: `arq-${digest([input.state.managerId, input.round, rule.id, input.state.revision]).slice(0, 20)}`, managerId: input.state.managerId, round: input.round, ruleId: rule.id, target: rule.target, predicates: rule.predicates.map(value => ({...value})), programEffect: rule.effect, expectedInterventionDirection: rule.effect > 0 ? "worse" : "better", intent, feasibleCases, score, components, evidenceAuthority: "program-local-value-observational"});
  }
  questions.sort((left, right) => right.score - left.score || left.ruleId.localeCompare(right.ruleId));
  const agenda: AutonomousResearchAgenda = {schemaVersion: 1, version: AUTONOMOUS_RESEARCH_VERSION, activationStatus: "shadow-only", managerId: input.state.managerId, round: input.round, selected: questions[0] ?? null, ranked: questions, blockedRules: blockedRules.sort((left, right) => left.ruleId.localeCompare(right.ruleId))};
  validateAutonomousResearchAgenda(agenda); return agenda;
}

export function reviewAutonomousResearchRound(stateInput: AutonomousResearchManagerState, agenda: AutonomousResearchAgenda, result?: AutonomousResearchResult): AutonomousResearchManagerState {
  const state = structuredClone(stateInput); validateAutonomousResearchState(state); validateAutonomousResearchAgenda(agenda);
  if (agenda.managerId !== state.managerId || agenda.round !== state.completedRounds + 1) throw new Error(`Autonomous research review mismatch: ${state.managerId}`);
  if (result) {
    const question = agenda.ranked.find(value => value.id === result.questionId);
    if (!question || result.managerId !== state.managerId || result.ruleId !== question.ruleId || result.round !== agenda.round || result.expectedDirection !== question.expectedInterventionDirection || !result.sourceVerified || !result.prefixVerified || !result.interventionVerified || state.usedCaseIds.includes(result.caseId)) throw new Error(`Invalid autonomous research result: ${state.managerId}`);
    const observation: AutonomousResearchObservation = {id: `aro-${digest(result).slice(0, 20)}`, questionId: question.id, ruleId: question.ruleId, round: agenda.round, caseId: result.caseId, direction: result.direction, expectedDirection: question.expectedInterventionDirection, supportsHypothesis: result.direction === question.expectedInterventionDirection, outcomeChanged: result.outcomeChanged, authority: "exact-counterfactual-single-environment", sourceFingerprint: result.sourceFingerprint};
    state.observations.push(observation); state.usedCaseIds.push(result.caseId);
  }
  state.completedRounds += 1; state.revision += 1; validateAutonomousResearchState(state); return state;
}

export function validateAutonomousResearchState(value: AutonomousResearchManagerState): void {
  if (value.schemaVersion !== 1 || value.version !== AUTONOMOUS_RESEARCH_VERSION || value.activationStatus !== "shadow-only" || !value.managerId || !Number.isInteger(value.revision) || value.revision < 0 || !Number.isInteger(value.completedRounds) || value.completedRounds < 0 || value.revision !== value.completedRounds || !Array.isArray(value.observations) || !Array.isArray(value.usedCaseIds) || new Set(value.usedCaseIds).size !== value.usedCaseIds.length) throw new Error(`Invalid autonomous research state: ${value.managerId}`);
  const observationIds = value.observations.map(observation => observation.id), observationCases = value.observations.map(observation => observation.caseId), observationRounds = value.observations.map(observation => observation.round);
  if (value.observations.length !== value.usedCaseIds.length || value.observations.length > value.completedRounds || new Set(observationIds).size !== observationIds.length || new Set(observationCases).size !== observationCases.length || JSON.stringify(observationCases) !== JSON.stringify(value.usedCaseIds) || observationRounds.some((round, index) => round < 1 || round > value.completedRounds || index > 0 && round <= observationRounds[index - 1]) || value.observations.some(observation => !observation.id || !observation.questionId || !observation.ruleId || !observation.caseId || observation.round < 1 || !["better", "neutral", "worse"].includes(observation.direction) || !["better", "worse"].includes(observation.expectedDirection) || observation.supportsHypothesis !== (observation.direction === observation.expectedDirection) || typeof observation.outcomeChanged !== "boolean" || observation.authority !== "exact-counterfactual-single-environment" || !/^[a-f0-9]{64}$/i.test(observation.sourceFingerprint))) throw new Error(`Invalid autonomous research observations: ${value.managerId}`);
}

export function validateAutonomousResearchAgenda(value: AutonomousResearchAgenda): void {
  if (value.schemaVersion !== 1 || value.version !== AUTONOMOUS_RESEARCH_VERSION || value.activationStatus !== "shadow-only" || !value.managerId || !Number.isInteger(value.round) || value.round < 1 || !Array.isArray(value.ranked) || !Array.isArray(value.blockedRules) || (value.selected ? value.selected.id !== value.ranked[0]?.id : value.ranked.length > 0)) throw new Error(`Invalid autonomous research agenda: ${value.managerId}`);
  const ids = value.ranked.map(question => question.id); if (new Set(ids).size !== ids.length) throw new Error(`Duplicate autonomous research questions: ${value.managerId}`);
  for (let index = 0; index < value.ranked.length; index += 1) { const question = value.ranked[index]; if (question.managerId !== value.managerId || question.round !== value.round || !question.id || !question.ruleId || !question.target || !Number.isFinite(question.programEffect) || !Number.isInteger(question.feasibleCases) || question.feasibleCases < 1 || !Number.isFinite(question.score) || question.score < 0 || question.score > 2 || question.evidenceAuthority !== "program-local-value-observational" || index && value.ranked[index - 1].score < question.score || !Object.values(question.components).every(component => Number.isFinite(component) && component >= 0 && component <= 1)) throw new Error(`Invalid autonomous research question: ${value.managerId}/${question.id}`); }
}

export function summarizeAutonomousResearch(states: readonly AutonomousResearchManagerState[]): Record<string, unknown> {
  states.forEach(validateAutonomousResearchState); const observations = states.flatMap(state => state.observations);
  return {schemaVersion: 1, version: AUTONOMOUS_RESEARCH_VERSION, activationStatus: "shadow-only", managers: states.length, completedRounds: states.length ? Math.min(...states.map(state => state.completedRounds)) : 0, experiments: observations.length, better: observations.filter(value => value.direction === "better").length, neutral: observations.filter(value => value.direction === "neutral").length, worse: observations.filter(value => value.direction === "worse").length, supports: observations.filter(value => value.supportsHypothesis).length, contradictions: observations.filter(value => value.direction !== "neutral" && !value.supportsHypothesis).length, outcomeChanges: observations.filter(value => value.outcomeChanged).length, managersWithSupport: states.filter(state => state.observations.some(value => value.supportsHypothesis)).length, managersWithContradiction: states.filter(state => state.observations.some(value => value.direction !== "neutral" && !value.supportsHypothesis)).length};
}

function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function digest(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function hashUnit(value: string): number { return Number.parseInt(digest(value).slice(0, 12), 16) / 0xffffffffffff; }
