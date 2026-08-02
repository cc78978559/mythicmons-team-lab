export interface ShadowExperimentCase {
  id: string;
  domain: string;
  season: number;
  actor: string;
  decisionId: string;
  kind: "observed-disagreement" | "boundary-agreement";
  incumbent: string;
  challenger: string;
  finalMargin: number;
  rationalDelta: number | null;
  styleDelta: number | null;
  traceComplete: boolean;
  reasonableBand: number;
  baselineStyleLimit: number;
  boundedScenario: {styleScale: number; styleLimit: number; selected: string} | null;
  replayReady: boolean;
  blockers: string[];
  contributionDeltas: Array<{id: string; group: string; delta: number}>;
  priority: number;
}

export interface ShadowExperimentPlan {
  schemaVersion: 1;
  observations: number;
  completeTraces: number;
  incompleteTraces: number;
  observedDisagreements: number;
  boundaryAgreements: number;
  boundedFlips: number;
  replayReady: number;
  blockedByIncompleteTrace: number;
  blockedByNoBoundedFlip: number;
  byDomain: Record<string, {
    observations: number;
    completeTraces: number;
    disagreements: number;
    boundaryAgreements: number;
    boundedFlips: number;
    replayReady: number;
  }>;
  cases: ShadowExperimentCase[];
}

interface PlannerRow {
  domain: string;
  season: number;
  actor: string;
  recordId: string;
  trace: any;
}

export function buildShadowExperimentPlan(rows: readonly PlannerRow[], closeMargin = .05): ShadowExperimentPlan {
  const byDomain: ShadowExperimentPlan["byDomain"] = {};
  const cases: ShadowExperimentCase[] = [];
  let completeTraces = 0;
  let observedDisagreements = 0;
  let boundaryAgreements = 0;
  let boundedFlips = 0;
  let replayReady = 0;

  for (const row of rows) {
    const trace = row.trace;
    const domain = row.domain;
    const domainRow = byDomain[domain] ?? {observations: 0, completeTraces: 0, disagreements: 0, boundaryAgreements: 0, boundedFlips: 0, replayReady: 0};
    byDomain[domain] = domainRow;
    domainRow.observations++;
    const retained = Array.isArray(trace.candidates) ? trace.candidates : [];
    const traceComplete = Number(trace.candidateCount ?? retained.length) === retained.length;
    if (traceComplete) { completeTraces++; domainRow.completeTraces++; }
    const incumbentId = String(trace.comparison?.incumbent ?? "");
    const shadowId = trace.comparison?.shadow == null ? "" : String(trace.comparison.shadow);
    const agrees = trace.comparison?.agrees ?? incumbentId === shadowId;
    if (!agrees) { observedDisagreements++; domainRow.disagreements++; }
    const ranked = retained
      .filter((candidate: any) => candidate?.eligible !== false && Number.isFinite(candidate?.finalScore))
      .sort((left: any, right: any) => Number(right.finalScore) - Number(left.finalScore) || String(left.id).localeCompare(String(right.id)));
    const incumbent = retained.find((candidate: any) => String(candidate.id) === incumbentId);
    const challenger = agrees ? ranked.find((candidate: any) => String(candidate.id) !== incumbentId) : retained.find((candidate: any) => String(candidate.id) === shadowId);
    if (!incumbent || !challenger || !Number.isFinite(incumbent.finalScore) || !Number.isFinite(challenger.finalScore)) continue;
    const finalMargin = round(Number(incumbent.finalScore) - Number(challenger.finalScore));
    const isBoundary = agrees && Math.abs(finalMargin) <= closeMargin + 1e-9;
    if (agrees && !isBoundary) continue;
    if (isBoundary) { boundaryAgreements++; domainRow.boundaryAgreements++; }
    const boundedScenario = agrees ? findBoundedFlip(trace, incumbentId) : null;
    if (boundedScenario) { boundedFlips++; domainRow.boundedFlips++; }
    const blockers: string[] = [];
    if (!traceComplete) blockers.push("incomplete-candidate-trace");
    if (agrees && !boundedScenario) blockers.push("no-bounded-ranking-flip");
    const ready = blockers.length === 0;
    if (ready) { replayReady++; domainRow.replayReady++; }
    const rationalDelta = numericDelta(incumbent.rationalScore, challenger.rationalScore);
    const styleDelta = numericDelta(incumbent.rawStyleScore, challenger.rawStyleScore);
    cases.push({
      id: `${row.season}:${row.recordId}:${String(trace.decisionId ?? "unknown")}`,
      domain,
      season: row.season,
      actor: row.actor,
      decisionId: String(trace.decisionId ?? "unknown"),
      kind: agrees ? "boundary-agreement" : "observed-disagreement",
      incumbent: incumbentId,
      challenger: String(challenger.id),
      finalMargin,
      rationalDelta,
      styleDelta,
      traceComplete,
      reasonableBand: Number(trace.reasonableBand ?? 0),
      baselineStyleLimit: Number(trace.styleContributionLimit ?? 0),
      boundedScenario,
      replayReady: ready,
      blockers,
      contributionDeltas: contributionDeltas(incumbent, challenger),
      priority: priority(agrees, finalMargin, traceComplete, boundedScenario !== null, domain),
    });
  }

  cases.sort((left, right) => right.priority - left.priority || left.season - right.season || left.id.localeCompare(right.id));
  return {
    schemaVersion: 1,
    observations: rows.length,
    completeTraces,
    incompleteTraces: rows.length - completeTraces,
    observedDisagreements,
    boundaryAgreements,
    boundedFlips,
    replayReady,
    blockedByIncompleteTrace: cases.filter(entry => entry.blockers.includes("incomplete-candidate-trace")).length,
    blockedByNoBoundedFlip: cases.filter(entry => entry.blockers.includes("no-bounded-ranking-flip")).length,
    byDomain,
    cases,
  };
}

