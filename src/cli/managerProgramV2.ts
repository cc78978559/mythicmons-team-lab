import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {DatabaseSync} from "node:sqlite";
import {evolveManagerProgramV2, evaluateManagerProgramV2, MANAGER_PROGRAM_V2_LANGUAGE, managerProgramV2Behavior, managerProgramV2Hash, noviceManagerProgramV2, validateManagerProgramV2, type ManagerProgramSampleV2, type ManagerProgramV2} from "../ai/managerProgramV2";
import {battleActionFamily} from "../ai/battleActionFamily";
import {LEGACY_POSITION_FEATURE_COUNT, pairedPositionFeatures, POSITION_FEATURES, predictPairedPositionValue, type PositionValueModel} from "../ai/positionValue";
import type {AiDecisionTrace, PositionSnapshot} from "../showdown/choice";
import {acquireNamedRunLock} from "../draft/runLock";
import {sha256 as evidenceSha256} from "../showdown/evidenceEpoch";
import {teamStructuresFromReplay} from "../showdown/teamStructure";

const args = process.argv.slice(2), command = args[0] && !args[0].startsWith("--") ? args[0] : "status";
const out = path.resolve(option("--out", "output/tooling/manager-program-v2"));
const dossierRoot = path.resolve(option("--dossiers", "output/tooling/decision-dossiers"));
const positionRoot = path.resolve(option("--position-value", "output/tooling/position-value-stage2"));
const corpusRoot = path.resolve(option("--corpus", "output/tooling/position-value-corpus-v1"));

if (command === "build") print(build());
else if (command === "status") print(status());
else if (command === "doctor") { const result = doctor(args.includes("--verify-sources")); print(result); if (!result.healthy) process.exitCode = 2; }
else if (command === "inspect") print(inspect(required("--manager")));
else throw new Error("Usage: npm run manager-program-v2 -- <build|status|doctor|inspect> [options]");

interface CorpusArchive {schemaVersion: 1; signature: string; modelSha256: string; dossierPolicy: string; sourceFingerprints: Record<string, string>; metrics: {sourceBattles: number; acceptedBattles: number; excludedForbiddenMechanicBattles: number; samples: number; clusters: number; actions: Record<string, number>; splits: Record<string, number>}; samples: ManagerProgramSampleV2[]}
interface ProgramArchive {schemaVersion: 2; activationStatus: "shadow-only"; programs: ManagerProgramV2[]}
interface Summary {
  schemaVersion: 1; generatedAt: string; activationStatus: "shadow-only"; formalActivationAllowed: false; inputSignature: string; elapsedMs: number; peakRssBytes: number;
  corpus: CorpusArchive["metrics"] & {signature: string}; population: {managers: number; programsWithRules: number; acceptedRules: number; rejectedProposals: number; uniqueProgramHashes: number; uniqueBehaviorHashes: number; uniqueTargets: string[]; conditionalPairRules: number};
  evaluation: {testSamples: number; noviceMse: number; programMse: number; improvementPercent: number; managersImproved: number; managersRegressed: number; meanDiscoveryImprovementPercent: number; meanValidationImprovementPercent: number};
  representation: {availableStructuralFeatures: string[]; structuralPredicates: number; managersUsingStructuralContext: number; structuralFeaturesUsed: string[]; targetsUsingStructuralContext: string[]};
  domainReadiness: Record<"acquire" | "configure" | "lineup" | "battle" | "research", {status: "training-ready" | "evidence-adapter-required"; samples: number; reason: string}>;
  audit: {healthy: boolean; issues: Array<{severity: "error" | "warning"; code: string; message: string}>}; artifacts: Record<string, string>;
}

