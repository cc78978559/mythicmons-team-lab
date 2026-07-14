import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Dex, Teams} from "pokemon-showdown";
import {compileSandboxTeam} from "../sandbox/compiler";
import {installCompiledSandbox} from "../sandbox/installer";
import {benchmarkTeamPath, loadBenchmarkPool} from "../eval/benchmarkPool";
import {evaluateCandidate} from "../eval/evaluator";
import {analyzePublicLog} from "../eval/logAnalysis";
import {numberArg, parseArgs} from "../showdown/args";
import {queueBattleSideUpdate, runBattle} from "../showdown/battle";
import {pairedDeltaSummary, summarizeCandidate} from "../cli/modernHybrids";
import {chooseAction, createBattleAiContext, recordAiChoice, updateAiContextFromPublicLine} from "../showdown/choice";
import {loadTeam} from "../showdown/team";
import {closeTeamDatabase, getTeam, listTeams, openTeamDatabase, saveTeam} from "../store/teamDatabase";
import type {SandboxTeam} from "../sandbox/types";
import {boundedDraftJitter, thirdRoundReversalOrder} from "../draft/scoring";
import {DecisionLedger} from "../draft/decisionLedger";
import {extractKeyBattleDecisions} from "../draft/battleDecisionExtractor";
import {reviewManagerSeason, selectKeepers, updateMatchupMemory, type DynastyRosterMember} from "../draft/dynastyLearning";
import {classifyEmergentStyle, cloneManagerProfile, DEFAULT_MANAGER_PROFILES, materializeManagerProfile, normalizedTraitWeights, roleTargetValue} from "../draft/managerProfiles";
import {DRAFT_GENERATIONS, draftGenerationSource} from "../draft/customRegistry";
import {clusterBehaviorSpecies, evolveManagerPopulation, founderLineage, type ObservedBehavior} from "../draft/naturalEvolution";
import {solvePortfolioAuction} from "../draft/portfolioAuction";
import {updateQualityDiversityArchive} from "../draft/qualityDiversity";
import {advanceContract, arbitrationSalary, chooseRfaOffer, initialContract, offerNpv, payrollResult, releaseDeadMoney, waiverWinner} from "../draft/sportsMarket";
import {reconcileRetainedContractOwners, repairDuplicateRetainedContracts} from "../draft/contractStateRepair";

async function main() {
  testDraftJitterIsOnlyATieBreaker();
  testManagerPersonalityV2IsDistinctAndNormalized();
  testTacticalPersonalityIsAuditable();
  testThirdRoundReversalIsPositionallyFair();
  testDecisionLedgerRoundTrip();
  testBattleDecisionExtractorKeepsOnlyKeyChoices();
  testDynastyLearningStaysAnchored();
  testDynastyKeeperRulesProtectFutureBudgets();
  testDynastyManagersDoNotConvergeAfterSameEvidence();
  testDynastyMatchupMemoryRewardsSuccessAndDecays();
  testDynastyCounterLearningUsesStructuredSeriesResults();
  testDynastyKeepersIgnorePlayoffVolume();
  testSportsMarketDoesNotAutoReleaseUnusedContracts();
  testKeeperContractsTrackAssetCopies();
  testDuplicateContractRepairFollowsAssetLedger();
  testNaturalEvolutionIsDeterministicAndEcological();
  testPortfolioAuctionRespectsFreedomAndBudgets();
  testQualityDiversityArchiveKeepsDistantViableStrategies();
  testSportsMarketMathIsBoundedAndAuditable();
  testBundledDraftRegistryIsComplete();
  testCustomFormatsMergePreservesJavaScript();
  testCompositeItemIncludesControlHooks();
  testCompositeSourceHooksUseSourceHolder();
  testCompositeItemsStackSharedStatModifiers();
  testTechnician70Threshold();
  testMegaStoneDefaultsToMegaSpecies();
  testSyntheticSpeciesPreservesEvolutionMetadata();
  testSyntheticIdsOnlyChangeWithRelevantInputs();
  testCustomItemAndMoveEntriesCompile();
  testInstalledSandboxTablesMerge();
  testCustomEffectConflictsRequireExplicitReplacement();
  testBenchmarkPathsCannotEscapePoolDirectory();
  testNumberArgRejectsInvalidRanges();
  testRejectedChoiceRequestRetriesAcrossSideUpdates();
  testTeamPreviewUsesDelimitedSlots();
  testAiAllowsForcedRechargeMove();
  testSearchAiUsesOpenTeamSheets();
  testSearchTracksBenchStateAcrossSwitches();
  testSearchFiltersChoiceLockAndModelsOpponentTera();
  testSearchScoresStatusConsequencesAndTrapping();
  testSearchTreatsOwnTeraAsSeparateAction();
  testTacticalAiPrefersBatonPassSetup();
  testAiAvoidsTypeAndKnownAbilityImmunities();
  testTacticalAiPassesAccumulatedBoosts();
  testBatonPlannerUsesSpeedBoostTurn();
  testBatonPassPreservesBoostState();
  testAiTracksTeraTypesAndPreservesImmunities();
  testAiSwitchesWhenEveryMoveScoresZero();
  testAiHandlesMoldBreakerAndScrappy();
  testAiUsesDynamicWeatherMovesAndTrickRoom();
  testAiRespectsPriorityBlockingAbilities();
  testTacticalAiDoesNotReviveInvalidMoves();
  testAiRetainsRevealedDamageThreats();
  testAiDoesNotOscillateBetweenOwnWeatherMoves();
  testWishExpiresWithoutHealAndAiNeverIllegallyPasses();
  testBeneficialSideConditionsAreNotHazards();
  testTeamPreviewChoosesRoleLead();
  testAiRejectsNonSinglesFormats();
  testHybridScoringExcludesTechnicalDraws();
  testHybridDeltaUsesPairedSeedClusters();
  await testTeamDatabaseRoundTrip();
  await testMaxTurnsIsDraw();
  await testSearchBattleConverges();
  await testTechnicalDrawIsExcludedFromEvaluationScore();
  await testBattleRequestsUseLatestPublicState();
  await testPlayerContextsDoNotLeakCurrentChoices();
  testKoAttributionHandlesSelfKoAndHazards();
  await testCompositeConsumablePreservesSiblingItems();
  await testCompositeAirBalloonPreservesSiblingItems();
  await testPersianDelayedTechnicianUTurn();
  await testAiReadsCompositeAbilityMetadata();
  await testMegaSolPersonalSunMechanics();
  await testCompositeStatusMovePriority();
  await testNormalizeThunderWaveTargets();
  await testCompositeChoiceLockRunsInBattle();
  console.log("Regression tests passed");
}

function testRejectedChoiceRequestRetriesAcrossSideUpdates(): void {
  const pending: Record<string, any> = {};
  const rejected = new Set<"p1" | "p2">();
  const rejectedBlock = ["sideupdate", "p2", "|error|[Unavailable choice] Can't switch: The active Pokemon is trapped"];
  assert.equal(queueBattleSideUpdate(rejectedBlock, pending, rejected), false);
  assert.equal(rejected.has("p2"), true);
  const request = {active: [{trapped: true, moves: [{move: "Thunderbolt", id: "thunderbolt", pp: 24, maxpp: 24, target: "normal", disabled: false}]}], side: {id: "p2", name: "Team B", pokemon: []}};
  const requestBlock = ["sideupdate", "p2", `|request|${JSON.stringify(request)}`];
  assert.equal(queueBattleSideUpdate(requestBlock, pending, rejected), true);
  assert.deepEqual(pending.p2, request);
  assert.equal(rejected.has("p2"), false);
}

function testSportsMarketMathIsBoundedAndAuditable(): void {
  const contract = initialContract({assetId: "custom:1", family: "custom", pokemon: "Custom", teamId: "manager01", season: 1, marketValue: 20, acquisitionCost: 10, assetClass: "unique-custom"});
  assert.equal(contract.salary, 16);
  assert.equal(contract.guaranteeRate, .35);
  const advanced = advanceContract(contract);
  assert.equal(advanced.yearsRemaining, 1);
  assert.equal(advanced.salary, 18);
  assert.equal(arbitrationSalary({...advanced, marketValue: 24}, 28), 24);
  assert.deepEqual(releaseDeadMoney({...advanced, yearsRemaining: 2}), {current: 8.82, next: 3.78});
  assert.deepEqual(payrollResult([{...contract, salary: 112}] as any), {payroll: 112, floorPenalty: 0, luxuryTax: 3, legal: true});
  const offers = [{teamId: "a", salary: 12, years: 4, guaranteeRate: .2}, {teamId: "b", salary: 15, years: 3, guaranteeRate: .35}];
  assert.ok(offerNpv(offers[1]) > 0);
  assert.equal(chooseRfaOffer(offers)?.teamId, "a");
  assert.equal(waiverWinner([{teamId: "strong", winPct: .8, roundsSinceClaim: 16}, {teamId: "weak", winPct: .2, roundsSinceClaim: 8}]), "weak");
}

function testManagerPersonalityV2IsDistinctAndNormalized(): void {
  assert.equal(DEFAULT_MANAGER_PROFILES.length, 10);
  assert.equal(new Set(DEFAULT_MANAGER_PROFILES.map(profile => JSON.stringify(profile.traits))).size, 1, "Every manager must start from the same novice state");
  assert.equal(new Set(DEFAULT_MANAGER_PROFILES.map(profile => JSON.stringify({...profile.tactics, id: "shared"}))).size, 1, "Novices must share one tactical policy");
  for (const profile of DEFAULT_MANAGER_PROFILES) {
    const weights = normalizedTraitWeights(profile.traits);
    assert.ok(Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 1) < 1e-9);
    assert.ok(profile.preferredRoles.every(role => profile.roleTargets[role]));
    assert.equal(classifyEmergentStyle(profile).label, "未定型");
  }
  const novice = DEFAULT_MANAGER_PROFILES[0];
  assert.ok(roleTargetValue(novice, {}, new Set(["hazards"]), 0) > roleTargetValue(novice, {}, new Set(["priority"]), 0));
}

function testTacticalPersonalityIsAuditable(): void {
  const novice = cloneManagerProfile(DEFAULT_MANAGER_PROFILES[0]);
  const profile = materializeManagerProfile({...novice, traits: {...novice.traits, risk: .9}});
  const context = createBattleAiContext("gen9ou", {tacticalProfile: profile.tactics});
  const request = {
    active: [{moves: [
      {id: "swordsdance", move: "Swords Dance", pp: 20},
      {id: "tackle", move: "Tackle", pp: 35},
    ]}],
    side: {id: "p1" as const, pokemon: [{ident: "p1: Test", details: "Mew", condition: "100/100", active: true}]},
  };
  chooseAction(request, "p1", "search", context);
  const trace = context.lastDecision.p1;
  assert.equal(trace?.personalityId, profile.id);
  const setup = trace?.candidates.find(candidate => candidate.choice === "move swordsdance");
  const damage = trace?.candidates.find(candidate => candidate.choice === "move tackle");
  assert.ok(setup && damage);
  assert.ok(setup.personalityAdjustment > damage.personalityAdjustment);
}

function testDraftJitterIsOnlyATieBreaker(): void {
  const samples = Array.from({length: 100}, (_, index) => boundedDraftJitter("draft-regression", `candidate-${index}`, index));
  assert.ok(samples.every(value => value >= 0 && value < 0.005), "Draft jitter must never outweigh tactical score components");
  assert.deepEqual(samples, Array.from({length: 100}, (_, index) => boundedDraftJitter("draft-regression", `candidate-${index}`, index)));
}

function testThirdRoundReversalIsPositionallyFair(): void {
  const orders = thirdRoundReversalOrder(6, 6);
  const pickSums = Array(6).fill(0) as number[];
  let overallPick = 0;
  for (const order of orders) {
    for (const slot of order) {
      overallPick += 1;
      pickSums[slot] += overallPick;
    }
  }
  assert.deepEqual(pickSums, [111, 111, 111, 111, 111, 111]);
}

function testDecisionLedgerRoundTrip(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "decision-ledger-"));
  const ledger = new DecisionLedger();
  const decision = ledger.add({stage: "auction", actor: "manager", decision: "bid", selected: "Pikachu", context: {budget: 10}, alternatives: [{option: "Raichu", score: 8}], rationale: ["fit"], expectedValue: 9});
  ledger.resolve(decision.id, {kos: 3, champion: true});
  ledger.write(root);
  const saved = JSON.parse(fs.readFileSync(path.join(root, "decision-ledger.json"), "utf8")) as {records: Array<{outcome?: {kos?: number}}>};
  assert.equal(saved.records[0].outcome?.kos, 3);
  assert.ok(fs.readFileSync(path.join(root, "decision-ledger.md"), "utf8").includes("Pikachu"));
  const resumed = new DecisionLedger(JSON.parse(fs.readFileSync(path.join(root, "decision-ledger.json"), "utf8")).records);
  const next = resumed.add({stage: "review", actor: "manager", decision: "resume", selected: null, context: {}, alternatives: [], rationale: []});
  assert.equal(next.id, "decision-00002", "Resumed ledgers must continue their sequence");
}

