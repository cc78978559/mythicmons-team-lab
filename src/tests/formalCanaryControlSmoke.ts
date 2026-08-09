import assert from "node:assert/strict";
import {buildFormalCanaryHandoff, verifyFormalCanaryHandoff} from "../ai/formalCanaryControl";
import {sha256} from "../showdown/evidenceEpoch";

const rule = {id: "rule-1", target: "switch", effect: -.1, predicates: [{feature: "positionValue", operator: "lt", threshold: 0}]};
const domain = {id: "battle-switch__better__positionValue-lt", mechanismKey: "switch__better__positionValue-lt", target: "switch", expectedDirection: "better", hypotheses: [{managerId: "manager-01", rule}]};
const freezeCore = {schemaVersion: 1, domains: [domain]}, freeze = {...freezeCore, sha256: sha256(freezeCore)};
const summaryCore = {schemaVersion: 1, freezeSha256: freeze.sha256, automaticActivationAllowed: false, limitedCanaryEligibleDomains: [domain.id]}, summary = {...summaryCore, sha256: sha256(summaryCore)};
const blocked = buildFormalCanaryHandoff(freeze, summary); verifyFormalCanaryHandoff(blocked); assert.equal(blocked.status, "adapter-required"); assert.equal(blocked.automaticActivationAllowed, false);
const readyDomain = {...domain, canaryAdapter: {id: "battle-manager-program-v1", sha256: "a".repeat(64)}}, readyFreezeCore = {schemaVersion: 1, domains: [readyDomain]}, readyFreeze = {...readyFreezeCore, sha256: sha256(readyFreezeCore)}, readySummaryCore = {...summaryCore, freezeSha256: readyFreeze.sha256}, readySummary = {...readySummaryCore, sha256: sha256(readySummaryCore)};
assert.equal(buildFormalCanaryHandoff(readyFreeze, readySummary).status, "execution-ready");
const emptySummaryCore = {...summaryCore, limitedCanaryEligibleDomains: []}, emptySummary = {...emptySummaryCore, sha256: sha256(emptySummaryCore)}; assert.equal(buildFormalCanaryHandoff(freeze, emptySummary).status, "no-candidate");
const tampered = structuredClone(blocked); tampered.control.seasons = 3; assert.throws(() => verifyFormalCanaryHandoff(tampered), /Invalid formal canary handoff/);
console.log("Formal canary control smoke passed: signed handoff, adapter blocking, bounded execution readiness, and tamper rejection");
