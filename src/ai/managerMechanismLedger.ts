import crypto from "node:crypto";

export const MANAGER_MECHANISM_LEDGER_SCHEMA_VERSION = 1;
export type MechanismEvidenceLevel = "exact-counterfactual" | "matched-local" | "natural-outcome" | "social-observation";
export type MechanismLearningStatus = "unseen" | "exploring" | "watch" | "locally-promising" | "locally-negative";
export interface MechanismPosterior {mean: number; uncertainty: number; effectiveSamples: number}
export interface MechanismAggregate {
  attempts: number; expressed: number; better: number; neutral: number; worse: number; evidenceWeight: number;
  weightedEffect: number; lastSeason: number; posterior: MechanismPosterior;
}
export interface MechanismContextAggregate extends MechanismAggregate {key: string; context: Record<string, string | number | boolean>}
export interface ManagerMechanismEntry extends MechanismAggregate {mechanismId: string; status: MechanismLearningStatus; contexts: MechanismContextAggregate[]}
export interface ManagerMechanismLedger {
  schemaVersion: typeof MANAGER_MECHANISM_LEDGER_SCHEMA_VERSION; managerId: string; revision: number;
  createdSeason: number; updatedSeason: number; activationStatus: "shadow-only";
  mechanisms: Record<string, ManagerMechanismEntry>; recentEvidenceIds: string[];
}
export interface ManagerMechanismEvidence {
  evidenceId: string; managerId: string; mechanismId: string; season: number; level: MechanismEvidenceLevel;
  expressed: boolean; effect: number; context: Record<string, string | number | boolean>;
}

const LEVEL_WEIGHTS: Record<MechanismEvidenceLevel, number> = {"exact-counterfactual": 1, "matched-local": .5, "natural-outcome": .15, "social-observation": .05};
const MAX_MECHANISMS = 64, MAX_CONTEXTS = 24, MAX_RECENT_EVIDENCE = 256, MAX_CONTEXT_FIELDS = 12;

export function createManagerMechanismLedger(managerId: string, season = 0): ManagerMechanismLedger {
  if (!managerId) throw new Error("Mechanism ledger requires managerId");
  return {schemaVersion: 1, managerId, revision: 0, createdSeason: season, updatedSeason: season, activationStatus: "shadow-only", mechanisms: {}, recentEvidenceIds: []};
}

export function recordManagerMechanismEvidence(input: ManagerMechanismLedger | undefined, evidence: ManagerMechanismEvidence): ManagerMechanismLedger {
  const ledger = structuredClone(input ?? createManagerMechanismLedger(evidence.managerId, evidence.season)); validateManagerMechanismLedger(ledger); validateEvidence(evidence);
  if (ledger.managerId !== evidence.managerId) throw new Error(`Mechanism evidence manager mismatch: ${evidence.managerId} != ${ledger.managerId}`);
  if (ledger.recentEvidenceIds.includes(evidence.evidenceId)) return ledger;
  let entry = ledger.mechanisms[evidence.mechanismId];
  if (!entry) {
    if (Object.keys(ledger.mechanisms).length >= MAX_MECHANISMS) throw new Error(`Manager mechanism limit reached: ${ledger.managerId}`);
    entry = emptyAggregate({mechanismId: evidence.mechanismId, status: "unseen", contexts: []}); ledger.mechanisms[evidence.mechanismId] = entry;
  }
  const context = normalizedContext(evidence.context), key = contextKey(context), weight = LEVEL_WEIGHTS[evidence.level];
  let contextAggregate = entry.contexts.find(value => value.key === key);
  if (!contextAggregate) { contextAggregate = emptyAggregate({key, context}); entry.contexts.push(contextAggregate); }
  updateAggregate(entry, evidence, weight); updateAggregate(contextAggregate, evidence, weight);
  entry.contexts.sort((left, right) => right.evidenceWeight - left.evidenceWeight || right.lastSeason - left.lastSeason || left.key.localeCompare(right.key));
  if (entry.contexts.length > MAX_CONTEXTS) entry.contexts.length = MAX_CONTEXTS;
  entry.status = learningStatus(entry);
  ledger.recentEvidenceIds.push(evidence.evidenceId); if (ledger.recentEvidenceIds.length > MAX_RECENT_EVIDENCE) ledger.recentEvidenceIds.splice(0, ledger.recentEvidenceIds.length - MAX_RECENT_EVIDENCE);
  ledger.revision += 1; ledger.updatedSeason = Math.max(ledger.updatedSeason, evidence.season); validateManagerMechanismLedger(ledger); return ledger;
}

