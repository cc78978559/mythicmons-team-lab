import fs from "node:fs";
import path from "node:path";
import {loadBattleReplayCapsule, runBattle} from "../showdown/battle";
import {AI_VERSION} from "../showdown/choice";

type ExpansionStatus = "complete" | "failed";

interface ExpansionRun {
  id: string;
  seedLabel: string;
  gameIndex: number;
  status: ExpansionStatus;
  directory: string;
  startedAt: string;
  completedAt: string;
  winner?: string | null;
  turns?: number;
  error?: string;
}

interface ExpansionManifest {
  schemaVersion: 1;
  config: {
    sourceGame: string;
    sourceSha256: string;
    aiVersion: string;
    seedLabels: string[];
    gamesPerSeed: number;
    maximumOutputMb: number;
    minimumFreeGb: number;
  };
  runs: ExpansionRun[];
  stopReason: string | null;
}

const args = process.argv.slice(2);
const sourceOption = option("--source-game", "");
if (!sourceOption) throw new Error("--source-game must point to a retained shadow battle directory or replay-input.json");
const sourcePath = path.resolve(sourceOption);
const replayFile = path.basename(sourcePath) === "replay-input.json" ? sourcePath : path.join(sourcePath, "replay-input.json");
const capsule = loadBattleReplayCapsule(replayFile);
if (capsule.input.aiVersion !== AI_VERSION) throw new Error(`Battle AI version drift: source=${capsule.input.aiVersion}, current=${AI_VERSION}`);
if (capsule.input.ai !== "search" || !capsule.input.traceAiDecisions) throw new Error("Source must use search AI with decision tracing enabled");
if (capsule.input.battleAssistScopes?.length) throw new Error("Source battle already used active battle assist and cannot seed shadow evidence");

const out = path.resolve(option("--out", "output/whitebox-battle-shadow-sources"));
const gamesPerSeed = integerOption("--games-per-seed", 3, 1, 100);
const maximumOutputMb = integerOption("--max-output-mb", 2048, 10, 102400);
const minimumFreeGb = numberOption("--min-free-gb", 10, 0, 10000);
const maximumLaunches = integerOption("--max-launches", 30, 1, 10000);
const seedLabels = parseSeedLabels();
const config = {sourceGame: path.dirname(replayFile), sourceSha256: capsule.sha256, aiVersion: AI_VERSION, seedLabels, gamesPerSeed, maximumOutputMb, minimumFreeGb};

fs.mkdirSync(out, {recursive: true});
const manifestFile = path.join(out, "battle-shadow-expansion-manifest.json");
const previous = fs.existsSync(manifestFile) ? read<ExpansionManifest>(manifestFile) : null;
if (previous && JSON.stringify(previous.config) !== JSON.stringify(config)) throw new Error("Shadow expansion configuration differs from the existing manifest; use a new --out directory");
const manifest: ExpansionManifest = {schemaVersion: 1, config, runs: previous?.runs ?? [], stopReason: null};
save();

async function main(): Promise<void> {
if (args.includes("--run")) {
  const failed = manifest.runs.find(run => run.status === "failed");
  if (failed) {
    manifest.stopReason = `previous-failure:${failed.id}`;
  } else {
    const completed = new Set(manifest.runs.filter(run => run.status === "complete").map(run => run.id));
    let launched = 0;
    outer: for (const seedLabel of seedLabels) {
      prepareSourceRoot(seedLabel);
      for (let gameIndex = 0; gameIndex < gamesPerSeed; gameIndex += 1) {
        const id = runId(seedLabel, gameIndex);
        if (completed.has(id)) continue;
        if (launched >= maximumLaunches) { manifest.stopReason = `launch-budget:${maximumLaunches}`; break outer; }
        const outputMb = directorySize(out) / 1048576;
        const freeGb = freeBytes(out) / 1073741824;
        if (outputMb >= maximumOutputMb) { manifest.stopReason = `output-budget:${round(outputMb)}MB/${maximumOutputMb}MB`; break outer; }
        if (freeGb < minimumFreeGb) { manifest.stopReason = `disk-reserve:${round(freeGb)}GB/${minimumFreeGb}GB`; break outer; }
        await launch(seedLabel, gameIndex);
        completed.add(id);
        launched += 1;
      }
    }
    if (!manifest.stopReason) manifest.stopReason = "source-pool-exhausted";
  }
  save();
}

const completed = manifest.runs.filter(run => run.status === "complete");
const completedBySeed = new Map<string, number>();
for (const run of completed) completedBySeed.set(run.seedLabel, (completedBySeed.get(run.seedLabel) ?? 0) + 1);
const summary = {
  schemaVersion: 1,
  sourceSha256: capsule.sha256,
  aiVersion: AI_VERSION,
  plannedSources: seedLabels.length,
  plannedGames: seedLabels.length * gamesPerSeed,
  startedSources: completedBySeed.size,
  completedSources: [...completedBySeed.values()].filter(count => count === gamesPerSeed).length,
  completedGames: completed.length,
  failedGames: manifest.runs.filter(run => run.status === "failed").length,
  stopReason: manifest.stopReason,
  outputMb: round(directorySize(out) / 1048576),
  sourceRoots: seedLabels.map(sourceRoot),
  manifest: manifestFile,
};
write(path.join(out, "battle-shadow-expansion-summary.json"), summary);
console.log(JSON.stringify(summary, null, 2));
}

