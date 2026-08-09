import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {spawn} from "node:child_process";
import {AUTONOMOUS_RESEARCH_VERSION, buildAutonomousResearchAgenda, createAutonomousResearchState, reviewAutonomousResearchRound, summarizeAutonomousResearch, validateAutonomousResearchAgenda, validateAutonomousResearchState, type AutonomousResearchAgenda, type AutonomousResearchDirection, type AutonomousResearchManagerState, type AutonomousResearchQuestion, type AutonomousResearchResult} from "../ai/autonomousResearch";
import {battleActionFamily} from "../ai/battleActionFamily";
import {validateManagerProgramV2, type ManagerProgramSampleV2, type ManagerProgramV2} from "../ai/managerProgramV2";
import {loadFormalValidationPortfolio, verifyFormalValidationPortfolio, type FormalValidationPortfolio} from "../ai/formalValidationPortfolio";
import {AI_VERSION, type AiDecisionTrace} from "../showdown/choice";
import {acquireNamedRunLock} from "../draft/runLock";
import {prepareStageGeneration, type ArchivedStageGeneration} from "../draft/stageGeneration";

const args = process.argv.slice(2), command = args[0] && !args[0].startsWith("--") ? args[0] : "status";
const out = path.resolve(option("--out", "output/tooling/autonomous-research-stage4-delivery-v2"));
const stage3 = path.resolve(option("--manager-programs", "output/tooling/manager-program-v2"));
const sourceRoot = path.resolve(option("--source-corpus", "output/tooling/position-value-corpus-v1"));
const formalHistory = path.resolve(option("--formal-history", "output/tooling/formal-validation-stage5-delivery-v2"));

interface ProgramArchive {schemaVersion: 2; activationStatus: "shadow-only"; programs: ManagerProgramV2[]}
interface CorpusArchive {schemaVersion: 1; signature: string; samples: ManagerProgramSampleV2[]}
interface FrontierAlternative {choice: string; action: string; finalScore: number; rationalCost: number}
interface FrontierRow {id: string; game: string; relative: string; decisionOrdinal: number; playerId: "p1" | "p2"; turn: number; selected: string; selectedAction: string; features: Record<string, number>; alternatives: FrontierAlternative[]; replaySha256: string; decisionsSha256: string; sourceFingerprint: string}
interface FrontierArchive {schemaVersion: 1; version: typeof AUTONOMOUS_RESEARCH_VERSION; inputSignature: string; rows: FrontierRow[]; metrics: {battles: number; decisions: number; executableDecisions: number; alternatives: number}}
interface PlanCase {caseId: string; game: string; decisionOrdinal: number; playerId: "p1" | "p2"; turn: number; incumbent: string; alternative: string; rationalCost: number; replaySha256: string; decisionsSha256: string; sourceFingerprint: string}
interface PlanFallback extends PlanCase {question: AutonomousResearchQuestion}
interface PlanItem extends PlanCase {id: string; round: number; managerId: string; question: AutonomousResearchQuestion; fallbacks: PlanFallback[]}
interface RoundPlan {schemaVersion: 1; version: typeof AUTONOMOUS_RESEARCH_VERSION; activationStatus: "shadow-only"; round: number; inputSignature: string; agendas: AutonomousResearchAgenda[]; items: PlanItem[]; unassignedManagers: string[]}
interface RoundResults {schemaVersion: 1; version: typeof AUTONOMOUS_RESEARCH_VERSION; activationStatus: "shadow-only"; round: number; planSha256: string; results: AutonomousResearchResult[]; technicalFailures: Array<{managerId: string; caseId: string; message: string}>; metrics: Record<string, number>}
interface Fingerprint {file: string; sha256: string; bytes: number}
interface Manifest {schemaVersion: 1; version: typeof AUTONOMOUS_RESEARCH_VERSION; activationStatus: "shadow-only"; inputSignature: string; inputs: Record<string, Fingerprint>; rounds: Array<{round: number; plan: string; planSha256: string; results: string; resultsSha256: string; completedAt: string}>}

async function main(): Promise<void> {
  if (command === "cycle") print(await cycle());
  else if (command === "status") print(status());
  else if (command === "doctor") { const result = doctor(args.includes("--verify-sources")); print(result); if (!result.healthy) process.exitCode = 2; }
  else if (command === "inspect") print(inspect(required("--manager")));
  else throw new Error("Usage: npm run autonomous-research -- <cycle|status|doctor|inspect> [options]");
}