function testBattleDecisionExtractorKeepsOnlyKeyChoices(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "battle-decisions-"));
  const file = path.join(root, "trace.json");
  fs.writeFileSync(file, JSON.stringify([
    {turn: 3, playerId: "p1", strategy: "search", selected: "switch 2", candidates: [{choice: "switch 2", score: 12, expected: 12, downside: 0, worst: 0, responses: []}, {choice: "move tackle", score: 11, expected: 11, downside: 0, worst: 0, responses: []}]},
    {turn: 4, playerId: "p2", strategy: "search", selected: "move tackle", candidates: [{choice: "move tackle", score: 50, expected: 50, downside: 0, worst: 0, responses: []}, {choice: "move growl", score: 1, expected: 1, downside: 0, worst: 0, responses: []}]},
  ]), "utf8");
  const decisions = extractKeyBattleDecisions(file);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].kind, "close-call");
  assert.equal(decisions[0].runnerUp, "move tackle");
}

function testDynastyLearningStaysAnchored(): void {
  const base = cloneManagerProfile(DEFAULT_MANAGER_PROFILES[0]);
  const current = cloneManagerProfile(base);
  const standing = {id: base.id, name: base.name, seriesWins: 9, seriesLosses: 0, points: 27, pairWins: 9, pairLosses: 0, kos: 60};
  const review = reviewManagerSeason(base, current, standing, [standing, {...standing, id: "rival", points: 0}], dynastyRoster(), []);
  for (const signal of review.signals) assert.ok(Math.abs(signal.delta) <= .1000001, `${signal.trait} changed too quickly from one effective season sample`);
  for (const posterior of Object.values(review.developmentAfter.strategies)) assert.ok(posterior.effectiveSamples <= 3.000001, "A season must contribute at most one effective sample per strategy");
  assert.ok(review.developmentAfter.exploration < base.development.exploration);
}

function testDynastyKeeperRulesProtectFutureBudgets(): void {
  const profile = cloneManagerProfile(DEFAULT_MANAGER_PROFILES[0]);
  const roster = dynastyRoster();
  const result = selectKeepers(profile, roster, [{family: "family-0", pokemon: "Mon 0", salary: 50, years: 2, lastSeasonAppearances: 20, lastSeasonKos: 20}]);
  assert.ok(result.keepers.length <= 3);
  assert.ok(result.keepers.reduce((sum, keeper) => sum + keeper.salary, 0) <= 70);
  const retainedVeteran = result.keepers.find(keeper => keeper.family === "family-0");
  if (retainedVeteran) assert.equal(retainedVeteran.salary, 65, "Third-year veteran salary should include the veteran tax");
  for (const keeper of result.keepers) {
    const member = roster.find(candidate => candidate.family === keeper.family)!;
    if (member.method === "supplemental") assert.ok(keeper.salary >= Math.ceil(Math.ceil(member.market * .75) * 1.2), "Supplemental bargains must renew from a market-price floor");
  }
}

function testDynastyManagersDoNotConvergeAfterSameEvidence(): void {
  const stars = cloneManagerProfile(DEFAULT_MANAGER_PROFILES[0]);
  const value = cloneManagerProfile(DEFAULT_MANAGER_PROFILES[1]);
  const standings = [
    {id: stars.id, name: stars.name, seriesWins: 5, seriesLosses: 4, points: 15, pairWins: 5, pairLosses: 4, kos: 40},
    {id: value.id, name: value.name, seriesWins: 5, seriesLosses: 4, points: 15, pairWins: 5, pairLosses: 4, kos: 40},
  ];
  const starReview = reviewManagerSeason(stars, stars, standings[0], standings, dynastyRoster(), []);
  const valueReview = reviewManagerSeason(value, value, standings[1], standings, dynastyRoster(), []);
  assert.deepEqual(starReview.after, valueReview.after, "Identical novices with identical experience must learn identically");
  assert.deepEqual(starReview.developmentAfter.strategies, valueReview.developmentAfter.strategies);
}

function testDynastyMatchupMemoryRewardsSuccessAndDecays(): void {
  const first = updateMatchupMemory(undefined, ["alpha", "beta"], "win");
  assert.equal(first.familyScores.alpha, 1 / Math.sqrt(2));
  const second = updateMatchupMemory(first, ["beta", "gamma"], "loss");
  assert.equal(second.familyScores.alpha, .85 / Math.sqrt(2), "Unused matchup evidence should decay");
  assert.ok(second.familyScores.beta < first.familyScores.beta, "A failed repeat should reduce confidence in the repeated family");
  assert.equal(second.series, 2);
}

function testDynastyCounterLearningUsesStructuredSeriesResults(): void {
  const profile = cloneManagerProfile(DEFAULT_MANAGER_PROFILES[2]);
  const standing = {id: profile.id, name: profile.name, seriesWins: 0, seriesLosses: 0, points: 1, pairWins: 0, pairLosses: 0, kos: 1};
  const rival = {id: "rival", name: "Rival", seriesWins: 0, seriesLosses: 0, points: 1, pairWins: 0, pairLosses: 0, kos: 1};
  const battle = (winner: string) => ({id: `battle-${winner}`, sequence: 1, stage: "battle" as const, actor: "battle-ai", decision: "localized display text must not be parsed", selected: [], context: {seriesId: `league-${profile.id}-rival`, left: profile.id, right: "rival", winner}, alternatives: [], rationale: [], links: [], outcome: {winner, turns: 20}});
  const review = reviewManagerSeason(profile, profile, standing, [standing, rival], dynastyRoster(), [battle(profile.id), battle("rival")]);
  assert.equal(review.signals.find(signal => signal.trait === "counter")?.evidence, .5, "A split series should count as a draw against the tracked opponent");
}

function testDynastyKeepersIgnorePlayoffVolume(): void {
  const profile = cloneManagerProfile(DEFAULT_MANAGER_PROFILES[1]);
  const member = (family: string, appearances: number, kos: number): DynastyRosterMember => ({family, pokemon: family, method: "supplemental", price: 1, market: 10, appearances, kos, regularSeasonAppearances: 10, regularSeasonKos: 5});
  const result = selectKeepers(profile, [member("regular-first", 10, 5), member("playoff-inflated", 30, 25)], [], 1);
  assert.equal(result.keepers[0].family, "regular-first", "Extra playoff games must not improve keeper priority when regular-season evidence is identical");
}

function testSportsMarketDoesNotAutoReleaseUnusedContracts(): void {
  const previous = {model: process.env.V4_CONTRACT_MODEL, keepers: process.env.V4_MAX_KEEPERS, cap: process.env.V4_KEEPER_CAP};
  process.env.V4_CONTRACT_MODEL = "sports-market";
  process.env.V4_MAX_KEEPERS = "10";
  process.env.V4_KEEPER_CAP = "120";
  try {
    const profile = cloneManagerProfile(DEFAULT_MANAGER_PROFILES[0]);
    const unused: DynastyRosterMember = {assetId: "unused:1", scarcity: "standard", family: "unused", pokemon: "Unused", method: "supplemental", price: 1, market: 8, appearances: 0, kos: 0, regularSeasonAppearances: 0, regularSeasonKos: 0};
    const result = selectKeepers(profile, [unused]);
    assert.equal(result.keepers.length, 1, "An unused V10 contract must remain until the manager actively moves or releases it");
  } finally {
    restoreEnv("V4_CONTRACT_MODEL", previous.model);
    restoreEnv("V4_MAX_KEEPERS", previous.keepers);
    restoreEnv("V4_KEEPER_CAP", previous.cap);
  }
}

function testKeeperContractsTrackAssetCopies(): void {
  const previous = {model: process.env.V4_CONTRACT_MODEL, keepers: process.env.V4_MAX_KEEPERS, cap: process.env.V4_KEEPER_CAP};
  process.env.V4_CONTRACT_MODEL = "sports-market";
  process.env.V4_MAX_KEEPERS = "1";
  process.env.V4_KEEPER_CAP = "120";
  try {
    const profile = cloneManagerProfile(DEFAULT_MANAGER_PROFILES[0]);
    const copy = (assetId: string, kos: number): DynastyRosterMember => ({assetId, scarcity: "elite-ordinary", family: "exeggutor", pokemon: "Exeggutor", method: "trade", price: 8, market: 20, appearances: 10, kos, regularSeasonAppearances: 10, regularSeasonKos: kos});
    const oldCopy = {assetId: "exeggutor:elite-ordinary:1", family: "exeggutor", pokemon: "Exeggutor", salary: 40, years: 2, yearsRemaining: 1, serviceYears: 2, guaranteeRate: .2, status: "controlled" as const, originalTeamId: "old-team", acquiredSeason: 1, acquisitionCost: 20, marketValue: 20, assetClass: "elite-ordinary" as const, tagCount: 0, lastSeasonAppearances: 10, lastSeasonKos: 4};
    const result = selectKeepers(profile, [copy("exeggutor:elite-ordinary:2", 8), copy("exeggutor:elite-ordinary:3", 1)], [oldCopy], 1);
    assert.equal(result.keepers[0].assetId, "exeggutor:elite-ordinary:2", "A same-species copy must retain its own asset identity");
    assert.notEqual(result.keepers[0].salary, 40, "A different copy must not inherit another asset's salary");
    assert.equal(result.released.length, 1, "An unselected same-species copy must be released independently");
  } finally {
    restoreEnv("V4_CONTRACT_MODEL", previous.model);
    restoreEnv("V4_MAX_KEEPERS", previous.keepers);
    restoreEnv("V4_KEEPER_CAP", previous.cap);
  }
}

function testDuplicateContractRepairFollowsAssetLedger(): void {
  const state = {
    assets: {"dragonite:2": {ownerId: "new-team"}},
    managers: [
      {id: "old-team", contracts: [{assetId: "dragonite:2", family: "dragonite"}]},
      {id: "new-team", contracts: [{assetId: "dragonite:2", family: "dragonite"}]},
    ],
  };
  const removals = repairDuplicateRetainedContracts(state);
  assert.deepEqual(removals, [{assetId: "dragonite:2", removedFrom: "old-team", retainedBy: "new-team"}]);
  assert.equal(state.managers[0].contracts.length, 0);
  assert.equal(state.managers[1].contracts.length, 1);
  state.assets["dragonite:2"].ownerId = "old-team";
  const changes = reconcileRetainedContractOwners(state);
  assert.deepEqual(changes, [{assetId: "dragonite:2", previousOwner: "old-team", contractOwner: "new-team"}]);
  assert.equal(state.assets["dragonite:2"].ownerId, "new-team");
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function testNaturalEvolutionIsDeterministicAndEcological(): void {
  const competitors = DEFAULT_MANAGER_PROFILES.slice(0, 6).map((source, index) => {
    const profile = cloneManagerProfile(source);
    profile.traits.risk = index < 2 ? .2 : index < 4 ? .5 : .8;
    profile.traits.flexibility = index % 2 ? .75 : .25;
    const low = index < 3;
    const behavior: ObservedBehavior = low
      ? {pace: .2 + index * .01, lineupVariation: .2, starInvestment: .75, roleBreadth: .4, rosterTurnover: .2, knockoutPressure: .45}
      : {pace: .78 + index * .01, lineupVariation: .8, starInvestment: .2, roleBreadth: .8, rosterTurnover: .7, knockoutPressure: .75};
    return {slotId: profile.id, profile: materializeManagerProfile(profile), lineage: founderLineage(profile.id), points: 18 - index * 2, rank: index + 1, behavior, champion: index === 5, playoffScore: index === 5 ? 1 : 0};
  });
  const species = clusterBehaviorSpecies(competitors);
  assert.equal(species.length, 2, "Observed behavior, rather than predefined personality labels, must form species");
  const first = evolveManagerPopulation(competitors, 1, "evolution-regression");
  const second = evolveManagerPopulation(competitors, 1, "evolution-regression");
  assert.deepEqual(first, second, "Evolution must be reproducible from the league seed");
  assert.equal(first.length, competitors.length);
  assert.equal(new Set(first.map(entry => entry.slotId)).size, competitors.length);
  assert.ok(first.every(entry => entry.lineage.generation === 1 && entry.lineage.parentLineageIds.length >= 1));
  const parentCounts = new Map<string, number>();
  for (const child of first) parentCounts.set(child.parentSlotId, (parentCounts.get(child.parentSlotId) ?? 0) + 1);
  assert.ok([...parentCounts.values()].every(count => count <= 2), "No successful lineage may immediately monopolize a six-manager population");
  for (const group of species) {
    const protectedChild = first.find(child => child.protectedCopy && group.members.some(member => member.slotId === child.parentSlotId));
    assert.ok(protectedChild, `Dynamic species ${group.id} lost its protected descendant`);
    const parent = competitors.find(entry => entry.slotId === protectedChild.parentSlotId)!;
    assert.deepEqual(protectedChild.profile.traits, parent.profile.traits, "A protected species copy must not mutate its trait genome");
    assert.deepEqual(protectedChild.profile.genome, parent.profile.genome, "A protected species copy must not mutate its modular genome");
    assert.equal(protectedChild.lineage.niche, group.id);
    assert.deepEqual(protectedChild.lineage.mutations, ["protected-elite-copy"]);
  }
  assert.ok(first.some(child => Object.keys(child.profile.genome?.economics ?? {}).length || Object.keys(child.profile.genome?.tactics ?? {}).length || Object.keys(child.profile.genome?.roles ?? {}).length), "At least one deterministic child should exercise the expanded modular genome");
  assert.ok(first.some(child => child.protectedCopy && child.parentSlotId === competitors[5].slotId), "The champion must leave one exact protected descendant");
}

function testPortfolioAuctionRespectsFreedomAndBudgets(): void {
  const bids = [
    {managerId: "a", assetId: "x", bid: 9, utility: 9}, {managerId: "b", assetId: "x", bid: 7, utility: 8},
    {managerId: "a", assetId: "y", bid: 8, utility: 8}, {managerId: "b", assetId: "y", bid: 8, utility: 9},
    {managerId: "b", assetId: "z", bid: 6, utility: 7}, {managerId: "c", assetId: "z", bid: 5, utility: 6},
  ];
  const limits = ["a", "b", "c"].map(managerId => ({managerId, budget: 12, reserve: 2, maxWins: 2}));
  const first = solvePortfolioAuction(["x", "y", "z"], bids, limits, "portfolio-test", 100);
  assert.deepEqual(first, solvePortfolioAuction(["x", "y", "z"], bids, limits, "portfolio-test", 100));
  assert.equal(new Set(first.map(award => award.assetId)).size, first.length);
  for (const limit of limits) assert.ok(first.filter(award => award.managerId === limit.managerId).reduce((sum, award) => sum + award.payment, 0) <= limit.budget - limit.reserve);
  assert.ok(first.every(award => award.payment <= award.bid && award.payment >= 1));
}

function testQualityDiversityArchiveKeepsDistantViableStrategies(): void {
  const candidates = Array.from({length: 20}, (_, index) => ({id: `common-${index}`, behavior: [index / 200, 0], quality: 1 - index / 100, season: 1, payload: index}));
  candidates.push({id: "distant", behavior: [1, 1], quality: .72, season: 1, payload: 99});
  const archive = updateQualityDiversityArchive([], candidates, 6);
  assert.equal(archive.length, 6);
  assert.ok(archive.some(entry => entry.id === "common-0"), "The highest-quality strategy must survive");
  assert.ok(archive.some(entry => entry.id === "distant"), "A viable behaviorally distant strategy must survive local competition");
}

function testBundledDraftRegistryIsComplete(): void {
  let members = 0;
  const expectedByGeneration: Record<(typeof DRAFT_GENERATIONS)[number], number> = {
    g1: 10,
    g2: 6,
    g3: 6,
    g4: 6,
    g5: 6,
    g6: 5,
  };
  for (const generation of DRAFT_GENERATIONS) {
    const source = draftGenerationSource(generation);
    assert.ok(fs.existsSync(source), `Bundled draft data is missing ${source}`);
    const team = JSON.parse(fs.readFileSync(source, "utf8")) as SandboxTeam;
    assert.equal(team.members.length, expectedByGeneration[generation], `${generation} has an unexpected draft member count`);
    members += team.members.length;
  }
  assert.equal(members, 39);
}

function dynastyRoster(): DynastyRosterMember[] {
  return Array.from({length: 8}, (_, index) => ({
    family: `family-${index}`,
    pokemon: `Mon ${index}`,
    method: index < 2 ? "auction" as const : "supplemental" as const,
    price: index === 0 ? 40 : index === 1 ? 25 : 1,
    market: 30 - index * 2,
    appearances: 20 - index,
    kos: Math.max(1, 20 - index * 2),
    regularSeasonAppearances: 12 - Math.floor(index / 2),
    regularSeasonKos: Math.max(1, 12 - index),
  }));
}

function loadSandboxExample(): SandboxTeam {
  return JSON.parse(fs.readFileSync("examples/sandbox-overlord.json", "utf8")) as SandboxTeam;
}

function testBenchmarkPathsCannotEscapePoolDirectory(): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mythicmons-benchmark-"));
  const poolPath = path.join(tempRoot, "index.json");
  fs.writeFileSync(poolPath, JSON.stringify({
    id: "escape-check",
    format: "gen9ou",
    benchmarks: [{id: "escape", name: "Escape", archetype: "audit", team: "../outside.txt"}],
  }), "utf8");

  const pool = loadBenchmarkPool(poolPath);
  assert.throws(
    () => benchmarkTeamPath(pool, pool.benchmarks[0].team),
    /escapes benchmark pool directory/,
  );
}

