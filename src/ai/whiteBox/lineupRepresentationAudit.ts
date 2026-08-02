export interface LineupRepresentationObservation {
  season: number;
  managerId: string;
  trace: {
    comparison?: {incumbent?: string; shadow?: string | null};
    candidates?: Array<{id?: string; diagnostics?: Record<string, number>}>;
  };
}

export interface LineupRepresentationFeatureAudit {
  feature: string;
  contrasts: number;
  nonZero: number;
  managers: number;
  seasons: number;
  minimumDelta: number;
  maximumDelta: number;
}

export interface LineupRepresentationAudit {
  schemaVersion: 1;
  conclusion: "no-v2-telemetry" | "collect-more-telemetry" | "ready-for-outcome-linkage";
  thresholds: {minimumTraces: number; minimumManagers: number; minimumSeasons: number; minimumContrasts: number; minimumVariableFeatures: number};
  metrics: {
    traces: number;
    tracesWithDiagnostics: number;
    comparableContrasts: number;
    variableContrasts: number;
    managers: number;
    seasons: number;
    features: number;
    variableFeatures: number;
  };
  features: LineupRepresentationFeatureAudit[];
  blockers: string[];
}

export function auditLineupRepresentation(
  observations: readonly LineupRepresentationObservation[],
  overrides: Partial<LineupRepresentationAudit["thresholds"]> = {},
): LineupRepresentationAudit {
  const thresholds = {
    minimumTraces: integer(overrides.minimumTraces ?? 60, 1, 100000, "minimumTraces"),
    minimumManagers: integer(overrides.minimumManagers ?? 20, 1, 1000, "minimumManagers"),
    minimumSeasons: integer(overrides.minimumSeasons ?? 3, 1, 1000, "minimumSeasons"),
    minimumContrasts: integer(overrides.minimumContrasts ?? 20, 1, 100000, "minimumContrasts"),
    minimumVariableFeatures: integer(overrides.minimumVariableFeatures ?? 4, 1, 1000, "minimumVariableFeatures"),
  };
  const rows: Array<{managerId: string; season: number; deltas: Record<string, number>}> = [];
  let tracesWithDiagnostics = 0;
  for (const observation of observations) {
    if (!Number.isInteger(observation.season) || observation.season < 1 || !observation.managerId.trim()) throw new Error("Invalid lineup representation observation");
    const candidates = observation.trace.candidates ?? [];
    if (candidates.some(candidate => Object.keys(candidate.diagnostics ?? {}).length > 0)) tracesWithDiagnostics++;
    const incumbent = candidates.find(candidate => candidate.id === observation.trace.comparison?.incumbent);
    const counterpart = observation.trace.comparison?.shadow && observation.trace.comparison.shadow !== observation.trace.comparison.incumbent
      ? candidates.find(candidate => candidate.id === observation.trace.comparison?.shadow)
      : candidates.find(candidate => candidate.id && candidate.id !== incumbent?.id);
    if (!incumbent?.diagnostics || !counterpart?.diagnostics) continue;
    const names = new Set([...Object.keys(incumbent.diagnostics), ...Object.keys(counterpart.diagnostics)]);
    const deltas: Record<string, number> = {};
    for (const name of names) {
      if (name === "lineup.representationVersion") continue;
      const before = Number(incumbent.diagnostics[name] ?? 0), after = Number(counterpart.diagnostics[name] ?? 0);
      if (!Number.isFinite(before) || !Number.isFinite(after)) throw new Error(`Non-finite lineup diagnostic ${name}`);
      deltas[name] = round(after - before);
    }
    rows.push({managerId: observation.managerId, season: observation.season, deltas});
  }
  const names = [...new Set(rows.flatMap(row => Object.keys(row.deltas)))].sort();
  const features = names.map(feature => {
    const values = rows.map(row => ({...row, delta: row.deltas[feature] ?? 0}));
    const nonZero = values.filter(row => Math.abs(row.delta) > 1e-9);
    return {
      feature,
      contrasts: values.length,
      nonZero: nonZero.length,
      managers: new Set(nonZero.map(row => row.managerId)).size,
      seasons: new Set(nonZero.map(row => row.season)).size,
      minimumDelta: round(Math.min(...values.map(row => row.delta))),
      maximumDelta: round(Math.max(...values.map(row => row.delta))),
    };
  }).sort((left, right) => right.nonZero - left.nonZero || left.feature.localeCompare(right.feature));
  const variableRows = rows.filter(row => Object.values(row.deltas).some(value => Math.abs(value) > 1e-9));
  const managers = new Set(observations.filter(observation => observation.trace.candidates?.some(candidate => candidate.diagnostics)).map(observation => observation.managerId)).size;
  const seasons = new Set(observations.filter(observation => observation.trace.candidates?.some(candidate => candidate.diagnostics)).map(observation => observation.season)).size;
  const variableFeatures = features.filter(feature => feature.nonZero > 0).length;
  const blockers: string[] = [];
  if (tracesWithDiagnostics < thresholds.minimumTraces) blockers.push(`traces:${tracesWithDiagnostics}<${thresholds.minimumTraces}`);
  if (managers < thresholds.minimumManagers) blockers.push(`managers:${managers}<${thresholds.minimumManagers}`);
  if (seasons < thresholds.minimumSeasons) blockers.push(`seasons:${seasons}<${thresholds.minimumSeasons}`);
  if (variableRows.length < thresholds.minimumContrasts) blockers.push(`variable-contrasts:${variableRows.length}<${thresholds.minimumContrasts}`);
  if (variableFeatures < thresholds.minimumVariableFeatures) blockers.push(`variable-features:${variableFeatures}<${thresholds.minimumVariableFeatures}`);
  return {
    schemaVersion: 1,
    conclusion: tracesWithDiagnostics === 0 ? "no-v2-telemetry" : blockers.length ? "collect-more-telemetry" : "ready-for-outcome-linkage",
    thresholds,
    metrics: {
      traces: observations.length,
      tracesWithDiagnostics,
      comparableContrasts: rows.length,
      variableContrasts: variableRows.length,
      managers,
      seasons,
      features: features.length,
      variableFeatures,
    },
    features,
    blockers,
  };
}

function integer(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`);
  return value;
}
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
