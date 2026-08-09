import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {spawn} from "node:child_process";
import {FORMAL_VALIDATION_VERSION, evaluateFormalValidation, formalMechanismKey, hasExactFormalValidationIntegrity, isValidFormalMaxTurnAdjudication, type FormalValidationCaseResult, type ValidationDirection} from "../ai/formalValidation";
import {battleActionFamily} from "../ai/battleActionFamily";
import {validateManagerProgramV2, type ManagerProgramRuleV2, type ManagerProgramV2} from "../ai/managerProgramV2";
import type {AutonomousResearchManagerState} from "../ai/autonomousResearch";
import {pairedPositionFeatures, POSITION_FEATURES, predictPairedPositionValue, type PositionValueModel} from "../ai/positionValue";
import {loadTeam} from "../showdown/team";
import {runBattle} from "../showdown/battle";
import {AI_VERSION, type AiDecisionTrace} from "../showdown/choice";
import {buildEvidenceEpoch, classifyEvidenceEpoch, LEAGUE_CONFIGURATION_POLICY_VERSION, sha256 as canonicalSha} from "../showdown/evidenceEpoch";
import {validateRegistryDirectory} from "../draft/registrySnapshot";
import {acquireNamedRunLock} from "../draft/runLock";
import {prepareStageGeneration, type ArchivedStageGeneration} from "../draft/stageGeneration";

const args = process.argv.slice(2), command = args[0] && !args[0].startsWith("--") ? args[0] : "status";
const out = path.resolve(option("--out", "output/tooling/formal-validation-stage5-delivery-v2"));
const stage4 = path.resolve(option("--autonomous-research", "output/tooling/autonomous-research-stage4-delivery-v2"));
const stage3 = path.resolve(option("--manager-programs", "output/tooling/manager-program-v2"));
const positionRoot = path.resolve(option("--position-value", "output/tooling/position-value-stage2"));
const indexFile = path.resolve(option("--index", "benchmarks/gen9expanded/index.json"));
const registryRoot = path.resolve(option("--registry", "data/draft"));
const environments = ["balanced", "pressure"] as const;
const targetCases = integerOption("--cases-per-domain", 24, 8, 80), minimumPerEnvironment = Math.ceil(targetCases / environments.length);

interface BenchmarkIndex {id: string; format: string; benchmarks: Array<{id: string; team: string; archetype?: string}>}
interface ProgramArchive {schemaVersion: 2; activationStatus: "shadow-only"; programs: ManagerProgramV2[]}
interface FrozenHypothesis {managerId: string; rule: ManagerProgramRuleV2; discovery: {supports: number; contradictions: number; cases: number}}
interface FrozenDomain {id: string; mechanismKey: string; target: string; expectedDirection: "better" | "worse"; hypotheses: FrozenHypothesis[]}
interface Freeze {
  schemaVersion: 1; version: typeof FORMAL_VALIDATION_VERSION; authority: "validation-only-no-automatic-activation"; frozenAt: string;
  inputs: Record<string, Fingerprint>; inputSignature: string; evidenceEpoch: {policySha256: string; registryHash: string; configurationPolicyVersion: string};
  environments: readonly string[]; domains: FrozenDomain[]; exclusions: {stage4SourceFingerprints: string[]}; benchmarkTeamSetSha256?: string;
  gate: {targetCases: number; minimumCasesPerEnvironment: number; minimumDecisiveCases: number; familywiseAlpha: number; sourceSeedLayers: number; sourceMaxTurns: number; maximumCasesPerBattle: 1; zeroUnresolvedTechnicalFailures: true}; sha256: string;
}
interface Fingerprint {file: string; sha256: string; bytes: number}
interface SourceRun {id: string; environment: string; pair: string; orientation: number; game: string; status: "complete" | "failed"; startedAt: string; completedAt: string; replaySha256?: string; decisionsSha256?: string; sourceFingerprint?: string; error?: string}
interface SourceManifest {schemaVersion: 1; version: typeof FORMAL_VALIDATION_VERSION; freezeSha256: string; environment: string; runs: SourceRun[]; complete: boolean; sha256: string}
interface FrontierAlternative {choice: string; action: string; rationalCost: number}
interface FrontierRow {id: string; environment: string; game: string; sourceRunId: string; decisionOrdinal: number; playerId: "p1" | "p2"; turn: number; phase: "early" | "mid" | "late"; selected: string; selectedAction: string; features: Record<string, number>; alternatives: FrontierAlternative[]; replaySha256: string; decisionsSha256: string; sourceFingerprint: string}
interface PlanCase {id: string; domainId: string; managerId: string; ruleId: string; environment: string; expectedDirection: "better" | "worse"; game: string; sourceRunId: string; decisionOrdinal: number; playerId: "p1" | "p2"; turn: number; phase: "early" | "mid" | "late"; incumbent: string; alternative: string; replaySha256: string; decisionsSha256: string; sourceFingerprint: string}
interface PlanItem extends PlanCase {fallbacks: PlanCase[]}
interface Plan {schemaVersion: 1; version: typeof FORMAL_VALIDATION_VERSION; authority: "validation-only-no-automatic-activation"; freezeSha256: string; frontierSha256: string; items: PlanItem[]; coverage: Record<string, Record<string, number>>; sha256: string}
interface CaseResult extends FormalValidationCaseResult {caseId: string; sourceFingerprint: string; technicalFailure?: string}
interface Results {schemaVersion: 1; version: typeof FORMAL_VALIDATION_VERSION; authority: "validation-only-no-automatic-activation"; planSha256: string; cases: CaseResult[]; technicalAttempts: number; unresolvedTechnicalFailures: number; fallbackSelections: number; sha256: string}

async function main(): Promise<void> {
  if (command === "cycle") print(await cycle());
  else if (command === "status") print(status());
  else if (command === "doctor") { const value = doctor(args.includes("--verify-sources")); print(value); if (!value.healthy) process.exitCode = 2; }
  else if (command === "inspect") print(inspect(required("--domain")));
  else throw new Error("Usage: npm run formal-validation -- <cycle|status|doctor|inspect> [options]");
}

