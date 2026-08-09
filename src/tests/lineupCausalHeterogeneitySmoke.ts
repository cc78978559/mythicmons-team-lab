import assert from "node:assert/strict";
import {auditLineupCausalHeterogeneity} from "../ai/whiteBox/lineupCausalHeterogeneity";

const cases = Array.from({length: 24}, (_, index) => ({managerId: `m${index}`, direction: index < 3 ? "better" as const : index < 20 ? "neutral" as const : "worse" as const, signals: {"predecision.scope": index < 12 ? 0 : 1, "predecision.noise": index % 5}}));
const audit = auditLineupCausalHeterogeneity(cases);
assert.equal(audit.evidenceStatus, "post-hoc-exploratory");
assert.equal(audit.cases, 24); assert.equal(audit.managers, 24); assert.equal(audit.decisiveCases, 7);
assert.ok(audit.proposals.some(value => value.signal === "predecision.scope" && value.operator === "at-most" && value.better === 3 && value.worse === 0));
assert.match(audit.nextAction, /Freeze at most one/);
console.log("Lineup causal heterogeneity smoke passed: predecision-only scoped discovery remains post-hoc and shadow-only");
