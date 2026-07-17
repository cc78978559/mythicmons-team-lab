import type {WhiteBoxContribution} from "./decision";
import {BID_SHADOW_PARAMETERS} from "./parameters";

export const WHITE_BOX_BID_VERSION = "white-box-bid-v1";

export interface WhiteBoxBidInput {
  decisionId: string;
  managerId: string;
  candidateId: string;
  mode: "standard" | "sports-market";
  budget: number;
  reserve: number;
  market: number;
  fit: number;
  fundamental: number;
  starPremium: number;
  bidAggression: number;
  cashUtility: number;
  remainingNeed: number;
  scarceMultiplier: number;
  shade: number;
  hardRejections?: string[];
  parameters?: Readonly<Record<string, number>>;
}

export interface WhiteBoxBidTrace {
  version: typeof WHITE_BOX_BID_VERSION;
  decisionId: string;
  managerId: string;
  candidateId: string;
  mode: WhiteBoxBidInput["mode"];
  hardRejections: string[];
  parameters: Record<string, number>;
  budget: number;
  reserve: number;
  availableBudget: number;
  contributions: WhiteBoxContribution[];
  demandBeforeScarcity: number;
  scarceMultiplier: number;
  rawCeiling: number;
  roundedCeiling: number;
  ceiling: number;
  shade: number;
  bid: number;
}

export function evaluateWhiteBoxBid(input: WhiteBoxBidInput): WhiteBoxBidTrace {
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`Non-finite bid input ${key}`);
  }
  const hardRejections = [...(input.hardRejections ?? [])];
  const parameters = BID_SHADOW_PARAMETERS.snapshot(input.parameters).values;
  const contributions = input.mode === "sports-market"
    ? [
        contribution("bid.fundamental", "fundamental", "competence", input.fundamental * parameters["bid.sports.fundamentalweight"], "Independent strength, synergy, and role fundamentals"),
        contribution("bid.aggression", "personality", "personality", input.fundamental * input.bidAggression * parameters["bid.sports.aggressionweight"], "Bid aggression applied to fundamentals"),
        contribution("bid.marketanchor", "market", "context", input.market * parameters["bid.sports.marketweight"], "Weak reference-price anchor"),
        contribution("bid.cashdiscipline", "risk", "risk", -input.cashUtility * input.remainingNeed * parameters["bid.cashdisciplineweight"], "Cash reserved for remaining roster needs"),
      ]
    : [
        contribution("bid.marketbase", "market", "competence", input.market * parameters["bid.standard.marketweight"], "Reference market value"),
        contribution("bid.starpremium", "personality", "personality", input.market * input.starPremium * parameters["bid.standard.starpremiumweight"], "Premium-member willingness"),
        contribution("bid.fitbase", "fit", "competence", input.fit * parameters["bid.standard.fitweight"], "Candidate strength and roster fit"),
        contribution("bid.aggression", "personality", "personality", input.fit * input.bidAggression * parameters["bid.standard.aggressionweight"], "Bid aggression applied to fit"),
        contribution("bid.cashdiscipline", "risk", "risk", -input.cashUtility * input.remainingNeed * parameters["bid.cashdisciplineweight"], "Cash reserved for remaining roster needs"),
      ];
  const availableBudget = Math.max(0, input.budget - input.reserve);
  const demandBeforeScarcity = contributions.reduce((total, entry) => total + entry.value, 0);
  const rawCeiling = demandBeforeScarcity * input.scarceMultiplier;
  const roundedCeiling = Math.round(rawCeiling);
  const ceiling = hardRejections.length ? 0 : Math.max(0, Math.min(input.budget - input.reserve, roundedCeiling));
  const shade = hardRejections.length ? 0 : Math.max(0, Math.floor(input.shade));
  const bid = Math.max(0, ceiling - shade);
  return {
    version: WHITE_BOX_BID_VERSION,
    decisionId: input.decisionId,
    managerId: input.managerId,
    candidateId: input.candidateId,
    mode: input.mode,
    hardRejections,
    parameters,
    budget: input.budget,
    reserve: input.reserve,
    availableBudget,
    contributions: contributions.map(entry => ({...entry, value: round(entry.value)})),
    demandBeforeScarcity: round(demandBeforeScarcity),
    scarceMultiplier: round(input.scarceMultiplier),
    rawCeiling: round(rawCeiling),
    roundedCeiling,
    ceiling,
    shade,
    bid,
  };
}

function contribution(id: string, group: string, source: WhiteBoxContribution["source"], value: number, reason: string): WhiteBoxContribution {
  return {id, group, source, value, reason};
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}
