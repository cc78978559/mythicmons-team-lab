import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {aggregateBattleCounterfactuals} from "../ai/whiteBox/battleAggregation";
import {AI_VERSION} from "../showdown/choice";
import {buildEvidenceEpoch} from "../showdown/evidenceEpoch";

interface HoldoutItem {
  id: string;
  status: string;
  managerId: string;
  mechanismId: string;
  game: string;
  decisionOrdinal: number;
  side: string;
  selected: string;
  alternative: string;
  replaySha256: string;
  provenance: {manifest: string; manifestSha256: string; runId: string; completedAt: string};
}

const args = process.argv.slice(2);
const freezeFile = path.resolve(required("--freeze"));
const planFile = path.resolve(required("--plan"));
const runDirectory = path.resolve(required("--run"));
const out = path.resolve(required("--out"));
const freeze = read<any>(freezeFile);
const plan = read<any>(planFile);
const runSummaryFile = path.join(runDirectory, "battle-frontier-summary.json");
const runSummary = read<any>(runSummaryFile);

validateProtocol();
const ready = validatePlanAndRun();
const battleSeedById = validateProspectiveSources(ready);
const samples = validateCounterfactuals(ready, battleSeedById);

const gate = freeze.successGate;
const aggregate = aggregateBattleCounterfactuals(samples, {
  minimumSamples: Number(freeze.sampling.targetCases),
  minimumSeeds: Number(freeze.sampling.minimumIndependentBattleSeeds),
  minimumDecisivePairs: Number(gate.minimumOutcomeChangingPairs),
  minimumDecisiveSeeds: Number(gate.minimumDirectionalSeedClusters),
  maximumOneSidedP: Number(gate.maximumOneSidedImprovementP),
});
const conclusion = aggregate.promotion === "candidate-for-assist"
  ? "candidate-for-activation-review"
  : aggregate.promotion === "reject-hypothesis" ? "reject-hypothesis" : "blocked-or-inconclusive";
const result = {
  schemaVersion: 1,
  activationStatus: "shadow-only",
  evidenceStatus: "prospective-independent-holdout",
  authority: "review-only-no-automatic-activation",
  evidenceEpoch: {policySha256: buildEvidenceEpoch(AI_VERSION, "gen9ou").policySha256, formalActivationAllowed: true},
  mechanismId: freeze.mechanismId,
  conclusion,
  activationEligible: aggregate.promotion === "candidate-for-assist",
  disposition: aggregate.promotion === "reject-hypothesis" ? "retire-mechanism" : "retain-shadow",
  inputs: {freezeSha256: shaFile(freezeFile), planSha256: shaFile(planFile), runSummarySha256: shaFile(runSummaryFile)},
  aggregate,
};
fs.mkdirSync(out, {recursive: true});
write(path.join(out, "battle-frontier-holdout-audit.json"), result);
const compact = {
  schemaVersion: 1,
  activationStatus: "shadow-only",
  mechanismId: freeze.mechanismId,
  conclusion,
  activationEligible: result.activationEligible,
  disposition: result.disposition,
  metrics: aggregate.metrics,
  issues: aggregate.issues,
  estimatedTokens: Math.ceil(Buffer.byteLength(JSON.stringify({
    mechanismId: freeze.mechanismId,
    conclusion,
    activationEligible: result.activationEligible,
    disposition: result.disposition,
    metrics: aggregate.metrics,
    issues: aggregate.issues,
  })) / 4),
};
write(path.join(out, "summary.json"), compact);
console.log(JSON.stringify(compact, null, 2));

function validateProtocol(): void {
  const currentPolicySha256 = buildEvidenceEpoch(AI_VERSION, "gen9ou").policySha256;
  if (freeze.evidenceStatus !== "prospective-independent-holdout"
    || freeze.authority !== "no-activation-authority"
    || plan.holdoutEvidenceStatus !== "prospective-independent-holdout"
    || plan.executionStatus !== "ready"
    || runSummary.status !== "complete" || freeze.evidenceEpoch?.policySha256 !== currentPolicySha256 || plan.evidenceEpoch?.policySha256 !== currentPolicySha256 || Number(plan.evidenceEpoch?.blockedCases) !== 0 || runSummary.evidenceEpoch?.policySha256 !== currentPolicySha256) throw new Error("Invalid, incomplete, or stale battle frontier holdout inputs");
  if (freeze.sha256 !== shaCanonical({...freeze, sha256: undefined}) || !Number.isFinite(Date.parse(freeze.frozenAt))) {
    throw new Error("Holdout freeze signature is invalid");
  }
  if (plan.freeze?.protocolSha256 !== freeze.sha256 || plan.freeze?.sha256 !== shaFile(freezeFile)) {
    throw new Error("Holdout plan is not bound to the frozen protocol");
  }
  for (const input of [
    plan.frontier,
    {file: freeze.discovery.result, sha256: freeze.discovery.resultSha256},
    {file: freeze.discovery.plan, sha256: freeze.discovery.planSha256},
  ]) {
    const file = path.resolve(String(input?.file ?? ""));
    if (!input?.sha256 || !fs.existsSync(file) || shaFile(file) !== input.sha256) {
      throw new Error(`Holdout upstream evidence drifted: ${file}`);
    }
  }
}

