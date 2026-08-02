export interface LineupRepresentationOutcomePair {
  id: string;
  season: number;
  managers: readonly [string, string];
  featureDeltas: Readonly<Record<string, number>>;
}

export interface LineupRepresentationResidualRow {
  id: string;
  season: number;
  leftManager: string;
  rightManager: string;
  outcome: 1 | -1;
  leftFeatures: Readonly<Record<string, number>>;
  rightFeatures: Readonly<Record<string, number>>;
}

export interface LineupRepresentationResidualFeature {
  feature: string;
  pairs: number;
  managers: number;
  seasons: number;
  standardizedEffect: number;
  orientation: "higher-than-usual-wins" | "lower-than-usual-wins" | "none";
  permutationP: number;
  adjustedQ: number;
  candidateForCausalStudy: boolean;
}

export interface LineupRepresentationResidualScreen {
  schemaVersion: 1;
  permutations: number;
  features: LineupRepresentationResidualFeature[];
  candidateFeatures: number;
}

export interface LineupRepresentationOutcomeFeature {
  feature: string;
  allPairs: number;
  allNonZero: number;
  allWinnerHigherRate: number;
  independentPairs: number;
  independentNonZero: number;
  seasons: number;
  orientation: "winner-higher" | "winner-lower" | "none";
  concordant: number;
  exactP: number;
  adjustedQ: number;
  candidateForCausalStudy: boolean;
}

export interface LineupRepresentationOutcomeReview {
  schemaVersion: 1;
  conclusion: "candidate-associations-found" | "no-reliable-association";
  thresholds: {minimumIndependentNonZero: number; minimumSeasons: number; maximumAdjustedQ: number};
  metrics: {allPairs: number; independentPairs: number; independentManagers: number; features: number; candidateFeatures: number};
  features: LineupRepresentationOutcomeFeature[];
  findings: string[];
}

export function reviewLineupRepresentationOutcomes(
  allPairs: readonly LineupRepresentationOutcomePair[],
  independentPairs: readonly LineupRepresentationOutcomePair[],
  overrides: Partial<LineupRepresentationOutcomeReview["thresholds"]> = {},
): LineupRepresentationOutcomeReview {
  if (!allPairs.length || !independentPairs.length) throw new Error("Outcome review requires paired lineup outcomes");
  const independentManagers = independentPairs.flatMap(pair => [...pair.managers]);
  if (new Set(independentManagers).size !== independentManagers.length) throw new Error("Independent outcome pairs reuse a manager");
  const thresholds = {
    minimumIndependentNonZero: integer(overrides.minimumIndependentNonZero ?? 8, 2, 100, "minimumIndependentNonZero"),
    minimumSeasons: integer(overrides.minimumSeasons ?? 2, 1, 100, "minimumSeasons"),
    maximumAdjustedQ: finite(overrides.maximumAdjustedQ ?? .2, .001, .5, "maximumAdjustedQ"),
  };
  const names = [...new Set(allPairs.flatMap(pair => Object.keys(pair.featureDeltas)))].sort();
  const features = names.map(feature => analyze(feature, allPairs, independentPairs));
  adjustBenjaminiHochberg(features);
  for (const feature of features) feature.candidateForCausalStudy = feature.independentNonZero >= thresholds.minimumIndependentNonZero
    && feature.seasons >= thresholds.minimumSeasons
    && feature.adjustedQ <= thresholds.maximumAdjustedQ;
  features.sort((left, right) => Number(right.candidateForCausalStudy) - Number(left.candidateForCausalStudy)
    || left.adjustedQ - right.adjustedQ || right.independentNonZero - left.independentNonZero || left.feature.localeCompare(right.feature));
  const candidates = features.filter(feature => feature.candidateForCausalStudy);
  const findings = candidates.length
    ? [`Exploratory associations for causal study: ${candidates.map(feature => `${feature.feature} (${feature.orientation}, q=${feature.adjustedQ})`).join(", ")}.`]
    : ["No diagnostic passed independent-manager coverage and multiple-comparison screening."];
  const saturated = features.filter(feature => feature.allNonZero === 0).map(feature => feature.feature);
  if (saturated.length) findings.push(`Still saturated in observed winner-loser contrasts: ${saturated.join(", ")}.`);
  findings.push("Associations describe winning lineups; they do not prove that changing a diagnostic would change an outcome.");
  return {
    schemaVersion: 1,
    conclusion: candidates.length ? "candidate-associations-found" : "no-reliable-association",
    thresholds,
    metrics: {allPairs: allPairs.length, independentPairs: independentPairs.length, independentManagers: new Set(independentManagers).size, features: features.length, candidateFeatures: candidates.length},
    features,
    findings,
  };
}

