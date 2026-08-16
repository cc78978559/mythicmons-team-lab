import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

export const EVIDENCE_VAULT_VERSION = "evidence-vault-v1" as const;

export interface EvidenceVaultSource {name: string; path: string}
export interface EvidenceRepositoryIdentity {root: string; remote: string | null; commit: string | null; branch: string | null; dirty: boolean; status: string[]}
export interface EvidenceVaultFile {source: string; relative: string; bytes: number; sha256: string; mtimeMs: number}
export interface EvidenceVaultManifest {
  schemaVersion: 1;
  version: typeof EVIDENCE_VAULT_VERSION;
  createdAt: string;
  label: string;
  mode: "full" | "audit";
  evidenceLevel: "replayable" | "audit-only" | "diagnostic-only";
  repository: EvidenceRepositoryIdentity;
  sources: Array<{name: string; originalPath: string; kind: "file" | "directory"}>;
  files: EvidenceVaultFile[];
  totals: {files: number; bytes: number; uniqueObjects: number};
  sha256: string;
}
export interface EvidenceVaultSnapshot {id: string; directory: string; manifest: EvidenceVaultManifest; newObjectBytes: number; reusedObjects: number}
export interface EvidenceVaultIndex {
  schemaVersion: 1;
  version: typeof EVIDENCE_VAULT_VERSION;
  generatedAt: string;
  snapshots: Array<{id: string; manifest: string; manifestSha256: string; createdAt: string; label: string; evidenceLevel: EvidenceVaultManifest["evidenceLevel"]; files: number; bytes: number}>;
  sha256: string;
}
export interface EvidenceVaultAudit {
  available: boolean;
  healthy: boolean;
  root: string;
  snapshots: number;
  files: number;
  referencedObjects: number;
  referencedBytes: number;
  orphanObjects: Array<{file: string; bytes: number; mtimeMs: number}>;
  orphanBytes: number;
  deep: boolean;
  issues: string[];
  latestSnapshot: string | null;
}
interface EvidenceVaultQuarantine {schemaVersion: 1; snapshotId: string; manifestSha256: string; quarantinedAt: string; reason: string; sha256: string}

const ignoredSuffixes = [".lock", ".pid", ".tmp"];
const auditNames = new Set(["checkpoint.json", "summary.json", "run-state.json", "build-state.json", "audit-summary.json", "audit-run-state.json", "freeze.json", "plan.json", "results.json", "results.json.gz", "manifest.json", "archive-manifest.json", "selection-history.json", "handoff.json", "index.json", "status.json", "report.md"]);

export function defaultEvidenceVaultRoot(): string {
  return path.resolve(process.env.MYTHICMONS_EVIDENCE_VAULT ?? path.join(os.homedir(), "Documents", "MythicMons Team Lab Evidence Vault"));
}