async function cycle(): Promise<Record<string, unknown>> {
  const started = Date.now(), targetRounds = integerOption("--rounds", 2, 1, 12), workers = integerOption("--workers", 4, 1, 12); fs.mkdirSync(out, {recursive: true});
  const lock = acquireNamedRunLock(out, ".autonomous-research.lock", {command: "cycle", targetRounds}); let phase = "inputs", current: string | null = null, peakRssBytes = process.memoryUsage().rss, archivedGeneration: ArchivedStageGeneration | null = null;
  try {
    const programFile = path.join(stage3, "programs.json.gz"), corpusFile = path.join(stage3, "corpus.json.gz"), feedbackFile = path.join(out, "formal-feedback-input.json"), feedbackCandidate = loadFormalValidationPortfolio(formalHistory), manifestFile = path.join(out, "manifest.json"); let existingManifest = optional<Manifest>(manifestFile);
    const inputs = currentInputFingerprints(feedbackCandidate), inputSignature = digest(inputs);
    archivedGeneration = prepareStageGeneration({rootDirectory: out, anchorName: "manifest.json", inputSignature: existingManifest?.inputSignature ?? inputSignature, retainedNames: [".autonomous-research.lock"], replaceStale: args.includes("--replace-stale"), validateAnchor: () => { if (!existingManifest) throw new Error("Autonomous research manifest is unreadable"); validateManifestEnvelope(existingManifest); validateInputBindings(existingManifest.inputs, inputs); if (existingManifest.inputSignature !== inputSignature) throw new Error("Autonomous research inputs changed"); }});
    if (archivedGeneration) existingManifest = null;
    if (!existingManifest) atomicJson(feedbackFile, feedbackCandidate);
    const formalFeedback = read<FormalValidationPortfolio>(feedbackFile); verifyFormalValidationPortfolio(formalFeedback);
    const programs = readGzip<ProgramArchive>(programFile).programs; programs.forEach(validateManagerProgramV2);
    const corpus = readGzip<CorpusArchive>(corpusFile), frontier = loadOrBuildFrontier(corpus, inputSignature); peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    let states = fs.existsSync(path.join(out, "manager-states.json.gz")) ? readGzip<AutonomousResearchManagerState[]>(path.join(out, "manager-states.json.gz")) : programs.map(program => createAutonomousResearchState(program.managerId)); states.forEach(validateAutonomousResearchState);
    const stateByManager = new Map(states.map(state => [state.managerId, state])), programByManager = new Map(programs.map(program => [program.managerId, program]));
    if (states.length !== programs.length || states.some(state => !programByManager.has(state.managerId))) throw new Error("Autonomous research manager identity mismatch");
    const manifest: Manifest = existingManifest ?? {schemaVersion: 1, version: AUTONOMOUS_RESEARCH_VERSION, activationStatus: "shadow-only", inputSignature, inputs, rounds: []};
    const completed = Math.min(...states.map(state => state.completedRounds)); if (states.some(state => state.completedRounds !== completed)) throw new Error("Autonomous research states are on different rounds");
    const priorSummary = optional<Record<string, unknown>>(path.join(out, "summary.json"));
    if (existingManifest && priorSummary && completed >= targetRounds && doctor(false).healthy) { atomicJson(path.join(out, "run-state.json"), {schemaVersion: 1, status: "complete", phase: "cache-hit", elapsedMs: Date.now() - started, peakRssBytes}); return priorSummary; }
    atomicJson(path.join(out, "run-state.json"), {schemaVersion: 1, status: "running", phase, current, startedAt: new Date(started).toISOString(), peakRssBytes, ...(archivedGeneration ? {archivedGeneration} : {})});
    for (let round = completed + 1; round <= targetRounds; round += 1) {
      phase = `plan:${round}`; current = null;
      const technicalBlacklist = new Set(manifest.rounds.flatMap(entry => readGzip<RoundResults>(path.join(out, entry.results)).technicalFailures.map(value => value.caseId))), plan = buildPlan(round, programs, states, frontier, inputSignature, technicalBlacklist, formalFeedback), planFile = path.join(out, `round-${pad(round)}-plan.json.gz`), planBytes = gzip(plan), planSha256 = sha(planBytes); atomicBuffer(planFile, planBytes);
      phase = `execute:${round}`; const results = await runPlan(plan, workers, value => { current = value; peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss); atomicJson(path.join(out, "run-state.json"), {schemaVersion: 1, status: "running", phase, current, peakRssBytes}); });
      phase = `review:${round}`; current = null; const resultByManager = new Map(results.results.map(result => [result.managerId, result]));
      states = states.map(state => reviewAutonomousResearchRound(state, plan.agendas.find(agenda => agenda.managerId === state.managerId)!, resultByManager.get(state.managerId))); states.forEach(validateAutonomousResearchState);
      const resultFile = path.join(out, `round-${pad(round)}-results.json.gz`), resultBytes = gzip(results), resultsSha256 = sha(resultBytes); atomicBuffer(resultFile, resultBytes); atomicBuffer(path.join(out, "manager-states.json.gz"), gzip(states));
      manifest.rounds.push({round, plan: rel(out, planFile), planSha256, results: rel(out, resultFile), resultsSha256, completedAt: new Date().toISOString()}); atomicJson(path.join(out, "manifest.json"), manifest);
    }
    phase = "audit"; const summary = buildSummary(states, manifest, frontier, Date.now() - started, peakRssBytes); atomicJson(path.join(out, "summary.json"), summary); fs.writeFileSync(path.join(out, "report.md"), markdown(summary), "utf8"); atomicJson(path.join(out, "token-budget.json"), {schemaVersion: 1, summaryBytes: Buffer.byteLength(JSON.stringify(summary)), estimatedSummaryTokens: Math.ceil(Buffer.byteLength(JSON.stringify(summary)) / 4), detailedExperiments: states.reduce((sum, state) => sum + state.observations.length, 0)}); if ((summary as any).audit?.healthy !== true) throw new Error("Autonomous research audit did not pass"); atomicJson(path.join(out, "failures.json"), {schemaVersion: 1, failures: []}); atomicJson(path.join(out, "run-state.json"), {schemaVersion: 1, status: "complete", phase: "complete", elapsedMs: Date.now() - started, peakRssBytes}); return summary;
  } catch (error) { const failure = {phase, current, message: error instanceof Error ? error.message : String(error)}; atomicJson(path.join(out, "failures.json"), {schemaVersion: 1, failures: [failure]}); atomicJson(path.join(out, "run-state.json"), {schemaVersion: 1, status: "failed", phase, current, peakRssBytes: Math.max(peakRssBytes, process.memoryUsage().rss), failure}); throw error; }
  finally { lock.release(); }
}

