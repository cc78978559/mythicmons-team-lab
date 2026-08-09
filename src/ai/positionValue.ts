import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type {AiDecisionTrace, PositionSnapshot} from "../showdown/choice";
import {canonicalJson, sha256} from "../showdown/evidenceEpoch";
import {classifyReplayEvidence} from "../draft/evidenceEpochAudit";
import {acquireNamedRunLock} from "../draft/runLock";

export const POSITION_VALUE_MODEL_VERSION = "position-value-logistic-v2.2-phase-audited";
export const POSITION_FEATURE_VERSION = "position-features-v2-paired-calibration";
export const POSITION_FEATURES = ["remainingDelta", "hpDelta", "activeHpDelta", "statusDelta", "activeStatusDelta", "boostDelta", "hazardDelta", "screenDelta", "forcedSwitch", "trapped", "remainingLate", "hpLate"] as const;
export type PositionFeature = typeof POSITION_FEATURES[number];

export interface PositionValueSample {
  id: string; battleId: string; clusterId: string; source: string; playerId: "p1" | "p2"; ordinal: number; turn: number; label: 0 | 1; weight: number; split: "train" | "validation" | "test"; features: number[];
}

export interface PositionValueModel {
  schemaVersion: 1; version: typeof POSITION_VALUE_MODEL_VERSION; featureVersion: typeof POSITION_FEATURE_VERSION; features: readonly PositionFeature[]; coefficients: number[]; regularization: number; trainedSamples: number; trainedBattles: number; trainingSignature: string; sha256: string;
}

export interface PositionValueMetrics {samples: number; battles: number; clusters: number; brier: number; logLoss: number; accuracy: number; ece: number; meanPrediction: number; positiveRate: number}
export interface PositionValueSummary {
  schemaVersion: 1; generatedAt: string; sourceRoot: string; sources: number; reusedSources: number; modelCacheHit: boolean; battles: number; samples: number; skipped: Record<string, number>; split: Record<string, {samples: number; battles: number; clusters: number}>; selectedRegularization: number; metrics: Record<string, {model: PositionValueMetrics; constant: PositionValueMetrics; material: PositionValueMetrics}>; testByPhase: Record<"early" | "mid" | "late", {model: PositionValueMetrics; constant: PositionValueMetrics; material: PositionValueMetrics}>; testImprovement: {vsConstantLogLossPercent: number; vsMaterialLogLossPercent: number; brierDeltaVsConstant: number; bootstrapProbabilityBetterThanConstant: number; bootstrapProbabilityBetterThanMaterial: number}; audit: {healthy: boolean; activationStatus: "shadow-only"; formalActivationAllowed: false; issues: Array<{severity: "error" | "warning"; code: string; message: string}>; symmetryMaximumError: number}; model: PositionValueModel; inputSignature: string; elapsedMs: number; peakRssBytes: number; artifacts: {model: string; samples: string; summary: string; report: string; cache: string; failures: string}
}

interface CachedSource {fingerprint: string; samples: Omit<PositionValueSample, "weight" | "split">[]; battleId: string; clusterId: string; skip?: string}
interface PositionCache {schemaVersion: 1; featureVersion: string; sources: Record<string, CachedSource>}

export function positionFeatures(snapshot: PositionSnapshot): number[] {
  const own = snapshot.own, opponent = snapshot.opponent, progress = Math.min(1, snapshot.turn / 40);
  const remainingDelta = (own.remaining - opponent.remaining) / 6, hpDelta = (own.hpTotal - opponent.hpTotal) / 6;
  return [remainingDelta, hpDelta, own.activeHp - opponent.activeHp, (opponent.statusCount - own.statusCount) / 6, Number(opponent.activeStatus) - Number(own.activeStatus), (own.positiveBoosts - own.negativeBoosts - opponent.positiveBoosts + opponent.negativeBoosts) / 12, (opponent.hazards - own.hazards) / 5, (own.screens - opponent.screens) / 3, snapshot.forcedSwitch ? -1 : 0, snapshot.trapped ? -1 : 0, remainingDelta * progress, hpDelta * progress].map(round);
}

