import crypto from "node:crypto";
import {validateManagerMechanismLedger, type ManagerMechanismEntry, type ManagerMechanismLedger} from "./managerMechanismLedger";

export const MANAGER_RESEARCH_AGENDA_SCHEMA_VERSION = 1;
export type ResearchIntent = "new-causal-test" | "replicate-local-benefit" | "map-local-failure" | "resolve-local-contradiction";
export interface ResearchHypothesisOption {id: string; title: string; observationalCandidate: boolean; causalConclusion: string | null}
export interface ResearchScoreComponents {novelty: number; epistemicValue: number; replicationNeed: number; localSignal: number; publicPersonalTension: number; deterministicExploration: number}
export interface ManagerResearchQuestion {mechanismId: string; title: string; intent: ResearchIntent; score: number; eligible: boolean; components: ResearchScoreComponents; reasons: string[]; blockedReason?: string}
export interface ManagerResearchAgenda {
  schemaVersion: typeof MANAGER_RESEARCH_AGENDA_SCHEMA_VERSION; activationStatus: "shadow-only"; managerId: string; round: number;
  policy: {source: "personal-research-policy"; revision: number; exploration: number}; selected: ManagerResearchQuestion | null;
  ranked: ManagerResearchQuestion[]; deferred: Array<{mechanismId: string; reason: string}>;
}
export interface ManagerResearchPolicyState {schemaVersion: 1; activationStatus: "shadow-only"; managerId: string; revision: number; completedRounds: number; exploration: number; modeEvidence: Record<ResearchIntent, {attempts: number; informationReward: number}>}
export interface ManagerResearchOutcome {managerId: string; mechanismId: string; direction: "better" | "neutral" | "worse"; expressionRate: number; outcomeChangeRate: number}

export function createManagerResearchPolicy(managerId: string): ManagerResearchPolicyState { if (!managerId) throw new Error("Research policy requires managerId"); return {schemaVersion: 1, activationStatus: "shadow-only", managerId, revision: 0, completedRounds: 0, exploration: .5, modeEvidence: {"new-causal-test": {attempts: 0, informationReward: 0}, "replicate-local-benefit": {attempts: 0, informationReward: 0}, "map-local-failure": {attempts: 0, informationReward: 0}, "resolve-local-contradiction": {attempts: 0, informationReward: 0}}}; }
export function validateManagerResearchPolicy(value: ManagerResearchPolicyState): void { if (value.schemaVersion !== 1 || value.activationStatus !== "shadow-only" || !value.managerId || !Number.isInteger(value.revision) || value.revision < 0 || !Number.isInteger(value.completedRounds) || value.completedRounds < 0 || !Number.isFinite(value.exploration) || value.exploration < .05 || value.exploration > .95) throw new Error(`Invalid manager research policy: ${value.managerId}`); for (const intent of ["new-causal-test", "replicate-local-benefit", "map-local-failure", "resolve-local-contradiction"] as const) { const evidence = value.modeEvidence?.[intent]; if (!evidence || !Number.isInteger(evidence.attempts) || evidence.attempts < 0 || !Number.isFinite(evidence.informationReward) || evidence.informationReward < 0) throw new Error(`Invalid research mode evidence: ${value.managerId}/${intent}`); } }

