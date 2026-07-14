export type AssetClass = "standard" | "elite-ordinary" | "legendary" | "unique-custom";
export type ContractStatus = "controlled" | "arbitration" | "rfa" | "ufa" | "tagged";

export interface MarketRules {
  salaryCap: number;
  salaryFloor: number;
  taxLine: number;
  hardApron: number;
  baseCash: number;
  carryRate: number;
  carryCap: number;
}

export const V10_MARKET_RULES: MarketRules = {
  salaryCap: 100,
  salaryFloor: 75,
  taxLine: 110,
  hardApron: 120,
  baseCash: 35,
  carryRate: .5,
  carryCap: 15,
};

export interface SportsContract {
  assetId: string;
  family: string;
  pokemon: string;
  salary: number;
  yearsRemaining: number;
  serviceYears: number;
  guaranteeRate: number;
  status: ContractStatus;
  originalTeamId: string;
  acquiredSeason: number;
  acquisitionCost: number;
  marketValue: number;
  assetClass: AssetClass;
  tagCount: number;
}

export interface MarketPerformance {
  winShare: number;
  koShare: number;
  usage: number;
  playoffImpact: number;
  roleScarcity: number;
  lineupLift: number;
  availability: number;
}

export interface ContractOffer {
  teamId: string;
  salary: number;
  years: number;
  guaranteeRate: number;
}

export interface PayrollResult {
  payroll: number;
  floorPenalty: number;
  luxuryTax: number;
  legal: boolean;
}

export function payrollResult(contracts: readonly SportsContract[], deadMoney = 0, rules = V10_MARKET_RULES): PayrollResult {
  const payroll = round(contracts.reduce((sum, contract) => sum + contract.salary, 0) + deadMoney);
  const floorPenalty = Math.max(0, rules.salaryFloor - payroll);
  const luxuryTax = payroll <= rules.taxLine ? 0
    : payroll <= rules.taxLine + 5 ? (payroll - rules.taxLine) * 1.5
      : 7.5 + (payroll - rules.taxLine - 5) * 2.5;
  return {payroll, floorPenalty: round(floorPenalty), luxuryTax: round(luxuryTax), legal: payroll <= rules.hardApron};
}

export function startingCash(previousCash: number, rules = V10_MARKET_RULES): number {
  return rules.baseCash + Math.min(rules.carryCap, Math.floor(Math.max(0, previousCash) * rules.carryRate));
}

export function initialContract(input: {
  assetId: string; family: string; pokemon: string; teamId: string; season: number;
  marketValue: number; acquisitionCost: number; assetClass: AssetClass;
}): SportsContract {
  const guaranteeRate = input.assetClass === "standard" ? .2 : input.assetClass === "elite-ordinary" ? .3 : .35;
  return {
    assetId: input.assetId,
    family: input.family,
    pokemon: input.pokemon,
    salary: integerClamp(.6 * input.marketValue + .4 * input.acquisitionCost, 2, 30),
    yearsRemaining: 2,
    serviceYears: 0,
    guaranteeRate,
    status: "controlled",
    originalTeamId: input.teamId,
    acquiredSeason: input.season,
    acquisitionCost: input.acquisitionCost,
    marketValue: input.marketValue,
    assetClass: input.assetClass,
    tagCount: 0,
  };
}

export function advanceContract(contract: SportsContract): SportsContract {
  const serviceYears = contract.serviceYears + 1;
  const yearsRemaining = Math.max(0, contract.yearsRemaining - 1);
  let status = contract.status;
  if (yearsRemaining === 0) status = serviceYears < 2 ? "controlled" : serviceYears === 2 ? "arbitration" : serviceYears === 3 ? "rfa" : "ufa";
  return {...contract, serviceYears, yearsRemaining, status, salary: yearsRemaining > 0 ? Math.ceil(contract.salary * 1.08) : contract.salary};
}

export function performanceScore(value: MarketPerformance): number {
  return clamp01(.24 * value.winShare + .18 * value.koShare + .14 * value.usage + .14 * value.playoffImpact
    + .12 * value.roleScarcity + .1 * normalizeLift(value.lineupLift) + .08 * value.availability);
}