export function validateManagerMechanismLedger(ledger: ManagerMechanismLedger): void {
  if (ledger.schemaVersion !== 1 || !ledger.managerId || ledger.activationStatus !== "shadow-only" || !Number.isInteger(ledger.revision) || ledger.revision < 0 || !Number.isInteger(ledger.createdSeason) || !Number.isInteger(ledger.updatedSeason) || ledger.updatedSeason < ledger.createdSeason) throw new Error(`Invalid manager mechanism ledger header: ${ledger.managerId}`);
  if (Object.keys(ledger.mechanisms).length > MAX_MECHANISMS || ledger.recentEvidenceIds.length > MAX_RECENT_EVIDENCE || new Set(ledger.recentEvidenceIds).size !== ledger.recentEvidenceIds.length) throw new Error(`Invalid manager mechanism ledger bounds: ${ledger.managerId}`);
  for (const [id, entry] of Object.entries(ledger.mechanisms)) {
    if (entry.mechanismId !== id || !/^[a-z0-9-]+-v\d+$/.test(id) || entry.contexts.length > MAX_CONTEXTS || new Set(entry.contexts.map(value => value.key)).size !== entry.contexts.length) throw new Error(`Invalid manager mechanism entry: ${ledger.managerId}/${id}`);
    validateAggregate(entry); for (const context of entry.contexts) { if (!/^[a-f0-9]{16}$/.test(context.key) || Object.keys(context.context).length > MAX_CONTEXT_FIELDS) throw new Error(`Invalid mechanism context: ${ledger.managerId}/${id}`); validateAggregate(context); }
  }
}

export function managerMechanismLedgerSummary(ledger: ManagerMechanismLedger): Record<string, unknown> {
  validateManagerMechanismLedger(ledger); const entries = Object.values(ledger.mechanisms);
  return {managerId: ledger.managerId, revision: ledger.revision, updatedSeason: ledger.updatedSeason, activationStatus: ledger.activationStatus, mechanisms: entries.length, attempts: entries.reduce((sum, value) => sum + value.attempts, 0), expressed: entries.reduce((sum, value) => sum + value.expressed, 0), statuses: Object.fromEntries((["unseen", "exploring", "watch", "locally-promising", "locally-negative"] as const).map(status => [status, entries.filter(value => value.status === status).length])), leading: entries.sort((left, right) => right.evidenceWeight - left.evidenceWeight || left.mechanismId.localeCompare(right.mechanismId)).slice(0, 8).map(value => ({mechanismId: value.mechanismId, status: value.status, posterior: value.posterior, attempts: value.attempts, expressed: value.expressed}))};
}

export function managerMechanismPopulationSummary(ledgers: ManagerMechanismLedger[]): Record<string, unknown> {
  for (const ledger of ledgers) validateManagerMechanismLedger(ledger);
  if (new Set(ledgers.map(ledger => ledger.managerId)).size !== ledgers.length) throw new Error("Duplicate managers in mechanism ledger population");
  const attempts = ledgers.map(ledger => Object.values(ledger.mechanisms).reduce((sum, entry) => sum + entry.attempts, 0)).sort((left, right) => left - right);
  const mechanismIds = [...new Set(ledgers.flatMap(ledger => Object.keys(ledger.mechanisms)))].sort();
  const mechanisms = mechanismIds.map(mechanismId => {
    const entries = ledgers.map(ledger => ledger.mechanisms[mechanismId]).filter((entry): entry is ManagerMechanismEntry => Boolean(entry));
    return {mechanismId, managers: entries.length, attempts: entries.reduce((sum, entry) => sum + entry.attempts, 0), expressed: entries.reduce((sum, entry) => sum + entry.expressed, 0), better: entries.reduce((sum, entry) => sum + entry.better, 0), neutral: entries.reduce((sum, entry) => sum + entry.neutral, 0), worse: entries.reduce((sum, entry) => sum + entry.worse, 0)};
  });
  const total = attempts.reduce((sum, value) => sum + value, 0), minimum = attempts[0] ?? 0, maximum = attempts.at(-1) ?? 0;
  return {
    schemaVersion: 1, activationStatus: "shadow-only", managers: ledgers.length,
    coverage: {withEvidence: attempts.filter(value => value > 0).length, withoutEvidence: attempts.filter(value => value === 0).length, minimumAttempts: minimum, medianAttempts: quantile(attempts, .5), maximumAttempts: maximum, meanAttempts: round(total / Math.max(1, attempts.length)), gini: gini(attempts)},
    mechanisms,
    underSampledManagers: ledgers.map((ledger, index) => ({managerId: ledger.managerId, attempts: ledgers[index] ? Object.values(ledger.mechanisms).reduce((sum, entry) => sum + entry.attempts, 0) : 0})).sort((left, right) => left.attempts - right.attempts || left.managerId.localeCompare(right.managerId)).slice(0, 12),
  };
}