function validatePlanAndRun(): HoldoutItem[] {
  const runState = read<any>(path.join(runDirectory, "battle-frontier-run.json"));
  if (runState.status !== "complete" || runState.plan?.sha256 !== shaFile(planFile)
    || path.resolve(String(runState.plan?.file ?? "")) !== planFile) throw new Error("Holdout run is not bound to this plan");
  const ready = (plan.items ?? []).filter((value: HoldoutItem) => value.status === "ready") as HoldoutItem[];
  const ids = ready.map(value => value.id);
  if (ready.length !== Number(freeze.sampling.targetCases)) throw new Error("Holdout plan does not satisfy the frozen sample target");
  if (new Set(ids).size !== ids.length) throw new Error("Holdout plan reuses a case id");
  const excluded = new Set<string>(freeze.exclusions?.replayInputSha256 ?? []);
  if (ready.some(value => excluded.has(value.replaySha256))) throw new Error("Discovery replay leaked into holdout");
  if (new Set(ready.map(value => value.replaySha256)).size !== ready.length) throw new Error("Holdout reuses a replay file");
  assertExactCoverage("run state", ids, runState.items ?? [], true);
  assertExactCoverage("summary", ids, runSummary.results ?? [], false);
  return ready;
}

function validateProspectiveSources(ready: HoldoutItem[]): Map<string, string> {
  const battleSeedById = new Map<string, string>();
  for (const item of ready) {
    const game = path.resolve(item.game);
    const replay = path.join(game, "replay-input.json");
    const manifestFile = path.resolve(String(item.provenance?.manifest ?? ""));
    if (!fs.existsSync(replay) || shaFile(replay) !== item.replaySha256
      || !fs.existsSync(manifestFile) || shaFile(manifestFile) !== item.provenance?.manifestSha256) {
      throw new Error(`Holdout source provenance drifted: ${item.id}`);
    }
    const battleSeed = String(read<any>(replay).sha256 ?? "");
    if (!/^[a-f0-9]{64}$/.test(battleSeed)) throw new Error(`Holdout replay capsule lacks a semantic hash: ${item.id}`);
    battleSeedById.set(item.id, battleSeed);
    const manifest = read<any>(manifestFile);
    const expansionRun = (manifest.runs ?? []).find((value: any) => String(value.id) === item.provenance.runId);
    if (!expansionRun || expansionRun.status !== "complete" || path.resolve(String(expansionRun.directory)) !== game
      || String(expansionRun.completedAt) !== item.provenance.completedAt
      || Date.parse(item.provenance.completedAt) <= Date.parse(freeze.frozenAt)) {
      throw new Error(`Holdout source is not prospectively generated: ${item.id}`);
    }
    const row = (runSummary.results ?? []).find((value: any) => String(value.id) === item.id);
    if (row.managerId !== item.managerId || row.mechanismId !== item.mechanismId) {
      throw new Error(`Holdout result attribution drifted: ${item.id}`);
    }
  }
  if (new Set(battleSeedById.values()).size !== ready.length) throw new Error("Holdout reuses a semantic battle seed");
  return battleSeedById;
}

function validateCounterfactuals(ready: HoldoutItem[], battleSeedById: Map<string, string>): any[] {
  return ready.map(item => {
    const summary = read<any>(path.join(runDirectory, "runs", item.id, "counterfactual-summary.json"));
    if (summary.sourceVerified !== true || summary.prefixVerified !== true || summary.activationAllowed !== false
      || summary.evidenceStatus !== "manager-selected-research-only"
      || summary.replayInputSha256 !== battleSeedById.get(item.id)
      || path.resolve(String(summary.sourceGame)) !== path.resolve(item.game)
      || summary.intervention?.decisionOrdinal !== item.decisionOrdinal || summary.intervention?.playerId !== item.side
      || summary.intervention?.expectedIncumbent !== item.selected || summary.intervention?.selected !== item.alternative) {
      throw new Error(`Invalid or misattributed holdout case: ${item.id}`);
    }
    for (const battle of [summary.incumbent, summary.whitebox]) {
      if (battle?.ended !== true || battle?.stalled === true || battle?.timeout === true || (battle?.errors ?? []).length) {
        throw new Error(`Technically invalid holdout battle: ${item.id}`);
      }
    }
    return {seed: battleSeedById.get(item.id)!, caseId: item.id, sourceVerified: true, prefixVerified: true,
      playerId: summary.intervention.playerId, incumbent: summary.incumbent, whitebox: summary.whitebox};
  });
}

function assertExactCoverage(label: string, expectedIds: string[], rows: any[], requireComplete: boolean): void {
  const ids = rows.map(value => String(value.id));
  if (rows.length !== expectedIds.length || new Set(ids).size !== expectedIds.length
    || expectedIds.some(id => !ids.includes(id)) || (requireComplete && rows.some(value => value.status !== "complete"))) {
    throw new Error(`Holdout ${label} does not cover the frozen plan exactly once`);
  }
}

function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function shaFile(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function shaCanonical(value: unknown): string { return crypto.createHash("sha256").update(Buffer.from(canonical(value))).digest("hex"); }
function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function write(file: string, value: unknown): void {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}
function required(name: string): string {
  const value = option(name, "");
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
function option(name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] ?? fallback) : fallback;
}
