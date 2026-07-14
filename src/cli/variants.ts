import fs from "node:fs";
import path from "node:path";
import {toID} from "pokemon-showdown";
import {parseArgs, stringArg, numberArg, booleanArg} from "../showdown/args";
import type {AiStrategy} from "../showdown/choice";
import {loadTeam, validateTeam, writeTeam} from "../showdown/team";
import {loadBenchmarkPool} from "../eval/benchmarkPool";
import {evaluateCandidate} from "../eval/evaluator";
import {compileSandboxTeam} from "../sandbox/compiler";
import {installCompiledSandbox} from "../sandbox/installer";
import type {SandboxTeam} from "../sandbox/types";
import {generateSandboxVariants, generateVariants} from "../variants/generator";
import {writeVariantReport} from "../variants/report";
import type {VariantExperimentSummary, VariantKind, VariantResult} from "../variants/types";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const teamPath = stringArg(args, "team");
  const sandbox = tryLoadSandbox(teamPath);
  const poolPath = stringArg(args, "benchmarks", "benchmarks/gen9ou/index.json");
  const pool = loadBenchmarkPool(poolPath);
  const format = stringArg(args, "format", sandbox ? "gen9mythicmonssandbox" : pool.format);
  const seed = stringArg(args, "seed", "1");
  const ai = parseAi(stringArg(args, "ai", "basic"));
  const gamesPerBenchmark = numberArg(args, "games", 1, {integer: true, min: 1});
  const maxTurns = numberArg(args, "maxTurns", 500, {integer: true, min: 1});
  const maxVariants = numberArg(args, "limit", 12, {integer: true, min: 1});
  const outDir = path.resolve(stringArg(args, "out", "output/variants"));
  const validate = booleanArg(args, "validate", true);
  const kinds = parseKinds(stringArg(args, "kinds", "item,ability,move,evs"));

  fs.mkdirSync(outDir, {recursive: true});
  if (sandbox) {
    await runSandboxVariantExperiment({
      sandbox, teamPath, pool, format, seed, ai, gamesPerBenchmark, maxTurns, maxVariants, outDir, kinds,
    });
    return;
  }
  const loaded = loadTeam(teamPath);
  if (validate) throwIfInvalid(format, "baseline", validateTeam(format, loaded.sets));

  const baselineDir = path.join(outDir, "baseline");
  const baseline = await evaluateCandidate({
    candidatePath: teamPath,
    pool,
    format,
    seed,
    gamesPerBenchmark,
    outDir: baselineDir,
    maxTurns,
    validate,
    ai,
  });

  const variants = generateVariants(loaded.sets, {kinds, maxVariants});
  const results: VariantResult[] = [];
  const skipped: VariantExperimentSummary["skipped"] = [];

  for (const variant of variants) {
    const problems = validate ? validateTeam(format, variant.team) : [];
    if (problems.length) {
      skipped.push({
        id: variant.id,
        description: variant.description,
        reasons: problems,
      });
      continue;
    }

    const variantDir = path.join(outDir, "variants", variant.id);
    const variantTeamPath = path.join(variantDir, "candidate.export.txt");
    writeTeam(variant.team, variantTeamPath, "export");
    writeTeam(variant.team, path.join(variantDir, "candidate.json"), "json");

    const evaluation = await evaluateCandidate({
      candidatePath: variantTeamPath,
      pool,
      format,
      seed,
      gamesPerBenchmark,
      outDir: path.join(variantDir, "eval"),
      maxTurns,
      validate,
      ai,
    });

    results.push({
      variant: {
        id: variant.id,
        kind: variant.kind,
        memberIndex: variant.memberIndex,
        memberName: variant.memberName,
        description: variant.description,
      },
      evaluation,
      delta: {
        winRate: evaluation.overallWinRate - baseline.overallWinRate,
        relativeScore: relativeScoreDelta(evaluation.relativeScore, baseline.relativeScore),
        averageTurns: evaluation.averageTurns - baseline.averageTurns,
      },
    });
  }

  const summary: VariantExperimentSummary = {
    candidate: path.resolve(teamPath),
    benchmarkPool: pool.id,
    format,
    seed,
    ai,
    gamesPerBenchmark,
    baseline,
    variants: results,
    skipped,
  };

  fs.writeFileSync(path.join(outDir, "variants.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeVariantReport(summary, path.join(outDir, "variants-report.md"));

  const best = [...results]
    .filter(result => result.delta.relativeScore !== null)
    .sort((a, b) => (b.delta.relativeScore ?? 0) - (a.delta.relativeScore ?? 0))[0];
  console.log(`Format: ${format}`);
  console.log(`AI: ${ai}`);
  console.log(`Baseline score: ${formatScore(baseline.relativeScore)}`);
  console.log(`Evaluated variants: ${results.length}`);
  console.log(`Skipped variants: ${skipped.length}`);
  if (best) {
    console.log(`Best change: ${best.variant.description}`);
    const delta = best.delta.relativeScore as number;
    console.log(`Score delta: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`);
  }
  console.log(`Report: ${path.join(outDir, "variants-report.md")}`);
}

async function runSandboxVariantExperiment(input: {
  sandbox: SandboxTeam;
  teamPath: string;
  pool: ReturnType<typeof loadBenchmarkPool>;
  format: string;
  seed: string;
  ai: AiStrategy;
  gamesPerBenchmark: number;
  maxTurns: number;
  maxVariants: number;
  outDir: string;
  kinds: VariantKind[];
}): Promise<void> {
  const variants = generateSandboxVariants(input.sandbox, {kinds: input.kinds, maxVariants: input.maxVariants});
  const combined = compileSandboxTeam(combineSandboxSources([input.sandbox, ...variants.map(variant => variant.sandbox)]));
  installCompiledSandbox(combined, process.cwd(), {backup: true, merge: true});

  const baselineCompiled = compileSandboxTeam(input.sandbox);
  const baselineDir = path.join(input.outDir, "baseline");
  const baselineTeamPath = path.join(baselineDir, "candidate.export.txt");
  fs.mkdirSync(baselineDir, {recursive: true});
  writeTeam(baselineCompiled.team, baselineTeamPath, "export");
  fs.writeFileSync(path.join(baselineDir, "sandbox-source.json"), `${JSON.stringify(input.sandbox, null, 2)}\n`, "utf8");
  const baseline = await evaluateCandidate({
    candidatePath: baselineTeamPath,
    pool: input.pool,
    format: input.format,
    seed: input.seed,
    gamesPerBenchmark: input.gamesPerBenchmark,
    outDir: path.join(baselineDir, "eval"),
    maxTurns: input.maxTurns,
    validate: false,
    ai: input.ai,
  });

  const results: VariantResult[] = [];
  for (const variant of variants) {
    const variantDir = path.join(input.outDir, "variants", variant.id);
    const variantTeamPath = path.join(variantDir, "candidate.export.txt");
    const compiled = compileSandboxTeam(variant.sandbox);
    fs.mkdirSync(variantDir, {recursive: true});
    writeTeam(compiled.team, variantTeamPath, "export");
    fs.writeFileSync(path.join(variantDir, "sandbox-source.json"), `${JSON.stringify(variant.sandbox, null, 2)}\n`, "utf8");
    const evaluation = await evaluateCandidate({
      candidatePath: variantTeamPath,
      pool: input.pool,
      format: input.format,
      seed: input.seed,
      gamesPerBenchmark: input.gamesPerBenchmark,
      outDir: path.join(variantDir, "eval"),
      maxTurns: input.maxTurns,
      validate: false,
      ai: input.ai,
    });
    results.push({
      variant: {
        id: variant.id,
        kind: variant.kind,
        memberIndex: variant.memberIndex,
        memberName: variant.memberName,
        description: variant.description,
      },
      evaluation,
      delta: {
        winRate: evaluation.overallWinRate - baseline.overallWinRate,
        relativeScore: relativeScoreDelta(evaluation.relativeScore, baseline.relativeScore),
        averageTurns: evaluation.averageTurns - baseline.averageTurns,
      },
    });
  }

  const summary: VariantExperimentSummary = {
    candidate: path.resolve(input.teamPath),
    benchmarkPool: input.pool.id,
    format: input.format,
    seed: input.seed,
    ai: input.ai,
    gamesPerBenchmark: input.gamesPerBenchmark,
    baseline,
    variants: results,
    skipped: [],
  };
  fs.writeFileSync(path.join(input.outDir, "variants.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeVariantReport(summary, path.join(input.outDir, "variants-report.md"));
  printVariantSummary(summary, input.outDir);
}

function combineSandboxSources(sources: SandboxTeam[]): SandboxTeam {
  return {
    name: "MythicMons Variant Registry",
    customMoves: dedupeEffects(sources.flatMap(source => source.customMoves ?? [])),
    customAbilities: dedupeEffects(sources.flatMap(source => source.customAbilities ?? [])),
    customItems: dedupeEffects(sources.flatMap(source => source.customItems ?? [])),
    members: sources.flatMap((source, sourceIndex) => source.members.map(member => ({
      ...member,
      id: `registry-${sourceIndex + 1}-${member.id}`,
    }))),
  };
}

function dedupeEffects<T extends {id: string}>(effects: T[]): T[] {
  const byId = new Map<string, T>();
  for (const effect of effects) byId.set(toID(effect.id), effect);
  return [...byId.values()];
}

function tryLoadSandbox(teamPath: string): SandboxTeam | null {
  if (path.extname(teamPath).toLowerCase() !== ".json") return null;
  const parsed = JSON.parse(fs.readFileSync(teamPath, "utf8")) as Partial<SandboxTeam> | unknown[];
  if (Array.isArray(parsed) || !parsed || !Array.isArray(parsed.members) || typeof parsed.name !== "string") return null;
  return parsed as SandboxTeam;
}

function printVariantSummary(summary: VariantExperimentSummary, outDir: string): void {
  const best = [...summary.variants]
    .filter(result => result.delta.relativeScore !== null)
    .sort((a, b) => (b.delta.relativeScore ?? 0) - (a.delta.relativeScore ?? 0))[0];
  console.log(`Format: ${summary.format}`);
  console.log(`AI: ${summary.ai}`);
  console.log(`Baseline score: ${formatScore(summary.baseline.relativeScore)}`);
  console.log(`Evaluated variants: ${summary.variants.length}`);
  console.log(`Skipped variants: ${summary.skipped.length}`);
  if (best) {
    console.log(`Best change: ${best.variant.description}`);
    const delta = best.delta.relativeScore as number;
    console.log(`Score delta: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`);
  }
  console.log(`Report: ${path.join(outDir, "variants-report.md")}`);
}

function parseAi(value: string): AiStrategy {
  if (value === "first" || value === "damage" || value === "basic" || value === "tactical" || value === "search") return value;
  throw new Error("--ai must be one of: basic, damage, first, search, tactical");
}

function relativeScoreDelta(value: number | null, baseline: number | null): number | null {
  return value === null || baseline === null ? null : value - baseline;
}

function formatScore(value: number | null): string {
  return value === null ? "N/A" : `${value.toFixed(1)} / 100`;
}

function parseKinds(value: string): VariantKind[] {
  const kinds = value.split(",").map(kind => kind.trim()).filter(Boolean);
  for (const kind of kinds) {
    if (kind !== "item" && kind !== "ability" && kind !== "move" && kind !== "evs") {
      throw new Error("--kinds must be a comma-separated subset of: item,ability,move,evs");
    }
  }
  return kinds as VariantKind[];
}

function throwIfInvalid(format: string, label: string, problems: string[]): void {
  if (!problems.length) return;
  throw new Error(`${label} is invalid for ${format}:\n- ${problems.join("\n- ")}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
