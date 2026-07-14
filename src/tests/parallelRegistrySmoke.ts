import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {compileSandboxTeam} from "../sandbox/compiler";
import type {SandboxTeam} from "../sandbox/types";
import {createRegistrySnapshot, loadRegistrySnapshot, verifyRegistrySnapshot} from "../draft/registrySnapshot";
import {acquireRunLock} from "../draft/runLock";

const root = process.cwd();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-registry-parallel-"));
try {
  const source = path.join(temporary, "source"), snapshots = path.join(temporary, "snapshots");
  fs.cpSync(path.join(root, "data", "draft"), source, {recursive: true});
  const first = createRegistrySnapshot(source, snapshots, "parallel-a");
  assert.equal(first.memberCount, 40);
  verifyRegistrySnapshot(first);

  const changedFile = path.join(source, "g1-six-team.json");
  const changed = JSON.parse(fs.readFileSync(changedFile, "utf8"));
  fs.writeFileSync(changedFile, `${JSON.stringify(changed)}\n`, "utf8");
  const second = createRegistrySnapshot(source, snapshots, "parallel-b");
  assert.notEqual(second.hash, first.hash);
  assert.notEqual(second.namespace, first.namespace);
  verifyRegistrySnapshot(first);
  assert.equal(loadRegistrySnapshot(first.directory).hash, first.hash);

  const team = JSON.parse(fs.readFileSync(path.join(first.directory, "g1-six-team.json"), "utf8")) as SandboxTeam;
  const compiledA = compileSandboxTeam(team, {namespace: first.namespace});
  const compiledB = compileSandboxTeam(team, {namespace: second.namespace});
  assert.notEqual(compiledA.modId, compiledB.modId);
  assert.notEqual(compiledA.formatId, compiledB.formatId);
  assert.match(compiledA.files["custom-formats.js"], new RegExp(`mod: ["']${compiledA.modId}["']`));

  const league = path.join(temporary, "league");
  const lock = acquireRunLock(league, {registryHash: first.hash});
  assert.throws(() => acquireRunLock(league), /already locked/);
  lock.release();
  assert.doesNotThrow(() => { const next = acquireRunLock(league); next.release(); });

  const duplicateSource = path.join(temporary, "duplicate");
  fs.cpSync(source, duplicateSource, {recursive: true});
  const g2Path = path.join(duplicateSource, "g2-six-team.json"), g2 = JSON.parse(fs.readFileSync(g2Path, "utf8"));
  g2.members[0].id = changed.members[0].id;
  fs.writeFileSync(g2Path, `${JSON.stringify(g2, null, 2)}\n`, "utf8");
  assert.throws(() => createRegistrySnapshot(duplicateSource, snapshots), /Duplicate or empty registry id/);
  console.log("Parallel registry snapshot and run-lock smoke test passed");
} finally {
  fs.rmSync(temporary, {recursive: true, force: true});
}
