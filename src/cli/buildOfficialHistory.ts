import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

interface HistorySeason {globalSeason: number; internalSeason: number; eraRoot: string; champion?: string; championId?: string; seal?: Record<string, unknown>; stateSha256?: string; auditInputSignature?: string}
const args = process.argv.slice(2), majorRoot = path.resolve(requiredOption("--major-source")), out = path.resolve(requiredOption("--out"));
const offset = integerOption("--global-season-offset", 0, 0, 100000), manifestPaths = csvOption("--era-manifests").map(value => path.resolve(value));
const bySeason = new Map<number, HistorySeason>(), sources: Array<{file: string; sha256: string}> = [];
for (const manifestPath of manifestPaths) importEraManifest(manifestPath);
importCurrentEra();
const seasons = [...bySeason.values()].sort((a, b) => a.globalSeason - b.globalSeason);
if (!seasons.length) throw new Error("No official seasons were found");
if (!args.includes("--allow-partial") && seasons[0].globalSeason !== 1) throw new Error(`Official history starts at S${seasons[0].globalSeason}; pass --allow-partial only for an intentional fragment`);
for (let index = 1; index < seasons.length; index += 1) if (seasons[index].globalSeason !== seasons[index - 1].globalSeason + 1) throw new Error(`Official history has a gap between S${seasons[index - 1].globalSeason} and S${seasons[index].globalSeason}`);
const ledger = {schemaVersion: 1, league: "MythicMons V12", status: "canonical-local-history", completedGlobalSeason: seasons.at(-1)!.globalSeason, updatedAt: new Date().toISOString(), sources, seasons, transitions: promotionTransitions()};
atomicJson(out, ledger);
console.log(JSON.stringify({seasons: seasons.length, first: seasons[0].globalSeason, last: seasons.at(-1)!.globalSeason, transitions: ledger.transitions.length, output: out}, null, 2));

function importEraManifest(manifestPath: string): void {
  const manifest = read<any>(manifestPath), eraRoot = path.dirname(manifestPath), seals = manifest.seasonSeals ?? [];
  sources.push({file: manifestPath, sha256: fileHash(manifestPath)});
  for (const champion of manifest.champions ?? []) {
    const globalSeason = Number(champion.globalSeason ?? champion.season), seal = seals.find((value: any) => Number(value.globalSeason ?? value.season) === globalSeason);
    const internalSeason = Number(seal?.eraSeason ?? champion.eraSeason ?? champion.season ?? globalSeason);
    add({globalSeason, internalSeason, eraRoot, champion: champion.champion, seal});
  }
}
function importCurrentEra(): void {
  const state = read<any>(path.join(majorRoot, "dynasty-state.json")), auditPath = path.join(majorRoot, "audit-summary.json"), audit = fs.existsSync(auditPath) ? read<any>(auditPath) : undefined;
  sources.push({file: path.join(majorRoot, "dynasty-state.json"), sha256: fileHash(path.join(majorRoot, "dynasty-state.json"))});
  if (auditPath && fs.existsSync(auditPath)) sources.push({file: auditPath, sha256: fileHash(auditPath)});
  for (let internalSeason = 1; internalSeason <= state.completedSeason; internalSeason += 1) {
    const globalSeason = internalSeason + offset;
    if (bySeason.has(globalSeason)) continue;
    const seasonPath = path.join(majorRoot, `season-${String(internalSeason).padStart(2, "0")}`, "season.json");
    if (!fs.existsSync(seasonPath)) throw new Error(`Missing current-era season evidence: ${seasonPath}`);
    const season = read<any>(seasonPath);
    add({globalSeason, internalSeason, eraRoot: majorRoot, champion: season.champion?.name, championId: season.champion?.id, ...(internalSeason === state.completedSeason ? {stateSha256: fileHash(path.join(majorRoot, "dynasty-state.json")), auditInputSignature: audit?.inputSignature} : {})});
  }
}
function add(row: HistorySeason): void { const existing = bySeason.get(row.globalSeason); if (existing && (existing.champion !== row.champion || existing.internalSeason !== row.internalSeason)) throw new Error(`Conflicting evidence for global season ${row.globalSeason}`); if (!existing) bySeason.set(row.globalSeason, row); }
function promotionTransitions(): unknown[] { const directory = path.join(majorRoot, "promotion-transactions"); if (!fs.existsSync(directory)) return []; return fs.readdirSync(directory, {withFileTypes: true}).filter(value => value.isDirectory()).map(value => path.join(directory, value.name, "transaction.json")).filter(file => fs.existsSync(file)).map(file => { const transaction = read<any>(file); return {transactionId: transaction.transactionId, status: transaction.status, afterInternalSeason: transaction.boundary?.completedSeason, reason: transaction.reason, vacancies: transaction.transactions?.map((row: any) => row.vacancy), sha256: fileHash(file), file}; }); }
function atomicJson(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); const temporary = `${file}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.renameSync(temporary, file); }
function fileHash(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function requiredOption(name: string): string { const value = option(name, ""); if (!value) throw new Error(`${name} is required`); return value; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function csvOption(name: string): string[] { const value = option(name, ""); return value ? value.split(",").map(entry => entry.trim()).filter(Boolean) : []; }
function integerOption(name: string, fallback: number, min: number, max: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
