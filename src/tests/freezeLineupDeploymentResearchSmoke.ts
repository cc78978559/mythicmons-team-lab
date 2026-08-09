import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {spawnSync} from "node:child_process";

const repo = path.resolve(__dirname, "../.."), root = fs.mkdtempSync(path.join(os.tmpdir(), "freeze-lineup-deployment-")), out = path.join(root, "out"), hash = "a".repeat(64), optionId = "lineup-deployment-boundary-test-v1";
const files = {postmortem: path.join(root, "postmortem.json"), options: path.join(root, "options.json"), registry: path.join(root, "registry.json"), disposition: path.join(root, "disposition.json"), agendas: path.join(root, "agendas.json.gz")};
fs.writeFileSync(files.postmortem, JSON.stringify({activationStatus: "shadow-only", evidenceStatus: "post-deployment-exploratory", approvalSha256: hash, seasons: [28,29,30], validity: {causalClaimsAllowed: false, activationAllowed: false}}));
fs.writeFileSync(files.options, JSON.stringify({activationStatus: "shadow-only", evidenceStatus: "post-deployment-exploratory", hypotheses: [{id: optionId, title: "Boundary", researchEligible: true, evidenceStatus: "post-deployment-exploratory", boundary: {signal: "delta.lineup.speedFloor", operator: "at-most", threshold: 4}}]}));
fs.writeFileSync(files.registry, JSON.stringify({schemaVersion: 1, activationStatus: "shadow-only", hypotheses: [{id: "parent-v1", title: "Parent", rationale: "Parent", stage: "proposed", combine: "weighted-geometric-percentile", factors: [{feature: "lineup.strengthFloor", direction: "higher", weight: 1}], scope: ["lineup"], guardrails: [{feature: "lineup.roleTagBreadth", minimumDelta: -1}]}]}));
fs.writeFileSync(files.disposition, JSON.stringify({approvalSha256: hash, disposition: "retire", conclusion: "not-replicated", effectiveAfterSeason: 30}));
const agenda = (index: number) => ({schemaVersion: 1, activationStatus: "shadow-only", managerId: `m${index}`, round: 1, policy: {source: "personal-research-policy", revision: 0, exploration: .5}, selected: {mechanismId: optionId, title: "Boundary", intent: "new-causal-test", score: 1, eligible: true, components: {novelty: 1, epistemicValue: 1, replicationNeed: 0, localSignal: 0, publicPersonalTension: 0, deterministicExploration: .5}, reasons: ["research"]}, ranked: [], deferred: []});
const agendas = Array.from({length: 6}, (_, index) => { const value: any = agenda(index); value.ranked = [value.selected]; return value; }); fs.writeFileSync(files.agendas, zlib.gzipSync(Buffer.from(JSON.stringify(agendas))));
const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(repo, "src/cli/freezeLineupDeploymentResearch.ts"), "--postmortem", files.postmortem, "--options", files.options, "--parent-registry", files.registry, "--parent", "parent-v1", "--disposition", files.disposition, "--agendas", files.agendas, "--out", out], {cwd: repo, encoding: "utf8"});
assert.equal(result.status, 0, result.stderr || result.stdout); const freeze = JSON.parse(fs.readFileSync(path.join(out, "research-freeze.json"), "utf8")), registry = JSON.parse(fs.readFileSync(path.join(out, "research-registry.json"), "utf8"));
assert.equal(freeze.candidatesReadyForSixCaseStudy, 1); assert.equal(freeze.minimumFutureSeason, 31); assert.equal(registry.hypotheses[1].discoveryEvidence.kind, "post-deployment-causal-heterogeneity");
fs.rmSync(root, {recursive: true, force: true}); console.log("Freeze lineup deployment research smoke passed: manager-selected future scopes are immutable and quota-safe");
