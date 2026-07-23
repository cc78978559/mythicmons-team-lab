import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const DYNASTY_STATE_STORAGE_SCHEMA_VERSION = 1;

export interface DynastyStateArchiveReference {
  encoding: "gzip-json";
  file: string;
  sha256: string;
  payloadSha256: string;
  items: number;
  bytes: number;
  compressedBytes: number;
}

export interface DynastyStateStorage {
  schemaVersion: typeof DYNASTY_STATE_STORAGE_SCHEMA_VERSION;
  decisionRecords?: DynastyStateArchiveReference;
  evolutionArchive?: DynastyStateArchiveReference;
}

export interface PreparedDynastyState {
  bytes: Buffer;
  storage: DynastyStateStorage;
}

type ExternalizableState = {
  decisionRecords?: unknown[];
  evolutionArchive?: unknown[];
  stateStorage?: DynastyStateStorage;
};

/**
 * Loads both legacy inline states and split states. Archive hashes and item
 * counts are verified before the hydrated state is returned.
 */
export function loadDynastyState<T>(stateFile: string): T {
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as ExternalizableState;
  const storage = state.stateStorage;
  if (!storage) return state as T;
  if (storage.schemaVersion !== DYNASTY_STATE_STORAGE_SCHEMA_VERSION) throw new Error(`Unsupported dynasty state storage schema ${storage.schemaVersion}`);
  if (storage.decisionRecords) state.decisionRecords = hydrateArchiveField(stateFile, storage.decisionRecords, "decisionRecords", state.decisionRecords);
  if (storage.evolutionArchive) state.evolutionArchive = hydrateArchiveField(stateFile, storage.evolutionArchive, "evolutionArchive", state.evolutionArchive);
  return state as T;
}

/** Reads only the active core. Use this for commands that do not inspect history. */
export function loadDynastyStateCore<T>(stateFile: string): T {
  return JSON.parse(fs.readFileSync(stateFile, "utf8")) as T;
}

/**
 * Writes content-addressed archives and returns the exact main-state bytes.
 * The caller can use the bytes in a larger transaction before atomically
 * replacing dynasty-state.json.
 */
export function prepareDynastyState<T extends object>(stateFile: string, input: T): PreparedDynastyState {
  const state = {...input} as Record<string, unknown> & ExternalizableState;
  const previous = state.stateStorage;
  const storage: DynastyStateStorage = {schemaVersion: DYNASTY_STATE_STORAGE_SCHEMA_VERSION};
  if (Array.isArray(state.decisionRecords)) storage.decisionRecords = writeArchive(stateFile, "decision-records", state.decisionRecords);
  else if (previous?.decisionRecords) storage.decisionRecords = verifyArchive(stateFile, previous.decisionRecords, "decisionRecords");
  if (Array.isArray(state.evolutionArchive)) storage.evolutionArchive = writeArchive(stateFile, "evolution-archive", state.evolutionArchive);
  else if (previous?.evolutionArchive) storage.evolutionArchive = verifyArchive(stateFile, previous.evolutionArchive, "evolutionArchive");
  delete state.decisionRecords;
  delete state.evolutionArchive;
  state.stateStorage = storage;
  return {bytes: Buffer.from(`${JSON.stringify(state)}\n`, "utf8"), storage};
}

export function persistDynastyState<T extends object>(stateFile: string, state: T): PreparedDynastyState {
  const prepared = prepareDynastyState(stateFile, state);
  atomicWrite(stateFile, prepared.bytes);
  return prepared;
}

/** Verifies every external archive referenced by a split dynasty state. */
export function verifyDynastyStateStorage(stateFile: string, storage: DynastyStateStorage | undefined): void {
  if (!storage) return;
  if (storage.schemaVersion !== DYNASTY_STATE_STORAGE_SCHEMA_VERSION) throw new Error(`Unsupported dynasty state storage schema ${storage.schemaVersion}`);
  if (storage.decisionRecords) loadArchive(stateFile, storage.decisionRecords, "decisionRecords");
  if (storage.evolutionArchive) loadArchive(stateFile, storage.evolutionArchive, "evolutionArchive");
}

function writeArchive(stateFile: string, label: string, value: unknown[]): DynastyStateArchiveReference {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  const payloadSha256 = digest(payload);
  const compressed = zlib.gzipSync(payload, {level: 9});
  const sha256 = digest(compressed);
  const directory = path.join(path.dirname(stateFile), ".dynasty-state");
  const archive = path.join(directory, `${label}.${payloadSha256}.json.gz`);
  fs.mkdirSync(directory, {recursive: true});
  if (fs.existsSync(archive)) {
    if (digest(fs.readFileSync(archive)) !== sha256) throw new Error(`Existing dynasty archive does not match its content address: ${archive}`);
  } else atomicWrite(archive, compressed);
  return {
    encoding: "gzip-json",
    file: path.relative(path.dirname(stateFile), archive).replace(/\\/g, "/"),
    sha256,
    payloadSha256,
    items: value.length,
    bytes: payload.length,
    compressedBytes: compressed.length,
  };
}

function loadArchive(stateFile: string, reference: DynastyStateArchiveReference, label: string): unknown[] {
  const verified = verifyArchive(stateFile, reference, label);
  const archive = resolveArchive(stateFile, verified.file);
  const payload = zlib.gunzipSync(fs.readFileSync(archive));
  if (digest(payload) !== verified.payloadSha256 || payload.length !== verified.bytes) throw new Error(`Dynasty ${label} payload hash mismatch: ${archive}`);
  const value = JSON.parse(payload.toString("utf8")) as unknown;
  if (!Array.isArray(value) || value.length !== verified.items) throw new Error(`Dynasty ${label} item count mismatch: ${archive}`);
  return value;
}

function hydrateArchiveField(stateFile: string, reference: DynastyStateArchiveReference, label: string, inline: unknown[] | undefined): unknown[] {
  const archived = loadArchive(stateFile, reference, label);
  if (Array.isArray(inline) && digest(Buffer.from(JSON.stringify(inline), "utf8")) !== reference.payloadSha256) throw new Error(`Inline dynasty ${label} does not match its archive reference`);
  return archived;
}

function verifyArchive(stateFile: string, reference: DynastyStateArchiveReference, label: string): DynastyStateArchiveReference {
  if (reference.encoding !== "gzip-json" || !/^[a-f0-9]{64}$/.test(reference.sha256) || !/^[a-f0-9]{64}$/.test(reference.payloadSha256)) throw new Error(`Invalid dynasty ${label} archive reference`);
  const archive = resolveArchive(stateFile, reference.file);
  if (!fs.existsSync(archive)) throw new Error(`Missing dynasty ${label} archive: ${archive}`);
  const compressed = fs.readFileSync(archive);
  if (compressed.length !== reference.compressedBytes || digest(compressed) !== reference.sha256) throw new Error(`Dynasty ${label} archive hash mismatch: ${archive}`);
  return reference;
}

function resolveArchive(stateFile: string, relative: string): string {
  if (!relative || path.isAbsolute(relative)) throw new Error(`Unsafe dynasty archive path: ${relative}`);
  const root = path.resolve(path.dirname(stateFile));
  const archive = path.resolve(root, relative);
  if (!archive.startsWith(`${root}${path.sep}`)) throw new Error(`Dynasty archive escaped its state root: ${relative}`);
  return archive;
}

function atomicWrite(file: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, file);
}

function digest(value: Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
