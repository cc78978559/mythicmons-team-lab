import assert from "node:assert/strict";
import {buildPipelineDoctorPlan} from "../ai/pipelineDoctorPlan";

const roots = {league: "league", stage1: "stage1", stage2: "stage2", stage3: "stage3", stage4: "stage4", stage5: "stage5", corpus: "corpus"};
const quick = buildPipelineDoctorPlan(roots, false);
const full = buildPipelineDoctorPlan(roots, true);

assert.equal(quick.length, 6);
assert.equal(full.length, 6);
assert.equal(full.find(spec => spec.stage === "stage0")?.args.includes("--verify-sources"), false);
for (const stage of ["stage1", "stage2", "stage3", "stage4", "stage5"]) {
  assert.equal(full.find(spec => spec.stage === stage)?.args.includes("--verify-sources"), true, `${stage} must verify its own sources`);
  assert.equal(quick.find(spec => spec.stage === stage)?.args.includes("--verify-sources"), false, `${stage} quick doctor must remain metadata-only`);
}

console.log("Pipeline doctor plan smoke passed: Stage 1-5 receive full-source verification consistently");
