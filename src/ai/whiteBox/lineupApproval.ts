import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {applicabilityPass, type LineupAuditHypothesis} from "./lineupHypothesisWorkbench";
import type {WhiteBoxCandidateTrace} from "./decision";
import {WHITE_BOX_LINEUP_ASSIST_VERSION} from "./lineup";
import {AI_VERSION} from "../../showdown/choice";
import {buildEvidenceEpoch} from "../../showdown/evidenceEpoch";

export const LINEUP_APPROVAL_POLICY_VERSION = "lineup-scoped-assist-v1";
export interface LineupAssistApproval {
  schemaVersion: 2;
  sha256: string;
  payload: {
    policyVersion: typeof LINEUP_APPROVAL_POLICY_VERSION;
    assistVersion: typeof WHITE_BOX_LINEUP_ASSIST_VERSION;
    hypothesis: Pick<LineupAuditHypothesis, "id" | "minimumRepresentationVersion" | "factors" | "guardrails" | "applicability">;
    evidence: {policySha256: string; summarySha256: string; manifestSha256: string; sourceStateSha256: string};
    canary: {applicationRate: number; maximumApplicationsPerSeason: number; firstSeason: number; expiresAfterSeason: number};
    safety: {minimumHypothesisScoreDelta: number; maximumRationalRegression: number};
  };
}
export interface LineupApprovalDecision {approved: boolean; applied: boolean; candidateId: string | null; hypothesisScoreDelta: number | null; rationalRegression: number | null; reasons: string[]}

export function buildLineupAssistApproval(studyDirectory: string, hypothesis: LineupAuditHypothesis, options: {applicationRate: number; maximumApplicationsPerSeason: number; firstSeason: number; expiresAfterSeason: number; minimumHypothesisScoreDelta?: number; maximumRationalRegression?: number}): LineupAssistApproval {
  const summaryFile = path.join(studyDirectory, "causal-summary.json"), manifestFile = path.join(studyDirectory, "causal-manifest.json");
  const summary = read<any>(summaryFile), manifest = read<any>(manifestFile);
  const policySha256 = buildEvidenceEpoch(AI_VERSION, "gen9ou").policySha256;
  if (summary.evidenceEpoch?.policySha256 !== policySha256 || summary.evidenceEpoch?.formalActivationAllowed !== true) throw new Error("Lineup study is outside the current formal evidence epoch");
  if (summary.hypothesisId !== hypothesis.id || summary.conclusion !== "candidate-for-scoped-policy-study" || summary.causalScope !== "population-causal" || summary.activationStatus !== "shadow-only") throw new Error("Causal study is not eligible for scoped lineup approval");
  if (Number(summary.completed) < 24 || Number(summary.failed) !== 0 || Number(summary.metrics?.managers) < 20 || Number(summary.metrics?.cases) !== Number(summary.completed)) throw new Error("Causal study coverage is insufficient for scoped lineup approval");
  if (manifest.planSha256 && !/^[a-f0-9]{64}$/.test(String(manifest.planSha256))) throw new Error("Causal manifest plan binding is invalid");
  const sourceStateSha256 = String(summary.sharedStudySourceCache?.identity?.officialStateSha256 ?? "");
  if (!/^[a-f0-9]{64}$/.test(sourceStateSha256)) throw new Error("Causal study source-state binding is missing");
  validateCanary(options);
  const payload: LineupAssistApproval["payload"] = {
    policyVersion: LINEUP_APPROVAL_POLICY_VERSION,
    assistVersion: WHITE_BOX_LINEUP_ASSIST_VERSION,
    hypothesis: {id: hypothesis.id, ...(hypothesis.minimumRepresentationVersion ? {minimumRepresentationVersion: hypothesis.minimumRepresentationVersion} : {}), factors: hypothesis.factors.map(value => ({...value})), guardrails: hypothesis.guardrails.map(value => ({...value})), ...(hypothesis.applicability?.length ? {applicability: hypothesis.applicability.map(value => ({...value}))} : {})},
    evidence: {policySha256, summarySha256: fileHash(summaryFile), manifestSha256: fileHash(manifestFile), sourceStateSha256},
    canary: {applicationRate: options.applicationRate, maximumApplicationsPerSeason: options.maximumApplicationsPerSeason, firstSeason: options.firstSeason, expiresAfterSeason: options.expiresAfterSeason},
    safety: {minimumHypothesisScoreDelta: options.minimumHypothesisScoreDelta ?? .02, maximumRationalRegression: options.maximumRationalRegression ?? .05},
  };
  const approval = {schemaVersion: 2 as const, sha256: digest(payload), payload}; validateLineupAssistApproval(approval); return approval;
}