export function pairedPositionFeatures(own: PositionSnapshot, opponent: PositionSnapshot): number[] { const left = positionFeatures(own), right = positionFeatures(opponent); return left.map((value, index) => round((value - right[index]) / 2)); }
export function predictPairedPositionValue(own: PositionSnapshot, opponent: PositionSnapshot, model: PositionValueModel): number { return sigmoid(dot(pairedPositionFeatures(own, opponent), model.coefficients)); }

export function buildPositionValueModel(sourceRoot: string, outputDirectory: string): PositionValueSummary {
  const started = Date.now(), root = path.resolve(sourceRoot), out = path.resolve(outputDirectory); fs.mkdirSync(out, {recursive: true});
  const lock = acquireNamedRunLock(out, ".position-value.lock", {command: "build", sourceRoot: root}), cacheFile = path.join(out, "source-cache.json.gz"), failureFile = path.join(out, "failures.json");
  let phase = "scan", peakRssBytes = process.memoryUsage().rss;
  atomic(path.join(out, "build-state.json"), {schemaVersion: 1, status: "running", phase, startedAt: new Date(started).toISOString(), peakRssBytes});
  try {
    const prior = optionalGzip<PositionCache>(cacheFile), next: PositionCache = {schemaVersion: 1, featureVersion: POSITION_FEATURE_VERSION, sources: {}}, samples: PositionValueSample[] = [], skipped: Record<string, number> = {}, files = findDecisionFiles(root); let reusedSources = 0;
    for (const file of files) {
      const relative = rel(root, file), game = path.dirname(file), replay = existing(game, ["replay-input.json", "replay-input.json.gz"]), end = existing(game, ["end.json", "end.json.gz"]), fingerprint = sourceFingerprint(file, replay, end);
      let cached = prior?.schemaVersion === 1 && prior.featureVersion === POSITION_FEATURE_VERSION ? prior.sources[relative] : undefined;
      if (cached?.fingerprint === fingerprint) reusedSources += 1;
      else cached = inspectSource(root, file, replay, end, fingerprint);
      next.sources[relative] = cached;
      if (cached.skip) skipped[cached.skip] = (skipped[cached.skip] ?? 0) + 1;
      else samples.push(...cached.samples.map(sample => ({...sample, weight: 0, split: splitForCluster(sample.clusterId)})));
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    }
    const inputSignature = sha256(Object.entries(next.sources).sort().map(([source, value]) => [source, value.fingerprint]));
    phase = "weight"; weightSamples(samples);
    const priorSummary = optionalJson<PositionValueSummary>(path.join(out, "summary.json")), priorModel = optionalJson<PositionValueModel>(path.join(out, "model.json"));
    if (reusedSources === files.length && priorSummary?.inputSignature === inputSignature && priorModel?.version === POSITION_VALUE_MODEL_VERSION && priorModel.featureVersion === POSITION_FEATURE_VERSION && priorSummary.model.sha256 === priorModel.sha256) {
      const summary = {...priorSummary, generatedAt: new Date().toISOString(), reusedSources, modelCacheHit: true, elapsedMs: Date.now() - started, peakRssBytes}; writeGzip(cacheFile, next); atomic(path.join(out, "summary.json"), summary); atomic(failureFile, {schemaVersion: 1, failures: []}); atomic(path.join(out, "build-state.json"), {schemaVersion: 1, status: "complete", phase: "cache-hit", elapsedMs: summary.elapsedMs, peakRssBytes}); return summary;
    }
    phase = "train"; const training = samples.filter(sample => sample.split === "train"), validation = samples.filter(sample => sample.split === "validation"), test = samples.filter(sample => sample.split === "test");
    if (!training.length || !validation.length || !test.length) throw new Error("Position corpus does not populate all train/validation/test splits");
    const candidates = [0, .001, .01, .05, .1].map(regularization => fit(training, regularization));
    const selected = candidates.sort((left, right) => metrics(validation, sample => score(sample, left)).logLoss - metrics(validation, sample => score(sample, right)).logLoss)[0];
    const trainingSignature = sha256(samples.map(sample => [sample.id, sample.split, sample.label, sample.weight, sample.features]));
    const modelCore = {schemaVersion: 1 as const, version: POSITION_VALUE_MODEL_VERSION as typeof POSITION_VALUE_MODEL_VERSION, featureVersion: POSITION_FEATURE_VERSION as typeof POSITION_FEATURE_VERSION, features: POSITION_FEATURES, coefficients: selected.coefficients.map(round), regularization: selected.regularization, trainedSamples: training.length, trainedBattles: new Set(training.map(sample => sample.battleId)).size, trainingSignature};
    const model: PositionValueModel = {...modelCore, sha256: sha256(modelCore)};
    phase = "audit";
    const bySplit = Object.fromEntries((["train", "validation", "test"] as const).map(name => { const subset = samples.filter(sample => sample.split === name); return [name, {model: metrics(subset, sample => score(sample, model)), constant: metrics(subset, () => .5), material: metrics(subset, materialScore)}]; })) as PositionValueSummary["metrics"];
    const testByPhase = Object.fromEntries((["early", "mid", "late"] as const).map(phaseName => { const subset = test.filter(sample => turnPhase(sample.turn) === phaseName); return [phaseName, {model: metrics(subset, sample => score(sample, model)), constant: metrics(subset, () => .5), material: metrics(subset, materialScore)}]; })) as PositionValueSummary["testByPhase"];
    const testClusters = grouped(test), bootstrap = bootstrapComparison(testClusters, model, 500), testMetrics = bySplit.test;
    const issues: PositionValueSummary["audit"]["issues"] = [], split = splitCounts(samples), battles = new Set(samples.map(sample => sample.battleId)).size, clusters = new Set(samples.map(sample => sample.clusterId)).size;
    if (battles < 80) issues.push({severity: "error", code: "insufficient-battles", message: `${battles}/80 battles`});
    if (clusters < 20 || split.test.clusters < 4) issues.push({severity: "error", code: "insufficient-clusters", message: `${clusters} total clusters; ${split.test.clusters} test clusters`});
    if (testMetrics.model.logLoss >= testMetrics.constant.logLoss) issues.push({severity: "error", code: "no-constant-improvement", message: "Model does not improve test log loss over 0.5"});
    if (testMetrics.model.logLoss >= testMetrics.material.logLoss) issues.push({severity: "warning", code: "no-material-improvement", message: "Model does not improve test log loss over the fixed material baseline"});
    if (bootstrap.material < .9) issues.push({severity: "error", code: "weak-material-bootstrap", message: `P(model better than material) ${bootstrap.material} is below 0.9`});
    if (testMetrics.model.ece > .08) issues.push({severity: "error", code: "calibration-error", message: `Test ECE ${testMetrics.model.ece} exceeds 0.08`});
    const symmetryMaximumError = symmetryError(model); if (symmetryMaximumError > 1e-12) issues.push({severity: "error", code: "symmetry", message: `Perspective symmetry error ${symmetryMaximumError}`});
    if (model.coefficients[0] < 0 || model.coefficients[1] < 0) issues.push({severity: "error", code: "material-monotonicity", message: "Learned remaining or HP coefficient is negative"});
    if (Math.abs(testMetrics.model.meanPrediction - testMetrics.model.positiveRate) > .03) issues.push({severity: "error", code: "population-calibration-bias", message: `Mean prediction ${testMetrics.model.meanPrediction} differs from outcome rate ${testMetrics.model.positiveRate}`});
    for (const [phaseName, value] of Object.entries(testByPhase)) { if (value.model.samples >= 200 && value.model.logLoss >= value.constant.logLoss) issues.push({severity: "error", code: `phase-${phaseName}-constant`, message: `${phaseName} test log loss does not beat constant`}); else if (value.model.samples >= 200 && value.model.logLoss >= value.material.logLoss) issues.push({severity: "warning", code: `phase-${phaseName}-material`, message: `${phaseName} test log loss does not beat material baseline`}); }
    const artifacts = {model: path.join(out, "model.json"), samples: path.join(out, "samples.json.gz"), summary: path.join(out, "summary.json"), report: path.join(out, "report.md"), cache: cacheFile, failures: failureFile};
    const summary: PositionValueSummary = {schemaVersion: 1, generatedAt: new Date().toISOString(), sourceRoot: root, sources: files.length, reusedSources, modelCacheHit: false, battles, samples: samples.length, skipped, split, selectedRegularization: model.regularization, metrics: bySplit, testByPhase, testImprovement: {vsConstantLogLossPercent: percentImprovement(testMetrics.constant.logLoss, testMetrics.model.logLoss), vsMaterialLogLossPercent: percentImprovement(testMetrics.material.logLoss, testMetrics.model.logLoss), brierDeltaVsConstant: round(testMetrics.model.brier - testMetrics.constant.brier), bootstrapProbabilityBetterThanConstant: bootstrap.constant, bootstrapProbabilityBetterThanMaterial: bootstrap.material}, audit: {healthy: !issues.some(issue => issue.severity === "error"), activationStatus: "shadow-only", formalActivationAllowed: false, issues, symmetryMaximumError}, model, inputSignature, elapsedMs: Date.now() - started, peakRssBytes, artifacts};
    writeGzip(cacheFile, next); writeGzip(artifacts.samples, {schemaVersion: 1, featureVersion: POSITION_FEATURE_VERSION, samples}); atomic(artifacts.model, model); atomic(artifacts.summary, summary); atomic(failureFile, {schemaVersion: 1, failures: []}); fs.writeFileSync(artifacts.report, report(summary), "utf8"); atomic(path.join(out, "build-state.json"), {schemaVersion: 1, status: "complete", phase: "complete", elapsedMs: summary.elapsedMs, peakRssBytes});
    return summary;
  } catch (error) { const failure = {phase, message: error instanceof Error ? error.message : String(error)}; atomic(failureFile, {schemaVersion: 1, failures: [failure]}); atomic(path.join(out, "build-state.json"), {schemaVersion: 1, status: "failed", phase, peakRssBytes: Math.max(peakRssBytes, process.memoryUsage().rss), failure}); throw error; }
  finally { lock.release(); }
}

