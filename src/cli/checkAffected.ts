import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {acquireNamedRunLock} from "../draft/runLock";

interface CacheEntry {hash: string; completedAt: string; durationMs: number; log: string}
interface CacheManifest {schemaVersion: 1; checks: Record<string, CacheEntry>}

const args = process.argv.slice(2), root = process.cwd(), all = args.includes("--all"), dryRun = args.includes("--dry-run"), noCache = args.includes("--no-cache");
const shard = shardOption(option("--shard", ""));
const base = option("--base", "HEAD"), cacheRoot = path.resolve(option("--cache", "output/tooling/checks"));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {scripts: Record<string, string>};
const testScripts = Object.entries(packageJson.scripts).filter(([name, command]) => (name.startsWith("smoke:") || name.startsWith("test:")) && /tsx\s+[^\s]+\.ts/.test(command));
const sourceFiles = files("src", ".ts"), dependencyGraph = buildDependencyGraph(sourceFiles);
const scriptFiles = new Map(testScripts.map(([name, command]) => [name, normalize(command.match(/tsx\s+([^\s]+\.ts)/)![1])]));
const explicitFiles = option("--files", "").split(",").map(normalize).filter(Boolean);
const changed = all ? [] : explicitFiles.length ? explicitFiles : changedFiles(base), globalChange = changed.some(file => ["package.json", "package-lock.json", "tsconfig.json"].includes(file));
const selectedBeforeShard = all || globalChange ? testScripts.map(([name]) => name) : selectAffected(changed);
const selected = shard ? selectedBeforeShard.filter(name => shardFor(name, shard.count) === shard.index) : selectedBeforeShard;
const checks = [...(!shard || shard.index === 0 ? ["typecheck"] : []), ...selected.filter(name => name !== "typecheck")];

