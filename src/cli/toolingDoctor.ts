import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {buildStorageIndex} from "../draft/storageIndex";
import {gcSourceCaches} from "../draft/sourceCacheMaintenance";

const args = process.argv.slice(2), command = args[0] && !args[0].startsWith("--") ? args[0] : "doctor";
const root = path.resolve(option("--root", "output/tooling")), league = path.resolve(option("--league", "output/official-era-03/league"));
const cacheRoot = path.resolve(option("--source-cache", path.join(root, "shadow-lineup-source-cache"))), budgetBytes = numberOption("--cache-budget-mb", 4096, 512, 102400) * 1048576, maxAgeDays = numberOption("--cache-max-age-days", 30, 0, 3650);
const out = path.resolve(option("--out", path.join(root, "tooling-doctor"))); fs.mkdirSync(out, {recursive: true});
if (!new Set(["doctor", "storage", "cache-gc"]).has(command)) throw new Error("Usage: npm run tooling -- <doctor|storage|cache-gc> [--apply]");
const started = Date.now(), storage = buildStorageIndex(root); atomic(path.join(out, "storage-index.json"), storage);
const cache = gcSourceCaches(cacheRoot, root, {budgetBytes, maxAgeDays, apply: command === "cache-gc" && args.includes("--apply")});
atomic(path.join(out, "source-cache-audit.json"), cache);
const formal = formalAuditStatus(league), issues: Array<{severity: "error" | "warning"; code: string; message: string}> = [];
if (!formal.available) issues.push({severity: "warning", code: "formal-league-unavailable", message: "Formal league audit files are unavailable"});
else if (!formal.signatureMatches) issues.push({severity: "error", code: "formal-audit-stale", message: "Formal audit summary does not match its signature cache"});
if (formal.fatalCount) issues.push({severity: "error", code: "formal-audit-fatal", message: `Formal audit contains ${formal.fatalCount} fatal finding(s)`});
if (cache.audit.invalidDirectories.length) issues.push({severity: "warning", code: "invalid-source-cache-directories", message: `${cache.audit.invalidDirectories.length} non-cache directories need inspection`});
if (cache.remainingBytes > budgetBytes) issues.push({severity: "warning", code: "source-cache-over-budget", message: `Source caches exceed budget by ${mb(cache.remainingBytes - budgetBytes)} MB`});
const summary = {schemaVersion: 1, command, healthy: !issues.some(issue => issue.severity === "error"), generatedAt: new Date().toISOString(), elapsedMs: Date.now() - started, storage: {root, files: storage.files, bytes: storage.bytes, largest: storage.entries.slice(0, 12)}, sourceCaches: {root: cacheRoot, entries: cache.audit.entries.length, bytesBefore: cache.audit.totalBytes, budgetBytes, plannedOrRemoved: cache.removed.length, reclaimedBytes: cache.reclaimedBytes, remainingBytes: cache.remainingBytes, applied: cache.apply}, formal, issues, artifacts: {storageIndex: path.join(out, "storage-index.json"), cacheAudit: path.join(out, "source-cache-audit.json")}};
atomic(path.join(out, "summary.json"), summary); console.log(JSON.stringify(summary, null, 2)); if (issues.some(issue => issue.severity === "error")) process.exitCode = 2;

function formalAuditStatus(directory: string): {available: boolean; completedSeason?: number; fatalCount?: number; warningCount?: number; signatureMatches?: boolean; runStatus?: string | null} {
  const summary = optional<any>(path.join(directory, "audit-summary.json")), cache = optional<any>(path.join(directory, ".audit-signature-cache.json")), run = optional<any>(path.join(directory, "audit-run-state.json"));
  if (!summary || cache?.schemaVersion !== 1 || !cache.files) return {available: false}; const hash = crypto.createHash("sha256");
  for (const key of Object.keys(cache.files).sort()) hash.update(`${key}\0${cache.files[key].sha256}\0`);
  const state = path.join(directory, "dynasty-state.json"), cachedState = cache.files["dynasty-state.json"], stat = fs.existsSync(state) ? fs.statSync(state) : null;
  const stateFresh = Boolean(stat && cachedState && cachedState.size === stat.size && Math.abs(cachedState.mtimeMs - stat.mtimeMs) < 1);
  return {available: true, completedSeason: Number(summary.completedSeasons), fatalCount: Number(summary.fatalCount ?? 0), warningCount: Number(summary.warningCount ?? 0), signatureMatches: summary.inputSignature === hash.digest("hex") && stateFresh && run?.status === "complete", runStatus: run?.status ?? null};
}
function atomic(file: string, value: unknown): void { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
function optional<T>(file: string): T | null { try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return null; } }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function numberOption(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(option(name, String(fallback))); if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`); return value; }
function mb(bytes: number): number { return Math.round(bytes / 1048576 * 10) / 10; }
