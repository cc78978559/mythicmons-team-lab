import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {Dex, Teams} from "pokemon-showdown";
import type {PokemonSet} from "pokemon-showdown/dist/sim/teams";
import {loadTeam} from "../showdown/team";

const args = process.argv.slice(2), command = args[0] && !args[0].startsWith("--") ? args[0] : "status", root = path.resolve(option("--out", "output/formal-league-proxy-v1")), season = path.join(root, "season-01"), manifestFile = path.join(season, "formal-environment-manifest.json");
const RandomTeams = (require("pokemon-showdown/dist/data/random-battles/gen9/teams") as {RandomTeams: new(format: string, seed: number[]) => {randomTeam(): PokemonSet[]}}).RandomTeams;

if (command === "build") print(build());
else if (command === "doctor") { const value = doctor(); print(value); if (!value.healthy) process.exitCode = 2; }
else if (command === "status") print(fs.existsSync(manifestFile) ? doctor() : {available: false, root});
else throw new Error("Usage: npm run formal-league-proxy -- <build|doctor|status> [--out DIR] [--force]");

function build(): Record<string, unknown> {
  prepare(); const managers: Array<{id: string; tactics: Record<string, number | string>}> = [], teams: Array<{managerId: string; file: string; sha256: string; rosterSha256: string}> = [], rosters = new Set<string>();
  for (let index = 0; index < 30; index += 1) {
    let sets: PokemonSet[] = [], rosterSha256 = "";
    for (let attempt = 0; attempt < 100; attempt += 1) { sets = normalize(new RandomTeams("gen9randombattle", seed(`formal-league-proxy-v1:${index}:${attempt}`)).randomTeam()); rosterSha256 = digest(sets.map(set => Dex.toID(set.species)).sort()); if (!rosters.has(rosterSha256)) break; }
    if (sets.length !== 6 || rosters.has(rosterSha256)) throw new Error(`Could not generate independent proxy roster ${index + 1}`); rosters.add(rosterSha256);
    const managerId = `manager-${String(index + 1).padStart(2, "0")}`, relative = `rosters/${managerId}/roster.export.txt`, file = path.join(season, ...relative.split("/")); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, Teams.export(sets), "utf8"); teams.push({managerId, file: relative, sha256: fileHash(file), rosterSha256});
    managers.push({id: managerId, tactics: {id: managerId, aggression: round(((index % 7) - 3) / 10), recoveryBias: round(((index * 3) % 5) / 10), pivotBias: round(((index * 5) % 7) / 10), statusBias: round(((index * 2) % 5) / 10), expectedWeight: .6, downsideWeight: .25, worstWeight: .15}});
  }
  write(path.join(season, "manager-profiles.json"), {schemaVersion: 1, authority: "prospective-independent-league-proxy", managers}); const core = {schemaVersion: 1, id: "formal-league-proxy-v1", authority: "validation-proxy-only-no-activation", generatedAt: new Date().toISOString(), generatorSeed: "formal-league-proxy-v1", format: "gen9mythicmonssandbox", managers: 30, teams}; write(manifestFile, {...core, sha256: canonicalSha(core)}); return doctor();
}

function doctor(): Record<string, unknown> {
  try { const manifest = read<any>(manifestFile), {sha256, ...core} = manifest, profiles = read<any>(path.join(season, "manager-profiles.json")), issues: string[] = []; if (manifest.authority !== "validation-proxy-only-no-activation" || canonicalSha(core) !== sha256 || manifest.managers !== 30 || manifest.teams?.length !== 30 || profiles.managers?.length !== 30) issues.push("manifest-contract"); const rosters = new Set<string>(); for (const row of manifest.teams ?? []) { const file = path.join(season, ...String(row.file).split("/")), team = loadTeam(file); if (fileHash(file) !== row.sha256 || team.sets.length !== 6 || new Set(team.sets.map(set => Dex.toID(set.species))).size !== 6 || rosters.has(row.rosterSha256)) issues.push(`team:${row.managerId}`); rosters.add(row.rosterSha256); } return {available: true, healthy: !issues.length, root, managers: manifest.managers, independentRosters: rosters.size, authority: manifest.authority, sha256: manifest.sha256, issues}; } catch (error) { return {available: false, healthy: false, root, issues: [error instanceof Error ? error.message : String(error)]}; }
}

function normalize(team: PokemonSet[]): PokemonSet[] { return team.map(source => { const set = structuredClone(source); set.level = 100; delete (set as any).teraType; return set; }); }
function prepare(): void { if (!fs.existsSync(root)) { fs.mkdirSync(root, {recursive: true}); return; } if (!args.includes("--force")) throw new Error(`Proxy root exists: ${root}; pass --force to replace it`); const project = path.resolve("."), resolved = path.resolve(root); if (!resolved.startsWith(`${project}${path.sep}`) || resolved === project) throw new Error(`Unsafe proxy root: ${resolved}`); fs.rmSync(resolved, {recursive: true, force: true}); fs.mkdirSync(resolved, {recursive: true}); }
function seed(value: string): number[] { const hash = digest(value); return [0, 8, 16, 24].map(offset => Number.parseInt(hash.slice(offset, offset + 8), 16) || 1); }
function canonicalSha(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function canonical(value: any): any { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value; }
function digest(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function fileHash(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function round(value: number): number { return Math.round(value * 1e6) / 1e6; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function write(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function print(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