async function cycle(): Promise<Record<string, unknown>> {
  fs.mkdirSync(out, {recursive: true}); const lock = acquireNamedRunLock(out, ".formal-validation.lock", {command: "cycle"});
  const started = Date.now(); let phase = "freeze", current: string | null = null, peakRssBytes = process.memoryUsage().rss, archivedGeneration: ArchivedStageGeneration | null = null;
  try {
    const freezeFile = path.join(out, "freeze.json"), existingFreeze = optional<Freeze>(freezeFile);
    const replaceStale = args.includes("--replace-stale"); archivedGeneration = prepareStageGeneration({rootDirectory: out, anchorName: "freeze.json", inputSignature: existingFreeze?.inputSignature ?? "unknown", retainedNames: [".formal-validation.lock"], replaceStale, validateAnchor: () => { if (!existingFreeze) throw new Error("Formal-validation freeze is unreadable"); validateFreeze(existingFreeze); validateFreezeBindings(existingFreeze); if (replaceStale && !Object.keys(existingFreeze.inputs).some(key => key.startsWith("benchmarkTeam:"))) throw new Error("Formal-validation freeze predates benchmark-team binding"); }});
    runState("running");
    const freeze = loadOrCreateFreeze();
    phase = "prospective-sources"; const manifests: SourceManifest[] = [];
    for (const environment of environments) manifests.push(freeze.domains.length ? await generateEnvironment(freeze, environment, value => { current = value; peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss); runState("running"); }) : writeEmptyEnvironment(freeze, environment));
    validateFreezeBindings(freeze);
    phase = "frontier"; current = null; const frontier = buildFrontier(freeze, manifests); peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    phase = "plan"; const plan = loadOrBuildPlan(freeze, frontier);
    phase = "execute"; const results = await executePlan(freeze, plan, integerOption("--workers", 4, 1, 12), value => { current = value; peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss); runState("running"); });
    phase = "compact"; current = null; const compaction = compactSources(manifests);
    phase = "audit"; const summary = buildSummary(freeze, manifests, frontier, plan, results, compaction, Date.now() - started, peakRssBytes);
    atomicJson(path.join(out, "summary.json"), summary); fs.writeFileSync(path.join(out, "report.md"), report(summary), "utf8");
    atomicJson(path.join(out, "token-budget.json"), {schemaVersion: 1, summaryBytes: Buffer.byteLength(JSON.stringify(summary)), estimatedSummaryTokens: Math.ceil(Buffer.byteLength(JSON.stringify(summary)) / 4), detailedCases: results.cases.length});
    if (summary.audit?.healthy !== true) throw new Error("Formal validation audit did not pass");
    runState("complete"); return summary;
  } catch (error) {
    const failure = {phase, current, message: error instanceof Error ? error.message : String(error)}; atomicJson(path.join(out, "failures.json"), {schemaVersion: 1, failures: [failure]}); runState("failed", failure); throw error;
  } finally { lock.release(); }
  function runState(status: "running" | "complete" | "failed", failure?: unknown): void { atomicJson(path.join(out, "run-state.json"), {schemaVersion: 1, version: FORMAL_VALIDATION_VERSION, status, phase: status === "complete" ? "complete" : phase, current, elapsedMs: Date.now() - started, peakRssBytes, ...(archivedGeneration ? {archivedGeneration} : {}), ...(failure ? {failure} : {})}); }
}

function loadOrCreateFreeze(): Freeze {
  const file = path.join(out, "freeze.json"), existing = optional<Freeze>(file); if (existing) { validateFreeze(existing); validateFreezeBindings(existing); return existing; }
  const stateFile = path.join(stage4, "manager-states.json.gz"), programFile = path.join(stage3, "programs.json.gz"), stage4SummaryFile = path.join(stage4, "summary.json"), modelFile = path.join(positionRoot, "model.json");
  const inputs = currentInputFingerprints();
  const states = readGzip<AutonomousResearchManagerState[]>(stateFile), programs = readGzip<ProgramArchive>(programFile).programs; programs.forEach(validateManagerProgramV2);
  const programByManager = new Map(programs.map(program => [program.managerId, program])), grouped = new Map<string, FrozenHypothesis[]>();
  for (const state of states) for (const ruleId of new Set(state.observations.map(value => value.ruleId))) {
    const observations = state.observations.filter(value => value.ruleId === ruleId), supports = observations.filter(value => value.supportsHypothesis).length, contradictions = observations.filter(value => value.direction !== "neutral" && !value.supportsHypothesis).length;
    if (!supports || contradictions) continue; const rule = programByManager.get(state.managerId)?.rules.find(value => value.id === ruleId); if (!rule) throw new Error(`Stage-4 rule is missing from Stage 3: ${state.managerId}/${ruleId}`);
    const mechanismKey = formalMechanismKey(rule);
    grouped.set(mechanismKey, [...(grouped.get(mechanismKey) ?? []), {managerId: state.managerId, rule: structuredClone(rule), discovery: {supports, contradictions, cases: observations.length}}]);
  }
  const domains: FrozenDomain[] = [...grouped].filter(([, hypotheses]) => new Set(hypotheses.map(value => value.managerId)).size >= 2).map(([mechanismKey, hypotheses]) => {
    const target = hypotheses[0].rule.target;
    const directions = new Set(hypotheses.map(value => value.rule.effect > 0 ? "worse" : "better")); if (directions.size !== 1) throw new Error(`Mixed expected directions in formal domain: ${target}`);
    return {id: `battle-${mechanismKey}`, mechanismKey, target, expectedDirection: [...directions][0] as "better" | "worse", hypotheses: hypotheses.sort((a, b) => a.managerId.localeCompare(b.managerId))};
  }).sort((a, b) => a.id.localeCompare(b.id));
  const registry = validateRegistryDirectory(registryRoot), epoch = buildEvidenceEpoch(AI_VERSION, read<BenchmarkIndex>(indexFile).format, {registryHash: registry.hash, configurationPolicyVersion: LEAGUE_CONFIGURATION_POLICY_VERSION});
  const discoverySources = new Set(states.flatMap(state => state.observations.map(value => value.sourceFingerprint)));
  const core = {schemaVersion: 1 as const, version: FORMAL_VALIDATION_VERSION as typeof FORMAL_VALIDATION_VERSION, authority: "validation-only-no-automatic-activation" as const, frozenAt: new Date().toISOString(), inputs, inputSignature: canonicalSha(inputs), evidenceEpoch: {policySha256: epoch.policySha256, registryHash: registry.hash, configurationPolicyVersion: LEAGUE_CONFIGURATION_POLICY_VERSION}, environments, domains, exclusions: {stage4SourceFingerprints: [...discoverySources].sort()}, benchmarkTeamSetSha256: benchmarkTeamSetSha256(inputs), gate: {targetCases, minimumCasesPerEnvironment: minimumPerEnvironment, minimumDecisiveCases: 6, familywiseAlpha: .1, sourceSeedLayers: 5, sourceMaxTurns: 120, maximumCasesPerBattle: 1 as const, zeroUnresolvedTechnicalFailures: true as const}};
  const freeze: Freeze = {...core, sha256: canonicalSha(core)}; validateFreezeBindings(freeze); atomicJson(file, freeze); return freeze;
}

