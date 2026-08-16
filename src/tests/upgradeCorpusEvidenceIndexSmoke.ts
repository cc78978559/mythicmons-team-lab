import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {BENCHMARK_FAMILY_VERSION, benchmarkPairClusterId} from "../draft/benchmarkFamilies";
import {loadCorpusEvidenceAuthority} from "../draft/corpusEvidenceAuthority";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-corpus-upgrade-"));
const game = path.join(root, "battles", "case-1", "game-0001");
const cli = path.resolve("src/cli/upgradeCorpusEvidenceIndex.ts");

try {
  const familyIds: [string, string] = ["family-a", "family-b"];
  write(path.join(game, "benchmark-evidence.json"), {
    schemaVersion: 1,
    version: BENCHMARK_FAMILY_VERSION,
    registrySha256: "a".repeat(64),
    scheduleSha256: "b".repeat(64),
    pairClusterId: benchmarkPairClusterId("train", familyIds),
    split: "train",
    familyIds,
    environment: "modern-standard",
    variants: ["base", "configuration-b"],
    sha256: "legacy",
  });
  write(path.join(game, "replay-input.json"), {seed: [1, 2, 3, 4]});
  write(path.join(game, "ai-decisions.json"), []);
  write(path.join(game, "end.json"), {winner: null});
  write(path.join(root, "corpus-manifest.json"), {
    schemaVersion: 1,
    corpusVersion: "position-value-family-corpus-v2",
    index: {},
    familyDesign: {registrySha256: "a".repeat(64), scheduleSha256: "b".repeat(64)},
    settings: {jobs: 1},
    results: {complete: 1, failures: 0},
    sha256: "legacy",
  });

  const rejected = run("formal-holdout-only");
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /cannot be upgraded safely/);

  const upgraded = run("research");
  assert.equal(upgraded.status, 0, upgraded.stderr);
  const result = JSON.parse(upgraded.stdout);
  assert.equal(result.upgraded, true);
  assert.equal(result.cases, 1);

  const authority = loadCorpusEvidenceAuthority(root, "research");
  assert.equal(authority.cases.size, 1);
  assert.equal(authority.clusters.size, 1);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "corpus-manifest.json"), "utf8"));
  assert.equal(manifest.corpusVersion, "position-value-family-corpus-v3-case-index");

  write(path.join(game, "end.json"), {winner: "tampered"});
  assert.throws(() => loadCorpusEvidenceAuthority(root, "research"), /drifted/);
  console.log("Corpus evidence index upgrade smoke passed: authority boundary, signed rebuild, and tamper rejection");
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}

function run(authority: "research" | "formal-holdout-only"): {status: number | null; stdout: string; stderr: string} {
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), cli, "--root", root, "--authority", authority], {cwd: process.cwd(), encoding: "utf8"});
  return {status: result.status, stdout: String(result.stdout), stderr: String(result.stderr)};
}

function write(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
