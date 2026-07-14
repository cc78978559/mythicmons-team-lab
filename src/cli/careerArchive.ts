import fs from "node:fs";
import path from "node:path";
import {buildCareerArchive, compactPortrait, readCareerPortrait} from "../draft/careerArchive";

const args = process.argv.slice(2);
const root = path.resolve(option("--out", "output/draft-league-v12"));
const destination = path.resolve(option("--dest", path.join(root, "career-portraits")));
const manager = option("--manager", "");
if (!manager || args.includes("--rebuild") || !fs.existsSync(path.join(destination, "index.json"))) {
  const result = buildCareerArchive(root, destination);
  if (!manager) {
    console.log(JSON.stringify({managers: result.managers, destination: result.destination, checkpoint: result.checkpointManifest, sourceMB: round(result.checkpointBytes / 1048576), compressedMB: round(result.compressedBytes / 1048576)}, null, 2));
    process.exit(0);
  }
}
const portrait = readCareerPortrait(destination, manager);
console.log(JSON.stringify(args.includes("--full") ? portrait : compactPortrait(portrait), null, 2));

function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function round(value: number): number { return Number(value.toFixed(2)); }
