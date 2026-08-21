import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {Dex, Teams} from "pokemon-showdown";
import type {PokemonSet} from "pokemon-showdown/dist/sim/teams";
import {BENCHMARK_ARCHETYPES, BENCHMARK_FAMILY_VERSION, benchmarkFamilyDoctor, buildFamilySchedule, fileSha256, signFamilyRegistry, type BenchmarkArchetype, type BenchmarkEnvironment, type BenchmarkFamily, type BenchmarkFamilyRegistry, type BenchmarkSplit} from "../draft/benchmarkFamilies";
import {loadTeam} from "../showdown/team";
import {compileBoundFormalLeagueRuntime} from "../draft/formalLeagueRuntime";
import {validateRegistryDirectory} from "../draft/registrySnapshot";
import {installCompiledSandbox} from "../sandbox/installer";

const args = process.argv.slice(2), command = args[0] && !args[0].startsWith("--") ? args[0] : "status", root = path.resolve(option("--root", "benchmarks/gen9families")), generation = parseGeneration(option("--generation", "v1"));
const RandomTeams = (require("pokemon-showdown/dist/data/random-battles/gen9/teams") as {RandomTeams: new(format: string, seed: number[]) => {randomTeam(): PokemonSet[]}}).RandomTeams;

interface Candidate {id: string; source: BenchmarkFamily["source"]; sets: PokemonSet[]; metrics: TeamMetrics}
interface TeamMetrics {restricted: number; averageBst: number; hazards: number; removal: number; pivots: number; recovery: number; status: number; setup: number; screens: number; rain: number; sun: number; sandSnow: number; trickRoom: number; priority: number; bulky: number; offense: number}
interface Slot {split: BenchmarkSplit; environment: BenchmarkEnvironment; archetype: BenchmarkArchetype}
interface ExtendedIndex {schemaVersion: 1; id: string; format: string; familyRegistry: string; schedule?: string; authority: "research" | "formal-holdout-only"; benchmarks: Array<{id: string; team: string; archetype: string; familyId: string; split: string; environment: string; source: string}>}

async function main(): Promise<void> {
  if (command === "build") print(build());
  else if (command === "doctor") { const value = doctor(); print(value); if (value.healthy !== true) process.exitCode = 2; }
  else if (command === "status") print(status());
  else if (command === "estimate") print(estimate());
  else throw new Error("Usage: npm run benchmark-families -- <build|status|doctor|estimate> [--root DIR] [--generation v1] [--force]");
}

function build(): Record<string, unknown> {
  prepareRoot();
  const candidates = generateCandidates(), slots = buildSlots(), families: BenchmarkFamily[] = [], used = new Set<string>();
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index], pool = candidates.get(slot.environment) ?? [], available = pool.filter(candidate => !used.has(candidate.id) && requiredSignal(candidate.metrics, slot.archetype)).sort((left, right) => archetypeScore(right.metrics, slot.archetype) - archetypeScore(left.metrics, slot.archetype) || left.id.localeCompare(right.id)), candidate = available[0];
    if (!candidate) throw new Error(`No benchmark candidate remains for ${slot.environment}/${slot.archetype}`);
    used.add(candidate.id); const familyId = generation === "v1" ? `bf-${slot.split}-${String(index + 1).padStart(3, "0")}` : `bf-${generation}-${slot.split}-${String(index + 1).padStart(3, "0")}`, variants = [candidate.sets, configurationVariant(candidate.sets, familyId)].map((sets, variantIndex) => {
      const id = variantIndex ? "configuration-b" : "base", relative = `teams/${familyId}-${id}.txt`, file = path.join(root, ...relative.split("/")); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, Teams.export(sets), "utf8"); return {id, team: relative, sha256: fileSha256(file)};
    });
    families.push({id: familyId, split: slot.split, environment: slot.environment, archetype: slot.archetype, source: candidate.source, variants});
  }
  const registry = signFamilyRegistry({schemaVersion: 1, version: BENCHMARK_FAMILY_VERSION, id: generation === "v1" ? "gen9-independent-family-pool-v1" : `gen9-independent-family-pool-${generation}`, format: currentRuntimeFormat(), families}), schedule = buildFamilySchedule(registry);
  write(path.join(root, "family-registry.json"), registry); write(path.join(root, "schedule.json"), schedule);
  write(path.join(root, "index.json"), indexFor(registry, "research")); write(path.join(root, "holdout-index.json"), indexFor(registry, "formal-holdout-only"));
  const value = doctor(); if (value.healthy !== true) throw new Error(`Generated benchmark family pool failed doctor: ${JSON.stringify(value)}`); return value;
}

