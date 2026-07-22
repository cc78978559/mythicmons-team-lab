import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {loadDynastyState, loadDynastyStateCore, type DynastyStateStorage} from "./dynastyStateStore";

export const DYNASTY_CHECKPOINT_BRANCH_SCHEMA_VERSION = 1;
export const DYNASTY_CHECKPOINT_BRANCH_MANIFEST = "checkpoint-branch.json";

export interface CheckpointFileReference {
  file: string;
  sha256: string;
  bytes: number;
}

export interface DynastyCheckpointBranchManifest {
  schemaVersion: typeof DYNASTY_CHECKPOINT_BRANCH_SCHEMA_VERSION;
  checkpointId: string;
  sourceRoot: string;
  completedSeason: number;
  state: CheckpointFileReference;
  immutablePrefix: CheckpointFileReference[];
}

type StateBoundary = {
  completedSeason?: number;
  stateStorage?: DynastyStateStorage;
  registry?: {snapshot?: string};
};

/**
 * Builds a content identity for one completed dynasty boundary. The active
 * state is validated, while completed seasons, registry snapshots, and the
 * exact referenced history archives form the immutable branch prefix.
 */
export function buildDynastyCheckpointBranchManifest(sourceRoot: string): DynastyCheckpointBranchManifest {
  const root = path.resolve(sourceRoot);
  const stateFile = path.join(root, "dynasty-state.json");
  if (!fs.existsSync(stateFile)) throw new Error(`Missing dynasty checkpoint state: ${stateFile}`);
  loadDynastyState(stateFile);
  const state = loadDynastyStateCore<StateBoundary>(stateFile);
  if (!Number.isInteger(state.completedSeason) || Number(state.completedSeason) < 1) throw new Error("Dynasty checkpoint must have at least one completed season");
  const completedSeason = Number(state.completedSeason);
  const immutable = new Map<string, CheckpointFileReference>();
  for (let season = 1; season <= completedSeason; season += 1) {
    const relative = `season-${String(season).padStart(2, "0")}`;
    const directory = path.join(root, relative);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error(`Missing completed dynasty season: ${directory}`);
    for (const name of ["season.json", "evolution.json", "health.json"]) {
      const file = path.join(directory, name);
      if (fs.existsSync(file)) immutable.set(normalize(path.relative(root, file)), fileReference(root, file));
      else if (name === "season.json") throw new Error(`Missing completed dynasty season summary: ${file}`);
    }
  }
  if (state.registry?.snapshot) {
    const registrySnapshot = resolveWithin(root, state.registry.snapshot);
    if (!fs.existsSync(registrySnapshot) || !fs.statSync(registrySnapshot).isDirectory()) throw new Error(`Missing dynasty registry snapshot: ${registrySnapshot}`);
    collectFiles(root, registrySnapshot, immutable);
  }
  for (const reference of [state.stateStorage?.decisionRecords, state.stateStorage?.evolutionArchive]) {
    if (!reference) continue;
    const archive = resolveWithin(root, reference.file);
    immutable.set(normalize(path.relative(root, archive)), fileReference(root, archive));
  }
  const stateReference = fileReference(root, stateFile);
  const immutablePrefix = [...immutable.values()].sort((left, right) => left.file.localeCompare(right.file));
  const identity = {completedSeason, state: stateReference, immutablePrefix};
  return {
    schemaVersion: DYNASTY_CHECKPOINT_BRANCH_SCHEMA_VERSION,
    checkpointId: digest(Buffer.from(JSON.stringify(identity), "utf8")),
    sourceRoot: root,
    completedSeason,
    state: stateReference,
    immutablePrefix,
  };
}