function testNumberArgRejectsInvalidRanges(): void {
  assert.throws(
    () => numberArg(parseArgs(["--games", "0"]), "games", 1, {integer: true, min: 1}),
    /--games must be at least 1/,
  );
  assert.throws(
    () => numberArg(parseArgs(["--games", "1.5"]), "games", 1, {integer: true, min: 1}),
    /--games must be an integer/,
  );
}

function testCustomFormatsMergePreservesJavaScript(): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mythicmons-install-"));
  const configDir = path.join(tempRoot, "node_modules", "pokemon-showdown", "dist", "config");
  fs.mkdirSync(configDir, {recursive: true});
  const customFormatsPath = path.join(configDir, "custom-formats.js");
  fs.writeFileSync(customFormatsPath, `"use strict";
exports.Formats = [
	{
		name: "Existing Format",
		battle: { trunc: Math.trunc },
		onValidateSet(set) {
			return set ? null : ["missing set"];
		},
	},
];
`, "utf8");

  const compiled = compileSandboxTeam(loadSandboxExample());
  installCompiledSandbox(compiled, tempRoot);
  const merged = fs.readFileSync(customFormatsPath, "utf8");
  assert.match(merged, /Existing Format/);
  assert.match(merged, /onValidateSet\(set\)/);
  assert.match(merged, /battle: \{ trunc: Math\.trunc \}/);
  assert.match(merged, /mythicmons:start/);
  assert.match(merged, /\[Gen 9\] MythicMons Sandbox/);
}

function testCompositeItemIncludesControlHooks(): void {
  const compiled = compileSandboxTeam(loadSandboxExample());
  const items = compiled.files["items.js"];
  const scripts = compiled.files["scripts.js"];
  const typechart = compiled.files["typechart.js"];
  assert.match(items, /onModifyMove\(\.\.\.args\)/);
  assert.match(items, /onDisableMove\(\.\.\.args\)/);
  assert.match(items, /onModifyAtkPriority:/);
  assert.match(items, /mythicSourceItems:/);
  assert.match(items, /isBerry:/);
  assert.match(items, /onDamagingHit\(\.\.\.args\)/);
  assert.match(items, /onImmunity\(\.\.\.args\)/);
  assert.match(items, /onUpdate\(\.\.\.args\)/);
  assert.match(items, /onAnySwitchIn\(\.\.\.args\)/);
  assert.match(items, /onAfterSetStatus\(\.\.\.args\)/);
  assert.match(items, /onModifyCritRatio\(\.\.\.args\)/);
  assert.match(items, /onSourceModifyAccuracy\(\.\.\.args\)/);
  assert.match(items, /onModifyAccuracy\(\.\.\.args\)/);
  assert.match(items, /onTakeItem\(\.\.\.args\)/);
  assert.doesNotMatch(items, /onTakeItem: false/);
  assert.match(items, /activeItemIds/);
  assert.match(scripts, /mythicSourceItemIds\(\)/);
  assert.match(scripts, /checkEVBalance\(\) \{\}/);
  assert.match(scripts, /hasItem\(item\)/);
  assert.match(scripts, /eatItem\(force, source, sourceEffect\)/);
  assert.match(scripts, /useItem\(source, sourceEffect\)/);
  assert.match(compiled.files["abilities.js"], /mythicSourceAbilities:/);
  assert.doesNotMatch(typechart, /prankster: 0/);

  const whiteHerbCompiled = compileSandboxTeam({
    name: "White Herb Composite Probe",
    members: [{
      id: "probe", species: "Dragalge", abilities: ["Adaptability"],
      items: ["White Herb", "Heavy-Duty Boots", "Choice Specs"], moves: ["Draco Meteor"],
    }],
  });
  assert.match(whiteHerbCompiled.files["items.js"], /onAnySwitchInPriority: -2/);
  assert.ok(!whiteHerbCompiled.manifest.warnings.some(warning => warning.includes("whiteherb.onAnySwitchIn")));
}

function testCompositeSourceHooksUseSourceHolder(): void {
  const compiled = compileSandboxTeam({
    name: "Source Hook Probe",
    members: [{
      id: "probe",
      species: "Pikachu",
      abilities: ["Static"],
      items: ["Leftovers", "Wide Lens"],
      moves: ["Thunder"],
    }],
  });
  const tables = loadGeneratedExports(compiled.files["items.js"]);
  const composite = tables.Items[compiled.manifest.syntheticItems[0]] as {
    onSourceModifyAccuracy: (...args: unknown[]) => unknown;
    onSourceModifyDamage: (...args: unknown[]) => unknown;
  };
  const delegated: string[] = [];
  const battle = {
    dex: {items: {get: (id: string) => ({
      onSourceModifyAccuracy: () => delegated.push(`accuracy:${id}`),
      onSourceModifyDamage: () => delegated.push(`damage:${id}`),
    })}},
  };
  const target = {mythicSourceItemIds: () => ["targetitem"]};
  const source = {mythicSourceItemIds: () => ["sourceitem"]};

  composite.onSourceModifyAccuracy.call(battle, 100, target, source, {});
  composite.onSourceModifyDamage.call(battle, 100, target, source, {});
  assert.deepEqual(delegated, ["accuracy:sourceitem", "damage:sourceitem"]);
}

function testCompositeItemsStackSharedStatModifiers(): void {
  const compiled = compileSandboxTeam({
    name: "Shared Modifier Probe",
    members: [{
      id: "eviolite-av-probe", species: "Glameow", abilities: ["Limber"],
      items: ["Assault Vest", "Eviolite", "Leftovers"], moves: ["Tackle"],
    }],
  });
  const tables = loadGeneratedExports(compiled.files["items.js"]);
  const composite = tables.Items[compiled.manifest.syntheticItems[0]] as {
    onModifySpD: (...args: unknown[]) => unknown;
  };
  const battle = {
    dex: Dex,
    event: {modifier: 1},
    trunc: Math.trunc,
    chainModify(numerator: number, denominator = 1) {
      const previousMod = Math.trunc(this.event.modifier * 4096);
      const nextMod = Math.trunc(numerator * 4096 / denominator);
      this.event.modifier = ((previousMod * nextMod + 2048) >> 12) / 4096;
    },
  };
  const holder = {
    baseSpecies: {nfe: true}, item: compiled.manifest.syntheticItems[0], itemState: {}, m: {},
    mythicSourceItemIds: () => ["assaultvest", "eviolite", "leftovers"],
  };
  composite.onModifySpD.call(battle, 100, holder);
  assert.equal(battle.event.modifier, 2.25);
}

function testTechnician70Threshold(): void {
  const source = JSON.parse(fs.readFileSync("../audit-g4-kricketune/g4-kricketune.json", "utf8")) as SandboxTeam;
  const compiled = compileSandboxTeam(source);
  const tables = loadGeneratedExports(compiled.files["abilities.js"]);
  const ability = tables.Abilities["technician70"] as {
    onBasePower: (...args: unknown[]) => unknown;
  };
  const battle = {
    event: {modifier: 1},
    debug() {},
    modify(value: number, modifier: number) { return Math.trunc(value * modifier); },
    chainModify(modifier: number) { this.event.modifier *= modifier; },
  };
  ability.onBasePower.call(battle, 70, {}, {}, {id: "uturn"});
  assert.equal(battle.event.modifier, 1.5);
  battle.event.modifier = 1;
  ability.onBasePower.call(battle, 90, {}, {}, {id: "firstimpression"});
  assert.equal(battle.event.modifier, 1);
}

function loadGeneratedExports(source: string): Record<string, Record<string, unknown>> {
  const module = {exports: {}} as {exports: Record<string, Record<string, unknown>>};
  const evaluate = new Function("exports", "module", source);
  evaluate(module.exports, module);
  return module.exports;
}

function testMegaStoneDefaultsToMegaSpecies(): void {
  const plainMega = compileSandboxTeam({
    name: "Mega Probe",
    members: [{
      id: "garchomp",
      species: "Garchomp",
      abilities: ["Rough Skin"],
      items: ["Garchompite"],
      moves: ["Earthquake"],
    }],
  });
  assert.equal(plainMega.team[0].species, "Garchomp-Mega");
  assert.equal(plainMega.team[0].item, "");

  const mythicMega = compileSandboxTeam({
    name: "Mythic Mega Probe",
    members: [{
      id: "garchomp",
      species: "Garchomp",
      baseStats: {hp: 108, atk: 170, def: 115, spa: 120, spd: 95, spe: 102},
      abilities: ["Rough Skin", "Speed Boost"],
      items: ["Garchompite", "Leftovers"],
      moves: ["Earthquake"],
    }],
  });
  assert.match(mythicMega.team[0].species, /^Mythic Garchomp-Mega /);
  assert.match(mythicMega.files["pokedex.js"], /baseSpecies: "Garchomp"/);
  assert.equal(mythicMega.team[0].item, "Leftovers");
  assert.equal(mythicMega.manifest.warnings.some(warning => warning.includes("garchompite.onTakeItem")), false);
}

function testSyntheticSpeciesPreservesEvolutionMetadata(): void {
  const compiled = compileSandboxTeam({
    name: "Eviolite Probe",
    members: [{
      id: "electabuzz",
      species: "Electabuzz",
      baseStats: {hp: 65, atk: 83, def: 87, spa: 95, spd: 115, spe: 105},
      abilities: ["Static"],
      items: ["Eviolite"],
      moves: ["Thunder"],
    }],
  });
  assert.match(compiled.files["pokedex.js"], /nfe: true/);
  assert.match(compiled.files["pokedex.js"], /evos: \[[\s\S]*"Electivire"[\s\S]*\]/);
}