export function screenResidualLineupOutcomes(rows: readonly LineupRepresentationResidualRow[], permutations = 2000): LineupRepresentationResidualScreen {
  if (!rows.length) throw new Error("Residual outcome screen requires rows");
  if (!Number.isInteger(permutations) || permutations < 100 || permutations > 100000) throw new Error("permutations must be 100..100000");
  const names = [...new Set(rows.flatMap(row => [...Object.keys(row.leftFeatures), ...Object.keys(row.rightFeatures)]))].filter(name => name !== "lineup.representationVersion").sort();
  const features = names.map(feature => residualFeature(feature, rows, permutations));
  adjustResidualBenjaminiHochberg(features);
  for (const feature of features) feature.candidateForCausalStudy = feature.managers >= 20
    && feature.seasons >= 3
    && Math.abs(feature.standardizedEffect) >= .05
    && feature.adjustedQ <= .1;
  features.sort((left, right) => Number(right.candidateForCausalStudy) - Number(left.candidateForCausalStudy)
    || left.adjustedQ - right.adjustedQ || Math.abs(right.standardizedEffect) - Math.abs(left.standardizedEffect) || left.feature.localeCompare(right.feature));
  return {schemaVersion: 1, permutations, features, candidateFeatures: features.filter(feature => feature.candidateForCausalStudy).length};
}