function build(): Summary {
  const started = Date.now(); fs.mkdirSync(out, {recursive: true}); const lock = acquireNamedRunLock(out, ".manager-program-v2.lock", {command: "build"});
  let phase = "inputs", peakRssBytes = process.memoryUsage().rss;
  atomic(path.join(out, "build-state.json"), {schemaVersion: 1, status: "running", phase, startedAt: new Date(started).toISOString(), peakRssBytes});
  try {
    const model = read<PositionValueModel>(path.join(positionRoot, "model.json")), dossierSummary = read<any>(path.join(dossierRoot, "summary.json"));
    verifyModel(model); const managers = managerIds(path.join(dossierRoot, "decision-dossiers.sqlite")); if (!managers.length) throw new Error("No canonical manager identities in decision dossiers");
    phase = "corpus"; const corpus = buildCorpus(model, String(dossierSummary.policyVersion ?? "unknown")); peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    const prior = optional<Summary>(path.join(out, "summary.json"));
    if (prior?.inputSignature === corpus.signature && fs.existsSync(path.join(out, "programs.json.gz")) && doctor(false).healthy) {
      atomic(path.join(out, "build-state.json"), {schemaVersion: 1, status: "complete", phase: "cache-hit", elapsedMs: Date.now() - started, peakRssBytes}); return prior;
    }
    phase = "evolve";
    const discovery = corpus.samples.filter(sample => split(sample.clusterId) === "discovery"), validation = corpus.samples.filter(sample => split(sample.clusterId) === "validation"), test = corpus.samples.filter(sample => split(sample.clusterId) === "test");
    if (discovery.length < 500 || validation.length < 100 || test.length < 100) throw new Error(`Manager-program V2 corpus split too small: ${discovery.length}/${validation.length}/${test.length}`);
    const programs: ManagerProgramV2[] = [], evolutions: ReturnType<typeof evolveManagerProgramV2>[] = [];
    for (const managerId of managers) {
      const personal = discovery.filter(sample => hashUnit(`${managerId}:${sample.id}`) < .55), evidence = {decisionDossierPolicy: corpus.dossierPolicy, positionModelSha256: model.sha256, corpusSignature: corpus.signature};
      const result = evolveManagerProgramV2({program: noviceManagerProgramV2(managerId, evidence), discovery: personal, validation, seed: `${corpus.signature}:${managerId}`, revisions: integerOption("--revisions", 8, 1, 24)});
      programs.push(result.program); evolutions.push(result); peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    }
    phase = "audit"; const issues: Summary["audit"]["issues"] = [], programArchive: ProgramArchive = {schemaVersion: 2, activationStatus: "shadow-only", programs};
    programs.forEach(validateManagerProgramV2);
    const noviceMse = mean(managers.map(() => sampleMse(undefined, test))), programMse = mean(programs.map(program => sampleMse(program, test))), perManager = programs.map(program => sampleMse(program, test) - sampleMse(undefined, test));
    const behaviors = programs.map(managerProgramV2Behavior), acceptedRules = programs.reduce((sum, program) => sum + program.rules.length, 0), rejected = programs.reduce((sum, program) => sum + program.history.filter(entry => !entry.accepted).length, 0), structuralFeatures = new Set<string>(POSITION_FEATURES.slice(LEGACY_POSITION_FEATURE_COUNT)), structuralRows = programs.flatMap(program => program.rules.flatMap(rule => rule.predicates.filter(predicate => structuralFeatures.has(predicate.feature)).map(predicate => ({managerId: program.managerId, target: rule.target, feature: predicate.feature}))));
    if (!acceptedRules) issues.push({severity: "error", code: "no-accepted-rules", message: "No manager validated a program rule"});
    if (new Set(behaviors.map(value => value.hash)).size < 3) issues.push({severity: "warning", code: "low-behavior-diversity", message: "Fewer than three distinct manager behaviors emerged"});
    if (programMse >= noviceMse) issues.push({severity: "warning", code: "no-population-test-improvement", message: "Population program does not improve untouched test MSE"});
    if (programs.some(program => program.activationStatus !== "shadow-only")) issues.push({severity: "error", code: "activation-authority", message: "Manager-program V2 escaped shadow authority"});
    const artifacts = {corpus: path.join(out, "corpus.json.gz"), programs: path.join(out, "programs.json.gz"), summary: path.join(out, "summary.json"), report: path.join(out, "report.md"), failures: path.join(out, "failures.json")};
    const unavailable = (reason: string) => ({status: "evidence-adapter-required" as const, samples: 0, reason});
    const summary: Summary = {schemaVersion: 1, generatedAt: new Date().toISOString(), activationStatus: "shadow-only", formalActivationAllowed: false, inputSignature: corpus.signature, elapsedMs: Date.now() - started, peakRssBytes, corpus: {...corpus.metrics, signature: corpus.signature}, population: {managers: programs.length, programsWithRules: programs.filter(program => program.rules.length).length, acceptedRules, rejectedProposals: rejected, uniqueProgramHashes: new Set(programs.map(managerProgramV2Hash)).size, uniqueBehaviorHashes: new Set(behaviors.map(value => value.hash)).size, uniqueTargets: [...new Set(programs.flatMap(program => program.rules.map(rule => rule.target)))].sort(), conditionalPairRules: behaviors.reduce((sum, value) => sum + value.conditionalPairs, 0)}, evaluation: {testSamples: test.length, noviceMse: round(noviceMse), programMse: round(programMse), improvementPercent: percent(noviceMse, programMse), managersImproved: perManager.filter(value => value < -1e-9).length, managersRegressed: perManager.filter(value => value > 1e-9).length, meanDiscoveryImprovementPercent: round(mean(evolutions.map(value => percent(value.discoveryMseBefore, value.discoveryMseAfter)))), meanValidationImprovementPercent: round(mean(evolutions.map(value => percent(value.validationMseBefore, value.validationMseAfter))))}, representation: {availableStructuralFeatures: [...structuralFeatures], structuralPredicates: structuralRows.length, managersUsingStructuralContext: new Set(structuralRows.map(value => value.managerId)).size, structuralFeaturesUsed: [...new Set(structuralRows.map(value => value.feature))].sort(), targetsUsingStructuralContext: [...new Set(structuralRows.map(value => value.target))].sort()}, domainReadiness: {battle: {status: "training-ready", samples: corpus.samples.length, reason: "paired position-value decisions provide local observational labels with public team structure"}, lineup: unavailable("existing causal studies are aggregate experiments, not per-decision local-value labels"), acquire: unavailable("no signed per-decision local-value adapter"), configure: unavailable("no signed per-decision local-value adapter"), research: unavailable("no signed per-decision local-value adapter")}, audit: {healthy: !issues.some(issue => issue.severity === "error"), issues}, artifacts};
    writeGzip(artifacts.corpus, corpus); writeGzip(artifacts.programs, programArchive); atomic(artifacts.summary, summary); atomic(artifacts.failures, {schemaVersion: 1, failures: []}); fs.writeFileSync(artifacts.report, markdown(summary), "utf8"); atomic(path.join(out, "build-state.json"), {schemaVersion: 1, status: "complete", phase: "complete", elapsedMs: summary.elapsedMs, peakRssBytes}); return summary;
  } catch (error) { const failure = {phase, message: error instanceof Error ? error.message : String(error)}; atomic(path.join(out, "failures.json"), {schemaVersion: 1, failures: [failure]}); atomic(path.join(out, "build-state.json"), {schemaVersion: 1, status: "failed", phase, peakRssBytes: Math.max(peakRssBytes, process.memoryUsage().rss), failure}); throw error; }
  finally { lock.release(); }
}

