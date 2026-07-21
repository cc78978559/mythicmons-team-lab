import assert from "node:assert/strict";
import {compareWhiteBoxShadow, evaluateWhiteBoxDecision, summarizeWhiteBoxShadow, type WhiteBoxContribution} from "../ai/whiteBox/decision";
import {buildLineupWhiteBoxCandidate, evaluateLineupAssistGate, whiteBoxCandidateTotal, type WhiteBoxLineupMember, type WhiteBoxLineupTraits} from "../ai/whiteBox/lineup";
import {evaluateBattleAssistGate} from "../ai/whiteBox/battle";
import {buildKeeperPortfolioCandidate, keeperPortfolioId} from "../ai/whiteBox/keeper";
import {buildAcquisitionWhiteBoxCandidate} from "../ai/whiteBox/acquisition";
import {evaluateWhiteBoxBid} from "../ai/whiteBox/auction";
import {evaluateWhiteBoxBidApproval} from "../ai/whiteBox/bidApproval";
import {buildTradeWhiteBoxCandidate, evaluateMarketReplacement, evaluateTradeAssistGate, evaluateWaiverPriority} from "../ai/whiteBox/marketFlow";
import {evaluateWhiteBoxLearning} from "../ai/whiteBox/learning";
import {ACQUISITION_SHADOW_PARAMETERS, BATTLE_SHADOW_PARAMETERS, BID_SHADOW_PARAMETERS, EVOLUTION_SHADOW_PARAMETERS, KEEPER_SHADOW_PARAMETERS, LEARNING_SHADOW_PARAMETERS, LINEUP_SHADOW_PARAMETERS, MARKET_FLOW_SHADOW_PARAMETERS, MEMORY_SHADOW_PARAMETERS, REGISTRATION_SHADOW_PARAMETERS, WhiteBoxParameterRegistry} from "../ai/whiteBox/parameters";
import {createNoviceProfiles, emptyGenome, type ManagerProfile} from "../draft/managerProfiles";
import {evolveManagerPopulation, founderLineage, type EvolutionCompetitor} from "../draft/naturalEvolution";

const rational = (id: string, value: number): WhiteBoxContribution => ({id, group: "rational", source: "competence", value, reason: id});
const style = (id: string, value: number): WhiteBoxContribution => ({id, group: "style", source: "personality", value, reason: id});

const trace = evaluateWhiteBoxDecision({
  decisionId: "smoke:lineup",
  reasonableBand: 8,
  styleContributionLimit: 6,
  candidates: [
    {id: "safe", rational: [rational("safe.base", 80)], style: [style("safe.patience", 5)]},
    {id: "upside", rational: [rational("upside.base", 84)], style: [style("upside.risk", -1)]},
    {id: "blunder", rational: [rational("blunder.base", 40)], style: [style("blunder.risk", 100)]},
    {id: "illegal", hardRejections: ["budget"], rational: [rational("illegal.base", 999)]},
  ],
});

