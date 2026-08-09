import fs from "node:fs";
import path from "node:path";
import type {DynastyStateArchiveReference, DynastyStateStorage} from "./dynastyStateStore";

export interface DynastyStorageEntry {
  file: string;
  bytes: number;
  lastUsedAt: string;
  references: number;
  referencedBy: string[];
}

export interface DynastyStorageAudit {
  schemaVersion: 1;
  root: string;
  generatedAt: string;
  budgetBytes: number;
  graceDays: number;
  totalBytes: number;
  referencedBytes: number;
  orphanBytes: number;
  projectedBytes: number;
  entries: DynastyStorageEntry[];
  removable: string[];
  removed: string[];
  reclaimedBytes: number;
  apply: boolean;
  issues: Array<{severity: "error" | "warning"; code: string; message: string}>;
}

export function auditAndGcDynastyStorage(root: string, options: {budgetBytes: number; graceDays?: number; apply?: boolean; now?: Date}): DynastyStorageAudit {
  const dynasty = path.resolve(root), store = path.join(dynasty, ".dynasty-state"), now = options.now ?? new Date(), graceDays = options.graceDays ?? 14;
  if (!Number.isFinite(options.budgetBytes) || options.budgetBytes < 0 || !Number.isFinite(graceDays) || graceDays < 0) throw new Error("Invalid dynasty storage maintenance options");
  const references = collectReferences(dynasty), files = fs.existsSync(store) ? listFiles(store) : [];
  const entries = files.map(file => {
    const stat = fs.statSync(file), relative = normalize(path.relative(dynasty, file)), sources = [...(references.get(relative) ?? [])].sort();
    return {file: relative, bytes: stat.size, lastUsedAt: new Date(stat.mtimeMs).toISOString(), references: sources.length, referencedBy: sources};
  }).sort((left, right) => left.file.localeCompare(right.file));
  const totalBytes = sum(entries), referencedBytes = sum(entries.filter(entry => entry.references)), orphanBytes = totalBytes - referencedBytes, cutoff = now.getTime() - graceDays * 86400000;
  const orphanCandidates = entries.filter(entry => !entry.references && Date.parse(entry.lastUsedAt) <= cutoff).sort((left, right) => Date.parse(left.lastUsedAt) - Date.parse(right.lastUsedAt) || right.bytes - left.bytes || left.file.localeCompare(right.file));
  let projectedBytes = totalBytes;
  const removable: string[] = [];
  for (const entry of orphanCandidates) {
    if (projectedBytes <= options.budgetBytes && removable.length) break;
    removable.push(entry.file); projectedBytes -= entry.bytes;
  }
  const removed: string[] = [];
  let reclaimedBytes = 0;
  if (options.apply) for (const relative of removable) {
    const entry = entries.find(value => value.file === relative)!;
    const target = resolveWithin(dynasty, relative);
    if ((references.get(relative)?.size ?? 0) > 0) throw new Error(`Refusing to remove referenced dynasty object: ${relative}`);
    if (!fs.existsSync(target) || fs.statSync(target).size !== entry.bytes) throw new Error(`Dynasty object changed after audit: ${relative}`);
    fs.rmSync(target); removed.push(relative); reclaimedBytes += entry.bytes;
  }
  const issues: DynastyStorageAudit["issues"] = [];
  for (const relative of references.keys()) if (!fs.existsSync(resolveWithin(dynasty, relative))) issues.push({severity: "error", code: "missing-referenced-object", message: relative});
  if (projectedBytes > options.budgetBytes) issues.push({severity: "warning", code: "referenced-storage-over-budget", message: `Referenced dynasty objects exceed the budget by ${projectedBytes - options.budgetBytes} bytes`});
  return {schemaVersion: 1, root: dynasty, generatedAt: now.toISOString(), budgetBytes: options.budgetBytes, graceDays, totalBytes, referencedBytes, orphanBytes, projectedBytes: options.apply ? totalBytes - reclaimedBytes : projectedBytes, entries, removable, removed, reclaimedBytes, apply: options.apply === true, issues};
}

function collectReferences(root: string): Map<string, Set<string>> {
  const references = new Map<string, Set<string>>();
  const stateFile = path.join(root, "dynasty-state.json");
  if (fs.existsSync(stateFile)) addStorage(references, root, optionalStorage(stateFile), normalize(path.relative(root, stateFile)));
  const checkpoints = path.join(root, ".season-checkpoints");
  if (fs.existsSync(checkpoints)) for (const file of listFiles(checkpoints).filter(value => path.basename(value) === "checkpoint.json")) {
    const value = read<any>(file); addStorage(references, root, value.stateStorage, normalize(path.relative(root, file)));
  }
  return references;
}

function addStorage(references: Map<string, Set<string>>, root: string, storage: DynastyStateStorage | undefined, source: string): void {
  if (!storage) return;
  for (const reference of [storage.decisionRecords, storage.evolutionArchive, storage.mechanismLedgers]) if (reference) addReference(references, root, reference, source);
}

function addReference(references: Map<string, Set<string>>, root: string, reference: DynastyStateArchiveReference, source: string): void {
  const resolved = resolveWithin(root, reference.file), relative = normalize(path.relative(root, resolved));
  if (!relative.startsWith(".dynasty-state/")) throw new Error(`Dynasty reference is outside the content store: ${reference.file}`);
  const sources = references.get(relative) ?? new Set<string>(); sources.add(source); references.set(relative, sources);
}

function optionalStorage(file: string): DynastyStateStorage | undefined { return read<{stateStorage?: DynastyStateStorage}>(file).stateStorage; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function listFiles(directory: string): string[] { const output: string[] = []; const visit = (current: string): void => {for (const entry of fs.readdirSync(current, {withFileTypes: true})) {const target = path.join(current, entry.name); if (entry.isSymbolicLink()) throw new Error(`Storage audit refuses symbolic links: ${target}`); if (entry.isDirectory()) visit(target); else if (entry.isFile()) output.push(target);}}; visit(directory); return output.sort(); }
function resolveWithin(root: string, relative: string): string { if (!relative || path.isAbsolute(relative)) throw new Error(`Unsafe dynasty storage path: ${relative}`); const resolvedRoot = path.resolve(root), target = path.resolve(resolvedRoot, relative); if (!target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`Dynasty storage path escaped its root: ${relative}`); return target; }
function normalize(value: string): string { return value.replace(/\\/g, "/"); }
function sum(entries: readonly {bytes: number}[]): number { return entries.reduce((total, entry) => total + entry.bytes, 0); }