function buildCorpus(model: PositionValueModel, dossierPolicy: string): CorpusArchive {
  const files = findFiles(corpusRoot, "ai-decisions.json"), samples: ManagerProgramSampleV2[] = [], sourceFingerprints: Record<string, string> = {}; let forbidden = 0, accepted = 0;
  for (const file of files) {
    const relative = rel(corpusRoot, file), endFile = path.join(path.dirname(file), "end.json"), replayFile = path.join(path.dirname(file), "replay-input.json"); if (!fs.existsSync(endFile) || !fs.existsSync(replayFile)) continue;
    const bytes = fs.readFileSync(file), endBytes = fs.readFileSync(endFile), replayBytes = fs.readFileSync(replayFile), traces = JSON.parse(bytes.toString("utf8")) as AiDecisionTrace[], terminal = JSON.parse(endBytes.toString("utf8")) as {winner?: string};
    sourceFingerprints[relative] = digestBytes(Buffer.concat([bytes, endBytes, replayBytes]));
    if (traces.some(trace => /\b(?:terastallize|dynamax)\b/i.test(trace.selected))) { forbidden += 1; continue; }
    if (!traces.length || !["Team A", "Team B"].includes(String(terminal.winner))) continue; const structures = teamStructuresFromReplay(JSON.parse(replayBytes.toString("utf8"))); accepted += 1;
    const battleId = digest(relative), clusterId = clusterFromPath(relative), byTurn = new Map<number, Partial<Record<"p1" | "p2", AiDecisionTrace>>>();
    for (const trace of traces) if (trace.positionSnapshot && (trace.playerId === "p1" || trace.playerId === "p2")) { const pair = byTurn.get(trace.turn) ?? {}; if (!pair[trace.playerId]) pair[trace.playerId] = trace; byTurn.set(trace.turn, pair); }
    const turns = [...byTurn].filter((entry): entry is [number, {p1: AiDecisionTrace; p2: AiDecisionTrace}] => Boolean(entry[1].p1?.positionSnapshot && entry[1].p2?.positionSnapshot)).sort((a, b) => a[0] - b[0]);
    for (let index = 0; index < turns.length; index += 1) for (const playerId of ["p1", "p2"] as const) {
      const [turn, pair] = turns[index], trace = pair[playerId], opponentId = playerId === "p1" ? "p2" : "p1", opponent = pair[opponentId], current = predictPairedPositionValue(trace.positionSnapshot!, opponent.positionSnapshot!, model, structures[playerId], structures[opponentId]);
      let next = terminal.winner === (playerId === "p1" ? "Team A" : "Team B") ? 1 : 0;
      if (index + 1 < turns.length) { const nextPair = turns[index + 1][1], nextTrace = nextPair[playerId], nextOpponent = nextPair[opponentId]; next = predictPairedPositionValue(nextTrace.positionSnapshot!, nextOpponent.positionSnapshot!, model, structures[playerId], structures[opponentId]); }
      const featureValues = pairedPositionFeatures(trace.positionSnapshot!, opponent.positionSnapshot!, structures[playerId], structures[opponentId]), features = Object.fromEntries(POSITION_FEATURES.map((name, featureIndex) => [name, featureValues[featureIndex]]));
      const candidates = trace.whiteBoxShadow?.trace?.candidates?.filter(candidate => candidate.eligible) ?? [], selected = candidates.find(candidate => candidate.id === trace.selected), runner = [...candidates].filter(candidate => candidate.id !== trace.selected).sort((a, b) => (b.finalScore ?? -Infinity) - (a.finalScore ?? -Infinity))[0], margin = selected && runner ? Number(selected.finalScore) - Number(runner.finalScore) : 0;
      Object.assign(features, {positionValue: round(current * 2 - 1), turnProgress: round(Math.min(1, turn / 40)), scoreMargin: round(Math.tanh((Number.isFinite(margin) ? margin : 0) / 12)), candidateBreadth: round(Math.min(1, candidates.length / 12))});
      samples.push({id: digest([battleId, playerId, turn]).slice(0, 24), battleId, clusterId, domain: "battle", action: battleActionFamily(trace.selected), features, localValueDelta: round(clamp(next - current, -1, 1)), authority: "local-value-observational"});
    }
  }
  const signature = digest({language: MANAGER_PROGRAM_V2_LANGUAGE, model: model.sha256, dossierPolicy, sourceFingerprints}), actions = counts(samples.map(sample => sample.action)), splits = counts(samples.map(sample => split(sample.clusterId)));
  return {schemaVersion: 1, signature, modelSha256: model.sha256, dossierPolicy, sourceFingerprints, metrics: {sourceBattles: files.length, acceptedBattles: accepted, excludedForbiddenMechanicBattles: forbidden, samples: samples.length, clusters: new Set(samples.map(sample => sample.clusterId)).size, actions, splits}, samples};
}

