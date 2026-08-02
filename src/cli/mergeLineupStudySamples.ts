import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {mergeLineupStudySampleArchives, type LineupStudySampleArchive} from "../ai/whiteBox/lineupStudySampleMerge";

const args = process.argv.slice(2), sourceList = option("--sources", "").split(",").map(value => value.trim()).filter(Boolean).map(value => path.resolve(value)), out = path.resolve(option("--out", "output/tooling/lineup-study-samples-merged.json.gz"));
if (sourceList.length < 2) throw new Error("--sources requires at least two comma-separated archives");
const archives = sourceList.map(read), merged = mergeLineupStudySampleArchives(archives), provenance = {segments: sourceList.map((source, index) => ({file: path.relative(process.cwd(), source), sha256: hash(source), firstSeason: archives[index].firstSeason, finalSeason: archives[index].finalSeason, rows: archives[index].rows.length}))}, payload = {...merged, provenance};
fs.mkdirSync(path.dirname(out), {recursive: true}); const temporary = `${out}.${process.pid}.tmp`; fs.writeFileSync(temporary, zlib.gzipSync(Buffer.from(`${JSON.stringify(payload)}\n`, "utf8"), {level: 9})); fs.renameSync(temporary, out); console.log(JSON.stringify({status: "complete", firstSeason: merged.firstSeason, finalSeason: merged.finalSeason, rows: merged.rows.length, compressedBytes: fs.statSync(out).size, out, provenance}, null, 2));

function read(file: string): LineupStudySampleArchive { return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")); }
function hash(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