assert.equal(trace.selected, "safe", "personality may distinguish rationally close candidates");
assert.equal(trace.candidates.find(candidate => candidate.id === "blunder")?.reasonable, false, "style cannot rescue an irrational candidate");
assert.equal(trace.candidates.find(candidate => candidate.id === "illegal")?.eligible, false, "style cannot override a hard rule");
assert.deepEqual(compareWhiteBoxShadow(trace, "upside"), {incumbent: "upside", shadow: "safe", agrees: false});
const compact = summarizeWhiteBoxShadow(trace, "upside", 1);
assert.equal(compact.candidateCount, 4);
assert(compact.candidates.some(candidate => candidate.id === "safe"));
assert(compact.candidates.some(candidate => candidate.id === "upside"), "compact audit must retain the incumbent even outside its display limit");
assert.deepEqual(trace, evaluateWhiteBoxDecision({
  decisionId: "smoke:lineup",
  reasonableBand: 8,
  styleContributionLimit: 6,
  candidates: [
    {id: "safe", rational: [rational("safe.base", 80)], style: [style("safe.patience", 5)]},
    {id: "upside", rational: [rational("upside.base", 84)], style: [style("upside.risk", -1)]},
    {id: "blunder", rational: [rational("blunder.base", 40)], style: [style("blunder.risk", 100)]},
    {id: "illegal", hardRejections: ["budget"], rational: [rational("illegal.base", 999)]},
  ],
}), "white-box evaluation must be deterministic");
const assistTrace=evaluateWhiteBoxDecision({decisionId:"lineup:assist",reasonableBand:.5,styleContributionLimit:3,candidates:[{id:"incumbent",rational:[rational("lineup.strength",10)],style:[style("lineup.value",0)]},{id:"supported",rational:[rational("lineup.strength",9.95)],style:[style("lineup.risk",.03),style("lineup.counter",.03)]},{id:"single-signal",rational:[rational("lineup.strength",9.95)],style:[style("lineup.value",.06)]}]});
assert.equal(evaluateLineupAssistGate(assistTrace.candidates.find(entry=>entry.id==="incumbent"),assistTrace.candidates.find(entry=>entry.id==="supported")).recommended,true);assert.deepEqual(evaluateLineupAssistGate(assistTrace.candidates.find(entry=>entry.id==="incumbent"),assistTrace.candidates.find(entry=>entry.id==="single-signal")).hardRejections,["insufficient-signals"]);

const values = BATTLE_SHADOW_PARAMETERS.snapshot({"battle.reasonableband": 10});
assert.equal(values.values["battle.reasonableband"], 10);
assert.equal(values.values["battle.stylelimit"], 15);
assert.equal(LINEUP_SHADOW_PARAMETERS.snapshot().values["lineup.reasonableband"], .25);
assert.equal(KEEPER_SHADOW_PARAMETERS.snapshot().values["keeper.reasonableband"], 2);
assert.equal(KEEPER_SHADOW_PARAMETERS.snapshot().values["keeper.replacementfriction"], .35);
assert.equal(KEEPER_SHADOW_PARAMETERS.snapshot().values["keeper.depthinsurance"], .15);
assert.equal(ACQUISITION_SHADOW_PARAMETERS.snapshot().values["acquire.reasonableband"], .05);
assert.equal(REGISTRATION_SHADOW_PARAMETERS.snapshot().values["registration.reasonableband"], .1);
assert.equal(BID_SHADOW_PARAMETERS.snapshot().values["bid.shadescale"], 700);
assert.equal(MARKET_FLOW_SHADOW_PARAMETERS.snapshot().values["trade.minimumsurplus"], .1);
assert.equal(LEARNING_SHADOW_PARAMETERS.snapshot().values["learning.maximumtraitdelta"], .2);
assert.equal(EVOLUTION_SHADOW_PARAMETERS.snapshot().values["evolution.crossoverrate"], .12);
assert.equal(MEMORY_SHADOW_PARAMETERS.snapshot().values["memory.tactical.episodelimit"], 32);
assert.throws(() => BATTLE_SHADOW_PARAMETERS.snapshot({"battle.stylelimit": 31}), /within 0\.\.30/);
const battleCandidate = (id:string,rational:number,style:number,downside:number,worst:number) => ({id,eligible:true,reasonable:true,hardRejections:[],rationalScore:rational,rawStyleScore:style,appliedStyleScore:style,finalScore:rational+style,contributions:[{id:"battle.expected",group:"expected",source:"competence" as const,value:rational-downside-worst,reason:"expected"},{id:"battle.downside",group:"risk",source:"risk" as const,value:downside,reason:"downside"},{id:"battle.worst",group:"risk",source:"risk" as const,value:worst,reason:"worst"}]});
assert.equal(evaluateBattleAssistGate(battleCandidate("old",10,2,-1,-1),battleCandidate("new",11,0,-1,-1)).recommended,true);
assert.equal(evaluateBattleAssistGate({...battleCandidate("old",10,2,-1,-1),reasonable:false,finalScore:null},battleCandidate("new",11,0,-1,-1)).recommended,true);
assert.deepEqual(evaluateBattleAssistGate(battleCandidate("old",10,0,-1,-1),battleCandidate("new",11,0,-3,-2)).hardRejections,["risk-regression"]);
assert.throws(() => new WhiteBoxParameterRegistry([{id: "bad", description: "bad id", scope: "global", defaultValue: 0, minimum: 0, maximum: 1, version: 1}]), /Invalid/);

