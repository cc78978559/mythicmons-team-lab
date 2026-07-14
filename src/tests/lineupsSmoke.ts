import assert from "node:assert/strict";
import {assertBattleLineup, chooseK} from "../draft/lineups";

for (let rosterSize = 6; rosterSize <= 10; rosterSize += 1) {
  const roster = Array.from({length: rosterSize}, (_, index) => index);
  const lineups = chooseK(roster, 6);
  assert.equal(lineups.length, combination(rosterSize, 6));
  assert(lineups.every(lineup => lineup.length === 6));
  assert(lineups.every(lineup => new Set(lineup).size === 6));
}
assert.throws(() => assertBattleLineup([1, 2, 3, 4], "manager-test"), /illegal 4-member/);
console.log("Strict 6v6 lineup smoke test passed");

function combination(n: number, k: number): number {
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = result * (n - index + 1) / index;
  return result;
}
