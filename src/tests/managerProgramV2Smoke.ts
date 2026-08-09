import assert from "node:assert/strict";
import {evolveManagerProgramV2, evaluateManagerProgramV2, managerProgramV2Behavior, managerProgramV2Hash, noviceManagerProgramV2, validateManagerProgramV2, type ManagerProgramSampleV2} from "../ai/managerProgramV2";

const evidence = {decisionDossierPolicy: "decision-dossier-v1.4-position-context", positionModelSha256: "a".repeat(64), corpusSignature: "b".repeat(64)};
const novice = noviceManagerProgramV2("manager-01", evidence);
assert.equal(evaluateManagerProgramV2(novice, "battle", "switch", {pressure: .9}).value, 0);

const samples = (prefix: string, count: number): ManagerProgramSampleV2[] => Array.from({length: count}, (_, index) => {
  const pressure = (index % 20) / 19, action = index % 2 ? "switch" : "physical-attack";
  const localValueDelta = action === "switch" && pressure >= .5 ? .24 : action === "switch" ? -.12 : pressure >= .5 ? -.08 : .05;
  return {id: `${prefix}-${index}`, battleId: `${prefix}-battle-${Math.floor(index / 2)}`, clusterId: `${prefix}-cluster-${Math.floor(index / 8)}`, action, features: {pressure, turnProgress: (index % 10) / 10}, localValueDelta, authority: "local-value-observational"};
});
const discovery = samples("discovery", 240), validation = samples("validation", 120);
const first = evolveManagerProgramV2({program: novice, discovery, validation, seed: "manager-v2-smoke", revisions: 6});
const replay = evolveManagerProgramV2({program: novice, discovery, validation, seed: "manager-v2-smoke", revisions: 6});
assert.equal(managerProgramV2Hash(first.program), managerProgramV2Hash(replay.program));
assert(first.accepted > 0);
assert(first.discoveryMseAfter < first.discoveryMseBefore);
assert(first.validationMseAfter <= first.validationMseBefore);
assert(first.program.history.some(entry => entry.accepted && entry.evidenceAuthority === "local-value-observational"));
validateManagerProgramV2(first.program);
const favorable = evaluateManagerProgramV2(first.program, "battle", "switch", {pressure: .9, turnProgress: .5});
const unfavorable = evaluateManagerProgramV2(first.program, "battle", "switch", {pressure: .1, turnProgress: .5});
assert(favorable.value > unfavorable.value);
assert(favorable.matchedRules.length > 0);
assert.equal(favorable.programHash, managerProgramV2Hash(first.program));
assert(managerProgramV2Behavior(first.program).targets.includes("switch"));
assert.throws(() => evaluateManagerProgramV2(first.program, "battle", "switch", {pressure: Number.NaN}), /Invalid manager-program/);
console.log("Manager Program V2 smoke passed: novice origin, autonomous conditional discovery, validation gate, replay, and bounded traces");
