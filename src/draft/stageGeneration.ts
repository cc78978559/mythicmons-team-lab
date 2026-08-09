import fs from "node:fs";
import path from "node:path";

export interface ArchivedStageGeneration {directory: string; moved: string[]}
export interface StageGenerationArchiveAudit {root: string; totalBytes: number; entries: Array<{directory: string; archivedAt: string; state: "moving" | "complete"; bytes: number}>}
export interface StageGenerationArchiveGc {audit: StageGenerationArchiveAudit; apply: boolean; removed: string[]; reclaimedBytes: number; projectedBytes: number; projectedGenerations: number}
interface ArchiveManifest {schemaVersion: 1; inputSignature: string; archivedAt: string; sourceRoot: string; state: "moving" | "complete"; planned: string[]; moved: string[]; recoveredControlFiles?: string[]}
interface StagePreparation {rootDirectory: string; anchorName: string; inputSignature: string; retainedNames?: readonly string[]; replaceStale: boolean; validateAnchor: () => void}

export function prepareStageGeneration(options: StagePreparation): ArchivedStageGeneration | null {
  const retainedNames = options.retainedNames ?? [], recovered = recoverStageGenerationArchives(options.rootDirectory, retainedNames), entries = activeStageGenerationEntries(options.rootDirectory, retainedNames), anchorExists = entries.includes(options.anchorName);
  if (anchorExists) {
    try { options.validateAnchor(); return null; }
    catch (error) { if (!options.replaceStale) throw error; return archiveStageGeneration(options.rootDirectory, options.inputSignature, retainedNames); }
  }
  if (entries.length) {
    if (!options.replaceStale) throw new Error(`Stage generation is missing ${options.anchorName} but retains: ${entries.join(",")}; use --replace-stale or a new output directory`);
    return archiveStageGeneration(options.rootDirectory, options.inputSignature, retainedNames);
  }
  return recovered.at(-1) ?? null;
}

export function activeStageGenerationEntries(rootDirectory: string, retainedNames: readonly string[] = []): string[] {
  const root = path.resolve(rootDirectory), retained = new Set(["archive", ...retainedNames]); if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, {withFileTypes: true}).map(entry => entry.name).filter(name => !retained.has(name)).sort();
}

export function archiveStageGeneration(rootDirectory: string, inputSignature: string, retainedNames: readonly string[] = []): ArchivedStageGeneration {
  const root = path.resolve(rootDirectory), archiveRoot = path.join(root, "archive"), recovered = recoverStageGenerationArchives(root, retainedNames), planned = activeStageGenerationEntries(root, retainedNames);
  if (!planned.length && recovered.length) return recovered.at(-1)!;
  const safeSignature = /^[a-f0-9]{12,}$/i.test(inputSignature) ? inputSignature.slice(0, 16).toLowerCase() : "unknown", target = uniqueTarget(archiveRoot, `generation-${safeSignature}`); fs.mkdirSync(target, {recursive: true});
  const manifest: ArchiveManifest = {schemaVersion: 1, inputSignature, archivedAt: new Date().toISOString(), sourceRoot: root, state: "moving", planned, moved: []}; writeManifest(target, manifest);
  for (const name of planned) { moveEntry(root, target, name); manifest.moved.push(name); writeManifest(target, manifest); }
  manifest.state = "complete"; writeManifest(target, manifest); return {directory: target, moved: [...manifest.moved].sort()};
}