function buildPlan(round: number, programs: ManagerProgramV2[], states: AutonomousResearchManagerState[], frontier: FrontierArchive, inputSignature: string, technicalBlacklist = new Set<string>(), formalFeedback?: FormalValidationPortfolio): RoundPlan {
  const globallyUsed = new Set([...states.flatMap(state => state.usedCaseIds), ...technicalBlacklist]), rowsByRule = new Map<string, FrontierRow[]>(), agendas: AutonomousResearchAgenda[] = [];
  for (const program of programs) {
    const state = states.find(value => value.managerId === program.managerId)!; const feasible: Record<string, number> = {};
    for (const rule of program.rules) { const rows = frontier.rows.filter(row => row.selectedAction === rule.target && rule.predicates.every(predicate => matches(predicate, row.features)) && row.alternatives.some(alternative => alternative.action !== rule.target && !globallyUsed.has(caseId(row, alternative.choice)))); rowsByRule.set(`${program.managerId}:${rule.id}`, rows); feasible[rule.id] = rows.length; }
    agendas.push(buildAutonomousResearchAgenda({program, state, round, feasibleCases: feasible, seed: inputSignature, formalFeedback: formalFeedback?.feedback}));
  }
  const items: PlanItem[] = [], assignedCases = new Set<string>(), ordered = [...agendas].sort((left, right) => (left.selected?.feasibleCases ?? Infinity) - (right.selected?.feasibleCases ?? Infinity) || hashUnit(`${inputSignature}:${round}:${left.managerId}`) - hashUnit(`${inputSignature}:${round}:${right.managerId}`));
  for (const agenda of ordered) {
    const reserved: PlanFallback[] = [];
    for (const question of agenda.ranked) {
      const candidates = (rowsByRule.get(`${agenda.managerId}:${question.ruleId}`) ?? []).flatMap(row => row.alternatives.filter(alternative => alternative.action !== question.target).map(alternative => ({row, alternative}))).filter(value => !globallyUsed.has(caseId(value.row, value.alternative.choice)) && !assignedCases.has(caseId(value.row, value.alternative.choice)) && !reserved.some(entry => entry.caseId === caseId(value.row, value.alternative.choice))).sort((left, right) => left.alternative.rationalCost - right.alternative.rationalCost || hashUnit(`${agenda.managerId}:${round}:${left.row.id}:${left.alternative.choice}`) - hashUnit(`${agenda.managerId}:${round}:${right.row.id}:${right.alternative.choice}`));
      reserved.push(...candidates.slice(0, 6).map(value => ({question, ...planCase(value.row, value.alternative)}))); if (reserved.length >= 24) break;
    }
    if (!reserved.length) continue; for (const value of reserved) assignedCases.add(value.caseId); globallyUsed.add(reserved[0].caseId); const primary = reserved[0];
    items.push({id: `are-${digest([agenda.managerId, round, primary.caseId]).slice(0, 20)}`, round, managerId: agenda.managerId, question: primary.question, caseId: primary.caseId, game: primary.game, decisionOrdinal: primary.decisionOrdinal, playerId: primary.playerId, turn: primary.turn, incumbent: primary.incumbent, alternative: primary.alternative, rationalCost: primary.rationalCost, replaySha256: primary.replaySha256, decisionsSha256: primary.decisionsSha256, sourceFingerprint: primary.sourceFingerprint, fallbacks: reserved.slice(1)});
  }
  return {schemaVersion: 1, version: AUTONOMOUS_RESEARCH_VERSION, activationStatus: "shadow-only", round, inputSignature, agendas: agendas.sort((a, b) => a.managerId.localeCompare(b.managerId)), items: items.sort((a, b) => a.managerId.localeCompare(b.managerId)), unassignedManagers: programs.map(program => program.managerId).filter(managerId => !items.some(item => item.managerId === managerId))};
}

async function runPlan(plan: RoundPlan, workers: number, progress: (id: string | null) => void): Promise<RoundResults> {
  plan.agendas.forEach(validateAutonomousResearchAgenda); const results: AutonomousResearchResult[] = [], technicalFailures: RoundResults["technicalFailures"] = [], queue = [...plan.items], failures: Error[] = [];
  const worker = async () => { while (queue.length && !failures.length) { const item = queue.shift()!; try { progress(item.id); const completed = await runItem(item); results.push(completed.result); technicalFailures.push(...completed.technicalFailures); } catch (error) { failures.push(error instanceof Error ? error : new Error(String(error))); } } };
  await Promise.all(Array.from({length: Math.min(workers, queue.length)}, worker)); progress(null); if (failures.length) throw failures[0];
  results.sort((a, b) => a.managerId.localeCompare(b.managerId)); const metrics = {experiments: results.length, better: results.filter(value => value.direction === "better").length, neutral: results.filter(value => value.direction === "neutral").length, worse: results.filter(value => value.direction === "worse").length, supports: results.filter(value => value.direction === value.expectedDirection).length, contradictions: results.filter(value => value.direction !== "neutral" && value.direction !== value.expectedDirection).length, outcomeChanges: results.filter(value => value.outcomeChanged).length};
  return {schemaVersion: 1, version: AUTONOMOUS_RESEARCH_VERSION, activationStatus: "shadow-only", round: plan.round, planSha256: sha(gzip(plan)), results, technicalFailures, metrics: {...metrics, technicalFailures: technicalFailures.length}};
}

