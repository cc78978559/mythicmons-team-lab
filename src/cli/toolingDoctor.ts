import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {buildStorageIndex} from "../draft/storageIndex";
import type {StorageIndex} from "../draft/storageIndex";
import {gcSourceCaches} from "../draft/sourceCacheMaintenance";
import type {SourceCacheGcResult} from "../draft/sourceCacheMaintenance";
import {AI_VERSION} from "../showdown/choice";
import {buildEvidenceEpoch} from "../showdown/evidenceEpoch";
import {doctorDecisionDossiers} from "../draft/decisionDossierStore";
import {doctorPositionValue} from "../ai/positionValue";
import {gcStageGenerationArchives} from "../draft/stageGeneration";
import {verifyFormalCanaryHandoff} from "../ai/formalCanaryControl";

const args = process.argv.slice(2), command = args[0] && !args[0].startsWith("--") ? args[0] : "doctor";
const root = path.resolve(option("--root", "output/tooling")), league = path.resolve(option("--league", "output/official-era-03/league"));
const cacheRoot = path.resolve(option("--source-cache", path.join(root, "shadow-lineup-source-cache"))), budgetBytes = numberOption("--cache-budget-mb", 4096, 512, 102400) * 1048576, maxAgeDays = numberOption("--cache-max-age-days", 30, 0, 3650);
const stageArchiveBudgetBytes = numberOption("--stage-archive-budget-mb", 512, 16, 102400) * 1048576, stageArchiveMaxGenerations = numberOption("--stage-archive-max-generations", 5, 1, 100);
const storageTtlMinutes = numberOption("--storage-ttl-minutes", 60, 1, 1440), storageCacheFile = path.join(root, ".tooling-storage-index.json"), sourceCacheAuditCacheFile = path.join(root, ".tooling-source-cache-audit.json");
const out = path.resolve(option("--out", path.join(root, "tooling-doctor"))); fs.mkdirSync(out, {recursive: true});
const dossierRoot = path.resolve(option("--decision-dossiers", path.join(root, "decision-dossiers")));
const positionValueRoot = path.resolve(option("--position-value", path.join(root, "position-value-stage2")));
const managerProgramRoot = path.resolve(option("--manager-program-v2", path.join(root, "manager-program-v2")));
const autonomousResearchRoot = path.resolve(option("--autonomous-research", path.join(root, "autonomous-research-stage4-delivery-v2")));
const formalValidationRoot = path.resolve(option("--formal-validation", path.join(root, "formal-validation-stage5-delivery-v2")));
const formalCanaryRoot = path.resolve(option("--formal-canary", path.join(root, "formal-canary-control")));
const aiPipelineRoot = path.resolve(option("--ai-pipeline", path.join(root, "ai-pipeline-stage6")));
if (!new Set(["status", "doctor", "storage", "cache-gc"]).has(command)) throw new Error("Usage: npm run tooling -- <status|doctor|storage|cache-gc> [--apply|--refresh-storage]");
if (command === "status") {
  const prior = optional<any>(path.join(out, "summary.json")), pipeline = optional<any>(path.join(aiPipelineRoot, "status.json"));
  console.log(JSON.stringify({schemaVersion: 1, available: Boolean(prior), healthy: prior?.healthy ?? false, generatedAt: prior?.generatedAt ?? null, storage: prior?.storage ? {files: prior.storage.files, bytes: prior.storage.bytes, ageMs: Date.now() - Date.parse(prior.generatedAt)} : null, sourceCaches: prior?.sourceCaches ? {entries: prior.sourceCaches.entries, remainingBytes: prior.sourceCaches.remainingBytes, budgetBytes: prior.sourceCaches.budgetBytes} : null, pipeline: pipeline?.evaluation ? {operationalHealthy: pipeline.evaluation.operationalHealthy, pipelineCycleComplete: pipeline.evaluation.pipelineCycleComplete ?? pipeline.evaluation.researchComplete, researchMaturity: pipeline.evaluation.researchMaturity ?? null, formalActivationReady: pipeline.evaluation.formalActivationReady, nextMilestones: pipeline.evaluation.nextMilestones} : null, issues: prior?.issues ?? []}, null, 2));
  process.exit(prior ? 0 : 2);
}
const started = Date.now(), applyGc = command === "cache-gc" && args.includes("--apply"), storageStarted = Date.now(), cachedStorage = optional<StorageIndex>(storageCacheFile), storageReusable = Boolean(!args.includes("--refresh-storage") && command !== "storage" && !applyGc && cachedStorage?.schemaVersion === 1 && cachedStorage.root === root && Number.isFinite(Date.parse(cachedStorage.generatedAt)) && Date.now() - Date.parse(cachedStorage.generatedAt) <= storageTtlMinutes * 60000 && cachedStorage.matchedFiles);
const storage: StorageIndex = storageReusable ? cachedStorage! : buildStorageIndex(root, {matchFileNames: ["causal-manifest.json", "causal-summary.json"]}); if (!storageReusable) atomic(storageCacheFile, storage); atomic(path.join(out, "storage-index.json"), storage); const storageElapsedMs = Date.now() - storageStarted;
const cacheStarted = Date.now(), cachedCacheAudit = optional<{schemaVersion: 1; generatedAt: string; cacheRoot: string; budgetBytes: number; maxAgeDays: number; result: SourceCacheGcResult}>(sourceCacheAuditCacheFile), cacheReusable = command === "doctor" && !args.includes("--refresh-storage") && cachedCacheAudit?.schemaVersion === 1 && cachedCacheAudit.cacheRoot === cacheRoot && cachedCacheAudit.budgetBytes === budgetBytes && cachedCacheAudit.maxAgeDays === maxAgeDays && Date.now() - Date.parse(cachedCacheAudit.generatedAt) <= storageTtlMinutes * 60000;
const cache = cacheReusable ? cachedCacheAudit.result : gcSourceCaches(cacheRoot, root, {budgetBytes, maxAgeDays, apply: applyGc, referenceFiles: Object.values(storage.matchedFiles ?? {}).flat()}); if (!cacheReusable && !applyGc) atomic(sourceCacheAuditCacheFile, {schemaVersion: 1, generatedAt: new Date().toISOString(), cacheRoot, budgetBytes, maxAgeDays, result: cache}); const cacheElapsedMs = Date.now() - cacheStarted;
atomic(path.join(out, "source-cache-audit.json"), cache);
const stageArchives = [autonomousResearchRoot, formalValidationRoot].map(directory => gcStageGenerationArchives(directory, {budgetBytes: stageArchiveBudgetBytes, maxGenerations: stageArchiveMaxGenerations, apply: applyGc})); atomic(path.join(out, "stage-archive-audit.json"), stageArchives);
const pipelineStarted = Date.now(), pipelineDoctorRun = refreshAiPipelineDoctor(), pipelineElapsedMs = Date.now() - pipelineStarted, formal = formalAuditStatus(league), issues: Array<{severity: "error" | "warning"; code: string; message: string}> = [];
const decisionDossiers = doctorDecisionDossiers(dossierRoot) as any;
const positionValue = doctorPositionValue(positionValueRoot) as any;
const managerProgramV2 = managerProgramStatus(managerProgramRoot);
const autonomousResearch = autonomousResearchStatus(autonomousResearchRoot);
const formalValidation = formalValidationStatus(formalValidationRoot);
const formalCanary = formalCanaryStatus(formalCanaryRoot, formalValidationRoot);
const aiPipeline = aiPipelineStatus(aiPipelineRoot);
if (!formal.available) issues.push({severity: "warning", code: "formal-league-unavailable", message: "Formal league audit files are unavailable"});
else if (!formal.signatureMatches) issues.push({severity: "error", code: "formal-audit-stale", message: "Formal audit summary does not match its signature cache"});
if (formal.available && !formal.evidenceSignatureMatches) issues.push({severity: "error", code: "formal-evidence-audit-stale", message: "Formal audit was produced before the current evidence-era policy and must be rerun"});
else if (formal.available && !formal.formalActivationReady) issues.push({severity: "warning", code: "formal-activation-blocked", message: "League operation is healthy, but latest-season evidence is not eligible for formal AI activation"});
if (formal.fatalCount) issues.push({severity: "error", code: "formal-audit-fatal", message: `Formal audit contains ${formal.fatalCount} fatal finding(s)`});
if (!decisionDossiers.available) issues.push({severity: "warning", code: "decision-dossiers-unavailable", message: "Stage-1 decision dossier index is unavailable"});
else for (const issue of decisionDossiers.issues ?? []) if (issue.code !== "formal-coverage-blocked") issues.push({...issue, code: `decision-dossiers-${issue.code}`});
if (decisionDossiers.available && decisionDossiers.issues?.some((issue: any) => issue.code === "formal-coverage-blocked")) issues.push({severity: "warning", code: "decision-dossiers-formal-coverage-blocked", message: "Decision dossiers are healthy but contain no complete current-era formal coverage"});
if (!positionValue.available) issues.push({severity: "warning", code: "position-value-unavailable", message: "Stage-2 position value model is unavailable"});
else if (!positionValue.healthy) issues.push({severity: "error", code: "position-value-unhealthy", message: "Stage-2 position value model failed its local audit"});
if (!managerProgramV2.available) issues.push({severity: "warning", code: "manager-program-v2-unavailable", message: "Stage-3 manager program registry is unavailable"});
else if (!managerProgramV2.healthy) issues.push({severity: "error", code: "manager-program-v2-unhealthy", message: "Stage-3 manager program registry is incomplete, stale, or failed its audit"});
if (!autonomousResearch.available) issues.push({severity: "warning", code: "autonomous-research-unavailable", message: "Stage-4 autonomous research archive is unavailable"});
else if (!autonomousResearch.healthy) issues.push({severity: "error", code: "autonomous-research-unhealthy", message: "Stage-4 autonomous research archive is incomplete or failed its audit"});
if (!formalValidation.available) issues.push({severity: "warning", code: "formal-validation-unavailable", message: "Stage-5 formal-validation archive is unavailable"});
else if (!formalValidation.healthy) issues.push({severity: "error", code: "formal-validation-unhealthy", message: "Stage-5 formal-validation archive is incomplete or failed its local audit"});
if (!formalCanary.available) issues.push({severity: "warning", code: "formal-canary-unavailable", message: "Formal validation has no signed canary handoff"});
else if (!formalCanary.healthy) issues.push({severity: "error", code: "formal-canary-unhealthy", message: "Formal canary handoff is stale or invalid"});
if (!pipelineDoctorRun.healthy) issues.push({severity: "error", code: "ai-pipeline-doctor-failed", message: pipelineDoctorRun.message});
if (!aiPipeline.available) issues.push({severity: "warning", code: "ai-pipeline-unavailable", message: "Stage-6 integrated pipeline index is unavailable"});
else if (!aiPipeline.healthy) issues.push({severity: "error", code: "ai-pipeline-unhealthy", message: "Stage-6 integrated pipeline reports an operational blocker"});
if (cache.audit.invalidDirectories.length) issues.push({severity: "warning", code: "invalid-source-cache-directories", message: `${cache.audit.invalidDirectories.length} non-cache directories need inspection`});
if (cache.remainingBytes > budgetBytes) issues.push({severity: "warning", code: "source-cache-over-budget", message: `Source caches exceed budget by ${mb(cache.remainingBytes - budgetBytes)} MB`});
for (const archive of stageArchives) if (archive.audit.totalBytes > stageArchiveBudgetBytes || archive.audit.entries.filter(entry => entry.state === "complete").length > stageArchiveMaxGenerations) issues.push({severity: "warning", code: "stage-archive-over-budget", message: `${archive.audit.root} retains ${archive.audit.entries.length} generation(s) and ${mb(archive.audit.totalBytes)} MB`});
const summary = {schemaVersion: 1, command, healthy: !issues.some(issue => issue.severity === "error"), generatedAt: new Date().toISOString(), elapsedMs: Date.now() - started, phases: {storageMs: storageElapsedMs, cacheAuditMs: cacheElapsedMs, pipelineDoctorMs: pipelineElapsedMs}, storage: {root, files: storage.files, bytes: storage.bytes, reused: storageReusable, ageMs: Date.now() - Date.parse(storage.generatedAt), ttlMinutes: storageTtlMinutes, largest: storage.entries.slice(0, 12)}, sourceCaches: {root: cacheRoot, entries: cache.audit.entries.length, bytesBefore: cache.audit.totalBytes, budgetBytes, reused: cacheReusable, plannedOrRemoved: cache.removed.length, reclaimedBytes: cache.reclaimedBytes, remainingBytes: cache.remainingBytes, applied: cache.apply}, stageArchives: {budgetBytes: stageArchiveBudgetBytes, maxGenerations: stageArchiveMaxGenerations, roots: stageArchives.map(value => ({root: value.audit.root, generations: value.audit.entries.length, bytes: value.audit.totalBytes, plannedOrRemoved: value.removed.length, reclaimedBytes: value.reclaimedBytes, projectedBytes: value.projectedBytes, applied: value.apply}))}, formal, decisionDossiers, positionValue, managerProgramV2, autonomousResearch, formalValidation, formalCanary, aiPipeline, issues, artifacts: {storageIndex: path.join(out, "storage-index.json"), cacheAudit: path.join(out, "source-cache-audit.json"), stageArchiveAudit: path.join(out, "stage-archive-audit.json")}};
atomic(path.join(out, "summary.json"), summary); console.log(JSON.stringify(summary, null, 2)); if (issues.some(issue => issue.severity === "error")) process.exitCode = 2;