function doctor(verifySources: boolean): {available: boolean; healthy: boolean; summary?: Summary; verifiedSources: number; issueCounts: Record<string, number>; issues: Array<{severity: "error" | "warning"; code: string; message: string}>} {
  const summary = optional<Summary>(path.join(out, "summary.json")), corpus = optionalGzip<CorpusArchive>(path.join(out, "corpus.json.gz")), archive = optionalGzip<ProgramArchive>(path.join(out, "programs.json.gz")), issues: Array<{severity: "error" | "warning"; code: string; message: string}> = [];
  if (!summary || !corpus || !archive) return {available: false, healthy: false, verifiedSources: 0, issueCounts: {"missing-artifacts": 1}, issues: [{severity: "error", code: "missing-artifacts", message: "Manager-program V2 artifacts are missing"}]};
  if (summary.inputSignature !== corpus.signature) issues.push({severity: "error", code: "summary-binding", message: "Summary and corpus signatures differ"});
  if (archive.schemaVersion !== 2 || archive.activationStatus !== "shadow-only" || archive.programs.length !== summary.population.managers) issues.push({severity: "error", code: "program-archive", message: "Program archive envelope is invalid"});
  if (summary.domainReadiness?.battle?.status !== "training-ready" || summary.domainReadiness.battle.samples !== corpus.samples.length) issues.push({severity: "error", code: "domain-readiness", message: "Manager-program domain readiness is missing or inconsistent with the corpus"});
  const structuralFeatures = POSITION_FEATURES.slice(LEGACY_POSITION_FEATURE_COUNT); if (corpus.samples.some(sample => structuralFeatures.some(feature => !Number.isFinite(sample.features[feature])))) issues.push({severity: "error", code: "structural-feature-coverage", message: "Manager corpus lacks current structural context features"});
  if (summary.representation?.availableStructuralFeatures?.length !== structuralFeatures.length) issues.push({severity: "error", code: "structural-summary", message: "Manager summary lacks the current structural representation audit"});
  for (const program of archive.programs) { try { validateManagerProgramV2(program); if (program.evidence.corpusSignature !== corpus.signature || program.evidence.positionModelSha256 !== corpus.modelSha256) throw new Error("evidence mismatch"); } catch (error) { issues.push({severity: "error", code: "program-validation", message: `${program.managerId}: ${error instanceof Error ? error.message : String(error)}`}); } }
  let verifiedSources = 0;
  if (verifySources) for (const [relative, expected] of Object.entries(corpus.sourceFingerprints)) { const file = path.join(corpusRoot, ...relative.split("/")), end = path.join(path.dirname(file), "end.json"), replay = path.join(path.dirname(file), "replay-input.json"); if (!fs.existsSync(file) || !fs.existsSync(end) || !fs.existsSync(replay)) issues.push({severity: "error", code: "missing-source", message: relative}); else if (digestBytes(Buffer.concat([fs.readFileSync(file), fs.readFileSync(end), fs.readFileSync(replay)])) !== expected) issues.push({severity: "error", code: "source-hash", message: relative}); verifiedSources += 1; }
  const currentModel = optional<PositionValueModel>(path.join(positionRoot, "model.json")), dossier = optional<any>(path.join(dossierRoot, "summary.json"));
  if (!currentModel || currentModel.sha256 !== corpus.modelSha256) issues.push({severity: "error", code: "position-model-stale", message: "Bound Stage-2 model is missing or changed"});
  if (!dossier || String(dossier.policyVersion ?? "unknown") !== corpus.dossierPolicy) issues.push({severity: "error", code: "dossier-policy-stale", message: "Bound Stage-1 dossier policy is missing or changed"});
  const allIssues = [...summary.audit.issues, ...issues], issueCounts = counts(allIssues.map(issue => issue.code));
  return {available: true, healthy: !allIssues.some(issue => issue.severity === "error"), summary, verifiedSources, issueCounts, issues: allIssues};
}