export function loadLineupAssistApproval(file: string): LineupAssistApproval { const value = read<LineupAssistApproval>(file); validateLineupAssistApproval(value); return value; }
export function validateLineupAssistApproval(value: LineupAssistApproval): void {
  if (value.schemaVersion !== 2 || value.sha256 !== digest(value.payload) || value.payload.policyVersion !== LINEUP_APPROVAL_POLICY_VERSION || value.payload.assistVersion !== WHITE_BOX_LINEUP_ASSIST_VERSION) throw new Error("Invalid lineup assist approval signature or version");
  if (value.payload.evidence.policySha256 !== buildEvidenceEpoch(AI_VERSION, "gen9ou").policySha256) throw new Error("Lineup assist approval evidence epoch is stale");
  const hypothesis = value.payload.hypothesis;
  if (!hypothesis.id || !hypothesis.factors.length || hypothesis.factors.some(factor => !factor.feature || !["higher", "lower"].includes(factor.direction) || !Number.isFinite(factor.weight) || factor.weight <= 0)) throw new Error("Invalid lineup assist approval hypothesis");
  if (hypothesis.guardrails.some(guardrail => !guardrail.feature || guardrail.minimumDelta === undefined && guardrail.maximumDelta === undefined)) throw new Error("Invalid lineup assist approval guardrail");
  if (hypothesis.applicability?.some(rule => !["incumbent", "delta"].includes(rule.source) || !rule.feature || rule.minimum === undefined && rule.maximum === undefined || rule.minimum !== undefined && !Number.isFinite(rule.minimum) || rule.maximum !== undefined && !Number.isFinite(rule.maximum))) throw new Error("Invalid lineup assist approval applicability");
  if (Object.values(value.payload.evidence).some(hash => !/^[a-f0-9]{64}$/.test(hash))) throw new Error("Invalid lineup assist approval evidence binding");
  validateCanary({...value.payload.canary, ...value.payload.safety});
}

export function evaluateApprovedLineupAssist(approval: LineupAssistApproval, decisionId: string, season: number, applications: number, incumbent: WhiteBoxCandidateTrace | undefined, candidates: readonly WhiteBoxCandidateTrace[]): LineupApprovalDecision {
  validateLineupAssistApproval(approval); const reasons: string[] = [], {canary, safety, hypothesis} = approval.payload;
  if (season < canary.firstSeason) reasons.push("before-first-season");
  if (season > canary.expiresAfterSeason) reasons.push("approval-expired");
  if (applications >= canary.maximumApplicationsPerSeason) reasons.push("season-application-cap");
  if (hashUnit(`${approval.sha256}:${decisionId}`) >= canary.applicationRate) reasons.push("outside-canary-sample");
  if (!incumbent?.eligible || incumbent.rationalScore === null || !incumbent.diagnostics) reasons.push("missing-incumbent");
  const eligible = candidates.filter(candidate => candidate.eligible && candidate.reasonable && candidate.rationalScore !== null && candidate.diagnostics && candidate.id !== incumbent?.id && representationEligible(candidate, hypothesis.minimumRepresentationVersion) && applicabilityPass(hypothesis, incumbent!.diagnostics!, candidate.diagnostics));
  if (!eligible.length) reasons.push("no-eligible-alternative");
  if (reasons.length) return {approved: true, applied: false, candidateId: null, hypothesisScoreDelta: null, rationalRegression: null, reasons};
  const pool = [incumbent!, ...eligible], distributions = new Map(hypothesis.factors.map(factor => [factor.feature, pool.map(candidate => diagnostic(candidate, factor.feature)).sort((left, right) => left - right)]));
  const incumbentScore = score(incumbent!, hypothesis, distributions);
  const ranked = eligible.map(candidate => ({candidate, score: score(candidate, hypothesis, distributions)})).sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id));
  for (const option of ranked) {
    const scoreDelta = option.score - incumbentScore, rationalRegression = incumbent!.rationalScore! - option.candidate.rationalScore!;
    if (scoreDelta + 1e-12 < safety.minimumHypothesisScoreDelta) continue;
    if (rationalRegression > safety.maximumRationalRegression + 1e-12) continue;
    if (!guardrailsPass(hypothesis, incumbent!, option.candidate)) continue;
    return {approved: true, applied: true, candidateId: option.candidate.id, hypothesisScoreDelta: round(scoreDelta), rationalRegression: round(rationalRegression), reasons: []};
  }
  return {approved: true, applied: false, candidateId: null, hypothesisScoreDelta: null, rationalRegression: null, reasons: ["no-safe-hypothesis-gain"]};
}

