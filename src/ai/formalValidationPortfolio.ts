import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {AutonomousResearchFormalFeedback} from "./autonomousResearch";
import type {FormalValidationDomainResult} from "./formalValidation";

export interface FormalValidationGenerationSummary {
  generation: string;
  directory: string;
  freezeSha256: string;
  summarySha256: string;
  sourceBattles: number;
  experiments: number;
  domains: Array<{domainId: string; mechanismKey: string; disposition: FormalValidationDomainResult["disposition"]; cases: number; supports: number; contradictions: number; neutral: number; reasons: string[]}>;
}

export interface FormalValidationPortfolio {
  schemaVersion: 1;
  authority: "historical-validation-feedback-only";
  generations: FormalValidationGenerationSummary[];
  feedback: Record<string, AutonomousResearchFormalFeedback>;
  metrics: {generations: number; sourceBattles: number; experiments: number; mechanisms: number; dispositions: Record<string, number>};
  sha256: string;
}

export function loadFormalValidationPortfolio(root: string): FormalValidationPortfolio {
  const directories = generationDirectories(path.resolve(root)), generations: FormalValidationGenerationSummary[] = [];
  for (const directory of directories) {
    const freeze = optionalJson<any>(path.join(directory, "freeze.json")), summary = optionalJson<any>(path.join(directory, "summary.json"));
    if (!freeze || !summary || !signedCoreHealthy(freeze) || !signedCoreHealthy(summary) || summary.freezeSha256 !== freeze.sha256 || !Array.isArray(freeze.domains) || !Array.isArray(summary.domains)) continue;
    const resultById = new Map(summary.domains.map((value: any) => [String(value.domainId), value]));
    const domains = freeze.domains.flatMap((domain: any) => {
      const result: any = resultById.get(String(domain.id));
      if (!result || !["limited-canary-eligible", "rejected", "inconclusive", "blocked"].includes(result.disposition)) return [];
      return [{domainId: String(domain.id), mechanismKey: String(domain.mechanismKey), disposition: result.disposition, cases: integer(result.cases), supports: integer(result.supports), contradictions: integer(result.contradictions), neutral: integer(result.neutral), reasons: Array.isArray(result.reasons) ? result.reasons.map(String) : []}];
    });
    generations.push({generation: path.basename(directory) === path.basename(root) ? "current" : path.basename(directory), directory, freezeSha256: freeze.sha256, summarySha256: summary.sha256, sourceBattles: integer(summary.sources?.battles), experiments: integer(summary.experiments?.completed), domains});
  }
  const grouped = new Map<string, FormalValidationGenerationSummary["domains"]>();
  for (const generation of generations) for (const domain of generation.domains) grouped.set(domain.mechanismKey, [...(grouped.get(domain.mechanismKey) ?? []), domain]);
  const feedback: Record<string, AutonomousResearchFormalFeedback> = {};
  for (const [mechanismKey, rows] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const decisive = rows.filter(row => row.disposition === "limited-canary-eligible" || row.disposition === "rejected");
    const disposition = decisive.at(-1)?.disposition ?? (rows.some(row => row.disposition === "blocked") ? "blocked" : "inconclusive");
    feedback[mechanismKey] = {mechanismKey, disposition, generations: rows.length, cases: sum(rows, "cases"), supports: sum(rows, "supports"), contradictions: sum(rows, "contradictions"), neutral: sum(rows, "neutral"), reasons: [...new Set(rows.flatMap(row => row.reasons))].sort()};
  }
  const dispositions: Record<string, number> = {};
  for (const row of Object.values(feedback)) dispositions[row.disposition] = (dispositions[row.disposition] ?? 0) + 1;
  const core = {schemaVersion: 1 as const, authority: "historical-validation-feedback-only" as const, generations, feedback, metrics: {generations: generations.length, sourceBattles: generations.reduce((sum, value) => sum + value.sourceBattles, 0), experiments: generations.reduce((sum, value) => sum + value.experiments, 0), mechanisms: Object.keys(feedback).length, dispositions}};
  return {...core, sha256: canonicalSha(core)};
}

export function verifyFormalValidationPortfolio(value: FormalValidationPortfolio): void {
  const {sha256, ...core} = value;
  if (value.schemaVersion !== 1 || value.authority !== "historical-validation-feedback-only" || canonicalSha(core) !== sha256 || value.metrics.generations !== value.generations.length || value.metrics.mechanisms !== Object.keys(value.feedback).length) throw new Error("Invalid formal-validation portfolio snapshot");
}

function generationDirectories(root: string): string[] {
  const result: string[] = [];
  const archive = path.join(root, "archive");
  if (fs.existsSync(archive)) for (const entry of fs.readdirSync(archive, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) if (entry.isDirectory()) result.push(path.join(archive, entry.name));
  if (fs.existsSync(path.join(root, "freeze.json"))) result.push(root);
  return result;
}
function signedCoreHealthy(value: any): boolean { if (!value || !/^[a-f0-9]{64}$/i.test(String(value.sha256 ?? ""))) return false; const {sha256, ...core} = value; return canonicalSha(core) === sha256; }
function optionalJson<T>(file: string): T | null { try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return null; } }
function canonicalSha(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function canonical(value: any): any { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value; }
function integer(value: unknown): number { const parsed = Number(value ?? 0); return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0; }
function sum(rows: FormalValidationGenerationSummary["domains"], key: "cases" | "supports" | "contradictions" | "neutral"): number { return rows.reduce((total, row) => total + row[key], 0); }