export function nextMarketValue(previous: number, medianBid: number, comparablePrice: number, performancePrice: number, breakoutSeasons = 0): number {
  const raw = .5 * previous + .25 * medianBid + .15 * comparablePrice + .1 * performancePrice;
  const lower = previous * .65;
  const upper = breakoutSeasons >= 2 ? Number.POSITIVE_INFINITY : previous * 1.6;
  return integerClamp(raw, Math.max(2, lower), Math.max(2, upper));
}

export function arbitrationSalary(contract: SportsContract, performancePrice: number): number {
  const raw = .25 * contract.salary + .45 * contract.marketValue + .3 * performancePrice;
  return integerClamp(raw, contract.salary * 1.1, contract.salary * 1.8);
}

export function offerNpv(offer: ContractOffer): number {
  let value = 0;
  for (let year = 0; year < offer.years; year += 1) value += offer.salary / Math.pow(1.06, year);
  return value + 4 * offer.guaranteeRate;
}

export function chooseRfaOffer(offers: readonly ContractOffer[]): ContractOffer | undefined {
  return [...offers].filter(validOffer).sort((a, b) => offerNpv(b) - offerNpv(a) || b.guaranteeRate - a.guaranteeRate || a.teamId.localeCompare(b.teamId))[0];
}

export function matchingContract(contract: SportsContract, offer: ContractOffer, teamId: string): SportsContract {
  return {...contract, salary: offer.salary, yearsRemaining: offer.years, guaranteeRate: offer.guaranteeRate, status: "controlled", originalTeamId: teamId};
}

export function taggedContract(contract: SportsContract, topFiveComparable: number): SportsContract | undefined {
  if (!['legendary', 'unique-custom'].includes(contract.assetClass) || contract.tagCount >= 2) return undefined;
  const salary = contract.tagCount === 0 ? Math.max(Math.ceil(contract.salary * 1.2), topFiveComparable) : Math.ceil(contract.salary * 1.5);
  return {...contract, salary, yearsRemaining: 1, guaranteeRate: 1, status: "tagged", tagCount: contract.tagCount + 1};
}

export function releaseDeadMoney(contract: SportsContract): {current: number; next: number} {
  const guaranteed = contract.guaranteeRate * contract.salary * Math.max(1, contract.yearsRemaining);
  return {current: round(guaranteed * .7), next: round(guaranteed * .3)};
}

export function tradeValue(input: {competitiveValue: number; contract: SportsContract; deadMoneyRisk?: number}): number {
  const years = Math.max(0, input.contract.yearsRemaining);
  const surplus = Math.max(0, input.contract.marketValue - input.contract.salary);
  return round(input.competitiveValue + 4 * years + .6 * surplus * years - (input.deadMoneyRisk ?? 0));
}

export function tradeAcceptable(beforeUtility: number, afterUtility: number, contenderProbability: number): boolean {
  return afterUtility - beforeUtility >= -(2 + 4 * clamp01(contenderProbability));
}

export function waiverPriority(input: {winPct: number; roundsSinceClaim: number}): number {
  return .6 * (1 - clamp01(input.winPct)) + .4 * clamp01(input.roundsSinceClaim / 16);
}

export function waiverWinner(claims: readonly {teamId: string; winPct: number; roundsSinceClaim: number}[]): string | undefined {
  return [...claims].sort((a, b) => waiverPriority(b) - waiverPriority(a) || a.teamId.localeCompare(b.teamId))[0]?.teamId;
}

function validOffer(offer: ContractOffer): boolean {
  return offer.salary >= 2 && offer.years >= 1 && offer.years <= 4 && offer.guaranteeRate >= 0 && offer.guaranteeRate <= 1;
}

function normalizeLift(value: number): number { return clamp01(.5 + value * .5); }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function round(value: number): number { return Math.round(value * 100) / 100; }
function integerClamp(value: number, minimum: number, maximum: number): number { return Math.round(Math.max(minimum, Math.min(maximum, value))); }
