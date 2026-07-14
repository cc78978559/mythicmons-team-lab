import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {Teams} from "pokemon-showdown";
import {compileSandboxTeam} from "../sandbox/compiler";
import {installCompiledSandbox, writeCompiledSandbox} from "../sandbox/installer";
import {runBattle} from "../showdown/battle";
import {loadTeam, writeTeam} from "../showdown/team";
import type {SandboxTeam} from "../sandbox/types";

async function main() {
  const sandbox = JSON.parse(fs.readFileSync("examples/sandbox-overlord.json", "utf8")) as SandboxTeam;
  const compiled = compileSandboxTeam(sandbox);
  const outDir = path.join("output", "sandbox-overlord");
  const smokeDir = path.join("output", "sandbox-smoke");
  const restore = snapshotInstalledSandbox(compiled);

  try {
    fs.mkdirSync(outDir, {recursive: true});
    writeCompiledSandbox(compiled, outDir);
    writeTeam(compiled.team, path.join(outDir, "team.export.txt"), "export");
    writeTeam(compiled.team, path.join(outDir, "team.json"), "json");
    writeTeam(compiled.team, path.join(outDir, "team.packed.txt"), "packed");
    const installed = installCompiledSandbox(compiled, process.cwd(), {backup: false});
    fs.writeFileSync(path.join(outDir, "installed-files.json"), `${JSON.stringify(installed, null, 2)}\n`, "utf8");

    const teamB = loadTeam("examples/teamB.txt");
    const result = await runBattle({
      format: compiled.formatId,
      teamA: Teams.pack(compiled.team),
      teamB: teamB.packed,
      seed: "123",
      gameIndex: 0,
      outDir: smokeDir,
      maxTurns: 500,
      ai: "basic",
    });
    assert.equal(result.errors.length, 0);
    console.log(`Sandbox smoke passed: ${result.winner ?? "draw"} in ${result.turns} turns`);
  } finally {
    restore();
  }
}

function snapshotInstalledSandbox(compiled: ReturnType<typeof compileSandboxTeam>): () => void {
  const packageRoot = path.join(process.cwd(), "node_modules", "pokemon-showdown", "dist");
  const paths = [
    path.join(packageRoot, "config", "custom-formats.js"),
    ...Object.keys(compiled.files)
      .filter(file => file !== "custom-formats.js")
      .map(file => path.join(packageRoot, "data", "mods", compiled.modId, file)),
  ];
  const snapshot = paths.map(targetPath => ({
    targetPath,
    existed: fs.existsSync(targetPath),
    contents: fs.existsSync(targetPath) ? fs.readFileSync(targetPath) : null,
  }));

  return () => {
    for (const entry of snapshot) {
      if (entry.existed && entry.contents) {
        fs.mkdirSync(path.dirname(entry.targetPath), {recursive: true});
        fs.writeFileSync(entry.targetPath, entry.contents);
      } else if (!entry.existed && fs.existsSync(entry.targetPath)) {
        fs.rmSync(entry.targetPath);
      }
    }
  };
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