function testSyntheticIdsOnlyChangeWithRelevantInputs(): void {
  const baseline = loadSandboxExample();
  const changedMove = loadSandboxExample();
  changedMove.members[0].moves = [...changedMove.members[0].moves, "Fire Punch"];
  const changedItem = loadSandboxExample();
  changedItem.members[0].items = ["Life Orb", "Leftovers"];

  const baseCompiled = compileSandboxTeam(baseline);
  const moveCompiled = compileSandboxTeam(changedMove);
  const itemCompiled = compileSandboxTeam(changedItem);
  const reordered = loadSandboxExample();
  reordered.members[0].abilities = [...(reordered.members[0].abilities ?? [])].reverse();
  reordered.members[0].items = [...(reordered.members[0].items ?? [])].reverse();
  const reorderedCompiled = compileSandboxTeam(reordered);

  assert.equal(moveCompiled.manifest.syntheticSpecies[0], baseCompiled.manifest.syntheticSpecies[0]);
  assert.equal(moveCompiled.manifest.syntheticItems[0], baseCompiled.manifest.syntheticItems[0]);
  assert.notEqual(itemCompiled.manifest.syntheticItems[0], baseCompiled.manifest.syntheticItems[0]);
  assert.equal(itemCompiled.manifest.syntheticSpecies[0], baseCompiled.manifest.syntheticSpecies[0]);
  assert.equal(reorderedCompiled.manifest.syntheticAbilities[0], baseCompiled.manifest.syntheticAbilities[0]);
  assert.equal(reorderedCompiled.manifest.syntheticItems[0], baseCompiled.manifest.syntheticItems[0]);
}

function testCustomItemAndMoveEntriesCompile(): void {
  const compiled = compileSandboxTeam({
    name: "Raw Entry Probe",
    customItems: [{id: "probe-item", entry: "{name: 'Probe Item', onResidual(pokemon) { this.heal(1, pokemon); }}"}],
    customMoves: [{
      id: "probe-move",
      type: "Normal",
      category: "Status",
      entry: "{name: 'Probe Move', accuracy: true, basePower: 0, category: 'Status', type: 'Normal', pp: 5, target: 'self', onHit(pokemon) { this.heal(1, pokemon); }}",
    }],
    members: [{id: "probe", species: "Pikachu", abilities: ["Static"], items: ["probe-item"], moves: ["probe-move"]}],
  });
  assert.match(compiled.files["items.js"], /onResidual\(pokemon\)/);
  assert.match(compiled.files["moves.js"], /onHit\(pokemon\)/);
}

function testInstalledSandboxTablesMerge(): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mythicmons-merge-"));
  const first = compileSandboxTeam({
    name: "First",
    members: [{
      id: "first", species: "Pikachu",
      baseStats: {hp: 36, atk: 55, def: 40, spa: 50, spd: 50, spe: 90},
      abilities: ["Static", "Lightning Rod"], items: ["Leftovers", "Wide Lens"], moves: ["Thunderbolt"],
    }],
  });
  const second = compileSandboxTeam({
    name: "Second",
    members: [{
      id: "second", species: "Raichu",
      baseStats: {hp: 61, atk: 90, def: 55, spa: 90, spd: 80, spe: 110},
      abilities: ["Static", "Lightning Rod"], items: ["Leftovers", "Wide Lens"], moves: ["Thunderbolt"],
    }],
  });
  installCompiledSandbox(first, tempRoot, {backup: false});
  installCompiledSandbox(second, tempRoot, {backup: true});
  const modRoot = path.join(tempRoot, "node_modules", "pokemon-showdown", "dist", "data", "mods");
  const pokedex = fs.readFileSync(path.join(modRoot, "mythicmons", "pokedex.js"), "utf8");
  assert.match(pokedex, new RegExp(first.manifest.syntheticSpecies[0]));
  assert.match(pokedex, new RegExp(second.manifest.syntheticSpecies[0]));
  assert.equal(fs.readdirSync(modRoot).some(name => name.startsWith("mythicmons.before-mythicmons-")), true);
}

function testCustomEffectConflictsRequireExplicitReplacement(): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mythicmons-conflict-"));
  const makeSandbox = (description: string): SandboxTeam => ({
    name: `Conflict ${description}`,
    customItems: [{id: "shared-custom-item", entry: `{name: 'Shared Custom Item', shortDesc: '${description}'}`}],
    members: [{
      id: "probe", species: "Pikachu", abilities: ["Static"],
      items: ["shared-custom-item", "Leftovers"], moves: ["Thunderbolt"],
    }],
  });
  const first = compileSandboxTeam(makeSandbox("first"));
  const second = compileSandboxTeam(makeSandbox("second"));
  installCompiledSandbox(first, tempRoot, {backup: false});
  assert.throws(
    () => installCompiledSandbox(second, tempRoot, {backup: false}),
    /Custom sandbox Items id conflict: sharedcustomitem/,
  );
  assert.doesNotThrow(() => installCompiledSandbox(second, tempRoot, {backup: false, replaceConflicts: true}));
}

function testTeamPreviewUsesDelimitedSlots(): void {
  const context = createBattleAiContext("gen9ou");
  const choice = chooseAction({
    teamPreview: true,
    side: {
      id: "p1",
      pokemon: Array.from({length: 12}, (_, index) => ({
        ident: `p1: Test ${index + 1}`,
        condition: "100/100",
      })),
    },
  }, "p1", "basic", context);
  assert.equal(choice, "team 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12");
}

function testAiAllowsForcedRechargeMove(): void {
  const context = createBattleAiContext("gen9ou");
  const choice = chooseAction({
    active: [{
      trapped: true,
      moves: [{id: "recharge", move: "Recharge"}],
    }],
    side: {
      id: "p1",
      pokemon: [
        {
          ident: "p1: Porygon2",
          details: "Porygon2, L80",
          condition: "100/100",
          active: true,
          moves: ["hyperbeam", "gigaimpact", "icebeam", "thunderbolt"],
        },
        {
          ident: "p1: Backup",
          details: "Blissey, L80",
          condition: "100/100",
        },
      ],
    },
  }, "p1", "basic", context);
  assert.equal(choice, "move recharge");
}

function testSearchAiUsesOpenTeamSheets(): void {
  const opponentTeam = Teams.import(`Rotom-Wash @ Leftovers
Ability: Levitate
- Hydro Pump
- Volt Switch
- Will-O-Wisp
- Protect`)!;
  const request = {
    active: [{moves: [
      {id: "earthquake", move: "Earthquake", pp: 10},
      {id: "dragonclaw", move: "Dragon Claw", pp: 15},
    ]}],
    side: {id: "p1" as const, pokemon: [{
      ident: "p1: Garchomp", details: "Garchomp, L100", condition: "100/100", active: true,
      stats: {atk: 359, def: 226, spa: 176, spd: 206, spe: 303},
      moves: ["earthquake", "dragonclaw"], ability: "Rough Skin", item: "Leftovers",
    }]},
  };

  const open = createBattleAiContext("gen9ou", {openTeamSheets: true, teams: {p2: opponentTeam}});
  updateAiContextFromPublicLine(open, "|switch|p1a: Garchomp|Garchomp, L100|100/100");
  updateAiContextFromPublicLine(open, "|switch|p2a: Rotom-Wash|Rotom-Wash, L100|100/100");
  assert.equal(chooseAction(request, "p1", "search", open), "move dragonclaw");
  const trace = open.lastDecision.p1;
  assert.ok(trace);
  assert.equal(trace.selected, "move dragonclaw");
  const responseProbabilities = new Map(trace.candidates[0].responses.map(response => [response.response, response.policyShare]));
  assert.ok((responseProbabilities.get("move hydropump") ?? 0) > (responseProbabilities.get("move protect") ?? 0));
  assert.ok(Math.abs([...responseProbabilities.values()].reduce((sum, value) => sum + value, 0) - 1) < 0.01);
  assert.ok(trace.candidates.every(candidate => Number.isFinite(candidate.score)));
  assert.ok(trace.candidates.every(candidate => candidate.responses.every(response => Number.isFinite(response.value))));

  const closed = createBattleAiContext("gen9ou", {openTeamSheets: false, teams: {p2: opponentTeam}});
  updateAiContextFromPublicLine(closed, "|switch|p1a: Garchomp|Garchomp, L100|100/100");
  updateAiContextFromPublicLine(closed, "|switch|p2a: Rotom-Wash|Rotom-Wash, L100|100/100");
  assert.equal(closed.teamSheets.p2.length, 0);
  assert.equal(chooseAction(request, "p1", "search", closed), "move earthquake");
  assert.ok(closed.lastDecision.p1?.candidates.every(candidate => {
    return candidate.responses.every(response => response.response === "unknown");
  }));
}

function testSearchTracksBenchStateAcrossSwitches(): void {
  const opponentTeam = Teams.import(`Washer (Rotom-Wash) @ Leftovers
Ability: Levitate
- Hydro Pump
- Volt Switch

Gholdengo @ Choice Scarf
Ability: Good as Gold
- Make It Rain
- Shadow Ball`)!;
  const context = createBattleAiContext("gen9ou", {openTeamSheets: true, teams: {p2: opponentTeam}});
  updateAiContextFromPublicLine(context, "|switch|p2a: Washer|Rotom-Wash, L100|100/100");
  updateAiContextFromPublicLine(context, "|-damage|p2a: Washer|40/100");
  updateAiContextFromPublicLine(context, "|-enditem|p2a: Washer|Leftovers");
  updateAiContextFromPublicLine(context, "|switch|p2a: Gholdengo|Gholdengo, L100|100/100");
  updateAiContextFromPublicLine(context, "|switch|p2a: Washer|Rotom-Wash, L100|40/100");
  assert.equal(context.active.p2?.hpPercent, 40);
  assert.equal(context.active.p2?.items.has("leftovers"), false);
  assert.ok((context.active.p2?.stats.spe ?? 0) > 0);
}

function testSearchFiltersChoiceLockAndModelsOpponentTera(): void {
  const opponentTeam = Teams.import(`Gholdengo @ Choice Scarf
Ability: Good as Gold
Tera Type: Steel
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Make It Rain
- Shadow Ball
- Trick
- Recover`)!;
  const context = createBattleAiContext("gen9ou", {openTeamSheets: true, teams: {p2: opponentTeam}});
  updateAiContextFromPublicLine(context, "|switch|p1a: Garchomp|Garchomp, L100|20/100");
  updateAiContextFromPublicLine(context, "|switch|p2a: Gholdengo|Gholdengo, L100|100/100");
  updateAiContextFromPublicLine(context, "|move|p2a: Gholdengo|Make It Rain|p1a: Garchomp");
  const choice = chooseAction({
    active: [{moves: [
      {id: "earthquake", move: "Earthquake", pp: 10},
      {id: "protect", move: "Protect", pp: 10},
    ]}],
    side: {id: "p1", pokemon: [{
      ident: "p1: Garchomp", details: "Garchomp, L100", condition: "20/100", active: true,
      stats: {atk: 359, def: 226, spa: 176, spd: 206, spe: 303},
      moves: ["earthquake", "protect"], ability: "Rough Skin", item: "Leftovers",
    }]},
  }, "p1", "search", context);
  assert.equal(choice, "move protect");
  const responses = context.lastDecision.p1?.candidates[0].responses.map(response => response.response) ?? [];
  const moveResponses = responses.filter(response => response.startsWith("move "));
  assert.ok(moveResponses.length >= 2);
  assert.ok(moveResponses.every(response => response.includes("makeitrain")));
  assert.ok(moveResponses.some(response => response.includes("terastallize Steel")));
}

function testSearchScoresStatusConsequencesAndTrapping(): void {
  const opponentTeam = Teams.import(`Rotom-Wash @ Leftovers
Ability: Levitate
- Will-O-Wisp
- Splash

Blissey @ Leftovers
Ability: Natural Cure
- Seismic Toss`)!;
  const context = createBattleAiContext("gen9ou", {openTeamSheets: true, teams: {p2: opponentTeam}});
  updateAiContextFromPublicLine(context, "|switch|p1a: Garchomp|Garchomp, L100|100/100");
  updateAiContextFromPublicLine(context, "|switch|p2a: Rotom-Wash|Rotom-Wash, L100|100/100");
  updateAiContextFromPublicLine(context, "|-start|p2a: Rotom-Wash|trapped");
  chooseAction({
    active: [{moves: [{id: "dragonclaw", move: "Dragon Claw", pp: 15}]}],
    side: {id: "p1", pokemon: [{
      ident: "p1: Garchomp", details: "Garchomp, L100", condition: "100/100", active: true,
      stats: {atk: 359, def: 226, spa: 176, spd: 206, spe: 303},
      moves: ["dragonclaw"], ability: "Rough Skin", item: "Leftovers",
    }]},
  }, "p1", "search", context);
  const responses = context.lastDecision.p1?.candidates[0].responses ?? [];
  const willOWisp = responses.find(response => response.response === "move willowisp")?.value;
  const splash = responses.find(response => response.response === "move splash")?.value;
  assert.ok(willOWisp !== undefined && splash !== undefined && willOWisp < splash - 30);
  assert.equal(responses.some(response => response.response.startsWith("switch ")), false);
}