async function runItem(item: PlanItem): Promise<{result: AutonomousResearchResult; technicalFailures: RoundResults["technicalFailures"]}> {
  const technicalFailures: RoundResults["technicalFailures"] = [], candidates: PlanItem[] = [item, ...item.fallbacks.map((fallback, index) => ({...item, ...fallback, id: `${item.id}-fallback-${index + 1}`, fallbacks: []}))];
  for (const candidate of candidates) { try { return {result: await runCase(candidate), technicalFailures}; } catch (error) { technicalFailures.push({managerId: item.managerId, caseId: candidate.caseId, message: error instanceof Error ? error.message : String(error)}); } }
  throw new Error(`All preregistered autonomous research cases failed technically for ${item.managerId}: ${technicalFailures.map(value => value.caseId).join(",")}`);
}

async function runCase(item: PlanItem): Promise<AutonomousResearchResult> {
  verifyItemSource(item); const cacheId = digest([item.managerId, item.question.id, item.caseId]).slice(0, 24), cacheDirectory = path.join(out, "case-cache"), cacheFile = path.join(cacheDirectory, `${cacheId}.json`), cached = optional<AutonomousResearchResult>(cacheFile); if (cached) { validateResult(cached, item); return cached; }
  const work = path.join(out, "work", `round-${pad(item.round)}`, `${item.id}-${process.pid}-${crypto.randomBytes(4).toString("hex")}`); fs.mkdirSync(path.dirname(work), {recursive: true});
  try {
    await child(process.execPath, [require.resolve("tsx/cli"), path.join(process.cwd(), "src/cli/counterfactualWhiteBoxBattle.ts"), "--source-game", item.game, "--out", work, "--decision-ordinal", String(item.decisionOrdinal), "--research-alternative", item.alternative]);
    const summary = read<any>(path.join(work, "counterfactual-summary.json")), own = item.playerId === "p1" ? "Team A" : "Team B", before = score(summary.incumbent?.winner, own), after = score(summary.whitebox?.winner, own), direction: AutonomousResearchDirection = after > before ? "better" : after < before ? "worse" : "neutral";
    const result: AutonomousResearchResult = {questionId: item.question.id, managerId: item.managerId, ruleId: item.question.ruleId, round: item.round, caseId: item.caseId, direction, expectedDirection: item.question.expectedInterventionDirection, outcomeChanged: Boolean(summary.outcomeChanged), sourceVerified: summary.sourceVerified === true, prefixVerified: summary.prefixVerified === true, interventionVerified: summary.intervention?.decisionOrdinal === item.decisionOrdinal && summary.intervention?.playerId === item.playerId && summary.intervention?.turn === item.turn && summary.intervention?.expectedIncumbent === item.incumbent && summary.intervention?.selected === item.alternative && summary.evidenceStatus === "manager-selected-research-only" && summary.activationAllowed === false, sourceFingerprint: item.sourceFingerprint}; validateResult(result, item); fs.mkdirSync(cacheDirectory, {recursive: true}); atomicJson(cacheFile, result); return result;
  } finally { if (path.resolve(work).startsWith(`${path.resolve(out)}${path.sep}`)) fs.rmSync(work, {recursive: true, force: true}); }
}

function loadOrBuildFrontier(corpus: CorpusArchive, inputSignature: string): FrontierArchive {
  const file = path.join(out, "frontier.json.gz"), prior = optionalGzip<FrontierArchive>(file); if (prior?.inputSignature === inputSignature) return prior;
  const sampleById = new Map(corpus.samples.map(sample => [sample.id, sample])), rows: FrontierRow[] = [], files = findFiles(sourceRoot, "ai-decisions.json"); let alternatives = 0;
  for (const decisionFile of files) {
    const relative = rel(sourceRoot, decisionFile), game = path.dirname(decisionFile), replayFile = path.join(game, "replay-input.json"); if (!fs.existsSync(replayFile)) continue; const traces = read<AiDecisionTrace[]>(decisionFile), replay = read<any>(replayFile); if (replay?.input?.aiVersion !== AI_VERSION) continue;
    const decisionsSha256 = shaFile(decisionFile), replaySha256 = shaFile(replayFile), battleId = digest(relative);
    for (const trace of traces) {
      if (!trace.decisionOrdinal || (trace.playerId !== "p1" && trace.playerId !== "p2") || !trace.whiteBoxShadow?.trace) continue; const sample = sampleById.get(digest([battleId, trace.playerId, trace.turn]).slice(0, 24)); if (!sample) continue;
      const candidates = trace.whiteBoxShadow.trace.candidates, selected = candidates.find(value => value.id === trace.selected), selectedScore = Number(selected?.finalScore); if (!selected?.eligible || !Number.isFinite(selectedScore)) continue;
      const eligible = candidates.filter(value => value.id !== trace.selected && value.eligible && value.reasonable && Number.isFinite(value.finalScore)).map(value => ({choice: value.id, action: battleActionFamily(value.id), finalScore: round(Number(value.finalScore)), rationalCost: round(Math.max(0, selectedScore - Number(value.finalScore)))})).filter(value => !/\b(?:terastallize|dynamax)\b/i.test(value.choice)); if (!eligible.length) continue; alternatives += eligible.length;
      rows.push({id: `arf-${digest([relative, trace.decisionOrdinal, trace.playerId]).slice(0, 20)}`, game, relative, decisionOrdinal: trace.decisionOrdinal, playerId: trace.playerId, turn: trace.turn, selected: trace.selected, selectedAction: battleActionFamily(trace.selected), features: sample.features, alternatives: eligible.sort((a, b) => a.rationalCost - b.rationalCost || a.choice.localeCompare(b.choice)), replaySha256, decisionsSha256, sourceFingerprint: digest([replaySha256, decisionsSha256])});
    }
  }
  const value: FrontierArchive = {schemaVersion: 1, version: AUTONOMOUS_RESEARCH_VERSION, inputSignature, rows, metrics: {battles: files.length, decisions: corpus.samples.length, executableDecisions: rows.length, alternatives}}; atomicBuffer(file, gzip(value)); return value;
}

