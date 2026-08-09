import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {AutonomousResearchFormalFeedback} from "./autonomousResearch";
import type {FormalValidationDomainResult} from "./formalValidation";

export interface FormalValidationGenerationSummary {
  generation: string;
  directory: string;
  archivedAt: string | null;
  freezeSha256: string;
  summarySha256: string;
  sourceBattles: number;
  experiments: number;
  formallyCompleted: boolean;
  domains: Array<{domainId: string; mechanismKey: string; semanticKey: string; disposition: FormalValidationDomainResult["disposition"]; cases: number; supports: number; contradictions: number; neutral: number; reasons: string[]; discoveryFingerprints: string[]}>;
}

export interface FormalValidationVariantFeedback {
  semanticKey: string;
  mechanismKey: string;
  disposition: FormalValidationDomainResult["disposition"];
  generations: number;
  cases: number;
  supports: number;
  contradictions: number;
  neutral: number;
  discoveryFingerprints: string[];
}

export interface FormalValidationPortfolio {
  schemaVersion: 2;
  authority: "historical-validation-feedback-only";
  generations: FormalValidationGenerationSummary[];
  feedback: Record<string, AutonomousResearchFormalFeedback>;
  variants: Record<string, FormalValidationVariantFeedback>;
  metrics: {generations: number; retainedGenerations: number; failedGenerations: number; sourceBattles: number; retainedSourceBattles: number; experiments: number; retainedExperiments: number; mechanisms: number; variants: number; dispositions: Record<string, number>};
  sha256: string;
}