function generateCandidates(): Map<BenchmarkEnvironment, Candidate[]> {
  const random: Candidate[] = [];
  for (let index = 0; index < 700; index += 1) { const sets = normalizeTeam(new RandomTeams("gen9randombattle", seed(generationKey(`benchmark-family:${index}`))).randomTeam()), metrics = analyze(sets); random.push({id: `random-${String(index).padStart(4, "0")}`, source: "random-battle", sets, metrics}); }
  const modern = uniqueCandidates(random.filter(candidate => !candidate.metrics.restricted && candidate.metrics.averageBst >= 485)).slice(0, 160), ordinary = uniqueCandidates(random.filter(candidate => !candidate.metrics.restricted && candidate.metrics.averageBst < 515).sort((left, right) => left.metrics.averageBst - right.metrics.averageBst)).slice(0, 120);
  const restrictedSets = random.flatMap(candidate => candidate.sets).filter(set => restricted(set.species)), ordinarySets = random.flatMap(candidate => candidate.sets).filter(set => !restricted(set.species));
  const unrestricted = Array.from({length: 80}, (_, index) => { const sets = composeUnique([...pickSets(restrictedSets, index * 5, 3), ...pickSets(ordinarySets, index * 17, 8)], 6); return {id: `restricted-${String(index).padStart(3, "0")}`, source: "restricted-composition" as const, sets, metrics: analyze(sets)}; }).filter(candidate => candidate.sets.length === 6 && candidate.metrics.restricted >= 2);
  const custom = currentCustomSets(), combinedBase = [...modern, ...ordinary];
  const combined = Array.from({length: 100}, (_, index) => { const base = combinedBase[index % combinedBase.length].sets, sets = composeUnique([...pickSets(custom, index * 3, 2), ...pickSets(base, index, 6), ...pickSets(ordinarySets, index * 13, 8)], 6); return {id: `combined-${String(index).padStart(3, "0")}`, source: "combined-current-assets" as const, sets, metrics: analyze(sets)}; }).filter(candidate => candidate.sets.length === 6);
  const pools = new Map<BenchmarkEnvironment, Candidate[]>([["modern-standard", modern], ["ordinary-depth", ordinary], ["unrestricted", uniqueCandidates(unrestricted)], ["combined", uniqueCandidates(combined)]]);
  for (const [environment, values] of pools) pools.set(environment, uniqueCandidates([...values, ...specializedCandidates(environment, values, random)]));
  return pools;
}

function specializedCandidates(environment: BenchmarkEnvironment, bases: Candidate[], random: Candidate[]): Candidate[] {
  const ordinaryAnchors = random.flatMap(candidate => candidate.sets).filter(set => !restricted(set.species)).sort((left, right) => bst(left.species) - bst(right.species));
  const allAnchors = random.flatMap(candidate => candidate.sets), anchors = environment === "ordinary-depth" ? ordinaryAnchors : allAnchors;
  const specs: Array<[BenchmarkArchetype, (metrics: TeamMetrics) => boolean]> = [
    ["rain", metrics => metrics.rain > 0], ["sun", metrics => metrics.sun > 0], ["sand-snow", metrics => metrics.sandSnow > 0],
    ["trick-room", metrics => metrics.trickRoom > 0], ["screens", metrics => metrics.screens > 0],
    ["hazard-stack", metrics => metrics.hazards > 0], ["hazard-control", metrics => metrics.removal > 0],
  ];
  const result: Candidate[] = [];
  for (const [archetype, match] of specs) {
    const matching = anchors.filter(set => match(analyze([set])));
    for (let index = 0; index < Math.min(16, Math.max(matching.length, 0)); index += 1) {
      const base = bases[(index * 7 + archetype.length) % bases.length]; if (!base) continue;
      const sets = composeUnique([matching[index % matching.length], ...pickSets(base.sets, index, 6)], 6), metrics = analyze(sets);
      if (sets.length !== 6 || !match(metrics) || environment === "unrestricted" && metrics.restricted < 2 || environment !== "unrestricted" && environment !== "combined" && metrics.restricted > 0) continue;
      result.push({id: `special-${environment}-${archetype}-${String(index).padStart(2, "0")}`, source: base.source, sets, metrics});
    }
  }
  return result;
}