function buildSummary(states: AutonomousResearchManagerState[], manifest: Manifest, frontier: FrontierArchive, elapsedMs: number, peakRssBytes: number): Record<string, unknown> {
  const base = summarizeAutonomousResearch(states) as any, plans = manifest.rounds.map(round => readGzip<RoundPlan>(path.join(out, round.plan))), roundResults = manifest.rounds.map(round => readGzip<RoundResults>(path.join(out, round.results))), allQuestions = roundResults.flatMap(result => result.results.map(row => plans.find(plan => plan.round === result.round)!.agendas.flatMap(agenda => agenda.ranked).find(question => question.id === row.questionId)!)), intentCounts = counts(allQuestions.map(question => question.intent)), selectedRules = new Set(allQuestions.map(question => question.ruleId)), observations = states.flatMap(state => state.observations), uniqueCases = new Set(observations.map(value => value.caseId)), duplicateCases = observations.length - uniqueCases.size, technicalFailures = roundResults.reduce((sum, value) => sum + value.technicalFailures.length, 0), fallbackSelections = roundResults.reduce((sum, value) => sum + value.results.filter(row => { const item = plans.find(plan => plan.round === value.round)!.items.find(candidate => candidate.managerId === row.managerId)!; return item.caseId !== row.caseId; }).length, 0), managersAdapted = states.filter(state => state.observations.length > 1 && allQuestions.filter(question => question.managerId === state.managerId).some(question => question.round > 1 && question.intent !== "test-program-mechanism")).length, issues: Array<{severity: "error" | "warning"; code: string; message: string}> = [];
  if (duplicateCases) issues.push({severity: "error", code: "duplicate-cases", message: `${duplicateCases} repeated exact interventions`}); if (states.some(state => state.activationStatus !== "shadow-only")) issues.push({severity: "error", code: "activation-authority", message: "A manager research state escaped shadow authority"});
  const formalFeedback = read<FormalValidationPortfolio>(path.join(out, "formal-feedback-input.json")); verifyFormalValidationPortfolio(formalFeedback);
  return {...base, generatedAt: new Date().toISOString(), formalActivationAllowed: false, inputSignature: manifest.inputSignature, elapsedMs, peakRssBytes, frontier: frontier.metrics, research: {questions: allQuestions.length, uniqueRulesStudied: selectedRules.size, intents: intentCounts, managersAdapted, independentCases: uniqueCases.size, duplicateCases, formalFeedback: formalFeedback.metrics}, efficiency: {technicalFailures, fallbackSelections, caseCacheFiles: fs.existsSync(path.join(out, "case-cache")) ? fs.readdirSync(path.join(out, "case-cache")).length : 0, retainedBytes: directoryBytes(out), workDirectoriesRemaining: fs.existsSync(path.join(out, "work")) ? findFiles(path.join(out, "work"), "counterfactual-summary.json").length : 0}, audit: {healthy: !issues.some(issue => issue.severity === "error"), issues}};
}

