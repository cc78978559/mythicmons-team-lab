import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {spawnSync} from "node:child_process";
import {buildLineupPilotPlan, type LineupPilotCase, type LineupPilotPlan} from "../ai/whiteBox/lineupPilot";

const args = process.argv.slice(2);
const command = args[0]?.startsWith("--") ? "status" : args[0] ?? "status";
const source = path.resolve(option("--source", "output/official-era-03/league"));
const diagnostics = path.resolve(option("--diagnostics", "output/tooling/shadow-diagnostics"));
const out = path.resolve(option("--out", "output/tooling/shadow-lineup-pilot"));
const target = integerOption("--target", 30, 1, 100);
const maximumCases = integerOption("--max-cases", target, 1, 100);
const planFile = path.join(out, "pilot-plan.json");
const manifestFile = path.join(out, "pilot-manifest.json");

if (command === "plan") {
  const plan = createPlan();
  print({status: "planned", selected: plan.selected.length, available: plan.available, coverage: plan.coverage, plan: planFile});
} else if (command === "run") {
  runPilot();
} else if (command === "report") {
  if (!fs.existsSync(planFile) || !fs.existsSync(manifestFile)) throw new Error("Pilot has not been planned");
  summarize(read<LineupPilotPlan>(planFile), read<any>(manifestFile));
} else if (command === "status") {
  status();
} else {
  throw new Error(`Unknown command ${command}; use plan, run, report, or status`);
}

function createPlan(): LineupPilotPlan {
  const detailsFile = path.join(diagnostics, "shadow-diagnosis-details.json.gz");
  const details = JSON.parse(zlib.gunzipSync(fs.readFileSync(detailsFile)).toString("utf8"));
  const plan = buildLineupPilotPlan(details.experimentPlan?.cases ?? [], source, target);
  fs.mkdirSync(out, {recursive: true});
  write(planFile, plan);
  const manifest = {
    schemaVersion: 1,
    source,
    plan: planFile,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: plan.selected.map(entry => ({
      id: entry.id,
      decisionId: entry.decisionId,
      season: entry.season,
      actor: entry.actor,
      status: "pending",
    })),
  };
  write(manifestFile, manifest);
  return plan;
}

function runPilot(): void {
  const plan = fs.existsSync(planFile) ? read<LineupPilotPlan>(planFile) : createPlan();
  const manifest = read<any>(manifestFile);
  const pendingItems = (manifest.items ?? [])
    .filter((entry: any) => entry.status !== "complete")
    .sort((left: any, right: any) =>
      Number(!hasRefresh(Number(left.season))) - Number(!hasRefresh(Number(right.season)))
      || Number(left.season) - Number(right.season)
      || String(left.id).localeCompare(String(right.id)));
  const pendingIds = new Set<string>(pendingItems.slice(0, maximumCases).map((entry: any) => entry.id));
  const pending = plan.selected.filter(entry => pendingIds.has(entry.id));
  if (!pending.length) {
    summarize(plan, manifest);
    return;
  }
  const executionSeasons = new Set(pending.map(entry => entry.season));
  const refreshTargets = plan.selected.filter(entry =>
    executionSeasons.has(entry.season)
    && manifest.items.find((item: any) => item.id === entry.id)?.status !== "complete");
  const refreshed = refreshBySeason(refreshTargets);
  for (const planned of pending) {
    const item = manifest.items.find((entry: any) => entry.id === planned.id);
    const exact = refreshed.get(planned.decisionId) ?? planned;
    if (!exact.boundedScenario || !exact.traceComplete) {
      fail(item, `Complete bounded trace unavailable for ${planned.decisionId}`, manifest);
    }
    item.status = "running";
    item.startedAt = new Date().toISOString();
    writeManifest(manifest);
    const caseRoot = path.join(out, "cases", caseKey(planned));
    try {
      runTool("src/cli/counterfactualWhiteBoxLineup.ts", [
        "--source", source,
        "--out", caseRoot,
        "--decision-id", planned.decisionId,
        "--manager", planned.actor,
        "--season", String(planned.season),
        "--band", String(exact.reasonableBand),
        "--style-limit", String(exact.boundedScenario.styleLimit),
        "--style-scale", String(exact.boundedScenario.styleScale),
        "--reuse-source-control",
        "--force",
      ]);
      runTool("src/cli/compactLineupCounterfactual.ts", ["--input", caseRoot]);
      const capsuleFile = path.join(caseRoot, "counterfactual-evidence.json.gz");
      const capsule = JSON.parse(zlib.gunzipSync(fs.readFileSync(capsuleFile)).toString("utf8"));
      item.status = "complete";
      item.completedAt = new Date().toISOString();
      item.output = capsuleFile;
      item.result = {
        direction: capsule.summary?.localOutcome?.direction ?? "unknown",
        pairMarginDelta: capsule.summary?.localOutcome?.delta?.pairMargin ?? null,
        gameMarginDelta: capsule.summary?.localOutcome?.delta?.gameMargin ?? null,
        causal: capsule.battleCausalSignature?.summary ?? null,
        classifications: [...new Set((capsule.battleCausalSignature?.games ?? []).map((game: any) => String(game.classification)))],
      };
      writeManifest(manifest);
    } catch (error) {
      fail(item, error instanceof Error ? error.message : String(error), manifest);
    }
  }
  summarize(plan, manifest);
}