export function recoverStageGenerationArchives(rootDirectory: string, retainedNames: readonly string[] = []): ArchivedStageGeneration[] {
  const root = path.resolve(rootDirectory), archiveRoot = path.join(root, "archive"); if (!fs.existsSync(archiveRoot)) return [];
  const retained = new Set(["archive", ...retainedNames]), recovered: ArchivedStageGeneration[] = [];
  for (const entry of fs.readdirSync(archiveRoot, {withFileTypes: true}).filter(value => value.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const target = path.resolve(archiveRoot, entry.name), manifestFile = path.join(target, "archive-manifest.json"), manifest = optionalManifest(manifestFile); if (!manifest || manifest.state !== "moving") continue;
    for (const name of manifest.planned) {
      if (retained.has(name)) throw new Error(`Archive journal includes retained stage entry: ${name}`);
      const source = path.resolve(root, name), destination = path.resolve(target, name); let sourceExists = fs.existsSync(source); const destinationExists = fs.existsSync(destination);
      if (sourceExists && destinationExists) {
        if (!new Set(["failures.json", "run-state.json"]).has(name)) throw new Error(`Interrupted archive has duplicate entry: ${name}`);
        const recoveryDirectory = path.join(target, "recovery-controls"); fs.mkdirSync(recoveryDirectory, {recursive: true}); const recovered = uniqueFile(recoveryDirectory, name); fs.renameSync(source, recovered); sourceExists = false; manifest.recoveredControlFiles = [...(manifest.recoveredControlFiles ?? []), path.relative(target, recovered).replaceAll("\\", "/")]; writeManifest(target, manifest);
      }
      if (!sourceExists && !destinationExists) throw new Error(`Interrupted archive lost entry: ${name}`);
      if (sourceExists) moveEntry(root, target, name);
      if (!manifest.moved.includes(name)) manifest.moved.push(name); writeManifest(target, manifest);
    }
    manifest.state = "complete"; manifest.moved.sort(); writeManifest(target, manifest); recovered.push({directory: target, moved: [...manifest.moved]});
  }
  return recovered;
}

export function auditStageGenerationArchives(rootDirectory: string): StageGenerationArchiveAudit {
  const root = path.resolve(rootDirectory), archiveRoot = path.join(root, "archive"), entries: StageGenerationArchiveAudit["entries"] = []; if (!fs.existsSync(archiveRoot)) return {root, totalBytes: 0, entries};
  for (const entry of fs.readdirSync(archiveRoot, {withFileTypes: true}).filter(value => value.isDirectory())) { const directory = path.resolve(archiveRoot, entry.name), manifest = optionalManifest(path.join(directory, "archive-manifest.json")); if (!manifest) continue; entries.push({directory, archivedAt: manifest.archivedAt, state: manifest.state, bytes: directoryBytes(directory)}); }
  entries.sort((left, right) => Date.parse(left.archivedAt) - Date.parse(right.archivedAt) || left.directory.localeCompare(right.directory)); return {root, totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), entries};
}

export function gcStageGenerationArchives(rootDirectory: string, options: {budgetBytes: number; maxGenerations: number; apply: boolean}): StageGenerationArchiveGc {
  const audit = auditStageGenerationArchives(rootDirectory), complete = audit.entries.filter(entry => entry.state === "complete"), removed: string[] = []; let projectedBytes = audit.totalBytes, projectedGenerations = complete.length, reclaimedBytes = 0;
  for (const entry of complete) { if (projectedBytes <= options.budgetBytes && projectedGenerations <= options.maxGenerations || projectedGenerations <= 1) break; const archiveRoot = path.resolve(audit.root, "archive"), target = path.resolve(entry.directory); if (path.dirname(target) !== archiveRoot) throw new Error(`Unsafe stage archive GC target: ${target}`); removed.push(target); projectedBytes -= entry.bytes; projectedGenerations -= 1; reclaimedBytes += entry.bytes; if (options.apply) fs.rmSync(target, {recursive: true, force: true}); }
  return {audit, apply: options.apply, removed, reclaimedBytes, projectedBytes, projectedGenerations};
}

function moveEntry(root: string, target: string, name: string): void {
  const source = path.resolve(root, name), destination = path.resolve(target, name);
  if (path.dirname(source) !== root || path.dirname(destination) !== target) throw new Error(`Unsafe stage generation path: ${name}`);
  fs.renameSync(source, destination);
}
function writeManifest(target: string, value: ArchiveManifest): void { const file = path.join(target, "archive-manifest.json"), temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify({...value, planned: [...value.planned].sort(), moved: [...value.moved].sort()}, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
function optionalManifest(file: string): ArchiveManifest | null { try { const value = JSON.parse(fs.readFileSync(file, "utf8")) as ArchiveManifest; return value.schemaVersion === 1 && Array.isArray(value.planned) && Array.isArray(value.moved) ? value : null; } catch { return null; } }
function uniqueTarget(archiveRoot: string, base: string): string { fs.mkdirSync(archiveRoot, {recursive: true}); for (let suffix = 0; suffix < 10000; suffix += 1) { const target = path.join(archiveRoot, suffix ? `${base}-${suffix}` : base); if (!fs.existsSync(target)) return target; } throw new Error(`Unable to allocate stage archive under ${archiveRoot}`); }
function uniqueFile(directory: string, name: string): string { const extension = path.extname(name), stem = path.basename(name, extension); for (let suffix = 0; suffix < 10000; suffix += 1) { const file = path.join(directory, `${stem}${suffix ? `-${suffix}` : ""}${extension}`); if (!fs.existsSync(file)) return file; } throw new Error(`Unable to preserve recovered control file: ${name}`); }
function directoryBytes(directory: string): number { let bytes = 0; const stack = [directory]; while (stack.length) { const current = stack.pop()!; for (const entry of fs.readdirSync(current, {withFileTypes: true})) { const target = path.join(current, entry.name); if (entry.isDirectory()) stack.push(target); else if (entry.isFile()) bytes += fs.statSync(target).size; } } return bytes; }