export function doctorPositionValue(outputDirectory: string, verifySources = false): Record<string, unknown> {
  const out = path.resolve(outputDirectory), summary = optionalJson<PositionValueSummary>(path.join(out, "summary.json")), model = optionalJson<PositionValueModel>(path.join(out, "model.json")), issues: Array<{severity: "error" | "warning"; code: string; message: string}> = [];
  if (!summary || !model) return {available: false, healthy: false, issues: [{severity: "error", code: "missing-artifacts", message: "Position value artifacts are missing"}]};
  const {sha256: _hash, ...core} = model; if (sha256(core) !== model.sha256) issues.push({severity: "error", code: "model-signature", message: "Model signature mismatch"});
  if (summary.model.sha256 !== model.sha256) issues.push({severity: "error", code: "summary-binding", message: "Summary and model differ"});
  if (summary.audit.formalActivationAllowed) issues.push({severity: "error", code: "activation-authority", message: "Stage-2 benchmark model must remain shadow-only"});
  let verifiedSources = 0;
  if (verifySources) { const cache = optionalGzip<PositionCache>(path.join(out, "source-cache.json.gz")); if (!cache) issues.push({severity: "error", code: "missing-cache", message: "Source cache is missing"}); else for (const [relative, cached] of Object.entries(cache.sources)) { const file = path.join(summary.sourceRoot, ...relative.split("/")), game = path.dirname(file), replay = existing(game, ["replay-input.json", "replay-input.json.gz"]), end = existing(game, ["end.json", "end.json.gz"]); if (!fs.existsSync(file)) issues.push({severity: "error", code: "missing-source", message: relative}); else if (sourceFingerprint(file, replay, end) !== cached.fingerprint) issues.push({severity: "error", code: "source-hash", message: `Source or companion changed: ${relative}`}); verifiedSources += 1; } }
  return {available: true, healthy: !issues.some(issue => issue.severity === "error"), verifiedSources, model: {version: model.version, sha256: model.sha256, features: model.features.length}, corpus: {sources: summary.sources, battles: summary.battles, samples: summary.samples}, evaluation: summary.testImprovement, activationStatus: summary.audit.activationStatus, issues: [...summary.audit.issues, ...issues]};
}

