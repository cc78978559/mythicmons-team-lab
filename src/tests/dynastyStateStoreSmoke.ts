import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {loadDynastyState, loadDynastyStateCore, persistDynastyState} from "../draft/dynastyStateStore";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-dynasty-state-"));
try {
  const file = path.join(root, "dynasty-state.json");
  const legacy = {version: 12, seed: "legacy", completedSeason: 2, managers: [{id: "m1"}], decisionRecords: [{id: "d1", context: {large: "x".repeat(20_000)}}], evolutionArchive: [{id: "e1", payload: {memory: "y".repeat(20_000)}}]};
  fs.writeFileSync(file, `${JSON.stringify(legacy)}\n`, "utf8");
  assert.deepEqual(loadDynastyState(file), legacy, "legacy inline states must remain readable");

  const prepared = persistDynastyState(file, legacy);
  const core = loadDynastyStateCore<any>(file);
  assert.equal(core.decisionRecords, undefined);
  assert.equal(core.evolutionArchive, undefined);
  assert.equal(core.stateStorage.schemaVersion, 1);
  assert.equal(core.stateStorage.decisionRecords.items, 1);
  assert.equal(core.stateStorage.evolutionArchive.items, 1);
  assert(prepared.bytes.length < Buffer.byteLength(JSON.stringify(legacy)) / 4, "main state should exclude large histories");
  assert.deepEqual(loadDynastyState(file), {...legacy, stateStorage: core.stateStorage});

  const archive = path.resolve(root, core.stateStorage.decisionRecords.file);
  const original = fs.readFileSync(archive);
  fs.writeFileSync(archive, Buffer.concat([original, Buffer.from("tamper")]));
  assert.throws(() => loadDynastyState(file), /archive hash mismatch/);
  fs.writeFileSync(archive, original);
  assert.equal((loadDynastyState<any>(file).decisionRecords as unknown[]).length, 1);

  const mixed = loadDynastyState<any>(file);
  mixed.decisionRecords.push({id: "unbound"});
  fs.writeFileSync(file, `${JSON.stringify(mixed)}\n`, "utf8");
  assert.throws(() => loadDynastyState(file), /does not match its archive reference/);

  fs.writeFileSync(file, prepared.bytes);
  const coreAgain = loadDynastyStateCore<any>(file);
  coreAgain.stateStorage.decisionRecords.file = "../escape.json.gz";
  fs.writeFileSync(file, `${JSON.stringify(coreAgain)}\n`, "utf8");
  assert.throws(() => loadDynastyState(file), /escaped its state root/);
  console.log("dynasty state store smoke passed");
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
