import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const BENCHMARK_FAMILY_VERSION = "benchmark-families-v1";
export const BENCHMARK_ARCHETYPES = ["balance", "bulky-offense", "hyper-offense", "stall", "semi-stall", "hazard-stack", "hazard-control", "pivot-offense", "rain", "sun", "sand-snow", "trick-room", "screens", "setup-offense", "priority-offense", "mixed-tempo"] as const;
export const BENCHMARK_ENVIRONMENTS = ["modern-standard", "ordinary-depth", "unrestricted", "combined"] as const;
export type BenchmarkArchetype = typeof BENCHMARK_ARCHETYPES[number];
export type BenchmarkEnvironment = typeof BENCHMARK_ENVIRONMENTS[number];
export type BenchmarkSplit = "train" | "validation" | "test" | "holdout";

export interface BenchmarkFamilyVariant {id: string; team: string; sha256: string}
export interface BenchmarkFamily {
  id: string;
  split: BenchmarkSplit;
  environment: BenchmarkEnvironment;
  archetype: BenchmarkArchetype;
  source: "random-battle" | "restricted-composition" | "combined-current-assets";
  variants: BenchmarkFamilyVariant[];
}
export interface BenchmarkFamilyRegistry {
  schemaVersion: 1;
  version: typeof BENCHMARK_FAMILY_VERSION;
  id: string;
  format: string;
  families: BenchmarkFamily[];
  sha256: string;
}
export interface BenchmarkPair {id: string; split: Exclude<BenchmarkSplit, "holdout">; leftFamilyId: string; rightFamilyId: string}
export interface BenchmarkFamilySchedule {
  schemaVersion: 1;
  version: typeof BENCHMARK_FAMILY_VERSION;
  registrySha256: string;
  settings: {trainDegree: 14; validationMode: "round-robin"; testMode: "round-robin"; seeds: 3; orientations: 2};
  pairs: BenchmarkPair[];
  sha256: string;
}
export interface BenchmarkBattleEvidence {
  schemaVersion: 1;
  version: typeof BENCHMARK_FAMILY_VERSION;
  registrySha256: string;
  scheduleSha256: string;
  pairClusterId: string;
  split: BenchmarkSplit;
  authority?: "research" | "formal-holdout-only";
  familyIds: [string, string];
  environment: string;
  variants: [string, string];
  sha256: string;
}

export function signFamilyRegistry(core: Omit<BenchmarkFamilyRegistry, "sha256">): BenchmarkFamilyRegistry { return {...core, sha256: canonicalSha(core)}; }
export function signFamilySchedule(core: Omit<BenchmarkFamilySchedule, "sha256">): BenchmarkFamilySchedule { return {...core, sha256: canonicalSha(core)}; }
export function signBattleFamilyEvidence(core: Omit<BenchmarkBattleEvidence, "sha256">): BenchmarkBattleEvidence { return {...core, sha256: canonicalSha(core)}; }
export function benchmarkPairClusterId(split: BenchmarkSplit, familyIds: readonly [string, string]): string { const [left, right] = [...familyIds].sort(); return `${split}:${split}-${left}--${right}`; }
export function verifyBattleFamilyEvidence(value: BenchmarkBattleEvidence): void { const {sha256, ...core} = value; if (value.schemaVersion !== 1 || value.version !== BENCHMARK_FAMILY_VERSION || !hexSha(sha256) || canonicalSha(core) !== sha256 || value.familyIds.length !== 2 || value.familyIds[0] === value.familyIds[1] || value.pairClusterId !== benchmarkPairClusterId(value.split, value.familyIds) || value.variants.length !== 2 || value.variants.some(variant => !variant)) throw new Error("Invalid signed benchmark battle evidence"); }

