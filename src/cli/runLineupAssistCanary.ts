import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import {loadLineupAssistApproval} from "../ai/whiteBox/lineupApproval";
import {auditLineupAssistCanary} from "../ai/whiteBox/lineupAssistCanary";
import {loadDynastyStateCore} from "../draft/dynastyStateStore";
import {loadDynastyCheckpointBranchManifest, materializeDynastyCheckpointBranch, verifyDynastyCheckpointBranch} from "../draft/dynastyCheckpointBranch";

type SourceState = {completedSeason: number; seed: string; settings: Record<string, unknown>};
const args = process.argv.slice(2), root = process.cwd();
const source = path.resolve(required("--source")), approvalFile = path.resolve(required("--approval")), out = path.resolve(option("--out", "output/tooling/lineup-assist-canary")), resume = args.includes("--resume");
const approval = loadLineupAssistApproval(approvalFile), state = loadDynastyStateCore<SourceState>(path.join(source, "dynasty-state.json"));
const first = approval.payload.canary.firstSeason, last = approval.payload.canary.expiresAfterSeason, seasons = Array.from({length: last - first + 1}, (_, index) => first + index);
if (state.completedSeason !== first - 1) throw new Error(`Canary source must end at season ${first - 1}; found ${state.completedSeason}`);
if (out === source || out.startsWith(`${source}${path.sep}`) || source.startsWith(`${out}${path.sep}`)) throw new Error("Canary output must be separate from its source");
fs.mkdirSync(out, {recursive: true});
const control = path.join(out, "control"), canary = path.join(out, "canary"), runState = path.join(out, "canary-run.json");
const runIdentity = {source, sourceSeason: state.completedSeason, approval: approvalFile, approvalSha256: approval.sha256, seasons, branches: {control, canary}};
let phase = "prepare-control";
try {
  prepareBranch(control); phase = "prepare-canary"; prepareBranch(canary);
  write(runState, {schemaVersion: 1, status: "running", phase, ...runIdentity});
  phase = "run-control"; runBranch(control, "");
  phase = "run-canary"; runBranch(canary, approvalFile);
  phase = "audit"; const summary = auditLineupAssistCanary(control, canary, seasons, approval.sha256);
  write(path.join(out, "canary-summary.json"), summary);
  write(path.join(out, "canary-report.md"), report(summary));
  const summarySha256 = hashFile(path.join(out, "canary-summary.json"));
  write(path.join(out, "approval-disposition.json"), {schemaVersion: 1, approvalSha256: approval.sha256, summarySha256, seasons, conclusion: summary.evidence.conclusion, disposition: summary.evidence.disposition, effectiveAfterSeason: last});
  write(runState, {schemaVersion: 1, status: "complete", phase: "complete", ...runIdentity, safety: summary.safety});
  console.log(JSON.stringify({status: "complete", out, ...summary}, null, 2));
} catch (error) {
  const memory = process.memoryUsage();
  write(runState, {schemaVersion: 1, status: "failed", phase, ...runIdentity, memory: {rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal}, failures: [{message: error instanceof Error ? error.message : String(error)}]});
  throw error;
}

function prepareBranch(target: string): void {
  if (!fs.existsSync(target)) { materializeDynastyCheckpointBranch(source, target); return; }
  if (!resume) throw new Error(`Canary branch exists; use --resume: ${target}`);
  if (!fs.existsSync(path.join(target, "checkpoint-branch.json"))) {
    fs.rmSync(target, {recursive: true, force: true});
    materializeDynastyCheckpointBranch(source, target);
    return;
  }
  verifyDynastyCheckpointBranch(target, loadDynastyCheckpointBranchManifest(target));
}