function score(candidate: WhiteBoxCandidateTrace, hypothesis: LineupAssistApproval["payload"]["hypothesis"], distributions: ReadonlyMap<string, number[]>): number { let weightedLog = 0, totalWeight = 0; for (const factor of hypothesis.factors) { const rank = percentile(distributions.get(factor.feature)!, diagnostic(candidate, factor.feature)), oriented = factor.direction === "higher" ? rank : 1 - rank; weightedLog += factor.weight * Math.log(Math.max(1e-6, oriented)); totalWeight += factor.weight; } return Math.exp(weightedLog / totalWeight); }
function guardrailsPass(hypothesis: LineupAssistApproval["payload"]["hypothesis"], incumbent: WhiteBoxCandidateTrace, candidate: WhiteBoxCandidateTrace): boolean { return hypothesis.guardrails.every(guardrail => { const delta = diagnostic(candidate, guardrail.feature) - diagnostic(incumbent, guardrail.feature); return (guardrail.minimumDelta === undefined || delta >= guardrail.minimumDelta - 1e-12) && (guardrail.maximumDelta === undefined || delta <= guardrail.maximumDelta + 1e-12); }); }
function representationEligible(candidate: WhiteBoxCandidateTrace, minimum = 1): boolean { return Number(candidate.diagnostics?.["lineup.representationVersion"] ?? 0) >= minimum; }
function diagnostic(candidate: WhiteBoxCandidateTrace, feature: string): number { const value = Number(candidate.diagnostics?.[feature]); if (!Number.isFinite(value)) throw new Error(`Approved lineup feature is missing: ${feature}/${candidate.id}`); return value; }
function percentile(sorted: readonly number[], value: number): number { let lower = 0, upper = sorted.length; while (lower < upper) { const middle = (lower + upper) >>> 1; if (sorted[middle] <= value) lower = middle + 1; else upper = middle; } return (lower - .5) / sorted.length; }
function validateCanary(value: {applicationRate: number; maximumApplicationsPerSeason: number; firstSeason: number; expiresAfterSeason: number; minimumHypothesisScoreDelta?: number; maximumRationalRegression?: number}): void { if (!Number.isFinite(value.applicationRate) || value.applicationRate <= 0 || value.applicationRate > .5 || !Number.isInteger(value.maximumApplicationsPerSeason) || value.maximumApplicationsPerSeason < 1 || value.maximumApplicationsPerSeason > 100 || !Number.isInteger(value.firstSeason) || value.firstSeason < 1 || !Number.isInteger(value.expiresAfterSeason) || value.expiresAfterSeason < value.firstSeason || value.expiresAfterSeason - value.firstSeason > 3 || value.minimumHypothesisScoreDelta !== undefined && (!Number.isFinite(value.minimumHypothesisScoreDelta) || value.minimumHypothesisScoreDelta <= 0 || value.minimumHypothesisScoreDelta > .5) || value.maximumRationalRegression !== undefined && (!Number.isFinite(value.maximumRationalRegression) || value.maximumRationalRegression < 0 || value.maximumRationalRegression > .5)) throw new Error("Invalid lineup assist canary or safety limits"); }
function hashUnit(value: string): number { return Number.parseInt(crypto.createHash("sha256").update(value).digest("hex").slice(0, 12), 16) / 0xffffffffffff; }
function digest(value: unknown): string { return crypto.createHash("sha256").update(canonical(value)).digest("hex"); }
function fileHash(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`; } return JSON.stringify(value); }
function read<T>(file: string): T { if (!fs.existsSync(file)) throw new Error(`Missing lineup approval input: ${file}`); return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
