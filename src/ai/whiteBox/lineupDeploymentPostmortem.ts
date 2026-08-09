import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {auditLineupCausalHeterogeneity, type LineupCausalDirection, type LineupCausalHeterogeneityAudit, type LineupCausalHeterogeneityCase, type LineupCausalHeterogeneityFinding} from "./lineupCausalHeterogeneity";

interface DecisionRecord {
  actor?: string; selected?: unknown; stage?: string;
  context?: {seriesId?: string; lineupAssistPolicy?: {approvalSha256?: string; applied?: boolean; candidateId?: string | null; hypothesisScoreDelta?: number; rationalRegression?: number}; whiteBoxShadow?: any};
}
interface Series {id: string; left: string; right: string; leftPairs: number; rightPairs: number}
interface Season {league?: Series[]; playoffs?: unknown}

export interface LineupDeploymentPostmortemCase extends LineupCausalHeterogeneityCase {
  caseId: string; season: number; seriesId: string; incumbentId: string; candidateId: string;
  editCount: number; priorApplications: number; cascadeExposed: boolean;
}
export interface LineupDeploymentResearchOption {
  id: string; title: string; observationalCandidate: false; researchEligible: true;
  causalConclusion: null; evidenceStatus: "post-deployment-exploratory";
  boundary: Pick<LineupCausalHeterogeneityFinding, "signal" | "operator" | "threshold">;
}
export interface LineupDeploymentPostmortem {
  schemaVersion: 1; activationStatus: "shadow-only"; evidenceStatus: "post-deployment-exploratory";
  approvalSha256: string; seasons: number[]; cases: LineupDeploymentPostmortemCase[];
  audit: LineupCausalHeterogeneityAudit; researchOptions: LineupDeploymentResearchOption[];
  failures: Array<{caseId: string; reason: "missing-control-decision" | "missing-series-outcome" | "missing-candidate-diagnostics"}>;
  validity: {inputApplications: number; analyzableCases: number; allAppliedCasesAnalyzable: boolean; predecisionSignalsOnly: true; directSeriesLabels: true; cascadeConfounding: true; causalClaimsAllowed: false; activationAllowed: false};
}

export function buildLineupDeploymentPostmortem(controlRoot: string, canaryRoot: string, seasons: readonly number[], approvalSha256: string, maximumOptions = 8): LineupDeploymentPostmortem {
  const cases: LineupDeploymentPostmortemCase[] = [], failures: LineupDeploymentPostmortem["failures"] = [];
  let priorApplications = 0;
  for (const season of seasons) {
    const controlDecisions = lineupDecisions(controlRoot, season), canaryDecisions = lineupDecisions(canaryRoot, season);
    const controlByKey = new Map(controlDecisions.map(record => [decisionKey(record), record])), controlSeries = seriesMap(readSeason(controlRoot, season)), canarySeries = seriesMap(readSeason(canaryRoot, season));
    for (const record of canaryDecisions) {
      const policy = record.context?.lineupAssistPolicy;
      if (!policy?.applied) continue;
      const caseId = `${season}:${String(record.context?.seriesId ?? "")}:${String(record.actor ?? "")}`;
      if (policy.approvalSha256 !== approvalSha256) throw new Error(`Approval hash mismatch in deployment postmortem: ${decisionKey(record)}`);
      const managerId = String(record.actor ?? ""), seriesId = String(record.context?.seriesId ?? ""), control = controlByKey.get(decisionKey(record));
      const left = controlSeries.get(seriesId), right = canarySeries.get(seriesId), trace = record.context?.whiteBoxShadow;
      const incumbentId = String(trace?.comparison?.incumbent ?? ""), candidateId = String(policy.candidateId ?? "");
      const incumbent = trace?.candidates?.find((value: any) => String(value.id) === incumbentId), candidate = trace?.candidates?.find((value: any) => String(value.id) === candidateId);
      priorApplications += 1;
      if (!control) { failures.push({caseId, reason: "missing-control-decision"}); continue; }
      if (!managerId || !seriesId || !left || !right) { failures.push({caseId, reason: "missing-series-outcome"}); continue; }
      if (!incumbent?.diagnostics || !candidate?.diagnostics) { failures.push({caseId, reason: "missing-candidate-diagnostics"}); continue; }
      const direction = directionFor(managerSeriesScore(right, managerId) - managerSeriesScore(left, managerId));
      const editCount = symmetricEditCount(asStrings(control.selected), asStrings(record.selected)) / 2;
      const signals: Record<string, number> = {
        "decision.candidateCount": finite(trace.candidateCount, "candidateCount"),
        "decision.reasonableCount": finite(trace.reasonableCount, "reasonableCount"),
        "decision.incumbentRationalScore": finite(incumbent.rationalScore, "incumbentRationalScore"),
        "decision.candidateRationalDelta": finite(candidate.rationalScore, "candidateRationalScore") - finite(incumbent.rationalScore, "incumbentRationalScore"),
        "decision.incumbentStyleScore": finite(incumbent.rawStyleScore, "incumbentStyleScore"),
        "decision.candidateStyleDelta": finite(candidate.rawStyleScore, "candidateStyleScore") - finite(incumbent.rawStyleScore, "incumbentStyleScore"),
        "decision.hypothesisScoreDelta": finite(policy.hypothesisScoreDelta, "hypothesisScoreDelta"),
        "decision.rationalRegression": finite(policy.rationalRegression, "rationalRegression"),
        "structure.editCount": editCount,
        "structure.retainedFraction": 1 - editCount / Math.max(1, asStrings(control.selected).length),
      };
      for (const [feature, raw] of Object.entries(incumbent.diagnostics)) {
        if (feature === "lineup.representationVersion") continue;
        const value = Number(raw), alternative = Number(candidate.diagnostics[feature]);
        if (!Number.isFinite(value) || !Number.isFinite(alternative)) continue;
        signals[`incumbent.${feature}`] = value; signals[`delta.${feature}`] = alternative - value;
      }
      cases.push({caseId, season, seriesId, managerId, direction, signals, incumbentId, candidateId, editCount, priorApplications: priorApplications - 1, cascadeExposed: priorApplications > 1});
    }
  }
  const audit = auditLineupCausalHeterogeneity(cases), researchOptions = selectResearchOptions(audit.findings, maximumOptions);
  return {schemaVersion: 1, activationStatus: "shadow-only", evidenceStatus: "post-deployment-exploratory", approvalSha256, seasons: [...seasons], cases, audit, researchOptions, failures, validity: {inputApplications: priorApplications, analyzableCases: cases.length, allAppliedCasesAnalyzable: failures.length === 0, predecisionSignalsOnly: true, directSeriesLabels: true, cascadeConfounding: true, causalClaimsAllowed: false, activationAllowed: false}};
}

