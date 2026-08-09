export type LineupCausalDirection = "better" | "neutral" | "worse";
export interface LineupCausalHeterogeneityCase {managerId: string; direction: LineupCausalDirection; signals: Record<string, number>}
export interface LineupCausalHeterogeneityFinding {
  signal: string; operator: "at-most" | "at-least"; threshold: number;
  selected: number; better: number; neutral: number; worse: number; meanUtility: number;
  excluded: number; excludedBetter: number; excludedNeutral: number; excludedWorse: number;
  utilityLift: number; exploratoryScore: number;
}
export interface LineupCausalHeterogeneityAudit {
  schemaVersion: 1; activationStatus: "shadow-only"; evidenceStatus: "post-hoc-exploratory";
  cases: number; managers: number; decisiveCases: number; signals: number;
  thresholds: {minimumSelected: number; minimumBetter: number; maximumWorse: number};
  findings: LineupCausalHeterogeneityFinding[];
  proposals: LineupCausalHeterogeneityFinding[];
  nextAction: string;
}

export function auditLineupCausalHeterogeneity(cases: readonly LineupCausalHeterogeneityCase[], maximumFindings = 30): LineupCausalHeterogeneityAudit {
  if (cases.length < 12 || new Set(cases.map(value => value.managerId)).size < 12) throw new Error("Lineup heterogeneity audit requires at least 12 manager cases");
  const signals = [...new Set(cases.flatMap(value => Object.keys(value.signals)))].filter(signal => cases.every(value => Number.isFinite(value.signals[signal]))).sort();
  const minimumSelected = Math.max(6, Math.ceil(cases.length / 4)), minimumBetter = 2, maximumWorse = 0;
  const findings: LineupCausalHeterogeneityFinding[] = [];
  for (const signal of signals) {
    const values = [...new Set(cases.map(value => value.signals[signal]))].sort((left, right) => left - right);
    const thresholds = values.slice(0, -1).map((value, index) => round((value + values[index + 1]) / 2));
    for (const threshold of thresholds) for (const operator of ["at-most", "at-least"] as const) {
      const selected = cases.filter(value => operator === "at-most" ? value.signals[signal] <= threshold : value.signals[signal] >= threshold);
      if (selected.length < minimumSelected || selected.length > cases.length - 3) continue;
      const excluded = cases.filter(value => !selected.includes(value)), selectedSummary = summarize(selected), excludedSummary = summarize(excluded);
      const utilityLift = selectedSummary.meanUtility - excludedSummary.meanUtility;
      findings.push({signal, operator, threshold, selected: selected.length, ...selectedSummary, excluded: excluded.length, excludedBetter: excludedSummary.better, excludedNeutral: excludedSummary.neutral, excludedWorse: excludedSummary.worse, utilityLift: round(utilityLift), exploratoryScore: round(utilityLift * Math.sqrt(selected.length * excluded.length / cases.length))});
    }
  }
  findings.sort((left, right) => right.exploratoryScore - left.exploratoryScore || left.worse - right.worse || right.selected - left.selected || left.signal.localeCompare(right.signal));
  const deduplicated: LineupCausalHeterogeneityFinding[] = [], seen = new Set<string>();
  for (const finding of findings) { const key = `${finding.signal}:${finding.operator}`; if (seen.has(key)) continue; seen.add(key); deduplicated.push(finding); }
  const ranked = deduplicated.slice(0, maximumFindings), proposals = ranked.filter(value => value.better >= minimumBetter && value.worse <= maximumWorse && value.excludedWorse >= 2);
  return {schemaVersion: 1, activationStatus: "shadow-only", evidenceStatus: "post-hoc-exploratory", cases: cases.length, managers: new Set(cases.map(value => value.managerId)).size, decisiveCases: cases.filter(value => value.direction !== "neutral").length, signals: signals.length, thresholds: {minimumSelected, minimumBetter, maximumWorse}, findings: ranked, proposals, nextAction: proposals.length ? "Freeze at most one predecision scope before generating future-season evidence; do not activate from this audit." : "Collect richer predecision context before proposing a scoped policy."};
}

function summarize(cases: readonly LineupCausalHeterogeneityCase[]): {better: number; neutral: number; worse: number; meanUtility: number} { const better = cases.filter(value => value.direction === "better").length, neutral = cases.filter(value => value.direction === "neutral").length, worse = cases.length - better - neutral; return {better, neutral, worse, meanUtility: round((better - worse) / Math.max(1, cases.length))}; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
