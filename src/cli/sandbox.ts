import fs from "node:fs";
import path from "node:path";
import {parseArgs, stringArg, booleanArg} from "../showdown/args";
import {writeTeam} from "../showdown/team";
import {compileSandboxTeam, exportCompiledTeam} from "../sandbox/compiler";
import {installCompiledSandbox, writeCompiledSandbox} from "../sandbox/installer";
import {closeTeamDatabase, defaultTeamDbPath, openTeamDatabase, saveTeam} from "../store/teamDatabase";
import type {SandboxTeam} from "../sandbox/types";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = stringArg(args, "input");
  const outDir = path.resolve(stringArg(args, "out", "output/sandbox"));
  const install = booleanArg(args, "install", false);
  const backup = booleanArg(args, "backup", true);
  const replaceConflicts = booleanArg(args, "replace", false);
  const save = booleanArg(args, "save", true);

  const sandbox = JSON.parse(fs.readFileSync(input, "utf8")) as SandboxTeam;
  const compiled = compileSandboxTeam(sandbox);

  fs.mkdirSync(outDir, {recursive: true});
  writeCompiledSandbox(compiled, outDir);
  writeTeam(compiled.team, path.join(outDir, "team.export.txt"), "export");
  writeTeam(compiled.team, path.join(outDir, "team.json"), "json");
  fs.writeFileSync(path.join(outDir, "team.packed.txt"), `${require("pokemon-showdown").Teams.pack(compiled.team)}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "README.txt"), readme(compiled.formatId), "utf8");

  let installed: string[] = [];
  if (install) {
    installed = installCompiledSandbox(compiled, process.cwd(), {backup, replaceConflicts});
    fs.writeFileSync(path.join(outDir, "installed-files.json"), `${JSON.stringify(installed, null, 2)}\n`, "utf8");
  }

  if (save) {
    const dbPath = stringArg(args, "db", defaultTeamDbPath());
    const db = await openTeamDatabase(dbPath);
    try {
      const saved = await saveTeam(db, {
        id: optionalStringArg(args, "team-id"),
        name: optionalStringArg(args, "team-name") ?? sandbox.name,
        format: compiled.formatId,
        sets: compiled.team,
        sourcePath: path.resolve(input),
        notes: optionalStringArg(args, "notes"),
        tags: splitCsv(optionalStringArg(args, "tags") ?? "sandbox"),
        sandboxSource: sandbox,
        sandboxManifest: compiled.manifest,
      });
      console.log(`Saved team: ${saved.id}`);
      console.log(`Database: ${path.resolve(dbPath)}`);
    } finally {
      await closeTeamDatabase(db);
    }
  }

  console.log(`Sandbox compiled: ${outDir}`);
  console.log(`Format ID: ${compiled.formatId}`);
  console.log(`Synthetic species: ${compiled.manifest.syntheticSpecies.length}`);
  console.log(`Synthetic abilities: ${compiled.manifest.syntheticAbilities.length}`);
  console.log(`Synthetic items: ${compiled.manifest.syntheticItems.length}`);
  console.log(`Custom moves: ${compiled.manifest.customMoves.length}`);
  if (compiled.manifest.warnings.length) {
    console.log(`Warnings: ${compiled.manifest.warnings.length}`);
    for (const warning of compiled.manifest.warnings) console.log(`- ${warning}`);
  }
  if (install) console.log(`Installed files: ${installed.length}`);
}

function optionalStringArg(args: ReturnType<typeof parseArgs>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map(part => part.trim()).filter(Boolean);
}

function readme(formatId: string): string {
  return [
    "MythicMons sandbox compile output",
    "",
    `Use format: ${formatId}`,
    "",
    "If you compiled with --install, run simulate/evaluate with:",
    `npm run simulate -- --teamA output/sandbox/team.export.txt --teamB examples/teamB.txt --format ${formatId} --no-validate --ai basic`,
    "",
    "Use --no-validate when comparing against normal teams unless every team is compiled for the sandbox format.",
    "",
  ].join("\n");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