export function buildFamilySchedule(registry: BenchmarkFamilyRegistry): BenchmarkFamilySchedule {
  verifyFamilyRegistry(registry);
  const pairs: BenchmarkPair[] = [];
  for (const split of ["train", "validation", "test"] as const) {
    const ids = registry.families.filter(family => family.split === split).map(family => family.id).sort();
    if (split === "train") {
      for (let left = 0; left < ids.length; left += 1) for (let offset = 1; offset <= 7; offset += 1) {
        const right = (left + offset) % ids.length;
        addPair(pairs, split, ids[left], ids[right]);
      }
    } else for (let left = 0; left < ids.length; left += 1) for (let right = left + 1; right < ids.length; right += 1) addPair(pairs, split, ids[left], ids[right]);
  }
  const core: Omit<BenchmarkFamilySchedule, "sha256"> = {schemaVersion: 1, version: BENCHMARK_FAMILY_VERSION, registrySha256: registry.sha256, settings: {trainDegree: 14, validationMode: "round-robin", testMode: "round-robin", seeds: 3, orientations: 2}, pairs: pairs.sort((left, right) => left.id.localeCompare(right.id))};
  return signFamilySchedule(core);
}

export function verifyFamilyRegistry(value: BenchmarkFamilyRegistry, root?: string): void {
  const {sha256, ...core} = value;
  if (value.schemaVersion !== 1 || value.version !== BENCHMARK_FAMILY_VERSION || canonicalSha(core) !== sha256 || value.families.length !== 88) throw new Error("Invalid benchmark family registry envelope");
  if (new Set(value.families.map(family => family.id)).size !== value.families.length) throw new Error("Duplicate benchmark family id");
  const splitCounts = counts(value.families.map(family => family.split));
  if (splitCounts.train !== 32 || splitCounts.validation !== 16 || splitCounts.test !== 16 || splitCounts.holdout !== 24) throw new Error(`Invalid family split counts: ${JSON.stringify(splitCounts)}`);
  const research = value.families.filter(family => family.split !== "holdout"), archetypes = counts(research.map(family => family.archetype));
  if (BENCHMARK_ARCHETYPES.some(archetype => archetypes[archetype] !== 4)) throw new Error("Research archetypes must each contain four independent families");
  const expectedEnvironment: Record<BenchmarkEnvironment, number> = {"modern-standard": 24, "ordinary-depth": 16, unrestricted: 8, combined: 16}, environmentCounts = counts(research.map(family => family.environment));
  if (BENCHMARK_ENVIRONMENTS.some(environment => environmentCounts[environment] !== expectedEnvironment[environment])) throw new Error(`Invalid research environment counts: ${JSON.stringify(environmentCounts)}`);
  const holdoutCounts = counts(value.families.filter(family => family.split === "holdout").map(family => family.environment));
  if (holdoutCounts["modern-standard"] !== 6 || holdoutCounts.unrestricted !== 6 || holdoutCounts.combined !== 12 || Object.keys(holdoutCounts).length !== 3) throw new Error(`Invalid holdout environment counts: ${JSON.stringify(holdoutCounts)}`);
  const variantHashes = new Set<string>();
  for (const family of value.families) {
    if (!BENCHMARK_ARCHETYPES.includes(family.archetype) || !BENCHMARK_ENVIRONMENTS.includes(family.environment) || family.variants.length !== 2 || new Set(family.variants.map(variant => variant.id)).size !== 2) throw new Error(`Invalid benchmark family: ${family.id}`);
    for (const variant of family.variants) {
      if (!variant.id || !variant.team || !/^[a-f0-9]{64}$/i.test(variant.sha256) || variantHashes.has(variant.sha256)) throw new Error(`Invalid or duplicate benchmark variant: ${family.id}/${variant.id}`);
      variantHashes.add(variant.sha256);
      if (root) { const file = path.resolve(root, ...variant.team.split("/")); if (!fs.existsSync(file) || fileSha256(file) !== variant.sha256) throw new Error(`Benchmark variant drift: ${family.id}/${variant.id}`); }
    }
  }
}

