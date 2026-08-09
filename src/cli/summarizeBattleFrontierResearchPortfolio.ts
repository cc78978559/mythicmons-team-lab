import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {acquireNamedRunLock} from "../draft/runLock";
import {AI_VERSION} from "../showdown/choice";
import {buildEvidenceEpoch} from "../showdown/evidenceEpoch";

const args = process.argv.slice(2);
const roots = required("--research-roots").split(",").filter(Boolean).map(value => path.resolve(value));
const dispositionsFile = path.resolve(required("--dispositions"));
const out = path.resolve(required("--out"));
if (new Set(roots.map(normalized)).size !== roots.length) throw new Error("Duplicate battle research portfolio root");
const dispositions = read<any>(dispositionsFile);
if (dispositions.schemaVersion !== 1 || dispositions.activationStatus !== "shadow-only" || !Array.isArray(dispositions.dispositions)) {
  throw new Error("Invalid battle mechanism dispositions");
}
const retired = new Set<string>(dispositions.dispositions.filter((value: any) => value.status === "retired").map((value: any) => String(value.mechanismId)));
const holdoutAttempted = new Set<string>(dispositions.dispositions.filter((value: any) => value.status === "holdout-inconclusive").map((value: any) => String(value.mechanismId)));
const ids = new Set<string>();
const physical = new Set<string>();
const items: any[] = [];
const results: any[] = [];
const inputs: any[] = [];
const historicalRoots: Array<{root: string; cases: number; reason: string}> = [];
const currentPolicySha256 = buildEvidenceEpoch(AI_VERSION, "gen9ou").policySha256;

for (const root of roots) {
  const planFile = path.join(root, "battle-frontier-research-plan.json");
  const summaryFile = path.join(root, "run", "battle-frontier-summary.json");
  const plan = read<any>(planFile);
  const summary = read<any>(summaryFile);
  if (plan.schemaVersion !== 1 || plan.activationStatus !== "shadow-only" || plan.evidenceStatus !== "manager-selected-research-only"
    || plan.authority !== "no-activation-authority" || !Array.isArray(plan.items)) throw new Error(`Invalid portfolio plan: ${root}`);
  if (summary.schemaVersion !== 1 || summary.activationStatus !== "shadow-only" || summary.evidenceStatus !== "manager-selected-research-only"
    || summary.authority !== "no-activation-authority" || summary.status !== "complete" || !Array.isArray(summary.results)) {
    throw new Error(`Invalid portfolio result: ${root}`);
  }
  const byId = new Map<string, any>(plan.items.filter((value: any) => value.status === "ready").map((value: any) => [String(value.id), value]));
  const epochEligible = plan.executionStatus === "ready" && plan.evidenceEpoch?.policySha256 === currentPolicySha256 && Number(plan.evidenceEpoch?.blockedCases) === 0 && summary.evidenceEpoch?.policySha256 === currentPolicySha256;
  if (!epochEligible) historicalRoots.push({root: relative(root), cases: summary.results.length, reason: "missing or stale evidence-era binding"});
  for (const result of summary.results) {
    const id = String(result.id);
    const item = byId.get(id);
    if (!item || ids.has(id)) throw new Error(`Missing or duplicate portfolio case: ${id}`);
    const key = physicalKey(item);
    if (physical.has(key)) throw new Error(`Duplicate physical portfolio case: ${id}`);
    if (String(item.managerId) !== String(result.managerId) || String(item.mechanismId) !== String(result.mechanismId)
      || !["better", "neutral", "worse"].includes(result.direction)) throw new Error(`Portfolio case drift: ${id}`);
    ids.add(id);
    physical.add(key);
    items.push({...item, __evidenceEligible: epochEligible});
    results.push({...result, __evidenceEligible: epochEligible});
  }
  inputs.push({root: relative(root), plan: fingerprint(planFile), summary: fingerprint(summaryFile)});
}

