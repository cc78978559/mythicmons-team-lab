import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {spawnSync} from "node:child_process";
import {buildUnifiedEvidencePlan, unifiedEvidenceMarkdown} from "../ai/whiteBox/unifiedEvidence";
import {aggregateUnifiedEvidence, aggregateUnifiedMemoryEvidence} from "../ai/whiteBox/unifiedAggregation";
import {createBattleReplayCapsule} from "../showdown/battle";
import {AI_VERSION, DEFAULT_TACTICAL_PROFILE, EMPTY_OPPONENT_MODEL} from "../showdown/choice";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "unified-whitebox-"));
try {
  const candidate = (id: string, rational: number, style: number) => ({id, eligible: true, reasonable: true, hardRejections: [], rationalScore: rational, rawStyleScore: style, appliedStyleScore: style, finalScore: rational + style, contributions: [{id: "test.value", group: "value", source: "competence", value: rational, reason: "test"}]});
  const shadow = (decisionId: string, incumbent: string, selected: string) => ({version: "white-box-decision-v1", decisionId, comparison: {incumbent, shadow: selected, agrees: false}, candidateCount: 2, reasonableCount: 2, hardRejectedCount: 0, candidates: [candidate(incumbent, 2, 0), candidate(selected, 2.4, .1)]});
  const lineupShadow = () => ({version: "white-box-decision-v1", decisionId: "lineup:series-1:manager-03", comparison: {incumbent: "a+b+c+d+e+f", shadow: "a+b+c+d+e+g", agrees: false}, candidateCount: 2, reasonableCount: 2, hardRejectedCount: 0, reasonableBand: .25, styleContributionLimit: 2, candidates: [
    {id: "a+b+c+d+e+f", eligible: true, reasonable: true, hardRejections: [], rationalScore: 2, rawStyleScore: 0, appliedStyleScore: 0, finalScore: 2, contributions: [{id: "lineup.strength", group: "strength", source: "competence", value: 2, reason: "strength"}, {id: "lineup.risk", group: "personality", source: "personality", value: 0, reason: "risk"}, {id: "lineup.counter", group: "matchup", source: "personality", value: 0, reason: "counter"}]},
    {id: "a+b+c+d+e+g", eligible: true, reasonable: true, hardRejections: [], rationalScore: 1.95, rawStyleScore: .1, appliedStyleScore: .1, finalScore: 2.05, contributions: [{id: "lineup.strength", group: "strength", source: "competence", value: 1.95, reason: "strength"}, {id: "lineup.risk", group: "personality", source: "personality", value: .05, reason: "risk"}, {id: "lineup.counter", group: "matchup", source: "personality", value: .05, reason: "counter"}]},
  ]});
  fs.writeFileSync(path.join(root, "dynasty-state.json"), JSON.stringify({seed: "unified-smoke", completedSeason: 2, decisionRecords: [
    {id: "keeper-1", actor: "manager-01", decision: "keeper", context: {season: 2, keeperWhiteBoxShadow: shadow("keeper:manager-01:2", "a+b", "a")}},
    {id: "keeper-2", actor: "manager-02", decision: "keeper", context: {season: 2, keeperWhiteBoxShadow: shadow("keeper:manager-02:2", "a+b", "a")}},
    {id: "lineup-1", actor: "manager-03", decision: "lineup", context: {season: 2, whiteBoxShadow: lineupShadow()}},
    {id: "lineup-compact", actor: "manager-03", decision: "lineup", context: {season: 2, whiteBoxShadow: {...lineupShadow(), decisionId: "lineup:series-2:manager-03", candidateCount: 3}}},
    {id: "draft-1", actor: "manager-04", decision: "draft", context: {season: 2, whiteBoxShadow: shadow("acquire:supplemental:2:1:manager-04", "a", "b")}},
    {id:"learning-1",stage:"review",actor:"manager-05",decision:"learning",context:{season:2,before:{risk:.5,stars:.5,synergy:.5,counter:.5,value:.5,flexibility:.5},learningWhiteBoxTrace:{version:"white-box-learning-v1",traits:["risk","stars","synergy","counter","value","flexibility"].map(trait=>({trait,beforeTrait:.5,prior:{mean:.5,confidence:0,effectiveSamples:2},appliedDelta:.05,posteriorAfter:{mean:.6,confidence:.1,effectiveSamples:3},rollback:{trait:.5,posterior:{mean:.5,confidence:0,effectiveSamples:2}}}))}}},
  ]}));
  const battleDir = path.join(root, "season-02", "battles", "game-1"); fs.mkdirSync(battleDir, {recursive: true});
  const battleShadow:any = shadow("battle:game-1:3:p1", "move 1", "switch 2"); battleShadow.candidates[1].rationalScore = 3; battleShadow.candidates[1].finalScore = 3.1;
  fs.writeFileSync(path.join(battleDir, "ai-decisions.json"), JSON.stringify([{decisionOrdinal: 1, turn: 3, playerId: "p1", personalityId: "manager-05", battleContext: {ownSpecies: "alpha", opponentSpecies: "beta"}, whiteBoxShadow: {comparison: {incumbent: "move 1", shadow: "switch 2", agrees: false}, trace: battleShadow}}]));
  const replay = createBattleReplayCapsule({schemaVersion: 1, aiVersion: AI_VERSION, format: "gen9customgame", teamA: "team-a", teamB: "team-b", seed: [1,2,3,4], maxTurns: 100, idleTimeoutMs: 5000, wallClockTimeoutMs: 30000, ai: "search", openTeamSheets: true, traceAiDecisions: true, aiProfiles: {p1: {...DEFAULT_TACTICAL_PROFILE,id:"manager-05"},p2: {...DEFAULT_TACTICAL_PROFILE,id:"manager-06"}}, aiOpponentModels: {p1: structuredClone(EMPTY_OPPONENT_MODEL),p2: structuredClone(EMPTY_OPPONENT_MODEL)}, aiOpponentModelPolicy:"cumulative", aiOpponentModelShadows:{"seasonal-decay":{p1:{...structuredClone(EMPTY_OPPONENT_MODEL),confidence:.2},p2:{...structuredClone(EMPTY_OPPONENT_MODEL),confidence:.3}}}});
  fs.writeFileSync(path.join(battleDir, "replay-input.json"), JSON.stringify(replay));
  fs.writeFileSync(path.join(battleDir, "ai-decisions.json.gz"), zlib.gzipSync(fs.readFileSync(path.join(battleDir, "ai-decisions.json"))));
  fs.rmSync(path.join(battleDir, "ai-decisions.json"));
  const plan = buildUnifiedEvidencePlan([root], {maximumCases: 10, maximumPerDomain: 2});
  assert.equal(plan.metrics.scanned, 8);
  assert.equal(plan.metrics.uniqueFingerprints, 6);
  assert.equal(plan.schemaVersion, 3);
  assert.equal(plan.sources[0].battleEvidence, "available");
  assert.equal(plan.sources[0].battleDifferences, 1);
  assert.equal(plan.sources[0].memoryReplicas,2);
  assert.equal(plan.sources[0].memoryPolicies,1);
  assert.equal(plan.sources[0].learningReplicas,1);
  assert.equal(plan.cases.find(entry => entry.domain === "keeper")?.duplicates, 2);
  assert.equal(plan.cases.find(entry => entry.domain === "keeper")?.replicas.length, 2);
  assert.equal(plan.cases.find(entry => entry.domain === "keeper")?.status, "executable");
  assert.equal(plan.sources[0].lineupAssistApproved, 1);
  assert.equal(plan.sources[0].lineupCompleteComparisons, 1);
  assert.equal(plan.sources[0].lineupIncompleteComparisons, 1);
  assert.equal(plan.cases.find(entry => entry.domain === "lineup")?.status, "executable");
  assert.equal(plan.cases.find(entry => entry.domain === "lineup")?.runner, "lineup");
  assert.deepEqual(plan.cases.find(entry => entry.domain === "lineup")?.lineupScenario, {id: "cautious-lineup-assist-v1", band: .5, styleLimit: 3, styleScale: 1.1});
  assert.equal(plan.cases.find(entry => entry.domain === "battle")?.status, "executable");
  assert.equal(plan.cases.find(entry => entry.domain === "battle")?.runner, "battle");
  assert.equal(plan.cases.find(entry => entry.domain === "battle")?.battleTarget?.decisionOrdinal, 1);
  assert.equal(plan.cases.find(entry => entry.domain === "memory")?.status, "executable");
  assert.equal(plan.cases.find(entry => entry.domain === "memory")?.runner, "memory");
  assert.equal(plan.cases.find(entry => entry.domain === "memory")?.duplicates, 2);
  assert.equal(plan.cases.find(entry => entry.domain === "memory")?.replicas[0].sourceSeed, "1-2-3-4");
  assert.equal(plan.cases.find(entry=>entry.domain==="learning")?.status,"executable");
  assert.equal(plan.cases.find(entry=>entry.domain==="learning")?.runner,"learning");
  assert.equal(plan.cases.find(entry=>entry.domain==="learning")?.learningTarget?.managerId,"manager-05");
  assert.equal(plan.cases.find(entry => entry.domain === "acquisition")?.status, "archive-only");
  assert.match(unifiedEvidenceMarkdown(plan), /统一白箱反事实证据清单/);
  const output = path.join(root, "evidence-output");
  for (let pass = 0; pass < 2; pass += 1) {
    const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), path.join(process.cwd(), "src", "cli", "unifiedWhiteBoxEvidence.ts"), "--inputs", root, "--out", output, "--max-cases", "10", "--max-per-domain", "2"], {cwd: process.cwd(), encoding: "utf8"});
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    if (pass === 0) { const legacy = JSON.parse(fs.readFileSync(path.join(output, "evidence-manifest.json"), "utf8")); legacy.schemaVersion = 2; fs.writeFileSync(path.join(output, "evidence-manifest.json"), JSON.stringify(legacy)); }
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(output, "evidence-manifest.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.plan.metrics.scanned, 8);
  assert.deepEqual(manifest.runs, []);
  assert.ok(fs.existsSync(path.join(output, "evidence-plan.md")));
  const second = path.join(root, "second"); fs.mkdirSync(second, {recursive: true});
  const secondState = JSON.parse(fs.readFileSync(path.join(root, "dynasty-state.json"), "utf8")); secondState.seed = "unified-smoke-2";
  const secondKeeper = secondState.decisionRecords[0].context.keeperWhiteBoxShadow;
  secondKeeper.comparison = {incumbent: "c+d", shadow: "c", agrees: false};
  secondKeeper.candidates[0].id = "c+d"; secondKeeper.candidates[1].id = "c";
  fs.writeFileSync(path.join(second, "dynasty-state.json"), JSON.stringify(secondState));
  const crossSeed = buildUnifiedEvidencePlan([root, second]);
  assert.ok(crossSeed.metrics.crossSeedHypotheses >= 3);
  assert.equal(new Set(crossSeed.cases.find(entry => entry.domain === "keeper")!.replicas.map(replica => replica.sourceSeed)).size, 2);
  const sample = (seed: string, points = 1, prefixVerified = true) => ({seed, caseId: seed, prefixVerified, comparison: {managerId: "manager-01", interventionSeason: 1, finalSeason: 2, incumbent: {id: "manager-01", cash: 10, contracts: 1, payroll: 5, titles: 0, totalPoints: 10, finalRank: 5, finalPoints: 10, finalChampion: false}, whitebox: {id: "manager-01", cash: 10, contracts: 1, payroll: 5, titles: 0, totalPoints: 10 + points, finalRank: 4, finalPoints: 10 + points, finalChampion: false}, delta: {cash: 0, contracts: 0, payroll: 0, titles: 0, totalPoints: points, finalRank: -1, finalPoints: points}, champions: {incumbent: [], whitebox: []}}});
  assert.equal(aggregateUnifiedEvidence("h", "keeper", [sample("a"), sample("b")]).stage, "workflow-validation");
  assert.equal(aggregateUnifiedEvidence("h", "keeper", [sample("a"), sample("b"), sample("c")]).stage, "preliminary");
  const formal = Array.from({length: 30}, (_, index) => sample(`seed-${index % 10}`));
  const aggregate = aggregateUnifiedEvidence("h", "keeper", formal);
  assert.equal(aggregate.stage, "formal-review");
  assert.equal(aggregate.conclusion, "candidate-for-activation-review");
  assert.equal(aggregate.activationEligible, true);
  assert.equal(aggregateUnifiedEvidence("h", "keeper", [sample("bad", 1, false)]).conclusion, "blocked");
  const memorySamples=Array.from({length:30},(_,index)=>({seed:`memory-${index%10}`,caseId:`memory-${index}`,playerId:"p1" as const,confidence:.4,candidatePolicy:"seasonal-decay",sourceVerified:true,firstDivergenceOrdinal:2,learned:{winner:"Team A",turns:10,ended:true,timeout:false,stalled:false,errors:[]},ablated:{winner:"Team B",turns:10,ended:true,timeout:false,stalled:false,errors:[]}}));
  const memoryAggregate=aggregateUnifiedMemoryEvidence("memory-h",memorySamples);
  assert.equal(memoryAggregate.stage,"formal-review");
  assert.equal(memoryAggregate.conclusion,"candidate-for-activation-review");
  assert.equal(memoryAggregate.activationEligible,true);
} finally {
  fs.rmSync(root, {recursive: true, force: true});
}
console.log("Unified white-box evidence planning smoke test passed");
