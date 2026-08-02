import crypto from "node:crypto";
import type {HypothesisDirection, LineupAuditHypothesis, LineupHypothesisObservation} from "./lineupHypothesisWorkbench";

export interface ProspectiveLineupFeatureFinding {
  feature: string;
  direction: HypothesisDirection;
  discoveryPairs: number;
  validationPairs: number;
  managers: number;
  discoveryEffect: number;
  validationEffect: number;
  validationMeanDelta: number;
  validationWinnerAlignedRate: number;
  validationP: number;
  adjustedQ: number;
  registered: boolean;
  promoted: boolean;
}

export interface ProspectiveLineupProgramFinding {
  id: string;
  factors: Array<{feature: string; direction: HypothesisDirection}>;
  discoveryPairs: number;
  validationPairs: number;
  managers: number;
  discoveryEffect: number;
  validationEffect: number;
  validationMeanDelta: number;
  referenceFeature: string;
  incrementalValidationEffect: number;
  incrementalP: number;
  adjustedIncrementalQ: number;
  incrementalComparisons: Array<{feature: string; effect: number; p: number; adjustedQ: number}>;
  validationWinnerAlignedRate: number;
  validationP: number;
  adjustedQ: number;
  registered: boolean;
  promoted: boolean;
}

export interface ProspectiveLineupIncubatorResult {
  schemaVersion: 1;
  activationStatus: "shadow-only";
  conclusion: "prospective-candidates-ready" | "no-prospective-candidate-ready";
  discoverySeasons: number[];
  validationSeason: number;
  thresholds: {minimumManagers: number; minimumDiscoveryEffect: number; minimumValidationEffect: number; minimumIncrementalValidationEffect: number; maximumAdjustedQ: number; maximumIncrementalAdjustedQ: number; permutations: number};
  metrics: {features: number; programs: number; discoveryPairs: number; validationPairs: number; managers: number; promotedFeatures: number; promotedPrograms: number; novelPromoted: number};
  findings: ProspectiveLineupFeatureFinding[];
  programs: ProspectiveLineupProgramFinding[];
  promotedHypotheses: LineupAuditHypothesis[];
}

type Pair = {winner: LineupHypothesisObservation; loser: LineupHypothesisObservation};

