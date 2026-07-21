import assert from "node:assert/strict";
import {createNoviceProfiles} from "../draft/managerProfiles";
import {createAcademyState} from "../draft/academyEnvironment";
import {settleAcademyContracts} from "../draft/academyContracts";
import {reconstructAcademyContractSettlement, screenAcademyContractConcessions} from "../ai/whiteBox/academyContractCounterfactual";
import {evaluateAcademyContractConcession} from "../ai/whiteBox/academyContractConcession";

const profile = createNoviceProfiles(1)[0];
const academy = createAcademyState("academy-a", "Academy A", profile, 30);
const rules = {policy: "enforce" as const, cycleSeasons: 2, renewalYears: 3, baseSalary: 3, maximumSalary: 100, arbitrationDemandWeight: .6, cycle: 1};
const settlement = settleAcademyContracts([
  {childId: "child-a", childName: "Child A", academyId: academy.academyId, optionYears: 2, annualSalary: 20, contractYears: 0, profile},
  {childId: "child-b", childName: "Child B", academyId: academy.academyId, optionYears: 2, annualSalary: 2, contractYears: 0, profile},
], [academy], new Set(), rules);
const loyalConcession = evaluateAcademyContractConcession({decisionId: "loyal", incumbentStatus: "arbitrated", demand: 10, offer: 9, maximumSalary: 10, academyFit: 1, preferences: {loyalty: 1, ambition: 0, opportunityNeed: 1, cultureTolerance: 1}});
const ambitiousRejection = evaluateAcademyContractConcession({decisionId: "ambitious", incumbentStatus: "arbitrated", demand: 10, offer: 8, maximumSalary: 10, academyFit: 0, preferences: {loyalty: 0, ambition: 1, opportunityNeed: 0, cultureTolerance: 0}});
assert.equal(loyalConcession.selected, "accept-offer");
assert.equal(ambitiousRejection.selected, "incumbent");
assert(loyalConcession.concessionRate <= .18);
assert(settlement.contracts.find(value => value.childId === "child-a")?.concessionWhiteBoxShadow);
const replay = reconstructAcademyContractSettlement(settlement);
assert.deepEqual(replay.balances, settlement.balances);
assert.deepEqual(replay.contracts, settlement.contracts);
const screens = screenAcademyContractConcessions(settlement);
assert(screens.length >= 1);
const first = screens.find(value => value.childId === "child-a")!;
assert.equal(first.incumbentStatus, "arbitrated");
assert.equal(first.candidatePolicy, "accept-academy-offer");
assert(first.candidateSalary < first.incumbentSalary);
assert(first.academyBalanceDelta > 0);
assert(first.affectedChildIds.includes("child-a"));
assert.equal(first.evidenceScope, "contract-ledger-only");
assert.equal(first.activationStatus, "shadow-only");
assert.equal(first.screenStatus, "requires-competitive-replay");
const intervened = settleAcademyContracts([
  {childId: "child-a", childName: "Child A", academyId: academy.academyId, optionYears: 2, annualSalary: 20, contractYears: 0, profile},
  {childId: "child-b", childName: "Child B", academyId: academy.academyId, optionYears: 2, annualSalary: 2, contractYears: 0, profile},
], [academy], new Set(), rules, {childId: "child-a", action: "accept-offer"});
assert.deepEqual(intervened.experiment, {childId: "child-a", action: "accept-offer", incumbentStatus: "arbitrated", candidateStatus: "renewed"});
assert.equal(intervened.contracts.find(value => value.childId === "child-a")?.status, "renewed");
assert.throws(() => settleAcademyContracts([{childId: "paid", childName: "Paid", academyId: academy.academyId, optionYears: 2, annualSalary: 2, contractYears: 3, profile}], [academy], new Set(), rules, {childId: "paid", action: "accept-offer"}), /not applicable/);
const released = screens.find(value => value.incumbentStatus === "released");
if (released) {
  assert.equal(released.candidateStatus, "renewed");
  assert.equal(released.candidateOptionYears, 2);
}

const constrainedAcademy = createAcademyState("academy-b", "Academy B", profile, 2.5);
const constrained = settleAcademyContracts([
  {childId: "child-a", childName: "Child A", academyId: constrainedAcademy.academyId, optionYears: 0, annualSalary: 3.2, contractYears: 0, profile},
  {childId: "child-b", childName: "Child B", academyId: constrainedAcademy.academyId, optionYears: 3, annualSalary: 3, contractYears: 1, profile},
], [constrainedAcademy], new Set(), {...rules, cycleSeasons: 1});
const blocked = screenAcademyContractConcessions(constrained).find(value => value.childId === "child-a")!;
assert.equal(blocked.incumbentStatus, "released");
assert.equal(blocked.accountingOutcome, "higher-arrears");
assert.equal(blocked.screenStatus, "blocked-arrears-increase");
assert.deepEqual(blocked.downstreamAffectedChildIds, ["child-b"]);

const legacy = {...settlement, replayRules: undefined} as unknown as typeof settlement;
assert.throws(() => reconstructAcademyContractSettlement(legacy), /lacks replayRules/);
console.log("Academy contract counterfactual smoke passed");
