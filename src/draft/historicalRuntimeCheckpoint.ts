import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {loadDynastyState, loadDynastyStateCore, verifyDynastyStateStorage, type DynastyStateStorage} from "./dynastyStateStore";
import {loadRegistrySnapshot} from "./registrySnapshot";

export interface HistoricalRuntimeFingerprint {
  codeHash: string;
  dataHash: string;
  registryHash: string;
  benchmarkHash: string;
  dependencyHash: string;
  pokemonShowdownVersion: string;
}

interface FileReference {file: string; sha256: string; bytes: number}
interface RuntimeBundleManifest {
  schemaVersion: 1;
  runtimeId: string;
  fingerprint: Pick<HistoricalRuntimeFingerprint, "codeHash" | "benchmarkHash" | "dependencyHash" | "pokemonShowdownVersion">;
  files: FileReference[];
}
interface RuntimeBundleReference {runtimeId: string; manifest: string; manifestSha256: string; codeHash: string}
interface CompressedStateReference {archive: string; archiveSha256: string; stateSha256: string; stateBytes: number; compressedBytes: number}
export interface HistoricalDynastyCheckpoint {
  schemaVersion: 1;
  completedSeason: number;
  fingerprint: HistoricalRuntimeFingerprint;
  registrySnapshot: string;
  state: CompressedStateReference;
  stateStorage?: DynastyStateStorage;
  runtime: RuntimeBundleReference;
}
export interface HistoricalReplayCheckpoint {
  targetSeason: number;
  sourceCompletedSeason: number;
  runtimeWorkspace: string;
  runtimeId: string;
  runtimeFingerprint: HistoricalRuntimeFingerprint;
  registrySource: string;
  nodePath: string;
}
export interface HistoricalReplaySegment extends HistoricalReplayCheckpoint {
  firstSeason: number;
  lastSeason: number;
}
export interface MaterializedHistoricalBoundary {completedSeason: number; registrySource: string}
export type HistoricalReplayPlanIssue = "invalid-request" | "source-invalid" | "checkpoint-missing" | "checkpoint-invalid" | "runtime-missing" | "runtime-invalid" | "registry-transition-unsupported" | "registry-invalid" | "environment-mismatch" | "unknown";
export type HistoricalReplayPlanInspection = {ready: true; segments: HistoricalReplaySegment[]} | {ready: false; issue: HistoricalReplayPlanIssue; message: string};

export function materializeSpawnWorkingDirectory(directory: string, platform = process.platform, maximumLength = 240): {cwd: string; cleanup: () => void} {
  const resolved = path.resolve(directory);
  if (platform !== "win32" || resolved.length <= maximumLength) return {cwd: resolved, cleanup: () => undefined};
  const parent = path.join(os.tmpdir(), "mythicmons-runtime-cwd"), link = path.join(parent, `${process.pid}-${crypto.randomBytes(8).toString("hex")}`);
  fs.mkdirSync(parent, {recursive: true}); fs.symlinkSync(resolved, link, "junction");
  return {cwd: link, cleanup: () => { if (fs.existsSync(link)) fs.unlinkSync(link); }};
}

type StoredBoundary = {completedSeason: number; fingerprint: HistoricalRuntimeFingerprint; registry?: {snapshot?: string; hash?: string}; stateStorage?: DynastyStateStorage};
const capturedCheckpoints = new Map<string, HistoricalDynastyCheckpoint>();
const ensuredRuntimes = new Map<string, RuntimeBundleReference>();

