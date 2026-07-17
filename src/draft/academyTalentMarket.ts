import type {ManagerProfile} from "./managerProfiles";
import type {AcademyState} from "./academyEnvironment";
import {personalitySimilarity} from "./personalitySimilarity";

export type AcademyMarketPolicy = "shadow" | "active";
export type ManagerConsentPolicy = "enforce" | "ignore";
export type ContractNegotiationPolicy = "enforce" | "ignore";
export type AcademyTransactionKind = "free-agent" | "transfer" | "loan";
export interface AcademyTalentCandidate {childId: string; childName: string; rightsHolderId: string; optionYears: number; annualSalary: number; contractYears: number; profile: ManagerProfile; averageRank?: number; capacity?: number}
export interface AcademyTalentMarketRules {policy: AcademyMarketPolicy; consentPolicy: ManagerConsentPolicy; consentThreshold: number; contractPolicy: ContractNegotiationPolicy; baseSalary: number; maximumSalary: number; offerMultiplier?: number; prepaidSeasons: number; contractYears: number; maximumTransactions: number; signingFee: number; transferFee: number; loanFee: number; transferMinimumFitDelta: number; loanMinimumFitDelta: number; freeAgentOptionYears: number; acquisitionBlockedAcademyIds?: string[]; emergencySaleAcademyIds?: string[]; emergencySaleDiscountPercent?: number}
export interface ManagerMarketPreferences {loyalty: number; ambition: number; opportunityNeed: number; cultureTolerance: number}
export interface ManagerConsentEvidence {policy: ManagerConsentPolicy; threshold: number; score: number; accepted: boolean; base: number; cultureBenefit: number; qualityBenefit: number; opportunityBenefit: number; securityBenefit: number; loyaltyCost: number; preferences: ManagerMarketPreferences}
export interface ManagerContractEvidence {policy: ContractNegotiationPolicy; demand: number; offer: number; gap: number; accepted: boolean; currentSalary: number; prepaidSeasons: number; salaryCost: number; ambitionPremium: number; prestigePremium: number; culturePremium: number; qualityPremium: number}
export interface AcademyTalentTransaction {kind: AcademyTransactionKind; status: "proposed" | "executed" | "rejected"; rejectionReason?: "manager-consent" | "contract-gap"; financialIntervention?: "emergency-sale"; childId: string; childName: string; fromAcademyId?: string; toAcademyId: string; fee: number; currentFit: number; targetFit: number; fitDelta: number; rightsHolderAfter: string; developmentAcademyId: string; optionYearsAfter: number; annualSalaryAfter: number; contractYearsAfter: number; consent: ManagerConsentEvidence; contract: ManagerContractEvidence}
export interface AcademyTalentMarketResult {transactions: AcademyTalentTransaction[]; emergencySaleCandidates: number; balances: Record<string, number>; assignments: Record<string, {rightsHolderId: string; developmentAcademyId: string; optionYears: number; annualSalary: number; contractYears: number}>; signingOutflow: number; salaryOutflow: number; internalFees: number; budgetBefore: number; budgetAfter: number; conservationError: number}

