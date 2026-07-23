import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const args = process.argv.slice(2);
const source = path.resolve(required("--source")), league = path.join(source, "league"), statePath = path.join(league, "dynasty-state.json");
const archive = path.join(source, "development-final-state.json.gz"), manifestPath = path.join(source, "development-final-state.json");
if (!fs.existsSync(path.join(source, "entrants.json")) || !fs.existsSync(path.join(source, "development-summary.json"))) throw new Error("Source is not a development-league output");
let manifest: {schemaVersion: 1; archive: string; sha256: string; sourceStateSha256: string; sourceBytes: number; compactBytes: number; managers: number};
if (fs.existsSync(manifestPath) && fs.existsSync(archive)) manifest = verifyExisting();
else {
  if (!fs.existsSync(statePath)) throw new Error("Development league state is missing and no compact final state exists");
  const sourceBytes = fs.readFileSync(statePath), state = JSON.parse(sourceBytes.toString("utf8")) as {managers?: unknown[]};
  if (!Array.isArray(state.managers) || !state.managers.length) throw new Error("Development league state has no managers");
  const bytes = Buffer.from(`${JSON.stringify({schemaVersion: 1, managers: state.managers})}\n`, "utf8"), compressed = zlib.gzipSync(bytes, {level: 9});
  manifest = {schemaVersion: 1, archive: path.basename(archive), sha256: digest(bytes), sourceStateSha256: digest(sourceBytes), sourceBytes: sourceBytes.length, compactBytes: compressed.length, managers: state.managers.length};
  atomicWrite(archive, compressed); atomicWrite(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"));
  verifyExisting();
}
let deletedBytes = 0;
if (args.includes("--prune-league") && fs.existsSync(league)) {
  const resolvedSource = path.resolve(source), resolvedLeague = path.resolve(league), expectedLeague = path.resolve(resolvedSource, "league");
  if (resolvedLeague !== expectedLeague || path.dirname(resolvedLeague) !== resolvedSource || !resolvedLeague.startsWith(`${resolvedSource}${path.sep}`)) throw new Error("League pruning escaped the explicitly named development output");
  deletedBytes = directoryBytes(league); fs.rmSync(league, {recursive: true, force: true});
}
console.log(JSON.stringify({source, managers: manifest.managers, sourceStateMB: mb(manifest.sourceBytes), compactMB: mb(manifest.compactBytes), pruned: !fs.existsSync(league), deletedMB: mb(deletedBytes)}, null, 2));

function verifyExisting() {
  const saved = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as typeof manifest;
  if (saved.schemaVersion !== 1 || path.basename(saved.archive) !== saved.archive) throw new Error("Invalid compact development final-state manifest");
  const bytes = zlib.gunzipSync(fs.readFileSync(path.join(source, saved.archive)));
  if (digest(bytes) !== saved.sha256) throw new Error("Compact development final-state hash mismatch");
  const state = JSON.parse(bytes.toString("utf8")) as {schemaVersion: number; managers: unknown[]};
  if (state.schemaVersion !== 1 || !Array.isArray(state.managers) || state.managers.length !== saved.managers) throw new Error("Compact development final-state manager count mismatch");
  return saved;
}
function atomicWrite(file: string, bytes: Buffer): void { const temporary = `${file}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.tmp`; fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, file); }
function directoryBytes(directory: string): number { return fs.readdirSync(directory, {withFileTypes: true}).reduce((sum, entry) => sum + (entry.isDirectory() ? directoryBytes(path.join(directory, entry.name)) : entry.isFile() ? fs.statSync(path.join(directory, entry.name)).size : 0), 0); }
function digest(bytes: Buffer): string { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function mb(bytes: number): number { return Math.round(bytes / 1024 / 1024 * 100) / 100; }
function required(name: string): string { const index = args.indexOf(name), value = index >= 0 ? args[index + 1] : undefined; if (!value) throw new Error(`Missing ${name}`); return value; }
