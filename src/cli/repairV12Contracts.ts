import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {reconcileRetainedContractOwners, repairDuplicateRetainedContracts, type RepairableState} from "../draft/contractStateRepair";

const outArg = process.argv.indexOf("--out");
const root = path.resolve(outArg >= 0 ? process.argv[outArg + 1] : process.env.V12_OUT || "output/draft-league-v12");
const statePath = path.join(root, "dynasty-state.json");
const source = fs.readFileSync(statePath);
const state = JSON.parse(source.toString("utf8")) as RepairableState & {completedSeason?: number};
const removals = repairDuplicateRetainedContracts(state);
const ownerChanges = reconcileRetainedContractOwners(state);
if (!removals.length && !ownerChanges.length) {
  console.log(JSON.stringify({changed: false, statePath, removals: [], ownerChanges: []}));
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(root, `dynasty-state.before-contract-repair-${stamp}.json`);
const reportPath = path.join(root, `contract-repair-${stamp}.json`);
const tempPath = `${statePath}.repairing`;
fs.writeFileSync(backupPath, source);
fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
fs.renameSync(tempPath, statePath);
const report = {schemaVersion: 1, repairedAt: new Date().toISOString(), completedSeason: state.completedSeason, sourceSha256: crypto.createHash("sha256").update(source).digest("hex"), statePath, backupPath, removals, ownerChanges};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({changed: true, reportPath, backupPath, removals, ownerChanges}));