export function captureHistoricalDynastyCheckpoint(projectRoot: string, dynastyRoot: string, completedSeason: number): HistoricalDynastyCheckpoint {
  const project = path.resolve(projectRoot), dynasty = path.resolve(dynastyRoot), stateFile = path.join(dynasty, "dynasty-state.json");
  const boundary = loadDynastyStateCore<StoredBoundary>(stateFile);
  if (boundary.completedSeason !== completedSeason || !boundary.registry?.snapshot) throw new Error("Historical checkpoint boundary does not match the persisted dynasty state");
  const stateBytes = fs.readFileSync(stateFile), stateSha256 = digest(stateBytes);
  const captureKey = `${dynasty}\0${completedSeason}\0${stateSha256}`, cached = capturedCheckpoints.get(captureKey);
  if (cached) return verifyHistoricalDynastyCheckpoint(dynasty, completedSeason);
  verifyDynastyStateStorage(stateFile, boundary.stateStorage);
  const compressed = zlib.gzipSync(stateBytes, {level: 9});
  const runtime = ensureRuntimeBundle(project, dynasty, boundary.fingerprint);
  const directory = checkpointDirectory(dynasty, completedSeason), archiveName = `dynasty-state.${stateSha256}.json.gz`, archive = path.join(directory, archiveName);
  fs.mkdirSync(directory, {recursive: true});
  writeContentAddressed(archive, compressed);
  const checkpoint: HistoricalDynastyCheckpoint = {
    schemaVersion: 1,
    completedSeason,
    fingerprint: boundary.fingerprint,
    registrySnapshot: normalize(boundary.registry.snapshot),
    state: {archive: archiveName, archiveSha256: digest(compressed), stateSha256, stateBytes: stateBytes.length, compressedBytes: compressed.length},
    ...(boundary.stateStorage ? {stateStorage: boundary.stateStorage} : {}),
    runtime,
  };
  atomicWrite(path.join(directory, "checkpoint.json"), Buffer.from(`${JSON.stringify(checkpoint, null, 2)}\n`, "utf8"));
  verifyHistoricalDynastyCheckpoint(dynasty, completedSeason);
  capturedCheckpoints.set(captureKey, checkpoint);
  return checkpoint;
}

export function verifyHistoricalDynastyCheckpoint(dynastyRoot: string, completedSeason: number): HistoricalDynastyCheckpoint {
  const dynasty = path.resolve(dynastyRoot), directory = checkpointDirectory(dynasty, completedSeason), checkpoint = read<HistoricalDynastyCheckpoint>(path.join(directory, "checkpoint.json"));
  if (checkpoint.schemaVersion !== 1 || checkpoint.completedSeason !== completedSeason) throw new Error("Invalid historical dynasty checkpoint manifest");
  validateFingerprint(checkpoint.fingerprint);
  const archive = resolveWithin(directory, checkpoint.state.archive), compressed = fs.readFileSync(archive);
  if (compressed.length !== checkpoint.state.compressedBytes || digest(compressed) !== checkpoint.state.archiveSha256) throw new Error("Historical dynasty checkpoint archive hash mismatch");
  const stateBytes = zlib.gunzipSync(compressed);
  if (stateBytes.length !== checkpoint.state.stateBytes || digest(stateBytes) !== checkpoint.state.stateSha256) throw new Error("Historical dynasty checkpoint state hash mismatch");
  const state = JSON.parse(stateBytes.toString("utf8")) as StoredBoundary;
  if (state.completedSeason !== completedSeason || JSON.stringify(state.fingerprint) !== JSON.stringify(checkpoint.fingerprint) || normalize(state.registry?.snapshot ?? "") !== checkpoint.registrySnapshot || state.registry?.hash !== checkpoint.fingerprint.registryHash || JSON.stringify(state.stateStorage ?? null) !== JSON.stringify(checkpoint.stateStorage ?? null)) throw new Error("Historical dynasty checkpoint state binding mismatch");
  try { verifyDynastyStateStorage(path.join(dynasty, "dynasty-state.json"), checkpoint.stateStorage); }
  catch (error) { throw new Error(`Historical dynasty checkpoint state archive invalid: ${error instanceof Error ? error.message : String(error)}`); }
  verifyRuntimeBundle(dynasty, checkpoint.runtime, checkpoint.fingerprint);
  const registry = resolveWithin(dynasty, checkpoint.registrySnapshot);
  if (!fs.existsSync(path.join(registry, "registry-manifest.json"))) throw new Error("Historical dynasty checkpoint registry snapshot is missing");
  if (loadRegistrySnapshot(registry).hash !== checkpoint.fingerprint.registryHash) throw new Error("Historical dynasty checkpoint registry hash mismatch");
  return checkpoint;
}

export function hasHistoricalReplayCheckpoint(dynastyRoot: string, targetSeason: number): boolean {
  try { resolveHistoricalReplayCheckpoint(dynastyRoot, targetSeason); return true; } catch { return false; }
}

export function hasHistoricalReplayPlan(dynastyRoot: string, targetSeason: number, finalSeason: number): boolean {
  return inspectHistoricalReplayPlan(dynastyRoot, targetSeason, finalSeason).ready;
}