fs.mkdirSync(cacheRoot, {recursive: true});
const lock = acquireNamedRunLock(cacheRoot, ".check-affected.lock", {workflow: "check-affected", base, all});
try {
  const manifestPath = path.join(cacheRoot, "manifest.json"), manifest: CacheManifest = fs.existsSync(manifestPath) ? read(manifestPath) : {schemaVersion: 1, checks: {}};
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported affected-check cache manifest");
  const results: Array<{name: string; status: "passed" | "cached" | "planned" | "failed"; durationMs: number; savedMs?: number; log: string}> = [];
  for (const name of checks) {
    const hash = checkHash(name), log = path.join(cacheRoot, `${safe(name)}.log`), cached = manifest.checks[name];
    if (!noCache && cached?.hash === hash && fs.existsSync(cached.log)) { results.push({name, status: "cached", durationMs: 0, savedMs: cached.durationMs, log: cached.log}); continue; }
    if (dryRun) { results.push({name, status: "planned", durationMs: 0, log}); continue; }
    const started = Date.now(), npmCli = process.env.npm_execpath;
    const result = npmCli ? spawnSync(process.execPath, [npmCli, "run", name, "--silent"], {cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024}) : spawnSync("npm", ["run", name, "--silent"], {cwd: root, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024});
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`; fs.writeFileSync(log, output, "utf8");
    const durationMs = Date.now() - started;
    if (result.status !== 0) {
      const tail = output.trim().split(/\r?\n/).slice(-30).join("\n");
      results.push({name, status: "failed", durationMs, log});
      console.error(JSON.stringify({status: "failed", check: name, durationMs, log, tail}, null, 2)); process.exitCode = result.status ?? 1; break;
    }
    manifest.checks[name] = {hash, completedAt: new Date().toISOString(), durationMs, log}; atomicJson(manifestPath, manifest);
    results.push({name, status: "passed", durationMs, log});
  }
  const summary = {mode: all ? "all" : "affected", base, ...(shard ? {shard: `${shard.index}/${shard.count}`, selectedBeforeShard: selectedBeforeShard.length} : {}), changedFiles: changed.length, selectedTests: selected.length, passed: results.filter(row => row.status === "passed").length, cached: results.filter(row => row.status === "cached").length, failed: results.filter(row => row.status === "failed").length, planned: results.filter(row => row.status === "planned").length, durationMs: results.reduce((sum, row) => sum + row.durationMs, 0), cacheSavedMs: results.reduce((sum, row) => sum + (row.savedMs ?? 0), 0), logs: cacheRoot, checks: results.map(({log: _log, ...row}) => row)};
  fs.writeFileSync(path.join(cacheRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  const {checks: detailedChecks, ...compactSummary} = summary;
  console.log(JSON.stringify(dryRun ? {...compactSummary, checks: detailedChecks.length <= 12 ? detailedChecks : [...detailedChecks.slice(0, 12), {omitted: detailedChecks.length - 12}]} : compactSummary, null, 2));
} finally { lock.release(); }

function selectAffected(changed: string[]): string[] {
  const selected = new Set<string>(), unmappedSource: string[] = [];
  for (const changedFile of changed.filter(file => file.startsWith("src/") && file.endsWith(".ts"))) {
    let matched = false;
    for (const [name, testFile] of scriptFiles) if (testFile === changedFile || dependencies(testFile).has(changedFile) || relatedStem(testFile, changedFile) || explicitImpact(testFile, changedFile)) { selected.add(name); matched = true; }
    if (!matched && !changedFile.startsWith("src/tests/")) unmappedSource.push(changedFile);
  }
  if (unmappedSource.length && packageJson.scripts["test:regressions"]) selected.add("test:regressions");
  return [...selected].sort();
}
function dependencies(file: string, seen = new Set<string>()): Set<string> { if (seen.has(file)) return seen; seen.add(file); for (const dependency of dependencyGraph.get(file) ?? []) dependencies(dependency, seen); return seen; }
function buildDependencyGraph(source: string[]): Map<string, string[]> { const known = new Set(source), graph = new Map<string, string[]>(); for (const file of source) { const text = fs.readFileSync(path.join(root, file), "utf8"), imports = [...text.matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/g)].map(match => resolveImport(file, match[1])).filter((value): value is string => Boolean(value && known.has(value))), spawned = [...text.matchAll(/["'](src\/[a-zA-Z0-9_./-]+\.ts)["']/g)].map(match => normalize(match[1])).filter(value => known.has(value)); graph.set(file, [...new Set([...imports, ...spawned])]); } return graph; }
function resolveImport(from: string, request: string): string | undefined { const candidate = normalize(path.join(path.dirname(from), request)); for (const value of [candidate, `${candidate}.ts`, `${candidate}/index.ts`]) if (fs.existsSync(path.join(root, value))) return value; return undefined; }
function checkHash(name: string): string { const digest = crypto.createHash("sha256"), testFile = scriptFiles.get(name) ?? "", relevant = name === "typecheck" ? sourceFiles : [...dependencies(testFile), ...sourceFiles.filter(file => relatedStem(testFile, file) || explicitImpact(testFile, file))]; for (const file of [...new Set([...relevant, "package.json", "package-lock.json", "tsconfig.json"])].sort()) if (file && fs.existsSync(path.join(root, file))) digest.update(file).update(fs.readFileSync(path.join(root, file))); return digest.digest("hex"); }
function changedFiles(reference: string): string[] { const tracked = git(["diff", "--name-only", reference, "--"]), untracked = git(["ls-files", "--others", "--exclude-standard"]); return [...new Set([...tracked, ...untracked].map(normalize).filter(Boolean))].sort(); }
function git(command: string[]): string[] { const result = spawnSync("git", command, {cwd: root, encoding: "utf8"}); if (result.status !== 0) throw new Error(result.stderr || `git ${command.join(" ")} failed`); return result.stdout.split(/\r?\n/).filter(Boolean); }
function files(directory: string, extension: string): string[] { const result: string[] = []; const visit = (current: string) => { for (const entry of fs.readdirSync(path.join(root, current), {withFileTypes: true})) { const relative = normalize(path.join(current, entry.name)); if (entry.isDirectory()) visit(relative); else if (relative.endsWith(extension)) result.push(relative); } }; visit(directory); return result; }
function atomicJson(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
function read(file: string): CacheManifest { return JSON.parse(fs.readFileSync(file, "utf8")) as CacheManifest; }
function normalize(value: string): string { return value.replaceAll("\\", "/").replace(/^\.\//, ""); }
function relatedStem(testFile: string, changedFile: string): boolean { const clean = (file: string) => path.basename(file, ".ts").toLowerCase().replace(/smoke$|^run/g, ""); const test = clean(testFile), changed = clean(changedFile); return changed.length >= 8 && (test.includes(changed) || changed.includes(test)); }
function explicitImpact(testFile: string, changedFile: string): boolean { const impacts: Record<string, string[]> = {"src/draft/runLock.ts": ["parallelRegistrySmoke.ts", "officialSeasonCycleSmoke.ts", "unifiedWhiteBoxEvidenceSmoke.ts", "programDecisionCounterfactualSmoke.ts"]}; return (impacts[changedFile] ?? []).includes(path.basename(testFile)); }
function safe(value: string): string { return value.replace(/[^a-z0-9.-]+/gi, "-"); }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function shardFor(name: string, count: number): number { return Number.parseInt(crypto.createHash("sha256").update(name).digest("hex").slice(0, 8), 16) % count; }
function shardOption(value: string): {index: number; count: number} | undefined { if (!value) return undefined; const match = value.match(/^(\d+)\/(\d+)$/), index = Number(match?.[1]), count = Number(match?.[2]); if (!match || !Number.isInteger(index) || !Number.isInteger(count) || count < 2 || count > 16 || index < 0 || index >= count) throw new Error("--shard must be INDEX/COUNT with COUNT 2..16 and INDEX starting at 0"); return {index, count}; }
