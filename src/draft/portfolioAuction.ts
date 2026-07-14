import crypto from "node:crypto";

export interface PortfolioBid {
  managerId: string;
  assetId: string;
  bid: number;
  utility: number;
}

export interface PortfolioManagerLimit {
  managerId: string;
  budget: number;
  reserve: number;
  maxWins: number;
}

export interface PortfolioAward {
  assetId: string;
  managerId: string;
  bid: number;
  payment: number;
  utility: number;
  runnerUpBid: number;
}

interface SearchState {
  score: number;
  awards: PortfolioAward[];
  spent: Record<string, number>;
  wins: Record<string, number>;
}

export function solvePortfolioAuction(
  assetIds: readonly string[],
  bids: readonly PortfolioBid[],
  limits: readonly PortfolioManagerLimit[],
  seed: string,
  beamWidth = 600,
): PortfolioAward[] {
  const limitByManager = new Map(limits.map(limit => [limit.managerId, limit]));
  const bidsByAsset = new Map(assetIds.map(assetId => [assetId, bids.filter(bid => bid.assetId === assetId && bid.bid > 0).sort((a, b) => b.bid - a.bid || b.utility - a.utility || priority(seed, assetId, a.managerId) - priority(seed, assetId, b.managerId))]));
  const orderedAssets = [...assetIds].sort((left, right) => {
    const leftBids = bidsByAsset.get(left) ?? [];
    const rightBids = bidsByAsset.get(right) ?? [];
    return (rightBids[1]?.bid ?? rightBids[0]?.bid ?? 0) - (leftBids[1]?.bid ?? leftBids[0]?.bid ?? 0)
      || rightBids.length - leftBids.length
      || left.localeCompare(right);
  });
  let states: SearchState[] = [{score: 0, awards: [], spent: {}, wins: {}}];
  for (const assetId of orderedAssets) {
    const assetBids = (bidsByAsset.get(assetId) ?? []).slice(0, 12);
    const next: SearchState[] = [];
    for (const state of states) {
      next.push(state);
      for (const bid of assetBids) {
        const limit = limitByManager.get(bid.managerId);
        if (!limit || (state.wins[bid.managerId] ?? 0) >= limit.maxWins) continue;
        const runnerUpBid = assetBids.find(candidate => candidate.managerId !== bid.managerId)?.bid ?? 0;
        const payment = Math.min(bid.bid, Math.max(1, runnerUpBid + 1));
        if ((state.spent[bid.managerId] ?? 0) + payment > limit.budget - limit.reserve) continue;
        const fairness = priority(seed, assetId, bid.managerId) * 1e-9;
        next.push({
          score: state.score + bid.utility + bid.bid * .02 - payment * .002 - fairness,
          awards: [...state.awards, {assetId, managerId: bid.managerId, bid: bid.bid, payment, utility: bid.utility, runnerUpBid}],
          spent: {...state.spent, [bid.managerId]: (state.spent[bid.managerId] ?? 0) + payment},
          wins: {...state.wins, [bid.managerId]: (state.wins[bid.managerId] ?? 0) + 1},
        });
      }
    }
    states = deduplicate(next).sort((a, b) => b.score - a.score || b.awards.length - a.awards.length).slice(0, beamWidth);
  }
  return states[0]?.awards ?? [];
}

function deduplicate(states: SearchState[]): SearchState[] {
  const best = new Map<string, SearchState>();
  for (const state of states) {
    const assignments = state.awards.map(award => `${award.assetId}:${award.managerId}`).sort().join("|");
    const key = `${assignments}/${Object.entries(state.spent).sort().map(([id, value]) => `${id}:${value}`).join("|")}/${Object.entries(state.wins).sort().map(([id, value]) => `${id}:${value}`).join("|")}`;
    const previous = best.get(key);
    if (!previous || state.score > previous.score) best.set(key, state);
  }
  return [...best.values()];
}

function priority(seed: string, assetId: string, managerId: string): number {
  return Number.parseInt(crypto.createHash("sha256").update(`${seed}:${assetId}:${managerId}`).digest("hex").slice(0, 8), 16);
}
