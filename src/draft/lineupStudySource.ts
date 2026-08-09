import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface LineupStudySourceIdentity {
  officialStateSha256: string;
  finalSeason: number;
  runtimeInputsSha256: string;
}

export function lineupStudySourceIdentity(project: string, officialStateFile: string, finalSeason: number): LineupStudySourceIdentity {
  return {officialStateSha256: fileHash(officialStateFile), finalSeason, runtimeInputsSha256: lineupRuntimeInputsHash(project)};
}

export function lineupStudySourceKey(identity: LineupStudySourceIdentity): string {
  return crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

export function lineupStudySourceEvidence(source: string, firstSeason: number, finalSeason: number): Record<string, string> {
  const files = ["dynasty-state.json"];
  for (let season = firstSeason; season <= finalSeason; season++) files.push(`season-${String(season).padStart(2, "0")}/season.json`, `season-${String(season).padStart(2, "0")}/decision-ledger.json`);
  return Object.fromEntries(files.map(relative => {
    const file = path.join(source, relative);
    if (!fs.existsSync(file)) throw new Error(`Lineup study source evidence is missing: ${relative}`);
    return [relative, fileHash(file)];
  }));
}

export function lineupRuntimeInputsHash(project: string): string {
  const src = path.join(project, "src");
  const operationalOnly = new Set(["draft/runLock.ts", "draft/sourceCacheMaintenance.ts", "draft/storageIndex.ts", "draft/lineupStudySource.ts"]);
  const inputs = [
    ...walk(src).filter(file => {
      const relative = path.relative(src, file).replaceAll("\\", "/");
      if (!file.endsWith(".ts") || relative.startsWith("tests/")) return false;
      if (operationalOnly.has(relative)) return false;
      return !relative.startsWith("cli/") || relative === "cli/draftLeagueV12.ts";
    }),
    ...walk(path.join(project, "benchmarks", "gen9expanded")),
    ...["package.json", "package-lock.json", "tsconfig.json"].map(file => path.join(project, file)).filter(file => fs.existsSync(file)),
  ].sort();
  const digest = crypto.createHash("sha256");
  for (const file of inputs) {
    const content = fs.readFileSync(file);
    const normalized = /\.(?:ts|json)$/i.test(file) ? Buffer.from(content.toString("utf8").replace(/\r\n/g, "\n"), "utf8") : content;
    digest.update(path.relative(project, file).replaceAll("\\", "/")).update("\0").update(normalized).update("\0");
  }
  return digest.digest("hex");
}

function walk(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  const result: string[] = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(file));
    else if (entry.isFile()) result.push(file);
  }
  return result;
}

function fileHash(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
