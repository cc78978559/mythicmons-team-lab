export type HypothesisDirection = "higher" | "lower";
export type HypothesisStage = "proposed" | "observational-candidate" | "observational-rejected" | "causal-complete";
export interface LineupHypothesisFactor {feature: string; direction: HypothesisDirection; weight: number}
export interface LineupHypothesisGuardrail {feature: string; minimumDelta?: number; maximumDelta?: number}
export interface LineupAuditHypothesis {
  id: string; title: string; rationale: string; stage: HypothesisStage;
  combine: "weighted-geometric-percentile"; factors: LineupHypothesisFactor[];
  scope: string[]; guardrails: LineupHypothesisGuardrail[];
  causalEvidence?: {study: string; better: number; neutral: number; worse: number; conclusion: string};
}
export interface LineupHypothesisRegistry {schemaVersion: 1; activationStatus: "shadow-only"; hypotheses: LineupAuditHypothesis[]}
export interface LineupHypothesisObservation {seriesId: string; season: number; managerId: string; outcome: "win" | "loss" | "draw"; diagnostics: Record<string, number>}
export interface LineupHypothesisFinding {
  id: string; title: string; registeredStage: HypothesisStage; auditStage: HypothesisStage;
  pairs: number; managers: number; seasons: number; winnerHigherRate: number;
  standardizedEffect: number; permutationP: number; adjustedQ: number;
  observationalCandidate: boolean; causalConclusion: string | null; nextAction: string;
}
export interface LineupHypothesisAudit {
  schemaVersion: 1; activationStatus: "shadow-only"; conclusion: "hypotheses-ready" | "no-hypothesis-ready";
  metrics: {observations: number; decisivePairs: number; managers: number; seasons: number; hypotheses: number; observationalCandidates: number};
  thresholds: {minimumManagers: number; minimumSeasons: number; minimumAbsoluteEffect: number; maximumAdjustedQ: number; permutations: number};
  findings: LineupHypothesisFinding[];
}
export interface LineupHypothesisCandidateRow {
  season: number; managerId: string; seriesId: string; outcome: "win" | "loss" | "draw"; incumbentId: string;
  candidates: Array<{id: string; diagnostics: Record<string, number>}>;
}
export interface LineupHypothesisCausalChoice {
  id: string; decisionId: string; season: number; managerId: string; sourceOutcome: "win" | "loss";
  incumbentId: string; candidateId: string; scoreDelta: number; guardrailDeltas: Record<string, number>;
}
export interface LineupHypothesisCausalPlan {
  schemaVersion: 1; hypothesisId: string; activationStatus: "shadow-only"; requested: number; minimumScoreDelta: number;
  causalScope: "population-causal" | "personal-local-replication";
  availableChoices: number; availableManagers: number; selected: LineupHypothesisCausalChoice[];
  coverage: {seasons: Record<string, number>; sourceOutcomes: Record<"win" | "loss", number>; managers: number};
  opportunityPolicy?: "balanced-manager-unique-v1" | "personal-evidence-fairness-v1";
  opportunityCoverage?: {selectedFirstChoiceRequests: number; selectedWithoutMechanismEvidence: number; selectedPriorTotalAttempts: {minimum: number; maximum: number; mean: number}};
  opportunityEvidence?: Record<string, ManagerExperimentEvidence>;
}
export interface ManagerExperimentEvidence {mechanismAttempts: number; totalAttempts: number; researchPreferenceRank?: number; priorChoiceIds?: string[]}
export interface LineupHypothesisPlanOptions {allowReviewedReplication?: boolean; maximumResearchPreferenceRank?: number}

