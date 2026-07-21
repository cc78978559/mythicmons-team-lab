import type {AcademyContractEvidence, AcademyContractRules, AcademyContractSettlement, AcademyContractStatus} from "../../draft/academyContracts";

const EPSILON = 1e-8;

export interface AcademyContractReplay {
  contracts: AcademyContractEvidence[];
  balances: Record<string, number>;
  payrollOutflow: number;
  arrears: number;
}

export interface AcademyContractCounterfactualCase {
  caseId: string;
  childId: string;
  childName: string;
  academyId: string;
  incumbentStatus: AcademyContractStatus;
  candidatePolicy: "accept-academy-offer";
  incumbentSalary: number;
  candidateSalary: number;
  candidateStatus: AcademyContractStatus;
  candidateContractYears: number;
  candidateOptionYears: number;
  affectedChildIds: string[];
  payrollDelta: number;
  arrearsDelta: number;
  academyBalanceDelta: number;
  evidenceScope: "contract-ledger-only";
  activationStatus: "shadow-only";
}

export function reconstructAcademyContractSettlement(source: AcademyContractSettlement): AcademyContractReplay {
  if (!source.replayRules) throw new Error("Academy contract source lacks replayRules; regenerate the development cycle with the current implementation");
  if (source.contracts.some(contract => contract.offerCeiling === undefined)) throw new Error("Academy contract source lacks offerCeiling replay evidence");
  const reconstructed = replay(source, undefined);
  assertMatchesSource(source, reconstructed);
  return reconstructed;
}

export function screenAcademyContractConcessions(source: AcademyContractSettlement): AcademyContractCounterfactualCase[] {
  const incumbent = reconstructAcademyContractSettlement(source);
  return source.contracts
    .filter(contract => contract.status === "arbitrated" || (contract.status === "released" && contract.demand > 0 && contract.offer > 0))
    .map(contract => {
      const candidate = replay(source, contract.childId);
      const affectedChildIds = changedContracts(incumbent.contracts, candidate.contracts);
      if (!affectedChildIds.includes(contract.childId)) throw new Error(`Contract intervention did not change target ${contract.childId}`);
      const candidateContract = candidate.contracts.find(value => value.childId === contract.childId)!;
      return {
        caseId: `academy-contract:${contract.childId}:accept-offer`, childId: contract.childId, childName: contract.childName,
        academyId: contract.academyId, incumbentStatus: contract.status, candidatePolicy: "accept-academy-offer" as const,
        incumbentSalary: contract.salaryAfter, candidateSalary: candidateContract.salaryAfter, candidateStatus: candidateContract.status,
        candidateContractYears: candidateContract.contractYearsAfter, candidateOptionYears: candidateContract.optionYearsAfter,
        affectedChildIds, payrollDelta: candidate.payrollOutflow - incumbent.payrollOutflow, arrearsDelta: candidate.arrears - incumbent.arrears,
        academyBalanceDelta: (candidate.balances[contract.academyId] ?? 0) - (incumbent.balances[contract.academyId] ?? 0),
        evidenceScope: "contract-ledger-only" as const, activationStatus: "shadow-only" as const,
      };
    });
}

function replay(source: AcademyContractSettlement, acceptOfferChildId: string | undefined): AcademyContractReplay {
  const rules = source.replayRules as AcademyContractRules;
  const balances = startingBalances(source), contracts: AcademyContractEvidence[] = [];
  for (const retained of [...source.contracts].sort((a, b) => a.childId.localeCompare(b.childId))) {
    if (retained.status === "prepaid") { contracts.push({...retained}); continue; }
    if (!(retained.academyId in balances)) { contracts.push({...retained}); continue; }
    const available = Math.max(0, balances[retained.academyId]);
    const renewal = retained.contractYearsBefore < rules.cycleSeasons;
    let salary = retained.salaryBefore, years = retained.contractYearsBefore, status: AcademyContractStatus = "paid", demand = salary, offer = salary, award: number | undefined;
    if (renewal) {
      demand = retained.demand;
      offer = Math.max(0, Math.min(rules.maximumSalary, retained.offerCeiling, available / rules.cycleSeasons));
      if (retained.childId === acceptOfferChildId || offer + 1e-9 >= demand || rules.policy === "ignore") { salary = offer; years = rules.renewalYears; status = "renewed"; }
      else {
        award = Math.min(rules.maximumSalary, demand * rules.arbitrationDemandWeight + offer * (1 - rules.arbitrationDemandWeight));
        if (award * rules.cycleSeasons <= available + 1e-9) { salary = award; years = rules.renewalYears; status = "arbitrated"; }
        else { contracts.push(updated(retained, "released", retained.salaryBefore, 0, 0, demand, offer, award, 0, 0)); continue; }
      }
    }
    const due = salary * rules.cycleSeasons, paid = Math.min(available, due), arrears = due - paid;
    balances[retained.academyId] = available - paid;
    if (arrears > 1e-9) { status = "defaulted"; years = 0; }
    contracts.push(updated(retained, status, salary, years, arrears > 1e-9 ? 0 : retained.optionYearsBefore, demand, offer, award, due, paid));
  }
  const payrollOutflow = sum(contracts.map(contract => contract.paid)), arrears = sum(contracts.map(contract => contract.arrears));
  return {contracts, balances, payrollOutflow, arrears};
}

function startingBalances(source: AcademyContractSettlement): Record<string, number> {
  const balances = {...source.balances};
  for (const contract of source.contracts) if (contract.academyId in balances) balances[contract.academyId] += contract.paid;
  return balances;
}

function updated(retained: AcademyContractEvidence, status: AcademyContractStatus, salaryAfter: number, contractYearsAfter: number, optionYearsAfter: number, demand: number, offer: number, arbitrationAward: number | undefined, due: number, paid: number): AcademyContractEvidence {
  return {...retained, status, salaryAfter, contractYearsAfter, optionYearsAfter, demand, offer, arbitrationAward, due, paid, arrears: due - paid, released: status === "released" || status === "defaulted"};
}

function assertMatchesSource(source: AcademyContractSettlement, replay: AcademyContractReplay): void {
  if (source.contracts.length !== replay.contracts.length) throw new Error("Academy contract replay count mismatch");
  for (let index = 0; index < source.contracts.length; index += 1) {
    const expected = source.contracts[index], actual = replay.contracts[index];
    for (const key of ["childId", "academyId", "status", "contractYearsAfter", "optionYearsAfter"] as const) if (expected[key] !== actual[key]) throw new Error(`Academy contract replay mismatch for ${expected.childId}.${key}`);
    for (const key of ["salaryAfter", "demand", "offer", "due", "paid", "arrears"] as const) if (Math.abs(expected[key] - actual[key]) > EPSILON) throw new Error(`Academy contract replay mismatch for ${expected.childId}.${key}`);
  }
  for (const [academyId, balance] of Object.entries(source.balances)) if (Math.abs(balance - (replay.balances[academyId] ?? 0)) > EPSILON) throw new Error(`Academy contract replay balance mismatch for ${academyId}`);
  if (Math.abs(source.payrollOutflow - replay.payrollOutflow) > EPSILON || Math.abs(source.arrears - replay.arrears) > EPSILON) throw new Error("Academy contract replay aggregate mismatch");
}

function changedContracts(left: readonly AcademyContractEvidence[], right: readonly AcademyContractEvidence[]): string[] {
  return left.filter((contract, index) => JSON.stringify(contract) !== JSON.stringify(right[index])).map(contract => contract.childId);
}
function sum(values: readonly number[]): number { return values.reduce((total, value) => total + value, 0); }