function runBranch(target: string, lineupApproval: string): void {
  const current = loadDynastyStateCore<SourceState>(path.join(target, "dynasty-state.json"));
  if (current.completedSeason === last) return;
  if (current.completedSeason < state.completedSeason || current.completedSeason > last) throw new Error(`Invalid canary branch season ${current.completedSeason}: ${target}`);
  const settings = state.settings, env = {
    ...process.env,
    V12_OUT: target,
    V12_SEED: state.seed,
    V12_SEASONS: String(last),
    V12_RESUME: "true",
    V12_ALLOW_CODE_UPGRADE: "true",
    V12_MANAGER_LIMIT: setting("managerLimit"), V12_PAIRS: setting("pairs"), V12_POOL_SIZE: setting("poolSize"), V12_AUCTION_LOTS: setting("auctionLots"),
    V12_REGULAR_ROUNDS: setting("regularRounds"), V12_MAX_TURNS: setting("maxTurns"), V12_MIN_ROSTER: setting("minRoster"), V12_MAX_ROSTER: setting("maxRoster"),
    V12_BASE_CASH: setting("baseBudget"), V12_AUCTION_MODE: setting("auctionMode"), V12_STRATEGY_PROGRAM_OPERATOR: setting("strategyProgramOperator"),
    V12_EVOLUTION_MODE: setting("evolutionMode"), V12_EVOLUTION_POLICY: setting("evolutionPolicy"), V12_EVOLUTION_MAX_BURSTS: setting("evolutionMaxBursts"),
    V12_EVOLUTION_MIN_CANDIDATES: setting("evolutionMinCandidates"), V12_EVOLUTION_MAX_CANDIDATES: setting("evolutionMaxCandidates"),
    V12_TACTICAL_MEMORY_BEHAVIOR_POLICY: setting("tacticalMemoryBehaviorPolicy"), V12_TACTICAL_MEMORY_CONFIDENCE_FLOOR: setting("tacticalMemoryConfidenceFloor"),
    V12_EVIDENCE_RETENTION: "compact", V12_EVIDENCE_SAMPLE_RATE: "0", V12_LINEUP_ASSIST_APPROVAL: lineupApproval,
  };
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV12.ts")], {cwd: root, env, encoding: "utf8", stdio: "inherit"});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Lineup canary branch failed (${path.basename(target)}), exit ${result.status}`);
  function setting(key: string): string { const value = settings[key]; if (value === undefined) throw new Error(`Canary source setting is missing: ${key}`); return String(value); }
}

function report(summary: ReturnType<typeof auditLineupAssistCanary>): string { return [
  "# Lineup Assist Deployment Canary", "",
  `- Seasons: ${summary.seasons.join(", ")}`,
  `- Approval: ${summary.approvalSha256}`,
  `- Evaluated/applied: ${summary.decisions.evaluated}/${summary.decisions.applied} (${summary.decisions.applicationRate})`,
  `- Applied managers: ${summary.decisions.managersApplied}`,
  `- Direct better/neutral/worse: ${summary.direct.better}/${summary.direct.neutral}/${summary.direct.worse}`,
  `- Direct matched/lineup-divergent/missing-series: ${summary.direct.matchedApplications}/${summary.direct.lineupDivergences}/${summary.direct.missingSeries}`,
  `- Evidence p (improvement/regression): ${summary.evidence.improvementP}/${summary.evidence.regressionP}`,
  `- Conclusion/disposition: ${summary.evidence.conclusion}/${summary.evidence.disposition}`,
  `- Lineup/series/outcome divergences: ${summary.divergence.lineups}/${summary.divergence.series}/${summary.divergence.seriesOutcomes}`,
  `- Improved/neutral/worse managers by regular-season points: ${summary.outcomes.improvedManagers}/${summary.outcomes.neutralManagers}/${summary.outcomes.worseManagers}`,
  `- Control champions: ${summary.outcomes.controlChampions.join(", ")}`,
  `- Canary champions: ${summary.outcomes.canaryChampions.join(", ")}`,
  `- Safety valid: ${summary.safety.valid}`, "",
].join("\n"); }
function required(name: string): string { const value = option(name, ""); if (!value) throw new Error(`Missing ${name}`); return value; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? String(args[index + 1] ?? "") : fallback; }
function write(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function hashFile(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
