import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {Teams} from "pokemon-showdown";
import type {PokemonSet} from "pokemon-showdown/dist/sim/teams";
import type {CompiledSandbox, SandboxTeam} from "../sandbox/types";

export interface TeamDatabase {
  path: string;
}

export interface SaveTeamInput {
  id?: string;
  name: string;
  format: string;
  sets: PokemonSet[];
  sourcePath?: string;
  notes?: string;
  tags?: string[];
  sandboxSource?: SandboxTeam;
  sandboxManifest?: CompiledSandbox["manifest"];
}

export interface StoredTeam {
  id: string;
  name: string;
  format: string;
  packed: string;
  exported: string;
  teamJson: PokemonSet[];
  sourcePath: string | null;
  notes: string | null;
  tags: string[];
  sandboxSource: SandboxTeam | null;
  sandboxManifest: CompiledSandbox["manifest"] | null;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

interface TeamDatabaseFile {
  version: 1;
  teams: StoredTeam[];
}

export function defaultTeamDbPath(): string {
  return path.resolve("data", "teams.json");
}

export async function openTeamDatabase(dbPath = defaultTeamDbPath()): Promise<TeamDatabase> {
  const resolved = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolved), {recursive: true});
  if (!fs.existsSync(resolved)) {
    writeDatabaseFile(resolved, {version: 1, teams: []});
  }
  return {path: resolved};
}

export async function closeTeamDatabase(_db: TeamDatabase): Promise<void> {
  return Promise.resolve();
}

export async function saveTeam(db: TeamDatabase, input: SaveTeamInput): Promise<StoredTeam> {
  const database = readDatabaseFile(db.path);
  const exported = Teams.export(input.sets);
  const packed = Teams.pack(input.sets);
  const contentHash = hashContent({format: input.format, packed, sandboxSource: input.sandboxSource ?? null});
  const id = input.id ?? slugWithHash(input.name, contentHash);
  const now = new Date().toISOString();
  const existing = database.teams.find(team => team.id === id);
  const saved: StoredTeam = {
    id,
    name: input.name,
    format: input.format,
    packed,
    exported,
    teamJson: input.sets,
    sourcePath: input.sourcePath ?? null,
    notes: input.notes ?? null,
    tags: input.tags ?? [],
    sandboxSource: input.sandboxSource ?? null,
    sandboxManifest: input.sandboxManifest ?? null,
    contentHash,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  database.teams = [
    saved,
    ...database.teams.filter(team => team.id !== id),
  ];
  writeDatabaseFile(db.path, database);
  return saved;
}

export async function listTeams(db: TeamDatabase): Promise<StoredTeam[]> {
  return readDatabaseFile(db.path).teams
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name));
}

export async function getTeam(db: TeamDatabase, id: string): Promise<StoredTeam | undefined> {
  return readDatabaseFile(db.path).teams.find(team => team.id === id);
}

function readDatabaseFile(dbPath: string): TeamDatabaseFile {
  const parsed = JSON.parse(fs.readFileSync(dbPath, "utf8")) as Partial<TeamDatabaseFile>;
  if (parsed.version !== 1 || !Array.isArray(parsed.teams)) {
    throw new Error(`Unsupported team database format: ${dbPath}`);
  }
  return {
    version: 1,
    teams: (parsed.teams as StoredTeam[]).map(team => ({
      ...team,
      sandboxSource: team.sandboxSource ?? null,
      sandboxManifest: team.sandboxManifest ?? null,
    })),
  };
}

function writeDatabaseFile(dbPath: string, database: TeamDatabaseFile): void {
  const tempPath = `${dbPath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(database, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, dbPath);
}

function hashContent(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function slugWithHash(name: string, contentHash: string): string {
  const slug = name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "team"}-${contentHash.slice(0, 8)}`;
}