function inspectSource(root: string, file: string, replay: string | null, end: string | null, fingerprint: string): CachedSource {
  const relative = rel(root, file); if (!replay || !end) return {fingerprint, samples: [], battleId: "", clusterId: "", skip: "missing-companion"};
  try {
    const traces = read<any[]>(file), terminal = read<any>(end), capsule = read<any>(replay), evidence = classifyReplayEvidence(replay);
    if (!terminal.ended || !["Team A", "Team B"].includes(terminal.winner)) return {fingerprint, samples: [], battleId: capsule.sha256 ?? "", clusterId: "", skip: "non-binary-outcome"};
    if (evidence.compatibility !== "exact-compatible") return {fingerprint, samples: [], battleId: capsule.sha256 ?? "", clusterId: "", skip: `evidence-${evidence.compatibility}`};
    const battleId = String(capsule.sha256), teams = [sha256(capsule.input.teamA), sha256(capsule.input.teamB)].sort(), clusterId = sha256(teams);
    const values: CachedSource["samples"] = [], byTurn = new Map<number, Partial<Record<"p1" | "p2", {trace: AiDecisionTrace; ordinal: number}>>>();
    for (let index = 0; index < traces.length; index += 1) { const trace = traces[index] as AiDecisionTrace; if (!trace.positionSnapshot || trace.positionSnapshot.encoderVersion !== "position-snapshot-v1") continue; const pair = byTurn.get(trace.turn) ?? {}; if (!pair[trace.playerId]) pair[trace.playerId] = {trace, ordinal: trace.decisionOrdinal ?? index + 1}; byTurn.set(trace.turn, pair); }
    for (const [turn, pair] of byTurn) { if (!pair.p1 || !pair.p2) continue; const canonical = pairedPositionFeatures(pair.p1.trace.positionSnapshot!, pair.p2.trace.positionSnapshot!);
      for (const playerId of ["p1", "p2"] as const) { const ordinal = pair[playerId]!.ordinal, ownTeam = playerId === "p1" ? "Team A" : "Team B"; values.push({id: sha256({battleId, playerId, turn, paired: true}).slice(0, 24), battleId, clusterId, source: relative, playerId, ordinal, turn, label: terminal.winner === ownTeam ? 1 : 0, features: playerId === "p1" ? canonical : canonical.map(value => -value)}); }
    }
    return values.length ? {fingerprint, samples: values, battleId, clusterId} : {fingerprint, samples: [], battleId, clusterId, skip: "missing-position-snapshots"};
  } catch { return {fingerprint, samples: [], battleId: "", clusterId: "", skip: "invalid-source"}; }
}