const rulesetRemovedMechanisms = [...new Set(results.map(value => String(value.mechanismId)).filter(rulesetRemoved))].sort();
const activeHoldoutAttempted = [...holdoutAttempted].filter(value => !rulesetRemoved(value)).sort();
const activeResults = results.filter(value => value.__evidenceEligible && !retired.has(String(value.mechanismId)) && !rulesetRemoved(String(value.mechanismId)));
const mechanismIds = [...new Set(activeResults.map(value => String(value.mechanismId)))].sort();
const byMechanism = mechanismIds.map(mechanismId => {
  const rows = activeResults.filter(value => value.mechanismId === mechanismId);
  const better = rows.filter(value => value.direction === "better").length;
  const worse = rows.filter(value => value.direction === "worse").length;
  const completedHoldout = holdoutAttempted.has(mechanismId);
  return {mechanismId, cases: rows.length, managers: new Set(rows.map(value => value.managerId)).size, better,
    neutral: rows.length - better - worse, worse, completedHoldout,
    candidateForIndependentHoldout: !completedHoldout && better >= 2 && worse === 0};
});
const candidateMechanisms = byMechanism.filter(value => value.candidateForIndependentHoldout).map(value => value.mechanismId);
const activeItems = items.filter(value => value.__evidenceEligible && !retired.has(String(value.mechanismId)) && !rulesetRemoved(String(value.mechanismId))).map(({__evidenceEligible,...value})=>value);
const activePhysicalCases = new Set(activeItems.map(physicalKey)).size;
const provenance = {
  schemaVersion: 1,
  inputs,
  dispositions: fingerprint(dispositionsFile),
  implementation: fingerprint(path.join(process.cwd(), "src/cli/summarizeBattleFrontierResearchPortfolio.ts")),
  caseCorpusSha256: sha(Buffer.from(canonical(activeItems.map(value => String(value.id)).sort()))),
};
const summary = {
  schemaVersion: 1,
  activationStatus: "shadow-only",
  evidenceStatus: "manager-selected-research-only",
  authority: "no-activation-authority",
  status: "complete",
  portfolioEvidenceStatus: "cross-round-cumulative-discovery",
  byMechanism,
  candidateMechanisms,
  retiredMechanisms: [...retired].sort(),
  holdoutAttemptedMechanisms: activeHoldoutAttempted,
  rulesetRemovedMechanisms,
  historicalRoots,
  evidenceEpoch: {policySha256: currentPolicySha256, activeCases: activeResults.length, historicalCases: results.length-activeResults.length},
  provenance,
};
const plan = {
  schemaVersion: 1,
  activationStatus: "shadow-only",
  evidenceStatus: "manager-selected-research-only",
  authority: "no-activation-authority",
  portfolioEvidenceStatus: "cross-round-cumulative-discovery",
  items: activeItems,
  provenance,
};

fs.mkdirSync(out, {recursive: true});
const lock = acquireNamedRunLock(out, ".battle-research-portfolio.lock", {workflow: "battle-research-portfolio", provenance});
try {
  write(path.join(out, "battle-frontier-summary.json"), summary);
  write(path.join(out, "battle-frontier-research-plan.json"), plan);
  const compact = {schemaVersion: 1, activationStatus: "shadow-only", cases: activeResults.length,
    mechanisms: byMechanism.length, candidateMechanisms, retiredMechanisms: [...retired].sort(),
    holdoutAttemptedMechanisms: activeHoldoutAttempted, rulesetRemovedMechanisms, activePhysicalCases, allPhysicalCases: physical.size,
    historicalRoots, inputSetSha256: sha(Buffer.from(canonical(provenance)))};
  write(path.join(out, "summary.json"), {...compact, estimatedTokens: Math.ceil(Buffer.byteLength(JSON.stringify(compact)) / 4)});
  console.log(JSON.stringify({...compact, out}, null, 2));
} finally {
  lock.release();
}

function physicalKey(value: any): string { return canonical({managerId: String(value.managerId), game: normalized(String(value.game)),
  decisionOrdinal: Number(value.decisionOrdinal), side: String(value.side), selected: String(value.selected), alternative: String(value.alternative)}); }
function rulesetRemoved(mechanismId: string): boolean { return /^battle-(?:frontier|context)-tera-(?:commitment|conservation)(?:-|$)/.test(mechanismId); }
function fingerprint(file: string): {file: string; sha256: string; bytes: number} {
  const bytes = fs.readFileSync(file);
  return {file: relative(file), sha256: sha(bytes), bytes: bytes.length};
}
function relative(value: string): string { return path.relative(process.cwd(), value).replaceAll("\\", "/"); }
function normalized(value: string): string { return path.resolve(value).replaceAll("\\", "/").toLowerCase(); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function write(file: string, value: unknown): void {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}
function sha(value: Buffer): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function required(name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? String(args[index + 1] ?? "") : "";
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