export function verifyFamilySchedule(value: BenchmarkFamilySchedule, registry: BenchmarkFamilyRegistry): void {
  const {sha256, ...core} = value;
  if (value.schemaVersion !== 1 || value.version !== BENCHMARK_FAMILY_VERSION || canonicalSha(core) !== sha256 || value.registrySha256 !== registry.sha256 || value.pairs.length !== 464) throw new Error("Invalid benchmark family schedule envelope");
  if (new Set(value.pairs.map(pair => pair.id)).size !== value.pairs.length) throw new Error("Duplicate benchmark family pair");
  const familyById = new Map(registry.families.map(family => [family.id, family]));
  for (const pair of value.pairs) { const left = familyById.get(pair.leftFamilyId), right = familyById.get(pair.rightFamilyId); if (!left || !right || left.id === right.id || left.split !== pair.split || right.split !== pair.split || pair.id !== pairId(pair.split, left.id, right.id)) throw new Error(`Invalid benchmark pair: ${pair.id}`); }
  const degrees = new Map<string, number>(); for (const pair of value.pairs.filter(pair => pair.split === "train")) { degrees.set(pair.leftFamilyId, (degrees.get(pair.leftFamilyId) ?? 0) + 1); degrees.set(pair.rightFamilyId, (degrees.get(pair.rightFamilyId) ?? 0) + 1); }
  if ([...degrees.values()].some(value => value !== 14) || degrees.size !== 32) throw new Error("Training schedule is not degree-14 balanced");
  for (const split of ["validation", "test"] as const) if (value.pairs.filter(pair => pair.split === split).length !== 120) throw new Error(`${split} schedule is not round-robin`);
}

export function loadBattleFamilyEvidence(game: string, requireSigned = false): BenchmarkBattleEvidence | null {
  const file = path.join(game, "benchmark-evidence.json");
  try { const value = JSON.parse(fs.readFileSync(file, "utf8")) as BenchmarkBattleEvidence; if (value.sha256) verifyBattleFamilyEvidence(value); else if (requireSigned || value.schemaVersion !== 1 || value.version !== BENCHMARK_FAMILY_VERSION || !value.pairClusterId || value.familyIds.length !== 2) return null; return value; } catch { return null; }
}

export function benchmarkFamilyDoctor(root: string): Record<string, unknown> {
  const directory = path.resolve(root), registryFile = path.join(directory, "family-registry.json"), scheduleFile = path.join(directory, "schedule.json");
  try {
    const registry = JSON.parse(fs.readFileSync(registryFile, "utf8")) as BenchmarkFamilyRegistry, schedule = JSON.parse(fs.readFileSync(scheduleFile, "utf8")) as BenchmarkFamilySchedule;
    verifyFamilyRegistry(registry, directory); verifyFamilySchedule(schedule, registry);
    return {available: true, healthy: true, root: directory, registrySha256: registry.sha256, scheduleSha256: schedule.sha256, families: registry.families.length, researchFamilies: registry.families.filter(family => family.split !== "holdout").length, holdoutFamilies: registry.families.filter(family => family.split === "holdout").length, pairs: schedule.pairs.length, projectedBattles: schedule.pairs.length * schedule.settings.seeds * schedule.settings.orientations, issues: []};
  } catch (error) { return {available: fs.existsSync(directory), healthy: false, root: directory, issues: [{severity: "error", code: "family-contract", message: error instanceof Error ? error.message : String(error)}]}; }
}

export function canonicalSha(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
export function fileSha256(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function canonical(value: any): any { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value; }
function counts(values: readonly string[]): Record<string, number> { const result: Record<string, number> = {}; for (const value of values) result[value] = (result[value] ?? 0) + 1; return result; }
function pairId(split: string, left: string, right: string): string { return `${split}-${[left, right].sort().join("--")}`; }
function addPair(pairs: BenchmarkPair[], split: BenchmarkPair["split"], left: string, right: string): void { const [a, b] = [left, right].sort(), id = pairId(split, a, b); if (!pairs.some(pair => pair.id === id)) pairs.push({id, split, leftFamilyId: a, rightFamilyId: b}); }
function hexSha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value); }