export function runAcademyTalentMarket(candidates: readonly AcademyTalentCandidate[], academies: readonly AcademyState[], rules: AcademyTalentMarketRules): AcademyTalentMarketResult {
  const originalBalances = Object.fromEntries(academies.map(academy => [academy.academyId, academy.treasury])), working = {...originalBalances};
  const assignments = Object.fromEntries(candidates.map(candidate => [candidate.childId, {rightsHolderId: candidate.rightsHolderId, developmentAcademyId: candidate.rightsHolderId, optionYears: candidate.optionYears, annualSalary: candidate.annualSalary, contractYears: candidate.contractYears}]));
  const transactions: AcademyTalentTransaction[] = [];
  const blocked = new Set(rules.acquisitionBlockedAcademyIds ?? []);
  const emergencySellers = new Set(rules.emergencySaleAcademyIds ?? []), emergencyDiscount = Math.max(0, Math.min(1, (rules.emergencySaleDiscountPercent ?? 25) / 100));
  let settled = 0;
  for (const candidate of [...candidates].sort((a, b) => a.childId.localeCompare(b.childId))) {
    if (settled >= rules.maximumTransactions) break;
    const currentAcademy = academies.find(academy => academy.academyId === candidate.rightsHolderId), currentFit = currentAcademy ? personalitySimilarity(candidate.profile, currentAcademy.tradition).similarity : 0;
    const isFreeAgent = candidate.optionYears <= 0, emergencySale = !isFreeAgent && emergencySellers.has(candidate.rightsHolderId), fee = isFreeAgent ? rules.signingFee : emergencySale ? rules.transferFee * (1 - emergencyDiscount) : rules.transferFee;
    const choices = academies.filter(academy => !blocked.has(academy.academyId) && (isFreeAgent || academy.academyId !== candidate.rightsHolderId) && (working[academy.academyId] ?? 0) >= Math.min(fee, rules.loanFee)).map(academy => ({academy, fit: personalitySimilarity(candidate.profile, academy.tradition).similarity})).sort((a, b) => b.fit - a.fit || a.academy.academyId.localeCompare(b.academy.academyId));
    const choice = choices[0];
    if (!choice) continue;
    const delta = choice.fit - currentFit;
    let kind: AcademyTransactionKind, transactionFee: number;
    if (isFreeAgent) { kind = "free-agent"; transactionFee = rules.signingFee; }
    else if ((emergencySale || delta >= rules.transferMinimumFitDelta) && (working[choice.academy.academyId] ?? 0) >= fee) { kind = "transfer"; transactionFee = fee; }
    else if (delta >= rules.loanMinimumFitDelta && (working[choice.academy.academyId] ?? 0) >= rules.loanFee) { kind = "loan"; transactionFee = rules.loanFee; }
    else continue;
    const rightsHolderAfter = kind === "loan" ? candidate.rightsHolderId : choice.academy.academyId, developmentAcademyId = choice.academy.academyId, optionYearsAfter = kind === "free-agent" ? rules.freeAgentOptionYears : candidate.optionYears;
    const consent = managerConsent(candidate, kind, currentAcademy, choice.academy, currentFit, choice.fit, optionYearsAfter, rules);
    const contract = negotiateContract(candidate, choice.academy, choice.fit, rules, Math.max(0, (working[choice.academy.academyId] ?? 0) - transactionFee));
    const financialIntervention = emergencySale && kind === "transfer" ? "emergency-sale" as const : undefined;
    if (!consent.accepted && rules.consentPolicy === "enforce") { transactions.push({kind, status: "rejected", rejectionReason: "manager-consent", financialIntervention, childId: candidate.childId, childName: candidate.childName, fromAcademyId: kind === "free-agent" ? undefined : candidate.rightsHolderId, toAcademyId: choice.academy.academyId, fee: transactionFee, currentFit, targetFit: choice.fit, fitDelta: delta, rightsHolderAfter: candidate.rightsHolderId, developmentAcademyId: candidate.rightsHolderId, optionYearsAfter: candidate.optionYears, annualSalaryAfter: candidate.annualSalary, contractYearsAfter: candidate.contractYears, consent, contract}); continue; }
    if (!contract.accepted && rules.contractPolicy === "enforce") { transactions.push({kind, status: "rejected", rejectionReason: "contract-gap", financialIntervention, childId: candidate.childId, childName: candidate.childName, fromAcademyId: kind === "free-agent" ? undefined : candidate.rightsHolderId, toAcademyId: choice.academy.academyId, fee: transactionFee, currentFit, targetFit: choice.fit, fitDelta: delta, rightsHolderAfter: candidate.rightsHolderId, developmentAcademyId: candidate.rightsHolderId, optionYearsAfter: candidate.optionYears, annualSalaryAfter: candidate.annualSalary, contractYearsAfter: candidate.contractYears, consent, contract}); continue; }
    working[choice.academy.academyId] -= transactionFee + contract.salaryCost;
    if (kind !== "free-agent" && candidate.rightsHolderId in working) working[candidate.rightsHolderId] += transactionFee;
    assignments[candidate.childId] = {rightsHolderId: rightsHolderAfter, developmentAcademyId, optionYears: optionYearsAfter, annualSalary: contract.offer, contractYears: rules.contractYears};
    transactions.push({kind, status: rules.policy === "active" ? "executed" : "proposed", financialIntervention, childId: candidate.childId, childName: candidate.childName, fromAcademyId: kind === "free-agent" ? undefined : candidate.rightsHolderId, toAcademyId: choice.academy.academyId, fee: transactionFee, currentFit, targetFit: choice.fit, fitDelta: delta, rightsHolderAfter, developmentAcademyId, optionYearsAfter, annualSalaryAfter: contract.offer, contractYearsAfter: rules.contractYears, consent, contract});
    settled += 1;
  }
  const active = rules.policy === "active", balances = active ? working : originalBalances;
  if (!active) for (const candidate of candidates) assignments[candidate.childId] = {rightsHolderId: candidate.rightsHolderId, developmentAcademyId: candidate.rightsHolderId, optionYears: candidate.optionYears, annualSalary: candidate.annualSalary, contractYears: candidate.contractYears};
  const executed = active ? transactions.filter(transaction => transaction.status === "executed") : [], signingOutflow = executed.filter(transaction => transaction.kind === "free-agent").reduce((sum, transaction) => sum + transaction.fee, 0), salaryOutflow = executed.reduce((sum, transaction) => sum + transaction.contract.salaryCost, 0), internalFees = executed.filter(transaction => transaction.kind !== "free-agent").reduce((sum, transaction) => sum + transaction.fee, 0);
  const budgetBefore = sum(Object.values(originalBalances)), budgetAfter = sum(Object.values(balances));
  const emergencySaleCandidates = candidates.filter(candidate => candidate.optionYears > 0 && emergencySellers.has(candidate.rightsHolderId)).length;
  return {transactions, emergencySaleCandidates, balances, assignments, signingOutflow, salaryOutflow, internalFees, budgetBefore, budgetAfter, conservationError: budgetBefore - signingOutflow - salaryOutflow - budgetAfter};
}