const cautious: WhiteBoxLineupTraits = {risk: 0, stars: 0, synergy: 0, counter: 0, value: 0, flexibility: 0};
const aggressive: WhiteBoxLineupTraits = {...cautious, risk: 1};
const stableMembers = lineupMembers("stable", 200, 0);
const volatileMembers = lineupMembers("volatile", 198, 1);
const cautiousCandidates = [
  buildLineupWhiteBoxCandidate({id: "stable", members: stableMembers, traits: cautious, roleTargets: {}}),
  buildLineupWhiteBoxCandidate({id: "volatile", members: volatileMembers, traits: cautious, roleTargets: {}}),
];
const aggressiveCandidates = [
  buildLineupWhiteBoxCandidate({id: "stable", members: stableMembers, traits: aggressive, roleTargets: {}}),
  buildLineupWhiteBoxCandidate({id: "volatile", members: volatileMembers, traits: aggressive, roleTargets: {}}),
];
assert.equal(evaluateWhiteBoxDecision({decisionId: "lineup:cautious", candidates: cautiousCandidates, reasonableBand: .2, styleContributionLimit: 1}).selected, "stable");
assert.equal(evaluateWhiteBoxDecision({decisionId: "lineup:aggressive", candidates: aggressiveCandidates, reasonableBand: .2, styleContributionLimit: 1}).selected, "volatile");
assert(Math.abs(whiteBoxCandidateTotal(aggressiveCandidates[1]) - whiteBoxCandidateTotal(cautiousCandidates[1]) - .21) < 1e-12);
assert.equal(buildLineupWhiteBoxCandidate({id: "illegal", members: volatileMembers.slice(0, 5), traits: aggressive, roleTargets: {}}).hardRejections?.[0], "lineup-size:5");

const starPortfolio = buildKeeperPortfolioCandidate({id: "star", keeperLimit: 1, salaryCap: 70, members: [{id: "star", salary: 30, regularSeasonContribution: 3, usageValue: 1, starPreference: 2.5, continuity: .2, scarcePreference: 0, valuePenalty: 1}]});
const continuityPortfolio = buildKeeperPortfolioCandidate({id: "loyal", keeperLimit: 1, salaryCap: 70, members: [{id: "loyal", salary: 15, regularSeasonContribution: 3, usageValue: 1, starPreference: 0, continuity: 1.5, scarcePreference: 0, valuePenalty: .2}]});
assert.equal(evaluateWhiteBoxDecision({decisionId: "keeper:star", candidates: [starPortfolio, continuityPortfolio], reasonableBand: .5, styleContributionLimit: 6}).selected, "star");
const continuityFirstStar = buildKeeperPortfolioCandidate({id: "star", keeperLimit: 1, salaryCap: 70, members: [{id: "star", salary: 30, regularSeasonContribution: 3, usageValue: 1, starPreference: .2, continuity: .2, scarcePreference: 0, valuePenalty: 1}]});
assert.equal(evaluateWhiteBoxDecision({decisionId: "keeper:continuity", candidates: [continuityFirstStar, continuityPortfolio], reasonableBand: .5, styleContributionLimit: 6}).selected, "loyal");
assert.deepEqual(buildKeeperPortfolioCandidate({id: "over-cap", keeperLimit: 1, salaryCap: 20, members: [{id: "star", salary: 30, regularSeasonContribution: 3, usageValue: 1, starPreference: 2, continuity: .2, scarcePreference: 0, valuePenalty: 1}]}).hardRejections, ["keeper-cap:30>20"]);
assert(buildKeeperPortfolioCandidate({id: "duplicate-family", keeperLimit: 2, salaryCap: 70, members: [{id: "copy-1", family: "gengar", salary: 10, regularSeasonContribution: 3, usageValue: 1, starPreference: 1, continuity: .2, scarcePreference: 0, valuePenalty: 1}, {id: "copy-2", family: "gengar", salary: 10, regularSeasonContribution: 3, usageValue: 1, starPreference: 1, continuity: .2, scarcePreference: 0, valuePenalty: 1}]}).hardRejections?.includes("duplicate-family"));
assert.equal(keeperPortfolioId(["b", "a"]), "a+b");
const replacementAware = buildKeeperPortfolioCandidate({id: "replacement-aware", keeperLimit: 1, salaryCap: 70, members: [{id: "depth", salary: 10, regularSeasonContribution: 0, usageValue: 0, replacementFriction: .35, depthInsurance: .15, starPreference: 0, continuity: 0, scarcePreference: 0, valuePenalty: 0}]});
assert.equal(replacementAware.rational.reduce((sum, contribution) => sum + contribution.value, 0), .5);