function testSearchTreatsOwnTeraAsSeparateAction(): void {
  const opponentTeam = Teams.import(`Blissey @ Leftovers
Ability: Natural Cure
- Seismic Toss`)!;
  const context = createBattleAiContext("gen9ou", {openTeamSheets: true, teams: {p2: opponentTeam}});
  updateAiContextFromPublicLine(context, "|switch|p1a: Garchomp|Garchomp, L100|100/100");
  updateAiContextFromPublicLine(context, "|switch|p2a: Blissey|Blissey, L100|100/100");
  chooseAction({
    active: [{canTerastallize: "Ground", moves: [{id: "earthquake", move: "Earthquake", pp: 10}]}],
    side: {id: "p1", pokemon: [{
      ident: "p1: Garchomp", details: "Garchomp, L100", condition: "100/100", active: true,
      stats: {atk: 359, def: 226, spa: 176, spd: 206, spe: 303},
      moves: ["earthquake"], ability: "Rough Skin", item: "Leftovers",
    }]},
  }, "p1", "search", context);
  const choices = context.lastDecision.p1?.candidates.map(candidate => candidate.choice) ?? [];
  assert.ok(choices.includes("move earthquake"));
  assert.ok(choices.includes("move earthquake terastallize"));
}

function testTacticalAiPrefersBatonPassSetup(): void {
  const context = createBattleAiContext("gen9ou");
  const choice = chooseAction({
    active: [{
      moves: [
        {id: "batonpass", move: "Baton Pass"},
        {id: "coil", move: "Coil"},
        {id: "protect", move: "Protect"},
        {id: "substitute", move: "Substitute"},
      ],
    }],
    side: {
      id: "p1",
      pokemon: [{
        ident: "p1: Furret",
        details: "Furret, L80",
        condition: "100/100",
        active: true,
        moves: ["batonpass", "coil", "protect", "substitute"],
      }],
    },
  }, "p1", "tactical", context);
  assert.equal(choice, "move coil");
}

function testAiAvoidsTypeAndKnownAbilityImmunities(): void {
  const context = createBattleAiContext("gen9ou");
  updateAiContextFromPublicLine(context, "|switch|p1a: Great Tusk|Great Tusk, L100|100/100");
  updateAiContextFromPublicLine(context, "|switch|p2a: Corviknight|Corviknight, L100|100/100");
  const request = {
    active: [{moves: [
      {id: "earthquake", move: "Earthquake"},
      {id: "knockoff", move: "Knock Off"},
    ]}],
    side: {id: "p1" as const, pokemon: [{
      ident: "p1: Great Tusk", details: "Great Tusk, L100", condition: "100/100", active: true,
      stats: {atk: 361}, moves: ["earthquake", "knockoff"], ability: "Protosynthesis",
    }]},
  };
  assert.equal(chooseAction(request, "p1", "basic", context), "move knockoff");

  updateAiContextFromPublicLine(context, "|switch|p2a: Vaporeon|Vaporeon, L100|100/100");
  updateAiContextFromPublicLine(context, "|-ability|p2a: Vaporeon|Water Absorb");
  const waterRequest = {
    ...request,
    active: [{moves: [{id: "surf", move: "Surf"}, {id: "icebeam", move: "Ice Beam"}]}],
  };
  assert.equal(chooseAction(waterRequest, "p1", "basic", context), "move icebeam");

  updateAiContextFromPublicLine(context, "|move|p1a: Great Tusk|Fake Out|p2a: Vaporeon");
  const fakeOutRequest = {
    ...request,
    active: [{moves: [{id: "fakeout", move: "Fake Out"}, {id: "uturn", move: "U-turn"}]}],
  };
  assert.equal(chooseAction(fakeOutRequest, "p1", "tactical", context), "move uturn");

  const firstImpressionRequest = {
    ...request,
    active: [{moves: [
      {id: "firstimpression", move: "First Impression"},
      {id: "stickyweb", move: "Sticky Web"},
    ]}],
  };
  recordAiChoice(context, "p1", "move uturn", fakeOutRequest);
  assert.equal(chooseAction(firstImpressionRequest, "p1", "tactical", context), "move stickyweb");
}

function testTacticalAiPassesAccumulatedBoosts(): void {
  const context = createBattleAiContext("gen9ou");
  updateAiContextFromPublicLine(context, "|switch|p1a: Furret|Furret, L100|100/100");
  updateAiContextFromPublicLine(context, "|switch|p2a: Blissey|Blissey, L100|100/100");
  for (let index = 0; index < 6; index += 1) {
    updateAiContextFromPublicLine(context, "|-boost|p1a: Furret|atk|1");
    updateAiContextFromPublicLine(context, "|-boost|p1a: Furret|def|1");
  }
  const choice = chooseAction({
    active: [{moves: [
      {id: "batonpass", move: "Baton Pass"},
      {id: "coil", move: "Coil"},
      {id: "protect", move: "Protect"},
      {id: "substitute", move: "Substitute"},
    ]}],
    side: {id: "p1", pokemon: [
      {ident: "p1: Furret", details: "Furret, L100", condition: "100/100", active: true, moves: ["batonpass", "coil", "protect", "substitute"]},
      {ident: "p1: Noctowl", details: "Noctowl, L100", condition: "100/100"},
    ]},
  }, "p1", "tactical", context);
  assert.equal(choice, "move batonpass");
}

function testBatonPlannerUsesSpeedBoostTurn(): void {
  const context = createBattleAiContext("gen9ou");
  updateAiContextFromPublicLine(context, "|switch|p1a: Furret|Furret, L100|100/100");
  updateAiContextFromPublicLine(context, "|switch|p2a: Mew|Mew, L100|100/100");
  const choice = chooseAction({
    active: [{moves: [
      {id: "batonpass", move: "Baton Pass"},
      {id: "coil", move: "Coil"},
      {id: "protect", move: "Protect"},
      {id: "substitute", move: "Substitute"},
    ]}],
    side: {id: "p1", pokemon: [
      {
        ident: "p1: Furret", details: "Furret, L100", condition: "100/100", active: true,
        moves: ["batonpass", "coil", "protect", "substitute"], ability: "Speed Boost",
      },
      {
        ident: "p1: Garchomp", details: "Garchomp, L100", condition: "100/100",
        moves: ["earthquake", "dragonclaw"], stats: {atk: 350, spe: 250}, ability: "Rough Skin",
      },
    ]},
  }, "p1", "tactical", context);
  assert.equal(choice, "move protect");
}

function testBatonPassPreservesBoostState(): void {
  const context = createBattleAiContext("gen9ou");
  updateAiContextFromPublicLine(context, "|switch|p1a: Furret|Furret, L100|100/100");
  updateAiContextFromPublicLine(context, "|-boost|p1a: Furret|atk|2");
  updateAiContextFromPublicLine(context, "|-boost|p1a: Furret|spe|2");
  updateAiContextFromPublicLine(context, "|-start|p1a: Furret|Substitute");
  updateAiContextFromPublicLine(context, "|move|p1a: Furret|Baton Pass|p1a: Furret");
  updateAiContextFromPublicLine(context, "|switch|p1a: Noctowl|Noctowl, L100|100/100|[from] Baton Pass");
  assert.equal(context.active.p1?.boosts.atk, 2);
  assert.equal(context.active.p1?.boosts.spe, 2);
  assert.equal(context.active.p1?.volatiles.has("substitute"), true);
}

function testAiTracksTeraTypesAndPreservesImmunities(): void {
  const offensive = createBattleAiContext("gen9ou");
  updateAiContextFromPublicLine(offensive, "|switch|p1a: Mew|Mew, L100|100/100");
  updateAiContextFromPublicLine(offensive, "|switch|p2a: Garchomp|Garchomp, L100|100/100");
  updateAiContextFromPublicLine(offensive, "|-terastallize|p2a: Garchomp|Fairy");
  const offensiveChoice = chooseAction({
    active: [{moves: [{id: "dragonpulse", move: "Dragon Pulse"}, {id: "flashcannon", move: "Flash Cannon"}]}],
    side: {id: "p1", pokemon: [{
      ident: "p1: Mew", details: "Mew, L100", condition: "100/100", active: true,
      stats: {atk: 200, def: 200, spa: 200, spd: 200, spe: 200}, ability: "Synchronize",
    }]},
  }, "p1", "basic", offensive);
  assert.equal(offensiveChoice, "move flashcannon");

  const defensive = createBattleAiContext("gen9ou");
  updateAiContextFromPublicLine(defensive, "|switch|p1a: Gengar|Gengar, L100|50/100");
  updateAiContextFromPublicLine(defensive, "|switch|p2a: Sylveon|Sylveon, L100|100/100");
  updateAiContextFromPublicLine(defensive, "|move|p2a: Sylveon|Hyper Voice|p1a: Gengar");
  const defensiveChoice = chooseAction({
    active: [{canTerastallize: "Water", moves: [{id: "shadowball", move: "Shadow Ball"}]}],
    side: {id: "p1", pokemon: [{
      ident: "p1: Gengar", details: "Gengar, L100", condition: "50/100", active: true,
      stats: {atk: 100, def: 160, spa: 300, spd: 180, spe: 300}, ability: "Cursed Body",
    }]},
  }, "p1", "tactical", defensive);
  assert.equal(defensiveChoice, "move shadowball");
}

function testAiSwitchesWhenEveryMoveScoresZero(): void {
  const context = createBattleAiContext("gen9ou");
  updateAiContextFromPublicLine(context, "|switch|p1a: Persian|Persian, L100|100/100");
  updateAiContextFromPublicLine(context, "|switch|p2a: Gengar|Gengar, L100|100/100");
  const choice = chooseAction({
    active: [{moves: [{id: "fakeout", move: "Fake Out"}, {id: "hypervoice", move: "Hyper Voice"}]}],
    side: {id: "p1", pokemon: [
      {ident: "p1: Persian", details: "Persian, L100", condition: "100/100", active: true, ability: "Technician"},
      {ident: "p1: Alakazam", details: "Alakazam, L100", condition: "100/100", ability: "Magic Guard", moves: ["psychic"]},
    ]},
  }, "p1", "basic", context);
  assert.equal(choice, "switch 2");
}

function testAiHandlesMoldBreakerAndScrappy(): void {
  const moldBreaker = createBattleAiContext("gen9ou");
  updateAiContextFromPublicLine(moldBreaker, "|switch|p1a: Excadrill|Excadrill, L100|100/100");
  updateAiContextFromPublicLine(moldBreaker, "|switch|p2a: Rotom|Rotom-Wash, L100|100/100");
  updateAiContextFromPublicLine(moldBreaker, "|-ability|p2a: Rotom|Levitate");
  const earthquake = chooseAction({
    active: [{moves: [{id: "earthquake", move: "Earthquake"}, {id: "rockslide", move: "Rock Slide"}]}],
    side: {id: "p1", pokemon: [{
      ident: "p1: Excadrill", details: "Excadrill, L100", condition: "100/100", active: true,
      stats: {atk: 300, def: 200, spa: 100, spd: 200, spe: 200}, ability: "Mold Breaker",
    }]},
  }, "p1", "basic", moldBreaker);
  assert.equal(earthquake, "move earthquake");

  const scrappy = createBattleAiContext("gen9ou");
  updateAiContextFromPublicLine(scrappy, "|switch|p1a: Ursaring|Ursaring, L100|100/100");
  updateAiContextFromPublicLine(scrappy, "|switch|p2a: Gengar|Gengar, L100|100/100");
  const facade = chooseAction({
    active: [{moves: [{id: "facade", move: "Facade"}, {id: "aerialace", move: "Aerial Ace"}]}],
    side: {id: "p1", pokemon: [{
      ident: "p1: Ursaring", details: "Ursaring, L100", condition: "100/100 brn", active: true,
      stats: {atk: 300, def: 200, spa: 100, spd: 200, spe: 150}, ability: "Scrappy",
    }]},
  }, "p1", "basic", scrappy);
  assert.equal(facade, "move facade");
}

function testAiUsesDynamicWeatherMovesAndTrickRoom(): void {
  const weather = createBattleAiContext("gen9ou");
  updateAiContextFromPublicLine(weather, "|switch|p1a: Dewgong|Dewgong, L100|100/100");
  updateAiContextFromPublicLine(weather, "|switch|p2a: Mew|Mew, L100|100/100");
  updateAiContextFromPublicLine(weather, "|-weather|RainDance|[upkeep]");
  const weatherChoice = chooseAction({
    active: [{moves: [
      {id: "aquajet", move: "Aqua Jet"}, {id: "weatherball", move: "Weather Ball"},
      {id: "raindance", move: "Rain Dance"}, {id: "snowscape", move: "Snowscape"},
    ]}],
    side: {id: "p1", pokemon: [{
      ident: "p1: Dewgong", details: "Dewgong, L100", condition: "100/100", active: true,
      stats: {atk: 200, def: 200, spa: 200, spd: 200, spe: 200}, ability: "Thick Fat",
      moves: ["aquajet", "weatherball", "raindance", "snowscape"],
    }]},
  }, "p1", "tactical", weather);
  assert.equal(weatherChoice, "move weatherball");

  const trickRoom = createBattleAiContext("gen9ou");
  updateAiContextFromPublicLine(trickRoom, "|switch|p1a: Hatterene|Hatterene, L100|100/100");
  updateAiContextFromPublicLine(trickRoom, "|switch|p2a: Furret|Furret, L100|100/100");
  const trickRoomChoice = chooseAction({
    active: [{moves: [{id: "psyshock", move: "Psyshock"}, {id: "drainingkiss", move: "Draining Kiss"}, {id: "trickroom", move: "Trick Room"}]}],
    side: {id: "p1", pokemon: [{
      ident: "p1: Hatterene", details: "Hatterene, L100", condition: "100/100", active: true,
      stats: {atk: 100, def: 250, spa: 300, spd: 250, spe: 60}, ability: "Magic Bounce",
      moves: ["psyshock", "drainingkiss", "trickroom"],
    }]},
  }, "p1", "tactical", trickRoom);
  assert.equal(trickRoomChoice, "move trickroom");
}