function buildSlots(): Slot[] {
  const slots: Slot[] = [], add = (split: BenchmarkSplit, archetypes: BenchmarkArchetype[], environments: BenchmarkEnvironment[]) => { const shuffled = deterministicShuffle(environments, generationKey(`slot:${split}`)); archetypes.forEach((archetype, index) => slots.push({split, environment: shuffled[index], archetype})); };
  add("train", [...BENCHMARK_ARCHETYPES, ...BENCHMARK_ARCHETYPES], quota({"modern-standard": 12, "ordinary-depth": 8, unrestricted: 4, combined: 8}));
  add("validation", [...BENCHMARK_ARCHETYPES], quota({"modern-standard": 6, "ordinary-depth": 4, unrestricted: 2, combined: 4}));
  add("test", [...BENCHMARK_ARCHETYPES], quota({"modern-standard": 6, "ordinary-depth": 4, unrestricted: 2, combined: 4}));
  add("holdout", [...BENCHMARK_ARCHETYPES, ...BENCHMARK_ARCHETYPES.slice(0, 8)], quota({"modern-standard": 6, unrestricted: 6, combined: 12}));
  return slots;
}

function analyze(sets: PokemonSet[]): TeamMetrics {
  const moves = sets.flatMap(set => set.moves.map(move => Dex.moves.get(move))), ids = new Set(moves.map(move => move.id)), abilities = new Set(sets.map(set => Dex.toID(set.ability))), roles = sets.map(set => String((set as any).role ?? "").toLowerCase());
  const has = (...values: string[]) => values.filter(value => ids.has(value)).length, restrictedCount = sets.filter(set => restricted(set.species)).length, averageBst = mean(sets.map(set => bst(set.species)));
  return {restricted: restrictedCount, averageBst, hazards: has("stealthrock", "spikes", "toxicspikes", "stickyweb"), removal: has("rapidspin", "defog", "tidyup", "mortalspin"), pivots: has("uturn", "voltswitch", "flipturn", "partingshot", "chillyreception", "teleport"), recovery: moves.filter(move => move.heal || ["rest", "roost", "recover", "slackoff", "shoreup", "synthesis", "moonlight", "morningsun", "wish", "strengthsap"].includes(move.id)).length, status: has("toxic", "willowisp", "thunderwave", "nuzzle", "spore", "sleeppowder", "yawn", "leechseed"), setup: moves.filter(move => move.boosts && Object.values(move.boosts).some(value => Number(value) > 0) || ["shellsmash", "quiverdance", "dragondance", "swordsdance", "nastyplot", "calmmind", "bulkup", "coil"].includes(move.id)).length, screens: has("reflect", "lightscreen", "auroraveil"), rain: has("raindance") + Number(abilities.has("drizzle")), sun: has("sunnyday") + Number(abilities.has("drought") || abilities.has("orichalcumpulse")), sandSnow: has("sandstorm", "snowscape") + Number(abilities.has("sandstream") || abilities.has("snowwarning")), trickRoom: has("trickroom"), priority: moves.filter(move => move.priority > 0).length, bulky: roles.filter(role => /bulky|wall|support|defensive/.test(role)).length, offense: roles.filter(role => /breaker|sweeper|offense|setup/.test(role)).length};
}

function archetypeScore(value: TeamMetrics, archetype: BenchmarkArchetype): number {
  const table: Record<BenchmarkArchetype, number> = {
    balance: value.bulky + value.offense + value.hazards + value.removal,
    "bulky-offense": value.bulky * 2 + value.offense + value.pivots,
    "hyper-offense": value.offense * 2 + value.setup * 2 + value.priority - value.recovery,
    stall: value.recovery * 2 + value.status * 2 + value.bulky * 2 - value.setup,
    "semi-stall": value.recovery * 2 + value.status + value.hazards + value.bulky,
    "hazard-stack": value.hazards * 4 + value.status + value.pivots,
    "hazard-control": value.removal * 5 + value.hazards + value.pivots,
    "pivot-offense": value.pivots * 4 + value.offense + value.priority,
    rain: value.rain * 8 + value.offense,
    sun: value.sun * 8 + value.offense,
    "sand-snow": value.sandSnow * 8 + value.bulky,
    "trick-room": value.trickRoom * 10 + value.bulky,
    screens: value.screens * 8 + value.setup,
    "setup-offense": value.setup * 4 + value.offense,
    "priority-offense": value.priority * 4 + value.offense,
    "mixed-tempo": value.pivots + value.recovery + value.setup + value.priority + value.hazards + value.removal,
  };
  return table[archetype] + value.averageBst / 10000;
}

