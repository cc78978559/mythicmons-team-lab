import assert from "node:assert/strict";
import {createNoviceProfiles} from "../draft/managerProfiles";
import {founderLineage, type EvolutionCompetitor} from "../draft/naturalEvolution";
import {runPunctuatedEvolution} from "../draft/punctuatedEvolution";

const profiles = createNoviceProfiles(6);
const competitors: EvolutionCompetitor[] = profiles.map((profile, index) => ({
  slotId: profile.id,
  profile,
  lineage: founderLineage(profile.id),
  points: 6 - index,
  rank: index + 1,
  playoffScore: index === 0 ? 1 : index < 4 ? .4 : 0,
  champion: index === 0,
  behavior: {pace: .5, lineupVariation: .5, starInvestment: .5, roleBreadth: .5, rosterTurnover: .5, knockoutPressure: .5},
}));

const season1 = runPunctuatedEvolution({competitors, season: 1, seed: "punctuated-smoke"});
assert.equal(season1.descendants.length, 0, "A new population must first accumulate evidence");
assert.equal(season1.budget.cheapEvaluations, 0);
assert(season1.decisions.every(entry => entry.after.stableSeasons === 1));

const season2 = runPunctuatedEvolution({competitors, season: 2, seed: "punctuated-smoke", previousState: season1.state});
assert(season2.descendants.length >= 1 && season2.descendants.length <= 2, "Dynamic budget must bound simultaneous bursts");
assert(season2.budget.candidateCount >= 4 && season2.budget.candidateCount <= 8);
assert.equal(season2.budget.cheapEvaluations, season2.budget.burstSlots * season2.budget.candidateCount);
assert.equal(season2.decisions.flatMap(entry => entry.candidates).filter(entry => entry.selected).length, season2.descendants.length);
assert(season2.decisions.flatMap(entry => entry.candidates).every(entry => /^[a-f0-9]{64}$/.test(entry.programHash) && /^[a-f0-9]{64}$/.test(entry.programBehaviorHash)));
assert(season2.decisions.flatMap(entry => entry.candidates).every(entry => entry.programNodes >= 5 && entry.programBehaviorDistance >= 0));
assert(season2.decisions.filter(entry => entry.selected).every(entry => entry.after.phase === "burst" && entry.after.cooldownUntilSeason === 5));

const repeat = runPunctuatedEvolution({competitors, season: 2, seed: "punctuated-smoke", previousState: season1.state});
assert.deepEqual(repeat, season2, "Fixed seeds must reproduce triggers, candidates, and winners");

let state = season2.state;
for (let season = 3; season <= 5; season += 1) {
  const result = runPunctuatedEvolution({competitors, season, seed: "punctuated-smoke", previousState: state});
  const previouslySelected = season2.decisions.filter(entry => entry.selected).map(entry => entry.managerId);
  assert(result.decisions.filter(entry => previouslySelected.includes(entry.managerId)).every(entry => !entry.selected && entry.after.phase === "consolidating"), "Cooldown must prevent immediate repeated mutation");
  state = result.state;
}

const shocked = runPunctuatedEvolution({competitors, season: 2, seed: "punctuated-shock", previousState: season1.state, config: {environmentalShock: 1, maxBurstManagers: 2}});
assert.equal(shocked.budget.burstSlots, 2);
assert.equal(shocked.budget.candidateCount, 8);
assert.equal(shocked.descendants.length, 2);
console.log("Punctuated evolution smoke passed: accumulation, dynamic budget, deterministic candidates, cooldown, and shock response");