export function incubateProspectiveLineupFeatures(
  observationsInput: readonly LineupHypothesisObservation[],
  registeredHypotheses: readonly LineupAuditHypothesis[],
  permutations = 10000,
): ProspectiveLineupIncubatorResult {
  if (!observationsInput.length || !Number.isInteger(permutations) || permutations < 100 || permutations > 100000) throw new Error("Prospective incubator requires observations and 100..100000 permutations");
  const observations = [...observationsInput], seasons = [...new Set(observations.map(row => row.season))].sort((left, right) => left - right);
  const observationIds = observations.map(row => `${row.season}:${row.seriesId}:${row.managerId}`);
  if (new Set(observationIds).size !== observationIds.length) throw new Error("Prospective incubator requires unique season/series/manager observations");
  if (observations.some(row => !row.seriesId || !row.managerId || !Number.isInteger(row.season) || row.season < 1 || !["win", "loss", "draw"].includes(row.outcome))) throw new Error("Prospective incubator received an invalid observation");
  if (seasons.length < 3) throw new Error("Prospective incubator requires at least three seasons");
  const validationSeason = seasons.at(-1)!, discoverySeasons = seasons.slice(0, -1), discoveryRows = observations.filter(row => row.season !== validationSeason), validationRows = observations.filter(row => row.season === validationSeason);
  const discoveryPairs = pairDecisive(discoveryRows), validationPairs = pairDecisive(validationRows);
  const featureSets = discoveryRows.map(row => new Set(Object.keys(row.diagnostics).filter(feature => feature !== "lineup.representationVersion")));
  const features = [...featureSets.reduce((shared, current) => new Set([...shared].filter(feature => current.has(feature))))].sort();
  const registered = new Set(registeredHypotheses.flatMap(hypothesis => hypothesis.factors.map(factor => factor.feature)));
  const findings = features.map(feature => analyzeFeature(feature, discoveryRows, discoveryPairs, validationPairs, registered.has(feature), permutations));
  adjustBenjaminiHochberg(findings);
  const registeredPrograms = new Set(registeredHypotheses.filter(hypothesis => hypothesis.factors.length > 1).map(hypothesis => factorSignature(hypothesis.factors)));
  const programFeatures = findings.filter(finding => Math.abs(finding.discoveryEffect) >= .025);
  const programs: ProspectiveLineupProgramFinding[] = [];
  for (let left = 0; left < programFeatures.length; left++) for (let right = left + 1; right < programFeatures.length; right++) programs.push(analyzeProgram([programFeatures[left], programFeatures[right]], discoveryRows, discoveryPairs, validationPairs, registeredPrograms, permutations));
  adjustProgramBenjaminiHochberg(programs);
  adjustProgramIncrementalBenjaminiHochberg(programs);
  const thresholds = {minimumManagers: 20, minimumDiscoveryEffect: .05, minimumValidationEffect: .05, minimumIncrementalValidationEffect: 0, maximumAdjustedQ: .1, maximumIncrementalAdjustedQ: .1, permutations};
  for (const finding of findings) finding.promoted = finding.managers >= thresholds.minimumManagers
    && Math.abs(finding.discoveryEffect) >= thresholds.minimumDiscoveryEffect
    && finding.validationEffect >= thresholds.minimumValidationEffect
    && finding.adjustedQ <= thresholds.maximumAdjustedQ;
  for (const program of programs) program.promoted = program.managers >= thresholds.minimumManagers
    && program.discoveryEffect >= thresholds.minimumDiscoveryEffect
    && program.validationEffect >= thresholds.minimumValidationEffect
    && program.incrementalValidationEffect > thresholds.minimumIncrementalValidationEffect
    && program.adjustedQ <= thresholds.maximumAdjustedQ
    && program.adjustedIncrementalQ <= thresholds.maximumIncrementalAdjustedQ;
  findings.sort((left, right) => Number(right.promoted) - Number(left.promoted) || left.adjustedQ - right.adjustedQ || right.validationEffect - left.validationEffect || left.feature.localeCompare(right.feature));
  programs.sort((left, right) => Number(right.promoted) - Number(left.promoted) || left.adjustedQ - right.adjustedQ || right.incrementalValidationEffect - left.incrementalValidationEffect || left.id.localeCompare(right.id));
  const promotedHypotheses = [...findings.filter(finding => finding.promoted && !finding.registered).map(toHypothesis), ...programs.filter(program => program.promoted && !program.registered).map(programToHypothesis)];
  return {
    schemaVersion: 1,
    activationStatus: "shadow-only",
    conclusion: promotedHypotheses.length ? "prospective-candidates-ready" : "no-prospective-candidate-ready",
    discoverySeasons,
    validationSeason,
    thresholds,
    metrics: {features: findings.length, programs: programs.length, discoveryPairs: discoveryPairs.length, validationPairs: validationPairs.length, managers: new Set(validationPairs.flatMap(pair => [pair.winner.managerId, pair.loser.managerId])).size, promotedFeatures: findings.filter(finding => finding.promoted).length, promotedPrograms: programs.filter(program => program.promoted).length, novelPromoted: promotedHypotheses.length},
    findings,
    programs,
    promotedHypotheses,
  };
}