function requiredSignal(value: TeamMetrics, archetype: BenchmarkArchetype): boolean {
  if (archetype === "rain") return value.rain > 0;
  if (archetype === "sun") return value.sun > 0;
  if (archetype === "sand-snow") return value.sandSnow > 0;
  if (archetype === "trick-room") return value.trickRoom > 0;
  if (archetype === "screens") return value.screens > 0;
  if (archetype === "hazard-stack") return value.hazards >= 2;
  if (archetype === "hazard-control") return value.removal > 0;
  if (archetype === "setup-offense") return value.setup > 0;
  if (archetype === "priority-offense") return value.priority > 0;
  return true;
}

function normalizeTeam(team: PokemonSet[]): PokemonSet[] { return team.map(set => normalizeSet(set)); }
function normalizeSet(source: PokemonSet): PokemonSet {
  const set = structuredClone(source), species = Dex.species.get(set.species), moves = set.moves.map(move => Dex.moves.get(move)), physical = moves.filter(move => move.category === "Physical").length, special = moves.filter(move => move.category === "Special").length, defensive = /bulky|wall|support|defensive/.test(String((set as any).role ?? "").toLowerCase());
  set.level = 100; delete (set as any).teraType; set.ivs = {hp: 31, atk: special > physical ? 0 : 31, def: 31, spa: 31, spd: 31, spe: 31};
  if (defensive) { const physicalWall = species.baseStats.def <= species.baseStats.spd; set.evs = physicalWall ? {hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0} : {hp: 252, atk: 0, def: 4, spa: 0, spd: 252, spe: 0}; set.nature = physicalWall ? "Bold" : "Calm"; }
  else if (special > physical) { set.evs = {hp: 4, atk: 0, def: 0, spa: 252, spd: 0, spe: 252}; set.nature = "Timid"; }
  else { set.evs = {hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252}; set.nature = "Jolly"; }
  return set;
}
function configurationVariant(team: PokemonSet[], familyId: string): PokemonSet[] { return team.map((source, index) => { const set = structuredClone(source); if (Dex.toID(set.species).startsWith("mythic")) return set; const defensive = /bulky|wall|support|defensive/.test(String((set as any).role ?? "").toLowerCase()), choices = defensive ? ["Leftovers", "Heavy-Duty Boots"] : ["Life Orb", "Choice Scarf", "Expert Belt"], start = Number.parseInt(hash(`${familyId}:${index}`).slice(0, 8), 16) % choices.length; set.item = choices.find((value, offset) => choices[(start + offset) % choices.length] !== source.item) ?? choices[start]; return set; }); }

function currentCustomSets(): PokemonSet[] {
  const registry = path.resolve("data/draft"), snapshot = validateRegistryDirectory(registry), compiled = compileBoundFormalLeagueRuntime(registry, snapshot.hash);
  installCompiledSandbox(compiled, process.cwd(), {backup: false, merge: true, replaceConflicts: false});
  return compiled.team.map(set => structuredClone(set));
}

function currentRuntimeFormat(): string { const snapshot = validateRegistryDirectory(path.resolve("data/draft")); return `gen9mythicmonssandbox${snapshot.namespace}`; }