export function inspectHistoricalReplayPlan(dynastyRoot: string, targetSeason: number, finalSeason: number): HistoricalReplayPlanInspection {
  try { return {ready: true, segments: planHistoricalReplaySegments(dynastyRoot, targetSeason, finalSeason)}; }
  catch (error) { return {ready: false, issue: classifyReplayPlanIssue(error), message: error instanceof Error ? error.message : String(error)}; }
}

export function resolveHistoricalReplayCheckpoint(dynastyRoot: string, targetSeason: number): HistoricalReplayCheckpoint {
  const [{firstSeason: _firstSeason, lastSeason: _lastSeason, ...checkpoint}] = planHistoricalReplaySegments(dynastyRoot, targetSeason, targetSeason);
  return checkpoint;
}

export function planHistoricalReplaySegments(dynastyRoot: string, targetSeason: number, finalSeason: number): HistoricalReplaySegment[] {
  if (!Number.isInteger(targetSeason) || targetSeason < 1) throw new Error("Historical replay target season must be positive");
  if (!Number.isInteger(finalSeason) || finalSeason < targetSeason) throw new Error("Historical replay final season must not precede its target");
  const dynasty = path.resolve(dynastyRoot);
  let source: {completedSeason: number};
  try { source = loadDynastyStateCore<{completedSeason: number}>(path.join(dynasty, "dynasty-state.json")); }
  catch (error) { throw new Error(`Historical replay source is invalid: ${error instanceof Error ? error.message : String(error)}`); }
  if (!Number.isInteger(source.completedSeason) || source.completedSeason < targetSeason) throw new Error("Historical replay source has not completed its target season");
  const stateCheckpoint = verifyHistoricalDynastyCheckpoint(dynasty, targetSeason - 1), registryHash = stateCheckpoint.fingerprint.registryHash;
  const segments: HistoricalReplaySegment[] = [];
  for (let season = targetSeason; season <= finalSeason; season += 1) {
    const recordedSeason = Math.min(season, source.completedSeason), runtimeCheckpoint = verifyHistoricalDynastyCheckpoint(dynasty, recordedSeason);
    if (runtimeCheckpoint.fingerprint.registryHash !== registryHash) throw new Error("Historical replay across a registry transition is not supported");
    const manifest = verifyRuntimeBundle(dynasty, runtimeCheckpoint.runtime, runtimeCheckpoint.fingerprint);
    const checkpoint: HistoricalReplaySegment = {
      targetSeason: season,
      sourceCompletedSeason: targetSeason - 1,
      firstSeason: season,
      lastSeason: season,
      runtimeWorkspace: path.join(path.dirname(resolveWithin(dynasty, runtimeCheckpoint.runtime.manifest)), "workspace"),
      runtimeId: manifest.runtimeId,
      runtimeFingerprint: runtimeCheckpoint.fingerprint,
      registrySource: resolveWithin(dynasty, runtimeCheckpoint.registrySnapshot),
      nodePath: matchingNodePath(runtimeCheckpoint.fingerprint),
    };
    const previous = segments.at(-1);
    if (previous && previous.runtimeId === checkpoint.runtimeId && previous.registrySource === checkpoint.registrySource && previous.nodePath === checkpoint.nodePath) previous.lastSeason = season;
    else segments.push(checkpoint);
  }
  return segments;
}