async function generateEnvironment(freeze: Freeze, environment: typeof environments[number], progress: (id: string) => void): Promise<SourceManifest> {
  validateFreezeBindings(freeze);
  const directory = path.join(out, "sources", environment), manifestFile = path.join(directory, "manifest.json"); fs.mkdirSync(directory, {recursive: true});
  const prior = optional<SourceManifest>(manifestFile); if (prior?.complete) { validateSourceManifest(prior, freeze, environment, true); return prior; }
  const index = read<BenchmarkIndex>(indexFile), base = path.dirname(indexFile), teams = index.benchmarks.map(value => ({...value, packed: loadTeam(path.join(base, value.team)).packed}));
  const runs = prior?.runs ?? [], known = new Map(runs.map(value => [value.id, value])), jobs: Array<{id: string; left: number; right: number; orientation: number; seedLayer: number}> = [];
  for (let left = 0; left < teams.length; left += 1) for (let right = left + 1; right < teams.length; right += 1) for (let orientation = 0; orientation < 2; orientation += 1) for (let seedLayer = 1; seedLayer <= freeze.gate.sourceSeedLayers; seedLayer += 1) jobs.push({id: `${teams[left].id}--${teams[right].id}--o${orientation + 1}--s${seedLayer}`, left, right, orientation, seedLayer});
  let cursor = 0; const worker = async () => { while (cursor < jobs.length) {
    const job = jobs[cursor++]; if (known.get(job.id)?.status === "complete") continue; progress(`${environment}:${job.id}`); const startedAt = new Date().toISOString(), parent = path.join(directory, "battles", job.id), game = path.join(parent, "game-0001");
    try {
      if (known.get(job.id)?.status === "failed" && path.resolve(game).startsWith(`${path.resolve(directory)}${path.sep}`)) fs.rmSync(game, {recursive: true, force: true});
      const first = teams[job.orientation ? job.right : job.left], second = teams[job.orientation ? job.left : job.right], profileOffset = environment === "balanced" ? 0 : 2;
      const result = await runBattle({format: index.format, teamA: first.packed, teamB: second.packed, seed: `${freeze.sha256}:${environment}:${job.id}`, gameIndex: 0, outDir: parent, maxTurns: freeze.gate.sourceMaxTurns, idleTimeoutMs: 10000, wallClockTimeoutMs: 60000, ai: "search", openTeamSheets: true, traceAiDecisions: true, aiProfiles: {p1: {...profiles[(job.left + job.right + profileOffset + job.seedLayer) % profiles.length], id: `${profiles[(job.left + job.right + profileOffset + job.seedLayer) % profiles.length].id}-p1` as string} as any, p2: {...profiles[(job.left * 3 + job.right + profileOffset + job.seedLayer + 1) % profiles.length], id: `${profiles[(job.left * 3 + job.right + profileOffset + job.seedLayer + 1) % profiles.length].id}-p2` as string} as any}, evidenceContext: {registryHash: freeze.evidenceEpoch.registryHash, configurationPolicyVersion: freeze.evidenceEpoch.configurationPolicyVersion}});
      const validAdjudication = isValidFormalMaxTurnAdjudication(result);
      if (!result.ended || result.stalled && !validAdjudication || result.timeout && !validAdjudication || result.errors.length) throw new Error(`unclean battle ended=${result.ended} stalled=${result.stalled} timeout=${result.timeout} adjudicated=${validAdjudication} errors=${result.errors.length}`);
      const replay = path.join(game, "replay-input.json"), decisions = path.join(game, "ai-decisions.json"), replaySha256 = shaFile(replay), decisionsSha256 = shaFile(decisions), sourceFingerprint = digest([replaySha256, decisionsSha256]);
      known.set(job.id, {id: job.id, environment, pair: `${teams[job.left].id}--${teams[job.right].id}`, orientation: job.orientation, game, status: "complete", startedAt, completedAt: new Date().toISOString(), replaySha256, decisionsSha256, sourceFingerprint});
    } catch (error) { known.set(job.id, {id: job.id, environment, pair: job.id.replace(/--o\d$/, ""), orientation: job.orientation, game, status: "failed", startedAt, completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error)}); }
    writeSourceManifest(false);
  } };
  await Promise.all(Array.from({length: integerOption("--source-workers", 4, 1, 12)}, worker));
  const failed = [...known.values()].filter(value => value.status === "failed"); if (failed.length) throw new Error(`${environment} prospective source generation failed for ${failed.length} battle(s)`);
  return writeSourceManifest(true);
  function writeSourceManifest(complete: boolean): SourceManifest { const core = {schemaVersion: 1 as const, version: FORMAL_VALIDATION_VERSION as typeof FORMAL_VALIDATION_VERSION, freezeSha256: freeze.sha256, environment, runs: [...known.values()].sort((a, b) => a.id.localeCompare(b.id)), complete}; const manifest: SourceManifest = {...core, sha256: canonicalSha(core)}; atomicJson(manifestFile, manifest); return manifest; }
}

function writeEmptyEnvironment(freeze: Freeze, environment: typeof environments[number]): SourceManifest {
  const directory = path.join(out, "sources", environment), file = path.join(directory, "manifest.json"); fs.mkdirSync(directory, {recursive: true});
  const core = {schemaVersion: 1 as const, version: FORMAL_VALIDATION_VERSION as typeof FORMAL_VALIDATION_VERSION, freezeSha256: freeze.sha256, environment, runs: [] as SourceRun[], complete: true};
  const manifest: SourceManifest = {...core, sha256: canonicalSha(core)}; atomicJson(file, manifest); return manifest;
}

function buildFrontier(freeze: Freeze, manifests: SourceManifest[]): FrontierRow[] {
  const file = path.join(out, "frontier.json.gz"), prior = optionalGzip<{freezeSha256: string; rows: FrontierRow[]}>(file); if (prior?.freezeSha256 === freeze.sha256) return prior.rows;
  const model = read<PositionValueModel>(path.join(positionRoot, "model.json")), rows: FrontierRow[] = [];
  for (const manifest of manifests) for (const run of manifest.runs.filter(value => value.status === "complete")) {
    const traces = readEvidence<AiDecisionTrace[]>(resolveStageGame(run.game), "ai-decisions.json"), byTurn = new Map<number, Partial<Record<"p1" | "p2", AiDecisionTrace>>>();
    for (const trace of traces) if (trace.positionSnapshot && (trace.playerId === "p1" || trace.playerId === "p2")) { const pair = byTurn.get(trace.turn) ?? {}; if (!pair[trace.playerId]) pair[trace.playerId] = trace; byTurn.set(trace.turn, pair); }
    for (const trace of traces) {
      if (!trace.decisionOrdinal || !trace.positionSnapshot || (trace.playerId !== "p1" && trace.playerId !== "p2") || !trace.whiteBoxShadow?.trace) continue; const opponent = byTurn.get(trace.turn)?.[trace.playerId === "p1" ? "p2" : "p1"]; if (!opponent?.positionSnapshot) continue;
      const selected = trace.whiteBoxShadow.trace.candidates.find(value => value.id === trace.selected), selectedScore = Number(selected?.finalScore); if (!selected?.eligible || !Number.isFinite(selectedScore)) continue;
      const alternatives = trace.whiteBoxShadow.trace.candidates.filter(value => value.id !== trace.selected && value.eligible && value.reasonable && Number.isFinite(value.finalScore) && !/\b(?:terastallize|dynamax)\b/i.test(value.id)).map(value => ({choice: value.id, action: battleActionFamily(value.id), rationalCost: round(Math.max(0, selectedScore - Number(value.finalScore)))})).sort((a, b) => a.rationalCost - b.rationalCost || a.choice.localeCompare(b.choice)); if (!alternatives.length) continue;
      const featureValues = pairedPositionFeatures(trace.positionSnapshot, opponent.positionSnapshot), features = Object.fromEntries(POSITION_FEATURES.map((name, index) => [name, featureValues[index]]));
      const candidates = trace.whiteBoxShadow.trace.candidates.filter(value => value.eligible), runner = [...candidates].filter(value => value.id !== trace.selected).sort((a, b) => Number(b.finalScore ?? -Infinity) - Number(a.finalScore ?? -Infinity))[0], margin = runner ? selectedScore - Number(runner.finalScore) : 0;
      Object.assign(features, {positionValue: round(predictPairedPositionValue(trace.positionSnapshot, opponent.positionSnapshot, model) * 2 - 1), turnProgress: round(Math.min(1, trace.turn / 40)), scoreMargin: round(Math.tanh((Number.isFinite(margin) ? margin : 0) / 12)), candidateBreadth: round(Math.min(1, candidates.length / 12))});
      rows.push({id: `fvf-${digest([run.sourceFingerprint, trace.decisionOrdinal, trace.playerId]).slice(0, 20)}`, environment: run.environment, game: run.game, sourceRunId: run.id, decisionOrdinal: trace.decisionOrdinal, playerId: trace.playerId, turn: trace.turn, phase: trace.turn < 14 ? "early" : trace.turn < 30 ? "mid" : "late", selected: trace.selected, selectedAction: battleActionFamily(trace.selected), features, alternatives, replaySha256: run.replaySha256!, decisionsSha256: run.decisionsSha256!, sourceFingerprint: run.sourceFingerprint!});
    }
  }
  atomicGzip(file, {schemaVersion: 1, version: FORMAL_VALIDATION_VERSION, freezeSha256: freeze.sha256, rows}); return rows;
}

