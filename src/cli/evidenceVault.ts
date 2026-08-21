import path from "node:path";
import {auditEvidenceVault, createEvidenceVaultSnapshot, defaultEvidenceVaultRoot, gcEvidenceVault, inspectRepository, quarantineEvidenceVaultSnapshot, readEvidenceVaultIndex, restoreEvidenceVaultSnapshot, type EvidenceVaultSource} from "../draft/evidenceVault";

const args = process.argv.slice(2), command = args[0] && !args[0].startsWith("--") ? args[0] : "list", root = process.cwd(), vault = path.resolve(option("--vault", defaultEvidenceVaultRoot()));

if (command === "snapshot") {
  const sourceValues = repeated("--source"); if (!sourceValues.length) throw new Error("snapshot requires at least one --source");
  const sources: EvidenceVaultSource[] = sourceValues.map((value, index) => ({name: sourceName(value, index, sourceValues), path: path.resolve(value)})), repository = inspectRepository(path.resolve(option("--repo", root)));
  if (repository.dirty && !args.includes("--allow-dirty")) throw new Error("Replayable evidence requires a clean Git checkout; commit the code or use --allow-dirty for a diagnostic-only recovery snapshot");
  const mode = option("--mode", "full"); if (mode !== "full" && mode !== "audit") throw new Error("--mode must be full or audit");
  const snapshot = createEvidenceVaultSnapshot({vaultRoot: vault, sources, label: option("--label", `manual-${new Date().toISOString()}`), mode, repository});
  print({status: "complete", vault, snapshotId: snapshot.id, evidenceLevel: snapshot.manifest.evidenceLevel, files: snapshot.manifest.totals.files, bytes: snapshot.manifest.totals.bytes, uniqueObjects: snapshot.manifest.totals.uniqueObjects, newObjectBytes: snapshot.newObjectBytes, reusedObjects: snapshot.reusedObjects, repository: snapshot.manifest.repository});
} else if (command === "doctor") {
  const result = auditEvidenceVault(vault, {deep: args.includes("--deep")}); print(result); if (!result.healthy) process.exitCode = 2;
} else if (command === "list") {
  const index = readEvidenceVaultIndex(vault); print({vault, available: Boolean(index), snapshots: index?.snapshots ?? []}); if (!index) process.exitCode = 2;
} else if (command === "restore") {
  print(restoreEvidenceVaultSnapshot({vaultRoot: vault, snapshotId: required("--snapshot"), destination: path.resolve(required("--destination"))}));
} else if (command === "quarantine") {
  print(quarantineEvidenceVaultSnapshot(vault, required("--snapshot"), required("--reason")));
} else if (command === "gc") {
  print(gcEvidenceVault(vault, {apply: args.includes("--apply"), graceDays: numberOption("--grace-days", 14, 0, 3650)}));
} else throw new Error("Usage: npm run evidence-vault -- <snapshot|list|doctor|restore|quarantine|gc> [--vault <path>] [--deep|--apply]");

function sourceName(value: string, index: number, all: string[]): string { const base = path.basename(path.resolve(value)).replace(/[^a-zA-Z0-9._-]+/g, "-") || `source-${index + 1}`; return all.filter((other, position) => position < index && path.basename(path.resolve(other)).replace(/[^a-zA-Z0-9._-]+/g, "-") === base).length ? `${base}-${index + 1}` : base; }
function repeated(name: string): string[] { const values: string[] = []; for (let index = 0; index < args.length; index += 1) if (args[index] === name && args[index + 1]) values.push(args[++index]); return values; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function required(name: string): string { const value = option(name, ""); if (!value) throw new Error(`${name} is required`); return value; }
function numberOption(name: string, fallback: number, minimum: number, maximum: number): number { const value = Number(option(name, String(fallback))); if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${name} must be ${minimum}..${maximum}`); return value; }
function print(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
