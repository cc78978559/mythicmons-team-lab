import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {touchSourceCache} from "../draft/sourceCacheMaintenance";

const args = process.argv.slice(2), donor = path.resolve(required("--donor")), target = path.resolve(required("--target")), season = integer(required("--season"));
const donorMarker = read<any>(path.join(donor, "source-cache.json")), targetMarkerFile = path.join(target, "source-cache.json"), targetMarker = read<any>(targetMarkerFile);
validateCache(donor, donorMarker); validateCache(target, targetMarker);
const relativeCheckpoint = path.join(".season-checkpoints", `season-${String(season).padStart(2, "0")}`), donorCheckpointRoot = path.join(donor, relativeCheckpoint), checkpointFile = path.join(donorCheckpointRoot, "checkpoint.json"), checkpoint = read<any>(checkpointFile);
if (Number(checkpoint.completedSeason) !== season) throw new Error(`Donor checkpoint season mismatch: ${checkpoint.completedSeason}`);
const requiredRoots = [relativeCheckpoint, String(checkpoint.registrySnapshot), path.dirname(String(checkpoint.runtime?.manifest ?? ""))];
if (requiredRoots.some(value => !value || value === "." || path.isAbsolute(value) || value.startsWith(".."))) throw new Error("Checkpoint contains unsafe dependency roots");
const referencedFiles = Object.values(checkpoint.stateStorage ?? {}).map((value: any) => String(value.file ?? "")).filter(Boolean);
for (const relative of referencedFiles) if (path.isAbsolute(relative) || relative.startsWith("..")) throw new Error(`Checkpoint contains unsafe state file: ${relative}`);
const copied: string[] = [];
for (const relative of requiredRoots) copyTreeVerified(path.join(donor, relative), path.join(target, relative), relative, copied);
for (const relative of referencedFiles) copyFileVerified(path.join(donor, relative), path.join(target, relative), relative, copied);
const evidence = {...targetMarker.evidence};
for (const relative of copied) evidence[relative.replaceAll("\\", "/")] = hash(path.join(target, relative));
targetMarker.evidence = Object.fromEntries(Object.entries(evidence).sort(([left], [right]) => left.localeCompare(right)));
targetMarker.checkpointRepairs = [...(targetMarker.checkpointRepairs ?? []), {season, donorKey: donorMarker.key, files: copied.length, repairedAt: new Date().toISOString()}];
write(targetMarkerFile, targetMarker); touchSourceCache(target, targetMarker.key, `checkpoint-repair-s${season}`);
const report = {schemaVersion: 1, status: "repaired", season, donorKey: donorMarker.key, targetKey: targetMarker.key, copiedFiles: copied.length, evidenceFiles: Object.keys(targetMarker.evidence).length, checkpoint: path.join(target, relativeCheckpoint, "checkpoint.json")};
write(path.join(target, `checkpoint-repair-s${String(season).padStart(2, "0")}.json`), report); console.log(JSON.stringify(report, null, 2));

function validateCache(directory: string, marker: any): void { if (marker?.schemaVersion !== 1 || marker.key !== path.basename(directory) || !/^[a-f0-9]{64}$/.test(marker.key)) throw new Error(`Invalid source cache marker: ${directory}`); }
function copyTreeVerified(source: string, destination: string, relativeRoot: string, copied: string[]): void { if (!fs.existsSync(source)) throw new Error(`Checkpoint dependency is missing: ${source}`); for (const entry of fs.readdirSync(source, {withFileTypes: true})) { const from = path.join(source, entry.name), to = path.join(destination, entry.name), relative = path.join(relativeRoot, entry.name); if (entry.isDirectory()) copyTreeVerified(from, to, relative, copied); else if (entry.isFile()) copyFileVerified(from, to, relative, copied); } }
function copyFileVerified(source: string, destination: string, relative: string, copied: string[]): void { if (!fs.existsSync(source)) throw new Error(`Checkpoint dependency file is missing: ${source}`); fs.mkdirSync(path.dirname(destination), {recursive: true}); if (fs.existsSync(destination)) { if (hash(source) !== hash(destination)) throw new Error(`Checkpoint repair conflicts with target file: ${relative}`); } else fs.copyFileSync(source, destination); copied.push(relative); }
function required(name: string): string { const index = args.indexOf(name), value = index >= 0 ? args[index + 1] : ""; if (!value) throw new Error(`${name} is required`); return value; }
function integer(value: string): number { const result = Number(value); if (!Number.isInteger(result) || result < 0) throw new Error("--season must be a non-negative integer"); return result; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function write(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
function hash(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