export function loadFormalValidationPortfolio(root: string): FormalValidationPortfolio {
  const directories = generationDirectories(path.resolve(root)), generations: FormalValidationGenerationSummary[] = [];
  for (const entry of directories) {
    const directory = entry.directory;
    const freeze = optionalJson<any>(path.join(directory, "freeze.json")), summary = optionalJson<any>(path.join(directory, "summary.json"));
    const invalid = !freeze ? "missing freeze" : !summary ? "missing summary" : !signedCoreHealthy(freeze) ? "invalid freeze signature" : !signedCoreHealthy(summary) ? "invalid summary signature" : summary.freezeSha256 !== freeze.sha256 ? "summary/freeze binding mismatch" : !Array.isArray(freeze.domains) ? "invalid frozen domains" : !Array.isArray(summary.domains) ? "invalid summary domains" : null;
    if (invalid) throw new Error(`Invalid formal-validation generation (${invalid}): ${directory}`);
    const resultById = new Map(summary.domains.map((value: any) => [String(value.domainId), value]));
    const domains = freeze.domains.flatMap((domain: any) => {
      const result: any = resultById.get(String(domain.id));
      if (!result || !["limited-canary-eligible", "rejected", "inconclusive", "blocked"].includes(result.disposition)) return [];
      return [{domainId: String(domain.id), mechanismKey: String(domain.mechanismKey), semanticKey: String(domain.semanticKey ?? domain.mechanismKey), disposition: result.disposition, cases: integer(result.cases), supports: integer(result.supports), contradictions: integer(result.contradictions), neutral: integer(result.neutral), reasons: Array.isArray(result.reasons) ? result.reasons.map(String) : [], discoveryFingerprints: Array.isArray(domain.researchEvidence?.discoveryFingerprints) ? domain.researchEvidence.discoveryFingerprints.map(String).sort() : []}];
    });
    if (domains.length !== freeze.domains.length) throw new Error(`Incomplete formal-validation domain projection: ${directory}`);
    generations.push({generation: entry.current ? "current" : path.basename(directory), directory, archivedAt: entry.archivedAt, freezeSha256: freeze.sha256, summarySha256: summary.sha256, sourceBattles: integer(summary.sources?.battles), experiments: integer(summary.experiments?.completed), formallyCompleted: summary.formalValidationCompleted === true && summary.audit?.healthy === true, domains});
  }
  const grouped = new Map<string, FormalValidationGenerationSummary["domains"]>();
  for (const generation of generations.filter(value => value.formallyCompleted)) for (const domain of generation.domains) grouped.set(domain.mechanismKey, [...(grouped.get(domain.mechanismKey) ?? []), domain]);
  const feedback: Record<string, AutonomousResearchFormalFeedback> = {};
  for (const [mechanismKey, rows] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const decisive = rows.filter(row => row.disposition === "limited-canary-eligible" || row.disposition === "rejected");
    const disposition = decisive.at(-1)?.disposition ?? (rows.some(row => row.disposition === "blocked") ? "blocked" : "inconclusive");
    feedback[mechanismKey] = {mechanismKey, disposition, generations: rows.length, cases: sum(rows, "cases"), supports: sum(rows, "supports"), contradictions: sum(rows, "contradictions"), neutral: sum(rows, "neutral"), reasons: [...new Set(rows.flatMap(row => row.reasons))].sort()};
  }
  const variantGroups = new Map<string, FormalValidationGenerationSummary["domains"]>();
  for (const generation of generations.filter(value => value.formallyCompleted)) for (const domain of generation.domains) variantGroups.set(domain.semanticKey, [...(variantGroups.get(domain.semanticKey) ?? []), domain]);
  const variants: Record<string, FormalValidationVariantFeedback> = {};
  for (const [semanticKey, rows] of [...variantGroups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const latest = rows.at(-1)!;
    variants[semanticKey] = {semanticKey, mechanismKey: latest.mechanismKey, disposition: latest.disposition, generations: rows.length, cases: sum(rows, "cases"), supports: sum(rows, "supports"), contradictions: sum(rows, "contradictions"), neutral: sum(rows, "neutral"), discoveryFingerprints: [...new Set(rows.flatMap(row => row.discoveryFingerprints))].sort()};
  }
  const dispositions: Record<string, number> = {};
  for (const row of Object.values(feedback)) dispositions[row.disposition] = (dispositions[row.disposition] ?? 0) + 1;
  const healthy = generations.filter(value => value.formallyCompleted);
  const core = {schemaVersion: 2 as const, authority: "historical-validation-feedback-only" as const, generations, feedback, variants, metrics: {generations: healthy.length, retainedGenerations: generations.length, failedGenerations: generations.length - healthy.length, sourceBattles: healthy.reduce((sum, value) => sum + value.sourceBattles, 0), retainedSourceBattles: generations.reduce((sum, value) => sum + value.sourceBattles, 0), experiments: healthy.reduce((sum, value) => sum + value.experiments, 0), retainedExperiments: generations.reduce((sum, value) => sum + value.experiments, 0), mechanisms: Object.keys(feedback).length, variants: Object.keys(variants).length, dispositions}};
  return {...core, sha256: canonicalSha(core)};
}

export function verifyFormalValidationPortfolio(value: FormalValidationPortfolio): void {
  const {sha256, ...core} = value;
  const healthy = value.generations.filter(generation => generation.formallyCompleted);
  if (value.schemaVersion !== 2 || value.authority !== "historical-validation-feedback-only" || canonicalSha(core) !== sha256 || value.metrics.generations !== healthy.length || value.metrics.retainedGenerations !== value.generations.length || value.metrics.failedGenerations !== value.generations.length - healthy.length || value.metrics.mechanisms !== Object.keys(value.feedback).length || value.metrics.variants !== Object.keys(value.variants).length) throw new Error("Invalid formal-validation portfolio snapshot");
}

function generationDirectories(root: string): Array<{directory: string; archivedAt: string | null; current: boolean}> {
  const result: Array<{directory: string; archivedAt: string | null; current: boolean}> = [];
  const archive = path.join(root, "archive");
  if (fs.existsSync(archive)) for (const entry of fs.readdirSync(archive, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(archive, entry.name), manifest = optionalJson<any>(path.join(directory, "archive-manifest.json")), hasFormalFiles = fs.existsSync(path.join(directory, "freeze.json")) || fs.existsSync(path.join(directory, "summary.json")), planned = Array.isArray(manifest?.planned) ? manifest.planned.map(String) : [], formalGeneration = hasFormalFiles || planned.includes("freeze.json") || planned.includes("summary.json");
    if (!formalGeneration) continue;
    if (manifest?.schemaVersion !== 1 || manifest?.state !== "complete" || !validTimestamp(manifest.archivedAt) || !Array.isArray(manifest.moved) || !["freeze.json", "summary.json"].every(name => planned.includes(name) && manifest.moved.includes(name))) throw new Error(`Invalid formal-validation archive manifest: ${directory}`);
    result.push({directory, archivedAt: manifest.archivedAt, current: false});
  }
  result.sort((left, right) => Date.parse(left.archivedAt!) - Date.parse(right.archivedAt!) || left.directory.localeCompare(right.directory));
  if (fs.existsSync(path.join(root, "freeze.json")) || fs.existsSync(path.join(root, "summary.json"))) result.push({directory: root, archivedAt: null, current: true});
  return result;
}
function signedCoreHealthy(value: any): boolean { if (!value || !/^[a-f0-9]{64}$/i.test(String(value.sha256 ?? ""))) return false; const {sha256, ...core} = value; return canonicalSha(core) === sha256; }
function optionalJson<T>(file: string): T | null { try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return null; } }
function canonicalSha(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function canonical(value: any): any { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value; }
function integer(value: unknown): number { const parsed = Number(value ?? 0); return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0; }
function validTimestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function sum(rows: FormalValidationGenerationSummary["domains"], key: "cases" | "supports" | "contradictions" | "neutral"): number { return rows.reduce((total, row) => total + row[key], 0); }
