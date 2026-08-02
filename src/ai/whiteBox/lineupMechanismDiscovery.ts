export interface LineupMechanismSample {
  id: string;
  managerId: string;
  season: number;
  direction: "better" | "neutral" | "worse";
  featureDeltas: Record<string, number>;
}

export interface LineupMechanismCandidate {
  id?: string;
  contributions?: readonly {id?: string; value?: number}[];
  diagnostics?: Readonly<Record<string, number>>;
}

export interface LineupMechanismFeature {
  feature: string;
  observations: number;
  nonZero: number;
  decisive: number;
  seasons: number;
  orientation: "positive" | "inverse" | "none";
  concordant: number;
  discordant: number;
  concordanceRate: number;
  exactP: number;
  adjustedQ: number;
  meanDelta: {better: number; neutral: number; worse: number};
  eligible: boolean;
}

export interface LineupMechanismDiscovery {
  schemaVersion: 1;
  conclusion: "candidate-existing-feature" | "requires-new-feature-representation";
  thresholds: {minimumDecisive: number; minimumSeasons: number; minimumConcordance: number; maximumAdjustedQ: number};
  metrics: {samples: number; decisive: number; features: number; eligibleFeatures: number; inactiveFeatures: string[]};
  features: LineupMechanismFeature[];
  findings: string[];
}

export function discoverLineupMechanisms(
  samples: readonly LineupMechanismSample[],
  options: Partial<LineupMechanismDiscovery["thresholds"]> = {},
): LineupMechanismDiscovery {
  if (!samples.length) throw new Error("Lineup mechanism discovery requires samples");
  if (new Set(samples.map(sample => sample.id)).size !== samples.length) throw new Error("Duplicate lineup mechanism sample");
  if (new Set(samples.map(sample => sample.managerId)).size !== samples.length) throw new Error("Each manager may contribute only one discovery sample");
  const thresholds = {
    minimumDecisive: integer(options.minimumDecisive ?? 8, 2, 100, "minimumDecisive"),
    minimumSeasons: integer(options.minimumSeasons ?? 6, 2, 100, "minimumSeasons"),
    minimumConcordance: finite(options.minimumConcordance ?? .75, .5, 1, "minimumConcordance"),
    maximumAdjustedQ: finite(options.maximumAdjustedQ ?? .1, .001, .5, "maximumAdjustedQ"),
  };
  const names = [...new Set(samples.flatMap(sample => Object.keys(sample.featureDeltas)))].sort();
  const features = names.map(feature => analyze(feature, samples));
  adjustBenjaminiHochberg(features);
  for (const feature of features) feature.eligible = feature.decisive >= thresholds.minimumDecisive
    && feature.seasons >= thresholds.minimumSeasons
    && feature.concordanceRate >= thresholds.minimumConcordance
    && feature.adjustedQ <= thresholds.maximumAdjustedQ;
  features.sort((left, right) =>
    Number(right.eligible) - Number(left.eligible)
    || right.decisive - left.decisive
    || right.concordanceRate - left.concordanceRate
    || left.feature.localeCompare(right.feature));
  const inactiveFeatures = features.filter(feature => feature.nonZero === 0).map(feature => feature.feature);
  const eligible = features.filter(feature => feature.eligible);
  const findings: string[] = [];
  if (eligible.length) findings.push(`Existing feature candidates: ${eligible.map(feature => `${feature.feature} (${feature.orientation}, q=${feature.adjustedQ})`).join(", ")}`);
  else findings.push("No existing contribution feature passes independent-manager direction, season coverage, and adjusted significance gates.");
  if (inactiveFeatures.length) findings.push(`Inactive across all treatment contrasts: ${inactiveFeatures.join(", ")}.`);
  const role = features.find(feature => feature.feature === "lineup.rolecoverage");
  if (role && !role.eligible && role.concordanceRate >= .75) findings.push(`Role coverage is directionally promising (${role.concordant}/${role.decisive}) but below the sample or season gate.`);
  const coverage = features.find(feature => feature.feature === "lineup.coverage"), counter = features.find(feature => feature.feature === "lineup.counter");
  if (coverage?.orientation === "inverse" && counter?.orientation === "inverse") findings.push("Offensive coverage and counter preference both lean inverse, so increasing the current opponent-coverage proxy is not a justified fix.");
  return {
    schemaVersion: 1,
    conclusion: eligible.length ? "candidate-existing-feature" : "requires-new-feature-representation",
    thresholds,
    metrics: {
      samples: samples.length,
      decisive: samples.filter(sample => sample.direction !== "neutral").length,
      features: features.length,
      eligibleFeatures: eligible.length,
      inactiveFeatures,
    },
    features,
    findings,
  };
}