export function materializeHistoricalReplayCheckpoint(dynastyRoot: string, targetSeason: number, targetRoot: string): HistoricalReplayCheckpoint {
  const dynasty = path.resolve(dynastyRoot), target = path.resolve(targetRoot), replay = resolveHistoricalReplayCheckpoint(dynasty, targetSeason);
  assertSeparateRoots(dynasty, target);
  if (fs.existsSync(target)) throw new Error(`Historical replay target exists: ${target}`);
  const stateCheckpoint = verifyHistoricalDynastyCheckpoint(dynasty, targetSeason - 1), directory = checkpointDirectory(dynasty, targetSeason - 1);
  fs.mkdirSync(target, {recursive: true});
  try {
    const compressed = fs.readFileSync(resolveWithin(directory, stateCheckpoint.state.archive)), stateBytes = zlib.gunzipSync(compressed);
    atomicWrite(path.join(target, "dynasty-state.json"), stateBytes);
    for (const reference of [stateCheckpoint.stateStorage?.decisionRecords, stateCheckpoint.stateStorage?.evolutionArchive, stateCheckpoint.stateStorage?.mechanismLedgers]) if (reference) copyFile(dynasty, target, reference.file);
    copyTree(replay.registrySource, resolveWithin(target, stateCheckpoint.registrySnapshot));
    for (let season = 1; season < targetSeason; season += 1) for (const name of ["season.json", "evolution.json", "health.json"]) {
      const relative = `season-${String(season).padStart(2, "0")}/${name}`, source = resolveWithin(dynasty, relative);
      if (fs.existsSync(source)) copyFile(dynasty, target, relative);
      else if (name === "season.json") throw new Error(`Missing historical season summary: ${relative}`);
    }
    loadDynastyState(path.join(target, "dynasty-state.json"));
    const materialized = {...replay, registrySource: resolveWithin(target, stateCheckpoint.registrySnapshot)};
    atomicWrite(path.join(target, "historical-replay.json"), Buffer.from(`${JSON.stringify(materialized, null, 2)}\n`, "utf8"));
    return materialized;
  } catch (error) {
    fs.rmSync(target, {recursive: true, force: true});
    throw error;
  }
}

export function materializeHistoricalDynastyBoundary(dynastyRoot: string, completedSeason: number, targetRoot: string): MaterializedHistoricalBoundary {
  const dynasty = path.resolve(dynastyRoot), target = path.resolve(targetRoot), checkpoint = verifyHistoricalDynastyCheckpoint(dynasty, completedSeason), directory = checkpointDirectory(dynasty, completedSeason);
  assertSeparateRoots(dynasty, target);
  if (fs.existsSync(target)) throw new Error(`Historical boundary target exists: ${target}`);
  fs.mkdirSync(target, {recursive: true});
  try {
    const compressed = fs.readFileSync(resolveWithin(directory, checkpoint.state.archive)), stateBytes = zlib.gunzipSync(compressed);
    atomicWrite(path.join(target, "dynasty-state.json"), stateBytes);
    for (const reference of [checkpoint.stateStorage?.decisionRecords, checkpoint.stateStorage?.evolutionArchive, checkpoint.stateStorage?.mechanismLedgers]) if (reference) copyFile(dynasty, target, reference.file);
    const registrySource = resolveWithin(target, checkpoint.registrySnapshot);
    copyTree(resolveWithin(dynasty, checkpoint.registrySnapshot), registrySource);
    for (let season = 1; season <= completedSeason; season++) for (const name of ["season.json", "evolution.json", "health.json"]) {
      const relative = `season-${String(season).padStart(2, "0")}/${name}`, source = resolveWithin(dynasty, relative);
      if (fs.existsSync(source)) copyFile(dynasty, target, relative);
      else if (name === "season.json") throw new Error(`Missing historical season summary: ${relative}`);
    }
    const state = loadDynastyState<any>(path.join(target, "dynasty-state.json"));
    if (state.completedSeason !== completedSeason) throw new Error("Materialized historical boundary has the wrong season");
    return {completedSeason, registrySource};
  } catch (error) {
    fs.rmSync(target, {recursive: true, force: true});
    throw error;
  }
}