export function reviewManagerResearchRound(policyInput: ManagerResearchPolicyState, agenda: ManagerResearchAgenda, outcome?: ManagerResearchOutcome): {policy: ManagerResearchPolicyState; informationReward: number | null; executed: boolean; executedMechanismId: string | null; executedIntent: ResearchIntent | null; preferenceRank: number | null} {
  const policy = structuredClone(policyInput); validateManagerResearchPolicy(policy);
  if (agenda.managerId !== policy.managerId || agenda.round !== policy.completedRounds + 1 || agenda.policy.revision !== policy.revision) throw new Error(`Research review state mismatch: ${policy.managerId}`);
  let informationReward: number | null = null;
  let executedQuestion: ManagerResearchQuestion | undefined, preferenceRank: number | null = null;
  if (outcome) {
    preferenceRank = agenda.ranked.findIndex(question => question.mechanismId === outcome.mechanismId); executedQuestion = preferenceRank >= 0 ? agenda.ranked[preferenceRank] : undefined;
    if (!executedQuestion || outcome.managerId !== policy.managerId || ![outcome.expressionRate, outcome.outcomeChangeRate].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error(`Invalid manager research outcome: ${policy.managerId}`);
    const directionalInformation = outcome.direction === "neutral" ? .4 : 1, base = .5 * outcome.expressionRate + .3 * outcome.outcomeChangeRate + .2 * directionalInformation;
    const consistency = executedQuestion.intent === "replicate-local-benefit" ? outcome.direction === "better" ? 1 : outcome.direction === "worse" ? .7 : .3 : executedQuestion.intent === "map-local-failure" ? outcome.direction === "worse" ? 1 : outcome.direction === "better" ? .7 : .3 : 1;
    informationReward = round6(executedQuestion.intent === "new-causal-test" || executedQuestion.intent === "resolve-local-contradiction" ? base : .7 * base + .3 * consistency);
    const evidence = policy.modeEvidence[executedQuestion.intent]; evidence.attempts += 1; evidence.informationReward = round6(evidence.informationReward + informationReward);
  }
  const newMean = modeMean(policy, "new-causal-test"), other = (["replicate-local-benefit", "map-local-failure", "resolve-local-contradiction"] as const).map(intent => modeMean(policy, intent)), otherMean = other.reduce((sum, value) => sum + value, 0) / other.length;
  policy.exploration = round6(clamp(.2, .8, .5 + .3 * (newMean - otherMean))); policy.completedRounds += 1; policy.revision += 1; validateManagerResearchPolicy(policy);
  return {policy, informationReward, executed: Boolean(outcome), executedMechanismId: executedQuestion?.mechanismId ?? null, executedIntent: executedQuestion?.intent ?? null, preferenceRank};
}

export function buildManagerResearchAgenda(managerId: string, ledger: ManagerMechanismLedger, hypotheses: readonly ResearchHypothesisOption[], round: number, policy: ManagerResearchPolicyState): ManagerResearchAgenda {
  validateManagerMechanismLedger(ledger);
  validateManagerResearchPolicy(policy);
  if (ledger.managerId !== managerId || policy.managerId !== managerId || policy.completedRounds !== round - 1 || !Number.isInteger(round) || round < 1) throw new Error(`Invalid manager research agenda input: ${managerId}`);
  if (new Set(hypotheses.map(value => value.id)).size !== hypotheses.length) throw new Error("Duplicate research hypothesis options");
  const questions = hypotheses.map(hypothesis => questionFor(managerId, ledger.mechanisms[hypothesis.id], hypothesis, round, policy));
  const ranked = questions.filter(question => question.eligible).sort((left, right) => right.score - left.score || left.mechanismId.localeCompare(right.mechanismId));
  const selected = ranked[0] ?? null;
  const agenda: ManagerResearchAgenda = {schemaVersion: 1, activationStatus: "shadow-only", managerId, round, policy: {source: "personal-research-policy", revision: policy.revision, exploration: round6(policy.exploration)}, selected, ranked, deferred: questions.filter(question => !question.eligible).map(question => ({mechanismId: question.mechanismId, reason: question.blockedReason!})).sort((left, right) => left.mechanismId.localeCompare(right.mechanismId))}; validateManagerResearchAgenda(agenda); return agenda;
}

export function validateManagerResearchAgenda(value: ManagerResearchAgenda): void {
  if (value.schemaVersion !== 1 || value.activationStatus !== "shadow-only" || !value.managerId || !Number.isInteger(value.round) || value.round < 1 || value.policy.source !== "personal-research-policy" || !Number.isInteger(value.policy.revision) || value.policy.revision < 0 || !Number.isFinite(value.policy.exploration) || value.policy.exploration < .05 || value.policy.exploration > .95 || !Array.isArray(value.ranked) || !Array.isArray(value.deferred)) throw new Error(`Invalid manager research agenda: ${value.managerId}`);
  const rankedIds = value.ranked.map(question => question.mechanismId), deferredIds = value.deferred.map(question => question.mechanismId);
  if (new Set(rankedIds).size !== rankedIds.length || new Set(deferredIds).size !== deferredIds.length || rankedIds.some(id => deferredIds.includes(id)) || (value.selected ? value.ranked[0]?.mechanismId !== value.selected.mechanismId : value.ranked.length > 0)) throw new Error(`Invalid research agenda ordering: ${value.managerId}`);
  for (let index = 0; index < value.ranked.length; index++) { const question = value.ranked[index]; if (!question.eligible || !question.mechanismId || !Number.isFinite(question.score) || question.score < 0 || index && value.ranked[index - 1].score < question.score || !Object.values(question.components).every(component => Number.isFinite(component) && component >= 0 && component <= 1)) throw new Error(`Invalid ranked research question: ${value.managerId}/${question.mechanismId}`); }
  if (value.deferred.some(item => !item.mechanismId || !item.reason)) throw new Error(`Invalid deferred research question: ${value.managerId}`);
}

export function summarizeManagerResearchAgendas(agendas: readonly ManagerResearchAgenda[]): Record<string, unknown> {
  for (const agenda of agendas) validateManagerResearchAgenda(agenda);
  if (new Set(agendas.map(value => value.managerId)).size !== agendas.length) throw new Error("Invalid manager research agenda population");
  const selected = agendas.filter(value => value.selected).map(value => value.selected!);
  return {schemaVersion: 1, activationStatus: "shadow-only", managers: agendas.length, managersWithRequest: selected.length, requestsByMechanism: counts(selected.map(value => value.mechanismId)), requestsByIntent: counts(selected.map(value => value.intent)), meanEligibleQuestions: round6(agendas.reduce((sum, value) => sum + value.ranked.length, 0) / Math.max(1, agendas.length)), noRequestManagers: agendas.filter(value => !value.selected).map(value => value.managerId)};
}

function questionFor(managerId: string, entry: ManagerMechanismEntry | undefined, hypothesis: ResearchHypothesisOption, round: number, policy: ManagerResearchPolicyState): ManagerResearchQuestion {
  const exploration = policy.exploration;
  const attempts = entry?.attempts ?? 0, nonNeutral = (entry?.better ?? 0) + (entry?.worse ?? 0), posterior = entry?.posterior ?? {mean: 0, uncertainty: 1, effectiveSamples: 0};
  const intent = intentFor(entry), publicCandidate = hypothesis.observationalCandidate && !hypothesis.causalConclusion, personalReplication = Boolean(hypothesis.causalConclusion && entry && nonNeutral > 0 && attempts < 4);
  const eligible = publicCandidate || personalReplication;
  const novelty = 1 / Math.sqrt(1 + attempts), epistemicValue = posterior.uncertainty, replicationNeed = nonNeutral ? Math.max(0, 4 - attempts) / 4 : 0;
  const localSignal = Math.abs(posterior.mean) * (1 - posterior.uncertainty), publicPersonalTension = hypothesis.causalConclusion && Math.abs(posterior.mean) > 0 ? Math.abs(posterior.mean) * posterior.uncertainty : 0;
  const deterministicExploration = hashUnit(`${managerId}:${hypothesis.id}:${round}`);
  const exploit = .32 * replicationNeed + .23 * localSignal + .2 * publicPersonalTension + .25 * epistemicValue;
  const explore = .45 * novelty + .4 * epistemicValue + .15 * deterministicExploration;
  const modePreference = modeMean(policy, intent) + .5 / Math.sqrt(1 + policy.modeEvidence[intent].attempts);
  const score = eligible ? round6(exploration * explore + (1 - exploration) * exploit + .15 * modePreference) : 0;
  const reasons = eligible ? [
    publicCandidate ? "Public observational evidence permits a new causal question" : "A personal non-neutral result requires independent replication before belief",
    attempts ? `${attempts} personal attempt(s); uncertainty ${round6(posterior.uncertainty)}` : "No personal evidence yet",
    intent === "map-local-failure" ? "The objective is to locate the failure boundary, not to suppress negative evidence" : intent === "resolve-local-contradiction" ? "Conflicting local outcomes require contextual separation" : "The request seeks information before any policy use",
  ] : [];
  const blockedReason = eligible ? undefined : hypothesis.causalConclusion ? nonNeutral === 0 ? "Reviewed causal mechanism has no unresolved personal directional result" : "Personal replication threshold has already been reached" : "Public observational gate has not approved causal scheduling";
  return {mechanismId: hypothesis.id, title: hypothesis.title, intent, score, eligible, components: {novelty: round6(novelty), epistemicValue: round6(epistemicValue), replicationNeed: round6(replicationNeed), localSignal: round6(localSignal), publicPersonalTension: round6(publicPersonalTension), deterministicExploration: round6(deterministicExploration)}, reasons, ...(blockedReason ? {blockedReason} : {})};
}

function intentFor(entry: ManagerMechanismEntry | undefined): ResearchIntent { if (!entry || !entry.expressed) return "new-causal-test"; if (entry.better && entry.worse) return "resolve-local-contradiction"; if (entry.better) return "replicate-local-benefit"; if (entry.worse) return "map-local-failure"; return "new-causal-test"; }
function hashUnit(value: string): number { return Number.parseInt(crypto.createHash("sha256").update(value).digest("hex").slice(0, 12), 16) / 0xffffffffffff; }
function modeMean(policy: ManagerResearchPolicyState, intent: ResearchIntent): number { const value = policy.modeEvidence[intent]; return value.attempts ? value.informationReward / value.attempts : .5; }
function clamp(minimum: number, maximum: number, value: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function counts(values: string[]): Record<string, number> { const result: Record<string, number> = {}; for (const value of [...values].sort()) result[value] = (result[value] ?? 0) + 1; return result; }
function round6(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