function doctor(): Record<string, unknown> { const base = benchmarkFamilyDoctor(root); if (base.healthy !== true) return base; const registry = read<BenchmarkFamilyRegistry>(path.join(root, "family-registry.json")), issues: Array<{severity: "error"; code: string; message: string}> = []; if (registry.format !== currentRuntimeFormat()) issues.push({severity: "error", code: "runtime-binding", message: `Benchmark format ${registry.format} is not bound to the current signed registry`}); for (const family of registry.families) for (const variant of family.variants) { try { const team = loadTeam(path.join(root, ...variant.team.split("/"))); if (team.sets.length !== 6 || new Set(team.sets.map(set => Dex.toID(set.species))).size !== 6) issues.push({severity: "error", code: "team-shape", message: `${family.id}/${variant.id} is not six unique species`}); else if (!requiredSignal(analyze(team.sets as PokemonSet[]), family.archetype)) issues.push({severity: "error", code: "archetype-signal", message: `${family.id}/${variant.id} lacks the required ${family.archetype} structure`}); } catch (error) { issues.push({severity: "error", code: "team-parse", message: `${family.id}/${variant.id}: ${error instanceof Error ? error.message : String(error)}`}); } } return {...base, healthy: !issues.length, parsedTeams: registry.families.length * 2, structuralContracts: registry.families.filter(family => ["rain", "sun", "sand-snow", "trick-room", "screens", "hazard-stack", "hazard-control", "setup-offense", "priority-offense"].includes(family.archetype)).length * 2, issues}; }
function status(): Record<string, unknown> { if (!fs.existsSync(path.join(root, "family-registry.json"))) return {available: false, root}; return doctor(); }
function estimate(): Record<string, unknown> { const value = benchmarkFamilyDoctor(root); return value.healthy === true ? {...value, fullTraceBattles: value.projectedBattles, expectedStage4Battles: 1080, evidenceUnits: 464, note: "Seeds and orientations are repeated measurements, not independent units."} : value; }
function indexFor(registry: BenchmarkFamilyRegistry, authority: ExtendedIndex["authority"]): ExtendedIndex { const families = registry.families.filter(family => authority === "research" ? family.split !== "holdout" : family.split === "holdout"), suffix = generation === "v1" ? "v1" : generation; return {schemaVersion: 1, id: authority === "research" ? `gen9-family-research-${suffix}` : `gen9-family-formal-holdout-${suffix}`, format: registry.format, familyRegistry: "family-registry.json", ...(authority === "research" ? {schedule: "schedule.json"} : {}), authority, benchmarks: families.map(family => ({id: family.id, team: family.variants[0].team, archetype: family.archetype, familyId: family.id, split: family.split, environment: family.environment, source: family.source}))}; }
function prepareRoot(): void { if (!fs.existsSync(root)) { fs.mkdirSync(root, {recursive: true}); return; } if (!args.includes("--force")) throw new Error(`Benchmark family root exists: ${root}; pass --force to replace generated contents`); const resolved = path.resolve(root), project = path.resolve("."); if (resolved === project || path.parse(resolved).root === resolved || !resolved.startsWith(`${project}${path.sep}`)) throw new Error(`Unsafe benchmark family root: ${resolved}`); fs.rmSync(resolved, {recursive: true, force: true}); fs.mkdirSync(resolved, {recursive: true}); }
function quota(value: Partial<Record<BenchmarkEnvironment, number>>): BenchmarkEnvironment[] { return Object.entries(value).flatMap(([environment, count]) => Array(Number(count)).fill(environment as BenchmarkEnvironment)); }
function deterministicShuffle<T>(values: T[], key: string): T[] { return [...values].sort((left, right) => hashUnit(`${key}:${JSON.stringify(left)}`) - hashUnit(`${key}:${JSON.stringify(right)}`)); }
function uniqueCandidates(values: Candidate[]): Candidate[] { const seen = new Set<string>(); return values.filter(candidate => { const signature = hash(candidate.sets.map(set => Dex.toID(set.species)).sort()); if (seen.has(signature)) return false; seen.add(signature); return true; }); }
function composeUnique(values: PokemonSet[], count: number): PokemonSet[] { const seen = new Set<string>(), result: PokemonSet[] = []; for (const source of values) { const id = Dex.toID(source.species); if (!id || seen.has(id)) continue; seen.add(id); result.push(structuredClone(source)); if (result.length === count) break; } return result; }
function pickSets(values: PokemonSet[], start: number, count: number): PokemonSet[] { if (!values.length) return []; return Array.from({length: Math.min(count, values.length)}, (_, index) => values[(start + index) % values.length]); }
function restricted(speciesName: string): boolean { const species: any = Dex.species.get(speciesName), tier = String(species.tier ?? ""); return /uber|ag/i.test(tier) || bst(speciesName) >= 650; }
function bst(speciesName: string): number { return (Object.values(Dex.species.get(speciesName).baseStats) as number[]).reduce((sum, value) => sum + value, 0); }
function mean(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function seed(value: string): number[] { const valueHash = hash(value); return [0, 8, 16, 24].map(offset => Number.parseInt(valueHash.slice(offset, offset + 8), 16) || 1); }
function hash(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function hashUnit(value: string): number { return Number.parseInt(hash(value).slice(0, 12), 16) / 0xffffffffffff; }
function generationKey(value: string): string { return generation === "v1" ? value : `${generation}:${value}`; }
function parseGeneration(value: string): string { if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw new Error(`Invalid benchmark generation: ${value}`); return value; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function write(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function print(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }

main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