function selectResearchOptions(findings: readonly LineupCausalHeterogeneityFinding[], maximum: number): LineupDeploymentResearchOption[] {
  return findings.filter(value => /^(incumbent|delta)\.lineup\./.test(value.signal) && value.selected >= 6 && value.better > value.worse && value.excludedWorse > value.excludedBetter && value.utilityLift > 0).slice(0, maximum).map(value => {
    const boundary = {signal: value.signal, operator: value.operator, threshold: value.threshold}, digest = crypto.createHash("sha256").update(JSON.stringify(boundary)).digest("hex").slice(0, 12);
    return {id: `lineup-deployment-boundary-${digest}-v1`, title: `Test whether ${value.signal} ${value.operator} ${value.threshold} separates lineup-assist benefit`, observationalCandidate: false, researchEligible: true, causalConclusion: null, evidenceStatus: "post-deployment-exploratory", boundary};
  });
}

function readSeason(root: string, season: number): Season { return read(path.join(root, seasonDirectory(season), "season.json")); }
function lineupDecisions(root: string, season: number): DecisionRecord[] { return read<{records: DecisionRecord[]}>(path.join(root, seasonDirectory(season), "decision-ledger.json")).records.filter(value => value.stage === "lineup"); }
function decisionKey(record: DecisionRecord): string { return `${record.context?.seriesId ?? ""}:${record.actor ?? ""}`; }
function seasonDirectory(season: number): string { return `season-${String(season).padStart(2, "0")}`; }
function seriesMap(season: Season): Map<string, Series> { const output = new Map<string, Series>(); for (const value of [...(season.league ?? []), ...collectSeries(season.playoffs)]) output.set(value.id, value); return output; }
function collectSeries(value: unknown): Series[] { if (Array.isArray(value)) return value.flatMap(collectSeries); if (!value || typeof value !== "object") return []; const record = value as Record<string, unknown>, own = typeof record.id === "string" && typeof record.left === "string" && typeof record.right === "string" ? [record as unknown as Series] : []; return [...own, ...Object.values(record).flatMap(collectSeries)]; }
function managerSeriesScore(value: Series, manager: string): number { if (value.leftPairs === value.rightPairs) return .5; return (value.leftPairs > value.rightPairs ? value.left : value.right) === manager ? 1 : 0; }
function directionFor(delta: number): LineupCausalDirection { return delta > 0 ? "better" : delta < 0 ? "worse" : "neutral"; }
function asStrings(value: unknown): string[] { if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new Error("Deployment lineup must be a string array"); return value; }
function symmetricEditCount(left: readonly string[], right: readonly string[]): number { const a = new Set(left), b = new Set(right); return [...a].filter(value => !b.has(value)).length + [...b].filter(value => !a.has(value)).length; }
function finite(value: unknown, label: string): number { const parsed = Number(value); if (!Number.isFinite(parsed)) throw new Error(`Non-finite deployment signal: ${label}`); return parsed; }
function read<T>(file: string): T { if (!fs.existsSync(file)) throw new Error(`Missing deployment postmortem input: ${file}`); return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
