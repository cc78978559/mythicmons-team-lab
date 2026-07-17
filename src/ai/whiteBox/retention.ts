import fs from "node:fs";
import path from "node:path";

export const WHITE_BOX_RETENTION_VERSION = "white-box-retention-v1";

export interface WhiteBoxRetentionTrace {
  version: typeof WHITE_BOX_RETENTION_VERSION;
  policy: "audit-summary";
  root: string;
  beforeBytes: number;
  afterBytes: number;
  removedBytes: number;
  removedPaths: string[];
  retainedPaths: string[];
}

export function compactWhiteBoxRun(rootDirectory: string): WhiteBoxRetentionTrace {
  const root = path.resolve(rootDirectory);
  if (!fs.existsSync(path.join(root, "dynasty-state.json"))) throw new Error(`Refusing to compact run without dynasty-state.json: ${root}`);
  const beforeBytes = directorySize(root);
  const targets = ["career-decisions", "careers", "config-snapshots"]
    .concat(fs.readdirSync(root, {withFileTypes: true}).filter(entry => entry.isDirectory() && /^season-\d+$/.test(entry.name)).flatMap(entry => [`${entry.name}/battles`, `${entry.name}/rosters`]));
  const removedPaths: string[] = [];
  for (const relative of targets) {
    const target = path.resolve(root, relative);
    if (target === root || !target.startsWith(`${root}${path.sep}`)) throw new Error(`Unsafe retention target: ${target}`);
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, {recursive: true, force: true});
    removedPaths.push(relative.replaceAll("\\", "/"));
  }
  const afterBytes = directorySize(root);
  return {version: WHITE_BOX_RETENTION_VERSION, policy: "audit-summary", root, beforeBytes, afterBytes, removedBytes: beforeBytes - afterBytes, removedPaths, retainedPaths: ["dynasty-state.json", "season-*/season.json", "season-*/decision-ledger.json"]};
}

export const compactIneligibleWhiteBoxRun = compactWhiteBoxRun;

function directorySize(directory: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const target = path.join(directory, entry.name);
    total += entry.isDirectory() ? directorySize(target) : fs.statSync(target).size;
  }
  return total;
}