export function managerMarketPreferences(candidate: AcademyTalentCandidate): ManagerMarketPreferences {
  const profile = candidate.profile, organization = profile.genome?.organization ?? {}, rankNeed = candidate.capacity && candidate.capacity > 1 && candidate.averageRank ? (candidate.averageRank - 1) / (candidate.capacity - 1) : .5;
  return {loyalty: clamp(average([profile.traits.value, profile.traits.synergy, profile.learning.memoryDecay, organization.continuity ?? .5])), ambition: clamp(average([profile.traits.stars, profile.traits.risk, profile.learning.exploration])), opportunityNeed: clamp(rankNeed), cultureTolerance: clamp(average([profile.traits.flexibility, profile.traits.counter, organization.experimentation ?? .5]))};
}

function managerConsent(candidate: AcademyTalentCandidate, kind: AcademyTransactionKind, current: AcademyState | undefined, target: AcademyState, currentFit: number, targetFit: number, optionYearsAfter: number, rules: AcademyTalentMarketRules): ManagerConsentEvidence {
  const preferences = managerMarketPreferences(candidate), base = kind === "free-agent" ? .58 : kind === "loan" ? .52 : .48;
  const cultureBenefit = (targetFit - currentFit) * (.65 + preferences.cultureTolerance * .35), qualityBenefit = (target.quality - (current?.quality ?? .5)) * (.25 + preferences.ambition * .45), opportunityBenefit = preferences.opportunityNeed * (kind === "loan" ? .18 : .12), securityBenefit = Math.min(1, optionYearsAfter / 3) * (1 - preferences.ambition) * (kind === "loan" ? .03 : .12), loyaltyCost = preferences.loyalty * (kind === "transfer" ? .24 : kind === "loan" ? .1 : .03);
  const score = clamp(base + cultureBenefit + qualityBenefit + opportunityBenefit + securityBenefit - loyaltyCost), accepted = score >= rules.consentThreshold;
  return {policy: rules.consentPolicy, threshold: rules.consentThreshold, score, accepted, base, cultureBenefit, qualityBenefit, opportunityBenefit, securityBenefit, loyaltyCost, preferences};
}

function negotiateContract(candidate: AcademyTalentCandidate, target: AcademyState, targetFit: number, rules: AcademyTalentMarketRules, availableAfterFee: number): ManagerContractEvidence {
  const preferences = managerMarketPreferences(candidate), ambitionPremium = preferences.ambition * .55, prestigePremium = (1 - preferences.opportunityNeed) * .35, culturePremium = targetFit * .2, qualityPremium = target.quality * .25;
  const demand = Math.max(candidate.annualSalary, rules.baseSalary * (.65 + ambitionPremium + prestigePremium)), desiredOffer = rules.baseSalary * (.6 + culturePremium + qualityPremium + preferences.opportunityNeed * .15) * Math.max(0, rules.offerMultiplier ?? 1), affordableAnnual = rules.prepaidSeasons > 0 ? availableAfterFee / rules.prepaidSeasons : rules.maximumSalary, offer = Math.max(0, Math.min(rules.maximumSalary, desiredOffer, affordableAnnual)), accepted = offer + 1e-9 >= demand, salaryCost = offer * rules.prepaidSeasons;
  return {policy: rules.contractPolicy, demand, offer, gap: offer - demand, accepted, currentSalary: candidate.annualSalary, prepaidSeasons: rules.prepaidSeasons, salaryCost, ambitionPremium, prestigePremium, culturePremium, qualityPremium};
}

function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0); }
function average(values: number[]): number { return sum(values) / Math.max(1, values.length); }
function clamp(value: number): number { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : .5)); }
