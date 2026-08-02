import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {streamDirectoryStats} from "./storageIndex";

export interface SourceCacheEntry {key: string; directory: string; valid: boolean; files: number; bytes: number; newestMtimeMs: number; lastUsedAt: string; references: string[]; pinnedReferences: string[]; activeLeases: string[]; protected: boolean; reasons: string[]}
export interface SourceCacheAudit {schemaVersion: 1; root: string; generatedAt: string; totalBytes: number; budgetBytes: number; overBudgetBytes: number; entries: SourceCacheEntry[]; invalidDirectories: string[]}
export interface SourceCacheGcResult {audit: SourceCacheAudit; apply: boolean; removed: Array<{key: string; bytes: number; reasons: string[]}>; reclaimedBytes: number; remainingBytes: number}

export function touchSourceCache(directory: string, key: string, reason: string): void {
  const target = safeCacheDirectory(path.dirname(path.resolve(directory)), key); if (target !== path.resolve(directory)) throw new Error("Source cache usage target does not match its key");
  atomic(path.join(target, ".last-used.json"), {schemaVersion: 1, key, lastUsedAt: new Date().toISOString(), reason, pid: process.pid});
}

export function acquireSourceCacheLease(directory: string, key: string, reason: string): {release: () => void} {
  const target = safeCacheDirectory(path.dirname(path.resolve(directory)), key); if (target !== path.resolve(directory)) throw new Error("Source cache lease target does not match its key");
  const leases = path.join(target, ".leases"), id = `${process.pid}-${crypto.randomBytes(8).toString("hex")}.json`, file = path.join(leases, id);
  fs.mkdirSync(leases, {recursive: true}); atomic(file, {schemaVersion: 1, key, pid: process.pid, acquiredAt: new Date().toISOString(), reason});
  let released = false;
  return {release: () => { if (released) return; released = true; fs.rmSync(file, {force: true}); try { fs.rmdirSync(leases); } catch {} }};
}

export function auditSourceCaches(cacheRoot: string, referencesRoot: string, budgetBytes: number, protectedKeys: Iterable<string> = []): SourceCacheAudit {
  const root = path.resolve(cacheRoot), protectedSet = new Set(protectedKeys), references = collectReferences(path.resolve(referencesRoot), root);
  const entries: SourceCacheEntry[] = [], invalidDirectories: string[] = [];
  if (fs.existsSync(root)) for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    if (!/^[a-f0-9]{64}$/.test(entry.name)) { if (!entry.name.startsWith(".")) invalidDirectories.push(entry.name); continue; }
    const directory = safeCacheDirectory(root, entry.name), marker = optional<any>(path.join(directory, "source-cache.json")), usage = optional<any>(path.join(directory, ".last-used.json")), stats = streamDirectoryStats(directory);
    const valid = marker?.schemaVersion === 1 && marker.key === entry.name, refs = references.all.get(entry.name) ?? [], pinned = references.pinned.get(entry.name) ?? [], leases = activeLeases(directory);
    entries.push({key: entry.name, directory, valid, ...stats, lastUsedAt: String(usage?.lastUsedAt ?? new Date(stats.newestMtimeMs || fs.statSync(directory).mtimeMs).toISOString()), references: refs, pinnedReferences: pinned, activeLeases: leases, protected: protectedSet.has(entry.name), reasons: [...(!valid ? ["invalid-marker"] : []), ...(pinned.length ? ["active-study-reference"] : []), ...(leases.length ? ["active-process-lease"] : []), ...(protectedSet.has(entry.name) ? ["explicitly-protected"] : [])]});
  }
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  return {schemaVersion: 1, root, generatedAt: new Date().toISOString(), totalBytes, budgetBytes, overBudgetBytes: Math.max(0, totalBytes - budgetBytes), entries: entries.sort((a, b) => Date.parse(a.lastUsedAt) - Date.parse(b.lastUsedAt) || a.key.localeCompare(b.key)), invalidDirectories};
}

export function gcSourceCaches(cacheRoot: string, referencesRoot: string, options: {budgetBytes: number; maxAgeDays: number; apply: boolean; protectedKeys?: Iterable<string>}): SourceCacheGcResult {
  const audit = auditSourceCaches(cacheRoot, referencesRoot, options.budgetBytes, options.protectedKeys), cutoff = Date.now() - options.maxAgeDays * 86400000;
  let remaining = audit.totalBytes; const removed: SourceCacheGcResult["removed"] = [];
  for (const entry of audit.entries) {
    if (!entry.valid || entry.protected || entry.pinnedReferences.length || entry.activeLeases.length) continue;
    const expired = Date.parse(entry.lastUsedAt) < cutoff, overBudget = remaining > options.budgetBytes;
    if (!expired && !overBudget) continue;
    const reasons = [...(expired ? ["expired"] : []), ...(overBudget ? ["over-budget"] : []), ...(entry.references.length ? ["completed-study-rebuildable"] : ["unreferenced"])];
    if (options.apply) fs.rmSync(safeCacheDirectory(audit.root, entry.key), {recursive: true, force: true});
    removed.push({key: entry.key, bytes: entry.bytes, reasons}); remaining -= entry.bytes;
  }
  return {audit, apply: options.apply, removed, reclaimedBytes: removed.reduce((sum, entry) => sum + entry.bytes, 0), remainingBytes: remaining};
}

function collectReferences(root: string, excludedRoot: string): {all: Map<string, string[]>; pinned: Map<string, string[]>} {
  const all = new Map<string, string[]>(), pinned = new Map<string, string[]>(); if (!fs.existsSync(root)) return {all, pinned}; const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const target = path.join(current, entry.name); if (target === excludedRoot || target.startsWith(`${excludedRoot}${path.sep}`)) continue;
      if (entry.isDirectory()) { stack.push(target); continue; }
      if (!entry.isFile() || (entry.name !== "causal-manifest.json" && entry.name !== "causal-summary.json")) continue;
      const value = optional<any>(target); if (!value) continue; const key = String(value.sourceCache?.key ?? value.sharedStudySourceCache?.key ?? ""); if (!/^[a-f0-9]{64}$/.test(key)) continue;
      add(all, key, target); if (entry.name === "causal-manifest.json" && (value.items ?? []).some((item: any) => item.status !== "complete")) add(pinned, key, target);
    }
  }
  return {all, pinned};
}
function safeCacheDirectory(rootDirectory: string, key: string): string { const root = path.resolve(rootDirectory); if (!/^[a-f0-9]{64}$/.test(key)) throw new Error(`Unsafe source cache key: ${key}`); const target = path.resolve(root, key); if (path.dirname(target) !== root) throw new Error(`Source cache escaped its root: ${target}`); return target; }
function activeLeases(directory: string): string[] { const leases = path.join(directory, ".leases"), active: string[] = []; if (!fs.existsSync(leases)) return active; for (const name of fs.readdirSync(leases)) { const file = path.join(leases, name), lease = optional<any>(file), pid = Number(lease?.pid); if (lease?.schemaVersion === 1 && pidAlive(pid)) active.push(file); } return active; }
function pidAlive(pid: number): boolean { if (!Number.isInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; } }
function add(map: Map<string, string[]>, key: string, value: string): void { map.set(key, [...(map.get(key) ?? []), value]); }
function optional<T>(file: string): T | null { try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return null; } }
function atomic(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