function ensureRuntimeBundle(project: string, dynasty: string, fingerprint: HistoricalRuntimeFingerprint): RuntimeBundleReference {
  validateFingerprint(fingerprint);
  const identity = {codeHash: fingerprint.codeHash, benchmarkHash: fingerprint.benchmarkHash, dependencyHash: fingerprint.dependencyHash, pokemonShowdownVersion: fingerprint.pokemonShowdownVersion};
  const runtimeId = digest(Buffer.from(JSON.stringify(identity), "utf8")), directory = path.join(dynasty, ".runtime-bundles", runtimeId), manifestFile = path.join(directory, "runtime-manifest.json");
  const cacheKey = `${manifestFile}\0${JSON.stringify(identity)}`, cached = ensuredRuntimes.get(cacheKey);
  if (cached) { verifyRuntimeBundle(dynasty, cached, fingerprint); return cached; }
  if (!fs.existsSync(manifestFile)) {
    const temporary = `${directory}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`, workspace = path.join(temporary, "workspace");
    fs.mkdirSync(workspace, {recursive: true});
    try {
      const inputs = [
        ...listFiles(path.join(project, "src"), file => file.endsWith(".ts") && !file.includes(`${path.sep}tests${path.sep}`)),
        ...listFiles(path.join(project, "benchmarks", "gen9expanded"), () => true),
        ...["package.json", "package-lock.json", "tsconfig.json"].map(file => path.join(project, file)).filter(file => fs.existsSync(file)),
      ];
      const files = inputs.map(source => {const relative = normalize(path.relative(project, source)); copyFile(project, workspace, relative); return reference(workspace, path.join(workspace, relative));}).sort((left, right) => left.file.localeCompare(right.file));
      const manifest: RuntimeBundleManifest = {schemaVersion: 1, runtimeId, fingerprint: identity, files};
      atomicWrite(path.join(temporary, "runtime-manifest.json"), Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"));
      fs.mkdirSync(path.dirname(directory), {recursive: true}); fs.renameSync(temporary, directory);
    } catch (error) { fs.rmSync(temporary, {recursive: true, force: true}); throw error; }
  }
  const bytes = fs.readFileSync(manifestFile), referenceValue = {runtimeId, manifest: normalize(path.relative(dynasty, manifestFile)), manifestSha256: digest(bytes), codeHash: fingerprint.codeHash};
  verifyRuntimeBundle(dynasty, referenceValue, fingerprint);
  ensuredRuntimes.set(cacheKey, referenceValue);
  return referenceValue;
}

function verifyRuntimeBundle(dynasty: string, runtime: RuntimeBundleReference, expected: HistoricalRuntimeFingerprint): RuntimeBundleManifest {
  if (!/^[a-f0-9]{64}$/.test(runtime.runtimeId) || runtime.codeHash !== expected.codeHash) throw new Error("Invalid historical runtime reference");
  const manifestFile = resolveWithin(dynasty, runtime.manifest), bytes = fs.readFileSync(manifestFile);
  if (digest(bytes) !== runtime.manifestSha256) throw new Error("Historical runtime manifest hash mismatch");
  const manifest = JSON.parse(bytes.toString("utf8")) as RuntimeBundleManifest, identity = {codeHash: expected.codeHash, benchmarkHash: expected.benchmarkHash, dependencyHash: expected.dependencyHash, pokemonShowdownVersion: expected.pokemonShowdownVersion};
  if (manifest.schemaVersion !== 1 || manifest.runtimeId !== runtime.runtimeId || manifest.runtimeId !== digest(Buffer.from(JSON.stringify(identity), "utf8")) || JSON.stringify(manifest.fingerprint) !== JSON.stringify(identity)) throw new Error("Historical runtime identity mismatch");
  const workspace = path.join(path.dirname(manifestFile), "workspace");
  for (const file of manifest.files) verifyFile(workspace, file);
  const sourceFiles = manifest.files.filter(file => file.file.startsWith("src/") && file.file.endsWith(".ts")), benchmarkFiles = manifest.files.filter(file => file.file.startsWith("benchmarks/gen9expanded/"));
  if (hashReferences(workspace, sourceFiles) !== expected.codeHash || hashReferences(workspace, benchmarkFiles) !== expected.benchmarkHash) throw new Error("Historical runtime source fingerprint mismatch");
  const lock = manifest.files.find(file => file.file === "package-lock.json");
  if (!lock || hashReferences(workspace, [lock]) !== expected.dependencyHash) throw new Error("Historical runtime dependency fingerprint mismatch");
  return manifest;
}

function checkpointDirectory(root: string, season: number): string { return path.join(root, ".season-checkpoints", `season-${String(season).padStart(2, "0")}`); }
function listFiles(directory: string, include: (file: string) => boolean): string[] { const output: string[] = []; const visit = (current: string): void => {for (const entry of fs.readdirSync(current, {withFileTypes: true})) {const target = path.join(current, entry.name); if (entry.isSymbolicLink()) throw new Error(`Runtime bundle source contains a symbolic link: ${target}`); if (entry.isDirectory()) visit(target); else if (entry.isFile() && include(target)) output.push(target);}}; visit(directory); return output.sort(); }
function reference(root: string, file: string): FileReference { const bytes = fs.readFileSync(file); return {file: normalize(path.relative(root, file)), sha256: digest(bytes), bytes: bytes.length}; }
function verifyFile(root: string, file: FileReference): void { const target = resolveWithin(root, file.file), bytes = fs.readFileSync(target); if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error(`Historical runtime file hash mismatch: ${file.file}`); }
function hashReferences(root: string, files: FileReference[]): string { const hash = crypto.createHash("sha256"); for (const file of [...files].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0)) {hash.update(file.file).update("\0").update(fs.readFileSync(resolveWithin(root, file.file))).update("\0");} return hash.digest("hex"); }
function copyTree(source: string, target: string): void { for (const entry of fs.readdirSync(source, {withFileTypes: true})) {const from = path.join(source, entry.name), to = path.join(target, entry.name); if (entry.isSymbolicLink()) throw new Error(`Historical checkpoint contains a symbolic link: ${from}`); if (entry.isDirectory()) copyTree(from, to); else if (entry.isFile()) {fs.mkdirSync(path.dirname(to), {recursive: true}); fs.copyFileSync(from, to, fs.constants.COPYFILE_FICLONE);}} }
function copyFile(sourceRoot: string, targetRoot: string, relative: string): void { const source = resolveWithin(sourceRoot, relative), target = resolveWithin(targetRoot, relative); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE); }
function writeContentAddressed(file: string, bytes: Buffer): void { if (fs.existsSync(file)) {if (digest(fs.readFileSync(file)) !== digest(bytes)) throw new Error(`Historical content-addressed file mismatch: ${file}`);} else atomicWrite(file, bytes); }
function atomicWrite(file: string, bytes: Buffer): void { fs.mkdirSync(path.dirname(file), {recursive: true}); const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`; fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, file); }
function resolveWithin(root: string, relative: string): string { if (!relative || path.isAbsolute(relative)) throw new Error(`Unsafe historical checkpoint path: ${relative}`); const resolvedRoot = path.resolve(root), target = path.resolve(resolvedRoot, relative); if (!target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`Historical checkpoint path escaped its root: ${relative}`); return target; }
function assertSeparateRoots(source: string, target: string): void { if (source === target || source.startsWith(`${target}${path.sep}`) || target.startsWith(`${source}${path.sep}`) || path.parse(target).root === target) throw new Error("Historical replay target must be separate from its source"); }
function matchingNodePath(expected: HistoricalRuntimeFingerprint): string { const nodePath = path.dirname(path.dirname(require.resolve("tsx/package.json"))), project = path.dirname(nodePath), lock = path.join(project, "package-lock.json"), showdown = read<{version?: string}>(require.resolve("pokemon-showdown/package.json")); if (!fs.existsSync(lock) || hashReferences(project, [reference(project, lock)]) !== expected.dependencyHash) throw new Error("Historical runtime dependencies do not match the installed package lock; isolated installation is required"); if (showdown.version !== expected.pokemonShowdownVersion) throw new Error("Historical Pokemon Showdown version is not installed"); return nodePath; }
function classifyReplayPlanIssue(error: unknown): HistoricalReplayPlanIssue {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (message.includes("target season must") || message.includes("final season must")) return "invalid-request";
  if (message.includes("across a registry transition")) return "registry-transition-unsupported";
  if (message.includes("installed package lock") || message.includes("showdown version is not installed")) return "environment-mismatch";
  if (message.includes("enoent") && message.includes(".season-checkpoints")) return "checkpoint-missing";
  if (message.includes("enoent") && message.includes(".runtime-bundles")) return "runtime-missing";
  if (message.includes("source is invalid") || message.includes("source has not completed") || message.includes("dynasty-state.json")) return "source-invalid";
  if (message.includes("registry snapshot") || message.includes("registry hash mismatch") || message.includes("registry-manifest")) return "registry-invalid";
  if (message.includes("historical dynasty checkpoint")) return "checkpoint-invalid";
  if (message.includes("historical runtime")) return "runtime-invalid";
  if (message.includes("pokemon showdown") || message.includes("dependency")) return "environment-mismatch";
  return "unknown";
}
function validateFingerprint(value: HistoricalRuntimeFingerprint): void { for (const key of ["codeHash", "dataHash", "registryHash", "benchmarkHash", "dependencyHash"] as const) if (!/^[a-f0-9]{64}$/.test(value[key])) throw new Error(`Invalid historical runtime ${key}`); if (!value.pokemonShowdownVersion) throw new Error("Invalid historical Pokemon Showdown version"); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function normalize(value: string): string { return value.replace(/\\/g, "/"); }
function digest(value: Buffer): string { return crypto.createHash("sha256").update(value).digest("hex"); }