function refreshBySeason(cases: LineupPilotCase[]): Map<string, LineupPilotCase> {
  const result = new Map<string, LineupPilotCase>();
  const bySeason = new Map<number, LineupPilotCase[]>();
  for (const entry of cases) {
    if (entry.traceComplete) {
      result.set(entry.decisionId, entry);
      continue;
    }
    const group = bySeason.get(entry.season) ?? [];
    group.push(entry);
    bySeason.set(entry.season, group);
  }
  for (const [season, entries] of bySeason) {
    const refreshRoot = path.join(out, "refresh", `season-${String(season).padStart(2, "0")}`);
    const queueFile = path.join(refreshRoot, "pilot-refresh-queue.json");
    write(queueFile, {schemaVersion: 1, cases: entries});
    const refreshedQueue = path.join(refreshRoot, "refreshed-experiment-queue.json");
    const alreadyRefreshed = fs.existsSync(refreshedQueue)
      ? new Set<string>((read<any>(refreshedQueue).cases ?? []).map((entry: any) => String(entry.decisionId)))
      : new Set<string>();
    if (entries.some(entry => !alreadyRefreshed.has(entry.decisionId))) {
      runTool("src/cli/refreshShadowLineupTraces.ts", [
        "--source", source,
        "--queue", queueFile,
        "--out", refreshRoot,
        "--target-season", String(season),
        "--limit", String(entries.length),
        "--force",
      ]);
    }
    const refreshed = read<any>(refreshedQueue);
    for (const entry of refreshed.cases ?? []) result.set(String(entry.decisionId), entry as LineupPilotCase);
    const missing = entries.filter(entry => !result.has(entry.decisionId));
    if (missing.length) throw new Error(`Trace refresh omitted ${missing.map(entry => entry.decisionId).join(", ")}`);
  }
  return result;
}

