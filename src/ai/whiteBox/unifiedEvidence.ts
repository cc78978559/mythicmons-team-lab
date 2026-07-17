import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {reviewWhiteBoxDifferences, type WhiteBoxDifferenceCase} from "./review";
import {whiteBoxExperimentEligibility} from "./sampling";

export type UnifiedEvidenceStatus = "executable" | "requires-gate" | "archive-only";
export type UnifiedEvidenceRunner = "general" | "lineup" | null;

export interface UnifiedEvidenceCase {
  id: string;
  root: string;
  sourceSeed: string;
  sourceSeason: number;
  reviewIndex: number;
  decisionId: string;
  domain: string;
  actor: string;
  season: number | null;
  classification: WhiteBoxDifferenceCase["classification"];
  incumbent: string;
  shadow: string;
  impact: number;
  priority: number;
  fingerprint: string;
  duplicates: number;
  duplicateCaseIds: string[];
  status: UnifiedEvidenceStatus;
  runner: UnifiedEvidenceRunner;
  reasons: string[];
  selected: boolean;
}

export interface UnifiedEvidencePlan {
  schemaVersion: 1;
  createdAt: string;
  config: {maximumCases: number; maximumPerDomain: number; minimumImpact: number};
  sources: Array<{root: string; seed: string; completedSeason: number; comparisons: number; agreements: number; differences: number; battleTraceFiles: number; battleComparisons: number; battleDifferences: number; battleEvidence: "available" | "legacy-without-whitebox" | "not-retained"}>;
  metrics: {
    scanned: number;
    afterImpactFilter: number;
    uniqueFingerprints: number;
    selected: number;
    executable: number;
    requiresGate: number;
    archiveOnly: number;
    byDomain: Record<string, number>;
    selectedByDomain: Record<string, number>;
  };
  cases: UnifiedEvidenceCase[];
}

export function buildUnifiedEvidencePlan(inputs: readonly string[], options: {maximumCases?: number; maximumPerDomain?: number; minimumImpact?: number} = {}): UnifiedEvidencePlan {
  const maximumCases = integer(options.maximumCases ?? 60, 1, 10000, "maximumCases");
  const maximumPerDomain = integer(options.maximumPerDomain ?? 10, 1, 1000, "maximumPerDomain");
  const minimumImpact = finite(options.minimumImpact ?? 0, 0, 1e9, "minimumImpact");
  if (!inputs.length) throw new Error("Unified evidence planning requires at least one dynasty root");
  const sources: UnifiedEvidencePlan["sources"] = [], raw: UnifiedEvidenceCase[] = [];
  for (const input of [...new Set(inputs.map(value => path.resolve(value)))]) {
    const review = reviewWhiteBoxDifferences(input);
    const state = readJson<{seed?: unknown; completedSeason?: unknown}>(path.join(input, "dynasty-state.json"));
    const seed = String(state.seed ?? "unknown"), completedSeason = Number(state.completedSeason ?? 0);
    review.cases.forEach((entry, index) => raw.push(toEvidenceCase(input, seed, completedSeason, entry, index + 1)));
    const battle = collectBattleCases(input, seed, completedSeason);
    raw.push(...battle.cases);
    const battleEvidence = battle.comparisons ? "available" : battle.files ? "legacy-without-whitebox" : "not-retained";
    sources.push({root: input, seed, completedSeason, comparisons: review.comparisons, agreements: review.agreements, differences: review.cases.length, battleTraceFiles: battle.files, battleComparisons: battle.comparisons, battleDifferences: battle.cases.length, battleEvidence});
  }
  const filtered = raw.filter(entry => entry.impact >= minimumImpact);
  const grouped = new Map<string, UnifiedEvidenceCase[]>();
  for (const entry of filtered) grouped.set(entry.fingerprint, [...(grouped.get(entry.fingerprint) ?? []), entry]);
  const unique = [...grouped.values()].map(group => {
    const ranked = [...group].sort(comparePriority), representative = ranked[0];
    return {...representative, duplicates: group.length, duplicateCaseIds: ranked.slice(1).map(entry => entry.id)};
  }).sort(comparePriority);
  const domainCounts = new Map<string, number>();
  let selected = 0;
  for (const entry of unique) {
    const count = domainCounts.get(entry.domain) ?? 0;
    entry.selected = selected < maximumCases && count < maximumPerDomain;
    if (entry.selected) { selected += 1; domainCounts.set(entry.domain, count + 1); }
  }
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    config: {maximumCases, maximumPerDomain, minimumImpact},
    sources,
    metrics: {
      scanned: raw.length,
      afterImpactFilter: filtered.length,
      uniqueFingerprints: unique.length,
      selected,
      executable: unique.filter(entry => entry.status === "executable").length,
      requiresGate: unique.filter(entry => entry.status === "requires-gate").length,
      archiveOnly: unique.filter(entry => entry.status === "archive-only").length,
      byDomain: countBy(unique.map(entry => entry.domain)),
      selectedByDomain: countBy(unique.filter(entry => entry.selected).map(entry => entry.domain)),
    },
    cases: unique,
  };
}

