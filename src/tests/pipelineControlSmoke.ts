import assert from "node:assert/strict";
import {evaluatePipeline, repairPreflightBlockers, type PipelineStageSnapshot} from "../ai/pipelineControl";

const stages = Array.from({length: 6}, (_, index): PipelineStageSnapshot => ({id: `stage${index}` as PipelineStageSnapshot["id"], name: `Stage ${index}`, dependencies: index ? [`stage${index - 1}` as PipelineStageSnapshot["id"]] : [], artifactAvailable: true, runStatus: "complete", semanticHealthy: true, authority: index === 0 ? "evidence-policy" : index === 1 ? "historical-observational" : index === 5 ? "validation-only" : "shadow-only", authorityReady: index < 2, inputSignature: String(index), metrics: index === 5 ? {limitedCanaryEligibleDomains: ["battle-switch"]} : {}, issues: []}));
const ready = evaluatePipeline(stages); assert.equal(ready.operationalHealthy, true); assert.equal(ready.formalActivationReady, true); assert.equal(ready.nextStage, null); assert.deepEqual(ready.nextMilestones, ["limited-canary", "activation-ready"]);
const historical = structuredClone(stages); historical[0].authorityReady = false; historical[0].issues.push({severity: "warning", code: "historical", message: "Historical only"}); const healthyBlocked = evaluatePipeline(historical); assert.equal(healthyBlocked.operationalHealthy, true); assert.equal(healthyBlocked.formalActivationReady, false); assert.equal(healthyBlocked.warnings.length, 1);
assert.deepEqual(healthyBlocked.nextMilestones, ["current-era-evidence", "limited-canary"]);
const noCandidate = structuredClone(historical); noCandidate[5].metrics = {limitedCanaryEligibleDomains: []}; assert.deepEqual(evaluatePipeline(noCandidate).nextMilestones, ["current-era-evidence", "research-iteration"]);
const missing = structuredClone(stages); missing[3].artifactAvailable = false; const blocked = evaluatePipeline(missing); assert.equal(blocked.nextStage, "stage3"); assert.equal(blocked.stages[4].state, "blocked"); assert.equal(blocked.operationalHealthy, false);
assert.deepEqual(blocked.nextMilestones, ["repair-pipeline"]);
const specialists = stages.map(stage => ({stage: stage.id, healthy: true})); specialists[3].healthy = false;
assert.deepEqual(repairPreflightBlockers({stages: blocked.stages, specialists}, "stage3"), [], "A broken repair target must not block its own rebuild");
specialists[2].healthy = false; assert.match(repairPreflightBlockers({stages: blocked.stages, specialists}, "stage3").join("\n"), /stage2 specialist/);
assert.ok(repairPreflightBlockers({stages: blocked.stages, specialists}, null).some(value => value.includes("stage3")), "A no-op preflight must still require the full chain");
console.log("AI pipeline control smoke passed: operational health, authority separation, dependency blocking, and next-stage selection");