export function validateLineupHypothesisRegistry(value: LineupHypothesisRegistry): LineupHypothesisRegistry {
  if (value.schemaVersion !== 1 || value.activationStatus !== "shadow-only" || !Array.isArray(value.hypotheses) || !value.hypotheses.length) throw new Error("Invalid lineup hypothesis registry header");
  const ids = new Set<string>();
  for (const hypothesis of value.hypotheses) {
    if (!/^[a-z0-9-]+-v\d+$/.test(hypothesis.id) || ids.has(hypothesis.id)) throw new Error(`Invalid or duplicate hypothesis id: ${hypothesis.id}`);
    ids.add(hypothesis.id);
    if (!hypothesis.title || !hypothesis.rationale || hypothesis.combine !== "weighted-geometric-percentile" || !hypothesis.factors?.length) throw new Error(`Incomplete hypothesis: ${hypothesis.id}`);
    if (hypothesis.factors.some(factor => !/^lineup\.[A-Za-z0-9]+$/.test(factor.feature) || !["higher", "lower"].includes(factor.direction) || !Number.isFinite(factor.weight) || factor.weight <= 0)) throw new Error(`Invalid factors: ${hypothesis.id}`);
    if (!Array.isArray(hypothesis.guardrails) || hypothesis.guardrails.some(guardrail => !/^lineup\.[A-Za-z0-9]+$/.test(guardrail.feature) || (guardrail.minimumDelta === undefined && guardrail.maximumDelta === undefined) || (guardrail.minimumDelta !== undefined && !Number.isFinite(guardrail.minimumDelta)) || (guardrail.maximumDelta !== undefined && !Number.isFinite(guardrail.maximumDelta)))) throw new Error(`Invalid guardrails: ${hypothesis.id}`);
    if (hypothesis.stage === "causal-complete" && !hypothesis.causalEvidence) throw new Error(`Causal-complete hypothesis lacks evidence: ${hypothesis.id}`);
  }
  return value;
}

export function auditLineupHypotheses(observations: readonly LineupHypothesisObservation[], registryValue: LineupHypothesisRegistry, permutations = 2000): LineupHypothesisAudit {
  const registry = validateLineupHypothesisRegistry(registryValue);
  if (!observations.length || !Number.isInteger(permutations) || permutations < 100 || permutations > 100000) throw new Error("Hypothesis audit requires observations and 100..100000 permutations");
  const decisive = pairDecisive(observations), distributions = featureDistributions(observations, registry.hypotheses);
  const thresholds = {minimumManagers: 20, minimumSeasons: 3, minimumAbsoluteEffect: .05, maximumAdjustedQ: .1, permutations};
  const findings = registry.hypotheses.map(hypothesis => analyzeHypothesis(hypothesis, decisive, distributions, permutations));
  adjustBenjaminiHochberg(findings);
  for (const finding of findings) {
    finding.observationalCandidate = finding.managers >= thresholds.minimumManagers && finding.seasons >= thresholds.minimumSeasons && Math.abs(finding.standardizedEffect) >= thresholds.minimumAbsoluteEffect && finding.adjustedQ <= thresholds.maximumAdjustedQ;
    finding.auditStage = finding.registeredStage === "causal-complete" ? "causal-complete" : finding.observationalCandidate ? "observational-candidate" : "observational-rejected";
    finding.nextAction = finding.registeredStage === "causal-complete"
      ? "Retain as reviewed causal evidence; do not reactivate from observational association."
      : finding.observationalCandidate ? "Design a manager-unique guarded causal intervention; do not change policy weights." : "Retain or revise the mechanism; do not schedule causal replay.";
  }
  findings.sort((left, right) => Number(right.observationalCandidate) - Number(left.observationalCandidate) || left.adjustedQ - right.adjustedQ || Math.abs(right.standardizedEffect) - Math.abs(left.standardizedEffect) || left.id.localeCompare(right.id));
  const candidates = findings.filter(finding => finding.observationalCandidate && finding.registeredStage !== "causal-complete").length;
  return {
    schemaVersion: 1, activationStatus: "shadow-only", conclusion: candidates ? "hypotheses-ready" : "no-hypothesis-ready",
    metrics: {observations: observations.length, decisivePairs: decisive.length, managers: new Set(observations.map(row => row.managerId)).size, seasons: new Set(observations.map(row => row.season)).size, hypotheses: findings.length, observationalCandidates: candidates},
    thresholds, findings,
  };
}

