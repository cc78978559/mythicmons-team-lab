import type {WhiteBoxBidTrace} from "./auction";

export const WHITE_BOX_BID_COUNTERFACTUAL_POLICY = "unshaded-ceiling-experiment" as const;

export interface WhiteBoxBidApprovalInput {
  auctionMode: string;
  bidderId: string;
  incumbentWinnerId: string | null;
  highestCompetingBid: number;
  trace: WhiteBoxBidTrace;
}

export interface WhiteBoxBidApproval {
  policy: typeof WHITE_BOX_BID_COUNTERFACTUAL_POLICY;
  recommended: boolean;
  incumbentBid: number;
  candidateBid: number;
  highestCompetingBid: number;
  reasons: string[];
}

/**
 * Admit only a source-observed, outcome-changing sequential-auction intervention.
 * The candidate removes the existing random shade but never exceeds the already
 * audited budget-and-reserve ceiling. Strictly beating the source leader avoids
 * relying on an unretained tie-break state.
 */
export function evaluateWhiteBoxBidApproval(input: WhiteBoxBidApprovalInput): WhiteBoxBidApproval {
  const reasons: string[] = [];
  const trace = input.trace;
  if (input.auctionMode !== "sequential") reasons.push("portfolio-auction-requires-dedicated-replay");
  if (trace.version !== "white-box-bid-v1") reasons.push("invalid-white-box-bid-trace");
  if (trace.managerId !== input.bidderId) reasons.push("bidder-trace-mismatch");
  if (trace.hardRejections.length) reasons.push("hard-rejection-present");
  if (trace.ceiling > trace.availableBudget) reasons.push("ceiling-exceeds-available-budget");
  if (trace.shade <= 0 || trace.ceiling <= trace.bid) reasons.push("no-removable-bid-shade");
  if (input.incumbentWinnerId === input.bidderId) reasons.push("incumbent-already-wins");
  if (trace.ceiling <= input.highestCompetingBid) reasons.push("candidate-does-not-strictly-win");
  return {
    policy: WHITE_BOX_BID_COUNTERFACTUAL_POLICY,
    recommended: reasons.length === 0,
    incumbentBid: trace.bid,
    candidateBid: trace.ceiling,
    highestCompetingBid: input.highestCompetingBid,
    reasons,
  };
}