function doctor(verifySources: boolean): Record<string, unknown> {
  const manifest = optional<Manifest>(path.join(out, "manifest.json")), summary = optional<any>(path.join(out, "summary.json")), states = optionalGzip<AutonomousResearchManagerState[]>(path.join(out, "manager-states.json.gz")), run = optional<any>(path.join(out, "run-state.json")), issues: Array<{severity: "error" | "warning"; code: string; message: string}> = [];
  if (!manifest || !summary || !states) return {available: false, healthy: false, verifiedSources: 0, issues: [{severity: "error", code: "missing-artifacts", message: "Stage-4 autonomous research artifacts are missing"}]};
  const programs = optionalGzip<ProgramArchive>(path.join(stage3, "programs.json.gz"))?.programs ?? [];
  try {
    validateManifestEnvelope(manifest); const feedback = read<FormalValidationPortfolio>(path.join(out, "formal-feedback-input.json")); verifyFormalValidationPortfolio(feedback); validateInputBindings(manifest.inputs, currentInputFingerprints(feedback));
    states.forEach(validateAutonomousResearchState); programs.forEach(validateManagerProgramV2);
    const stateManagers = states.map(state => state.managerId).sort(), programManagers = programs.map(program => program.managerId).sort();
    if (new Set(stateManagers).size !== stateManagers.length || JSON.stringify(stateManagers) !== JSON.stringify(programManagers)) throw new Error("Manager states do not match the bound Stage-3 program population");
  } catch (error) { issues.push({severity: "error", code: "state-validation", message: error instanceof Error ? error.message : String(error)}); }
  if (!manifest.inputs || typeof manifest.inputs !== "object" || digest(manifest.inputs) !== manifest.inputSignature || summary.inputSignature !== manifest.inputSignature) issues.push({severity: "error", code: "input-signature", message: "Manifest or summary input signature mismatch"});
  const seenCases = new Set<string>(), failedCases = new Set<string>(), expectedObservations = new Map<string, ReturnType<typeof observationFromResult>[]>(), manifestRounds = Array.isArray(manifest.rounds) ? manifest.rounds : [];
  if (manifestRounds.some((round, index) => round.round !== index + 1)) issues.push({severity: "error", code: "round-sequence", message: "Manifest rounds are not contiguous"});
  for (const round of manifestRounds) {
    try {
      for (const [kind, file, expected] of [["plan", round.plan, round.planSha256], ["results", round.results, round.resultsSha256]] as const) { const absolute = path.join(out, file); if (!fs.existsSync(absolute) || shaFile(absolute) !== expected) throw new Error(`${kind} signature mismatch`); }
      const plan = readGzip<RoundPlan>(path.join(out, round.plan)), results = readGzip<RoundResults>(path.join(out, round.results));
      if (plan.schemaVersion !== 1 || plan.version !== AUTONOMOUS_RESEARCH_VERSION || plan.activationStatus !== "shadow-only" || plan.round !== round.round || plan.inputSignature !== manifest.inputSignature || results.schemaVersion !== 1 || results.version !== AUTONOMOUS_RESEARCH_VERSION || results.activationStatus !== "shadow-only" || results.round !== round.round || results.planSha256 !== round.planSha256 || results.results.length !== plan.items.length) throw new Error("round envelope mismatch");
      plan.agendas.forEach(validateAutonomousResearchAgenda);
      const itemByManager = uniqueBy(plan.items, item => item.managerId, "plan manager"), resultByManager = uniqueBy(results.results, result => result.managerId, "result manager");
      const expectedUnassigned = states.map(state => state.managerId).filter(managerId => !itemByManager.has(managerId)).sort();
      if (plan.agendas.length !== states.length || itemByManager.size !== plan.items.length || resultByManager.size !== plan.items.length || JSON.stringify([...plan.unassignedManagers].sort()) !== JSON.stringify(expectedUnassigned)) throw new Error("round population mismatch");
      for (const state of states) {
        const item = itemByManager.get(state.managerId), result = resultByManager.get(state.managerId), agenda = plan.agendas.find(value => value.managerId === state.managerId);
        if (!agenda) throw new Error(`missing manager agenda: ${state.managerId}`);
        if (!item && !result) continue;
        if (!item || !result || item.round !== round.round || item.question.id !== agenda.ranked.find(question => question.id === item.question.id)?.id) throw new Error(`missing manager binding: ${state.managerId}`);
        const candidates: PlanItem[] = [item, ...item.fallbacks.map((fallback, index) => ({...item, ...fallback, id: `${item.id}-fallback-${index + 1}`, fallbacks: []}))], candidate = candidates.find(value => value.caseId === result.caseId);
        if (!candidate) throw new Error(`result used an unregistered case: ${result.caseId}`); validateResult(result, candidate);
        if (seenCases.has(result.caseId)) throw new Error(`duplicate case: ${result.caseId}`); seenCases.add(result.caseId);
        expectedObservations.set(state.managerId, [...(expectedObservations.get(state.managerId) ?? []), observationFromResult(result)]);
      }
      validateRoundMetrics(results);
      const registeredFailures = new Set(plan.items.flatMap(item => [item, ...item.fallbacks].map(candidate => `${item.managerId}:${candidate.caseId}`)));
      for (const failure of results.technicalFailures) { const key = `${failure.managerId}:${failure.caseId}`; if (!registeredFailures.has(key)) throw new Error(`unregistered technical failure: ${key}`); if (failedCases.has(failure.caseId)) throw new Error(`repeated technical failure: ${failure.caseId}`); failedCases.add(failure.caseId); }
    } catch (error) { issues.push({severity: "error", code: "round-binding", message: `round ${round.round}: ${error instanceof Error ? error.message : String(error)}`}); }
  }
  for (const state of states) { const expected = expectedObservations.get(state.managerId) ?? []; if (JSON.stringify(state.observations) !== JSON.stringify(expected) || JSON.stringify(state.usedCaseIds) !== JSON.stringify(expected.map(value => value.caseId))) issues.push({severity: "error", code: "state-result-binding", message: state.managerId}); }
  if (states.some(state => state.completedRounds !== manifestRounds.length)) issues.push({severity: "error", code: "state-round", message: "Manager state rounds differ from manifest"});
  const recomputedSummary = summarizeAutonomousResearch(states); for (const [key, value] of Object.entries(recomputedSummary)) if (JSON.stringify(summary[key]) !== JSON.stringify(value)) issues.push({severity: "error", code: "summary-binding", message: key});
  let verifiedSources = 0; if (verifySources) { const frontier = readGzip<FrontierArchive>(path.join(out, "frontier.json.gz")), unique = new Map<string, FrontierRow>(); for (const row of frontier.rows) if (!unique.has(row.relative)) unique.set(row.relative, row); for (const row of unique.values()) { const decisions = path.join(sourceRoot, ...row.relative.split("/")), replay = path.join(path.dirname(decisions), "replay-input.json"); if (!fs.existsSync(decisions) || !fs.existsSync(replay) || shaFile(decisions) !== row.decisionsSha256 || shaFile(replay) !== row.replaySha256) issues.push({severity: "error", code: "source-drift", message: row.relative}); verifiedSources += 1; } }
  if (run?.status !== "complete") issues.push({severity: "error", code: "run-incomplete", message: String(run?.status ?? "missing")}); if (summary.formalActivationAllowed !== false || summary.activationStatus !== "shadow-only") issues.push({severity: "error", code: "activation-authority", message: "Stage 4 escaped shadow authority"});
  return {available: true, healthy: !issues.some(issue => issue.severity === "error"), verifiedSources, rounds: manifestRounds.length, managers: states.length, experiments: states.reduce((sum, state) => sum + state.observations.length, 0), summary, issues};
}