function status(): Record<string, unknown> { const summary = optional<Summary>(path.join(out, "summary.json")), state = optional<any>(path.join(out, "build-state.json")), issueCounts = counts((summary?.audit.issues ?? []).map(issue => issue.code)); return {available: Boolean(summary), build: state ?? null, issueCounts, summary: summary ? {generatedAt: summary.generatedAt, activationStatus: summary.activationStatus, corpus: summary.corpus, population: summary.population, evaluation: summary.evaluation, audit: summary.audit} : null}; }
function inspect(managerId: string): Record<string, unknown> { const archive = optionalGzip<ProgramArchive>(path.join(out, "programs.json.gz")); if (!archive) throw new Error("Manager-program V2 archive is missing"); const program = archive.programs.find(value => value.managerId === managerId); if (!program) throw new Error(`Unknown manager-program V2 manager: ${managerId}`); return {managerId, hash: managerProgramV2Hash(program), behavior: managerProgramV2Behavior(program), revision: program.revision, rules: program.rules, history: program.history, evidence: program.evidence, activationStatus: program.activationStatus}; }

function sampleMse(program: ManagerProgramV2 | undefined, samples: ManagerProgramSampleV2[]): number { return mean(samples.map(sample => ((program ? evaluateManagerProgramV2(program, sample.domain, sample.action, sample.features).value : 0) - sample.localValueDelta) ** 2)); }
function managerIds(file: string): string[] { const db = new DatabaseSync(file, {readOnly: true}); try { return (db.prepare("SELECT DISTINCT actor FROM decisions WHERE actor GLOB 'manager-[0-9][0-9]' ORDER BY actor").all() as Array<{actor: string}>).map(row => row.actor); } finally { db.close(); } }
function split(clusterId: string): "discovery" | "validation" | "test" { const value = Number.parseInt(digest(clusterId).slice(0, 8), 16) % 10; return value < 6 ? "discovery" : value < 8 ? "validation" : "test"; }
function clusterFromPath(relative: string): string { const normalized = relative.replace(/\\/g, "/"), marker = normalized.indexOf("/seed-"); return digest(marker >= 0 ? normalized.slice(0, marker) : path.dirname(normalized)); }
function verifyModel(model: PositionValueModel): void { const {sha256, ...core} = model; if (evidenceSha256(core) !== sha256) throw new Error("Position-value model signature mismatch"); }
function markdown(value: Summary): string { return `# Stage 3 Manager Program V2\n\n- Status: ${value.audit.healthy ? "healthy" : "blocked"}\n- Authority: shadow-only\n- Managers: ${value.population.managers}\n- Accepted rules / rejected proposals: ${value.population.acceptedRules} / ${value.population.rejectedProposals}\n- Distinct behaviors: ${value.population.uniqueBehaviorHashes}\n- Test MSE: ${value.evaluation.programMse} vs novice ${value.evaluation.noviceMse} (${value.evaluation.improvementPercent}% improvement)\n- Managers improved / regressed: ${value.evaluation.managersImproved} / ${value.evaluation.managersRegressed}\n- Structural features used: ${value.representation.structuralFeaturesUsed.length}/${value.representation.availableStructuralFeatures.length}; ${value.representation.structuralPredicates} predicates across ${value.representation.managersUsingStructuralContext} managers\n- Structural targets: ${value.representation.targetsUsingStructuralContext.join(", ") || "none"}\n- Corpus: ${value.corpus.samples} decisions from ${value.corpus.acceptedBattles} clean battles; ${value.corpus.excludedForbiddenMechanicBattles} battles excluded for Terastallization or Dynamax\n- Training-ready domains: ${Object.entries(value.domainReadiness).filter(([, row]) => row.status === "training-ready").map(([domain]) => domain).join(", ") || "none"}\n- Adapter-pending domains: ${Object.entries(value.domainReadiness).filter(([, row]) => row.status === "evidence-adapter-required").map(([domain]) => domain).join(", ") || "none"}\n\nRules are discovered from local evidence, validated before retention, and remain observational hypotheses. Structural context supplies questions rather than preferred directions. Declared language support is reported separately from domains that have genuine training evidence. They do not control formal league decisions.\n`; }
function findFiles(root: string, name: string): string[] { const result: string[] = []; if (!fs.existsSync(root)) return result; const stack = [root]; while (stack.length) { const directory = stack.pop()!; for (const entry of fs.readdirSync(directory, {withFileTypes: true})) { const full = path.join(directory, entry.name); if (entry.isDirectory()) stack.push(full); else if (entry.name === name) result.push(full); } } return result.sort(); }
function writeGzip(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, zlib.gzipSync(Buffer.from(JSON.stringify(value)), {level: 9})); fs.renameSync(temporary, file); }
function optionalGzip<T>(file: string): T | null { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")) as T; } catch { return null; } }
function atomic(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function optional<T>(file: string): T | null { try { return read<T>(file); } catch { return null; } }
function rel(root: string, file: string): string { return path.relative(root, file).replace(/\\/g, "/"); }
function digest(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function digestBytes(value: Buffer): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function hashUnit(value: string): number { return Number.parseInt(digest(value).slice(0, 12), 16) / 0xffffffffffff; }
function counts(values: string[]): Record<string, number> { const result: Record<string, number> = {}; for (const value of values.sort()) result[value] = (result[value] ?? 0) + 1; return result; }
function mean(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function percent(before: number, after: number): number { return round(before > 0 ? (before - after) / before * 100 : 0); }
function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function required(name: string): string { const value = option(name, ""); if (!value) throw new Error(`${name} is required`); return value; }
function integerOption(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`); return value; }
function print(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
