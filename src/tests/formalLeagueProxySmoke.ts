import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";

fs.mkdirSync(path.resolve("output"), {recursive: true});
const root = fs.mkdtempSync(path.join(path.resolve("output"), "formal-league-proxy-smoke-"));
try {
  const built = invoke("build", ["--force"]);
  assert.equal(built.healthy, true, JSON.stringify(built));
  assert.equal(built.managers, 30);
  assert.equal(built.independentRosters, 30);
  assert.equal(built.authority, "validation-proxy-only-no-activation");

  const doctor = invoke("doctor");
  assert.equal(doctor.healthy, true);

  const manifest = path.join(root, "season-01", "formal-environment-manifest.json");
  const value = JSON.parse(fs.readFileSync(manifest, "utf8"));
  value.managers = 29;
  fs.writeFileSync(manifest, `${JSON.stringify(value)}\n`);
  const damaged = invoke("doctor", [], true);
  assert.equal(damaged.healthy, false);
  console.log("Formal league proxy smoke passed: 30 independent rosters, signed authority, deterministic build, and tamper detection");
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}

function invoke(command: string, extra: string[] = [], allowFailure = false): any {
  const result = spawnSync(
    process.execPath,
    [require.resolve("tsx/cli"), path.resolve("src/cli/formalLeagueProxy.ts"), command, "--out", root, ...extra],
    {cwd: process.cwd(), encoding: "utf8"},
  );
  if (result.status !== 0 && !allowFailure) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
