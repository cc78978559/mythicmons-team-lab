import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";

interface Entry {releaseId: string; status: "staged" | "active" | "rejected"; relativePath: string; registeredOrder: number; reason?: string}
interface Activation {sequence: number; releaseId: string; previousReleaseId: string | null; action: "activate" | "rollback"}
interface Registry {schemaVersion: 1; entries: Entry[]; activationHistory: Activation[]}
interface Manifest {schemaVersion: 1; releaseId: string; profile: string}

const args = process.argv.slice(2), root = path.resolve(option("--registry", "output/development-ai-release-registry")), action = option("--action", "status");
let result: unknown;
if (action === "register") result = register(path.resolve(required("--release")));
else if (action === "activate") result = activate(required("--release-id"));
else if (action === "reject") result = reject(required("--release-id"), required("--reason"));
else if (action === "rollback") result = rollback();
else if (action === "verify") result = verifyRegistry();
else if (action === "status") result = readRegistry();
else throw new Error(`Unsupported registry action: ${action}`);
console.log(JSON.stringify({action, registry: root, result}, null, 2));

function register(source: string): object {
  const manifest = verifyRelease(source); ensureRoot(); const registry = readRegistry(), existing = registry.entries.find(entry => entry.releaseId === manifest.releaseId);
  if (existing) { verifyEntry(existing); return {registry, entry: existing, manifest}; }
  const relativePath = normalize(path.join("releases", manifest.releaseId)), target = path.join(root, relativePath), temporary = `${target}.tmp`;
  if (fs.existsSync(temporary)) fs.rmSync(temporary, {recursive: true, force: true});
  try { fs.cpSync(source, temporary, {recursive: true}); verifyRelease(temporary); fs.renameSync(temporary, target); }
  catch (error) { fs.rmSync(temporary, {recursive: true, force: true}); throw error; }
  const entry: Entry = {releaseId: manifest.releaseId, status: "staged", relativePath, registeredOrder: registry.entries.length + 1}; registry.entries.push(entry); writeRegistry(registry); return {registry, entry, manifest};
}
function activate(releaseId: string): Registry { const registry = readRegistry(), target = requiredEntry(registry, releaseId); if (target.status === "rejected") throw new Error(`Cannot activate rejected release: ${releaseId}`); verifyEntry(target); const current = registry.entries.find(entry => entry.status === "active"); if (current?.releaseId === releaseId) return registry; if (current) current.status = "staged"; target.status = "active"; delete target.reason; registry.activationHistory.push({sequence: registry.activationHistory.length + 1, releaseId, previousReleaseId: current?.releaseId ?? null, action: "activate"}); writePointer(target); writeRegistry(registry); return registry; }
function reject(releaseId: string, reason: string): Registry { if (!reason.trim()) throw new Error("A rejection reason is required"); const registry = readRegistry(), target = requiredEntry(registry, releaseId); if (target.status === "active") throw new Error(`Cannot reject active release: ${releaseId}`); target.status = "rejected"; target.reason = reason.trim(); writeRegistry(registry); return registry; }
function rollback(): Registry { const registry = readRegistry(), current = registry.entries.find(entry => entry.status === "active"); if (!current) throw new Error("Cannot rollback without an active release"); const previous = [...registry.activationHistory].reverse().map(event => event.releaseId === current.releaseId ? event.previousReleaseId : event.releaseId).find(id => id && id !== current.releaseId && registry.entries.some(entry => entry.releaseId === id && entry.status !== "rejected")); if (!previous) throw new Error("No previous eligible release is available for rollback"); const target = requiredEntry(registry, previous); verifyEntry(target); current.status = "staged"; target.status = "active"; registry.activationHistory.push({sequence: registry.activationHistory.length + 1, releaseId: target.releaseId, previousReleaseId: current.releaseId, action: "rollback"}); writePointer(target); writeRegistry(registry); return registry; }
function verifyRegistry(): Registry { const registry = readRegistry(); for (const entry of registry.entries) verifyEntry(entry); const active = registry.entries.find(entry => entry.status === "active"), pointerFile = path.join(root, "active.json"); if (active) { const pointer = read<{releaseId: string; relativePath: string}>(pointerFile); if (pointer.releaseId !== active.releaseId || pointer.relativePath !== active.relativePath) throw new Error("Active pointer does not match registry state"); verifyEntry(active); } else if (fs.existsSync(pointerFile)) throw new Error("Registry has an active pointer without an active release"); return registry; }
function readRegistry(): Registry { const file = path.join(root, "registry.json"); if (!fs.existsSync(file)) return {schemaVersion: 1, entries: [], activationHistory: []}; const registry = read<Registry>(file); if (registry.schemaVersion !== 1 || !Array.isArray(registry.entries) || !Array.isArray(registry.activationHistory)) throw new Error("Invalid development AI registry"); if (registry.entries.filter(entry => entry.status === "active").length > 1) throw new Error("Registry contains multiple active releases"); const ids = new Set<string>(); for (const entry of registry.entries) { if (!/^[a-f0-9]{64}$/.test(entry.releaseId) || ids.has(entry.releaseId) || !["staged", "active", "rejected"].includes(entry.status)) throw new Error("Invalid development AI registry entry"); ids.add(entry.releaseId); } return registry; }
function verifyRelease(directory: string): Manifest { const run = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(process.cwd(), "src", "cli", "releaseDevelopmentAi.ts"), "--out", directory, "--verify-only"], {cwd: process.cwd(), encoding: "utf8", maxBuffer: 8 * 1024 * 1024}); if (run.status !== 0) throw new Error(`Development AI release verification failed:\n${run.stderr || run.stdout}`); return read<Manifest>(path.join(directory, "manifest.json")); }
function verifyEntry(entry: Entry): Manifest { const target = path.resolve(root, entry.relativePath), relative = path.relative(root, target); if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Registered release escapes registry: ${entry.releaseId}`); const manifest = verifyRelease(target); if (manifest.releaseId !== entry.releaseId) throw new Error(`Registered release ID mismatch: ${entry.releaseId}`); return manifest; }
function requiredEntry(registry: Registry, releaseId: string): Entry { const entry = registry.entries.find(value => value.releaseId === releaseId); if (!entry) throw new Error(`Unknown development AI release: ${releaseId}`); return entry; }
function ensureRoot(): void { if (root === path.parse(root).root || root === process.cwd()) throw new Error(`Unsafe registry target: ${root}`); fs.mkdirSync(path.join(root, "releases"), {recursive: true}); }
function writePointer(entry: Entry): void { writeAtomic(path.join(root, "active.json"), {schemaVersion: 1, releaseId: entry.releaseId, relativePath: entry.relativePath}); }
function writeRegistry(registry: Registry): void { writeAtomic(path.join(root, "registry.json"), registry); }
function writeAtomic(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); const temporary = `${file}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
function normalize(value: string): string { return value.split(path.sep).join("/"); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function required(name: string): string { const index = args.indexOf(name), value = index >= 0 ? args[index + 1] : undefined; if (!value) throw new Error(`Missing required option: ${name}`); return value; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
