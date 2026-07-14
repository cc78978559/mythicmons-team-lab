import fs from "node:fs";
import path from "node:path";
import {Dex} from "pokemon-showdown";
import type {CompiledSandbox} from "./types";

const MYTHIC_FORMAT_NAME = "[Gen 9] MythicMons Sandbox";
const DATA_TABLE_EXPORTS: Record<string, string> = {
  "abilities.js": "Abilities",
  "items.js": "Items",
  "pokedex.js": "Pokedex",
  "moves.js": "Moves",
};

export function writeCompiledSandbox(compiled: CompiledSandbox, outDir: string): void {
  const modDir = path.join(outDir, "mod", compiled.modId);
  fs.mkdirSync(modDir, {recursive: true});
  for (const [file, contents] of Object.entries(compiled.files)) {
    if (file === "custom-formats.js") continue;
    fs.writeFileSync(path.join(modDir, file), contents, "utf8");
  }
  fs.mkdirSync(path.join(outDir, "config"), {recursive: true});
  fs.writeFileSync(path.join(outDir, "config", "custom-formats.js"), compiled.files["custom-formats.js"], "utf8");
  fs.writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(compiled.manifest, null, 2)}\n`, "utf8");
}

export interface InstallSandboxOptions {
  backup?: boolean;
  merge?: boolean;
  replaceConflicts?: boolean;
}

export function installCompiledSandbox(compiled: CompiledSandbox, projectRoot: string, options: InstallSandboxOptions = {}): string[] {
  const shouldBackup = options.backup ?? true;
  const shouldMerge = options.merge ?? true;
  const replaceConflicts = options.replaceConflicts ?? false;
  const packageRoot = path.join(projectRoot, "node_modules", "pokemon-showdown", "dist");
  const modDir = path.join(packageRoot, "data", "mods", compiled.modId);
  const configDir = path.join(packageRoot, "config");
  const written: string[] = [];

  const release = acquireInstallLock(packageRoot);
  try {
    if (shouldBackup) backupModDirectory(modDir);
    fs.mkdirSync(modDir, {recursive: true});
    for (const [file, contents] of Object.entries(compiled.files)) {
      if (file === "custom-formats.js") continue;
      const target = path.join(modDir, file);
      const exportName = DATA_TABLE_EXPORTS[file];
      const installedContents = shouldMerge && exportName && fs.existsSync(target)
        ? mergeGeneratedTable(fs.readFileSync(target, "utf8"), contents, exportName, protectedCustomIds(file, compiled), replaceConflicts)
        : contents;
      atomicWrite(target, installedContents);
      written.push(target);
    }

    fs.mkdirSync(configDir, {recursive: true});
    const customFormatsPath = path.join(configDir, "custom-formats.js");
    if (shouldBackup) backupCustomFormats(customFormatsPath);
    atomicWrite(customFormatsPath, mergeCustomFormats(customFormatsPath, compiled.files["custom-formats.js"], compiled));
    written.push(customFormatsPath);
  } finally {
    release();
  }

  refreshShowdownCaches(packageRoot, compiled.modId);
  return written;
}

function refreshShowdownCaches(packageRoot: string, modId: string): void {
  const pathsToRefresh = [
    path.join(packageRoot, "config", "custom-formats.js"),
    path.join(packageRoot, "data", "mods", modId, "scripts.js"),
    path.join(packageRoot, "data", "mods", modId, "abilities.js"),
    path.join(packageRoot, "data", "mods", modId, "items.js"),
    path.join(packageRoot, "data", "mods", modId, "pokedex.js"),
    path.join(packageRoot, "data", "mods", modId, "moves.js"),
    path.join(packageRoot, "data", "mods", modId, "typechart.js"),
  ];
  for (const candidate of pathsToRefresh) {
    try {
      delete require.cache[require.resolve(candidate)];
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "MODULE_NOT_FOUND") throw error;
    }
  }

  const dex = Dex as unknown as {
    modsLoaded: boolean;
    dataCache: unknown;
    formats: {formatsListCache: unknown; rulesetCache?: Map<unknown, unknown>};
    dexes: Record<string, {
      dataCache: unknown;
      textCache?: unknown;
      abilities?: {abilityCache?: Map<unknown, unknown>; allCache?: unknown};
      items?: {itemCache?: Map<unknown, unknown>; allCache?: unknown};
      moves?: {moveCache?: Map<unknown, unknown>; allCache?: unknown};
      species?: {speciesCache?: Map<unknown, unknown>; allCache?: unknown};
      conditions?: {conditionCache?: Map<unknown, unknown>};
    }>;
  };

  dex.modsLoaded = false;
  dex.dataCache = null;
  dex.formats.formatsListCache = null;
  dex.formats.rulesetCache?.clear();
  const modDex = dex.dexes[modId];
  if (modDex) clearModdedDexCaches(modDex);
  Dex.includeMods();
}

function clearModdedDexCaches(dex: {
  dataCache: unknown;
  textCache?: unknown;
  abilities?: {abilityCache?: Map<unknown, unknown>; allCache?: unknown};
  items?: {itemCache?: Map<unknown, unknown>; allCache?: unknown};
  moves?: {moveCache?: Map<unknown, unknown>; allCache?: unknown};
  species?: {speciesCache?: Map<unknown, unknown>; allCache?: unknown};
  conditions?: {conditionCache?: Map<unknown, unknown>};
}): void {
  dex.dataCache = null;
  dex.textCache = null;
  dex.abilities?.abilityCache?.clear();
  if (dex.abilities) dex.abilities.allCache = null;
  dex.items?.itemCache?.clear();
  if (dex.items) dex.items.allCache = null;
  dex.moves?.moveCache?.clear();
  if (dex.moves) dex.moves.allCache = null;
  dex.species?.speciesCache?.clear();
  if (dex.species) dex.species.allCache = null;
  dex.conditions?.conditionCache?.clear();
}

function backupModDirectory(modDir: string): void {
  if (!fs.existsSync(modDir)) return;
  fs.cpSync(modDir, uniqueBackupPath(`${modDir}.before-mythicmons-${timestampForPath()}`), {recursive: true, errorOnExist: true});
}

function backupCustomFormats(customFormatsPath: string): void {
  if (!fs.existsSync(customFormatsPath)) return;
  const timestamp = timestampForPath();
  const backupPath = uniqueBackupPath(customFormatsPath.replace(/\.js$/, `.before-mythicmons-${timestamp}.js`));
  fs.copyFileSync(customFormatsPath, backupPath);
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function uniqueBackupPath(preferredPath: string): string {
  if (!fs.existsSync(preferredPath)) return preferredPath;
  let suffix = 2;
  while (fs.existsSync(`${preferredPath}-${suffix}`)) suffix += 1;
  return `${preferredPath}-${suffix}`;
}

function protectedCustomIds(file: string, compiled: CompiledSandbox): Set<string> {
  if (file === "abilities.js") return new Set(compiled.manifest.customAbilities);
  if (file === "items.js") return new Set(compiled.manifest.customItems);
  if (file === "moves.js") return new Set(compiled.manifest.customMoves);
  return new Set();
}

function mergeGeneratedTable(
  existingSource: string,
  incomingSource: string,
  exportName: string,
  protectedIds: Set<string>,
  replaceConflicts: boolean,
): string {
  const entries = extractGeneratedTable(existingSource, exportName);
  for (const [id, initializer] of extractGeneratedTable(incomingSource, exportName)) {
    const existing = entries.get(id);
    if (existing !== undefined && existing !== initializer && protectedIds.has(id) && !replaceConflicts) {
      throw new Error(`Custom sandbox ${exportName} id conflict: ${id}; use --replace to overwrite it explicitly`);
    }
    entries.set(id, initializer);
  }
  const body = [...entries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, initializer]) => `\t${id}: ${initializer},`)
    .join("\n");
  return `"use strict";\nexports.${exportName} = {\n${body}\n};\n`;
}

function extractGeneratedTable(source: string, exportName: string): Map<string, string> {
  const assignment = source.indexOf(`exports.${exportName}`);
  const objectStart = assignment < 0 ? -1 : source.indexOf("{", assignment);
  if (objectStart < 0) throw new Error(`Could not find exports.${exportName} object in generated sandbox data`);
  const objectEnd = matchingBrace(source, objectStart);
  const body = source.slice(objectStart + 1, objectEnd);
  const entries = new Map<string, string>();
  for (const rawProperty of splitTopLevel(body, ",")) {
    const property = rawProperty.trim();
    if (!property) continue;
    const colon = topLevelDelimiter(property, ":");
    if (colon < 0) throw new Error(`Unsupported property in generated ${exportName} table`);
    const id = property.slice(0, colon).trim().replace(/^['"]|['"]$/g, "");
    entries.set(id, property.slice(colon + 1).trim());
  }
  return entries;
}

function matchingBrace(source: string, start: number): number {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return index;
  }
  throw new Error("Unterminated generated sandbox object");
}

function splitTopLevel(source: string, delimiter: string): string[] {
  const parts: string[] = [];
  let start = 0;
  forEachTopLevelDelimiter(source, delimiter, index => {
    parts.push(source.slice(start, index));
    start = index + delimiter.length;
  });
  parts.push(source.slice(start));
  return parts;
}

function topLevelDelimiter(source: string, delimiter: string): number {
  let found = -1;
  forEachTopLevelDelimiter(source, delimiter, index => {
    if (found < 0) found = index;
  });
  return found;
}

function forEachTopLevelDelimiter(source: string, delimiter: string, visit: (index: number) => void): void {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[" || char === "(") depth += 1;
    else if (char === "}" || char === "]" || char === ")") depth -= 1;
    else if (depth === 0 && source.startsWith(delimiter, index)) visit(index);
  }
}

function mergeCustomFormats(customFormatsPath: string, mythicFormatsSource: string, compiled: CompiledSandbox): string {
  const existing = fs.existsSync(customFormatsPath)
    ? fs.readFileSync(customFormatsPath, "utf8")
    : `"use strict";\nexports.Formats = [];\n`;
  const withoutOldBlock = stripLegacyMythicOnly(removeMythicBlock(existing, compiled.modId).trimEnd());
  const block = mythicAppendBlock(mythicFormatsSource, compiled);

  return `${withoutOldBlock}\n\n${block}\n`;
}

function removeMythicBlock(source: string, modId: string): string {
  const pattern = new RegExp(`\\n?${escapeRegExp(`// mythicmons:${modId}:start`)}[\\s\\S]*?${escapeRegExp(`// mythicmons:${modId}:end`)}\\n?`, "g");
  const withoutCurrent = source.replace(pattern, "\n");
  if (modId !== "mythicmons") return withoutCurrent;
  return withoutCurrent.replace(/\n?\/\/ mythicmons:start[\s\S]*?\/\/ mythicmons:end\n?/g, "\n");
}

function stripLegacyMythicOnly(source: string): string {
  const loaded = tryLoadFormatsFromSource(source);
  if (!loaded) return source;
  if (loaded.length && loaded.every(format => format.name === MYTHIC_FORMAT_NAME)) {
    return `"use strict";\nexports.Formats = [];`;
  }
  return source;
}

function tryLoadFormatsFromSource(source: string): Array<{name?: unknown}> | null {
  const module = {exports: {}} as {exports: {Formats?: Array<{name?: unknown}>}};
  try {
    const fn = new Function("exports", "module", source);
    fn(module.exports, module);
    return Array.isArray(module.exports.Formats) ? module.exports.Formats : [];
  } catch {
    return null;
  }
}

function mythicAppendBlock(mythicFormatsSource: string, compiled: CompiledSandbox): string {
  const formatsArray = extractFormatsArray(mythicFormatsSource);
  return `// mythicmons:${compiled.modId}:start
