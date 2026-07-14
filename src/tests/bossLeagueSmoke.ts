import assert from "node:assert/strict";
import {RED_BOSS, assertBossAssetsExcluded, initialBossState, openChallengeOrder, openingQualifierRound, recordBossChallenge, seededKnockoutRound, volunteerChallengeOrder} from "../draft/bossLeague";

const entrants = Array.from({length: 30}, (_, index) => ({id: `manager-${index + 1}`, seed: index + 1}));
const opening = openingQualifierRound(entrants);
assert.deepEqual(opening.byes.map(team => team.seed), [1, 2]);
assert.equal(opening.matches.length, 14);
assert.deepEqual(opening.matches[0].map(team => team.seed), [3, 30]);
assert.equal(seededKnockoutRound([...opening.byes, ...opening.matches.map(match => match[0])]).length, 8);
assert.deepEqual(openChallengeOrder(entrants, 1).map(team => team.seed), entrants.map(team => team.seed));
assert.deepEqual(openChallengeOrder(entrants, 2).slice(0, 3).map(team => team.seed), [2, 3, 4]);
assert.equal(openChallengeOrder(entrants, 30).at(-1)?.seed, 29);
const volunteers = entrants.map((team, index) => ({...team, preference: index < 4 ? 2 : 1}));
const volunteerOrder = volunteerChallengeOrder(volunteers, "public-lottery");
assert.equal(volunteerOrder.slice(0, 26).every(team => team.preference === 1), true);
assert.deepEqual(volunteerChallengeOrder(volunteers, "public-lottery"), volunteerOrder);

const active = initialBossState(RED_BOSS);
assert.deepEqual(recordBossChallenge(RED_BOSS, active, 1, "manager-1", false), {state: active, points: 0});
const victory = recordBossChallenge(RED_BOSS, active, 2, "manager-2", true);
assert.equal(victory.points, 3);
assert.equal(victory.state.active, false);
assert.equal(victory.state.defeatedBy, "manager-2");
assert.doesNotThrow(() => assertBossAssetsExcluded(["pikachu:standard:1"], [RED_BOSS]));
assert.throws(() => assertBossAssetsExcluded(["boss-red-pikachu"], [RED_BOSS]));
console.log("boss league smoke passed");
