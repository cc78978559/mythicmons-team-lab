import fs from "node:fs";
import path from "node:path";
import {parseArgs, stringArg} from "../showdown/args";
import {loadTeam, validateTeam, writeTeam} from "../showdown/team";
import {closeTeamDatabase, defaultTeamDbPath, getTeam, listTeams, openTeamDatabase, saveTeam} from "../store/teamDatabase";

type TeamOutputFormat = "export" | "json" | "packed";

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0]?.startsWith("--") ? "convert" : (argv[0] ?? "convert");
  const args = parseArgs(command === "convert" ? argv : argv.slice(1));

  if (command === "convert") {
    convertTeam(args);
  } else if (command === "save") {
    await saveTeamCommand(args);
  } else if (command === "list") {
    await listTeamsCommand(args);
  } else if (command === "show") {
    await showTeamCommand(args);
  } else if (command === "export") {
    await exportTeamCommand(args);
  } else if (command === "sandbox") {
    await exportSandboxCommand(args);
  } else {
    throw new Error("Unknown team command. Use one of: convert, save, list, show, export, sandbox");
  }
}

function convertTeam(args: ReturnType<typeof parseArgs>): void {
  const input = stringArg(args, "input");
  const output = stringArg(args, "output");
  const to = parseOutputFormat(stringArg(args, "to", "export"));
  const format = stringArg(args, "format", "gen9ou");

  const team = loadTeam(input);
  const problems = validateTeam(format, team.sets);
  writeTeam(team.sets, path.resolve(output), to);

  if (problems.length) {
    console.warn(`Converted, but team is invalid for ${format}:`);
    for (const problem of problems) console.warn(`- ${problem}`);
  }
}

async function saveTeamCommand(args: ReturnType<typeof parseArgs>): Promise<void> {
  const input = stringArg(args, "input");
  const name = stringArg(args, "name");
  const format = stringArg(args, "format", "gen9ou");
  const id = optionalStringArg(args, "id");
  const notes = optionalStringArg(args, "notes");
  const tags = splitCsv(optionalStringArg(args, "tags"));
  const dbPath = stringArg(args, "db", defaultTeamDbPath());

  const loaded = loadTeam(input);
  const db = await openTeamDatabase(dbPath);
  try {
    const saved = await saveTeam(db, {
      id,
      name,
      format,
      sets: loaded.sets,
      sourcePath: path.resolve(input),
      notes,
      tags,
    });
    console.log(`Saved team: ${saved.id}`);
    console.log(`Name: ${saved.name}`);
    console.log(`Format: ${saved.format}`);
    console.log(`Database: ${path.resolve(dbPath)}`);
  } finally {
    await closeTeamDatabase(db);
  }
}

async function listTeamsCommand(args: ReturnType<typeof parseArgs>): Promise<void> {
  const dbPath = stringArg(args, "db", defaultTeamDbPath());
  const db = await openTeamDatabase(dbPath);
  try {
    const teams = await listTeams(db);
    if (!teams.length) {
      console.log(`No teams saved in ${path.resolve(dbPath)}`);
      return;
    }
    for (const team of teams) {
      const tags = team.tags.length ? ` [${team.tags.join(",")}]` : "";
      console.log(`${team.id}\t${team.format}\t${team.name}${tags}`);
    }
  } finally {
    await closeTeamDatabase(db);
  }
}

async function showTeamCommand(args: ReturnType<typeof parseArgs>): Promise<void> {
  const id = stringArg(args, "id");
  const dbPath = stringArg(args, "db", defaultTeamDbPath());
  const db = await openTeamDatabase(dbPath);
  try {
    const team = await getTeam(db, id);
    if (!team) throw new Error(`Team not found: ${id}`);
    console.log(`ID: ${team.id}`);
    console.log(`Name: ${team.name}`);
    console.log(`Format: ${team.format}`);
    console.log(`Tags: ${team.tags.join(", ") || "-"}`);
    console.log(`Created: ${team.createdAt}`);
    console.log(`Updated: ${team.updatedAt}`);
    if (team.notes) console.log(`Notes: ${team.notes}`);
    console.log(`Sandbox source: ${team.sandboxSource ? "yes" : "no"}`);
    console.log("");
    console.log(team.exported.trimEnd());
  } finally {
    await closeTeamDatabase(db);
  }
}

async function exportSandboxCommand(args: ReturnType<typeof parseArgs>): Promise<void> {
  const id = stringArg(args, "id");
  const output = path.resolve(stringArg(args, "output"));
  const dbPath = stringArg(args, "db", defaultTeamDbPath());
  const db = await openTeamDatabase(dbPath);
  try {
    const team = await getTeam(db, id);
    if (!team) throw new Error(`Team not found: ${id}`);
    if (!team.sandboxSource) throw new Error(`Team does not contain sandbox source: ${id}`);
    fs.mkdirSync(path.dirname(output), {recursive: true});
    fs.writeFileSync(output, `${JSON.stringify(team.sandboxSource, null, 2)}\n`, "utf8");
    console.log(`Exported sandbox source ${team.id} to ${output}`);
  } finally {
    await closeTeamDatabase(db);
  }
}

async function exportTeamCommand(args: ReturnType<typeof parseArgs>): Promise<void> {
  const id = stringArg(args, "id");
  const output = stringArg(args, "output");
  const to = parseOutputFormat(stringArg(args, "to", "export"));
  const dbPath = stringArg(args, "db", defaultTeamDbPath());
  const db = await openTeamDatabase(dbPath);
  try {
    const team = await getTeam(db, id);
    if (!team) throw new Error(`Team not found: ${id}`);
    writeTeam(team.teamJson, path.resolve(output), to);
    console.log(`Exported team ${team.id} to ${path.resolve(output)}`);
  } finally {
    await closeTeamDatabase(db);
  }
}

function parseOutputFormat(value: string): TeamOutputFormat {
  if (value === "export" || value === "json" || value === "packed") return value;
  throw new Error("--to must be one of: export, json, packed");
}

function optionalStringArg(args: ReturnType<typeof parseArgs>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map(part => part.trim()).filter(Boolean);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