exports.Formats = (exports.Formats || []).filter(format => format.name !== ${JSON.stringify(compiled.formatName)});
exports.Formats.push(...${formatsArray});
// mythicmons:${compiled.modId}:end`;
}

function atomicWrite(file: string, contents: string): void {
  const temporary = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  fs.writeFileSync(temporary, contents, "utf8");
  fs.renameSync(temporary, file);
}

function acquireInstallLock(packageRoot: string): () => void {
  fs.mkdirSync(packageRoot, {recursive: true});
  const lock = path.join(packageRoot, ".mythicmons-install.lock");
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      const descriptor = fs.openSync(lock, "wx");
      fs.writeFileSync(descriptor, `${process.pid}\n`, "utf8");
      return () => { fs.closeSync(descriptor); fs.rmSync(lock, {force: true}); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for sandbox install lock: ${lock}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

function extractFormatsArray(source: string): string {
  const assignment = source.match(/exports\.Formats\s*=\s*/);
  if (!assignment?.index) throw new Error("Generated custom-formats.js does not assign exports.Formats");
  const arrayStart = source.indexOf("[", assignment.index);
  const arrayEnd = source.lastIndexOf("];");
  if (arrayStart < 0 || arrayEnd < arrayStart) {
    throw new Error("Generated custom-formats.js does not contain a formats array");
  }
  return source.slice(arrayStart, arrayEnd + 1).trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
