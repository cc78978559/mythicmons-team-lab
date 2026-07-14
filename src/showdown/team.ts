import fs from "node:fs";
import path from "node:path";
import {TeamValidator, Teams} from "pokemon-showdown";
import type {PokemonSet} from "pokemon-showdown/dist/sim/teams";

export interface LoadedTeam {
  sourcePath: string;
  sets: PokemonSet[];
  packed: string;
  exported: string;
}

export function loadTeam(filePath: string): LoadedTeam {
  const source = fs.readFileSync(filePath, "utf8");
  const sets = parseTeam(source, path.extname(filePath).toLowerCase());
  const packed = Teams.pack(sets);
  return {
    sourcePath: filePath,
    sets,
    packed,
    exported: Teams.export(sets),
  };
}

export function parseTeam(source: string, extension = ""): PokemonSet[] {
  if (extension === ".json") {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) throw new Error("Team JSON must be a PokemonSet[] array");
    return parsed as PokemonSet[];
  }

  const sets = Teams.import(source);
  if (!sets?.length) throw new Error("Could not parse team. Use Showdown export, packed, or JSON format.");
  return sets as PokemonSet[];
}

export function validateTeam(format: string, team: PokemonSet[]): string[] {
  const validator = TeamValidator.get(format);
  const problems = validator.validateTeam(team);
  return Array.isArray(problems) ? problems : [];
}

export function writeTeam(team: PokemonSet[], targetPath: string, format: "export" | "json" | "packed"): void {
  let data: string;
  if (format === "json") {
    data = `${JSON.stringify(team, null, 2)}\n`;
  } else if (format === "packed") {
    data = `${Teams.pack(team)}\n`;
  } else {
    data = Teams.export(team);
  }

  fs.mkdirSync(path.dirname(targetPath), {recursive: true});
  fs.writeFileSync(targetPath, data, "utf8");
}