function analyzeFeature(feature: string, discoveryRows: LineupHypothesisObservation[], discoveryPairs: Pair[], validationPairs: Pair[], registered: boolean, permutations: number): ProspectiveLineupFeatureFinding {
  const distribution = discoveryRows.map(row => diagnostic(row, feature)).sort((left, right) => left - right), managerMeans = new Map<string, number[]>();
  for (const row of discoveryRows) add(managerMeans, row.managerId, percentile(distribution, diagnostic(row, feature)));
  const baselines = new Map([...managerMeans].map(([manager, values]) => [manager, mean(values)]));
  const deltas = (pairs: Pair[]) => pairs.map(pair => centered(pair.winner, distribution, baselines, feature) - centered(pair.loser, distribution, baselines, feature));
  const discoveryDeltas = deltas(discoveryPairs), rawDiscoveryEffect = standardized(discoveryDeltas), direction: HypothesisDirection = rawDiscoveryEffect >= 0 ? "higher" : "lower", sign = direction === "higher" ? 1 : -1;
  const validationDeltas = deltas(validationPairs).map(value => value * sign), validationEffect = standardized(validationDeltas), observed = mean(validationDeltas), rng = random(`${feature}:${direction}:${validationPairs.map(pair => pair.winner.seriesId).sort().join("|")}`); let extreme = 1;
  for (let iteration = 0; iteration < permutations; iteration++) if (mean(validationDeltas.map(value => value * (rng() < .5 ? -1 : 1))) + 1e-12 >= observed) extreme++;
  const nonZero = validationDeltas.filter(value => Math.abs(value) > 1e-12);
  return {feature, direction, discoveryPairs: discoveryPairs.length, validationPairs: validationPairs.length, managers: new Set(validationPairs.flatMap(pair => [pair.winner.managerId, pair.loser.managerId])).size, discoveryEffect: round(rawDiscoveryEffect), validationEffect: round(validationEffect), validationMeanDelta: round(observed), validationWinnerAlignedRate: round(nonZero.filter(value => value > 0).length / Math.max(1, nonZero.length)), validationP: round(extreme / (permutations + 1)), adjustedQ: 1, registered, promoted: false};
}

