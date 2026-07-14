import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {toID} from "pokemon-showdown";
import {compileSandboxTeam} from "../sandbox/compiler";
import type {SandboxTeam} from "../sandbox/types";
import {DRAFT_GENERATIONS} from "./customRegistry";

export interface RegistrySnapshot {
  schemaVersion: 1;
  revision: string;
  hash: string;
  namespace: string;
  directory: string;
  files: Array<{name: string; hash: string; bytes: number}>;
  memberCount: number;
}

export function createRegistrySnapshot(sourceDirectory: string, snapshotRoot: string, revision?: string): RegistrySnapshot {
  const source = path.resolve(sourceDirectory);
  const stable = readStableRegistry(source);
  validateRegistry(stable.documents);
  const hash = registryHash(stable.files);
  const directory = path.join(path.resolve(snapshotRoot), hash);
  const manifest: RegistrySnapshot = {
    schemaVersion: 1,
    revision: revision?.trim() || hash.slice(0, 12),
    hash,
    namespace: hash.slice(0, 12),
    directory,
    files: stable.files.map(file => ({name: file.name, hash: sha256(file.contents), bytes: file.contents.length})),
    memberCount: stable.documents.reduce((sum, document) => sum + document.members.length, 0),
  };
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(path.dirname(directory), {recursive: true});
    const temporary = `${directory}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.mkdirSync(temporary, {recursive: false});
    try {
      for (const file of stable.files) fs.writeFileSync(path.join(temporary, file.name), file.contents);
      fs.writeFileSync(path.join(temporary, "registry-manifest.json"), `${JSON.stringify({...manifest, directory: "."}, null, 2)}\n`, "utf8");
      try { fs.renameSync(temporary, directory); } catch (error) {
        if (!fs.existsSync(directory)) throw error;
        fs.rmSync(temporary, {recursive: true, force: true});
      }
    } catch (error) {
      fs.rmSync(temporary, {recursive: true, force: true});
      throw error;
    }
  }
  verifyRegistrySnapshot(manifest);
  return manifest;
}

export function loadRegistrySnapshot(directory: string): RegistrySnapshot {
  const root = path.resolve(directory);
  const stored = JSON.parse(fs.readFileSync(path.join(root, "registry-manifest.json"), "utf8")) as RegistrySnapshot;
  const snapshot = {...stored, directory: root};
  verifyRegistrySnapshot(snapshot);
  return snapshot;
}

export function verifyRegistrySnapshot(snapshot: RegistrySnapshot): void {
  const files = snapshot.files.map(expected => {
    const file = path.join(snapshot.directory, expected.name);
    const contents = fs.readFileSync(file);
    if (contents.length !== expected.bytes || sha256(contents) !== expected.hash) throw new Error(`Registry snapshot file changed: ${expected.name}`);
    return {name: expected.name, contents};
  });
  if (registryHash(files) !== snapshot.hash) throw new Error("Registry snapshot hash does not match its manifest");
}

export function validateRegistryDirectory(directory: string): RegistrySnapshot {
  const temporary = fs.mkdtempSync(path.join(path.resolve(directory, ".."), ".registry-validation-"));
  try { return createRegistrySnapshot(directory, temporary, "validation"); }
  finally { fs.rmSync(temporary, {recursive: true, force: true}); }
}

function readStableRegistry(directory: string): {files: Array<{name: string; contents: Buffer}>; documents: SandboxTeam[]} {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const first = readRegistryFiles(directory), second = readRegistryFiles(directory);
    if (registryHash(first) === registryHash(second)) return {files: second, documents: second.map(file => JSON.parse(file.contents.toString("utf8")) as SandboxTeam)};
  }
  throw new Error("Registry changed repeatedly while being snapshotted; publish it atomically and retry");
}

function readRegistryFiles(directory: string): Array<{name: string; contents: Buffer}> {
  return DRAFT_GENERATIONS.map(generation => {
    const name = `${generation}-six-team.json`, file = path.join(directory, name);
    if (!fs.existsSync(file)) throw new Error(`Registry source is missing ${name}`);
    return {name, contents: fs.readFileSync(file)};
  });
}

function validateRegistry(documents: SandboxTeam[]): void {
  const memberIds = new Set<string>(), effects = {move: new Set<string>(), ability: new Set<string>(), item: new Set<string>()};
  for (const document of documents) {
    for (const member of document.members) unique(memberIds, toID(member.id), `member ${member.id}`);
    for (const move of document.customMoves ?? []) unique(effects.move, toID(move.id), `custom move ${move.id}`);
    for (const ability of document.customAbilities ?? []) unique(effects.ability, toID(ability.id), `custom ability ${ability.id}`);
    for (const item of document.customItems ?? []) unique(effects.item, toID(item.id), `custom item ${item.id}`);
  }
  compileSandboxTeam({name: "Registry validation", members: documents.flatMap(value => value.members), customMoves: documents.flatMap(value => value.customMoves ?? []), customAbilities: documents.flatMap(value => value.customAbilities ?? []), customItems: documents.flatMap(value => value.customItems ?? [])});
}
function unique(values: Set<string>, id: string, label: string): void { if (!id || values.has(id)) throw new Error(`Duplicate or empty registry id: ${label}`); values.add(id); }
function registryHash(files: Array<{name: string; contents: Buffer}>): string { const hash = crypto.createHash("sha256"); for (const file of files) hash.update(file.name).update("\0").update(file.contents).update("\0"); return hash.digest("hex"); }
function sha256(contents: Buffer): string { return crypto.createHash("sha256").update(contents).digest("hex"); }
