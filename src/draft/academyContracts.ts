import type {AcademyState} from "./academyEnvironment";
import type {ManagerProfile} from "./managerProfiles";
import {personalitySimilarity} from "./personalitySimilarity";
import {managerMarketPreferences, type ContractNegotiationPolicy} from "./academyTalentMarket";
import {evaluateAcademyContractConcession} from "../ai/whiteBox/academyContractConcession";

export interface AcademyContractCandidate {
  childId: string; childName: string; academyId: string; optionYears: number;
  annualSalary: number; contractYears: number; profile: ManagerProfile;
  averageRank?: number; capacity?: number;
}
export interface AcademyContractRules {
  policy: ContractNegotiationPolicy; cycleSeasons: number; renewalYears: number;
  baseSalary: number; maximumSalary: number; arbitrationDemandWeight: number; cycle?: number;
}
export interface AcademyContractIntervention {childId: string; action: "accept-offer"}
export interface SalaryGuaranteeDebt {academyId: string; childId: string; childName: string; amount: number; originCycle: number}
export interface SalaryGuaranteePayment extends SalaryGuaranteeDebt {paid: number; remaining: number}
export interface SalaryGuaranteeSettlement {payments: SalaryGuaranteePayment[]; remainingDebts: SalaryGuaranteeDebt[]; balances: Record<string, number>; paid: number; openingDebt: number; closingDebt: number; budgetBefore: number; budgetAfter: number; conservationError: number}
export type AcademyFinancialHealthStatus = "healthy" | "strained" | "distressed" | "insolvent";
export interface AcademyFinancialHealth {academyId: string; status: AcademyFinancialHealthStatus; priorDebt: number; debtRepaid: number; newArrears: number; guaranteedDebt: number; payrollDue: number; payrollPaid: number; closingTreasury: number; obligationCoverage: number; reserveCoverage: number}
export interface AcademyFinancialControl {academyId: string; triggerStatus: AcademyFinancialHealthStatus; spendingMultiplier: number; acquisitionAllowed: boolean; trusteeship: boolean; recoveryRequired: boolean; leadershipInfluence: number; leadershipAllocationTarget?: {facility: number; scouting: number; patience: number; experimentation: number}; reasons: string[]; exitCriteria: string[]}
export type AcademyRecoveryState = "normal" | "active" | "exit-pending";
export interface AcademyRecoveryRecord {academyId: string; state: AcademyRecoveryState; enteredCycle?: number; consecutiveRecoveryCycles: number; trusteeshipCycles: number; leadershipAction: "normal-operations" | "reserve-rebuild" | "cost-restructuring" | "trustee-control"; emergencySaleEligible: boolean; exitEligible: boolean; exitAssessment: {noGuaranteedDebt: boolean; fullCurrentPayroll: boolean; reserveCoverageMet: boolean}}
export type AcademyContractStatus = "prepaid" | "paid" | "renewed" | "arbitrated" | "released" | "defaulted";
export interface AcademyContractConcessionShadow {version: "academy-contract-concession-v1"; decisionId: string; incumbentStatus: "arbitrated" | "released"; selected: "accept-offer" | "incumbent"; agrees: boolean; demand: number; offer: number; maximumSalary: number; minimumAcceptableSalary: number; relativeGap: number; concessionRate: number; academyFit: number; preferences: {loyalty: number; ambition: number; opportunityNeed: number; cultureTolerance: number}; components: {base: number; loyalty: number; cultureFit: number; security: number; opportunity: number; ambitionPenalty: number}}
export interface AcademyContractEvidence {
  childId: string; childName: string; academyId: string; status: AcademyContractStatus;
  salaryBefore: number; salaryAfter: number; contractYearsBefore: number; contractYearsAfter: number; optionYearsBefore: number;
  optionYearsAfter: number; demand: number; offer: number; arbitrationAward?: number;
  offerCeiling: number;
  due: number; paid: number; arrears: number; released: boolean;
  concessionWhiteBoxShadow?: AcademyContractConcessionShadow;
}
export interface AcademyContractSettlement {
  contracts: AcademyContractEvidence[];
  balances: Record<string, number>;
  assignments: Record<string, {annualSalary: number; contractYears: number; optionYears: number}>;
  newDebts: SalaryGuaranteeDebt[];
  payrollOutflow: number; arrears: number; budgetBefore: number; budgetAfter: number; conservationError: number;
  replayRules: AcademyContractRules;
  experiment?: {childId: string; action: "accept-offer"; incumbentStatus: "arbitrated" | "released"; candidateStatus: "renewed"};
}