function collectBattleCases(root: string, seed: string, sourceSeason: number): {files: number; comparisons: number; cases: UnifiedEvidenceCase[]} {
  const files = findNamedFiles(root, "ai-decisions.json"), cases: UnifiedEvidenceCase[] = [];
  let comparisons = 0;
  for (const file of files) {
    const traces = readJson<any[]>(file);
    for (const trace of traces) {
      const shadow = trace?.whiteBoxShadow, comparison = shadow?.comparison, decision = shadow?.trace;
      if (!comparison || !decision || !Array.isArray(decision.candidates)) continue;
      comparisons += 1;
      if (comparison.agrees || !comparison.shadow) continue;
      const incumbent = decision.candidates.find((candidate: any) => candidate.id === comparison.incumbent) ?? null;
      const candidate = decision.candidates.find((value: any) => value.id === comparison.shadow) ?? null;
      const classification: WhiteBoxDifferenceCase["classification"] = !incumbent || !candidate ? "missing-candidate" : !incumbent.eligible ? "illegal-incumbent" : incumbent.reasonable ? "reasonable-style-choice" : "rational-correction";
      const rationalDelta = numericDelta(incumbent?.rationalScore, candidate?.rationalScore), finalDelta = numericDelta(incumbent?.finalScore, candidate?.finalScore);
      const impact = round(Math.abs(rationalDelta ?? 0) + Math.abs(finalDelta ?? 0) * .5);
      const classWeight = classification === "illegal-incumbent" ? 400 : classification === "rational-correction" ? 200 : classification === "reasonable-style-choice" ? 100 : 0;
      const relative = path.relative(root, file).replaceAll("\\", "/"), season = seasonFromPath(relative);
      const fingerprint = digest(["battle", classification, comparison.incumbent, comparison.shadow, incumbent?.contributions?.slice(0, 4).map((value: any) => value.id).join(",") ?? ""].join("|"));
      const id = digest([root, relative, trace.turn, trace.playerId, comparison.incumbent, comparison.shadow].join("|"));
      cases.push({id, root, sourceSeed: seed, sourceSeason, reviewIndex: 0, decisionId: String(decision.decisionId ?? `battle:${relative}:${trace.turn}:${trace.playerId}`), domain: "battle", actor: String(trace.personalityId ?? trace.playerId ?? "unknown"), season, classification, incumbent: String(comparison.incumbent), shadow: String(comparison.shadow), impact, priority: round(classWeight + 15 + impact + Math.max(0, season ?? 0) * .01), fingerprint, duplicates: 1, duplicateCaseIds: [], status: "requires-gate", runner: null, reasons: classification === "missing-candidate" ? ["incomplete-candidate-evidence"] : ["battle-requires-match-level-replay-gate"], selected: false});
    }
  }
  return {files: files.length, comparisons, cases};
}

export function unifiedEvidenceMarkdown(plan: UnifiedEvidencePlan): string {
  const m = plan.metrics;
  const lines = ["# 统一白箱反事实证据清单", "", `- 来源：${plan.sources.length}`, `- 扫描差异：${m.scanned}`, `- 去重后：${m.uniqueFingerprints}`, `- 入选：${m.selected}`, `- 可执行/需门禁/仅归档：${m.executable}/${m.requiresGate}/${m.archiveOnly}`, "", "| 优先级 | 领域 | 状态 | 赛季 | 经理 | 旧方案 | 白箱方案 | 重复 |", "|---:|---|---|---:|---|---|---|---:|"];
  for (const entry of plan.cases.filter(entry => entry.selected)) lines.push(`| ${entry.priority.toFixed(2)} | ${entry.domain} | ${entry.status} | ${entry.season ?? "-"} | ${entry.actor} | ${entry.incumbent} | ${entry.shadow} | ${entry.duplicates} |`);
  lines.push("", "`executable` 只表示已有隔离重放器和必要门禁；不会自动改变正式联赛。运行实验仍需显式 `--run`。", "");
  return lines.join("\n");
}

