import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {AI_VERSION} from "../showdown/choice";

const root = process.cwd(), out = path.resolve(option("--out", "PACKAGE-MANIFEST.json"));
const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {cwd: root, encoding: "utf8"});
if (listed.status !== 0) throw new Error(listed.stderr || "Unable to enumerate package files");

const relativeOut = normalize(path.relative(root, out));
const files = [...new Set(listed.stdout.split(/\r?\n/).map(normalize).filter(Boolean))]
  .filter(file => file !== relativeOut && fs.statSync(path.join(root, file)).isFile())
  .sort()
  .map(file => {
    const bytes = fs.readFileSync(path.join(root, file));
    return {path: file, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex")};
  });
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const teams = JSON.parse(fs.readFileSync(path.join(root, "data/teams.json"), "utf8"));
const manifest = {
  schemaVersion: 2,
  package: `${packageJson.name}-portable`,
  packageVersion: packageJson.version,
  createdAt: new Date().toISOString(),
  aiVersion: AI_VERSION,
  savedTeamCount: Array.isArray(teams.teams) ? teams.teams.length : 0,
  requiresFirstRunNpmCi: true,
  excluded: ["node_modules", "output", "historical evidence", "credentials", "machine-specific state"],
  files,
};
fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({out, files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), packageVersion: packageJson.version, aiVersion: AI_VERSION}, null, 2));

function normalize(value: string): string { return value.replaceAll("\\", "/").replace(/^\.\//, ""); }
function option(name: string, fallback: string): string { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] ?? fallback : fallback; }