function loadOrBuildPlan(freeze: Freeze, frontier: FrontierRow[]): Plan {
  const file = path.join(out, "plan.json"), prior = optional<Plan>(file); if (prior) { validatePlan(prior, freeze, frontier); return prior; }
  const usedBattles = new Set<string>(), items: PlanItem[] = [], coverage: Record<string, Record<string, number>> = {};
  for (const domain of freeze.domains) {
    coverage[domain.id] = {};
    for (const environment of environments) {
      let progress = true, hypothesisIndex = 0; const reserved: PlanCase[] = [], reserveTarget = freeze.gate.minimumCasesPerEnvironment * 2;
      while (reserved.length < reserveTarget && progress) {
        progress = false;
        for (let attempt = 0; attempt < domain.hypotheses.length && reserved.length < reserveTarget; attempt += 1) {
          const hypothesis = domain.hypotheses[hypothesisIndex++ % domain.hypotheses.length], candidates = frontier.filter(row => row.environment === environment && row.selectedAction === domain.target && !usedBattles.has(row.sourceFingerprint) && hypothesis.rule.predicates.every(predicate => matches(predicate, row.features))).flatMap(row => row.alternatives.filter(alternative => alternative.action !== domain.target).map(alternative => ({row, alternative}))).sort((a, b) => a.alternative.rationalCost - b.alternative.rationalCost || hashUnit(`${freeze.sha256}:${domain.id}:${hypothesis.managerId}:${a.row.id}`) - hashUnit(`${freeze.sha256}:${domain.id}:${hypothesis.managerId}:${b.row.id}`));
          const candidate = candidates[0]; if (!candidate) continue; const identity = [domain.id, hypothesis.managerId, hypothesis.rule.id, candidate.row.sourceFingerprint, candidate.row.decisionOrdinal, candidate.row.playerId, candidate.alternative.choice];
          const item: PlanCase = {id: `fvc-${digest(identity).slice(0, 20)}`, domainId: domain.id, managerId: hypothesis.managerId, ruleId: hypothesis.rule.id, environment, expectedDirection: domain.expectedDirection, game: candidate.row.game, sourceRunId: candidate.row.sourceRunId, decisionOrdinal: candidate.row.decisionOrdinal, playerId: candidate.row.playerId, turn: candidate.row.turn, phase: candidate.row.phase, incumbent: candidate.row.selected, alternative: candidate.alternative.choice, replaySha256: candidate.row.replaySha256, decisionsSha256: candidate.row.decisionsSha256, sourceFingerprint: candidate.row.sourceFingerprint};
          reserved.push(item); usedBattles.add(candidate.row.sourceFingerprint); progress = true;
        }
      }
      if (reserved.length < reserveTarget) throw new Error(`Insufficient preregistered primary and fallback cases for ${domain.id}/${environment}: ${reserved.length}/${reserveTarget}`);
      const primaryCount = Math.min(freeze.gate.minimumCasesPerEnvironment, reserved.length);
      for (let index = 0; index < primaryCount; index += 1) items.push({...reserved[index], fallbacks: reserved[index + primaryCount] ? [reserved[index + primaryCount]] : []});
      coverage[domain.id][environment] = primaryCount;
    }
  }
  const core = {schemaVersion: 1 as const, version: FORMAL_VALIDATION_VERSION as typeof FORMAL_VALIDATION_VERSION, authority: "validation-only-no-automatic-activation" as const, freezeSha256: freeze.sha256, frontierSha256: canonicalSha(frontier), items: items.sort((a, b) => a.domainId.localeCompare(b.domainId) || a.environment.localeCompare(b.environment) || a.id.localeCompare(b.id)), coverage};
  const plan: Plan = {...core, sha256: canonicalSha(core)}; validatePlan(plan, freeze, frontier); atomicJson(file, plan); return plan;
}

async function executePlan(freeze: Freeze, plan: Plan, workers: number, progress: (id: string | null) => void): Promise<Results> {
  const file = path.join(out, "results.json.gz"), prior = optionalGzip<Results>(file); if (prior?.planSha256 === plan.sha256) { try { validateResults(prior, plan, freeze); return prior; } catch {} }
  const queue = [...plan.items], cases: CaseResult[] = []; let technicalAttempts = 0, unresolvedTechnicalFailures = 0, fallbackSelections = 0;
  const worker = async () => { while (queue.length) { const item = queue.shift()!; progress(item.id); const cacheFile = path.join(out, "case-cache", `${item.id}.json`), cached = optional<CaseResult>(cacheFile); if (cached) { try { validateCaseResult(cached, item, freeze); cases.push(cached); continue; } catch {} }
    let completed: CaseResult | null = null, lastError: unknown = null;
    for (const [candidateIndex, candidate] of [item as PlanCase, ...item.fallbacks].entries()) { try { completed = await executeCase(item.id, candidate, freeze); if (candidateIndex) fallbackSelections += 1; break; } catch (error) { technicalAttempts += 1; lastError = error; } }
    if (completed) { atomicJson(cacheFile, completed); cases.push(completed); }
    else { unresolvedTechnicalFailures += 1; cases.push({id: item.id, caseId: item.id, domainId: item.domainId, managerId: item.managerId, ruleId: item.ruleId, environment: item.environment, phase: item.phase, direction: "neutral", expectedDirection: item.expectedDirection, outcomeChanged: false, sourceVerified: false, prefixVerified: false, interventionVerified: false, sourceFingerprint: item.sourceFingerprint, technicalFailure: lastError instanceof Error ? lastError.message : String(lastError)}); }
  } };
  await Promise.all(Array.from({length: Math.min(workers, queue.length)}, worker)); progress(null); cases.sort((a, b) => a.id.localeCompare(b.id));
  const core = {schemaVersion: 1 as const, version: FORMAL_VALIDATION_VERSION as typeof FORMAL_VALIDATION_VERSION, authority: "validation-only-no-automatic-activation" as const, planSha256: plan.sha256, cases, technicalAttempts, unresolvedTechnicalFailures, fallbackSelections}; const results: Results = {...core, sha256: canonicalSha(core)}; validateResults(results, plan, freeze); atomicGzip(file, results); fs.rmSync(path.join(out, "work"), {recursive: true, force: true}); return results;
}

async function executeCase(attributionId: string, item: PlanCase, freeze: Freeze): Promise<CaseResult> {
  verifyPlanSource(item, freeze); const work = path.join(out, "work", `${item.id}-${process.pid}-${crypto.randomBytes(3).toString("hex")}`); fs.mkdirSync(path.dirname(work), {recursive: true});
  try { await child(process.execPath, [require.resolve("tsx/cli"), path.join(process.cwd(), "src/cli/counterfactualWhiteBoxBattle.ts"), "--source-game", resolveStageGame(item.game), "--out", work, "--decision-ordinal", String(item.decisionOrdinal), "--research-alternative", item.alternative]); const summary = read<any>(path.join(work, "counterfactual-summary.json")), own = item.playerId === "p1" ? "Team A" : "Team B", before = winnerScore(summary.incumbent?.winner, own), after = winnerScore(summary.whitebox?.winner, own), direction: ValidationDirection = after > before ? "better" : after < before ? "worse" : "neutral";
    const result: CaseResult = {id: attributionId, caseId: item.id, domainId: item.domainId, managerId: item.managerId, ruleId: item.ruleId, environment: item.environment, phase: item.phase, direction, expectedDirection: item.expectedDirection, outcomeChanged: Boolean(summary.outcomeChanged), sourceVerified: summary.sourceVerified === true, prefixVerified: summary.prefixVerified === true, interventionVerified: summary.intervention?.decisionOrdinal === item.decisionOrdinal && summary.intervention?.playerId === item.playerId && summary.intervention?.expectedIncumbent === item.incumbent && summary.intervention?.selected === item.alternative, sourceFingerprint: item.sourceFingerprint};
    if (!hasExactFormalValidationIntegrity(result)) throw new Error(`Formal counterfactual integrity failed: ${item.id}`); return result;
  } finally { fs.rmSync(work, {recursive: true, force: true}); }
}

