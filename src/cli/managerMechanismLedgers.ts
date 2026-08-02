import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {managerMechanismLedgerSummary, managerMechanismPopulationSummary, validateManagerMechanismLedger, type ManagerMechanismLedger} from "../ai/managerMechanismLedger";
import {syncManagerMechanismLedgers} from "../ai/managerMechanismLedgerSync";
import {loadDynastyState} from "../draft/dynastyStateStore";

const args = process.argv.slice(2), command = args[0] ?? "preview";
if (command === "preview") preview(); else if (command === "audit") audit(); else if (command === "show") show(); else if (command === "coverage") coverage(); else usage();

function preview(): void {
  const studies = option("--studies", ["output/tooling/shadow-lineup-speed-causal", "output/tooling/shadow-lineup-hypotheses/studies/lineup-role-compression-v1"].join(",")).split(",").filter(Boolean).map(value => path.resolve(value));
  const managerCount = integerOption("--manager-count", 0);
  const managerIds = Array.from({length: managerCount}, (_, index) => `manager-${String(index + 1).padStart(2, "0")}`);
  console.log(JSON.stringify(syncManagerMechanismLedgers({studies, out: path.resolve(option("--out", "output/tooling/manager-mechanism-ledgers")), managerIds}), null, 2));
}
function audit(): void {
  const source = path.resolve(required("--source")), state = loadDynastyState<any>(path.join(source, "dynasty-state.json")), values: ManagerMechanismLedger[] = state.mechanismLedgers ?? [];
  for (const ledger of values) validateManagerMechanismLedger(ledger);
  const managerIds = new Set<string>((state.managers ?? []).map((manager: any) => String(manager.id)));
  const ledgerIds = new Set<string>(values.map(ledger => ledger.managerId));
  const result: Record<string, unknown> = {source, completedSeason: state.completedSeason, managers: managerIds.size, ledgers: values.length, missing: [...managerIds].filter(id => !ledgerIds.has(id)).sort(), orphaned: [...ledgerIds].filter(id => !managerIds.has(id)).sort(), activationStatus: "shadow-only", valid: values.length === managerIds.size && [...managerIds].every(id => ledgerIds.has(id))};
  if (flag("--details")) result.summaries = values.map(managerMechanismLedgerSummary);
  console.log(JSON.stringify(result, null, 2));
}
function show(): void {
  const archive = path.resolve(required("--archive")), managerId = required("--manager"), values = JSON.parse(zlib.gunzipSync(fs.readFileSync(archive)).toString("utf8")) as ManagerMechanismLedger[], ledger = values.find(value => value.managerId === managerId);
  if (!ledger) throw new Error(`Manager mechanism ledger not found: ${managerId}`);
  validateManagerMechanismLedger(ledger);
  console.log(JSON.stringify(flag("--full") ? {summary: managerMechanismLedgerSummary(ledger), ledger} : managerMechanismLedgerSummary(ledger), null, 2));
}
function coverage(): void {
  const values = readArchive(path.resolve(required("--archive")));
  console.log(JSON.stringify(managerMechanismPopulationSummary(values), null, 2));
}
function readArchive(file: string): ManagerMechanismLedger[] { const value = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")); if (!Array.isArray(value)) throw new Error("Invalid manager mechanism ledger archive"); return value; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integerOption(name: string, fallback: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < 0 || value > 999) throw new Error(`Invalid ${name}: ${value}`); return value; }
function flag(name: string): boolean { return args.includes(name); }
function required(name: string): string { const value = option(name, ""); if (!value) throw new Error(`Missing ${name}`); return value; }
function usage(): never { console.error("Usage: npm run manager-mechanisms -- <preview|audit|show|coverage> [options]\n  preview [--studies dir,dir] [--manager-count N] [--out dir]\n  audit --source dynasty-dir [--details]\n  show --archive file.gz --manager manager-XX [--full]\n  coverage --archive file.gz"); process.exit(2); }