const zeroTraits = {risk: 0, stars: 0, synergy: 0, counter: 0, value: 0, flexibility: 0};
const starAcquisition = buildAcquisitionWhiteBoxCandidate({id: "premium", commonStrength: 1, roleFit: 0, synergy: 0, counter: 0, flexibility: 0, value: .1, star: 1, risk: 0, traitWeights: {...zeroTraits, stars: 1}, systemFit: 0, programAdjustment: 0});
const starManagerDepth = buildAcquisitionWhiteBoxCandidate({id: "depth", commonStrength: 1.1, roleFit: 0, synergy: 0, counter: 0, flexibility: 0, value: 1, star: .1, risk: 0, traitWeights: {...zeroTraits, stars: 1}, systemFit: 0, programAdjustment: 0});
assert.equal(evaluateWhiteBoxDecision({decisionId: "acquire:stars", candidates: [starAcquisition, starManagerDepth], reasonableBand: .25, styleContributionLimit: 3}).selected, "premium");
const valueManagerPremium = buildAcquisitionWhiteBoxCandidate({id: "premium", commonStrength: 1, roleFit: 0, synergy: 0, counter: 0, flexibility: 0, value: .1, star: 1, risk: 0, traitWeights: {...zeroTraits, value: 1}, systemFit: 0, programAdjustment: 0});
const valueManagerDepth = buildAcquisitionWhiteBoxCandidate({id: "depth", commonStrength: 1.1, roleFit: 0, synergy: 0, counter: 0, flexibility: 0, value: 1, star: .1, risk: 0, traitWeights: {...zeroTraits, value: 1}, systemFit: 0, programAdjustment: 0});
assert.equal(evaluateWhiteBoxDecision({decisionId: "acquire:value", candidates: [valueManagerPremium, valueManagerDepth], reasonableBand: .25, styleContributionLimit: 3}).selected, "depth");

