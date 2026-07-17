import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {auditWhiteBoxOutput} from "../ai/whiteBox/audit";
import {evaluateWhiteBoxSoak, whiteBoxSoakMarkdown, type WhiteBoxSoakRun} from "../ai/whiteBox/soak";
import {strategyProgramHash} from "../draft/strategyProgram";

const args = process.argv.slice(2), root = process.cwd();
const out = path.resolve(option("--out", "output/whitebox-soak"));
const seeds = option("--seeds", "whitebox-soak-a,whitebox-soak-b").split(",").map(value => value.trim()).filter(Boolean);
const repeats = integerOption("--repeats", 2, 1, 10), seasons = integerOption("--seasons", 2, 1, 20);
const maximumAuditRatio = numberOption("--max-audit-ratio", .25, 0, 1);
const runs: WhiteBoxSoakRun[] = [];
fs.mkdirSync(out, {recursive: true});

for (const seed of seeds) for (let repeat = 1; repeat <= repeats; repeat += 1) {
  const runDir = path.join(out, `${safe(seed)}-r${repeat}`), runFile = path.join(runDir, "soak-run.json");
  if (args.includes("--run")) {
    if (fs.existsSync(runDir)) {
      if (!args.includes("--force")) throw new Error(`Soak output already exists: ${runDir}; pass --force to replace it`);
      const resolved = path.resolve(runDir);
      if (path.dirname(resolved) !== out) throw new Error(`Refusing to remove output outside soak root: ${resolved}`);
      fs.rmSync(resolved, {recursive: true, force: true});
    }
    const started = Date.now();
    const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(root, "src", "cli", "draftLeagueV12.ts")], {
      cwd: root,
      env: {
        ...process.env,
        V12_OUT: runDir, V12_SEASONS: String(seasons), V12_RESUME: "false", V12_SEED: seed,
        V12_REGISTRY_SOURCE: path.resolve(option("--registry", "data/draft")), V12_REGISTRY_REVISION: `whitebox-soak:${seed}`,
        V12_MANAGER_LIMIT: option("--managers", "6"), V12_PAIRS: option("--pairs", "1"), V12_POOL_SIZE: option("--pool", "100"),
        V12_AUCTION_LOTS: option("--auction-lots", "10"), V12_REGULAR_ROUNDS: option("--rounds", "2"), V12_MAX_TURNS: option("--max-turns", "80"),
        V12_MIN_ROSTER: option("--min-roster", "6"), V12_MAX_ROSTER: option("--max-roster", "6"), V12_EVIDENCE_RETENTION: "compact",
      },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(`Soak run failed for ${seed} repeat ${repeat}:\n${result.stderr || result.stdout}`);
    const run = summarizeRun(seed, repeat, runDir, Date.now() - started);
    fs.writeFileSync(runFile, `${JSON.stringify(run, null, 2)}\n`, "utf8");
    runs.push(run);
    process.stdout.write(`white-box soak ${seed} repeat ${repeat}/${repeats} complete\n`);
  } else {
    if (!fs.existsSync(runFile)) throw new Error(`Missing soak run metadata: ${runFile}; pass --run to generate it`);
    runs.push(JSON.parse(fs.readFileSync(runFile, "utf8")) as WhiteBoxSoakRun);
  }
}

const summary = evaluateWhiteBoxSoak(runs, maximumAuditRatio);
fs.writeFileSync(path.join(out, "soak-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(out, "soak-report.md"), whiteBoxSoakMarkdown(summary), "utf8");
console.log(JSON.stringify({promotion: summary.promotion, fatal: summary.fatalCount, warnings: summary.warningCount, metrics: summary.metrics, summary: path.join(out, "soak-summary.json")}, null, 2));
if (summary.fatalCount) process.exitCode = 2;
else if (args.includes("--strict-warnings") && summary.warningCount) process.exitCode = 3;

function summarizeRun(seed: string, repeat: number, runDir: string, durationMs: number): WhiteBoxSoakRun {
  const audit = auditWhiteBoxOutput(runDir);
  const canonicalAudit = {files: audit.files, records: audit.records, expectedTraces: audit.expectedTraces, auditedTraces: audit.auditedTraces, coverage: audit.coverage, fatalCount: audit.fatalCount, warningCount: audit.warningCount, issues: audit.issues, metrics: audit.metrics, promotion: audit.promotion};
  return {seed, repeat, output: runDir, durationMs, outcomeDigest: outcomeDigest(runDir), auditDigest: digest(canonicalAudit), outputBytes: directorySize(runDir), auditBytes: audit.metrics.auditBytes, coverage: audit.coverage, comparisons: audit.metrics.comparisons, agreements: audit.metrics.agreements, fatalCount: audit.fatalCount, warningCount: audit.warningCount, auditPromotion: audit.promotion};
}

function outcomeDigest(runDir: string): string {
  const state = read<any>(path.join(runDir, "dynasty-state.json"));
  const seasons = Array.from({length: state.completedSeason}, (_, index) => read<any>(path.join(runDir, `season-${String(index + 1).padStart(2, "0")}`, "season.json")));
  const canonical = {
    version: state.version, completedSeason: state.completedSeason, moneySupply: state.moneySupply, leaguePool: state.leaguePool,
    managers: state.managers.map((manager: any) => ({id: manager.id, cash: manager.cash, titles: manager.titles, totalPoints: manager.totalPoints, traits: manager.currentProfile.traits, development: manager.currentProfile.development, genome: manager.currentProfile.genome, strategyProgram: strategyProgramHash(manager.currentProfile.strategyProgram), contracts: manager.contracts, lineage: manager.lineage, pendingLineage: manager.pendingLineage})).sort((a: any, b: any) => a.id.localeCompare(b.id)),
    seasons: seasons.map(season => ({season: season.season, champion: season.champion, standings: season.standings, transactions: season.transactions, validity: season.validity})),
  };
  return digest(canonical);
}

function digest(value:any):string{return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");}
function stableStringify(value: any): string {if(Array.isArray(value))return`[${value.map(stableStringify).join(",")}]`;if(value&&typeof value==="object")return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;return JSON.stringify(value);}
function directorySize(directory:string):number{let total=0;for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const target=path.join(directory,entry.name);total+=entry.isDirectory()?directorySize(target):fs.statSync(target).size;}return total;}
function safe(value:string):string{return value.replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"")||"seed";}
function option(name:string,fallback:string):string{const index=args.indexOf(name);return index>=0?args[index+1]??fallback:fallback;}
function integerOption(name:string,fallback:number,min:number,max:number):number{const value=Number(option(name,String(fallback)));if(!Number.isInteger(value)||value<min||value>max)throw new Error(`${name} must be ${min}..${max}`);return value;}
function numberOption(name:string,fallback:number,min:number,max:number):number{const value=Number(option(name,String(fallback)));if(!Number.isFinite(value)||value<=min||value>max)throw new Error(`${name} must be >${min} and <=${max}`);return value;}
function read<T>(file:string):T{return JSON.parse(fs.readFileSync(file,"utf8")) as T;}