export function lineupMechanismFeatureValues(candidate: LineupMechanismCandidate): Map<string, number> {
  const result = new Map<string, number>();
  for (const entry of candidate.contributions ?? []) {
    const value = Number(entry.value);
    if (!entry.id || !Number.isFinite(value)) throw new Error(`Malformed contribution in ${candidate.id ?? "candidate"}`);
    result.set(String(entry.id), value);
  }
  for (const [id, rawValue] of Object.entries(candidate.diagnostics ?? {})) {
    const value = Number(rawValue);
    if (!id.trim() || !Number.isFinite(value)) throw new Error(`Malformed diagnostic in ${candidate.id ?? "candidate"}`);
    result.set(`diagnostic:${id}`, value);
  }
  return result;
}

export function lineupMechanismDiscoveryMarkdown(value: LineupMechanismDiscovery): string {
  return [
    "# Lineup Mechanism Discovery",
    "",
    `- Conclusion: ${value.conclusion}`,
    `- Samples/decisive: ${value.metrics.samples}/${value.metrics.decisive}`,
    `- Existing features/eligible: ${value.metrics.features}/${value.metrics.eligibleFeatures}`,
    "",
    "| Feature | Decisive | Seasons | Orientation | Concordant | Rate | p | q | Better mean | Neutral mean | Worse mean | Eligible |",
    "|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ...value.features.map(feature => `| ${feature.feature} | ${feature.decisive} | ${feature.seasons} | ${feature.orientation} | ${feature.concordant}/${feature.decisive} | ${(feature.concordanceRate * 100).toFixed(1)}% | ${feature.exactP.toFixed(4)} | ${feature.adjustedQ.toFixed(4)} | ${signed(feature.meanDelta.better)} | ${signed(feature.meanDelta.neutral)} | ${signed(feature.meanDelta.worse)} | ${feature.eligible} |`),
    "",
    "## Findings",
    "",
    ...value.findings.map(finding => `- ${finding}`),
    "",
    "This is retrospective mechanism discovery, not activation evidence. Multiple-comparison adjustment is applied across all retained contribution features. A feature candidate still requires a new predeclared counterfactual study.",
    "",
  ].join("\n");
}

function analyze(feature: string, samples: readonly LineupMechanismSample[]): LineupMechanismFeature {
  const rows = samples.map(sample => ({...sample, delta: Number(sample.featureDeltas[feature] ?? 0)}));
  if (rows.some(row => !Number.isFinite(row.delta))) throw new Error(`Non-finite ${feature} delta`);
  const directional = rows.filter(row => row.direction !== "neutral" && Math.abs(row.delta) > 1e-9);
  const positiveConcordant = directional.filter(row => Math.sign(row.delta) === (row.direction === "better" ? 1 : -1)).length;
  const inverseConcordant = directional.length - positiveConcordant;
  const orientation = directional.length === 0 ? "none" : positiveConcordant >= inverseConcordant ? "positive" : "inverse";
  const concordant = orientation === "positive" ? positiveConcordant : orientation === "inverse" ? inverseConcordant : 0;
  const discordant = directional.length - concordant;
  return {
    feature,
    observations: rows.length,
    nonZero: rows.filter(row => Math.abs(row.delta) > 1e-9).length,
    decisive: directional.length,
    seasons: new Set(directional.map(row => row.season)).size,
    orientation,
    concordant,
    discordant,
    concordanceRate: round(directional.length ? concordant / directional.length : 0),
    exactP: round(directional.length ? twoSidedSignP(concordant, directional.length) : 1),
    adjustedQ: 1,
    meanDelta: {
      better: round(mean(rows.filter(row => row.direction === "better").map(row => row.delta))),
      neutral: round(mean(rows.filter(row => row.direction === "neutral").map(row => row.delta))),
      worse: round(mean(rows.filter(row => row.direction === "worse").map(row => row.delta))),
    },
    eligible: false,
  };
}

function adjustBenjaminiHochberg(features: LineupMechanismFeature[]): void {
  const ordered = [...features].sort((left, right) => left.exactP - right.exactP || left.feature.localeCompare(right.feature));
  let previous = 1;
  for (let index = ordered.length - 1; index >= 0; index--) {
    previous = Math.min(previous, ordered[index].exactP * ordered.length / (index + 1));
    ordered[index].adjustedQ = round(Math.min(1, previous));
  }
}
function twoSidedSignP(successes: number, trials: number): number {
  const extreme = Math.max(successes, trials - successes);
  return Math.min(1, 2 * binomialUpperTail(extreme, trials));
}
function binomialUpperTail(successes: number, trials: number): number {
  const logs: number[] = []; let logProbability = -trials * Math.log(2);
  for (let k = 0; k <= trials; k++) {
    if (k >= successes) logs.push(logProbability);
    if (k < trials) logProbability += Math.log(trials - k) - Math.log(k + 1);
  }
  const maximum = Math.max(...logs);
  return Math.exp(maximum) * logs.reduce((total, value) => total + Math.exp(value - maximum), 0);
}
function mean(values: readonly number[]): number { return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0; }
function integer(value: number, min: number, max: number, name: string): number { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function finite(value: number, min: number, max: number, name: string): number { if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function signed(value: number): string { return `${value >= 0 ? "+" : ""}${value.toFixed(6)}`; }