function testAiRespectsPriorityBlockingAbilities(): void {
  const context = createBattleAiContext("gen9ou");
  updateAiContextFromPublicLine(context, "|switch|p1a: Dewgong|Dewgong, L100|100/100");
  updateAiContextFromPublicLine(context, "|switch|p2a: Delibird|Delibird, L100|100/100");
  updateAiContextFromPublicLine(context, "|cant|p2a: Delibird|ability: Dazzling|Aqua Jet|[of] p1a: Dewgong");
  const choice = chooseAction({
    active: [{moves: [{id: "aquajet", move: "Aqua Jet"}, {id: "weatherball", move: "Weather Ball"}]}],
    side: {id: "p1", pokemon: [{
      ident: "p1: Dewgong", details: "Dewgong, L100", condition: "100/100", active: true,
      stats: {atk: 250, def: 250, spa: 250, spd: 250, spe: 250}, ability: "Thick Fat",
    }]},
  }, "p1", "tactical", context);
  assert.equal(choice, "move weatherball");

  const customPriority = createBattleAiContext("gen9ou");
  updateAiContextFromPublicLine(customPriority, "|switch|p1a: Corsola|Corsola, L100|100/100");
  updateAiContextFromPublicLine(customPriority, "|switch|p2a: Delibird|Delibird, L100|100/100");
  updateAiContextFromPublicLine(customPriority, "|-ability|p2a: Delibird|Dazzling");
  const customChoice = chooseAction({
    active: [{moves: [{id: "surf", move: "Surf"}, {id: "recover", move: "Recover"}]}],
    side: {id: "p1", pokemon: [{
      ident: "p1: Corsola", details: "Corsola, L100", condition: "60/100", active: true,
      stats: {atk: 200, def: 250, spa: 250, spd: 250, spe: 200}, ability: "allmovesplusonepriority",
    }]},
  }, "p1", "tactical", customPriority);
  assert.equal(customChoice, "move recover");
}

function testTacticalAiDoesNotReviveInvalidMoves(): void {
  const hazards = createBattleAiContext("gen9ou");
  updateAiContextFromPublicLine(hazards, "|switch|p1a: Magmar|Magmar, L100|343/374 par");
  updateAiContextFromPublicLine(hazards, "|switch|p2a: Blissey|Blissey, L100|484/714 brn");
  updateAiContextFromPublicLine(hazards, "|-sidestart|p1: Team A|move: Stealth Rock");
  const hazardChoice = chooseAction({
    active: [{moves: [{id: "seismictoss", move: "Seismic Toss"}, {id: "stealthrock", move: "Stealth Rock"}]}],
    side: {id: "p2", pokemon: [{
      ident: "p2: Blissey", details: "Blissey, L100", condition: "484/714 brn", active: true,
      stats: {atk: 50, def: 130, spa: 186, spd: 307, spe: 146}, ability: "Natural Cure",
    }]},
  }, "p2", "tactical", hazards);
  assert.equal(hazardChoice, "move seismictoss");

  const destinyBond = createBattleAiContext("gen9ou");
  updateAiContextFromPublicLine(destinyBond, "|switch|p1a: Delibird|Delibird, L100|20/100");
  updateAiContextFromPublicLine(destinyBond, "|switch|p2a: Mew|Mew, L100|100/100");
  updateAiContextFromPublicLine(destinyBond, "|move|p1a: Delibird|Destiny Bond|p1a: Delibird");
  updateAiContextFromPublicLine(destinyBond, "|-singlemove|p1a: Delibird|Destiny Bond");
  const destinyChoice = chooseAction({
    active: [{moves: [{id: "destinybond", move: "Destiny Bond"}, {id: "iceshard", move: "Ice Shard"}]}],
    side: {id: "p1", pokemon: [{
      ident: "p1: Delibird", details: "Delibird, L100", condition: "20/100", active: true,
      stats: {atk: 250, def: 150, spa: 150, spd: 150, spe: 250}, ability: "Hustle",
    }]},
  }, "p1", "tactical", destinyBond);
  assert.equal(destinyChoice, "move iceshard");
}

function testAiRetainsRevealedDamageThreats(): void {
  const context = createBattleAiContext("gen9ou");
  updateAiContextFromPublicLine(context, "|switch|p1a: Gyarados|Gyarados, L100|50/100");
  updateAiContextFromPublicLine(context, "|switch|p2a: Zapdos|Zapdos, L100|100/100");
  updateAiContextFromPublicLine(context, "|move|p2a: Zapdos|Thunderbolt|p1a: Gyarados");
  updateAiContextFromPublicLine(context, "|move|p2a: Zapdos|Roost|p2a: Zapdos");
  const choice = chooseAction({
    active: [{moves: [{id: "tackle", move: "Tackle"}]}],
    side: {id: "p1", pokemon: [
      {ident: "p1: Gyarados", details: "Gyarados, L100", condition: "50/100", active: true,
        stats: {atk: 300, def: 200, spa: 150, spd: 220, spe: 220}, ability: "Intimidate"},
      {ident: "p1: Clodsire", details: "Clodsire, L100", condition: "100/100", ability: "Water Absorb", moves: ["earthquake"]},
    ]},
  }, "p1", "tactical", context);
  assert.equal(choice, "switch 2");
}

function testAiDoesNotOscillateBetweenOwnWeatherMoves(): void {
  const context = createBattleAiContext("gen9ou");
  updateAiContextFromPublicLine(context, "|switch|p1a: Dewgong|Dewgong, L100|100/100");
  updateAiContextFromPublicLine(context, "|switch|p2a: Vaporeon|Vaporeon, L100|100/100");
  updateAiContextFromPublicLine(context, "|-weather|RainDance|[upkeep]");
  const choice = chooseAction({
    active: [{moves: [{id: "raindance", move: "Rain Dance"}, {id: "snowscape", move: "Snowscape"}, {id: "protect", move: "Protect"}]}],
    side: {id: "p1", pokemon: [{
      ident: "p1: Dewgong", details: "Dewgong, L100", condition: "100/100", active: true,
      stats: {atk: 200, def: 250, spa: 250, spd: 250, spe: 200}, ability: "Thick Fat",
      moves: ["raindance", "snowscape", "protect"],
    }]},
  }, "p1", "tactical", context);
  assert.equal(choice, "move protect");
}

function testWishExpiresWithoutHealAndAiNeverIllegallyPasses(): void {
  const context = createBattleAiContext("gen9ou");
  updateAiContextFromPublicLine(context, "|turn|1");
  updateAiContextFromPublicLine(context, "|switch|p1a: Alomomola|Alomomola, L100|100/100");
  updateAiContextFromPublicLine(context, "|switch|p2a: Vaporeon|Vaporeon, L100|100/100");
  updateAiContextFromPublicLine(context, "|-ability|p2a: Vaporeon|Water Absorb");
  updateAiContextFromPublicLine(context, "|move|p1a: Alomomola|Wish|p1a: Alomomola");
  const request = {
    active: [{trapped: true, moves: [{id: "scald", move: "Scald"}, {id: "wish", move: "Wish"}]}],
    side: {id: "p1" as const, pokemon: [{
      ident: "p1: Alomomola", details: "Alomomola, L100", condition: "100/100", active: true,
      stats: {atk: 150, def: 250, spa: 150, spd: 200, spe: 150}, ability: "Regenerator",
    }]},
  };
  updateAiContextFromPublicLine(context, "|turn|2");
  assert.equal(chooseAction(request, "p1", "tactical", context), "move scald");
  updateAiContextFromPublicLine(context, "|turn|3");
  assert.equal(chooseAction(request, "p1", "tactical", context), "move wish");
}

function testBeneficialSideConditionsAreNotHazards(): void {
  const context = createBattleAiContext("gen9ou");
  updateAiContextFromPublicLine(context, "|-sidestart|p1: Team A|move: Reflect");
  const choice = chooseAction({
    forceSwitch: [true],
    side: {id: "p1", pokemon: [
      {ident: "p1: Fainted", details: "Mew, L100", condition: "0 fnt", active: true},
      {ident: "p1: No Boots", details: "Mew, L100", condition: "100/100", ability: "Synchronize"},
      {ident: "p1: Boots", details: "Mew, L100", condition: "100/100", ability: "Synchronize", item: "Heavy-Duty Boots"},
    ]},
  }, "p1", "basic", context);
  assert.equal(choice, "switch 2");
}

function testTeamPreviewChoosesRoleLead(): void {
  const context = createBattleAiContext("gen9ou");
  const choice = chooseAction({
    teamPreview: true,
    side: {id: "p1", pokemon: [
      {ident: "p1: Attacker", condition: "100/100", moves: ["psychic"]},
      {ident: "p1: Setter", condition: "100/100", moves: ["trickroom", "healingwish"]},
    ]},
  }, "p1", "tactical", context);
  assert.equal(choice, "team 2, 1");
}

function testAiRejectsNonSinglesFormats(): void {
  assert.throws(
    () => createBattleAiContext("gen9doublesou"),
    /AI strategy only supports singles formats/,
  );
}

function testHybridScoringExcludesTechnicalDraws(): void {
  const summary = summarizeCandidate([{
    teamX: "candidate",
    teamY: "opponent",
    games: 10,
    xWins: 5,
    yWins: 0,
    draws: 5,
    technicalDraws: 5,
    averageTurns: 50,
  }]);
  assert.equal(summary.score, 1);
  assert.equal(summary.scoreLowerBound, 0.5);
  assert.equal(summary.scoreTechnicalDrawHalf, 0.75);
  assert.equal(summary.scoreUpperBound, 1);
}

function testHybridDeltaUsesPairedSeedClusters(): void {
  const gameResults = (scores: number[]) => scores.flatMap((score, gameIndex) => ([
    {gameIndex, orientation: "x-as-team-a" as const, xScore: score, technical: false, turns: 10},
    {gameIndex, orientation: "x-as-team-b" as const, xScore: score, technical: false, turns: 10},
  ]));
  const pair = (teamX: string, scores: number[]) => ({
    teamX,
    teamY: "opponent",
    games: scores.length * 2,
    xWins: 0,
    yWins: 0,
    draws: 0,
    technicalDraws: 0,
    averageTurns: 10,
    gameResults: gameResults(scores),
  });
  const paired = pairedDeltaSummary([pair("hybrid", [1, 0])], [pair("host", [0, 0])]);
  assert.equal(paired.pairs, 2);
  assert.equal(paired.mean, 0.5);
}

async function testTeamDatabaseRoundTrip(): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mythicmons-team-db-"));
  const db = await openTeamDatabase(path.join(tempRoot, "teams.json"));
  try {
    const loaded = loadTeam("examples/teamA.txt");
    const saved = await saveTeam(db, {
      id: "regression-team",
      name: "Regression Team",
      format: "gen9ou",
      sets: loaded.sets,
      sourcePath: "examples/teamA.txt",
      tags: ["regression", "fixture"],
      sandboxSource: loadSandboxExample(),
      sandboxManifest: compileSandboxTeam(loadSandboxExample()).manifest,
    });
    assert.equal(saved.id, "regression-team");
    assert.equal(saved.teamJson.length, loaded.sets.length);
    assert.match(saved.exported, /Great Tusk/);

    const teams = await listTeams(db);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].id, "regression-team");

    const fetched = await getTeam(db, "regression-team");
    assert.equal(fetched?.tags.join(","), "regression,fixture");
    assert.equal(fetched?.sandboxSource?.name, loadSandboxExample().name);
    assert.ok(fetched?.sandboxManifest?.syntheticItems.length);
  } finally {
    await closeTeamDatabase(db);
  }
}

async function testMaxTurnsIsDraw(): Promise<void> {
  const teamA = loadTeam("examples/teamA.txt");
  const teamB = loadTeam("examples/teamB.txt");
  const outDir = path.join("output", "regression-maxturns");
  const result = await runBattle({
    format: "gen9ou",
    teamA: teamA.packed,
    teamB: teamB.packed,
    seed: "regression",
    gameIndex: 0,
    outDir,
    maxTurns: 1,
    ai: "basic",
  });
  assert.equal(result.winner, null);
  assert.equal(result.timeout, true);
}

async function testTechnicalDrawIsExcludedFromEvaluationScore(): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mythicmons-eval-draw-"));
  const summary = await evaluateCandidate({
    candidatePath: "examples/teamA.txt",
    pool: {
      id: "draw-probe",
      format: "gen9ou",
      rootDir: process.cwd(),
      benchmarks: [{id: "probe", name: "Probe", archetype: "probe", team: "examples/teamB.txt"}],
    },
    format: "gen9ou",
    seed: "draw-probe",
    gamesPerBenchmark: 1,
    outDir: tempRoot,
    maxTurns: 1,
    validate: true,
    ai: "basic",
  });
  assert.equal(summary.timeoutGames, 1);
  assert.equal(summary.technicalDraws, 1);
  assert.equal(summary.scoredGames, 0);
  assert.equal(summary.matchups[0].resultScore, 0);
  assert.equal(summary.relativeScore, null);
  assert.equal(summary.matchupConsistency, null);
  assert.deepEqual(summary.keyMatchups, {best: [], worst: []});
}