function observationFromResult(result: AutonomousResearchResult): {id: string; questionId: string; ruleId: string; round: number; caseId: string; direction: AutonomousResearchDirection; expectedDirection: "better" | "worse"; supportsHypothesis: boolean; outcomeChanged: boolean; authority: "exact-counterfactual-single-environment"; sourceFingerprint: string} {
  return {id: `aro-${digest(result).slice(0, 20)}`, questionId: result.questionId, ruleId: result.ruleId, round: result.round, caseId: result.caseId, direction: result.direction, expectedDirection: result.expectedDirection, supportsHypothesis: result.direction === result.expectedDirection, outcomeChanged: result.outcomeChanged, authority: "exact-counterfactual-single-environment", sourceFingerprint: result.sourceFingerprint};
}
function uniqueBy<T>(values: T[], key: (value: T) => string, label: string): Map<string, T> { const map = new Map<string, T>(); for (const value of values) { const id = key(value); if (map.has(id)) throw new Error(`duplicate ${label}: ${id}`); map.set(id, value); } return map; }
function validateRoundMetrics(value: RoundResults): void { const metrics = {experiments: value.results.length, better: value.results.filter(result => result.direction === "better").length, neutral: value.results.filter(result => result.direction === "neutral").length, worse: value.results.filter(result => result.direction === "worse").length, supports: value.results.filter(result => result.direction === result.expectedDirection).length, contradictions: value.results.filter(result => result.direction !== "neutral" && result.direction !== result.expectedDirection).length, outcomeChanges: value.results.filter(result => result.outcomeChanged).length, technicalFailures: value.technicalFailures.length}; for (const [key, count] of Object.entries(metrics)) if (value.metrics[key] !== count) throw new Error(`round metric mismatch: ${key}`); }

function status(): Record<string, unknown> { const summary = optional<any>(path.join(out, "summary.json")), run = optional<any>(path.join(out, "run-state.json")); return {available: Boolean(summary), run, summary: summary ? {activationStatus: summary.activationStatus, managers: summary.managers, completedRounds: summary.completedRounds, experiments: summary.experiments, supports: summary.supports, contradictions: summary.contradictions, outcomeChanges: summary.outcomeChanges, research: summary.research, efficiency: summary.efficiency, audit: summary.audit} : null}; }
function inspect(managerId: string): Record<string, unknown> { const states = readGzip<AutonomousResearchManagerState[]>(path.join(out, "manager-states.json.gz")), state = states.find(value => value.managerId === managerId); if (!state) throw new Error(`Unknown autonomous research manager: ${managerId}`); const plans = findFiles(out, "").filter(file => /round-\d+-plan\.json\.gz$/.test(file)).map(file => readGzip<RoundPlan>(file)).flatMap(plan => plan.items.filter(item => item.managerId === managerId).map(item => ({round: plan.round, question: item.question, case: {caseId: item.caseId, game: item.game, decisionOrdinal: item.decisionOrdinal, incumbent: item.incumbent, alternative: item.alternative, rationalCost: item.rationalCost}}))); return {state, journey: plans}; }