function buildSummary(freeze: Freeze, manifests: SourceManifest[], frontier: FrontierRow[], plan: Plan, results: Results, compaction: {files: number; bytesBefore: number; bytesAfter: number}, elapsedMs: number, peakRssBytes: number): Record<string, any> {
  const domains = evaluateFormalValidation(freeze.domains.map(value => value.id), results.cases, freeze.environments, freeze.gate), eligible = domains.filter(value => value.disposition === "limited-canary-eligible"), issues: Array<{severity: "error" | "warning"; code: string; message: string}> = [];
  if (results.unresolvedTechnicalFailures) issues.push({severity: "error", code: "technical-failures", message: `${results.unresolvedTechnicalFailures} formal cases exhausted their preregistered sources`});
  const reservedSources = plan.items.flatMap(value => [value.sourceFingerprint, ...value.fallbacks.map(fallback => fallback.sourceFingerprint)]);
  if (new Set(reservedSources).size !== reservedSources.length) issues.push({severity: "error", code: "source-reuse", message: "A prospective battle was reserved for more than one intervention"});
  if (plan.items.flatMap(value => [value, ...value.fallbacks]).some(value => freeze.exclusions.stage4SourceFingerprints.includes(value.sourceFingerprint))) issues.push({severity: "error", code: "discovery-leakage", message: "A Stage-4 source entered formal validation"});
  if (manifests.some(value => !value.complete)) issues.push({severity: "error", code: "source-incomplete", message: "A prospective source environment is incomplete"});
  if (results.cases.some(result => !result.technicalFailure && !hasExactFormalValidationIntegrity(result))) issues.push({severity: "error", code: "counterfactual-integrity", message: "A completed formal case failed exact-counterfactual verification"});
  const core = {schemaVersion: 1, version: FORMAL_VALIDATION_VERSION, generatedAt: new Date().toISOString(), authority: "validation-only-no-automatic-activation", formalValidationCompleted: !issues.some(issue => issue.severity === "error"), automaticActivationAllowed: false, limitedCanaryEligibleDomains: eligible.map(value => value.domainId), inputSignature: freeze.inputSignature, freezeSha256: freeze.sha256, elapsedMs, peakRssBytes, sources: {environments: manifests.length, battles: manifests.reduce((sum, value) => sum + value.runs.length, 0), frontierDecisions: frontier.length, compaction: {...compaction, reclaimedBytes: compaction.bytesBefore - compaction.bytesAfter}}, experiments: {planned: plan.items.length, completed: results.cases.length - results.unresolvedTechnicalFailures, technicalAttempts: results.technicalAttempts, unresolvedTechnicalFailures: results.unresolvedTechnicalFailures, fallbackSelections: results.fallbackSelections, outcomeChanges: results.cases.filter(value => value.outcomeChanged).length, uniqueBattlesUsed: new Set(results.cases.map(value => value.sourceFingerprint)).size, reservedBattles: reservedSources.length}, domains, audit: {healthy: !issues.some(issue => issue.severity === "error"), issues}, artifacts: {freeze: path.join(out, "freeze.json"), plan: path.join(out, "plan.json"), results: path.join(out, "results.json.gz"), report: path.join(out, "report.md")}}; return {...core, sha256: canonicalSha(core)};
}

function doctor(verifySources: boolean): Record<string, any> {
  const freeze = optional<Freeze>(path.join(out, "freeze.json")), plan = optional<Plan>(path.join(out, "plan.json")), results = optionalGzip<Results>(path.join(out, "results.json.gz")), summary = optional<any>(path.join(out, "summary.json")), run = optional<any>(path.join(out, "run-state.json")), issues: Array<{severity: "error" | "warning"; code: string; message: string}> = [];
  if (!freeze || !plan || !results || !summary) return {available: false, healthy: false, verifiedSources: 0, issues: [{severity: "error", code: "missing-artifacts", message: "Stage-5 formal-validation artifacts are missing"}]};
  let manifests: SourceManifest[] = [];
  const archivedGeneration = isArchivedGeneration();
  try { const frontier = readGzip<{freezeSha256: string; rows: FrontierRow[]}>(path.join(out, "frontier.json.gz")); validateFreeze(freeze); validateFreezeBindings(freeze, archivedGeneration); if (frontier.freezeSha256 !== freeze.sha256) throw new Error("Formal frontier is not bound to the freeze"); validatePlan(plan, freeze, frontier.rows); validateResults(results, plan, freeze); manifests = freeze.environments.map(environment => read<SourceManifest>(path.join(out, "sources", environment, "manifest.json"))); manifests.forEach((manifest, index) => validateSourceManifest(manifest, freeze, freeze.environments[index], false)); } catch (error) { issues.push({severity: "error", code: "structure", message: error instanceof Error ? error.message : String(error)}); }
  const {sha256: resultsSha256, ...resultsCore} = results;
  if (results.planSha256 !== plan.sha256 || resultsSha256 !== canonicalSha(resultsCore) || summary.freezeSha256 !== freeze.sha256) issues.push({severity: "error", code: "artifact-binding", message: "Plan, result, or summary signature mismatch"});
  try { validateSummary(summary, freeze, manifests, plan, results); } catch (error) { issues.push({severity: "error", code: "summary-binding", message: error instanceof Error ? error.message : String(error)}); }
  if (run?.status !== "complete") issues.push({severity: "error", code: "run-incomplete", message: String(run?.status ?? "missing")});
  if (summary.automaticActivationAllowed !== false || summary.authority !== "validation-only-no-automatic-activation") issues.push({severity: "error", code: "authority", message: "Formal validation escaped review-only authority"});
  const benchmarkTeamsBound = Object.keys(freeze.inputs).some(key => key.startsWith("benchmarkTeam:"));
  if (!benchmarkTeamsBound) issues.push({severity: "warning", code: "legacy-benchmark-team-freeze", message: "Historical freeze predates per-team benchmark fingerprints; rebuild before granting canary authority"});
  if (archivedGeneration) issues.push({severity: "warning", code: "archived-input-bindings", message: "Archived generation verifies its signed protocol and retained sources without rebinding to current upstream files"});
  if (!benchmarkTeamsBound && summary.limitedCanaryEligibleDomains?.length) issues.push({severity: "error", code: "benchmark-team-authority", message: "A legacy freeze cannot grant limited-canary eligibility"});
  let verifiedSources = 0; if (verifySources) for (const manifest of manifests) for (const sourceRun of manifest.runs) { try { verifySourceRun(sourceRun, freeze); verifiedSources += 1; } catch (error) { issues.push({severity: "error", code: "source-drift", message: `${sourceRun.id}: ${error instanceof Error ? error.message : String(error)}`}); } }
  return {available: true, healthy: !issues.some(issue => issue.severity === "error"), verifiedSources, domains: summary.domains?.length ?? 0, experiments: summary.experiments, limitedCanaryEligibleDomains: summary.limitedCanaryEligibleDomains, issues};
}

function status(): Record<string, unknown> { const summary = optional<any>(path.join(out, "summary.json")), run = optional<any>(path.join(out, "run-state.json")); return {available: Boolean(summary), run, summary: summary ? {formalValidationCompleted: summary.formalValidationCompleted, automaticActivationAllowed: summary.automaticActivationAllowed, limitedCanaryEligibleDomains: summary.limitedCanaryEligibleDomains, sources: summary.sources, experiments: summary.experiments, domains: summary.domains, audit: summary.audit} : null}; }
function inspect(domainId: string): Record<string, unknown> { const freeze = read<Freeze>(path.join(out, "freeze.json")), results = readGzip<Results>(path.join(out, "results.json.gz")), summary = read<any>(path.join(out, "summary.json")); const domain = freeze.domains.find(value => value.id === domainId); if (!domain) throw new Error(`Unknown formal-validation domain: ${domainId}`); return {domain, result: summary.domains.find((value: any) => value.domainId === domainId), cases: results.cases.filter(value => value.domainId === domainId)}; }

