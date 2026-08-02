import fs from "node:fs";
import path from "node:path";

export interface StorageEntry {path: string; files: number; bytes: number; newestMtimeMs: number}
export interface StorageIndex {schemaVersion: 1; root: string; generatedAt: string; files: number; bytes: number; entries: StorageEntry[]}

export function buildStorageIndex(rootDirectory: string): StorageIndex {
  const root = path.resolve(rootDirectory); if (!fs.existsSync(root)) return {schemaVersion: 1, root, generatedAt: new Date().toISOString(), files: 0, bytes: 0, entries: []};
  const entries: StorageEntry[] = [];
  for (const entry of fs.readdirSync(root, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const target = path.join(root, entry.name), value = entry.isDirectory() ? streamDirectoryStats(target) : fileStats(target);
    entries.push({path: entry.name, ...value});
  }
  return {schemaVersion: 1, root, generatedAt: new Date().toISOString(), files: entries.reduce((sum, entry) => sum + entry.files, 0), bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), entries: entries.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))};
}

export function streamDirectoryStats(directory: string): {files: number; bytes: number; newestMtimeMs: number} {
  let files = 0, bytes = 0, newestMtimeMs = 0; const stack = [path.resolve(directory)];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile()) { const stat = fs.statSync(target); files += 1; bytes += stat.size; newestMtimeMs = Math.max(newestMtimeMs, stat.mtimeMs); }
    }
  }
  return {files, bytes, newestMtimeMs};
}
function fileStats(file: string): {files: number; bytes: number; newestMtimeMs: number} { const stat = fs.statSync(file); return {files: 1, bytes: stat.size, newestMtimeMs: stat.mtimeMs}; }