export function settleSalaryGuarantees(debts: readonly SalaryGuaranteeDebt[], academies: readonly AcademyState[]): SalaryGuaranteeSettlement {
  const original = Object.fromEntries(academies.map(academy => [academy.academyId, academy.treasury])), balances = {...original}, payments: SalaryGuaranteePayment[] = [];
  for (const debt of [...debts].filter(debt => debt.amount > 1e-9).sort((a, b) => a.originCycle - b.originCycle || a.academyId.localeCompare(b.academyId) || a.childId.localeCompare(b.childId))) {
    const available = Math.max(0, balances[debt.academyId] ?? 0), paid = Math.min(available, debt.amount), remaining = debt.amount - paid;
    if (debt.academyId in balances) balances[debt.academyId] = available - paid;
    payments.push({...debt, paid, remaining});
  }
  const remainingDebts = payments.filter(payment => payment.remaining > 1e-9).map(({academyId, childId, childName, originCycle, remaining}) => ({academyId, childId, childName, originCycle, amount: remaining}));
  const paid = sum(payments.map(payment => payment.paid)), openingDebt = sum(debts.map(debt => Math.max(0, debt.amount))), closingDebt = sum(remainingDebts.map(debt => debt.amount)), budgetBefore = sum(Object.values(original)), budgetAfter = sum(Object.values(balances));
  return {payments, remainingDebts, balances, paid, openingDebt, closingDebt, budgetBefore, budgetAfter, conservationError: budgetBefore - paid - budgetAfter};
}

export function academyFinancialControls(academyIds: readonly string[], previousHealth: readonly AcademyFinancialHealth[], outstandingDebts: readonly SalaryGuaranteeDebt[]): AcademyFinancialControl[] {
  return [...academyIds].sort().map(academyId => {
    const debt = sum(outstandingDebts.filter(value => value.academyId === academyId).map(value => value.amount)), prior = previousHealth.find(value => value.academyId === academyId);
    const triggerStatus: AcademyFinancialHealthStatus = debt > 1e-9 ? "insolvent" : prior?.status ?? "healthy";
    const spendingMultiplier = triggerStatus === "healthy" ? 1 : triggerStatus === "strained" ? .75 : triggerStatus === "distressed" ? .4 : 0;
    const acquisitionAllowed = triggerStatus === "healthy" || triggerStatus === "strained", trusteeship = triggerStatus === "insolvent", recoveryRequired = triggerStatus !== "healthy";
    const leadershipInfluence = triggerStatus === "healthy" ? 0 : triggerStatus === "strained" ? .25 : triggerStatus === "distressed" ? .6 : 1;
    const leadershipAllocationTarget = triggerStatus === "healthy" ? undefined : triggerStatus === "strained" ? {facility: .25, scouting: .2, patience: .4, experimentation: .15} : triggerStatus === "distressed" ? {facility: .15, scouting: .15, patience: .55, experimentation: .15} : {facility: .1, scouting: .1, patience: .7, experimentation: .1};
    const reasons = [...(debt > 1e-9 ? [`guaranteed-debt:${debt.toFixed(2)}`] : []), ...(prior && prior.status !== "healthy" ? [`prior-health:${prior.status}`] : [])];
    const exitCriteria = recoveryRequired ? ["no-guaranteed-debt", "full-current-payroll", "reserve-coverage-at-least-1"] : [];
    return {academyId, triggerStatus, spendingMultiplier, acquisitionAllowed, trusteeship, recoveryRequired, leadershipInfluence, leadershipAllocationTarget, reasons, exitCriteria};
  });
}