const standardBid = evaluateWhiteBoxBid({
  decisionId: "bid:standard",
  managerId: "manager-a",
  candidateId: "star",
  mode: "standard",
  budget: 100,
  reserve: 5,
  market: 20,
  fit: 2,
  fundamental: 0,
  starPremium: .5,
  bidAggression: .4,
  cashUtility: .5,
  remainingNeed: 3,
  scarceMultiplier: 1,
  shade: 4,
});
assert.equal(standardBid.demandBeforeScarcity, 21.1);
assert.equal(standardBid.ceiling, 21);
assert.equal(standardBid.bid, 17);
assert.equal(evaluateWhiteBoxBidApproval({auctionMode:"sequential",bidderId:"manager-a",incumbentWinnerId:"manager-b",highestCompetingBid:19,trace:standardBid}).recommended,true);
assert.deepEqual(evaluateWhiteBoxBidApproval({auctionMode:"sequential",bidderId:"manager-a",incumbentWinnerId:"manager-a",highestCompetingBid:19,trace:standardBid}).reasons,["incumbent-already-wins"]);
assert.deepEqual(evaluateWhiteBoxBidApproval({auctionMode:"sequential",bidderId:"manager-a",incumbentWinnerId:"manager-b",highestCompetingBid:21,trace:standardBid}).reasons,["candidate-does-not-strictly-win"]);
assert.deepEqual(evaluateWhiteBoxBidApproval({auctionMode:"portfolio",bidderId:"manager-a",incumbentWinnerId:"manager-b",highestCompetingBid:19,trace:standardBid}).reasons,["portfolio-auction-requires-dedicated-replay"]);
assert.deepEqual(standardBid, evaluateWhiteBoxBid({...standardBidInput(), decisionId: "bid:standard"}), "bid evaluation must be deterministic");
const noMarketAnchorBid = evaluateWhiteBoxBid({...standardBidInput(), decisionId: "bid:no-market", parameters: {"bid.standard.marketweight": 0}});
assert.equal(noMarketAnchorBid.ceiling, 8, "a bounded semantic parameter override must change the decomposed ceiling");
assert.throws(() => evaluateWhiteBoxBid({...standardBidInput(), decisionId: "bid:invalid-parameter", parameters: {"bid.shadescale": 2001}}), /within 0\.\.2000/);
const scarceBid = evaluateWhiteBoxBid({...standardBidInput(), decisionId: "bid:scarce", scarceMultiplier: 1.5});
assert.equal(scarceBid.ceiling, 32);
assert.equal(scarceBid.bid, 28);
const disciplinedBid = evaluateWhiteBoxBid({...standardBidInput(), decisionId: "bid:disciplined", cashUtility: 2});
assert(disciplinedBid.ceiling < standardBid.ceiling, "cash discipline must reduce the bid ceiling");
const rejectedBid = evaluateWhiteBoxBid({...standardBidInput(), decisionId: "bid:rejected", hardRejections: ["roster-full"]});
assert.equal(rejectedBid.ceiling, 0);
assert.equal(rejectedBid.bid, 0);
assert.deepEqual(rejectedBid.hardRejections, ["roster-full"]);
const sportsBid = evaluateWhiteBoxBid({...standardBidInput(), decisionId: "bid:sports", mode: "sports-market", fundamental: 20});
assert.equal(sportsBid.demandBeforeScarcity, 20.5);
assert.equal(sportsBid.ceiling, 21);