function toEvidenceCase(root: string, seed: string, sourceSeason: number, entry: WhiteBoxDifferenceCase, reviewIndex: number): UnifiedEvidenceCase {
  const domain = detailedDomain(entry.decisionId);
  const eligibility = whiteBoxExperimentEligibility(entry);
  let status: UnifiedEvidenceStatus = eligibility.eligible ? "executable" : "archive-only";
  let runner: UnifiedEvidenceRunner = eligibility.eligible ? "general" : null;
  let reasons = [...eligibility.reasons];
  if (domain === "lineup") { status = "requires-gate"; runner = "lineup"; reasons = ["lineup-requires-scenario-and-assist-gate"]; }
  else if (entry.classification === "missing-candidate") { status = "archive-only"; runner = null; reasons = ["incomplete-candidate-evidence"]; }
  const impact = round(Math.abs(entry.counterfactual.rationalDelta ?? 0) + Math.abs(entry.counterfactual.finalDelta ?? 0) * .5 + Math.min(5, entry.counterfactual.contributionDeltas.reduce((sum, value) => sum + Math.abs(value.delta), 0) * .2));
  const classWeight = entry.classification === "illegal-incumbent" ? 400 : entry.classification === "rational-correction" ? 200 : entry.classification === "reasonable-style-choice" ? 100 : 0;
  const statusWeight = status === "executable" ? 40 : status === "requires-gate" ? 15 : 0;
  const priority = round(classWeight + statusWeight + impact + Math.max(0, entry.season ?? 0) * .01);
  const fingerprint = digest([domain, entry.classification, entry.incumbent, entry.shadow, entry.counterfactual.added.join(","), entry.counterfactual.removed.join(","), entry.counterfactual.contributionDeltas.slice(0, 4).map(value => value.id).join(",")].join("|"));
  const id = digest([root, entry.decisionId, entry.actor, entry.incumbent, entry.shadow, entry.source].join("|"));
  return {id, root, sourceSeed: seed, sourceSeason, reviewIndex, decisionId: entry.decisionId, domain, actor: entry.actor, season: entry.season, classification: entry.classification, incumbent: entry.incumbent, shadow: entry.shadow, impact, priority, fingerprint, duplicates: 1, duplicateCaseIds: [], status, runner, reasons, selected: false};
}

function detailedDomain(decisionId: string): string {
  if (decisionId.startsWith("lineup:")) return "lineup";
  if (decisionId.startsWith("keeper:")) return "keeper";
  if (decisionId.startsWith("bid:")) return "auction";
  if (decisionId.startsWith("acquire:")) return "acquisition";
  if (decisionId.startsWith("market:trade:")) return "trade";
  if (decisionId.startsWith("market:background-")) return "background-market";
  if (decisionId.startsWith("market:waiver-")) return "waiver";
  if (decisionId.startsWith("market:free-agent-")) return "free-agent";
  return decisionId.split(":", 1)[0] || "unknown";
}

function comparePriority(left: UnifiedEvidenceCase, right: UnifiedEvidenceCase): number { return right.priority - left.priority || right.impact - left.impact || left.id.localeCompare(right.id); }
function countBy(values: string[]): Record<string, number> { const result: Record<string, number> = {}; for (const value of values) result[value] = (result[value] ?? 0) + 1; return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b))); }
function digest(value: string): string { return crypto.createHash("sha256").update(value).digest("hex").slice(0, 20); }
function findNamedFiles(directory: string, name: string): string[] { const files: string[] = []; if (!fs.existsSync(directory)) return files; for (const entry of fs.readdirSync(directory, {withFileTypes: true})) { const target = path.join(directory, entry.name); if (entry.isDirectory()) files.push(...findNamedFiles(target, name)); else if (entry.name === name) files.push(target); } return files; }
function seasonFromPath(value: string): number | null { const match = value.match(/(?:^|\/)season-(\d+)(?:\/|$)/); return match ? Number(match[1]) : null; }
function numericDelta(before: unknown, after: unknown): number | null { return typeof before === "number" && Number.isFinite(before) && typeof after === "number" && Number.isFinite(after) ? round(after - before) : null; }
function readJson<T>(file: string): T { if (!fs.existsSync(file)) throw new Error(`Missing evidence input: ${file}`); return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function integer(value: number, min: number, max: number, name: string): number { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function finite(value: number, min: number, max: number, name: string): number { if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
