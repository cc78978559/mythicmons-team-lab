import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {persistDynastyState} from "../draft/dynastyStateStore";
import {auditAndGcDynastyStorage} from "../draft/dynastyStorageMaintenance";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-dynasty-gc-"));
try {
  const stateFile = path.join(root, "dynasty-state.json"), now = new Date("2026-08-09T00:00:00.000Z");
  persistDynastyState(stateFile, {completedSeason: 1, decisionRecords: [{id: "kept"}], evolutionArchive: [], mechanismLedgers: []});
  const orphan = path.join(root, ".dynasty-state", "orphan.json.gz"); fs.writeFileSync(orphan, "orphan"); fs.utimesSync(orphan, new Date("2026-01-01"), new Date("2026-01-01"));
  const dry = auditAndGcDynastyStorage(root, {budgetBytes: 0, graceDays: 1, now});
  assert.equal(dry.issues.some(issue => issue.severity === "error"), false); assert(dry.removable.includes(".dynasty-state/orphan.json.gz")); assert(fs.existsSync(orphan));
  const applied = auditAndGcDynastyStorage(root, {budgetBytes: 0, graceDays: 1, now, apply: true});
  assert.equal(applied.removed.length, 1); assert.equal(fs.existsSync(orphan), false); assert.equal(applied.entries.filter(entry => entry.references > 0).every(entry => fs.existsSync(path.join(root, entry.file))), true);
  console.log("dynasty storage maintenance smoke passed");
} finally { fs.rmSync(root, {recursive: true, force: true}); }