const mutualTrade = buildTradeWhiteBoxCandidate({id: "trade:mutual", leftBefore: 20, leftAfter: 22, rightBefore: 30, rightAfter: 31, leftContender: .5, rightContender: .5});
assert.deepEqual(mutualTrade.hardRejections, []);
assert.equal(evaluateWhiteBoxDecision({decisionId: "trade:choice", candidates: [mutualTrade, buildTradeWhiteBoxCandidate({id: "trade:smaller", leftBefore: 20, leftAfter: 21, rightBefore: 30, rightAfter: 30, leftContender: .5, rightContender: .5})], reasonableBand: 0, styleContributionLimit: 0}).selected, "trade:mutual");
const exploitativeTrade = buildTradeWhiteBoxCandidate({id: "trade:exploit", leftBefore: 20, leftAfter: 28, rightBefore: 30, rightAfter: 20, leftContender: 0, rightContender: 0});
assert(exploitativeTrade.hardRejections?.some(reason => reason.startsWith("right-utility")), "one-sided exploitation must be rejected");
assert(buildTradeWhiteBoxCandidate({id: "trade:duplicate", leftBefore: 20, leftAfter: 22, rightBefore: 30, rightAfter: 31, leftContender: .5, rightContender: .5, duplicateFamily: true}).hardRejections?.includes("duplicate-family"));
const structurallyBetterTrade = buildTradeWhiteBoxCandidate({id: "trade:structure", leftBefore: 20, leftAfter: 21, rightBefore: 30, rightAfter: 31, leftContender: .5, rightContender: .5, leftMinimumCoverageChange: .5, rightMinimumCoverageChange: 0, leftTargetDepthChange: -.25, rightTargetDepthChange: 0});
assert.equal(structurallyBetterTrade.rational.find(entry => entry.id === "trade.minimumcoverage")?.value, 2);
assert.equal(structurallyBetterTrade.rational.find(entry => entry.id === "trade.targetdepth")?.value, -.05);
const defensivelyBetterTrade = buildTradeWhiteBoxCandidate({id: "trade:defense", leftBefore: 20, leftAfter: 21, rightBefore: 30, rightAfter: 31, leftContender: .5, rightContender: .5, leftTypePressureImprovement: 2, rightTypePressureImprovement: -1});
assert.equal(defensivelyBetterTrade.rational.find(entry => entry.id === "trade.typepressure")?.value, .15);
const assistIncumbent = {id: "trade:old", leftBefore: 20, leftAfter: 21, rightBefore: 30, rightAfter: 31, leftContender: .5, rightContender: .5};
const assistShadow = {id: "trade:new", leftBefore: 20, leftAfter: 21.3, rightBefore: 30, rightAfter: 31.3, leftContender: .5, rightContender: .5, leftTargetDepthChange: 1, rightTypePressureImprovement: 1};
const assistGate = evaluateTradeAssistGate("trade:assist", assistIncumbent, assistShadow);
assert.equal(assistGate.recommended, true);assert.deepEqual(assistGate.supportingSignals, ["target-depth", "type-pressure"]);
const cautiousGate = evaluateTradeAssistGate("trade:cautious", assistIncumbent, {...assistShadow, leftAfter: 20.4});
assert.equal(cautiousGate.recommended, false);assert(cautiousGate.hardRejections.some(reason => reason.startsWith("left-side-regression")));

const waiverPriority = evaluateWaiverPriority("waiver:priority", [
  {teamId: "strong", winPct: .8, roundsSinceClaim: 16},
  {teamId: "weak", winPct: .2, roundsSinceClaim: 8},
]);
assert.equal(waiverPriority.selected, "weak");
assert.equal(evaluateWaiverPriority("waiver:wait", [{teamId: "recent", winPct: .5, roundsSinceClaim: 0}, {teamId: "waiting", winPct: .5, roundsSinceClaim: 16}]).selected, "waiting");
const waiverReplacement = evaluateMarketReplacement({decisionId: "waiver:replacement", mode: "waiver", budget: 10, rosterLegal: true, duplicateFamily: false, currentValue: 10, targetValue: 10.5, currentStrength: 100, targetStrength: 100, fillsNeed: false, cost: 2});
assert.equal(waiverReplacement.accepted, true);
assert.equal(evaluateMarketReplacement({...replacementInput(), decisionId: "free-agent:need", fillsNeed: true}).accepted, true);
assert.equal(evaluateMarketReplacement({...replacementInput(), decisionId: "free-agent:weak", targetStrength: 105}).accepted, false);
assert.equal(evaluateMarketReplacement({...replacementInput(), decisionId: "free-agent:upgrade", targetStrength: 106}).accepted, true);
assert.equal(evaluateMarketReplacement({...replacementInput(), decisionId: "free-agent:no-cash", budget: 1, targetStrength: 110}).accepted, false);
assert.equal(evaluateMarketReplacement({...replacementInput(), decisionId: "background:upgrade", mode: "background", budget: 2, cost: 0, targetValue: 10.4}).accepted, true);
assert.equal(evaluateMarketReplacement({...replacementInput(), decisionId: "background:weak", mode: "background", budget: 2, cost: 0, targetValue: 10.3}).accepted, false);
const continuityProtected = evaluateMarketReplacement({...replacementInput(), decisionId: "background:continuity", mode: "background", budget: 2, cost: 0, targetValue: 10.4, continuityEvidence: 1, parameters: {"background.switchcostrate": .03}});
assert.equal(continuityProtected.accepted, false);assert.equal(continuityProtected.switchCost, .3);