export function buildLineupHypothesisCausalPlan(rows: readonly LineupHypothesisCandidateRow[], hypothesis: LineupAuditHypothesis, requested = 24, minimumScoreDelta = .02, managerEvidence?: ReadonlyMap<string, ManagerExperimentEvidence>, options: LineupHypothesisPlanOptions = {}): LineupHypothesisCausalPlan {
  if (hypothesis.stage === "causal-complete" && !options.allowReviewedReplication) throw new Error(`Hypothesis already has causal evidence: ${hypothesis.id}`);
  if (options.allowReviewedReplication && (hypothesis.stage !== "causal-complete" || !managerEvidence)) throw new Error("Reviewed replication requires causal-complete evidence and personal research agendas");
  const maximumResearchPreferenceRank = options.allowReviewedReplication ? options.maximumResearchPreferenceRank ?? 0 : Number.POSITIVE_INFINITY;
  if (options.allowReviewedReplication && (!Number.isInteger(maximumResearchPreferenceRank) || maximumResearchPreferenceRank < 0 || maximumResearchPreferenceRank > 63)) throw new Error("maximumResearchPreferenceRank must be an integer within 0..63");
  if (!Number.isInteger(requested) || requested < (options.allowReviewedReplication ? 1 : 6) || requested > 30 || (!options.allowReviewedReplication && requested % 6 !== 0)) throw new Error(options.allowReviewedReplication ? "personal replication cases must be within 1..30" : "requested cases must be a multiple of six within 6..30");
  if (!Number.isFinite(minimumScoreDelta) || minimumScoreDelta <= 0 || minimumScoreDelta > .5) throw new Error("minimumScoreDelta must be within (0,.5]");
  const allCandidates = rows.flatMap(row => row.candidates), distributions = candidateFeatureDistributions(allCandidates, hypothesis);
  const choices: LineupHypothesisCausalChoice[] = [];
  for (const row of rows) {
    if ((managerEvidence?.get(row.managerId)?.researchPreferenceRank ?? 64) > maximumResearchPreferenceRank) continue;
    if (row.outcome !== "win" && row.outcome !== "loss") continue;
    const incumbent = row.candidates.find(candidate => candidate.id === row.incumbentId); if (!incumbent) continue;
    const incumbentScore = score(hypothesis, incumbent.diagnostics, distributions);
    for (const candidate of row.candidates) {
      if (candidate.id === incumbent.id) continue;
      const scoreDelta = score(hypothesis, candidate.diagnostics, distributions) - incumbentScore;
      const guardrailDeltas = Object.fromEntries(hypothesis.guardrails.map(guardrail => [guardrail.feature, Number(candidate.diagnostics[guardrail.feature]) - Number(incumbent.diagnostics[guardrail.feature])]));
      if (scoreDelta + 1e-12 < minimumScoreDelta || !guardrailsPass(hypothesis, guardrailDeltas)) continue;
      const id = `${row.season}:${row.managerId}:${row.seriesId}:${candidate.id}`;
      if (managerEvidence?.get(row.managerId)?.priorChoiceIds?.includes(id)) continue;
      choices.push({id, decisionId: `lineup:${row.seriesId}:${row.managerId}`, season: row.season, managerId: row.managerId, sourceOutcome: row.outcome, incumbentId: incumbent.id, candidateId: candidate.id, scoreDelta: round(scoreDelta), guardrailDeltas: Object.fromEntries(Object.entries(guardrailDeltas).map(([key, value]) => [key, round(value)]))});
    }
  }
  const unique = new Map<string, LineupHypothesisCausalChoice>();
  for (const choice of choices) { const key = `${choice.managerId}:${choice.season}:${choice.sourceOutcome}`, current = unique.get(key); if (!current || compareHypothesisChoice(choice, current) < 0) unique.set(key, choice); }
  const seasons = [...new Set(rows.map(row => row.season))].sort((left, right) => left - right); if (seasons.length !== 3) throw new Error(`Causal plan requires exactly three seasons, found ${seasons.length}`);
  const perStratum = options.allowReviewedReplication ? 0 : requested / 6;
  const byManager = new Map<string, LineupHypothesisCausalChoice[]>();
  for (const choice of unique.values()) { const values = byManager.get(choice.managerId) ?? []; values.push(choice); byManager.set(choice.managerId, values); }
  const selected = selectBalancedOpportunities(byManager, seasons, perStratum, requested, hypothesis.id, managerEvidence, !options.allowReviewedReplication).sort((left, right) => left.season - right.season || left.sourceOutcome.localeCompare(right.sourceOutcome) || left.managerId.localeCompare(right.managerId));
  if (selected.length < requested) throw new Error(`Only ${selected.length}/${requested} manager-unique balanced interventions are available`);
  const final = selected.slice(0, requested);
  const priorAttempts = final.map(choice => managerEvidence?.get(choice.managerId)?.totalAttempts ?? 0);
  return {schemaVersion: 1, hypothesisId: hypothesis.id, activationStatus: "shadow-only", requested, minimumScoreDelta, causalScope: options.allowReviewedReplication ? "personal-local-replication" : "population-causal", availableChoices: choices.length, availableManagers: new Set(choices.map(choice => choice.managerId)).size, selected: final, coverage: {seasons: Object.fromEntries(seasons.map(season => [String(season), final.filter(choice => choice.season === season).length])), sourceOutcomes: {win: final.filter(choice => choice.sourceOutcome === "win").length, loss: final.filter(choice => choice.sourceOutcome === "loss").length}, managers: new Set(final.map(choice => choice.managerId)).size}, opportunityPolicy: managerEvidence ? "personal-evidence-fairness-v1" : "balanced-manager-unique-v1", opportunityCoverage: {selectedFirstChoiceRequests: final.filter(choice => (managerEvidence?.get(choice.managerId)?.researchPreferenceRank ?? 0) === 0).length, selectedWithoutMechanismEvidence: final.filter(choice => (managerEvidence?.get(choice.managerId)?.mechanismAttempts ?? 0) === 0).length, selectedPriorTotalAttempts: {minimum: Math.min(...priorAttempts), maximum: Math.max(...priorAttempts), mean: round(mean(priorAttempts))}}, opportunityEvidence: managerEvidence ? Object.fromEntries([...managerEvidence].sort(([left], [right]) => left.localeCompare(right))) : undefined};
}

