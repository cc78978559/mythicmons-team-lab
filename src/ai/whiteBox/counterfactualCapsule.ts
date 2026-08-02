import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {buildLineupBattleCausalSignature} from "./battleCausalSignature";

export function compactLineupCounterfactual(rootDirectory: string): {archive: string; beforeBytes: number; afterBytes: number; removedBytes: number; causalSummary: ReturnType<typeof buildLineupBattleCausalSignature>["summary"]} {
  const root = path.resolve(rootDirectory), summaryFile = path.join(root, "counterfactual-summary.json");
  const summary = read<any>(summaryFile), seasonName = `season-${String(summary.season).padStart(2, "0")}`;
  const control = path.join(root, "incumbent"), experiment = path.join(root, "whitebox");
  for (const branch of [control, experiment]) if (!fs.existsSync(path.join(branch, "dynasty-state.json"))) throw new Error(`Missing counterfactual branch: ${branch}`);
  const beforeBytes = directorySize(root);
  const controlSeasonFile = path.join(control, seasonName, "season.json"), experimentSeasonFile = path.join(experiment, seasonName, "season.json");
  const experimentLedger = read<any>(path.join(experiment, seasonName, "decision-ledger.json"));
  const interventionRecords = (experimentLedger.records ?? []).filter((record: any) =>
    record.context?.whiteBoxLineupExperiment?.trace?.decisionId === summary.decisionId
    || record.context?.programDecisionExperiment?.decisionId === summary.decisionId);
  if (interventionRecords.length !== 1) throw new Error(`Expected one lineup intervention record, found ${interventionRecords.length}`);
  const controlBattleRoot = summary.controlBattleSource && !fs.existsSync(path.join(control, seasonName, "battles")) ? path.resolve(summary.controlBattleSource) : control;
  const battleCausalSignature = buildLineupBattleCausalSignature(controlBattleRoot, experiment, summary.season, summary.decisionId, summary.managerId);
  const capsule = {
    schemaVersion: 1,
    summary,
    hashes: {
      sourceState: hash(path.join(summary.source, "dynasty-state.json")),
      controlState: hash(path.join(control, "dynasty-state.json")),
      experimentState: hash(path.join(experiment, "dynasty-state.json")),
      controlSeason: hash(controlSeasonFile),
      experimentSeason: hash(experimentSeasonFile),
    },
    controlSeason: read<any>(controlSeasonFile),
    experimentSeason: read<any>(experimentSeasonFile),
    interventionRecord: interventionRecords[0],
    battleCausalSignature,
  };
  const archive = path.join(root, "counterfactual-evidence.json.gz"), bytes = zlib.gzipSync(Buffer.from(`${JSON.stringify(capsule)}\n`), {level: 9});
  fs.writeFileSync(archive, bytes);
  const verified = JSON.parse(zlib.gunzipSync(fs.readFileSync(archive)).toString("utf8"));
  if (verified.schemaVersion !== 1 || verified.summary.decisionId !== summary.decisionId || verified.hashes.controlSeason !== capsule.hashes.controlSeason) throw new Error("Counterfactual evidence capsule verification failed");
  for (const branch of [control, experiment]) {
    if (!branch.startsWith(`${root}${path.sep}`)) throw new Error(`Unsafe counterfactual branch: ${branch}`);
    fs.rmSync(branch, {recursive: true, force: true});
  }
  fs.writeFileSync(path.join(root, "battle-causal-signature.json"), `${JSON.stringify(battleCausalSignature, null, 2)}\n`);
  let afterBytes = directorySize(root), retention = {archive, beforeBytes, afterBytes, removedBytes: beforeBytes - afterBytes, causalSummary: battleCausalSignature.summary};
  fs.writeFileSync(path.join(root, "retention.json"), `${JSON.stringify(retention, null, 2)}\n`);
  afterBytes = directorySize(root); retention = {...retention, afterBytes, removedBytes: beforeBytes - afterBytes};
  fs.writeFileSync(path.join(root, "retention.json"), `${JSON.stringify(retention, null, 2)}\n`);
  return retention;
}

function hash(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function read<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function directorySize(directory: string): number { let total = 0; for (const entry of fs.readdirSync(directory, {withFileTypes: true})) { const target = path.join(directory, entry.name); total += entry.isDirectory() ? directorySize(target) : fs.statSync(target).size; } return total; }