function updateAggregate(aggregate: MechanismAggregate, evidence: ManagerMechanismEvidence, weight: number): void {
  aggregate.attempts += 1; aggregate.lastSeason = Math.max(aggregate.lastSeason, evidence.season); if (!evidence.expressed) return;
  aggregate.expressed += 1; if (evidence.effect > 1e-9) aggregate.better += 1; else if (evidence.effect < -1e-9) aggregate.worse += 1; else aggregate.neutral += 1;
  aggregate.evidenceWeight += weight; aggregate.weightedEffect += weight * evidence.effect; aggregate.posterior = posterior(aggregate.weightedEffect, aggregate.evidenceWeight);
}
function posterior(weightedEffect: number, weight: number): MechanismPosterior { return {mean: round(weight ? weightedEffect / weight : 0), uncertainty: round(1 / Math.sqrt(1 + weight)), effectiveSamples: round(weight)}; }
function learningStatus(entry: ManagerMechanismEntry): MechanismLearningStatus { if (!entry.attempts) return "unseen"; if (entry.evidenceWeight < 2) return "exploring"; if (entry.posterior.uncertainty > .45) return "watch"; if (entry.posterior.mean >= .15) return "locally-promising"; if (entry.posterior.mean <= -.15) return "locally-negative"; return "watch"; }
function normalizedContext(value: Record<string, string | number | boolean>): Record<string, string | number | boolean> { const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right)); if (!entries.length || entries.length > MAX_CONTEXT_FIELDS) throw new Error(`Mechanism context must contain 1..${MAX_CONTEXT_FIELDS} fields`); return Object.fromEntries(entries.map(([key, item]) => { if (!/^[a-zA-Z0-9_.-]+$/.test(key) || !["string", "number", "boolean"].includes(typeof item) || typeof item === "number" && !Number.isFinite(item) || typeof item === "string" && item.length > 80) throw new Error(`Invalid mechanism context field: ${key}`); return [key, typeof item === "number" ? round(item) : item]; })); }
function contextKey(context: Record<string, string | number | boolean>): string { return crypto.createHash("sha256").update(JSON.stringify(context)).digest("hex").slice(0, 16); }
function validateEvidence(evidence: ManagerMechanismEvidence): void { if (!/^[a-zA-Z0-9:._-]{8,200}$/.test(evidence.evidenceId) || !evidence.managerId || !/^[a-z0-9-]+-v\d+$/.test(evidence.mechanismId) || !Number.isInteger(evidence.season) || evidence.season < 0 || !(evidence.level in LEVEL_WEIGHTS) || !Number.isFinite(evidence.effect) || evidence.effect < -1 || evidence.effect > 1) throw new Error(`Invalid manager mechanism evidence: ${evidence.evidenceId}`); normalizedContext(evidence.context); }
function validateAggregate(value: MechanismAggregate): void { if (![value.attempts, value.expressed, value.better, value.neutral, value.worse, value.lastSeason].every(item => Number.isInteger(item) && item >= 0) || value.expressed > value.attempts || value.better + value.neutral + value.worse !== value.expressed || !Number.isFinite(value.evidenceWeight) || value.evidenceWeight < 0 || !Number.isFinite(value.weightedEffect) || Math.abs(value.weightedEffect) > value.evidenceWeight + 1e-9 || ![value.posterior.mean, value.posterior.uncertainty, value.posterior.effectiveSamples].every(Number.isFinite)) throw new Error("Invalid mechanism aggregate"); }
function emptyAggregate<T extends object>(extra: T): T & MechanismAggregate { return {...extra, attempts: 0, expressed: 0, better: 0, neutral: 0, worse: 0, evidenceWeight: 0, weightedEffect: 0, lastSeason: 0, posterior: posterior(0, 0)}; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function quantile(values: number[], fraction: number): number { if (!values.length) return 0; const index = (values.length - 1) * fraction, lower = Math.floor(index), upper = Math.ceil(index); return round(values[lower] + (values[upper] - values[lower]) * (index - lower)); }
function gini(values: number[]): number { const total = values.reduce((sum, value) => sum + value, 0); if (!values.length || !total) return 0; const sorted = [...values].sort((left, right) => left - right), weighted = sorted.reduce((sum, value, index) => sum + (index + 1) * value, 0); return round(2 * weighted / (sorted.length * total) - (sorted.length + 1) / sorted.length); }
