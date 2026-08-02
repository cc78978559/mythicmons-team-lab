import assert from "node:assert/strict";
import {auditCausalOutcomeBoundary, auditProspectiveBoundaryProxies, type CausalBoundaryCase} from "../ai/whiteBox/causalBoundaryAudit";

const cases: CausalBoundaryCase[] = [];
for (let manager = 1; manager <= 24; manager++) for (let mechanism = 1; mechanism <= 4; mechanism++) for (const sourceOutcome of ["loss", "win"] as const) cases.push({evidenceId: `e-${manager}-${mechanism}-${sourceOutcome}`, managerId: `manager-${manager}`, mechanismId: `mechanism-${mechanism}-v1`, season: manager % 3 + 1, sourceOutcome, effect: sourceOutcome === "loss" ? 1 : -1});
const result = auditCausalOutcomeBoundary(cases, 1000); assert.equal(result.conclusion, "retrospective-boundary-candidate"); assert.equal(result.activationEligible, false); assert.equal(result.direction, "loss-higher"); assert.equal(result.metrics.effectDifference, 2); assert.equal(result.metrics.matchedManagers, 24); assert.ok(result.metrics.stratifiedPermutationP <= .01); assert.ok(result.leaveOneMechanismOut.every(value => value.effectDifference > 0));
const neutral = auditCausalOutcomeBoundary(cases.map(value => ({...value, effect: 0 as const})), 1000); assert.equal(neutral.conclusion, "boundary-not-ready"); assert.equal(neutral.direction, "neutral");
assert.throws(() => auditCausalOutcomeBoundary([...cases, cases[0]], 100), /unique evidence/);
const proxies = auditProspectiveBoundaryProxies(cases.map(value => ({
  ...value,
  previousLoss: Number(value.managerId.split("-")[1]) % 2 === 0,
  recentThreeLossRateHigh: Number(value.mechanismId.match(/mechanism-(\d+)/)?.[1]) % 2 === 0,
  seasonLossRateHigh: value.season === 1,
})), 1000); assert.equal(proxies.conclusion, "no-prospective-proxy-ready"); assert.equal(proxies.activationEligible, false); assert.ok(proxies.screens.every(value => value.effectDifference === 0));
console.log("Causal boundary audit smoke passed: stratified permutation, manager matching, leave-one-mechanism robustness, and dedupe");
