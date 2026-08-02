import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {syncManagerMechanismLedgers} from "../ai/managerMechanismLedgerSync";
import type {ManagerMechanismLedger} from "../ai/managerMechanismLedger";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-manager-mechanisms-"));
try {
  const out = path.join(root, "ledgers"), firstStudy = path.join(root, "study-a"), secondStudy = path.join(root, "study-b");
  writeStudy(firstStudy, "lineup-effective-speed-v1", [{id: "case-a", managerId: "manager-01", season: 3, status: "complete", sourceOutcome: "loss", scoreDelta: .2, result: {direction: "better", causal: {games: 2, actionDivergences: 2}}}]);
  const first = syncManagerMechanismLedgers({studies: [firstStudy], out, managerIds: ["manager-01", "manager-02", "manager-03"]});
  assert.equal(first.imported, 1); assert.equal(first.unchanged, 0); assert.equal(first.managers, 3);
  const repeated = syncManagerMechanismLedgers({studies: [firstStudy], out, managerIds: ["manager-01", "manager-02", "manager-03"]});
  assert.equal(repeated.imported, 0); assert.equal(repeated.unchanged, 1);

  writeStudy(secondStudy, "lineup-safe-two-way-speed-v1", [{id: "case-b", managerId: "manager-02", season: 4, status: "complete", sourceOutcome: "win", scoreDelta: -.1, result: {direction: "neutral", causal: {games: 2, actionDivergences: 2}}}]);
  const appended = syncManagerMechanismLedgers({studies: [firstStudy, secondStudy], out, managerIds: ["manager-01", "manager-02", "manager-03"]});
  assert.equal(appended.imported, 1); assert.equal(appended.unchanged, 1); assert.deepEqual(appended.mechanisms, ["lineup-effective-speed-v1", "lineup-safe-two-way-speed-v1"]);
  const ledgers = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(out, "manager-mechanism-ledgers.json.gz"))).toString("utf8")) as ManagerMechanismLedger[];
  assert.equal(ledgers.find(ledger => ledger.managerId === "manager-01")?.revision, 1);
  assert.equal(ledgers.find(ledger => ledger.managerId === "manager-02")?.revision, 1);
  assert.equal(ledgers.find(ledger => ledger.managerId === "manager-03")?.revision, 0);

  writeStudy(firstStudy, "lineup-effective-speed-v1", [{id: "case-a", managerId: "manager-01", season: 3, status: "complete", sourceOutcome: "loss", scoreDelta: .2, result: {direction: "worse", causal: {games: 2, actionDivergences: 2}}}]);
  assert.throws(() => syncManagerMechanismLedgers({studies: [firstStudy], out}), /Previously imported causal evidence changed/);
  assert.equal(fs.existsSync(path.join(out, ".manager-mechanism-ledgers.lock")), false);
  console.log("Manager mechanism incremental sync smoke passed: append, dedupe, empty managers, tamper rejection, and lock cleanup");
} finally { fs.rmSync(root, {recursive: true, force: true}); }

function writeStudy(directory: string, hypothesisId: string, items: unknown[]): void {
  fs.mkdirSync(directory, {recursive: true});
  fs.writeFileSync(path.join(directory, "causal-manifest.json"), `${JSON.stringify({schemaVersion: 1, items})}\n`, "utf8");
  fs.writeFileSync(path.join(directory, "causal-summary.json"), `${JSON.stringify({schemaVersion: 1, hypothesisId, conclusion: "no-clear-benefit"})}\n`, "utf8");
}