function summarize(plan: LineupPilotPlan, manifest: any): void {
  const completed = (manifest.items ?? []).filter((entry: any) => entry.status === "complete");
  const failed = (manifest.items ?? []).filter((entry: any) => entry.status === "failed");
  const directions = count(completed, (entry: any) => entry.result?.direction ?? "unknown");
  const classifications = count(completed.flatMap((entry: any) => entry.result?.classifications ?? []), (entry: any) => String(entry));
  const summary = {
    schemaVersion: 1,
    source,
    selected: plan.selected.length,
    completed: completed.length,
    pending: plan.selected.length - completed.length - failed.length,
    failed: failed.length,
    directions,
    classifications,
    timings: timingSummary(plan, completed),
    outputBytes: directoryBytes(out),
    causalTotals: {
      games: sum(completed, "games"),
      outcomeChanges: sum(completed, "outcomeChanges"),
      actionDivergences: sum(completed, "actionDivergences"),
      unusedSubstitutions: sum(completed, "unusedSubstitutions"),
      reconvergences: sum(completed, "reconvergences"),
    },
    coverage: plan.coverage,
    manifest: manifestFile,
  };
  write(path.join(out, "pilot-summary.json"), summary);
  const report = [
    "# Shadow Lineup Pilot",
    "",
    `- Completed: ${summary.completed}/${summary.selected}`,
    `- Pending: ${summary.pending}`,
    `- Failed: ${summary.failed}`,
    `- Local outcome directions: ${JSON.stringify(directions)}`,
    `- Battle classifications: ${JSON.stringify(classifications)}`,
    `- Games with causal signatures: ${summary.causalTotals.games}`,
    `- Outcome changes: ${summary.causalTotals.outcomeChanges}`,
    `- Action divergences: ${summary.causalTotals.actionDivergences}`,
    `- Unused substitutions: ${summary.causalTotals.unusedSubstitutions}`,
    `- Trace refresh time: ${summary.timings.refreshDurationMs} ms`,
    `- Experiment time: ${summary.timings.experimentDurationMs} ms`,
    `- Stored output: ${summary.outputBytes} bytes`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(out, "pilot-report.md"), report, "utf8");
  print({status: failed.length ? "failed" : completed.length === plan.selected.length ? "complete" : "partial", ...summary});
}

function status(): void {
  if (!fs.existsSync(manifestFile)) {
    print({status: "not-planned", out});
    return;
  }
  const manifest = read<any>(manifestFile);
  print({
    status: "ready",
    counts: count(manifest.items ?? [], (entry: any) => entry.status),
    manifest: manifestFile,
    summary: fs.existsSync(path.join(out, "pilot-summary.json")) ? path.join(out, "pilot-summary.json") : null,
  });
}

function runTool(script: string, toolArgs: string[]): void {
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.resolve(script), ...toolArgs], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`${script} failed:\n${result.stderr || result.stdout}`);
}
function hasRefresh(season: number): boolean {
  return fs.existsSync(path.join(out, "refresh", `season-${String(season).padStart(2, "0")}`, "refreshed-experiment-queue.json"));
}
function timingSummary(plan: LineupPilotPlan, completed: any[]): {refreshDurationMs: number; experimentDurationMs: number} {
  let refreshDurationMs = 0;
  for (const season of new Set(plan.selected.filter(entry => hasRefresh(entry.season)).map(entry => entry.season))) {
    const file = path.join(out, "refresh", `season-${String(season).padStart(2, "0")}`, "refresh-summary.json");
    if (fs.existsSync(file)) refreshDurationMs += Number(read<any>(file).durationMs ?? 0);
  }
  const experimentDurationMs = completed.reduce((total: number, entry: any) => {
    const started = Date.parse(entry.startedAt ?? ""), completedAt = Date.parse(entry.completedAt ?? "");
    return total + (Number.isFinite(started) && Number.isFinite(completedAt) ? completedAt - started : 0);
  }, 0);
  return {refreshDurationMs, experimentDurationMs};
}
function directoryBytes(directory: string): number {
  if (!fs.existsSync(directory)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    total += entry.isDirectory() ? directoryBytes(file) : entry.isFile() ? fs.statSync(file).size : 0;
  }
  return total;
}
function fail(item: any, message: string, manifest: any): never {
  item.status = "failed";
  item.failedAt = new Date().toISOString();
  item.error = message.slice(0, 8000);
  writeManifest(manifest);
  throw new Error(message);
}
function writeManifest(manifest: any): void { manifest.updatedAt = new Date().toISOString(); write(manifestFile, manifest); }
function caseKey(entry: LineupPilotCase): string {
  return `s${String(entry.season).padStart(2, "0")}-${entry.actor}-${crypto.createHash("sha1").update(entry.decisionId).digest("hex").slice(0, 10)}`;
}
function count<T>(values: readonly T[], selector: (entry: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) { const key = selector(value); result[key] = (result[key] ?? 0) + 1; }
  return result;
}
function sum(items: any[], key: string): number {
  return items.reduce((total, item) => total + Number(item.result?.causal?.[key] ?? 0), 0);
}
function print(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function write(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function option(name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}
function integerOption(name: string, fallback: number, min: number, max: number): number {
  const value = Number(option(name, String(fallback)));
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`);
  return value;
}
