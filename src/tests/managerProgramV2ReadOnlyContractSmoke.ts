import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "manager-v2-readonly-"));
const out = path.join(root, "missing-out"), dossiers = path.join(root, "missing-dossiers"), position = path.join(root, "missing-position"), corpus = path.join(root, "missing-corpus");

function snapshot(): string {
  const rows: Array<[string, number, number, string]> = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else { const stat = fs.statSync(file); rows.push([path.relative(root, file), stat.size, stat.mtimeMs, crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")]); }
    }
  };
  walk(root);
  return JSON.stringify(rows.sort((left, right) => left[0].localeCompare(right[0])));
}

function invoke(command?: "status" | "doctor"): {status: number | null; value: any} {
  const before = snapshot(), args = [path.join(process.cwd(), "src", "cli", "managerProgramV2.ts"), ...(command ? [command] : []), "--out", out, "--dossiers", dossiers, "--position-value", position, "--corpus", corpus];
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), ...args], {cwd: process.cwd(), encoding: "utf8"});
  assert.equal(snapshot(), before, `${command ?? "default"} modified its input directory`);
  assert.equal(result.signal, null);
  return {status: result.status, value: JSON.parse(result.stdout)};
}

try {
  for (const command of [undefined, "status"] as const) {
    const result = invoke(command);
    assert.equal(result.status, 0);
    assert.equal(result.value.available, false);
    assert.deepEqual(result.value.issueCounts, {});
  }
  const doctor = invoke("doctor");
  assert.equal(doctor.status, 2);
  assert.equal(doctor.value.healthy, false);
  assert.deepEqual(doctor.value.issueCounts, {"missing-artifacts": 1});
  assert.equal(doctor.value.issues[0].code, "missing-artifacts");
  console.log("Manager Program V2 read-only contract smoke passed");
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