function toHypothesis(finding: ProspectiveLineupFeatureFinding): LineupAuditHypothesis {
  const stem = finding.feature.replace(/^lineup\./, "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  return {id: `lineup-incubated-${stem}-v1`, title: `Incubated ${stem.replace(/-/g, " ")}`, rationale: `A direction frozen in earlier seasons replicated in a held-out later season for ${finding.feature}.`, stage: "observational-candidate", combine: "weighted-geometric-percentile", factors: [{feature: finding.feature, direction: finding.direction, weight: 1}], scope: ["all-lineups"], guardrails: finding.feature === "lineup.strengthFloor" ? [{feature: "lineup.roleTagBreadth", minimumDelta: -1}] : [{feature: "lineup.strengthFloor", minimumDelta: -5}]};
}

function analyzeProgram(features: [ProspectiveLineupFeatureFinding, ProspectiveLineupFeatureFinding], discoveryRows: LineupHypothesisObservation[], discoveryPairs: Pair[], validationPairs: Pair[], registeredPrograms: ReadonlySet<string>, permutations: number): ProspectiveLineupProgramFinding {
  const factors = features.map(value => ({feature: value.feature, direction: value.direction})).sort((left, right) => left.feature.localeCompare(right.feature)), distributions = new Map(factors.map(factor => [factor.feature, discoveryRows.map(row => diagnostic(row, factor.feature)).sort((left, right) => left - right)])), managerScores = new Map<string, number[]>();
  const score = (row: LineupHypothesisObservation) => Math.sqrt(factors.reduce((product, factor) => { const rank = percentile(distributions.get(factor.feature)!, diagnostic(row, factor.feature)); return product * Math.max(1e-6, factor.direction === "higher" ? rank : 1 - rank); }, 1));
  for (const row of discoveryRows) add(managerScores, row.managerId, score(row));
  const baselines = new Map([...managerScores].map(([manager, values]) => [manager, mean(values)])), deltas = (pairs: Pair[]) => pairs.map(pair => score(pair.winner) - (baselines.get(pair.winner.managerId) ?? .5) - score(pair.loser) + (baselines.get(pair.loser.managerId) ?? .5));
  const discoveryDeltas = deltas(discoveryPairs), validationDeltas = deltas(validationPairs), discoveryEffect = standardized(discoveryDeltas), validationEffect = standardized(validationDeltas), observed = mean(validationDeltas), id = `lineup-incubated-${factors.map(factor => factor.feature.replace(/^lineup\./, "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()).join("-and-")}-v1`, rng = random(`${id}:${factors.map(factor => factor.direction).join(":")}:${validationPairs.map(pair => pair.winner.seriesId).sort().join("|")}`); let extreme = 1;
  for (let iteration = 0; iteration < permutations; iteration++) if (mean(validationDeltas.map(value => value * (rng() < .5 ? -1 : 1))) + 1e-12 >= observed) extreme++;
  const incrementalComparisons = factors.map(factor => { const distribution = distributions.get(factor.feature)!, managerValues = new Map<string, number[]>(); for (const row of discoveryRows) add(managerValues, row.managerId, percentile(distribution, diagnostic(row, factor.feature))); const baselines = new Map([...managerValues].map(([manager, values]) => [manager, mean(values)])), sign = factor.direction === "higher" ? 1 : -1, componentDeltas = validationPairs.map(pair => (centered(pair.winner, distribution, baselines, factor.feature) - centered(pair.loser, distribution, baselines, factor.feature)) * sign), incrementalDeltas = validationDeltas.map((value, index) => value - componentDeltas[index]), effect = mean(incrementalDeltas), incrementalRng = random(`${id}:incremental:${factor.feature}:${validationPairs.map(pair => pair.winner.seriesId).sort().join("|")}`); let incrementalExtreme = 1; for (let iteration = 0; iteration < permutations; iteration++) if (mean(incrementalDeltas.map(value => value * (incrementalRng() < .5 ? -1 : 1))) + 1e-12 >= effect) incrementalExtreme++; return {feature: factor.feature, effect: round(effect), p: round(incrementalExtreme / (permutations + 1)), adjustedQ: 1}; }), hardest = [...incrementalComparisons].sort((left, right) => left.effect - right.effect || left.feature.localeCompare(right.feature))[0];
  const nonZero = validationDeltas.filter(value => Math.abs(value) > 1e-12);
  return {id, factors, discoveryPairs: discoveryPairs.length, validationPairs: validationPairs.length, managers: new Set(validationPairs.flatMap(pair => [pair.winner.managerId, pair.loser.managerId])).size, discoveryEffect: round(discoveryEffect), validationEffect: round(validationEffect), validationMeanDelta: round(observed), referenceFeature: hardest.feature, incrementalValidationEffect: hardest.effect, incrementalP: Math.max(...incrementalComparisons.map(value => value.p)), adjustedIncrementalQ: 1, incrementalComparisons, validationWinnerAlignedRate: round(nonZero.filter(value => value > 0).length / Math.max(1, nonZero.length)), validationP: round(extreme / (permutations + 1)), adjustedQ: 1, registered: registeredPrograms.has(factorSignature(factors)), promoted: false};
}

function programToHypothesis(program: ProspectiveLineupProgramFinding): LineupAuditHypothesis { return {id: program.id, title: `Incubated ${program.factors.map(factor => factor.feature.replace(/^lineup\./, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()).join(" and ")}`, rationale: `A two-factor program frozen in earlier seasons replicated in a held-out later season and improved on either constituent alone.`, stage: "observational-candidate", combine: "weighted-geometric-percentile", factors: program.factors.map(factor => ({...factor, weight: 1})), scope: ["all-lineups"], guardrails: program.factors.some(factor => factor.feature === "lineup.strengthFloor") ? [{feature: "lineup.roleTagBreadth", minimumDelta: -1}] : [{feature: "lineup.strengthFloor", minimumDelta: -5}]}; }
function factorSignature(factors: readonly {feature: string; direction: HypothesisDirection}[]): string { return [...factors].sort((left, right) => left.feature.localeCompare(right.feature)).map(factor => `${factor.feature}:${factor.direction}`).join("|"); }

function pairDecisive(rows: readonly LineupHypothesisObservation[]): Pair[] { const groups = new Map<string, LineupHypothesisObservation[]>(); for (const row of rows) { const key = `${row.season}:${row.seriesId}`, values = groups.get(key) ?? []; values.push(row); groups.set(key, values); } return [...groups].flatMap(([key, values]) => { if (values.length !== 2) throw new Error(`Prospective incubator requires exactly two sides: ${key}`); const winner = values.find(row => row.outcome === "win"), loser = values.find(row => row.outcome === "loss"); return winner && loser ? [{winner, loser}] : []; }); }
function centered(row: LineupHypothesisObservation, distribution: readonly number[], baselines: ReadonlyMap<string, number>, feature: string): number { return percentile(distribution, diagnostic(row, feature)) - (baselines.get(row.managerId) ?? .5); }
function diagnostic(row: LineupHypothesisObservation, feature: string): number { const value = Number(row.diagnostics[feature]); if (!Number.isFinite(value)) throw new Error(`Missing diagnostic ${feature}: ${row.season}/${row.managerId}/${row.seriesId}`); return value; }
function percentile(sorted: readonly number[], value: number): number { let lower = 0, upper = sorted.length; while (lower < upper) { const middle = (lower + upper) >>> 1; if (sorted[middle] <= value) lower = middle + 1; else upper = middle; } return (lower - .5) / sorted.length; }
function standardized(values: readonly number[]): number { const average = mean(values), secondMoment = mean(values.map(value => value ** 2)); return secondMoment > 1e-18 ? average / Math.sqrt(secondMoment) : 0; }
function adjustBenjaminiHochberg(findings: ProspectiveLineupFeatureFinding[]): void { const ordered = [...findings].sort((left, right) => left.validationP - right.validationP || left.feature.localeCompare(right.feature)); let previous = 1; for (let index = ordered.length - 1; index >= 0; index--) { previous = Math.min(previous, ordered[index].validationP * ordered.length / (index + 1)); ordered[index].adjustedQ = round(Math.min(1, previous)); } }
function adjustProgramBenjaminiHochberg(programs: ProspectiveLineupProgramFinding[]): void { const ordered = [...programs].sort((left, right) => left.validationP - right.validationP || left.id.localeCompare(right.id)); let previous = 1; for (let index = ordered.length - 1; index >= 0; index--) { previous = Math.min(previous, ordered[index].validationP * ordered.length / (index + 1)); ordered[index].adjustedQ = round(Math.min(1, previous)); } }
function adjustProgramIncrementalBenjaminiHochberg(programs: ProspectiveLineupProgramFinding[]): void { const comparisons = programs.flatMap(program => program.incrementalComparisons.map(comparison => ({program, comparison}))).sort((left, right) => left.comparison.p - right.comparison.p || left.program.id.localeCompare(right.program.id) || left.comparison.feature.localeCompare(right.comparison.feature)); let previous = 1; for (let index = comparisons.length - 1; index >= 0; index--) { previous = Math.min(previous, comparisons[index].comparison.p * comparisons.length / (index + 1)); comparisons[index].comparison.adjustedQ = round(Math.min(1, previous)); } for (const program of programs) program.adjustedIncrementalQ = Math.max(...program.incrementalComparisons.map(value => value.adjustedQ)); }
function add(map: Map<string, number[]>, key: string, value: number): void { const values = map.get(key) ?? []; values.push(value); map.set(key, values); }
function mean(values: readonly number[]): number { return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0; }
function random(seed: string): () => number { let state = Number.parseInt(crypto.createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) || 1; return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x100000000; }; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