async function launch(seedLabel: string, gameIndex: number): Promise<void> {
  const id = runId(seedLabel, gameIndex), startedAt = new Date().toISOString();
  const battleParent = path.join(sourceRoot(seedLabel), "season-00", "battles", "shadow-calibration");
  const directory = path.join(battleParent, `game-${String(gameIndex + 1).padStart(4, "0")}`);
  if (fs.existsSync(directory)) throw new Error(`Untracked shadow battle directory exists: ${directory}`);
  try {
    const result = await runBattle({
      format: capsule.input.format,
      teamA: capsule.input.teamA,
      teamB: capsule.input.teamB,
      seed: `${capsule.sha256}:${seedLabel}`,
      gameIndex,
      outDir: battleParent,
      maxTurns: capsule.input.maxTurns,
      idleTimeoutMs: capsule.input.idleTimeoutMs,
      wallClockTimeoutMs: capsule.input.wallClockTimeoutMs,
      ai: capsule.input.ai,
      openTeamSheets: capsule.input.openTeamSheets,
      traceAiDecisions: capsule.input.traceAiDecisions,
      aiProfiles: capsule.input.aiProfiles,
      aiOpponentModels: capsule.input.aiOpponentModels,
    });
    if (!result.ended || result.stalled || result.errors.length) throw new Error(`Battle did not produce clean evidence: ended=${result.ended}, stalled=${result.stalled}, errors=${result.errors.length}`);
    manifest.runs.push({id, seedLabel, gameIndex, status: "complete", directory, startedAt, completedAt: new Date().toISOString(), winner: result.winner, turns: result.turns});
    save();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    manifest.runs.push({id, seedLabel, gameIndex, status: "failed", directory, startedAt, completedAt: new Date().toISOString(), error: message});
    manifest.stopReason = `experiment-failed:${id}`;
    save();
    throw error;
  }
}

function prepareSourceRoot(seedLabel: string): void {
  const directory = sourceRoot(seedLabel);
  fs.mkdirSync(directory, {recursive: true});
  writeOnce(path.join(directory, "dynasty-state.json"), {version: 12, seed: `battle-shadow:${capsule.sha256}:${seedLabel}`, completedSeason: 0, decisionRecords: []});
  writeOnce(path.join(directory, "source-origin.json"), {schemaVersion: 1, kind: "battle-shadow-seed-expansion", sourceGame: path.dirname(replayFile), sourceSha256: capsule.sha256, aiVersion: AI_VERSION, seedLabel});
}

function sourceRoot(seedLabel: string): string { return path.join(out, "sources", safeLabel(seedLabel)); }
function runId(seedLabel: string, gameIndex: number): string { return `${safeLabel(seedLabel)}:game-${String(gameIndex + 1).padStart(4, "0")}`; }
function safeLabel(value: string): string { return `seed-${value.replace(/[^a-zA-Z0-9._-]+/g, "-")}`; }
function parseSeedLabels(): string[] {
  const explicit = option("--seeds", "").split(",").map(value => value.trim()).filter(Boolean);
  const values = explicit.length ? explicit : Array.from({length: integerOption("--seed-count", 10, 2, 1000)}, (_, index) => String(index + 1).padStart(3, "0"));
  if (new Set(values.map(safeLabel)).size !== values.length) throw new Error("--seeds must contain unique filesystem-safe labels");
  return values;
}
function save(): void { write(manifestFile, manifest); }
function writeOnce(file: string, value: unknown): void { if (!fs.existsSync(file)) write(file, value); }
function directorySize(directory: string): number { if (!fs.existsSync(directory)) return 0; let total = 0; for (const entry of fs.readdirSync(directory, {withFileTypes: true})) { const target = path.join(directory, entry.name); total += entry.isDirectory() ? directorySize(target) : fs.statSync(target).size; } return total; }
function freeBytes(directory: string): number { const stats = fs.statfsSync(directory); return Number(stats.bavail) * Number(stats.bsize); }
function write(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function integerOption(name: string, fallback: number, min: number, max: number): number { const value = Number(option(name, String(fallback))); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function numberOption(name: string, fallback: number, min: number, max: number): number { const value = Number(option(name, String(fallback))); if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function round(value: number): number { return Math.round(value * 100) / 100; }

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