async function testBattleRequestsUseLatestPublicState(): Promise<void> {
  const furret = Teams.pack([{
    name: "Furret", species: "Furret", ability: "Run Away", item: "Leftovers",
    moves: ["Coil", "Tackle"], nature: "Serious", gender: "", evs: {}, ivs: {}, level: 100,
  }]);
  const hatterene = Teams.pack([{
    name: "Hatterene", species: "Hatterene", ability: "Magic Bounce", item: "Leftovers",
    moves: ["Trick Room", "Psyshock"], nature: "Serious", gender: "", evs: {}, ivs: {}, level: 100,
  }]);
  const result = await runBattle({
    format: "gen9ou",
    teamA: furret,
    teamB: hatterene,
    seed: "request-ordering",
    gameIndex: 0,
    outDir: path.join("output", "regression-request-ordering"),
    maxTurns: 3,
    ai: "tactical",
  });
  const log = fs.readFileSync(result.publicLogPath, "utf8");
  assert.equal((log.match(/\|move\|p2a: Hatterene\|Trick Room/g) ?? []).length, 1);
  assert.match(log, /\|-fieldstart\|move: Trick Room/);
  assert.match(log, /\|move\|p2a: Hatterene\|Psyshock/);
}

async function testPlayerContextsDoNotLeakCurrentChoices(): Promise<void> {
  const pelipper = Teams.pack([{
    name: "Pelipper", species: "Pelipper", ability: "Drizzle", item: "Leftovers",
    moves: ["Surf"], nature: "Modest", gender: "", evs: {spa: 252}, ivs: {}, level: 100,
  }]);
  const coalossalAndGastrodon = Teams.pack([{
    name: "Coalossal", species: "Coalossal", ability: "Flame Body", item: "Leftovers",
    moves: ["Rock Slide"], nature: "Serious", gender: "", evs: {}, ivs: {}, level: 100,
  }, {
    name: "Gastrodon", species: "Gastrodon", ability: "Storm Drain", item: "Leftovers",
    moves: ["Earth Power"], nature: "Serious", gender: "", evs: {}, ivs: {}, level: 100,
  }]);
  const result = await runBattle({
    format: "gen9customgame",
    teamA: pelipper,
    teamB: coalossalAndGastrodon,
    seed: "isolated-player-contexts",
    gameIndex: 0,
    outDir: path.join("output", "regression-isolated-player-contexts"),
    maxTurns: 2,
    ai: "tactical",
  });
  const log = fs.readFileSync(result.publicLogPath, "utf8");
  const surfIndex = log.indexOf("|move|p1a: Pelipper|Surf|p2a: Coalossal");
  assert.notEqual(surfIndex, -1);
  assert.doesNotMatch(log.slice(0, surfIndex), /\|switch\|p2a: Gastrodon/);
}

function testKoAttributionHandlesSelfKoAndHazards(): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mythicmons-ko-"));
  const recoilLog = path.join(tempRoot, "recoil.log");
  fs.writeFileSync(recoilLog, [
    "|turn|1",
    "|move|p2a: Recoiler|Flare Blitz|p1a: Target",
    "|-damage|p2a: Recoiler|0 fnt|[from] Recoil",
    "|faint|p2a: Recoiler",
  ].join("\n"), "utf8");
  const recoil = analyzePublicLog(recoilLog, "Team A", 1);
  assert.equal(recoil.p1Kos["uncredited/self-KO"], 1);

  const hazardLog = path.join(tempRoot, "hazard.log");
  fs.writeFileSync(hazardLog, [
    "|turn|1",
    "|move|p1a: Setter|Stealth Rock|p2a: Target",
    "|-sidestart|p2: Team B|move: Stealth Rock",
    "|turn|2",
    "|-damage|p2a: Victim|0 fnt|[from] Stealth Rock",
    "|faint|p2a: Victim",
  ].join("\n"), "utf8");
  const hazard = analyzePublicLog(hazardLog, "Team A", 2);
  assert.equal(hazard.p1Kos.Setter, 1);

  const toxicSpikesLog = path.join(tempRoot, "toxic-spikes.log");
  fs.writeFileSync(toxicSpikesLog, [
    "|move|p1a: Toxic Setter|Toxic Spikes|p2a: Target",
    "|-sidestart|p2: Team B|move: Toxic Spikes",
    "|switch|p2a: Poisoned Victim|Pikachu|100/100",
    "|-status|p2a: Poisoned Victim|tox",
    "|turn|2",
    "|-damage|p2a: Poisoned Victim|0 fnt|[from] psn",
    "|faint|p2a: Poisoned Victim",
  ].join("\n"), "utf8");
  const toxicSpikes = analyzePublicLog(toxicSpikesLog, "Team A", 2);
  assert.equal(toxicSpikes.p1Kos["Toxic Setter"], 1);
}

async function testCompositeConsumablePreservesSiblingItems(): Promise<void> {
  const compiled = compileSandboxTeam(runtimeTestSandbox());
  const restore = snapshotInstalledSandbox(compiled);
  try {
    installCompiledSandbox(compiled, process.cwd(), {backup: false});
    const opponent = Teams.pack([{
      name: "Mewtwo", species: "Mewtwo", ability: "Pressure", item: "", moves: ["Psystrike"],
      nature: "Serious", gender: "", evs: {}, ivs: {}, level: 100,
    }]);
    const result = await runBattle({
      format: compiled.formatId,
      teamA: Teams.pack([compiled.team[0]]),
      teamB: opponent,
      seed: "composite-consumable",
      gameIndex: 0,
      outDir: path.join("output", "regression-composite-consumable"),
      maxTurns: 10,
      ai: "first",
    });
    const log = fs.readFileSync(result.publicLogPath, "utf8");
    assert.match(log, /\|-enditem\|p1a: Sash Probe\|Focus Sash/);
    assert.match(log, /\|-heal\|p1a: Sash Probe\|12\/181\|\[from\] item:/);
    assert.doesNotMatch(log, /\|-enditem\|p1a: Sash Probe\|Mythic Item/);
    assert.doesNotMatch(log, /\|split\|/);
  } finally {
    restore();
  }
}

async function testCompositeAirBalloonPreservesSiblingItems(): Promise<void> {
  const compiled = compileSandboxTeam({
    name: "Air Balloon Runtime Probe",
    members: [{
      id: "balloon-probe",
      nickname: "Balloon Probe",
      species: "Arcanine",
      types: ["Steel", "Fire"],
      baseStats: {hp: 90, atk: 80, def: 125, spa: 80, spd: 115, spe: 95},
      abilities: ["Intimidate"],
      items: ["Leftovers", "Air Balloon", "Heavy-Duty Boots"],
      moves: ["Will-O-Wisp", "Toxic", "Flamethrower", "Morning Sun"],
    }],
  });
  const restore = snapshotInstalledSandbox(compiled);
  try {
    installCompiledSandbox(compiled, process.cwd(), {backup: false});
    const opponent = Teams.pack([{
      name: "Hit Probe", species: "Mew", ability: "Synchronize", item: "", moves: ["Tackle"],
      nature: "Serious", gender: "", evs: {}, ivs: {}, level: 100,
    }]);
    const result = await runBattle({
      format: compiled.formatId,
      teamA: Teams.pack(compiled.team),
      teamB: opponent,
      seed: "composite-air-balloon",
      gameIndex: 0,
      outDir: path.join("output", "regression-composite-air-balloon"),
      maxTurns: 3,
      ai: "first",
    });
    const log = fs.readFileSync(result.publicLogPath, "utf8");
    assert.match(log, /\|-enditem\|p1a: Balloon Probe\|Air Balloon/);
    assert.match(log, /\|-heal\|p1a: Balloon Probe\|[^|]+\|\[from\] item:/);
    assert.doesNotMatch(log, /\|-enditem\|p1a: Balloon Probe\|Mythic Item/);
  } finally {
    restore();
  }
}

async function testPersianDelayedTechnicianUTurn(): Promise<void> {
  const compiled = compileSandboxTeam({
    name: "Persian U-turn Runtime Probe",
    customMoves: [{
      id: "regression-persian-u-turn",
      type: "Bug",
      category: "Physical",
      entry: "{name: 'Regression Persian U-turn', accuracy: 100, basePower: 70, basePowerCallback(pokemon) { return pokemon.hasAbility('technician') ? 105 : 70; }, category: 'Physical', type: 'Bug', pp: 20, priority: -1, target: 'normal', flags: {contact: 1, protect: 1, mirror: 1, metronome: 1}, selfSwitch: true}",
    }],
    members: [{
      id: "persian-probe", nickname: "Persian Probe", species: "Persian",
      types: ["Normal", "Flying"],
      baseStats: {hp: 135, atk: 100, def: 60, spa: 65, spd: 65, spe: 115},
      abilities: ["Technician", "Fur Coat"], items: ["Leftovers", "Heavy-Duty Boots", "Assault Vest"],
      moves: ["regression-persian-u-turn"],
    }],
  });
  const moves = loadGeneratedExports(compiled.files["moves.js"]).Moves;
  const customMove = moves["regressionpersianuturn"] as {
    priority: number;
    selfSwitch: boolean;
    basePowerCallback: (pokemon: {hasAbility: (ability: string) => boolean}) => number;
  };
  assert.equal(customMove.priority, -1);
  assert.equal(customMove.selfSwitch, true);
  assert.equal(customMove.basePowerCallback({hasAbility: ability => ability === "technician"}), 105);
  assert.equal(customMove.basePowerCallback({hasAbility: () => false}), 70);

  const restore = snapshotInstalledSandbox(compiled);
  try {
    installCompiledSandbox(compiled, process.cwd(), {backup: false});
    const backup = {
      name: "Backup", species: "Pikachu", ability: "Static", item: "", moves: ["Tackle"],
      nature: "Serious", gender: "", evs: {}, ivs: {}, level: 100,
    };
    const opponent = [{
      name: "Slow Probe", species: "Shuckle", ability: "Sturdy", item: "", moves: ["Tackle"],
      nature: "Serious", gender: "", evs: {}, ivs: {}, level: 100,
    }, backup];
    const result = await runBattle({
      format: compiled.formatId,
      teamA: Teams.pack([compiled.team[0], backup]),
      teamB: Teams.pack(opponent),
      seed: "persian-delayed-u-turn",
      gameIndex: 0,
      outDir: path.join("output", "regression-persian-delayed-u-turn"),
      maxTurns: 2,
      ai: "first",
    });
    const log = fs.readFileSync(result.publicLogPath, "utf8");
    const tackle = log.indexOf("|move|p2a: Slow Probe|Tackle");
    const uTurn = log.indexOf("|move|p1a: Persian Probe|Regression Persian U-turn");
    assert.ok(tackle >= 0 && uTurn > tackle);
    assert.match(log, /\|switch\|p1a: Backup\|Pikachu/);
  } finally {
    restore();
  }
}

async function testAiReadsCompositeAbilityMetadata(): Promise<void> {
  const compiled = compileSandboxTeam(runtimeTestSandbox());
  const restore = snapshotInstalledSandbox(compiled);
  try {
    installCompiledSandbox(compiled, process.cwd(), {backup: false});
    const context = createBattleAiContext(compiled.formatId);
    updateAiContextFromPublicLine(context, "|switch|p2a: Target|Mew|100/100");
    const active = compiled.team[1];
    const choice = chooseAction({
      active: [{moves: [
        {id: "bulletseed", move: "Bullet Seed", pp: 30},
        {id: "leafblade", move: "Leaf Blade", pp: 15},
      ]}],
      side: {id: "p1", pokemon: [{
        ident: "p1: Skill Link Probe", details: active.species, condition: "100/100", active: true,
        stats: {atk: 100, def: 100, spa: 100, spd: 100, spe: 100},
        item: active.item, ability: active.ability,
      }]},
    }, "p1", "damage", context);
    assert.equal(choice, "move bulletseed");
  } finally {
    restore();
  }
}