function fit(samples: PositionValueSample[], regularization: number): {coefficients: number[]; regularization: number} {
  const coefficients = Array(POSITION_FEATURES.length).fill(0), totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);
  for (let iteration = 0; iteration < 2500; iteration += 1) { const gradient = Array(coefficients.length).fill(0); for (const sample of samples) { const error = sigmoid(dot(sample.features, coefficients)) - sample.label; for (let index = 0; index < gradient.length; index += 1) gradient[index] += sample.weight * error * sample.features[index]; } const rate = .8 / Math.sqrt(1 + iteration / 100); for (let index = 0; index < coefficients.length; index += 1) coefficients[index] -= rate * (gradient[index] / totalWeight + regularization * coefficients[index]); }
  return {coefficients, regularization};
}
function score(sample: PositionValueSample, model: {coefficients: number[]}): number { return sigmoid(dot(sample.features, model.coefficients)); }
function materialScore(sample: PositionValueSample): number { return sigmoid(sample.features[0] * 2.2 + sample.features[1] * 1.4 + sample.features[2] * .35); }
function turnPhase(turn: number): "early" | "mid" | "late" { return turn <= 10 ? "early" : turn <= 30 ? "mid" : "late"; }
function metrics(samples: PositionValueSample[], predict: (sample: PositionValueSample) => number): PositionValueMetrics { let weight = 0, brier = 0, logLoss = 0, correct = 0, prediction = 0, positive = 0; const bins = Array.from({length: 10}, () => ({weight: 0, prediction: 0, positive: 0})); for (const sample of samples) { const p = clamp(predict(sample), 1e-9, 1 - 1e-9), w = sample.weight; weight += w; brier += w * (p - sample.label) ** 2; logLoss -= w * (sample.label * Math.log(p) + (1 - sample.label) * Math.log(1 - p)); correct += w * Number((p >= .5 ? 1 : 0) === sample.label); prediction += w * p; positive += w * sample.label; const bin = bins[Math.min(9, Math.floor(p * 10))]; bin.weight += w; bin.prediction += w * p; bin.positive += w * sample.label; } const ece = bins.reduce((sum, bin) => sum + (bin.weight ? bin.weight / weight * Math.abs(bin.prediction / bin.weight - bin.positive / bin.weight) : 0), 0); return {samples: samples.length, battles: new Set(samples.map(sample => sample.battleId)).size, clusters: new Set(samples.map(sample => sample.clusterId)).size, brier: round(brier / weight), logLoss: round(logLoss / weight), accuracy: round(correct / weight), ece: round(ece), meanPrediction: round(prediction / weight), positiveRate: round(positive / weight)}; }
function weightSamples(samples: PositionValueSample[]): void { const groups = new Map<string, PositionValueSample[]>(); for (const sample of samples) { const key = `${sample.battleId}:${sample.playerId}`; groups.set(key, [...(groups.get(key) ?? []), sample]); } for (const group of groups.values()) for (const sample of group) sample.weight = round(.5 / group.length); }
function splitForCluster(clusterId: string): PositionValueSample["split"] { const bucket = Number.parseInt(clusterId.slice(0, 8), 16) % 100; return bucket < 70 ? "train" : bucket < 85 ? "validation" : "test"; }
function splitCounts(samples: PositionValueSample[]): PositionValueSummary["split"] { return Object.fromEntries((["train", "validation", "test"] as const).map(split => { const subset = samples.filter(sample => sample.split === split); return [split, {samples: subset.length, battles: new Set(subset.map(sample => sample.battleId)).size, clusters: new Set(subset.map(sample => sample.clusterId)).size}]; })) as PositionValueSummary["split"]; }
function grouped(samples: PositionValueSample[]): PositionValueSample[][] { const groups = new Map<string, PositionValueSample[]>(); for (const sample of samples) groups.set(sample.clusterId, [...(groups.get(sample.clusterId) ?? []), sample]); return [...groups.values()]; }
function bootstrapComparison(groups: PositionValueSample[][], model: PositionValueModel, iterations: number): {constant: number; material: number} { let constant = 0, material = 0, state = 0x51f15e; const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; }; for (let iteration = 0; iteration < iterations; iteration += 1) { const sample = Array.from({length: groups.length}, () => groups[Math.floor(random() * groups.length)]).flat(), value = metrics(sample, item => score(item, model)).logLoss; if (value < metrics(sample, () => .5).logLoss) constant += 1; if (value < metrics(sample, materialScore).logLoss) material += 1; } return {constant: round(constant / iterations), material: round(material / iterations)}; }
function symmetryError(model: PositionValueModel): number { let maximum = 0; for (let index = 0; index < 100; index += 1) { const vector = POSITION_FEATURES.map((_, feature) => Math.sin((index + 1) * (feature + 3)) * .8), p = sigmoid(dot(vector, model.coefficients)), inverse = sigmoid(dot(vector.map(value => -value), model.coefficients)); maximum = Math.max(maximum, Math.abs(1 - p - inverse)); } return maximum; }
function percentImprovement(baseline: number, value: number): number { return round((baseline - value) / baseline * 100); }
function dot(left: readonly number[], right: readonly number[]): number { return left.reduce((sum, value, index) => sum + value * right[index], 0); }
function sigmoid(value: number): number { return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value)); }
function round(value: number): number { return Math.round(value * 1e6) / 1e6; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function findDecisionFiles(root: string): string[] { const result: string[] = []; walk(root, file => { if (/ai-decisions\.json(?:\.gz)?$/.test(file)) result.push(file); }); return result.sort(); }
function walk(directory: string, visit: (file: string) => void): void { if (!fs.existsSync(directory)) return; for (const entry of fs.readdirSync(directory, {withFileTypes: true})) { const target = path.join(directory, entry.name); if (entry.isDirectory()) walk(target, visit); else visit(target); } }
function existing(directory: string, names: string[]): string | null { for (const name of names) { const file = path.join(directory, name); if (fs.existsSync(file)) return file; } return null; }
function read<T>(file: string): T { const raw = fs.readFileSync(file); return JSON.parse(file.endsWith(".gz") ? zlib.gunzipSync(raw).toString("utf8") : raw.toString("utf8")) as T; }
function optionalJson<T>(file: string): T | null { try { return read<T>(file); } catch { return null; } }
function optionalGzip<T>(file: string): T | null { return optionalJson<T>(file); }
function writeGzip(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, zlib.gzipSync(`${JSON.stringify(value)}\n`)); fs.renameSync(temporary, file); }
function atomic(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
function fileHash(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function sourceFingerprint(file: string, replay: string | null, end: string | null): string { return sha256({featureVersion: POSITION_FEATURE_VERSION, decision: fileHash(file), replay: replay ? fileHash(replay) : null, end: end ? fileHash(end) : null}); }
function rel(root: string, file: string): string { return path.relative(root, file).replaceAll("\\", "/"); }
function report(summary: PositionValueSummary): string { const test = summary.metrics.test; return [`# Position Value Stage 2`, "", `- Sources/battles/samples: ${summary.sources}/${summary.battles}/${summary.samples}`, `- Train/validation/test clusters: ${summary.split.train.clusters}/${summary.split.validation.clusters}/${summary.split.test.clusters}`, `- Test log loss: model ${test.model.logLoss}, constant ${test.constant.logLoss}, material ${test.material.logLoss}`, `- Test Brier: model ${test.model.brier}, constant ${test.constant.brier}, material ${test.material.brier}`, `- Test ECE: ${test.model.ece}`, `- Early/mid/late test log loss: ${summary.testByPhase.early.model.logLoss}/${summary.testByPhase.mid.model.logLoss}/${summary.testByPhase.late.model.logLoss}`, `- Log-loss improvement vs constant: ${summary.testImprovement.vsConstantLogLossPercent}%`, `- Log-loss improvement vs material: ${summary.testImprovement.vsMaterialLogLossPercent}%`, `- Bootstrap P(better): constant ${summary.testImprovement.bootstrapProbabilityBetterThanConstant}, material ${summary.testImprovement.bootstrapProbabilityBetterThanMaterial}`, `- Structural audit: ${summary.audit.healthy ? "pass" : "blocked"}`, `- Activation: shadow-only`, "", ...summary.audit.issues.map(issue => `- [${issue.severity.toUpperCase()}] ${issue.code}: ${issue.message}`), "", "The model estimates pre-action win probability from visible position state. It does not consume the selected action, candidate scores, personality parameters, or terminal information.", ""].join("\n"); }
