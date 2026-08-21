import assert from "node:assert/strict";
import crypto from "node:crypto";
import {managerProgramV3Hash, noviceManagerProgramV3} from "../ai/managerProgramV3";
import {assertRelationalFormalHistory, assertRelationalResearchGeneration, assertRelationalStage4Submission, buildRelationalCanaryHandoff, buildRelationalFormalHistory, buildRelationalResearchGeneration, buildRelationalStage4Submission, evaluateRelationalFormalValidation, updateRelationalResearchGeneration, type RelationalExperimentV3, type RelationalFormalCaseV3} from "../ai/relationalValidation";

const program = noviceManagerProgramV3("fixture-manager", {encoderVersion: "relational-switch-encoder-v1", corpusSignature: "a".repeat(64), familySplitSignature: "b".repeat(64)});
const programHash = managerProgramV3Hash(program);
const experiments: RelationalExperimentV3[] = [
  ...Array.from({length: 4}, (_, index) => experiment("single-action", index)),
  ...Array.from({length: 12}, (_, index) => experiment("continuation-program", index + 4)),
];
const submission = buildRelationalStage4Submission({program, ancestorSourceFingerprints: ["c".repeat(64)], ancestorFamilyClusterIds: ["ancestor-cluster"], novel: true, supportingManagers: ["manager-a", "manager-b"], experiments});
assert.equal(submission.eligible, true, submission.reasons.join(","));
assert.doesNotThrow(() => assertRelationalStage4Submission(submission));
assert.throws(() => assertRelationalStage4Submission({...submission, maximumControlledDecisions: 4 as 5}), /Invalid relational Stage-4 submission/);

const cases: RelationalFormalCaseV3[] = Array.from({length: 24}, (_, index) => ({id: `formal-${index}`, programHash, clusterId: `formal-cluster-${index}`, environment: index % 2 ? "modern" : "combined", sourceFingerprint: digest(["formal", index]), baselineUtility: 0, interventionUtility: 1, technicalFailure: null}));
const formal = evaluateRelationalFormalValidation([submission], cases)[0];
assert.equal(formal.eligible, true, formal.reasons.join(","));
const contradicted = evaluateRelationalFormalValidation([submission], cases.map((value, index) => index ? value : {...value, baselineUtility: 1, interventionUtility: 0}))[0];
assert.equal(contradicted.eligible, false);
assert.equal(contradicted.reasons.includes("formal-counterexample"), true);
const reused = evaluateRelationalFormalValidation([submission], cases.map((value, index) => index ? value : {...value, sourceFingerprint: submission.ancestorSourceFingerprints[0]}))[0];
assert.equal(reused.reasons.includes("formal-source-not-independent"), true);

assert.throws(() => buildRelationalCanaryHandoff(submission, contradicted, "d".repeat(64)), /not passed formal validation/);
const handoff = buildRelationalCanaryHandoff(submission, formal, "d".repeat(64));
assert.equal(handoff.seasons, 2);
assert.equal(handoff.applicationRate, 0.1);
assert.equal(handoff.maximumControlledDecisions, 5);
assert.equal(handoff.sha256, digest(withoutSha(handoff)));
assert.equal("automaticActivationAllowed" in handoff, false);

const history = buildRelationalFormalHistory([{id: "1".repeat(64), sourceIdentitySha256: "2".repeat(64), sourceAuthoritySha256: "3".repeat(64), archiveFile: "campaign.json", archiveSha256: "4".repeat(64), programHashes: [programHash], completedAt: new Date(0).toISOString()}]);
assert.doesNotThrow(() => assertRelationalFormalHistory(history));
assert.throws(() => assertRelationalFormalHistory({...history, sha256: "0".repeat(64)}), /signature/);

let generation = buildRelationalResearchGeneration("5".repeat(64));
generation = updateRelationalResearchGeneration(generation, "falsified", "6".repeat(64));
generation = updateRelationalResearchGeneration(generation, "no-candidate", "7".repeat(64));
assert.equal(generation.frozen, true);
assert.equal(generation.counterexampleAtlasRequired, true);
assert.doesNotThrow(() => assertRelationalResearchGeneration(generation));

console.log("Relational validation contract smoke passed: signed Stage 4, formal fail-closed gates, frozen handoff, and two-cycle stop rule");

function experiment(level: RelationalExperimentV3["level"], index: number): RelationalExperimentV3 {
  return {id: `${level}-${index}`, level, managerId: "fixture-manager", programHash, sourceFingerprint: digest([level, index]), familyClusterId: `cluster-${level}-${index}`, environment: index % 2 ? "modern" : "combined", shortDelta: 0.1, terminalDelta: 0, evaluations: 1, applications: 1, technicalFailure: null};
}
function digest(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function withoutSha<T extends {sha256: string}>(value: T): Omit<T, "sha256"> { const {sha256: _sha256, ...core} = value; return core; }