const learningInput = managerLearningInput();
const learningTrace = evaluateWhiteBoxLearning(learningInput);
assert(learningTrace.traits.find(entry => entry.trait === "risk")!.afterTrait > .5, "positive evidence must raise its governed trait");
assert(learningTrace.traits.find(entry => entry.trait === "stars")!.afterTrait < .5, "negative evidence must lower its governed trait");
assert.deepEqual(learningTrace.traits.find(entry => entry.trait === "risk")!.rollback, {trait: .5, posterior: {mean: .5, confidence: 0, effectiveSamples: 2}});
assert.equal(learningTrace.exploration.after, .8 * Math.exp(-1 / 8));
assert.deepEqual(learningTrace, evaluateWhiteBoxLearning(learningInput), "learning evaluation must be deterministic");
const cappedLearning = evaluateWhiteBoxLearning({...learningInput, parameters: {"learning.maximumtraitdelta": .01}});
assert.equal(cappedLearning.traits.find(entry => entry.trait === "risk")!.appliedDelta, .01);
assert.equal(cappedLearning.traits.find(entry => entry.trait === "risk")!.capped, true);
assert.throws(() => evaluateWhiteBoxLearning({...learningInput, evidence: learningInput.evidence.slice(0, 5)}), /Missing learning evidence/);

const evolutionInput = evolutionCompetitors(false);
const evolutionA = evolveManagerPopulation(evolutionInput, 1, "whitebox-evolution-deterministic");
const evolutionB = evolveManagerPopulation(evolutionInput, 1, "whitebox-evolution-deterministic");
assert.deepEqual(evolutionA, evolutionB, "evolution and its audit must be deterministic for a fixed seed");
assert.equal(evolutionA.length, 6);
assert(evolutionA.some(entry => entry.protectedCopy && entry.whiteBoxEvolutionTrace.mutation.gates.length === 0));
assert(evolutionA.filter(entry => !entry.protectedCopy).every(entry => entry.whiteBoxEvolutionTrace.mutation.gates.length === 50));
assert(evolutionA.every(entry => Object.keys(entry.whiteBoxEvolutionTrace.parameters).length === 18));
let inheritedCrossover = false;
for (let attempt = 0; attempt < 100 && !inheritedCrossover; attempt += 1) {
  inheritedCrossover = evolveManagerPopulation(evolutionInput, 1, `whitebox-crossover-${attempt}`).some(entry => entry.whiteBoxEvolutionTrace.crossover.triggered && entry.whiteBoxEvolutionTrace.inheritanceChanges.length > 0);
}
assert.equal(inheritedCrossover, true, "a second-parent crossover must expose inherited parameter differences");
let clippedMutation = false;
const boundedEvolutionInput = evolutionCompetitors(true);
for (let attempt = 0; attempt < 100 && !clippedMutation; attempt += 1) {
  clippedMutation = evolveManagerPopulation(boundedEvolutionInput, 1, `whitebox-clipping-${attempt}`).some(entry => entry.whiteBoxEvolutionTrace.mutation.changes.some(change => change.clipped));
}
assert.equal(clippedMutation, true, "outward mutations at a parameter bound must be marked as clipped");

console.log("White-box decision core smoke test passed");