function formalAuditStatus(directory: string): {available: boolean; completedSeason?: number; fatalCount?: number; warningCount?: number; signatureMatches?: boolean; evidenceSignatureMatches?: boolean; formalActivationReady?: boolean; evidenceEpoch?: unknown; runStatus?: string | null} {
  const summary = optional<any>(path.join(directory, "audit-summary.json")), cache = optional<any>(path.join(directory, ".audit-signature-cache.json")), run = optional<any>(path.join(directory, "audit-run-state.json"));
  if (!summary || cache?.schemaVersion !== 1 || !cache.files) return {available: false}; const hash = crypto.createHash("sha256");
  for (const key of Object.keys(cache.files).sort()) hash.update(`${key}\0${cache.files[key].sha256}\0`);
  const state = path.join(directory, "dynasty-state.json"), cachedState = cache.files["dynasty-state.json"], stat = fs.existsSync(state) ? fs.statSync(state) : null;
  const stateFresh = Boolean(stat && cachedState && cachedState.size === stat.size && Math.abs(cachedState.mtimeMs - stat.mtimeMs) < 1);
  const currentPolicySha256 = buildEvidenceEpoch(AI_VERSION, "gen9ou").policySha256;
  return {available: true, completedSeason: Number(summary.completedSeasons), fatalCount: Number(summary.fatalCount ?? 0), warningCount: Number(summary.warningCount ?? 0), signatureMatches: summary.inputSignature === hash.digest("hex") && stateFresh && run?.status === "complete", evidenceSignatureMatches: summary.schemaVersion === 6 && summary.evidenceEpoch?.policySha256 === currentPolicySha256, formalActivationReady: summary.evidenceEpoch?.formalActivationReady === true, evidenceEpoch: summary.evidenceEpoch ?? null, runStatus: run?.status ?? null};
}
function managerProgramStatus(directory: string): {available: boolean; healthy: boolean; activationStatus?: string; managers?: number; behaviors?: number; testImprovementPercent?: number; buildStatus?: string | null; issues?: unknown[]} {
  const summary = optional<any>(path.join(directory, "summary.json")), build = optional<any>(path.join(directory, "build-state.json"));
  if (!summary) return {available: false, healthy: false};
  const healthy = build?.status === "complete" && summary.audit?.healthy === true && summary.activationStatus === "shadow-only" && summary.formalActivationAllowed === false;
  return {available: true, healthy, activationStatus: summary.activationStatus, managers: Number(summary.population?.managers ?? 0), behaviors: Number(summary.population?.uniqueBehaviorHashes ?? 0), testImprovementPercent: Number(summary.evaluation?.improvementPercent ?? 0), buildStatus: build?.status ?? null, issues: summary.audit?.issues ?? []};
}
function autonomousResearchStatus(directory: string): {available: boolean; healthy: boolean; activationStatus?: string; managers?: number; rounds?: number; experiments?: number; adaptedManagers?: number; duplicateCases?: number; runStatus?: string | null; issues?: unknown[]} {
  const summary = optional<any>(path.join(directory, "summary.json")), run = optional<any>(path.join(directory, "run-state.json")); if (!summary) return {available: false, healthy: false}; const healthy = run?.status === "complete" && summary.audit?.healthy === true && summary.activationStatus === "shadow-only" && summary.formalActivationAllowed === false;
  return {available: true, healthy, activationStatus: summary.activationStatus, managers: Number(summary.managers ?? 0), rounds: Number(summary.completedRounds ?? 0), experiments: Number(summary.experiments ?? 0), adaptedManagers: Number(summary.research?.managersAdapted ?? 0), duplicateCases: Number(summary.research?.duplicateCases ?? 0), runStatus: run?.status ?? null, issues: summary.audit?.issues ?? []};
}
function formalValidationStatus(directory: string): {available: boolean; healthy: boolean; completed?: boolean; eligibleDomains?: string[]; experiments?: number; runStatus?: string | null; issues?: unknown[]} {
  const summary = optional<any>(path.join(directory, "summary.json")), run = optional<any>(path.join(directory, "run-state.json")); if (!summary) return {available: false, healthy: false};
  const healthy = run?.status === "complete" && summary.audit?.healthy === true && summary.authority === "validation-only-no-automatic-activation" && summary.automaticActivationAllowed === false;
  return {available: true, healthy, completed: summary.formalValidationCompleted === true, eligibleDomains: summary.limitedCanaryEligibleDomains ?? [], experiments: Number(summary.experiments?.completed ?? 0), runStatus: run?.status ?? null, issues: summary.audit?.issues ?? []};
}
function formalCanaryStatus(directory: string, validationDirectory: string): {available: boolean; healthy: boolean; status?: string; domains?: number} {
  const handoff = optional<any>(path.join(directory, "handoff.json")), freeze = optional<any>(path.join(validationDirectory, "freeze.json")), summary = optional<any>(path.join(validationDirectory, "summary.json")); if (!handoff) return {available: false, healthy: false};
  try { verifyFormalCanaryHandoff(handoff); return {available: true, healthy: handoff.source.freezeSha256 === freeze?.sha256 && handoff.source.summarySha256 === summary?.sha256, status: handoff.status, domains: handoff.domains.length}; } catch { return {available: true, healthy: false}; }
}
function aiPipelineStatus(directory: string): {available: boolean; healthy: boolean; pipelineCycleComplete?: boolean; researchMaturity?: string; formalActivationReady?: boolean; nextStage?: string | null; warnings?: number} {
  const status = optional<any>(path.join(directory, "status.json")), doctor = optional<any>(path.join(directory, "doctor.json")); if (!status || !doctor) return {available: false, healthy: false}; const evaluation = status.evaluation ?? {}, signatureMatches = typeof status.indexSignature === "string" && doctor.indexSignature === status.indexSignature;
  return {available: true, healthy: evaluation.operationalHealthy === true && doctor.healthy === true && signatureMatches, pipelineCycleComplete: (evaluation.pipelineCycleComplete ?? evaluation.researchComplete) === true, researchMaturity: String(evaluation.researchMaturity ?? "legacy-unknown"), formalActivationReady: evaluation.formalActivationReady === true, nextStage: evaluation.nextStage ?? null, warnings: Array.isArray(evaluation.warnings) ? evaluation.warnings.length : 0};
}
function refreshAiPipelineDoctor(): {healthy: boolean; message: string} { const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.resolve("src/cli/aiPipeline.ts"), "doctor", "--deep", "--root", root, "--league", league, "--out", aiPipelineRoot, "--decision-dossiers", dossierRoot, "--position-value", positionValueRoot, "--manager-program-v2", managerProgramRoot, "--autonomous-research", autonomousResearchRoot, "--formal-validation", formalValidationRoot, "--formal-canary", formalCanaryRoot], {cwd: process.cwd(), encoding: "utf8", maxBuffer: 32 * 1024 * 1024}); return {healthy: !result.error && result.status === 0, message: result.error?.message || result.stderr?.trim().slice(-2048) || `AI pipeline doctor exited ${result.status}`}; }
function atomic(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
function optional<T>(file: string): T | null { try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return null; } }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function numberOption(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(option(name, String(fallback))); if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`); return value; }
function mb(bytes: number): number { return Math.round(bytes / 1048576 * 10) / 10; }
