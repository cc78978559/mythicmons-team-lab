import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {FORMAL_CANARY_ADAPTER_PROTOCOL} from "../ai/formalCanaryControl";
import {sha256} from "../showdown/evidenceEpoch";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mythic-formal-canary-e2e-")), formal = path.join(root, "formal"), out = path.join(root, "canary"), adapter = path.resolve(__dirname, "../ai/formalBattleCanaryAdapter.ts"), cli = path.resolve(__dirname, "../cli/formalCanaryControl.ts");
try {
  fs.mkdirSync(formal, {recursive: true});
  const rule = {id: "rule-live", domain: "battle", target: "switch", effect: -.1, predicates: [{feature: "positionValue", operator: "lt", threshold: 0}], support: 20, uncertainty: .1, authority: "local-value-observational", evidenceIds: ["e1"]};
  const domain = {id: "battle-live", mechanismKey: "switch__better__positionValue-lt", target: "switch", expectedDirection: "better", adapterProtocol: FORMAL_CANARY_ADAPTER_PROTOCOL, hypotheses: [{managerId: "manager-01", rule}]};
  const freezeCore = {schemaVersion: 1, domains: [domain]}, freeze = {...freezeCore, sha256: sha256(freezeCore)}, summaryCore = {schemaVersion: 1, freezeSha256: freeze.sha256, automaticActivationAllowed: false, limitedCanaryEligibleDomains: [domain.id]}, summary = {...summaryCore, sha256: sha256(summaryCore)};
  fs.writeFileSync(path.join(formal, "freeze.json"), JSON.stringify(freeze)); fs.writeFileSync(path.join(formal, "summary.json"), JSON.stringify(summary));
  run(["register-adapter", "--formal-validation", formal, "--out", out, "--id", FORMAL_CANARY_ADAPTER_PROTOCOL, "--implementation", adapter, "--targets", "switch", "--reviewed"]);
  const planned = run(["plan", "--formal-validation", formal, "--out", out]); assert.equal(planned.status, "execution-ready"); assert.equal(planned.domains.length, 1);
  const doctor = run(["doctor", "--formal-validation", formal, "--out", out]); assert.equal(doctor.healthy, true); assert.equal(doctor.status, "execution-ready");
  fs.appendFileSync(path.join(formal, "summary.json"), "\n");
  const stillHealthy = run(["doctor", "--formal-validation", formal, "--out", out]); assert.equal(stillHealthy.healthy, true, "Canonical signatures should ignore harmless file whitespace");
  console.log("formal canary CLI E2E passed");
} finally { fs.rmSync(root, {recursive: true, force: true}); }

function run(arguments_: string[]): any {
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), cli, ...arguments_], {cwd: process.cwd(), encoding: "utf8", maxBuffer: 8 * 1024 * 1024});
  assert.equal(result.status, 0, result.stderr || result.stdout); return JSON.parse(result.stdout);
}