export function inspectRepository(rootDirectory: string): EvidenceRepositoryIdentity {
  const root = path.resolve(rootDirectory), run = (args: string[]) => spawnSync("git", ["-C", root, ...args], {encoding: "utf8"});
  const commit = run(["rev-parse", "HEAD"]), branch = run(["branch", "--show-current"]), remote = run(["remote", "get-url", "origin"]), status = run(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (commit.status !== 0) throw new Error(`Evidence vault repository is not a Git checkout: ${root}`);
  const rows = status.stdout.split(/\r?\n/).filter(Boolean).sort();
  return {root, remote: remote.status === 0 ? remote.stdout.trim() || null : null, commit: commit.stdout.trim() || null, branch: branch.status === 0 ? branch.stdout.trim() || null : null, dirty: rows.length > 0, status: rows};
}

export function createEvidenceVaultSnapshot(options: {vaultRoot: string; sources: readonly EvidenceVaultSource[]; label: string; mode?: "full" | "audit"; repository: EvidenceRepositoryIdentity}): EvidenceVaultSnapshot {
  const vault = path.resolve(options.vaultRoot), mode = options.mode ?? "full", sources = normalizeSources(options.sources), label = options.label.trim();
  if (!label) throw new Error("Evidence vault snapshot label is required");
  for (const source of sources) assertSeparated(vault, source.path);
  fs.mkdirSync(path.join(vault, "objects"), {recursive: true}); fs.mkdirSync(path.join(vault, "snapshots"), {recursive: true});
  const sourceRows: EvidenceVaultManifest["sources"] = [], files: EvidenceVaultFile[] = []; let newObjectBytes = 0, reusedObjects = 0;
  for (const source of sources) {
    const stat = fs.statSync(source.path), kind = stat.isDirectory() ? "directory" : stat.isFile() ? "file" : null; if (!kind) throw new Error(`Unsupported evidence source: ${source.path}`);
    sourceRows.push({name: source.name, originalPath: source.path, kind});
    for (const file of enumerateSource(source.path, mode)) {
      const relative = kind === "file" ? path.basename(file) : portable(path.relative(source.path, file));
      const stored = storeObject(vault, file); if (stored.created) newObjectBytes += stored.bytes; else reusedObjects += 1;
      files.push({source: source.name, relative, bytes: stored.bytes, sha256: stored.sha256, mtimeMs: fs.statSync(file).mtimeMs});
    }
  }
  files.sort((left, right) => left.source.localeCompare(right.source) || left.relative.localeCompare(right.relative));
  if (!files.length) throw new Error("Evidence vault snapshot contains no files");
  const duplicate = files.find((entry, index) => index > 0 && entry.source === files[index - 1].source && entry.relative === files[index - 1].relative); if (duplicate) throw new Error(`Duplicate evidence path: ${duplicate.source}/${duplicate.relative}`);
  const uniqueObjects = new Set(files.map(file => file.sha256)).size, evidenceLevel = options.repository.dirty ? "diagnostic-only" as const : mode === "full" ? "replayable" as const : "audit-only" as const, core = {schemaVersion: 1 as const, version: EVIDENCE_VAULT_VERSION, createdAt: new Date().toISOString(), label, mode, evidenceLevel, repository: options.repository, sources: sourceRows, files, totals: {files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), uniqueObjects}};
  const manifest: EvidenceVaultManifest = {...core, sha256: digest(core)}, id = `snapshot-${core.createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${manifest.sha256.slice(0, 16)}`, directory = path.join(vault, "snapshots", id);
  if (fs.existsSync(directory)) throw new Error(`Evidence snapshot already exists: ${id}`);
  fs.mkdirSync(directory); atomicJson(path.join(directory, "manifest.json"), manifest); writeIndex(vault);
  return {id, directory, manifest, newObjectBytes, reusedObjects};
}

export function auditEvidenceVault(vaultDirectory: string, options: {deep?: boolean} = {}): EvidenceVaultAudit {
  const root = path.resolve(vaultDirectory), deep = options.deep === true, issues: string[] = [];
  if (!fs.existsSync(root)) return {available: false, healthy: true, root, snapshots: 0, files: 0, referencedObjects: 0, referencedBytes: 0, orphanObjects: [], orphanBytes: 0, deep, issues, latestSnapshot: null};
  const loaded = loadManifests(root, issues), references = new Map<string, number>(); let files = 0;
  for (const {manifest, id} of loaded) {
    files += manifest.files.length;
    for (const entry of manifest.files) {
      if (!safeRelative(entry.relative)) { issues.push(`${id}: unsafe relative path ${entry.relative}`); continue; }
      const prior = references.get(entry.sha256); if (prior !== undefined && prior !== entry.bytes) issues.push(`${id}: object size conflict ${entry.sha256}`); else references.set(entry.sha256, entry.bytes);
    }
  }
  for (const [sha256, bytes] of references) {
    const object = objectPath(root, sha256);
    if (!fs.existsSync(object)) { issues.push(`Missing object: ${sha256}`); continue; }
    const stat = fs.statSync(object); if (!stat.isFile() || stat.size !== bytes) issues.push(`Object size mismatch: ${sha256}`); else if (deep && hashFile(object).sha256 !== sha256) issues.push(`Object hash mismatch: ${sha256}`);
  }
  const orphans = enumerateObjects(root).filter(entry => !references.has(path.basename(entry.file))), index = optionalJson<EvidenceVaultIndex>(path.join(root, "index.json")), expected = buildIndex(root, loaded);
  if (!index || !validIndex(index) || canonical(index.snapshots) !== canonical(expected.snapshots)) issues.push("Evidence vault index is missing, stale, or invalid");
  return {available: true, healthy: issues.length === 0, root, snapshots: loaded.length, files, referencedObjects: references.size, referencedBytes: [...references.values()].reduce((sum, bytes) => sum + bytes, 0), orphanObjects: orphans, orphanBytes: orphans.reduce((sum, entry) => sum + entry.bytes, 0), deep, issues, latestSnapshot: loaded.at(-1)?.id ?? null};
}