function lineupMembers(prefix: string, strength: number, risk: number): WhiteBoxLineupMember[] {
  const roles = [["hazards"], ["removal"], ["recovery"], ["pivot"], ["physical"], ["special"]];
  return roles.map((memberRoles, index) => ({id: `${prefix}-${index}`, strength, market: 10, roles: memberRoles, risk, opponentCoverage: 0, historicalMatchup: 0, tacticalMemory: 0}));
}

function standardBidInput() {
  return {
    managerId: "manager-a",
    candidateId: "star",
    mode: "standard" as const,
    budget: 100,
    reserve: 5,
    market: 20,
    fit: 2,
    fundamental: 0,
    starPremium: .5,
    bidAggression: .4,
    cashUtility: .5,
    remainingNeed: 3,
    scarceMultiplier: 1,
    shade: 4,
  };
}

function replacementInput() {
  return {mode: "free-agent" as const, budget: 10, rosterLegal: true, duplicateFamily: false, currentValue: 10, targetValue: 10, currentStrength: 100, targetStrength: 100, fillsNeed: false, cost: 2};
}

function managerLearningInput() {
  const traits = {risk: .5, stars: .5, synergy: .5, counter: .5, value: .5, flexibility: .5};
  const strategies = Object.fromEntries(Object.keys(traits).map(trait => [trait, {mean: .5, confidence: 0, effectiveSamples: 2}])) as Record<keyof typeof traits, {mean: number; confidence: number; effectiveSamples: number}>;
  return {
    managerId: "manager-learning",
    traits,
    development: {seasons: 0, exploration: .8, strategies, styleHistory: []},
    evidence: (Object.keys(traits) as Array<keyof typeof traits>).map(trait => ({trait, value: trait === "risk" ? 1 : 0, reason: `${trait}-evidence`})),
  };
}

function evolutionCompetitors(atBounds: boolean): EvolutionCompetitor[] {
  return createNoviceProfiles(6).map((profile, index) => {
    const value = .2 + index * .1;
    for (const trait of Object.keys(profile.traits) as Array<keyof typeof profile.traits>) {
      profile.traits[trait] = atBounds ? .9 : value;
      profile.development.strategies[trait].mean = atBounds ? 1 : value;
    }
    if (atBounds) profile.genome = boundedGenome();
    return {
      slotId: profile.id,
      profile,
      lineage: founderLineage(profile.id),
      points: 6 - index,
      rank: index + 1,
      behavior: {pace: .5, lineupVariation: .5, starInvestment: .5, roleBreadth: .5, rosterTurnover: .5, knockoutPressure: .5},
      champion: index === 0,
    };
  });
}

function boundedGenome(): NonNullable<ManagerProfile["genome"]> {
  const genome = emptyGenome();
  Object.assign(genome.economics, {starPremium: .35, cashUtility: .35, bidAggression: .35, marketAwareness: .35});
  Object.assign(genome.tactics, {aggression: .5, setupBias: .5, pivotBias: .5, recoveryBias: .5, statusBias: .5, teraBias: .5, switchBias: .5});
  for (const role of ["hazards", "removal", "recovery", "pivot", "setup", "priority", "screens", "status", "physical", "special"] as const) genome.roles[role] = .8;
  Object.assign(genome.configuration, {speedInvestment: .7, bulkBias: .7, statusMoveBias: .7, coverageBias: .7, accuracyRisk: .7, choiceItemBias: .7, recoveryItemBias: .7});
  Object.assign(genome.systems, {weather: .8, trickRoom: .8, balance: .8, offense: .8, stall: .8, hazardPressure: .8, pivotCycle: .8, setupCore: .8});
  Object.assign(genome.organization, {scarceConcentration: .7, backgroundReliance: .7, continuity: .7, experimentation: .7, rebuildPatience: .7});
  Object.assign(genome.learning, {rate: .8, memoryDecay: .99, exploration: .25});
  return genome;
}