function selectBalancedOpportunities(byManager: ReadonlyMap<string, LineupHypothesisCausalChoice[]>, seasons: number[], perStratum: number, requested: number, hypothesisId: string, evidence?: ReadonlyMap<string, ManagerExperimentEvidence>, strictBalance = true): LineupHypothesisCausalChoice[] {
  type Edge = {to: number; reverse: number; capacity: number; cost: number; choice?: LineupHypothesisCausalChoice};
  const managers = [...byManager.keys()].sort(), strata = seasons.flatMap(season => (["win", "loss"] as const).map(outcome => `${season}:${outcome}`));
  const priors = new Map(managers.map(manager => { const value = evidence?.get(manager) ?? {mechanismAttempts: 0, totalAttempts: 0, researchPreferenceRank: 0}; if (![value.mechanismAttempts, value.totalAttempts, value.researchPreferenceRank ?? 0].every(item => Number.isInteger(item) && item >= 0) || value.priorChoiceIds && (new Set(value.priorChoiceIds).size !== value.priorChoiceIds.length || value.priorChoiceIds.some(id => !id))) throw new Error(`Invalid manager experiment evidence: ${manager}`); return [manager, value]; }));
  const preferenceLevels = [...new Set([...priors.values()].map(value => value.researchPreferenceRank ?? 0))].sort((left, right) => left - right), mechanismLevels = [...new Set([...priors.values()].map(value => value.mechanismAttempts))].sort((left, right) => left - right), totalLevels = [...new Set([...priors.values()].map(value => value.totalAttempts))].sort((left, right) => left - right);
  const source = 0, managerOffset = 1, stratumOffset = managerOffset + managers.length, sink = stratumOffset + strata.length, graph: Edge[][] = Array.from({length: sink + 1}, () => []);
  const add = (from: number, to: number, capacity: number, cost: number, choice?: LineupHypothesisCausalChoice): Edge => { const forward: Edge = {to, reverse: graph[to].length, capacity, cost, choice}, reverse: Edge = {to: from, reverse: graph[from].length, capacity: 0, cost: -cost}; graph[from].push(forward); graph[to].push(reverse); return forward; };
  const selectedEdges: Edge[] = [];
  managers.forEach((manager, index) => {
    const prior = priors.get(manager)!, tie = hash32(`${hypothesisId}:${manager}`) % 1000, preferenceRank = preferenceLevels.indexOf(prior.researchPreferenceRank ?? 0), mechanismRank = mechanismLevels.indexOf(prior.mechanismAttempts), totalRank = totalLevels.indexOf(prior.totalAttempts);
    add(source, managerOffset + index, 1, preferenceRank * 100_000_000_000_000 + mechanismRank * 10_000_000_000 + totalRank * 1_000_000 + tie * 100);
    for (let stratumIndex = 0; stratumIndex < strata.length; stratumIndex++) {
      const [season, outcome] = strata[stratumIndex].split(":"), choice = byManager.get(manager)!.filter(value => value.season === Number(season) && value.sourceOutcome === outcome).sort(compareHypothesisChoice)[0];
      if (!choice) continue;
      selectedEdges.push(add(managerOffset + index, stratumOffset + stratumIndex, 1, Math.max(0, 99 - Math.min(99, Math.round(choice.scoreDelta * 99))), choice));
    }
  });
  strata.forEach((_, index) => { if (strictBalance) add(stratumOffset + index, sink, perStratum, 0); else for (let layer = 0; layer < Math.ceil(requested / strata.length); layer++) add(stratumOffset + index, sink, 1, layer * 1_000_000_000_000_000); });
  let flow = 0;
  while (flow < requested) {
    const distance = Array(graph.length).fill(Number.POSITIVE_INFINITY), previousNode = Array(graph.length).fill(-1), previousEdge = Array(graph.length).fill(-1); distance[source] = 0;
    for (let pass = 0; pass < graph.length - 1; pass++) { let changed = false; for (let node = 0; node < graph.length; node++) { if (!Number.isFinite(distance[node])) continue; for (let edgeIndex = 0; edgeIndex < graph[node].length; edgeIndex++) { const edge = graph[node][edgeIndex], candidate = distance[node] + edge.cost; if (edge.capacity > 0 && candidate < distance[edge.to]) { distance[edge.to] = candidate; previousNode[edge.to] = node; previousEdge[edge.to] = edgeIndex; changed = true; } } } if (!changed) break; }
    if (!Number.isFinite(distance[sink])) break;
    for (let node = sink; node !== source; node = previousNode[node]) { const edge = graph[previousNode[node]][previousEdge[node]]; edge.capacity -= 1; graph[node][edge.reverse].capacity += 1; }
    flow++;
  }
  return selectedEdges.filter(edge => edge.capacity === 0 && edge.choice).map(edge => edge.choice!);
}