function validateFreeze(value: Freeze): void {
  const {sha256, ...core} = value;
  if (value.schemaVersion !== 1 || value.version !== FORMAL_VALIDATION_VERSION || value.authority !== "validation-only-no-automatic-activation" || canonicalSha(core) !== sha256 || canonicalSha(value.inputs) !== value.inputSignature || !Number.isFinite(Date.parse(value.frozenAt)) || JSON.stringify(value.environments) !== JSON.stringify(environments) || new Set(value.domains.map(domain => domain.id)).size !== value.domains.length || !Number.isInteger(value.gate.targetCases) || value.gate.targetCases < 1 || !Number.isInteger(value.gate.minimumCasesPerEnvironment) || value.gate.minimumCasesPerEnvironment < 1 || value.gate.minimumCasesPerEnvironment * value.environments.length < value.gate.targetCases || !Number.isInteger(value.gate.sourceSeedLayers) || value.gate.sourceSeedLayers < 1 || value.gate.sourceSeedLayers > 8 || !Number.isInteger(value.gate.sourceMaxTurns) || value.gate.sourceMaxTurns < 20 || value.gate.sourceMaxTurns > 500 || value.gate.maximumCasesPerBattle !== 1 || value.gate.zeroUnresolvedTechnicalFailures !== true || new Set(value.exclusions.stage4SourceFingerprints).size !== value.exclusions.stage4SourceFingerprints.length) throw new Error("Invalid formal-validation freeze");
  for (const domain of value.domains) { if (domain.mechanismKey !== formalMechanismKey(domain.hypotheses[0].rule) || domain.id !== `battle-${domain.mechanismKey}` || !domain.hypotheses.length || new Set(domain.hypotheses.map(hypothesis => `${hypothesis.managerId}:${hypothesis.rule.id}`)).size !== domain.hypotheses.length || new Set(domain.hypotheses.map(hypothesis => hypothesis.managerId)).size < 2 || domain.hypotheses.some(hypothesis => hypothesis.rule.target !== domain.target || formalMechanismKey(hypothesis.rule) !== domain.mechanismKey || (hypothesis.rule.effect > 0 ? "worse" : "better") !== domain.expectedDirection)) throw new Error(`Invalid frozen domain: ${domain.id}`); }
}
function validateFreezeBindings(value: Freeze, archivedGeneration = false): void {
  if (archivedGeneration) { for (const [key, entry] of Object.entries(value.inputs)) if (!key || !path.isAbsolute(entry.file) || !/^[a-f0-9]{64}$/i.test(entry.sha256) || !Number.isInteger(entry.bytes) || entry.bytes < 0) throw new Error(`Invalid archived formal-validation input: ${key}`); const teamKeys = Object.keys(value.inputs).filter(key => key.startsWith("benchmarkTeam:")); if (teamKeys.length && value.benchmarkTeamSetSha256 !== benchmarkTeamSetSha256(value.inputs)) throw new Error("Archived formal-validation benchmark team set drifted"); return; }
  const expected = currentInputFingerprints(), baseKeys = ["stage4States", "stage4Summary", "programs", "positionModel", "benchmarkIndex"], actualKeys = Object.keys(value.inputs).sort(), expectedKeys = Object.keys(expected).sort(), hasTeamBindings = actualKeys.some(key => key.startsWith("benchmarkTeam:")), requiredKeys = hasTeamBindings ? expectedKeys : [...baseKeys].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(requiredKeys)) throw new Error(`Formal-validation input keys must be ${requiredKeys.join(",")}`);
  for (const key of requiredKeys) { const left = value.inputs[key], right = expected[key]; if (!left || !right || path.resolve(left.file) !== path.resolve(right.file) || left.sha256 !== right.sha256 || left.bytes !== right.bytes) throw new Error(`Formal-validation input drift: ${key}`); }
  if (hasTeamBindings && value.benchmarkTeamSetSha256 !== benchmarkTeamSetSha256(expected)) throw new Error("Formal-validation benchmark team set drifted");
  if (!hasTeamBindings && value.benchmarkTeamSetSha256) throw new Error("Legacy formal freeze cannot claim benchmark-team binding");
  const registryHash = validateRegistryDirectory(registryRoot).hash, format = read<BenchmarkIndex>(indexFile).format, epoch = buildEvidenceEpoch(AI_VERSION, format, {registryHash, configurationPolicyVersion: LEAGUE_CONFIGURATION_POLICY_VERSION});
  if (value.evidenceEpoch.registryHash !== registryHash || value.evidenceEpoch.configurationPolicyVersion !== LEAGUE_CONFIGURATION_POLICY_VERSION || value.evidenceEpoch.policySha256 !== epoch.policySha256) throw new Error("Formal-validation evidence context drifted");
}
function validatePlan(value: Plan, freeze: Freeze, frontier?: FrontierRow[]): void {
  const {sha256, ...core} = value, cases = value.items.flatMap(item => [item as PlanCase, ...item.fallbacks]), domainById = new Map(freeze.domains.map(domain => [domain.id, domain])), expectedCoverage: Record<string, Record<string, number>> = {};
  if (value.schemaVersion !== 1 || value.version !== FORMAL_VALIDATION_VERSION || value.authority !== "validation-only-no-automatic-activation" || value.freezeSha256 !== freeze.sha256 || canonicalSha(core) !== sha256 || frontier && value.frontierSha256 !== canonicalSha(frontier) || new Set(value.items.map(item => item.id)).size !== value.items.length || new Set(cases.map(item => item.id)).size !== cases.length || new Set(cases.map(item => item.sourceFingerprint)).size !== cases.length) throw new Error("Invalid formal-validation plan");
  for (const domain of freeze.domains) expectedCoverage[domain.id] = Object.fromEntries(freeze.environments.map(environment => [environment, 0]));
  for (const item of value.items) {
    if (item.fallbacks.length !== 1) throw new Error(`Formal plan item must have exactly one fallback: ${item.id}`);
    for (const candidate of [item as PlanCase, ...item.fallbacks]) validatePlanCase(candidate, freeze, domainById, frontier);
    expectedCoverage[item.domainId][item.environment] += 1;
  }
  if (JSON.stringify(value.coverage) !== JSON.stringify(expectedCoverage)) throw new Error("Formal plan coverage does not match its cases");
  for (const domain of freeze.domains) { const total = Object.values(expectedCoverage[domain.id]).reduce((sum, count) => sum + count, 0); if (total < freeze.gate.targetCases || freeze.environments.some(environment => expectedCoverage[domain.id][environment] < freeze.gate.minimumCasesPerEnvironment)) throw new Error(`Formal plan coverage target was not met: ${domain.id}`); }
}
function validatePlanCase(candidate: PlanCase, freeze: Freeze, domainById: Map<string, FrozenDomain>, frontier?: FrontierRow[]): void {
  const domain = domainById.get(candidate.domainId), hypothesis = domain?.hypotheses.find(value => value.managerId === candidate.managerId && value.rule.id === candidate.ruleId);
  if (!domain || !hypothesis || !freeze.environments.includes(candidate.environment) || candidate.expectedDirection !== domain.expectedDirection || freeze.exclusions.stage4SourceFingerprints.includes(candidate.sourceFingerprint) || !/^[a-f0-9]{64}$/i.test(candidate.sourceFingerprint)) throw new Error(`Plan case is outside the freeze: ${candidate.id}`);
  if (!frontier) return;
  const row = frontier.find(value => value.sourceFingerprint === candidate.sourceFingerprint && value.decisionOrdinal === candidate.decisionOrdinal && value.playerId === candidate.playerId), alternative = row?.alternatives.find(value => value.choice === candidate.alternative);
  if (!row || !alternative || row.environment !== candidate.environment || row.game !== candidate.game || row.sourceRunId !== candidate.sourceRunId || row.turn !== candidate.turn || row.phase !== candidate.phase || row.selected !== candidate.incumbent || row.selectedAction !== domain.target || row.replaySha256 !== candidate.replaySha256 || row.decisionsSha256 !== candidate.decisionsSha256 || !hypothesis.rule.predicates.every(predicate => matches(predicate, row.features)) || alternative.action === domain.target) throw new Error(`Plan case does not match the frozen frontier: ${candidate.id}`);
}
function validateResults(value: Results, plan: Plan, freeze: Freeze): void {
  const {sha256, ...core} = value, resultById = new Map<string, CaseResult>();
  if (value.schemaVersion !== 1 || value.version !== FORMAL_VALIDATION_VERSION || value.authority !== "validation-only-no-automatic-activation" || value.planSha256 !== plan.sha256 || sha256 !== canonicalSha(core) || value.cases.length !== plan.items.length || !Number.isInteger(value.technicalAttempts) || value.technicalAttempts < 0) throw new Error("Invalid formal-validation results");
  for (const result of value.cases) { if (resultById.has(result.id)) throw new Error(`Duplicate formal result: ${result.id}`); resultById.set(result.id, result); }
  for (const item of plan.items) { const result = resultById.get(item.id); if (!result) throw new Error(`Missing formal result: ${item.id}`); validateCaseResult(result, item, freeze); }
  const unresolved = value.cases.filter(result => Boolean(result.technicalFailure)).length, fallbackSelections = value.cases.filter(result => result.caseId !== result.id && !result.technicalFailure).length;
  if (value.unresolvedTechnicalFailures !== unresolved || value.fallbackSelections !== fallbackSelections || value.technicalAttempts < fallbackSelections + unresolved) throw new Error("Formal result counters do not match the retained cases");
}
function validateCaseResult(result: CaseResult, item: PlanItem, freeze: Freeze): void {
  const candidate = [item as PlanCase, ...item.fallbacks].find(value => value.id === result.caseId);
  if (!candidate || result.id !== item.id || result.domainId !== candidate.domainId || result.managerId !== candidate.managerId || result.ruleId !== candidate.ruleId || result.environment !== candidate.environment || result.phase !== candidate.phase || result.expectedDirection !== candidate.expectedDirection || result.sourceFingerprint !== candidate.sourceFingerprint || !["better", "neutral", "worse"].includes(result.direction) || typeof result.outcomeChanged !== "boolean" || typeof result.sourceVerified !== "boolean" || typeof result.prefixVerified !== "boolean" || typeof result.interventionVerified !== "boolean" || !freeze.domains.some(domain => domain.id === result.domainId)) throw new Error(`Formal result does not match its preregistered case: ${item.id}`);
  if (result.technicalFailure) { if (hasExactFormalValidationIntegrity(result) || result.sourceVerified || result.prefixVerified || result.interventionVerified || result.direction !== "neutral" || result.outcomeChanged) throw new Error(`Invalid technical failure result: ${item.id}`); }
  else if (!hasExactFormalValidationIntegrity(result)) throw new Error(`Completed formal result lacks exact-counterfactual integrity: ${item.id}`);
}
function validateSummary(summary: any, freeze: Freeze, manifests: SourceManifest[], plan: Plan, results: Results): void {
  if (summary.sha256 && !signedCoreHealthy(summary)) throw new Error("Formal summary signature mismatch");
  const domains = evaluateFormalValidation(freeze.domains.map(domain => domain.id), results.cases, freeze.environments, freeze.gate), eligible = domains.filter(domain => domain.disposition === "limited-canary-eligible").map(domain => domain.domainId), reserved = plan.items.flatMap(item => [item.sourceFingerprint, ...item.fallbacks.map(fallback => fallback.sourceFingerprint)]), expectedExperiments = {planned: plan.items.length, completed: results.cases.length - results.unresolvedTechnicalFailures, technicalAttempts: results.technicalAttempts, unresolvedTechnicalFailures: results.unresolvedTechnicalFailures, fallbackSelections: results.fallbackSelections, outcomeChanges: results.cases.filter(result => result.outcomeChanged).length, uniqueBattlesUsed: new Set(results.cases.map(result => result.sourceFingerprint)).size, reservedBattles: reserved.length};
  if (JSON.stringify(summary.domains) !== JSON.stringify(domains) || JSON.stringify(summary.limitedCanaryEligibleDomains) !== JSON.stringify(eligible) || JSON.stringify(summary.experiments) !== JSON.stringify(expectedExperiments) || summary.sources?.environments !== manifests.length || summary.sources?.battles !== manifests.reduce((sum, manifest) => sum + manifest.runs.length, 0) || summary.formalValidationCompleted !== (results.unresolvedTechnicalFailures === 0 && manifests.every(manifest => manifest.complete)) || summary.audit?.healthy !== summary.formalValidationCompleted) throw new Error("Formal summary does not reproduce from the signed plan and results");
}
function signedCoreHealthy(value: any): boolean { if (!value || typeof value !== "object" || !/^[a-f0-9]{64}$/i.test(String(value.sha256 ?? ""))) return false; const {sha256, ...core} = value; return canonicalSha(core) === sha256; }
function validateSourceManifest(value: SourceManifest, freeze: Freeze, environment: string, verify: boolean): void { const {sha256, ...core} = value; if (value.schemaVersion !== 1 || value.version !== FORMAL_VALIDATION_VERSION || value.freezeSha256 !== freeze.sha256 || value.environment !== environment || canonicalSha(core) !== sha256 || !value.complete || new Set(value.runs.map(run => run.id)).size !== value.runs.length) throw new Error(`Invalid formal source manifest: ${environment}`); if (verify) for (const run of value.runs) verifySourceRun(run, freeze); }
function verifySourceRun(run: SourceRun, freeze: Freeze): void { if (run.status !== "complete" || Date.parse(run.startedAt) < Date.parse(freeze.frozenAt) || !run.replaySha256 || !run.decisionsSha256 || !run.sourceFingerprint) throw new Error(`Invalid prospective source provenance: ${run.id}`); const game = resolveStageGame(run.game), replay = path.join(game, "replay-input.json"); if (shaFile(replay) !== run.replaySha256 || shaEvidence(game, "ai-decisions.json") !== run.decisionsSha256 || digest([run.replaySha256, run.decisionsSha256]) !== run.sourceFingerprint) throw new Error(`Prospective source drift: ${run.id}`); const epoch = read<any>(replay).input?.evidenceEpoch, expected = buildEvidenceEpoch(AI_VERSION, String(epoch?.content?.format ?? ""), {registryHash: freeze.evidenceEpoch.registryHash, configurationPolicyVersion: freeze.evidenceEpoch.configurationPolicyVersion}), classification = classifyEvidenceEpoch(epoch, expected); if (epoch?.content?.registryHash !== freeze.evidenceEpoch.registryHash || epoch?.content?.configurationPolicyVersion !== freeze.evidenceEpoch.configurationPolicyVersion || !classification.formalActivationAllowed || classification.compatibility !== "exact-compatible") throw new Error(`Prospective source lacks formal evidence context: ${run.id}`); }
function verifyPlanSource(item: PlanCase, freeze: Freeze): void { const game = resolveStageGame(item.game), replay = path.join(game, "replay-input.json"); if (shaFile(replay) !== item.replaySha256 || shaEvidence(game, "ai-decisions.json") !== item.decisionsSha256 || digest([item.replaySha256, item.decisionsSha256]) !== item.sourceFingerprint || freeze.exclusions.stage4SourceFingerprints.includes(item.sourceFingerprint)) throw new Error(`Frozen formal-validation source drift: ${item.id}`); }
function matches(predicate: {feature: string; operator: "gte" | "lt"; threshold: number}, features: Record<string, number>): boolean { const value = features[predicate.feature]; return Number.isFinite(value) && (predicate.operator === "gte" ? value >= predicate.threshold : value < predicate.threshold); }
function winnerScore(winner: unknown, own: string): number { return winner === own ? 1 : winner === null ? .5 : 0; }
function child(executable: string, childArgs: string[]): Promise<void> { return new Promise((resolve, reject) => { const childProcess = spawn(executable, childArgs, {cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"]}); let stderr = ""; childProcess.stderr.on("data", chunk => { stderr += String(chunk); if (stderr.length > 65536) stderr = stderr.slice(-65536); }); childProcess.on("error", reject); childProcess.on("close", code => code === 0 ? resolve() : reject(new Error(`Counterfactual child failed (${code}): ${stderr}`))); }); }
function report(value: any): string { return `# Stage 5 Formal Validation\n\n- Status: ${value.audit.healthy ? "healthy" : "blocked"}\n- Authority: validation only; no automatic activation\n- Prospective environments / battles: ${value.sources.environments} / ${value.sources.battles}\n- Exact experiments: ${value.experiments.completed}/${value.experiments.planned}\n- Outcome-changing branches: ${value.experiments.outcomeChanges}\n- Limited-canary eligible domains: ${value.limitedCanaryEligibleDomains.length ? value.limitedCanaryEligibleDomains.join(", ") : "none"}\n\n| Domain | Cases | Supports | Contradictions | Neutral | Adjusted p | Disposition |\n|---|---:|---:|---:|---:|---:|---|\n${value.domains.map((row: any) => `| ${row.domainId} | ${row.cases} | ${row.supports} | ${row.contradictions} | ${row.neutral} | ${row.holmAdjustedP} | ${row.disposition} |`).join("\n")}\n\nValidation used sources generated after the signed freeze in two declared environments. Passing the gate grants eligibility for a separately controlled canary; it never edits or activates a manager program automatically.\n`; }

function compactSources(manifests: SourceManifest[]): {files: number; bytesBefore: number; bytesAfter: number} {
  let files = 0, bytesBefore = 0, bytesAfter = 0;
  for (const run of manifests.flatMap(value => value.runs).filter(value => value.status === "complete")) for (const name of ["ai-decisions.json", "raw.log", "public.log"]) {
    const plain = path.join(resolveStageGame(run.game), name), compressed = `${plain}.gz`;
    if (fs.existsSync(plain)) { const bytes = fs.readFileSync(plain); bytesBefore += bytes.length; atomicBuffer(compressed, zlib.gzipSync(bytes, {level: 9})); fs.rmSync(plain); }
    else if (fs.existsSync(compressed)) bytesBefore += fs.statSync(compressed).size;
    if (fs.existsSync(compressed)) { files += 1; bytesAfter += fs.statSync(compressed).size; }
  }
  return {files, bytesBefore, bytesAfter};
}

const profiles = [{id: "formal-neutral"}, {id: "formal-pressure", aggression: .5, setupBias: .25, expectedWeight: .7, downsideWeight: .2, worstWeight: .1}, {id: "formal-risk-aware", aggression: -.2, recoveryBias: .35, expectedWeight: .4, downsideWeight: .35, worstWeight: .25}, {id: "formal-mobility", pivotBias: .5, switchBias: .25, statusBias: .15}];
function currentInputFingerprints(): Record<string, Fingerprint> {
  const index = read<BenchmarkIndex>(indexFile), base = path.dirname(indexFile), inputs: Record<string, Fingerprint> = {stage4States: fingerprint(path.join(stage4, "manager-states.json.gz")), stage4Summary: fingerprint(path.join(stage4, "summary.json")), programs: fingerprint(path.join(stage3, "programs.json.gz")), positionModel: fingerprint(path.join(positionRoot, "model.json")), benchmarkIndex: fingerprint(indexFile)};
  index.benchmarks.forEach((benchmark, position) => { inputs[`benchmarkTeam:${String(position + 1).padStart(3, "0")}:${benchmark.id}`] = fingerprint(path.join(base, benchmark.team)); }); return inputs;
}
function benchmarkTeamSetSha256(inputs: Record<string, Fingerprint>): string { return canonicalSha(Object.fromEntries(Object.entries(inputs).filter(([key]) => key.startsWith("benchmarkTeam:")).sort(([left], [right]) => left.localeCompare(right)))); }
function resolveStageGame(value: string): string { if (!path.isAbsolute(value)) return path.resolve(out, ...value.split(/[\\/]+/)); const archive = optional<{sourceRoot?: string}>(path.join(out, "archive-manifest.json")), sourceRoot = archive?.sourceRoot ? path.resolve(archive.sourceRoot) : null, game = path.resolve(value); if (sourceRoot && (game === sourceRoot || game.startsWith(`${sourceRoot}${path.sep}`))) return path.join(out, path.relative(sourceRoot, game)); return game; }
function isArchivedGeneration(): boolean { const manifest = optional<any>(path.join(out, "archive-manifest.json")); return manifest?.schemaVersion === 1 && manifest?.state === "complete" && path.resolve(manifest?.sourceRoot ?? "") !== path.resolve(out); }
function fingerprint(file: string): Fingerprint { const stat = fs.statSync(file); return {file: path.resolve(file), sha256: shaFile(file), bytes: stat.size}; }
function shaFile(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function digest(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function hashUnit(value: string): number { return Number.parseInt(digest(value).slice(0, 12), 16) / 0xffffffffffff; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function atomicJson(file: string, value: unknown): void { atomicBuffer(file, Buffer.from(`${JSON.stringify(value, null, 2)}\n`)); }
function atomicGzip(file: string, value: unknown): void { atomicBuffer(file, zlib.gzipSync(Buffer.from(JSON.stringify(value)), {level: 9})); }
function atomicBuffer(file: string, value: Buffer): void { fs.mkdirSync(path.dirname(file), {recursive: true}); const temporary = `${file}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`; fs.writeFileSync(temporary, value); fs.renameSync(temporary, file); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function readEvidence<T>(directory: string, name: string): T { const bytes = evidenceBytes(directory, name); return JSON.parse(bytes.toString("utf8")) as T; }
function evidenceBytes(directory: string, name: string): Buffer { const plain = path.join(directory, name), compressed = `${plain}.gz`; if (fs.existsSync(plain)) return fs.readFileSync(plain); if (fs.existsSync(compressed)) return zlib.gunzipSync(fs.readFileSync(compressed)); throw new Error(`Missing evidence: ${plain}[.gz]`); }
function shaEvidence(directory: string, name: string): string { return crypto.createHash("sha256").update(evidenceBytes(directory, name)).digest("hex"); }
function readGzip<T>(file: string): T { return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")) as T; }
function optional<T>(file: string): T | null { try { return read<T>(file); } catch { return null; } }
function optionalGzip<T>(file: string): T | null { try { return readGzip<T>(file); } catch { return null; } }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function required(name: string): string { const value = option(name, ""); if (!value) throw new Error(`${name} is required`); return value; }
function integerOption(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`); return value; }
function print(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }

main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
