import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {acquireNamedRunLock} from "../draft/runLock";
import {createManagerMechanismLedger, managerMechanismLedgerSummary, recordManagerMechanismEvidence, validateManagerMechanismLedger, type ManagerMechanismLedger} from "./managerMechanismLedger";

export interface ManagerMechanismLedgerSyncOptions {studies: string[]; out: string; managerIds?: string[]}
export interface ManagerMechanismLedgerSyncResult {
  schemaVersion: 1; activationStatus: "shadow-only"; managers: number; mechanisms: string[];
  imported: number; unchanged: number; sources: Array<{study: string; hypothesisId: string; imported: number; unchanged: number; conclusion?: string}>;
  storage: {payloadBytes: number; compressedBytes: number}; out: string;
}

interface ImportRecord {evidenceId: string; evidenceSha256: string; firstImportedAt: string; study: string}
interface ImportRegistry {schemaVersion: 1; activationStatus: "shadow-only"; revision: number; imports: Record<string, ImportRecord>}

export function syncManagerMechanismLedgers(options: ManagerMechanismLedgerSyncOptions): ManagerMechanismLedgerSyncResult {
  const out = path.resolve(options.out), archiveFile = path.join(out, "manager-mechanism-ledgers.json.gz"), registryFile = path.join(out, "import-registry.json");
  fs.mkdirSync(out, {recursive: true});
  const lock = acquireNamedRunLock(out, ".manager-mechanism-ledgers.lock", {workflow: "manager-mechanism-ledger-sync"});
  try {
    const ledgers = new Map<string, ManagerMechanismLedger>();
    if (fs.existsSync(archiveFile)) for (const ledger of readArchive(archiveFile)) { validateManagerMechanismLedger(ledger); ledgers.set(ledger.managerId, ledger); }
    const registry: ImportRegistry = fs.existsSync(registryFile) ? read<ImportRegistry>(registryFile) : {schemaVersion: 1, activationStatus: "shadow-only", revision: 0, imports: {}};
    validateRegistry(registry);
    const sources: ManagerMechanismLedgerSyncResult["sources"] = [];
    let imported = 0, unchanged = 0;
    for (const studyInput of [...new Set(options.studies.map(value => path.resolve(value)))].sort()) {
      const manifest = read<any>(path.join(studyInput, "causal-manifest.json")), summary = read<any>(path.join(studyInput, "causal-summary.json"));
      const mechanismId = String(summary.hypothesisId ?? "lineup-speed-alone-v1");
      let sourceImported = 0, sourceUnchanged = 0;
      for (const item of manifest.items ?? []) {
        if (item.status !== "complete") continue;
        const managerId = String(item.managerId), result = item.result ?? {}, causal = result.causal ?? {};
        const evidence = {
          evidenceId: `causal:${digest(`${mechanismId}:${item.id}`).slice(0, 32)}`, managerId, mechanismId, season: Number(item.season), level: "exact-counterfactual" as const,
          expressed: Number(causal.actionDivergences ?? 0) > 0,
          effect: result.direction === "better" ? 1 : result.direction === "worse" ? -1 : 0,
          context: {season: Number(item.season), sourceOutcome: String(item.sourceOutcome), scoreDelta: Number(item.scoreDelta ?? item.deltas?.speedAdvantageMean ?? 0), games: Number(causal.games ?? 0)},
        };
        const importKey = `${mechanismId}:${String(item.id)}`, evidenceSha256 = digest(JSON.stringify(evidence));
        const prior = registry.imports[importKey];
        if (prior && prior.evidenceSha256 !== evidenceSha256) throw new Error(`Previously imported causal evidence changed: ${importKey}`);
        if (prior) { unchanged++; sourceUnchanged++; continue; }
        const ledger = ledgers.get(managerId) ?? createManagerMechanismLedger(managerId, Number(item.season));
        ledgers.set(managerId, recordManagerMechanismEvidence(ledger, evidence));
        registry.imports[importKey] = {evidenceId: evidence.evidenceId, evidenceSha256, firstImportedAt: new Date().toISOString(), study: normalize(path.relative(process.cwd(), studyInput))};
        imported++; sourceImported++;
      }
      sources.push({study: normalize(path.relative(process.cwd(), studyInput)), hypothesisId: mechanismId, imported: sourceImported, unchanged: sourceUnchanged, conclusion: summary.conclusion});
    }
    for (const managerId of options.managerIds ?? []) if (!ledgers.has(managerId)) ledgers.set(managerId, createManagerMechanismLedger(managerId));
    const values = [...ledgers.values()].sort((left, right) => left.managerId.localeCompare(right.managerId));
    for (const ledger of values) validateManagerMechanismLedger(ledger);
    const payload = Buffer.from(JSON.stringify(values), "utf8"), archive = zlib.gzipSync(payload, {level: 9}), summaries = values.map(managerMechanismLedgerSummary);
    registry.revision += imported ? 1 : 0;
    atomicWrite(archiveFile, archive); atomicJson(registryFile, registry);
    const result: ManagerMechanismLedgerSyncResult = {schemaVersion: 1, activationStatus: "shadow-only", managers: values.length, mechanisms: [...new Set(values.flatMap(ledger => Object.keys(ledger.mechanisms)))].sort(), imported, unchanged, sources, storage: {payloadBytes: payload.length, compressedBytes: archive.length}, out};
    atomicJson(path.join(out, "summary.json"), {...result, summaries});
    atomicJson(path.join(out, "token-budget.json"), {compactBytes: Buffer.byteLength(JSON.stringify(result)), managerSummaryBytes: Buffer.byteLength(JSON.stringify(summaries)), estimatedManagerSummaryTokens: Math.ceil(Buffer.byteLength(JSON.stringify(summaries)) / 3.5)});
    return result;
  } finally { lock.release(); }
}

function validateRegistry(value: ImportRegistry): void {
  if (value.schemaVersion !== 1 || value.activationStatus !== "shadow-only" || !Number.isInteger(value.revision) || value.revision < 0 || !value.imports || typeof value.imports !== "object") throw new Error("Invalid manager mechanism import registry");
  const evidenceIds = new Set<string>();
  for (const [key, record] of Object.entries(value.imports)) {
    if (!/^[a-z0-9-]+-v\d+:.{1,240}$/.test(key) || !/^causal:[a-f0-9]{32}$/.test(record.evidenceId) || !/^[a-f0-9]{64}$/.test(record.evidenceSha256) || !record.firstImportedAt || !record.study || evidenceIds.has(record.evidenceId)) throw new Error(`Invalid manager mechanism import record: ${key}`);
    evidenceIds.add(record.evidenceId);
  }
}
function readArchive(file: string): ManagerMechanismLedger[] { const value = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")); if (!Array.isArray(value)) throw new Error("Invalid manager mechanism ledger archive"); return value; }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function digest(value: string): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function normalize(value: string): string { return value.replaceAll("\\", "/"); }
function atomicJson(file: string, value: unknown): void { atomicWrite(file, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8")); }
function atomicWrite(file: string, bytes: Buffer): void { const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`; fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, file); }