export function compactShadowExperimentQueue(plan: ShadowExperimentPlan, maximumCases = 30): Omit<ShadowExperimentPlan, "cases"> & {cases: Array<Omit<ShadowExperimentCase, "contributionDeltas" | "priority">>} {
  const selected: ShadowExperimentCase[] = [];
  const domainCounts = new Map<string, number>();
  for (const entry of plan.cases) {
    if (selected.length >= maximumCases) break;
    const count = domainCounts.get(entry.domain) ?? 0;
    if (count >= 8) continue;
    selected.push(entry);
    domainCounts.set(entry.domain, count + 1);
  }
  if (selected.length < maximumCases) {
    for (const entry of plan.cases) {
      if (selected.length >= maximumCases) break;
      if (!selected.includes(entry)) selected.push(entry);
    }
  }
  const {cases: _cases, ...summary} = plan;
  return {
    ...summary,
    cases: selected.map(({contributionDeltas: _deltas, priority: _priority, ...entry}) => entry),
  };
}

function findBoundedFlip(trace: any, incumbentId: string): {styleScale: number; styleLimit: number; selected: string} | null {
  const candidates = (trace.candidates ?? []).filter((candidate: any) =>
    candidate?.eligible !== false && Number.isFinite(candidate?.rationalScore) && Number.isFinite(candidate?.rawStyleScore));
  if (candidates.length < 2) return null;
  const band = Number(trace.reasonableBand ?? 0);
  const baselineLimit = Number(trace.styleContributionLimit ?? 0);
  let best: {styleScale: number; styleLimit: number; selected: string; distance: number} | null = null;
  for (let scaleStep = 101; scaleStep <= 200; scaleStep++) {
    const styleScale = scaleStep / 100;
    for (let limitStep = Math.ceil(baselineLimit * 4); limitStep <= 20; limitStep++) {
      const styleLimit = limitStep / 4;
      const selected = select(candidates, band, styleLimit, styleScale);
      if (!selected || selected === incumbentId) continue;
      const distance = (styleScale - 1) + Math.max(0, styleLimit - baselineLimit) / 5;
      if (!best || distance < best.distance - 1e-9) best = {styleScale, styleLimit, selected, distance};
    }
  }
  return best ? {styleScale: round(best.styleScale), styleLimit: round(best.styleLimit), selected: best.selected} : null;
}

function select(candidates: any[], band: number, styleLimit: number, styleScale: number): string | null {
  const bestRational = Math.max(...candidates.map(candidate => Number(candidate.rationalScore)));
  return candidates
    .filter(candidate => bestRational - Number(candidate.rationalScore) <= band + 1e-9)
    .map(candidate => ({
      id: String(candidate.id),
      rational: Number(candidate.rationalScore),
      final: Number(candidate.rationalScore) + clamp(Number(candidate.rawStyleScore) * styleScale, styleLimit),
    }))
    .sort((left, right) => right.final - left.final || right.rational - left.rational || left.id.localeCompare(right.id))[0]?.id ?? null;
}

function contributionDeltas(incumbent: any, challenger: any): ShadowExperimentCase["contributionDeltas"] {
  const before = new Map<string, any>((incumbent.contributions ?? []).map((entry: any) => [String(entry.id), entry]));
  const after = new Map<string, any>((challenger.contributions ?? []).map((entry: any) => [String(entry.id), entry]));
  return [...new Set<string>([...before.keys(), ...after.keys()])]
    .map(id => {
      const left: any = before.get(id), right: any = after.get(id);
      return {id, group: String(right?.group ?? left?.group ?? "unknown"), delta: round(Number(right?.value ?? 0) - Number(left?.value ?? 0))};
    })
    .filter(entry => Math.abs(entry.delta) > 1e-9)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || left.id.localeCompare(right.id))
    .slice(0, 6);
}

function priority(agrees: boolean, margin: number, complete: boolean, flips: boolean, domain: string): number {
  return round((agrees ? 500 : 1000) + (complete ? 100 : 0) + (flips ? 50 : 0) + (domain === "lineup" ? 25 : 0) + Math.max(0, .05 - Math.abs(margin)) * 1000);
}

function numericDelta(before: unknown, after: unknown): number | null {
  return Number.isFinite(before) && Number.isFinite(after) ? round(Number(after) - Number(before)) : null;
}
function clamp(value: number, limit: number): number { return Math.max(-limit, Math.min(limit, value)); }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