async function testMegaSolPersonalSunMechanics(): Promise<void> {
  const source = JSON.parse(fs.readFileSync("../audit-g2-meganium/g2-meganium.json", "utf8")) as SandboxTeam;
  const compiled = compileSandboxTeam({
    ...source,
    name: "Mega Sol Personal Sun Probe",
    members: [{
      ...source.members[0], id: "mega-sol-probe", nickname: "Mega Sol Probe", species: "Meganium",
      types: ["Grass", "Fire"],
      baseStats: {hp: 110, atk: 112, def: 130, spa: 113, spd: 130, spe: 80},
      abilities: ["mega-sol-leaf-guard"], items: ["Leftovers", "Heavy-Duty Boots"],
      moves: ["Solar Beam", "Weather Ball", "Synthesis"],
    }],
  });
  const restore = snapshotInstalledSandbox(compiled);
  try {
    installCompiledSandbox(compiled, process.cwd(), {backup: false});
    const toxicOpponent = Teams.pack([{
      name: "Toxic Probe", species: "Eternatus", ability: "Pressure", item: "", moves: ["Toxic"],
      nature: "Timid", gender: "", evs: {spe: 252}, ivs: {}, level: 100,
    }]);
    const toxicResult = await runBattle({
      format: compiled.formatId,
      teamA: Teams.pack(compiled.team),
      teamB: toxicOpponent,
      seed: "mega-sol-leaf-guard",
      gameIndex: 0,
      outDir: path.join("output", "regression-mega-sol-leaf-guard"),
      maxTurns: 2,
      ai: "first",
    });
    const toxicLog = fs.readFileSync(toxicResult.publicLogPath, "utf8");
    assert.doesNotMatch(toxicLog, /\|-weather\|(?:DesolateLand|SunnyDay)/);
    assert.match(toxicLog, /\|move\|p2a: Toxic Probe\|Toxic\|p1a: Mega Sol Probe/);
    assert.doesNotMatch(toxicLog, /\|-status\|p1a: Mega Sol Probe\|tox/);
    assert.match(toxicLog, /\|move\|p1a: Mega Sol Probe\|Solar Beam\|p2a: Toxic Probe/);

    const scizor = Teams.pack([{
      name: "Steel Probe", species: "Scizor", ability: "Swarm", item: "", moves: ["Tackle"],
      nature: "Serious", gender: "", evs: {}, ivs: {}, level: 100,
    }]);
    const weatherBallTeam = [{...compiled.team[0], moves: ["Weather Ball"]}];
    const weatherBallResult = await runBattle({
      format: compiled.formatId, teamA: Teams.pack(weatherBallTeam), teamB: scizor,
      seed: "mega-sol-weather-ball", gameIndex: 0,
      outDir: path.join("output", "regression-mega-sol-weather-ball"), maxTurns: 2, ai: "first",
    });
    const weatherBallLog = fs.readFileSync(weatherBallResult.publicLogPath, "utf8");
    assert.match(weatherBallLog, /\|move\|p1a: Mega Sol Probe\|Weather Ball\|p2a: Steel Probe/);
    assert.match(weatherBallLog, /\|-supereffective\|p2a: Steel Probe/);

    const kyogre = Teams.pack([{
      name: "Rain Probe", species: "Kyogre", ability: "Drizzle", item: "", moves: ["Surf"],
      nature: "Timid", gender: "", evs: {spe: 252}, ivs: {}, level: 100,
    }]);
    const rainResult = await runBattle({
      format: compiled.formatId, teamA: Teams.pack(compiled.team), teamB: kyogre,
      seed: "mega-sol-rain", gameIndex: 0,
      outDir: path.join("output", "regression-mega-sol-rain"), maxTurns: 2, ai: "first",
    });
    const rainLog = fs.readFileSync(rainResult.publicLogPath, "utf8");
    assert.match(rainLog, /\|-weather\|RainDance/);
    assert.match(rainLog, /\|move\|p2a: Rain Probe\|Surf\|p1a: Mega Sol Probe/);
    assert.match(rainLog, /\|-damage\|p1a: Mega Sol Probe/);
    assert.doesNotMatch(rainLog, /\|-fail\|p2a: Rain Probe/);
    assert.match(rainLog, /\|move\|p1a: Mega Sol Probe\|Solar Beam\|p2a: Rain Probe/);

    const synthesisTeam = [{...compiled.team[0], moves: ["Synthesis"]}];
    const synthesisResult = await runBattle({
      format: compiled.formatId, teamA: Teams.pack(synthesisTeam), teamB: kyogre,
      seed: "mega-sol-synthesis", gameIndex: 0,
      outDir: path.join("output", "regression-mega-sol-synthesis"), maxTurns: 2, ai: "first",
    });
    const synthesisLog = fs.readFileSync(synthesisResult.publicLogPath, "utf8");
    assert.match(synthesisLog, /\|-weather\|RainDance/);
    assert.match(synthesisLog, /\|move\|p1a: Mega Sol Probe\|Synthesis\|p1a: Mega Sol Probe/);
    assert.match(synthesisLog, /\|-heal\|p1a: Mega Sol Probe\|424\/424/);
  } finally {
    restore();
  }
}

async function testCompositeStatusMovePriority(): Promise<void> {
  const compiled = compileSandboxTeam({
    name: "Magic Bounce Status Priority Probe",
    customAbilities: [{
      id: "regression-magic-bounce-status-priority",
      entry: "{name: 'Regression Magic Bounce + Status Priority', onModifyPriority(priority, pokemon, target, move) { if (move.category === 'Status') return priority + 1; }, onTryHitPriority: 1, onTryHit(target, source, move) { if (target === source || move.hasBounced || !move.flags['reflectable'] || target.isSemiInvulnerable()) return; const newMove = this.dex.getActiveMove(move.id); newMove.hasBounced = true; newMove.pranksterBoosted = false; this.actions.useMove(newMove, target, {target: source}); return null; }, onAllyTryHitSide(target, source, move) { if (target.isAlly(source) || move.hasBounced || !move.flags['reflectable'] || target.isSemiInvulnerable()) return; const newMove = this.dex.getActiveMove(move.id); newMove.hasBounced = true; newMove.pranksterBoosted = false; this.actions.useMove(newMove, this.effectState.target, {target: source}); return null; }, condition: {duration: 1}, flags: {breakable: 1}}",
    }],
    members: [{
      id: "priority-probe", nickname: "Priority Probe", species: "Sableye",
      baseStats: {hp: 80, atk: 75, def: 105, spa: 65, spd: 95, spe: 50},
      abilities: ["regression-magic-bounce-status-priority"],
      items: ["Leftovers", "Heavy-Duty Boots"], moves: ["Taunt", "Foul Play"],
    }],
  });
  const restore = snapshotInstalledSandbox(compiled);
  try {
    installCompiledSandbox(compiled, process.cwd(), {backup: false});
    const opponent = Teams.pack([{
      name: "Fast Taunt", species: "Deoxys-Speed", ability: "Pressure", item: "", moves: ["Taunt"],
      nature: "Timid", gender: "", evs: {spe: 252}, ivs: {}, level: 100,
    }]);
    const result = await runBattle({
      format: compiled.formatId,
      teamA: Teams.pack(compiled.team),
      teamB: opponent,
      seed: "composite-status-priority",
      gameIndex: 0,
      outDir: path.join("output", "regression-composite-status-priority"),
      maxTurns: 2,
      ai: "first",
    });
    const log = fs.readFileSync(result.publicLogPath, "utf8");
    const sableyeTaunt = log.indexOf("|move|p1a: Priority Probe|Taunt");
    const deoxysCant = log.indexOf("|cant|p2a: Fast Taunt|move: Taunt");
    assert.ok(sableyeTaunt >= 0 && deoxysCant > sableyeTaunt);
    assert.doesNotMatch(log, /\|move\|p1a: Priority Probe\|Foul Play/);
  } finally {
    restore();
  }
}

async function testNormalizeThunderWaveTargets(): Promise<void> {
  const compiled = compileSandboxTeam({
    name: "Normalize Thunder Wave Probe",
    members: [{
      id: "normalize-probe", nickname: "Normalize Probe", species: "Delcatty",
      types: ["Normal", "Flying"], abilities: ["Normalize", "Cute Charm", "Wonder Skin"],
      items: ["Leftovers", "Rocky Helmet"], moves: ["Thunder Wave"],
    }],
  });
  const restore = snapshotInstalledSandbox(compiled);
  try {
    installCompiledSandbox(compiled, process.cwd(), {backup: false});
    const groundTarget = Teams.pack([{
      name: "Ground Target", species: "Hippowdon", ability: "Sand Stream", item: "", moves: ["Tackle"],
      nature: "Serious", gender: "", evs: {}, ivs: {}, level: 100,
    }]);
    const ghostTarget = Teams.pack([{
      name: "Ghost Target", species: "Gengar", ability: "Cursed Body", item: "", moves: ["Tackle"],
      nature: "Serious", gender: "", evs: {}, ivs: {}, level: 100,
    }]);
    const groundResult = await runBattle({
      format: compiled.formatId, teamA: Teams.pack(compiled.team), teamB: groundTarget,
      seed: "normalize-thunder-wave-ground", gameIndex: 0,
      outDir: path.join("output", "regression-normalize-thunder-wave-ground"), maxTurns: 2, ai: "first",
    });
    const ghostResult = await runBattle({
      format: compiled.formatId, teamA: Teams.pack(compiled.team), teamB: ghostTarget,
      seed: "normalize-thunder-wave-ghost", gameIndex: 0,
      outDir: path.join("output", "regression-normalize-thunder-wave-ghost"), maxTurns: 2, ai: "first",
    });
    const groundLog = fs.readFileSync(groundResult.publicLogPath, "utf8");
    const ghostLog = fs.readFileSync(ghostResult.publicLogPath, "utf8");
    assert.match(groundLog, /\|-status\|p2a: Ground Target\|par/);
    assert.doesNotMatch(ghostLog, /\|-status\|p2a: Ghost Target\|par/);
    assert.match(ghostLog, /\|-immune\|p2a: Ghost Target/);
  } finally {
    restore();
  }
}

function runtimeTestSandbox(): SandboxTeam {
  const overlord = loadSandboxExample();
  const probes: SandboxTeam = {
    name: "Composite Runtime Probes",
    members: [{
      id: "sash-probe",
      nickname: "Sash Probe",
      species: "Pichu",
      abilities: ["Static"],
      items: ["Focus Sash", "Leftovers"],
      moves: ["Tackle"],
    }, {
      id: "skill-link-probe",
      species: "Minccino",
      abilities: ["Run Away", "Skill Link"],
      items: ["Leftovers", "Wide Lens"],
      moves: ["Bullet Seed", "Leaf Blade"],
    }],
  };
  return {
    name: "Combined Runtime Test Registry",
    customMoves: overlord.customMoves,
    customAbilities: overlord.customAbilities,
    customItems: overlord.customItems,
    members: [...probes.members, ...overlord.members],
  };
}

async function testCompositeChoiceLockRunsInBattle(): Promise<void> {
  const compiled = compileSandboxTeam(runtimeTestSandbox());
  const restore = snapshotInstalledSandbox(compiled);
  try {
    installCompiledSandbox(compiled, process.cwd(), {backup: false});

    const outDir = path.join("output", "regression-choice-lock");
    const teamB = loadTeam("examples/teamB.txt");
    const result = await runBattle({
      format: compiled.formatId,
      teamA: Teams.pack([compiled.team[2]]),
      teamB: teamB.packed,
      seed: "regression-choice-lock",
      gameIndex: 0,
      outDir,
      maxTurns: 10,
      ai: "basic",
    });

    const raw = fs.readFileSync(result.rawLogPath, "utf8");
    assert.match(raw, /"move":"Custom Nuke"/);
    assert.equal(hasLockedCompositeChoiceRequest(raw), true);
  } finally {
    restore();
  }
}

async function testSearchBattleConverges(): Promise<void> {
  const teamA = loadTeam("examples/teamA.txt");
  const teamB = loadTeam("examples/teamB.txt");
  const result = await runBattle({
    format: "gen9ou",
    teamA: teamA.packed,
    teamB: teamB.packed,
    seed: "regression-search-converges",
    gameIndex: 0,
    outDir: path.join("output", "regression-search-converges"),
    maxTurns: 100,
    ai: "search",
    openTeamSheets: true,
    traceAiDecisions: true,
  });
  const publicLog = fs.readFileSync(result.publicLogPath, "utf8");
  const decisions = JSON.parse(fs.readFileSync(result.decisionLogPath, "utf8")) as Array<{
    selected?: string;
    candidates?: unknown[];
  }>;
  assert.equal(result.ended, true);
  assert.equal(result.timeout, false);
  assert.match(publicLog, /^\|move\|/m);
  assert.ok(decisions.length > 0);
  assert.ok(decisions.every(decision => Boolean(decision.selected) && (decision.candidates?.length ?? 0) > 0));
}

function snapshotInstalledSandbox(compiled: ReturnType<typeof compileSandboxTeam>): () => void {
  const packageRoot = path.join(process.cwd(), "node_modules", "pokemon-showdown", "dist");
  const paths = [
    path.join(packageRoot, "config", "custom-formats.js"),
    ...Object.keys(compiled.files)
      .filter(file => file !== "custom-formats.js")
      .map(file => path.join(packageRoot, "data", "mods", compiled.modId, file)),
  ];
  const snapshot = paths.map(targetPath => ({
    targetPath,
    existed: fs.existsSync(targetPath),
    contents: fs.existsSync(targetPath) ? fs.readFileSync(targetPath) : null,
  }));

  return () => {
    for (const entry of snapshot) {
      if (entry.existed && entry.contents) {
        fs.mkdirSync(path.dirname(entry.targetPath), {recursive: true});
        fs.writeFileSync(entry.targetPath, entry.contents);
      } else if (!entry.existed && fs.existsSync(entry.targetPath)) {
        fs.rmSync(entry.targetPath);
      }
    }
  };
}

function hasLockedCompositeChoiceRequest(raw: string): boolean {
  for (const line of raw.split(/\r?\n/)) {
    const marker = "|request|";
    const index = line.indexOf(marker);
    if (index < 0) continue;
    const payload = line.slice(index + marker.length);
    if (!payload || payload === "null") continue;
    const request = JSON.parse(payload) as {
      active?: Array<{moves?: Array<{id: string; disabled?: boolean}>}>;
      side?: {id?: string; pokemon?: Array<{ident: string; active?: boolean}>};
    };
    const active = request.side?.pokemon?.find(pokemon => pokemon.active);
    if (request.side?.id !== "p1" || !active?.ident.includes("Fourfold")) continue;
    const moves = request.active?.[0]?.moves ?? [];
    if (moves.some(move => move.id !== "customnuke" && move.disabled)) return true;
  }
  return false;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