/** Materializes an isolated writable branch without mutating the source. */
export function materializeDynastyCheckpointBranch(sourceRoot: string, targetRoot: string): DynastyCheckpointBranchManifest {
  const source = path.resolve(sourceRoot), target = path.resolve(targetRoot);
  assertSeparateRoots(source, target);
  if (fs.existsSync(target)) throw new Error(`Checkpoint branch target exists: ${target}`);
  const manifest = buildDynastyCheckpointBranchManifest(source);
  fs.mkdirSync(target, {recursive: true});
  try {
    copyReference(source, target, manifest.state);
    for (const reference of manifest.immutablePrefix) copyReference(source, target, reference);
    fs.writeFileSync(path.join(target, DYNASTY_CHECKPOINT_BRANCH_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    verifyDynastyCheckpointBranch(target, manifest, true);
    return manifest;
  } catch (error) {
    fs.rmSync(target, {recursive: true, force: true});
    throw error;
  }
}

/**
 * Verifies the immutable prefix after a branch has advanced. State is checked
 * only immediately after materialization because continuation replaces it.
 */
export function verifyDynastyCheckpointBranch(branchRoot: string, manifest: DynastyCheckpointBranchManifest, includeState = false): void {
  validateManifest(manifest);
  const root = path.resolve(branchRoot);
  if (includeState) verifyFile(root, manifest.state, "checkpoint state");
  for (const reference of manifest.immutablePrefix) verifyFile(root, reference, "checkpoint prefix");
}

export function loadDynastyCheckpointBranchManifest(branchRoot: string): DynastyCheckpointBranchManifest {
  const file = path.join(path.resolve(branchRoot), DYNASTY_CHECKPOINT_BRANCH_MANIFEST);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as DynastyCheckpointBranchManifest;
  validateManifest(manifest);
  return manifest;
}

function copyReference(sourceRoot: string, targetRoot: string, reference: CheckpointFileReference): void {
  const source = resolveWithin(sourceRoot, reference.file), target = resolveWithin(targetRoot, reference.file);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE);
}

function collectFiles(root: string, directory: string, output: Map<string, CheckpointFileReference>): void {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Checkpoint prefix contains unsupported symbolic link: ${file}`);
    if (entry.isDirectory()) collectFiles(root, file, output);
    else if (entry.isFile()) output.set(normalize(path.relative(root, file)), fileReference(root, file));
  }
}

function fileReference(root: string, file: string): CheckpointFileReference {
  const bytes = fs.readFileSync(file);
  return {file: normalize(path.relative(root, file)), sha256: digest(bytes), bytes: bytes.length};
}

function verifyFile(root: string, reference: CheckpointFileReference, label: string): void {
  const file = resolveWithin(root, reference.file);
  if (!fs.existsSync(file)) throw new Error(`Missing dynasty ${label} file: ${reference.file}`);
  const bytes = fs.readFileSync(file);
  if (bytes.length !== reference.bytes || digest(bytes) !== reference.sha256) throw new Error(`Dynasty ${label} hash mismatch: ${reference.file}`);
}

function validateManifest(manifest: DynastyCheckpointBranchManifest): void {
  if (manifest.schemaVersion !== DYNASTY_CHECKPOINT_BRANCH_SCHEMA_VERSION || !/^[a-f0-9]{64}$/.test(manifest.checkpointId) || !Number.isInteger(manifest.completedSeason) || manifest.completedSeason < 1) throw new Error("Invalid dynasty checkpoint branch manifest");
  const identity = {completedSeason: manifest.completedSeason, state: manifest.state, immutablePrefix: manifest.immutablePrefix};
  if (digest(Buffer.from(JSON.stringify(identity), "utf8")) !== manifest.checkpointId) throw new Error("Dynasty checkpoint branch manifest identity mismatch");
  for (const reference of [manifest.state, ...manifest.immutablePrefix]) if (!reference.file || path.isAbsolute(reference.file) || !/^[a-f0-9]{64}$/.test(reference.sha256) || !Number.isInteger(reference.bytes) || reference.bytes < 0) throw new Error("Invalid dynasty checkpoint file reference");
}

function resolveWithin(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative)) throw new Error(`Unsafe dynasty checkpoint path: ${relative}`);
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`Dynasty checkpoint path escaped its root: ${relative}`);
  return target;
}

function assertSeparateRoots(source: string, target: string): void {
  if (source === target || source.startsWith(`${target}${path.sep}`) || target.startsWith(`${source}${path.sep}`) || path.parse(target).root === target) throw new Error("Checkpoint branch target must be separate from its source");
}

function normalize(value: string): string { return value.replace(/\\/g, "/"); }
function digest(value: Buffer): string { return crypto.createHash("sha256").update(value).digest("hex"); }