function analyze(feature: string, allPairs: readonly LineupRepresentationOutcomePair[], independentPairs: readonly LineupRepresentationOutcomePair[]): LineupRepresentationOutcomeFeature {
  const all = allPairs.map(pair => Number(pair.featureDeltas[feature] ?? 0));
  const independent = independentPairs.map(pair => ({season: pair.season, delta: Number(pair.featureDeltas[feature] ?? 0)}));
  if ([...all, ...independent.map(row => row.delta)].some(value => !Number.isFinite(value))) throw new Error(`Non-finite outcome delta for ${feature}`);
  const allNonZero = all.filter(value => Math.abs(value) > 1e-9);
  const nonZero = independent.filter(row => Math.abs(row.delta) > 1e-9);
  const higher = nonZero.filter(row => row.delta > 0).length, lower = nonZero.length - higher;
  const orientation = nonZero.length === 0 ? "none" : higher >= lower ? "winner-higher" : "winner-lower";
  const concordant = orientation === "winner-higher" ? higher : orientation === "winner-lower" ? lower : 0;
  return {
    feature,
    allPairs: all.length,
    allNonZero: allNonZero.length,
    allWinnerHigherRate: round(allNonZero.length ? allNonZero.filter(value => value > 0).length / allNonZero.length : 0),
    independentPairs: independent.length,
    independentNonZero: nonZero.length,
    seasons: new Set(nonZero.map(row => row.season)).size,
    orientation,
    concordant,
    exactP: round(nonZero.length ? twoSidedSignP(concordant, nonZero.length) : 1),
    adjustedQ: 1,
    candidateForCausalStudy: false,
  };
}
function residualFeature(feature: string, rows: readonly LineupRepresentationResidualRow[], permutations: number): LineupRepresentationResidualFeature {
  const managerValues = new Map<string, number[]>();
  for (const row of rows) {
    add(managerValues, row.leftManager, Number(row.leftFeatures[feature] ?? 0));
    add(managerValues, row.rightManager, Number(row.rightFeatures[feature] ?? 0));
  }
  const means = new Map([...managerValues].map(([manager, values]) => [manager, values.reduce((total, value) => total + value, 0) / values.length]));
  const residuals = rows.map(row => {
    const left = Number(row.leftFeatures[feature] ?? 0) - (means.get(row.leftManager) ?? 0);
    const right = Number(row.rightFeatures[feature] ?? 0) - (means.get(row.rightManager) ?? 0);
    return {delta: left - right, outcome: row.outcome};
  });
  if (residuals.some(row => !Number.isFinite(row.delta))) throw new Error(`Non-finite residual outcome value for ${feature}`);
  const observed = residuals.reduce((total, row) => total + row.delta * row.outcome, 0) / residuals.length;
  const variance = residuals.reduce((total, row) => total + row.delta ** 2, 0) / residuals.length;
  const standardizedEffect = variance > 1e-18 ? observed / Math.sqrt(variance) : 0;
  const random = generator(hash32(feature));
  let extreme = 0;
  for (let iteration = 0; iteration < permutations; iteration++) {
    let statistic = 0;
    for (const row of residuals) statistic += row.delta * (random() < .5 ? -1 : 1);
    statistic /= residuals.length;
    if (Math.abs(statistic) + 1e-12 >= Math.abs(observed)) extreme++;
  }
  return {
    feature,
    pairs: rows.length,
    managers: new Set(rows.flatMap(row => [row.leftManager, row.rightManager])).size,
    seasons: new Set(rows.map(row => row.season)).size,
    standardizedEffect: round(standardizedEffect),
    orientation: Math.abs(standardizedEffect) <= 1e-12 ? "none" : standardizedEffect > 0 ? "higher-than-usual-wins" : "lower-than-usual-wins",
    permutationP: round((extreme + 1) / (permutations + 1)),
    adjustedQ: 1,
    candidateForCausalStudy: false,
  };
}
function adjustBenjaminiHochberg(features: LineupRepresentationOutcomeFeature[]): void {
  const ordered = [...features].sort((left, right) => left.exactP - right.exactP || left.feature.localeCompare(right.feature));
  let previous = 1;
  for (let index = ordered.length - 1; index >= 0; index--) {
    previous = Math.min(previous, ordered[index].exactP * ordered.length / (index + 1));
    ordered[index].adjustedQ = round(Math.min(1, previous));
  }
}
function adjustResidualBenjaminiHochberg(features: LineupRepresentationResidualFeature[]): void {
  const ordered = [...features].sort((left, right) => left.permutationP - right.permutationP || left.feature.localeCompare(right.feature));
  let previous = 1;
  for (let index = ordered.length - 1; index >= 0; index--) {
    previous = Math.min(previous, ordered[index].permutationP * ordered.length / (index + 1));
    ordered[index].adjustedQ = round(Math.min(1, previous));
  }
}
function twoSidedSignP(successes: number, trials: number): number { const extreme = Math.max(successes, trials - successes); return Math.min(1, 2 * binomialUpperTail(extreme, trials)); }
function binomialUpperTail(successes: number, trials: number): number {
  const logs: number[] = []; let logProbability = -trials * Math.log(2);
  for (let k = 0; k <= trials; k++) { if (k >= successes) logs.push(logProbability); if (k < trials) logProbability += Math.log(trials - k) - Math.log(k + 1); }
  const maximum = Math.max(...logs);
  return Math.exp(maximum) * logs.reduce((total, value) => total + Math.exp(value - maximum), 0);
}
function integer(value: number, minimum: number, maximum: number, name: string): number { if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`); return value; }
function finite(value: number, minimum: number, maximum: number, name: string): number { if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`); return value; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function add(map: Map<string, number[]>, key: string, value: number): void { if (!Number.isFinite(value)) throw new Error(`Non-finite manager feature for ${key}`); const values = map.get(key) ?? []; values.push(value); map.set(key, values); }
function hash32(value: string): number { let hash = 2166136261; for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return hash >>> 0; }
function generator(seed: number): () => number { let state = seed || 0x9e3779b9; return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x100000000; }; }
