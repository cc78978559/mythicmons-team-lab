import fs from "node:fs";
import path from "node:path";
import {lineupStudySourceEvidence, lineupStudySourceIdentity, lineupStudySourceKey} from "../draft/lineupStudySource";

const args = process.argv.slice(2), root = process.cwd();
const cacheRoot = path.resolve(required("--cache-root")), oldKey = required("--old-key"), source = path.resolve(required("--source"));
const finalSeason = integer(required("--final-season")), study = path.resolve(required("--study"));
if (!args.includes("--acknowledge-replay-equivalent")) throw new Error("Rebinding requires --acknowledge-replay-equivalent after a reviewed non-simulation code change");
if (!/^[a-f0-9]{64}$/.test(oldKey)) throw new Error("Invalid old cache key");
const oldDirectory = path.join(cacheRoot, oldKey), markerFile = path.join(oldDirectory, "source-cache.json"), manifestFile = path.join(study, "causal-manifest.json");
const marker = read<any>(markerFile), manifest = read<any>(manifestFile), sourceStateFile = path.join(source, "dynasty-state.json"), sourceState = read<any>(sourceStateFile);
if (marker.schemaVersion !== 1 || marker.key !== oldKey || marker.identity?.officialStateSha256 !== manifest.sourceCache?.identity?.officialStateSha256 || marker.identity?.finalSeason !== finalSeason) throw new Error("Old cache marker and study manifest are not bound to the same source");
if (manifest.sourceCache?.key !== oldKey || manifest.items?.some((item: any) => item.status === "failed")) throw new Error("Study manifest cannot be rebound");
const evidence = lineupStudySourceEvidence(oldDirectory, Number(sourceState.completedSeason) + 1, finalSeason);
if (JSON.stringify(evidence) !== JSON.stringify(marker.evidence)) throw new Error("Old cache evidence changed");
const identity = lineupStudySourceIdentity(root, sourceStateFile, finalSeason), key = lineupStudySourceKey(identity), target = path.join(cacheRoot, key);
if (fs.existsSync(target)) throw new Error(`Rebound cache target already exists: ${target}`);
write(markerFile, {schemaVersion: 1, key, identity, evidence, reboundFrom: oldKey, reboundReason: "reviewed-replay-equivalent-operational-change"});
fs.renameSync(oldDirectory, target);
manifest.sourceCache = {key, identity, retained: true};
write(manifestFile, manifest);
write(path.join(study, "source-cache-rebind.json"), {schemaVersion: 1, oldKey, key, identity, evidenceFiles: Object.keys(evidence).length, at: new Date().toISOString()});
console.log(JSON.stringify({status: "rebound", oldKey, key, target, completedCases: manifest.items.filter((item: any) => item.status === "complete").length}, null, 2));

function required(name: string): string { const index = args.indexOf(name), value = index >= 0 ? args[index + 1] : ""; if (!value) throw new Error(`${name} is required`); return value; }
function integer(value: string): number { const result = Number(value); if (!Number.isInteger(result) || result < 1) throw new Error("--final-season must be a positive integer"); return result; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function write(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