function verifyItemSource(item: PlanItem): void { const decisions = path.join(item.game, "ai-decisions.json"), replay = path.join(item.game, "replay-input.json"); if (shaFile(decisions) !== item.decisionsSha256 || shaFile(replay) !== item.replaySha256 || digest([item.replaySha256, item.decisionsSha256]) !== item.sourceFingerprint) throw new Error(`Autonomous research source drift: ${item.id}`); }
function validateResult(result: AutonomousResearchResult, item: PlanItem): void { if (result.questionId !== item.question.id || result.managerId !== item.managerId || result.ruleId !== item.question.ruleId || result.round !== item.round || result.caseId !== item.caseId || result.expectedDirection !== item.question.expectedInterventionDirection || !result.sourceVerified || !result.prefixVerified || !result.interventionVerified || result.sourceFingerprint !== item.sourceFingerprint) throw new Error(`Invalid autonomous research case result: ${item.id}`); }
function caseId(row: FrontierRow, alternative = row.alternatives[0]?.choice ?? ""): string { return `arc-${digest([row.relative, row.decisionOrdinal, row.playerId, alternative]).slice(0, 20)}`; }
function planCase(row: FrontierRow, alternative: FrontierAlternative): PlanCase { return {caseId: caseId(row, alternative.choice), game: row.game, decisionOrdinal: row.decisionOrdinal, playerId: row.playerId, turn: row.turn, incumbent: row.selected, alternative: alternative.choice, rationalCost: alternative.rationalCost, replaySha256: row.replaySha256, decisionsSha256: row.decisionsSha256, sourceFingerprint: row.sourceFingerprint}; }
function matches(predicate: {feature: string; operator: "gte" | "lt"; threshold: number}, features: Record<string, number>): boolean { const value = features[predicate.feature]; return Number.isFinite(value) && (predicate.operator === "gte" ? value >= predicate.threshold : value < predicate.threshold); }
function score(winner: unknown, own: string): number { return winner === own ? 1 : winner === null ? .5 : 0; }
function child(executable: string, childArgs: string[]): Promise<void> { return new Promise((resolve, reject) => { const process = spawn(executable, childArgs, {cwd: processCwd(), stdio: ["ignore", "ignore", "pipe"]}); let stderr = ""; process.stderr.on("data", chunk => { stderr += String(chunk); if (stderr.length > 65536) stderr = stderr.slice(-65536); }); process.on("error", reject); process.on("close", code => code === 0 ? resolve() : reject(new Error(`Counterfactual child failed (${code}): ${stderr}`))); }); }
function processCwd(): string { return process.cwd(); }
function markdown(value: any): string { return `# Stage 4 Autonomous Research\n\n- Status: ${value.audit.healthy ? "healthy" : "blocked"}\n- Authority: shadow-only\n- Managers / rounds / experiments: ${value.managers} / ${value.completedRounds} / ${value.experiments}\n- Supports / contradictions / neutral: ${value.supports} / ${value.contradictions} / ${value.neutral}\n- Outcome-changing branches: ${value.outcomeChanges}\n- Managers adapting after round one: ${value.research.managersAdapted}\n- Unique program rules studied: ${value.research.uniqueRulesStudied}\n- Formal history generations / mechanisms: ${value.research.formalFeedback.generations} / ${value.research.formalFeedback.mechanisms}\n- Retained bytes: ${value.efficiency.retainedBytes}\n\nManagers generated questions from their own programs, selected executable exact counterfactuals, and changed research intent after evidence. Rejected and completed formal mechanisms are retired from rediscovery; inconclusive mechanisms return as explicit replication questions. Single-environment results remain research evidence and cannot activate battle policy.\n`; }
function directoryBytes(root: string): number { let total = 0; if (!fs.existsSync(root)) return total; const stack = [root]; while (stack.length) { const current = stack.pop()!; for (const entry of fs.readdirSync(current, {withFileTypes: true})) { const full = path.join(current, entry.name); if (entry.isDirectory()) stack.push(full); else total += fs.statSync(full).size; } } return total; }
function findFiles(root: string, name: string): string[] { const result: string[] = []; if (!fs.existsSync(root)) return result; const stack = [root]; while (stack.length) { const current = stack.pop()!; for (const entry of fs.readdirSync(current, {withFileTypes: true})) { const full = path.join(current, entry.name); if (entry.isDirectory()) stack.push(full); else if (!name || entry.name === name) result.push(full); } } return result.sort(); }
function currentInputFingerprints(feedback?: FormalValidationPortfolio): Record<string, Fingerprint> { const value = feedback ?? read<FormalValidationPortfolio>(path.join(out, "formal-feedback-input.json")); const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`); return {programs: fingerprint(path.join(stage3, "programs.json.gz")), corpus: fingerprint(path.join(stage3, "corpus.json.gz")), stage3Summary: fingerprint(path.join(stage3, "summary.json")), formalFeedback: {file: path.join(out, "formal-feedback-input.json"), sha256: sha(bytes), bytes: bytes.length}}; }
function validateManifestEnvelope(value: Manifest): void { if (value.schemaVersion !== 1 || value.version !== AUTONOMOUS_RESEARCH_VERSION || value.activationStatus !== "shadow-only" || !Array.isArray(value.rounds)) throw new Error("Invalid autonomous research manifest"); }
function validateInputBindings(actual: Record<string, Fingerprint>, expected: Record<string, Fingerprint>): void { const actualKeys = Object.keys(actual).sort(), expectedKeys = Object.keys(expected).sort(); if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) throw new Error(`Autonomous research input keys must be ${expectedKeys.join(",")}`); for (const key of expectedKeys) { const left = actual[key], right = expected[key]; if (!left || path.resolve(left.file) !== path.resolve(right.file) || left.sha256 !== right.sha256 || left.bytes !== right.bytes) throw new Error(`Autonomous research input drift: ${key}`); } }
function fingerprint(file: string): Fingerprint { const stat = fs.statSync(file); return {file: path.resolve(file), sha256: shaFile(file), bytes: stat.size}; }
function gzip(value: unknown): Buffer { return zlib.gzipSync(Buffer.from(JSON.stringify(value)), {level: 9}); }
function readGzip<T>(file: string): T { return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")) as T; }
function optionalGzip<T>(file: string): T | null { try { return readGzip<T>(file); } catch { return null; } }
function atomicJson(file: string, value: unknown): void { atomicBuffer(file, Buffer.from(`${JSON.stringify(value, null, 2)}\n`)); }
function atomicBuffer(file: string, value: Buffer): void { fs.mkdirSync(path.dirname(file), {recursive: true}); const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`; fs.writeFileSync(temporary, value); fs.renameSync(temporary, file); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function optional<T>(file: string): T | null { try { return read<T>(file); } catch { return null; } }
function rel(root: string, file: string): string { return path.relative(root, file).replaceAll("\\", "/"); }
function shaFile(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function sha(value: Buffer): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function digest(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function hashUnit(value: string): number { return Number.parseInt(digest(value).slice(0, 12), 16) / 0xffffffffffff; }
function counts(values: string[]): Record<string, number> { const result: Record<string, number> = {}; for (const value of values.sort()) result[value] = (result[value] ?? 0) + 1; return result; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function pad(value: number): string { return String(value).padStart(2, "0"); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function required(name: string): string { const value = option(name, ""); if (!value) throw new Error(`${name} is required`); return value; }
function integerOption(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`); return value; }
function print(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }

main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
