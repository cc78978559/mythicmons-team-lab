import assert from "node:assert/strict";
import {createNoviceProfiles} from "../draft/managerProfiles";
import {createAcademyState} from "../draft/academyEnvironment";
import {settleAcademyContracts} from "../draft/academyContracts";
import {reconstructAcademyContractSettlement, screenAcademyContractConcessions} from "../ai/whiteBox/academyContractCounterfactual";

const profile = createNoviceProfiles(1)[0];
const academy = createAcademyState("academy-a", "Academy A", profile, 30);
const rules = {policy: "enforce" as const, cycleSeasons: 2, renewalYears: 3, baseSalary: 3, maximumSalary: 100, arbitrationDemandWeight: .6, cycle: 1};
const settlement = settleAcademyContracts([
  {childId: "child-a", childName: "Child A", academyId: academy.academyId, optionYears: 2, annualSalary: 20, contractYears: 0, profile},
  {childId: "child-b", childName: "Child B", academyId: academy.academyId, optionYears: 2, annualSalary: 2, contractYears: 0, profile},
], [academy], new Set(), rules);
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
const released = screens.find(value => value.incumbentStatus === "released");
if (released) {
  assert.equal(released.candidateStatus, "renewed");
  assert.equal(released.candidateOptionYears, 2);
}

const legacy = {...settlement, replayRules: undefined} as unknown as typeof settlement;
assert.throws(() => reconstructAcademyContractSettlement(legacy), /lacks replayRules/);
console.log("Academy contract counterfactual smoke passed");