export function quickEvidenceVaultStatus(vaultDirectory: string, currentFiles: readonly string[], options: {requiredEvidenceLevel?: EvidenceVaultManifest["evidenceLevel"]} = {}): {available: boolean; healthy: boolean; root: string; snapshots: number; coveringSnapshot: string | null; coversCurrentFiles: boolean; issues: string[]} {
  const root = path.resolve(vaultDirectory), issues: string[] = [], index = optionalJson<EvidenceVaultIndex>(path.join(root, "index.json"));
  if (!index) return {available: false, healthy: true, root, snapshots: 0, coveringSnapshot: null, coversCurrentFiles: currentFiles.length === 0, issues};
  if (!validIndex(index)) return {available: true, healthy: false, root, snapshots: index.snapshots?.length ?? 0, coveringSnapshot: null, coversCurrentFiles: false, issues: ["Evidence vault index signature is invalid"]};
  for (const row of [...index.snapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const file = path.resolve(root, ...row.manifest.split("/")), manifest = optionalJson<EvidenceVaultManifest>(file); if (!manifest || !validManifest(manifest) || manifest.sha256 !== row.manifestSha256) { issues.push(`Invalid indexed manifest: ${row.id}`); continue; }
    if (options.requiredEvidenceLevel && manifest.evidenceLevel !== options.requiredEvidenceLevel) continue;
    if (currentFiles.every(current => manifestCoversCurrentFile(root, manifest, current))) return {available: true, healthy: issues.length === 0, root, snapshots: index.snapshots.length, coveringSnapshot: row.id, coversCurrentFiles: true, issues};
  }
  return {available: true, healthy: issues.length === 0, root, snapshots: index.snapshots.length, coveringSnapshot: null, coversCurrentFiles: currentFiles.length === 0, issues};
}

export function restoreEvidenceVaultSnapshot(options: {vaultRoot: string; snapshotId: string; destination: string}): {snapshotId: string; destination: string; files: number; bytes: number} {
  const root = path.resolve(options.vaultRoot), destination = path.resolve(options.destination), manifest = readSnapshotManifest(root, options.snapshotId), audit = auditSingleManifestObjects(root, manifest, true);
  if (audit.length) throw new Error(`Evidence snapshot cannot be restored: ${audit.join("; ")}`);
  if (fs.existsSync(destination) && fs.readdirSync(destination).length) throw new Error(`Restore destination is not empty: ${destination}`);
  if (isInside(root, destination) || isInside(destination, root)) throw new Error("Restore destination and evidence vault must be separate");
  fs.mkdirSync(destination, {recursive: true});
  for (const entry of manifest.files) {
    const target = path.resolve(destination, entry.source, ...entry.relative.split("/")); if (!isInside(destination, target)) throw new Error(`Unsafe restore path: ${entry.source}/${entry.relative}`);
    fs.mkdirSync(path.dirname(target), {recursive: true}); fs.copyFileSync(objectPath(root, entry.sha256), target); const timestamp = new Date(entry.mtimeMs); fs.utimesSync(target, timestamp, timestamp);
  }
  atomicJson(path.join(destination, "restore-receipt.json"), {schemaVersion: 1, snapshotId: options.snapshotId, manifestSha256: manifest.sha256, restoredAt: new Date().toISOString(), files: manifest.files.length, bytes: manifest.totals.bytes});
  touchSnapshot(root, options.snapshotId); return {snapshotId: options.snapshotId, destination, files: manifest.files.length, bytes: manifest.totals.bytes};
}

export function gcEvidenceVault(vaultDirectory: string, options: {apply: boolean; graceDays: number}): {apply: boolean; candidates: string[]; reclaimedBytes: number; remainingOrphanBytes: number} {
  const root = path.resolve(vaultDirectory), audit = auditEvidenceVault(root, {deep: false}); if (!audit.available) return {apply: options.apply, candidates: [], reclaimedBytes: 0, remainingOrphanBytes: 0};
  if (!audit.healthy) throw new Error(`Evidence vault GC blocked: ${audit.issues.join("; ")}`);
  const cutoff = Date.now() - options.graceDays * 86400000, candidates = audit.orphanObjects.filter(entry => entry.mtimeMs <= cutoff), reclaimedBytes = candidates.reduce((sum, entry) => sum + entry.bytes, 0);
  if (options.apply) for (const entry of candidates) { const target = path.resolve(entry.file), objects = path.resolve(root, "objects"); if (!isInside(objects, target) || !/^[a-f0-9]{64}$/i.test(path.basename(target))) throw new Error(`Unsafe evidence vault GC target: ${target}`); fs.rmSync(target); }
  return {apply: options.apply, candidates: candidates.map(entry => entry.file), reclaimedBytes, remainingOrphanBytes: audit.orphanBytes - reclaimedBytes};
}

export function quarantineEvidenceVaultSnapshot(vaultDirectory: string, snapshotId: string, reason: string): {snapshotId: string; reason: string; quarantinedAt: string} {
  if (!/^snapshot-[a-zA-Z0-9-]+$/.test(snapshotId)) throw new Error(`Cannot quarantine invalid or missing snapshot: ${snapshotId}`);
  const root = path.resolve(vaultDirectory), snapshotDirectory = path.join(root, "snapshots", snapshotId), manifest = optionalJson<EvidenceVaultManifest>(path.join(snapshotDirectory, "manifest.json")), cleanReason = reason.trim();
  if (!manifest || !signedManifest(manifest)) throw new Error(`Cannot quarantine invalid or missing snapshot: ${snapshotId}`);
  if (fs.existsSync(path.join(snapshotDirectory, "quarantine.json"))) throw new Error(`Evidence snapshot is already quarantined: ${snapshotId}`);
  if (!cleanReason) throw new Error("Snapshot quarantine reason is required");
  const core = {schemaVersion: 1 as const, snapshotId, manifestSha256: manifest.sha256, quarantinedAt: new Date().toISOString(), reason: cleanReason}, value: EvidenceVaultQuarantine = {...core, sha256: digest(core)}; atomicJson(path.join(snapshotDirectory, "quarantine.json"), value); writeIndex(root); return {snapshotId, reason: cleanReason, quarantinedAt: value.quarantinedAt};
}

export function readEvidenceVaultIndex(vaultDirectory: string): EvidenceVaultIndex | null { const value = optionalJson<EvidenceVaultIndex>(path.join(path.resolve(vaultDirectory), "index.json")); return value && validIndex(value) ? value : null; }

function normalizeSources(values: readonly EvidenceVaultSource[]): Array<{name: string; path: string}> {
  if (!values.length) throw new Error("At least one evidence source is required"); const names = new Set<string>();
  return values.map(value => { const name = value.name.trim(), resolved = path.resolve(value.path); if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error(`Invalid evidence source name: ${name}`); if (names.has(name)) throw new Error(`Duplicate evidence source name: ${name}`); names.add(name); if (!fs.existsSync(resolved)) throw new Error(`Evidence source does not exist: ${resolved}`); return {name, path: resolved}; });
}
function enumerateSource(source: string, mode: "full" | "audit"): string[] {
  const stat = fs.statSync(source); if (stat.isFile()) return ignored(path.basename(source)) || mode === "audit" && !auditFile(path.basename(source), true) ? [] : [source];
  const files: string[] = [], stack = [source]; while (stack.length) { const current = stack.pop()!; for (const entry of fs.readdirSync(current, {withFileTypes: true}).sort((a, b) => b.name.localeCompare(a.name))) { const target = path.join(current, entry.name); if (entry.isSymbolicLink()) throw new Error(`Evidence source contains a symbolic link: ${target}`); if (entry.isDirectory()) stack.push(target); else if (entry.isFile() && !ignored(entry.name) && (mode === "full" || auditFile(entry.name, current === source))) files.push(target); } }
  return files.sort();
}
function auditFile(name: string, rootLevel: boolean): boolean { return auditNames.has(name) || /(?:summary|manifest|checkpoint|freeze|result|plan|audit|report)/i.test(name) && /\.(?:json|json\.gz|md)$/i.test(name) || rootLevel && /\.(?:json|json\.gz|md)$/i.test(name); }
function ignored(name: string): boolean { return ignoredSuffixes.some(suffix => name.endsWith(suffix)); }
function storeObject(vault: string, source: string): {sha256: string; bytes: number; created: boolean} {
  const incoming = path.join(vault, "objects", ".incoming"); fs.mkdirSync(incoming, {recursive: true}); const temporary = path.join(incoming, `${process.pid}-${crypto.randomBytes(8).toString("hex")}.tmp`), input = fs.openSync(source, "r"), output = fs.openSync(temporary, "wx"), hash = crypto.createHash("sha256"), buffer = Buffer.allocUnsafe(1024 * 1024); let bytes = 0;
  try { for (;;) { const read = fs.readSync(input, buffer, 0, buffer.length, null); if (!read) break; const chunk = buffer.subarray(0, read); hash.update(chunk); fs.writeSync(output, chunk); bytes += read; } fs.fsyncSync(output); } finally { fs.closeSync(input); fs.closeSync(output); }
  const sha256 = hash.digest("hex"), target = objectPath(vault, sha256); fs.mkdirSync(path.dirname(target), {recursive: true});
  if (fs.existsSync(target)) { const existing = hashFile(target); fs.rmSync(temporary); if (existing.sha256 !== sha256 || existing.bytes !== bytes) throw new Error(`Corrupt evidence object: ${sha256}`); return {sha256, bytes, created: false}; }
  fs.renameSync(temporary, target); return {sha256, bytes, created: true};
}
function loadManifests(root: string, issues: string[]): Array<{id: string; manifest: EvidenceVaultManifest}> {
  const snapshots = path.join(root, "snapshots"), result: Array<{id: string; manifest: EvidenceVaultManifest}> = []; if (!fs.existsSync(snapshots)) return result;
  for (const entry of fs.readdirSync(snapshots, {withFileTypes: true}).filter(value => value.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) { const manifest = optionalJson<EvidenceVaultManifest>(path.join(snapshots, entry.name, "manifest.json")), quarantine = optionalJson<EvidenceVaultQuarantine>(path.join(snapshots, entry.name, "quarantine.json")); if (quarantine) { if (!manifest || !validQuarantine(quarantine, entry.name, manifest)) issues.push(`Invalid evidence quarantine: ${entry.name}`); continue; } if (!manifest || !validManifest(manifest)) issues.push(`Invalid evidence manifest: ${entry.name}`); else result.push({id: entry.name, manifest}); }
  return result.sort((a, b) => a.manifest.createdAt.localeCompare(b.manifest.createdAt) || a.id.localeCompare(b.id));
}
function writeIndex(root: string): EvidenceVaultIndex { const issues: string[] = [], loaded = loadManifests(root, issues); if (issues.length) throw new Error(issues.join("; ")); const index = buildIndex(root, loaded); atomicJson(path.join(root, "index.json"), index); return index; }
function buildIndex(root: string, loaded: Array<{id: string; manifest: EvidenceVaultManifest}>): EvidenceVaultIndex { const core = {schemaVersion: 1 as const, version: EVIDENCE_VAULT_VERSION, generatedAt: new Date().toISOString(), snapshots: loaded.map(({id, manifest}) => ({id, manifest: portable(path.relative(root, path.join(root, "snapshots", id, "manifest.json"))), manifestSha256: manifest.sha256, createdAt: manifest.createdAt, label: manifest.label, evidenceLevel: manifest.evidenceLevel, files: manifest.totals.files, bytes: manifest.totals.bytes}))}; return {...core, sha256: digest({...core, generatedAt: "<index-time>"})}; }
function validIndex(value: EvidenceVaultIndex): boolean { if (value.schemaVersion !== 1 || value.version !== EVIDENCE_VAULT_VERSION || !Array.isArray(value.snapshots)) return false; return value.sha256 === digest({...value, generatedAt: "<index-time>", sha256: undefined}, ["sha256"]); }
function signedManifest(value: EvidenceVaultManifest): boolean { if (value.schemaVersion !== 1 || value.version !== EVIDENCE_VAULT_VERSION || !Array.isArray(value.sources) || !Array.isArray(value.files) || !value.totals) return false; const {sha256, ...core} = value; return /^[a-f0-9]{64}$/i.test(sha256) && digest(core) === sha256 && value.totals.files === value.files.length && value.totals.bytes === value.files.reduce((sum, file) => sum + file.bytes, 0) && value.totals.uniqueObjects === new Set(value.files.map(file => file.sha256)).size; }
function validManifest(value: EvidenceVaultManifest): boolean { return signedManifest(value) && (value.repository.dirty ? value.evidenceLevel === "diagnostic-only" : value.mode === "full" ? value.evidenceLevel === "replayable" : value.evidenceLevel === "audit-only"); }
function validQuarantine(value: EvidenceVaultQuarantine, snapshotId: string, manifest: EvidenceVaultManifest): boolean { const {sha256, ...core} = value; return value.schemaVersion === 1 && value.snapshotId === snapshotId && value.manifestSha256 === manifest.sha256 && Boolean(value.reason.trim()) && Number.isFinite(Date.parse(value.quarantinedAt)) && /^[a-f0-9]{64}$/i.test(sha256) && digest(core) === sha256 && signedManifest(manifest); }
function manifestCoversCurrentFile(vault: string, manifest: EvidenceVaultManifest, currentFile: string): boolean {
  const current = path.resolve(currentFile); if (!fs.existsSync(current) || !fs.statSync(current).isFile()) return false;
  for (const source of manifest.sources) { const relative = source.kind === "file" ? current === path.resolve(source.originalPath) ? path.basename(current) : null : isInside(source.originalPath, current) ? portable(path.relative(source.originalPath, current)) : null; if (!relative) continue; const entry = manifest.files.find(file => file.source === source.name && file.relative === relative); if (!entry) return false; const currentHash = hashFile(current); return currentHash.bytes === entry.bytes && currentHash.sha256 === entry.sha256 && fs.existsSync(objectPath(vault, entry.sha256)) && fs.statSync(objectPath(vault, entry.sha256)).size === entry.bytes; }
  return false;
}
function readSnapshotManifest(root: string, snapshotId: string): EvidenceVaultManifest { if (!/^snapshot-[a-zA-Z0-9-]+$/.test(snapshotId)) throw new Error(`Invalid snapshot id: ${snapshotId}`); const directory = path.join(root, "snapshots", snapshotId), manifest = optionalJson<EvidenceVaultManifest>(path.join(directory, "manifest.json")), quarantine = optionalJson<EvidenceVaultQuarantine>(path.join(directory, "quarantine.json")); if (quarantine) throw new Error(`Evidence snapshot is quarantined: ${snapshotId}`); if (!manifest || !validManifest(manifest)) throw new Error(`Invalid evidence snapshot: ${snapshotId}`); return manifest; }
function auditSingleManifestObjects(root: string, manifest: EvidenceVaultManifest, deep: boolean): string[] { const issues: string[] = []; for (const entry of manifest.files) { const object = objectPath(root, entry.sha256); if (!fs.existsSync(object)) issues.push(`missing ${entry.sha256}`); else { const stat = fs.statSync(object); if (stat.size !== entry.bytes) issues.push(`size ${entry.sha256}`); else if (deep && hashFile(object).sha256 !== entry.sha256) issues.push(`hash ${entry.sha256}`); } } return [...new Set(issues)]; }
function enumerateObjects(root: string): Array<{file: string; bytes: number; mtimeMs: number}> { const objects = path.join(root, "objects"), result: Array<{file: string; bytes: number; mtimeMs: number}> = []; if (!fs.existsSync(objects)) return result; for (const prefix of fs.readdirSync(objects, {withFileTypes: true})) { if (!prefix.isDirectory() || prefix.name === ".incoming") continue; const directory = path.join(objects, prefix.name); for (const entry of fs.readdirSync(directory, {withFileTypes: true})) if (entry.isFile() && /^[a-f0-9]{64}$/i.test(entry.name)) { const file = path.join(directory, entry.name), stat = fs.statSync(file); result.push({file, bytes: stat.size, mtimeMs: stat.mtimeMs}); } } return result; }
function touchSnapshot(root: string, snapshotId: string): void { atomicJson(path.join(root, "snapshots", snapshotId, "last-used.json"), {schemaVersion: 1, snapshotId, lastUsedAt: new Date().toISOString()}); }
function objectPath(root: string, sha256: string): string { if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error(`Invalid evidence object hash: ${sha256}`); return path.join(root, "objects", sha256.slice(0, 2), sha256.toLowerCase()); }
function hashFile(file: string): {sha256: string; bytes: number} { const descriptor = fs.openSync(file, "r"), hash = crypto.createHash("sha256"), buffer = Buffer.allocUnsafe(1024 * 1024); let bytes = 0; try { for (;;) { const read = fs.readSync(descriptor, buffer, 0, buffer.length, null); if (!read) break; hash.update(buffer.subarray(0, read)); bytes += read; } } finally { fs.closeSync(descriptor); } return {sha256: hash.digest("hex"), bytes}; }
function assertSeparated(vault: string, source: string): void { if (vault === source || isInside(vault, source) || isInside(source, vault)) throw new Error(`Evidence vault must be outside every source: ${vault} / ${source}`); }
function isInside(parent: string, child: string): boolean { const relative = path.relative(path.resolve(parent), path.resolve(child)); return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative); }
function safeRelative(value: string): boolean { return Boolean(value) && !value.startsWith("/") && !value.startsWith("\\") && !value.split("/").some(part => !part || part === "." || part === ".."); }
function portable(value: string): string { return value.split(path.sep).join("/"); }
function digest(value: unknown, omitted: string[] = []): string { const normalized = value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !omitted.includes(key))) : value; return crypto.createHash("sha256").update(canonical(normalized)).digest("hex"); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`; return JSON.stringify(value); }
function atomicJson(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
function optionalJson<T>(file: string): T | null { try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return null; } }