export function academyRecoveryRecords(controls: readonly AcademyFinancialControl[], currentHealth: readonly AcademyFinancialHealth[], previousRecords: readonly AcademyRecoveryRecord[], cycle: number): AcademyRecoveryRecord[] {
  return [...controls].sort((a, b) => a.academyId.localeCompare(b.academyId)).map(control => {
    const health = currentHealth.find(value => value.academyId === control.academyId), previous = previousRecords.find(value => value.academyId === control.academyId);
    const exitAssessment = {noGuaranteedDebt: (health?.guaranteedDebt ?? 0) <= 1e-9, fullCurrentPayroll: (health?.obligationCoverage ?? 0) >= 1, reserveCoverageMet: (health?.reserveCoverage ?? 0) >= 1};
    const exitEligible = control.recoveryRequired && Object.values(exitAssessment).every(Boolean), state: AcademyRecoveryState = !control.recoveryRequired ? "normal" : exitEligible ? "exit-pending" : "active";
    const continuing = previous?.state === "active" || previous?.state === "exit-pending", consecutiveRecoveryCycles = control.recoveryRequired ? (continuing ? previous!.consecutiveRecoveryCycles + 1 : 1) : 0;
    const trusteeshipCycles = (previous?.trusteeshipCycles ?? 0) + (control.trusteeship ? 1 : 0), enteredCycle = control.recoveryRequired ? (continuing ? previous?.enteredCycle : cycle) : undefined;
    const leadershipAction = control.triggerStatus === "insolvent" ? "trustee-control" : control.triggerStatus === "distressed" ? "cost-restructuring" : control.triggerStatus === "strained" ? "reserve-rebuild" : "normal-operations";
    return {academyId: control.academyId, state, enteredCycle, consecutiveRecoveryCycles, trusteeshipCycles, leadershipAction, emergencySaleEligible: control.triggerStatus === "distressed" || control.triggerStatus === "insolvent", exitEligible, exitAssessment};
  });
}

export function settleAcademyContracts(candidates: readonly AcademyContractCandidate[], academies: readonly AcademyState[], prepaidChildIds: ReadonlySet<string>, rules: AcademyContractRules, intervention?: AcademyContractIntervention): AcademyContractSettlement {
  const original = Object.fromEntries(academies.map(academy => [academy.academyId, academy.treasury])), balances = {...original};
  const contracts: AcademyContractEvidence[] = [], assignments: AcademyContractSettlement["assignments"] = {};
  let experiment: AcademyContractSettlement["experiment"];
  for (const candidate of [...candidates].sort((a, b) => a.childId.localeCompare(b.childId))) {
    if (prepaidChildIds.has(candidate.childId)) {
      assignments[candidate.childId] = {annualSalary: candidate.annualSalary, contractYears: candidate.contractYears, optionYears: candidate.optionYears};
      contracts.push(evidence(candidate, "prepaid", candidate.annualSalary, candidate.contractYears, candidate.optionYears, 0, 0, candidate.annualSalary, undefined, 0, 0));
      continue;
    }
    const academy = academies.find(value => value.academyId === candidate.academyId);
    if (!academy) {
      assignments[candidate.childId] = {annualSalary: candidate.annualSalary, contractYears: 0, optionYears: 0};
      contracts.push(evidence(candidate, "released", candidate.annualSalary, 0, 0, 0, 0, 0, undefined, 0, 0));
      continue;
    }
    const available = Math.max(0, balances[candidate.academyId] ?? 0), renewal = candidate.contractYears < rules.cycleSeasons;
    let salary = candidate.annualSalary, years = candidate.contractYears, status: AcademyContractStatus = "paid", demand = salary, offer = salary, offerCeiling = salary, award: number | undefined, concessionWhiteBoxShadow: AcademyContractConcessionShadow | undefined;
    if (renewal) {
      const preferences = managerMarketPreferences({...candidate, rightsHolderId: candidate.academyId}), fit = personalitySimilarity(candidate.profile, academy.tradition).similarity;
      const performance = candidate.capacity && candidate.capacity > 1 && candidate.averageRank ? 1 - (candidate.averageRank - 1) / (candidate.capacity - 1) : .5;
      demand = Math.min(rules.maximumSalary, Math.max(candidate.annualSalary, rules.baseSalary * (.7 + preferences.ambition * .5 + performance * .35)));
      offerCeiling = Math.max(0, Math.min(rules.maximumSalary, rules.baseSalary * (.7 + academy.quality * .25 + fit * .2)));
      offer = Math.max(0, Math.min(offerCeiling, available / rules.cycleSeasons));
      if (offer + 1e-9 >= demand || rules.policy === "ignore") { salary = offer; years = rules.renewalYears; status = "renewed"; }
      else {
        award = Math.min(rules.maximumSalary, demand * rules.arbitrationDemandWeight + offer * (1 - rules.arbitrationDemandWeight));
        const incumbentStatus = award * rules.cycleSeasons <= available + 1e-9 ? "arbitrated" as const : "released" as const;
        concessionWhiteBoxShadow = evaluateAcademyContractConcession({decisionId: `academy-contract:${candidate.childId}:cycle-${rules.cycle ?? 0}`, incumbentStatus, demand, offer, maximumSalary: rules.maximumSalary, academyFit: fit, preferences});
        if (intervention?.childId === candidate.childId && intervention.action === "accept-offer") {
          salary = offer; years = rules.renewalYears; status = "renewed";
          experiment = {childId: candidate.childId, action: intervention.action, incumbentStatus, candidateStatus: "renewed"};
        }
        else if (incumbentStatus === "arbitrated") { salary = award; years = rules.renewalYears; status = "arbitrated"; }
        else {
          assignments[candidate.childId] = {annualSalary: candidate.annualSalary, contractYears: 0, optionYears: 0};
          contracts.push(evidence(candidate, "released", candidate.annualSalary, 0, 0, demand, offer, offerCeiling, award, 0, 0, concessionWhiteBoxShadow));
          continue;
        }
      }
    }
    const due = salary * rules.cycleSeasons, paid = Math.min(available, due), arrears = due - paid;
    balances[candidate.academyId] = available - paid;
    if (arrears > 1e-9) { status = "defaulted"; years = 0; }
    const optionYears = arrears > 1e-9 ? 0 : candidate.optionYears;
    assignments[candidate.childId] = {annualSalary: salary, contractYears: years, optionYears};
    contracts.push(evidence(candidate, status, salary, years, optionYears, demand, offer, offerCeiling, award, due, paid, concessionWhiteBoxShadow));
  }
  const payrollOutflow = contracts.reduce((sum, contract) => sum + contract.paid, 0), arrears = contracts.reduce((sum, contract) => sum + contract.arrears, 0);
  const newDebts = contracts.filter(contract => contract.arrears > 1e-9).map(contract => ({academyId: contract.academyId, childId: contract.childId, childName: contract.childName, amount: contract.arrears, originCycle: rules.cycle ?? 0}));
  const budgetBefore = sum(Object.values(original)), budgetAfter = sum(Object.values(balances));
  if (intervention && !experiment) throw new Error(`Academy contract intervention was not applicable: ${intervention.childId}`);
  return {contracts, balances, assignments, newDebts, payrollOutflow, arrears, budgetBefore, budgetAfter, conservationError: budgetBefore - payrollOutflow - budgetAfter, replayRules: {...rules}, experiment};
}