type Pair = {seriesId: string; season: number; winner: LineupHypothesisObservation; loser: LineupHypothesisObservation};
function pairDecisive(rows: readonly LineupHypothesisObservation[]): Pair[] {
  const grouped = new Map<string, LineupHypothesisObservation[]>();
  for (const row of rows) { const key = `${row.season}:${row.seriesId}`, values = grouped.get(key) ?? []; values.push(row); grouped.set(key, values); }
  return [...grouped].flatMap(([, values]) => {
    const winner = values.find(row => row.outcome === "win"), loser = values.find(row => row.outcome === "loss");
    return winner && loser ? [{seriesId: winner.seriesId, season: winner.season, winner, loser}] : [];
  });
}
function featureDistributions(rows: readonly LineupHypothesisObservation[], hypotheses: readonly LineupAuditHypothesis[]): Map<string, number[]> {
  const features = new Set(hypotheses.flatMap(hypothesis => hypothesis.factors.map(factor => factor.feature))), result = new Map<string, number[]>();
  for (const feature of features) {
    const values = rows.map(row => Number(row.diagnostics[feature])).filter(Number.isFinite).sort((left, right) => left - right);
    if (values.length !== rows.length) throw new Error(`Missing diagnostic required by hypothesis: ${feature}`);
    result.set(feature, values);
  }
  return result;
}
function candidateFeatureDistributions(candidates: readonly {diagnostics: Record<string, number>}[], hypothesis: LineupAuditHypothesis): Map<string, number[]> { const result = new Map<string, number[]>(); for (const feature of new Set(hypothesis.factors.map(factor => factor.feature))) { const values = candidates.map(candidate => Number(candidate.diagnostics[feature])).filter(Number.isFinite).sort((left, right) => left - right); if (values.length !== candidates.length) throw new Error(`Missing candidate diagnostic required by hypothesis: ${feature}`); result.set(feature, values); } return result; }
function analyzeHypothesis(hypothesis: LineupAuditHypothesis, pairs: readonly Pair[], distributions: ReadonlyMap<string, number[]>, permutations: number): LineupHypothesisFinding {
  const managerValues = new Map<string, number[]>();
  for (const pair of pairs) { add(managerValues, pair.winner.managerId, score(hypothesis, pair.winner.diagnostics, distributions)); add(managerValues, pair.loser.managerId, score(hypothesis, pair.loser.diagnostics, distributions)); }
  const means = new Map([...managerValues].map(([manager, values]) => [manager, mean(values)]));
  const deltas = pairs.map(pair => (score(hypothesis, pair.winner.diagnostics, distributions) - (means.get(pair.winner.managerId) ?? 0)) - (score(hypothesis, pair.loser.diagnostics, distributions) - (means.get(pair.loser.managerId) ?? 0)));
  const observed = mean(deltas), variance = mean(deltas.map(value => value ** 2)), standardizedEffect = variance > 1e-18 ? observed / Math.sqrt(variance) : 0;
  const random = generator(hash32(hypothesis.id)); let extreme = 0;
  for (let iteration = 0; iteration < permutations; iteration++) if (Math.abs(mean(deltas.map(value => value * (random() < .5 ? -1 : 1)))) + 1e-12 >= Math.abs(observed)) extreme++;
  return {
    id: hypothesis.id, title: hypothesis.title, registeredStage: hypothesis.stage, auditStage: hypothesis.stage,
    pairs: pairs.length, managers: new Set(pairs.flatMap(pair => [pair.winner.managerId, pair.loser.managerId])).size, seasons: new Set(pairs.map(pair => pair.season)).size,
    winnerHigherRate: round(deltas.filter(value => value > 1e-12).length / Math.max(1, deltas.filter(value => Math.abs(value) > 1e-12).length)),
    standardizedEffect: round(standardizedEffect), permutationP: round((extreme + 1) / (permutations + 1)), adjustedQ: 1, observationalCandidate: false,
    causalConclusion: hypothesis.causalEvidence?.conclusion ?? null, nextAction: "pending-adjustment",
  };
}
function score(hypothesis: LineupAuditHypothesis, diagnostics: Readonly<Record<string, number>>, distributions: ReadonlyMap<string, number[]>): number {
  let weightedLog = 0, totalWeight = 0;
  for (const factor of hypothesis.factors) {
    const percentile = empiricalPercentile(distributions.get(factor.feature)!, Number(diagnostics[factor.feature]));
    const oriented = factor.direction === "higher" ? percentile : 1 - percentile;
    weightedLog += factor.weight * Math.log(Math.max(1e-6, oriented)); totalWeight += factor.weight;
  }
  return Math.exp(weightedLog / totalWeight);
}
function empiricalPercentile(sorted: readonly number[], value: number): number { let lower = 0, upper = sorted.length; while (lower < upper) { const middle = (lower + upper) >>> 1; if (sorted[middle] <= value) lower = middle + 1; else upper = middle; } return (lower - .5) / sorted.length; }
function guardrailsPass(hypothesis: LineupAuditHypothesis, deltas: Readonly<Record<string, number>>): boolean { return hypothesis.guardrails.every(guardrail => Number.isFinite(deltas[guardrail.feature]) && (guardrail.minimumDelta === undefined || deltas[guardrail.feature] >= guardrail.minimumDelta - 1e-12) && (guardrail.maximumDelta === undefined || deltas[guardrail.feature] <= guardrail.maximumDelta + 1e-12)); }
function compareHypothesisChoice(left: LineupHypothesisCausalChoice, right: LineupHypothesisCausalChoice): number { return right.scoreDelta - left.scoreDelta || left.id.localeCompare(right.id); }
function adjustBenjaminiHochberg(findings: LineupHypothesisFinding[]): void { const ordered = [...findings].sort((left, right) => left.permutationP - right.permutationP || left.id.localeCompare(right.id)); let previous = 1; for (let index = ordered.length - 1; index >= 0; index--) { previous = Math.min(previous, ordered[index].permutationP * ordered.length / (index + 1)); ordered[index].adjustedQ = round(Math.min(1, previous)); } }
function add(map: Map<string, number[]>, key: string, value: number): void { const values = map.get(key) ?? []; values.push(value); map.set(key, values); }
function mean(values: readonly number[]): number { return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function hash32(value: string): number { let hash = 2166136261; for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return hash >>> 0; }
function generator(seed: number): () => number { let state = seed || 0x9e3779b9; return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x100000000; }; }