export function academyFinancialHealth(academies: readonly AcademyState[], guarantees: SalaryGuaranteeSettlement, contracts: AcademyContractSettlement, reserveTarget: number): AcademyFinancialHealth[] {
  return [...academies].sort((a, b) => a.academyId.localeCompare(b.academyId)).map(academy => {
    const prior = guarantees.payments.filter(value => value.academyId === academy.academyId), current = contracts.contracts.filter(value => value.academyId === academy.academyId);
    const priorDebt = sum(prior.map(value => value.amount)), debtRepaid = sum(prior.map(value => value.paid)), newArrears = sum(current.map(value => value.arrears)), guaranteedDebt = sum(guarantees.remainingDebts.filter(value => value.academyId === academy.academyId).map(value => value.amount)) + newArrears;
    const payrollDue = sum(current.map(value => value.due)), payrollPaid = sum(current.map(value => value.paid)), obligations = priorDebt + payrollDue, obligationCoverage = obligations > 0 ? (debtRepaid + payrollPaid) / obligations : 1, reserveCoverage = reserveTarget > 0 ? academy.treasury / reserveTarget : 1;
    const status: AcademyFinancialHealthStatus = guaranteedDebt > 1e-9 ? "insolvent" : obligationCoverage < 1 ? "distressed" : reserveCoverage < .5 ? "distressed" : reserveCoverage < 1 ? "strained" : "healthy";
    return {academyId: academy.academyId, status, priorDebt, debtRepaid, newArrears, guaranteedDebt, payrollDue, payrollPaid, closingTreasury: academy.treasury, obligationCoverage, reserveCoverage};
  });
}

function evidence(candidate: AcademyContractCandidate, status: AcademyContractStatus, salaryAfter: number, contractYearsAfter: number, optionYearsAfter: number, demand: number, offer: number, offerCeiling: number, arbitrationAward: number | undefined, due: number, paid: number, concessionWhiteBoxShadow?: AcademyContractConcessionShadow): AcademyContractEvidence {
  const arrears = due - paid;
  return {childId: candidate.childId, childName: candidate.childName, academyId: candidate.academyId, status, salaryBefore: candidate.annualSalary, salaryAfter, contractYearsBefore: candidate.contractYears, contractYearsAfter, optionYearsBefore: candidate.optionYears, optionYearsAfter, demand, offer, offerCeiling, arbitrationAward, due, paid, arrears, released: status === "released" || status === "defaulted", concessionWhiteBoxShadow};
}
function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0); }
