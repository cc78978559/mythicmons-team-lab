import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {reviewWhiteBoxDifferences, type WhiteBoxDifferenceCase} from "./review";
import {whiteBoxExperimentEligibility} from "./sampling";
import {scanWhiteBoxOpportunities, type WhiteBoxOpportunityCase, type WhiteBoxOpportunityScenario} from "./opportunity";
import {evaluateBattleAssistGate} from "./battle";
import {loadBattleReplayCapsule} from "../../showdown/battle";
import {AI_VERSION} from "../../showdown/choice";
import {buildBattleAssistScope} from "./battleScope";
import {strategyProgramMutationOperator} from "../../draft/strategyProgram";
import {evaluateWhiteBoxBidApproval, WHITE_BOX_BID_COUNTERFACTUAL_POLICY} from "./bidApproval";
import type {WhiteBoxBidTrace} from "./auction";
import {loadPortfolioBidReplayCapsule} from "./portfolioBidCounterfactual";

export type UnifiedEvidenceStatus = "executable" | "requires-gate" | "archive-only";
export type UnifiedEvidenceRunner = "general" | "lineup" | "battle" | "memory" | "learning" | "program-evolution" | "evolution" | "acquisition" | "bid" | null;
export const UNIFIED_LINEUP_SCENARIO: WhiteBoxOpportunityScenario = {id: "cautious-lineup-assist-v1", band: .5, styleLimit: 3, styleScale: 1.1};

export interface UnifiedBattleTarget {
  sourceGame: string;
  decisionOrdinal: number;
  playerId: "p1" | "p2";
  turn: number;
  expectedIncumbent: string;
  selected: string;
}

export interface UnifiedMemoryTarget {sourceGame: string; playerId: "p1" | "p2"; incumbentPolicy: string; candidatePolicy: string; replaySha256: string}
export interface UnifiedLearningTarget {managerId:string; season:number; policy:"no-learning-experiment"}
export interface UnifiedEvolutionTarget {managerId:string; horizonSeasons:number; kind:"program"|"full-lineage"}
export interface UnifiedAcquisitionTarget {managerId:string;season:number;decisionId:string;candidateId:string}
export interface UnifiedBidTarget {managerId:string;season:number;decisionId:string;policy:typeof WHITE_BOX_BID_COUNTERFACTUAL_POLICY}

export interface UnifiedEvidenceReplica {
  id: string;
  root: string;
  sourceSeed: string;
  sourceSeason: number;
  reviewIndex: number;
  decisionId: string;
  shadow: string;
  actor: string;
  season: number | null;
  status: UnifiedEvidenceStatus;
  runner: UnifiedEvidenceRunner;
  reasons: string[];
  lineupScenario?: WhiteBoxOpportunityScenario;
  battleTarget?: UnifiedBattleTarget;
  battleScopeId?: string;
  memoryTarget?: UnifiedMemoryTarget;
  learningTarget?:UnifiedLearningTarget;
  evolutionTarget?:UnifiedEvolutionTarget;
  acquisitionTarget?:UnifiedAcquisitionTarget;
  bidTarget?:UnifiedBidTarget;
}

export interface UnifiedEvidenceCase {
  id: string;
  root: string;
  sourceSeed: string;
  sourceSeason: number;
  reviewIndex: number;
  decisionId: string;
  domain: string;
  actor: string;
  season: number | null;
  classification: WhiteBoxDifferenceCase["classification"];
  incumbent: string;
  shadow: string;
  impact: number;
  priority: number;
  fingerprint: string;
  duplicates: number;
  duplicateCaseIds: string[];
  replicas: UnifiedEvidenceReplica[];
  status: UnifiedEvidenceStatus;
  runner: UnifiedEvidenceRunner;
  reasons: string[];
  lineupScenario?: WhiteBoxOpportunityScenario;
  battleTarget?: UnifiedBattleTarget;
  battleScopeId?: string;
  memoryTarget?: UnifiedMemoryTarget;
  learningTarget?:UnifiedLearningTarget;
  evolutionTarget?:UnifiedEvolutionTarget;
  acquisitionTarget?:UnifiedAcquisitionTarget;
  bidTarget?:UnifiedBidTarget;
  selected: boolean;
}

export interface UnifiedEvidencePlan {
  schemaVersion: 4;
  createdAt: string;
  config: {maximumCases: number; maximumPerDomain: number; minimumImpact: number; portfolioBidScreens:string[]};
  sources: Array<{root: string; seed: string; completedSeason: number; comparisons: number; agreements: number; differences: number; lineupCompleteComparisons: number; lineupIncompleteComparisons: number; lineupScenarioDifferences: number; lineupAssistApproved: number; battleTraceFiles: number; battleComparisons: number; battleDifferences: number; battleEvidence: "available" | "legacy-without-whitebox" | "not-retained"; memoryReplicas: number; memoryPolicies: number; learningReplicas:number; programEvolutionReplicas:number; fullEvolutionReplicas:number; bidReplicas:number; executableBidReplicas:number}>;
  metrics: {
    scanned: number;
    afterImpactFilter: number;
    uniqueFingerprints: number;
    crossSeedHypotheses: number;
    selected: number;
    executable: number;
    requiresGate: number;
    archiveOnly: number;
    byDomain: Record<string, number>;
    selectedByDomain: Record<string, number>;
  };
  cases: UnifiedEvidenceCase[];
}

export function buildUnifiedEvidencePlan(inputs: readonly string[], options: {maximumCases?: number; maximumPerDomain?: number; minimumImpact?: number; portfolioBidScreens?:readonly string[]} = {}): UnifiedEvidencePlan {
  const maximumCases = integer(options.maximumCases ?? 60, 1, 10000, "maximumCases");
  const maximumPerDomain = integer(options.maximumPerDomain ?? 10, 1, 1000, "maximumPerDomain");
  const minimumImpact = finite(options.minimumImpact ?? 0, 0, 1e9, "minimumImpact");
  const portfolioBidScreens=[...new Set((options.portfolioBidScreens??[]).map(value=>path.resolve(value)))],screenEvidence=loadPortfolioScreenEvidence(portfolioBidScreens);
  if (!inputs.length) throw new Error("Unified evidence planning requires at least one dynasty root");
  const sources: UnifiedEvidencePlan["sources"] = [], raw: UnifiedEvidenceCase[] = [];
  for (const input of [...new Set(inputs.map(value => path.resolve(value)))]) {
    const review = reviewWhiteBoxDifferences(input);
    const state = readJson<any>(path.join(input, "dynasty-state.json"));
    const seed = String(state.seed ?? "unknown"), completedSeason = Number(state.completedSeason ?? 0);
    review.cases.forEach((entry, index) => { if (!entry.decisionId.startsWith("lineup:")) raw.push(toEvidenceCase(input, seed, completedSeason, entry, index + 1)); });
    const opportunity = scanWhiteBoxOpportunities([input], [UNIFIED_LINEUP_SCENARIO], {maximumCasesPerScenario: 10000, domains: ["lineup"]}), lineupScenario = opportunity.scenarios[0];
    const lineupCases = lineupScenario.cases.filter(entry => entry.decisionId.startsWith("lineup:"));
    raw.push(...lineupCases.map(entry => toLineupEvidenceCase(input, seed, completedSeason, entry)));
    const battle = collectBattleCases(input, seed, completedSeason);
    raw.push(...battle.cases);
    const memoryCases=collectMemoryCases(input, completedSeason);raw.push(...memoryCases);
    const learningCases=collectLearningCases(input,seed,completedSeason,state);raw.push(...learningCases);
    const evolutionCases=collectEvolutionCases(input,seed,completedSeason,state);raw.push(...evolutionCases);
    const bidCases=collectBidCases(input,seed,completedSeason,state,screenEvidence);raw.push(...bidCases);
    const battleEvidence = battle.comparisons ? "available" : battle.files ? "legacy-without-whitebox" : "not-retained";
    sources.push({root: input, seed, completedSeason, comparisons: review.comparisons, agreements: review.agreements, differences: review.cases.length, lineupCompleteComparisons: opportunity.completeByDomain.lineup ?? 0, lineupIncompleteComparisons: opportunity.incompleteByDomain.lineup ?? 0, lineupScenarioDifferences: lineupCases.length, lineupAssistApproved: lineupCases.filter(entry => entry.assistGate?.recommended).length, battleTraceFiles: battle.files, battleComparisons: battle.comparisons, battleDifferences: battle.cases.length, battleEvidence, memoryReplicas:memoryCases.length, memoryPolicies:new Set(memoryCases.map(entry=>entry.shadow)).size,learningReplicas:learningCases.length,programEvolutionReplicas:evolutionCases.filter(entry=>entry.domain==="program-evolution").length,fullEvolutionReplicas:evolutionCases.filter(entry=>entry.domain==="evolution").length,bidReplicas:bidCases.length,executableBidReplicas:bidCases.filter(entry=>entry.status==="executable").length});
  }
  const filtered = raw.filter(entry => entry.impact >= minimumImpact);
  const grouped = new Map<string, UnifiedEvidenceCase[]>();
  for (const entry of filtered) grouped.set(entry.fingerprint, [...(grouped.get(entry.fingerprint) ?? []), entry]);
  const unique = [...grouped.values()].map(group => {
    const ranked = [...group].sort(comparePriority), representative = ranked[0];
    return {...representative, id: representative.fingerprint, duplicates: group.length, duplicateCaseIds: ranked.slice(1).map(entry => entry.id), replicas: ranked.map(replicaFor)};
  }).sort(comparePriority);
  const domainCounts = new Map<string, number>();
  let selected = 0;
  for (const entry of unique) {
    const count = domainCounts.get(entry.domain) ?? 0;
    entry.selected = selected < maximumCases && count < maximumPerDomain;
    if (entry.selected) { selected += 1; domainCounts.set(entry.domain, count + 1); }
  }
  return {
    schemaVersion: 4,
    createdAt: new Date().toISOString(),
    config: {maximumCases, maximumPerDomain, minimumImpact,portfolioBidScreens},
    sources,
    metrics: {
      scanned: raw.length,
      afterImpactFilter: filtered.length,
      uniqueFingerprints: unique.length,
      crossSeedHypotheses: unique.filter(entry => new Set(entry.replicas.map(replica => replica.sourceSeed)).size > 1).length,
      selected,
      executable: unique.filter(entry => entry.status === "executable").length,
      requiresGate: unique.filter(entry => entry.status === "requires-gate").length,
      archiveOnly: unique.filter(entry => entry.status === "archive-only").length,
      byDomain: countBy(unique.map(entry => entry.domain)),
      selectedByDomain: countBy(unique.filter(entry => entry.selected).map(entry => entry.domain)),
    },
    cases: unique,
  };
}

function loadPortfolioScreenEvidence(files:readonly string[]):Map<string,any>{const evidence=new Map<string,any>();for(const input of files){const file=fs.existsSync(input)&&fs.statSync(input).isDirectory()?path.join(input,"portfolio-bid-screen.json"):input,value=readJson<any>(file);if(value.schemaVersion!==1||value.sourceVerified!==true||!Number.isInteger(value.season)||!Array.isArray(value.results))throw new Error(`Invalid portfolio bid screen: ${file}`);const root=path.resolve(value.source),capsule=loadPortfolioBidReplayCapsule(root,value.season);if(capsule.sourceHash!==value.sourceHash)throw new Error(`Portfolio bid screen source hash drifted: ${file}`);for(const result of value.results){const key=`${root}|${value.season}|${result.decisionId}`;if(evidence.has(key))throw new Error(`Duplicate portfolio bid screen result: ${result.decisionId}`);evidence.set(key,result);}}return evidence;}

function collectBidCases(root:string,seed:string,sourceSeason:number,state:any,screenEvidence:Map<string,any>):UnifiedEvidenceCase[]{
  const cases:UnifiedEvidenceCase[]=[];
  const auctionMode=String(state.settings?.auctionMode??"sequential");
  for(let season=1;season<=sourceSeason;season+=1){
    const file=path.join(root,`season-${String(season).padStart(2,"0")}`,"decision-ledger.json");
    if(!fs.existsSync(file))continue;
    let records:any[]=[];try{records=readJson<any>(file).records??[];}catch{continue;}
    for(const record of records.filter(entry=>entry.stage==="auction")){
      const bids=Array.isArray(record.context?.bids)?record.context.bids:[];
      const normalized:Array<{entry:any;managerId:string;bid:number;trace:WhiteBoxBidTrace|undefined}>=bids.map((entry:any)=>({entry,managerId:String(entry.manager??entry.managerId??""),bid:Number(entry.bid)||0,trace:entry.whiteBox as WhiteBoxBidTrace|undefined}));
      const winner=[...normalized].filter(entry=>entry.managerId&&entry.bid>0).sort((left,right)=>right.bid-left.bid)[0]??null;
      for(const item of normalized){
        const trace=item.trace;if(!item.managerId||trace?.version!=="white-box-bid-v1"||trace.ceiling<=trace.bid||trace.shade<=0)continue;
        const highestCompetingBid=Math.max(0,...normalized.filter(entry=>entry.managerId!==item.managerId).map(entry=>entry.bid));
        const approval=evaluateWhiteBoxBidApproval({auctionMode,bidderId:item.managerId,incumbentWinnerId:winner?.managerId??null,highestCompetingBid,trace});
        const screened=screenEvidence.get(`${path.resolve(root)}|${season}|${trace.decisionId}`),status:UnifiedEvidenceStatus=auctionMode!=="sequential"?(screened?.status==="executable"?"executable":"requires-gate"):approval.recommended?"executable":"archive-only";
        const runner:UnifiedEvidenceRunner=status==="executable"?"bid":null;
        const reasons=auctionMode!=="sequential"?(screened?.status==="executable"?[]:["portfolio-solver-screen-required"]):[...approval.reasons];
        const impact=round(trace.ceiling-trace.bid+(screened?.changes?.length??0)),id=digest([root,trace.decisionId,WHITE_BOX_BID_COUNTERFACTUAL_POLICY].join("|")),screenShape=screened?.changes?.map((change:any)=>change.before?.managerId===change.after?.managerId?"payment":"assignment").sort().join(",")??"",fingerprint=digest(["auction",WHITE_BOX_BID_COUNTERFACTUAL_POLICY,status,reasons.slice().sort().join(","),screenShape].join("|"));
        const bidTarget:UnifiedBidTarget={managerId:item.managerId,season,decisionId:trace.decisionId,policy:WHITE_BOX_BID_COUNTERFACTUAL_POLICY};
        cases.push({id,root,sourceSeed:seed,sourceSeason,reviewIndex:0,decisionId:trace.decisionId,domain:"auction",actor:item.managerId,season,classification:"reasonable-style-choice",incumbent:String(trace.bid),shadow:String(trace.ceiling),impact,priority:round((status==="executable"?150:status==="requires-gate"?20:0)+impact+season*.01),fingerprint,duplicates:1,duplicateCaseIds:[],replicas:[],status,runner,reasons,bidTarget,selected:false});
      }
    }
  }
  return cases;
}

function collectLearningCases(root:string,seed:string,sourceSeason:number,state:any):UnifiedEvidenceCase[]{const cases:UnifiedEvidenceCase[]=[];for(const record of state.decisionRecords??[]){const trace=record.context?.learningWhiteBoxTrace,season=Number(record.context?.season),actor=String(record.actor??"");if(trace?.version!=="white-box-learning-v1"||!Number.isInteger(season)||season<1||!actor||!Array.isArray(trace.traits)||trace.traits.length!==6)continue;let valid=true,impact=0;const changed:string[]=[];for(const trait of trace.traits){if(trait.rollback?.trait!==trait.beforeTrait||JSON.stringify(trait.rollback?.posterior)!==JSON.stringify(trait.prior)){valid=false;break;}const delta=Math.abs(Number(trait.appliedDelta)||0);impact+=delta+Math.abs(Number(trait.posteriorAfter?.mean)-Number(trait.prior?.mean))*.25;if(delta>1e-12)changed.push(String(trait.trait));}if(!changed.length)continue;const status:UnifiedEvidenceStatus=valid?"executable":"archive-only",runner:UnifiedEvidenceRunner=valid?"learning":null,reasons=valid?[]:["learning-rollback-drift"],id=digest([root,actor,season,"no-learning"].join("|")),fingerprint=digest(["learning","no-learning-experiment",changed.sort().join(",")].join("|")),learningTarget:UnifiedLearningTarget={managerId:actor,season,policy:"no-learning-experiment"};cases.push({id,root,sourceSeed:seed,sourceSeason,reviewIndex:0,decisionId:`learning:${actor}:${season}`,domain:"learning",actor,season,classification:"reasonable-style-choice",incumbent:"season-learning-v1",shadow:"no-learning",impact:round(impact),priority:round((valid?140:0)+impact+season*.01),fingerprint,duplicates:1,duplicateCaseIds:[],replicas:[],status,runner,reasons,learningTarget,selected:false});}return cases;}

function collectEvolutionCases(root:string,seed:string,sourceSeason:number,state:any):UnifiedEvidenceCase[]{const cases:UnifiedEvidenceCase[]=[];const packageFile=path.join(root,`season-${String(sourceSeason).padStart(2,"0")}`,"evolution-shadow-candidates.json");if(fs.existsSync(packageFile)){let value:any;try{value=readJson<any>(packageFile);}catch{value=null;}if(value?.schemaVersion===1&&value.season===sourceSeason&&value.seed===seed&&(!state.fingerprint?.registryHash||value.registryHash===state.fingerprint.registryHash)){let operator:string|null=null;try{operator=strategyProgramMutationOperator(value.strategyProgramOperator??state.settings?.strategyProgramOperator);}catch{operator=null;}for(const candidate of value.candidates??[]){const manager=(state.managers??[]).find((entry:any)=>entry.id===candidate.managerId),valid=Boolean(operator&&manager&&candidate.replacedLineageId===manager.lineage?.lineageId&&candidate.profile?.id===manager.id&&candidate.lineage?.birthSeason===sourceSeason+1&&Number(candidate.programBehaviorDistance)>0&&Number(candidate.programOpportunity?.choicePotential)>0);const status:UnifiedEvidenceStatus=valid?"executable":"archive-only",runner:UnifiedEvidenceRunner=valid?"program-evolution":null,reasons=valid?[]:["invalid-program-evolution-candidate"],impact=round(Math.max(0,Number(candidate.programBehaviorDistance)||0)+Math.max(0,Number(candidate.programOpportunity?.choicePotential)||0)),id=digest([root,sourceSeason,candidate.managerId,"program-evolution"].join("|")),fingerprint=digest(["program-evolution",operator??"invalid"].join("|")),evolutionTarget:UnifiedEvolutionTarget={managerId:String(candidate.managerId),horizonSeasons:2,kind:"program"};cases.push({id,root,sourceSeed:seed,sourceSeason,reviewIndex:0,decisionId:`program-evolution:${sourceSeason}:${candidate.managerId}`,domain:"program-evolution",actor:String(candidate.managerId),season:sourceSeason+1,classification:"reasonable-style-choice",incumbent:"parent-program",shadow:`${operator??"unknown"}-candidate`,impact,priority:round((valid?145:0)+impact+sourceSeason*.01),fingerprint,duplicates:1,duplicateCaseIds:[],replicas:[],status,runner,reasons,evolutionTarget,selected:false});}}}for(const manager of state.managers??[]){if(!manager.pendingLineage||!manager.pendingProfile||manager.pendingLineage.birthSeason!==sourceSeason+1)continue;const valid=(state.settings?.evolutionMode??"punctuated")==="punctuated",status:UnifiedEvidenceStatus=valid?"executable":"archive-only",runner:UnifiedEvidenceRunner=valid?"evolution":null,reasons=valid?[]:["source-is-not-punctuated"],impact=round((manager.pendingLineage.mutations?.length??0)*.1),id=digest([root,sourceSeason,manager.id,"full-evolution"].join("|")),fingerprint=digest(["evolution","full-lineage",(manager.pendingLineage.mutations??[]).map((entry:string)=>entry.split("=")[0]).sort().join(",")].join("|")),evolutionTarget:UnifiedEvolutionTarget={managerId:String(manager.id),horizonSeasons:1,kind:"full-lineage"};cases.push({id,root,sourceSeed:seed,sourceSeason,reviewIndex:0,decisionId:`evolution:${sourceSeason+1}:${manager.id}`,domain:"evolution",actor:String(manager.id),season:sourceSeason+1,classification:"reasonable-style-choice",incumbent:String(manager.lineage?.lineageId??"parent"),shadow:String(manager.pendingLineage.lineageId),impact,priority:round((valid?145:0)+impact+sourceSeason*.01),fingerprint,duplicates:1,duplicateCaseIds:[],replicas:[],status,runner,reasons,evolutionTarget,selected:false});}return cases;}

function collectMemoryCases(root: string, sourceSeason: number): UnifiedEvidenceCase[] {
  const cases: UnifiedEvidenceCase[] = [];
  for (const replayFile of findEvidenceFiles(root, "replay-input.json")) {
    const sourceGame = path.dirname(replayFile);
    if (!findEvidenceFiles(sourceGame, "ai-decisions.json").length) continue;
    let capsule;
    try { capsule = loadBattleReplayCapsule(replayFile); } catch { continue; }
    if (capsule.input.aiVersion !== AI_VERSION || capsule.input.ai !== "search" || !capsule.input.traceAiDecisions || capsule.input.battleAssistScopes?.length) continue;
    const shadows = capsule.input.aiOpponentModelShadows ?? {}, relative = path.relative(root, replayFile).replaceAll("\\", "/"), season = seasonFromPath(relative);
    for (const [candidatePolicy, models] of Object.entries(shadows).sort(([a],[b])=>a.localeCompare(b))) for (const playerId of ["p1", "p2"] as const) {
      const incumbentModel = capsule.input.aiOpponentModels[playerId], candidateModel = models[playerId];
      if (!candidateModel || JSON.stringify(candidateModel) === JSON.stringify(incumbentModel)) continue;
      const sourceSeed = capsule.input.seed.join("-"), incumbentPolicy = capsule.input.aiOpponentModelPolicy ?? "incumbent";
      const impact = modelDistance(incumbentModel, candidateModel), id = digest([capsule.sha256, playerId, candidatePolicy].join("|"));
      const fingerprint = digest(["memory", incumbentPolicy, candidatePolicy].join("|"));
      const memoryTarget: UnifiedMemoryTarget = {sourceGame, playerId, incumbentPolicy, candidatePolicy, replaySha256: capsule.sha256};
      cases.push({id, root, sourceSeed, sourceSeason, reviewIndex: 0, decisionId: `memory:${candidatePolicy}:${playerId}:${capsule.sha256.slice(0,12)}`, domain: "memory", actor: capsule.input.aiProfiles[playerId].id, season, classification: "reasonable-style-choice", incumbent: incumbentPolicy, shadow: candidatePolicy, impact, priority: round(140 + impact + Math.max(0, season ?? 0) * .01), fingerprint, duplicates: 1, duplicateCaseIds: [], replicas: [], status: "executable", runner: "memory", reasons: [], memoryTarget, selected: false});
    }
  }
  return cases;
}

function collectBattleCases(root: string, seed: string, sourceSeason: number): {files: number; comparisons: number; cases: UnifiedEvidenceCase[]} {
  const files = findEvidenceFiles(root, "ai-decisions.json"), cases: UnifiedEvidenceCase[] = [];
  let comparisons = 0;
  for (const file of files) {
    const gameDir = path.dirname(file), replayFile = path.join(gameDir, "replay-input.json");
    let replayReason: string | null = null;
    if (!fs.existsSync(replayFile)) replayReason = "missing-battle-replay-capsule";
    else try { const replay = loadBattleReplayCapsule(replayFile); if (replay.input.aiVersion !== AI_VERSION) replayReason = "battle-ai-version-drift"; else if(replay.input.battleAssistScopes?.length)replayReason="battle-source-is-not-shadow"; } catch { replayReason = "invalid-battle-replay-capsule"; }
    const traces = readJson<any[]>(file);
    for (const trace of traces) {
      const shadow = trace?.whiteBoxShadow, comparison = shadow?.comparison, decision = shadow?.trace;
      if (!comparison || !decision || !Array.isArray(decision.candidates)) continue;
      comparisons += 1;
      if (comparison.agrees || !comparison.shadow) continue;
      const incumbent = decision.candidates.find((candidate: any) => candidate.id === comparison.incumbent) ?? null;
      const candidate = decision.candidates.find((value: any) => value.id === comparison.shadow) ?? null;
      const classification: WhiteBoxDifferenceCase["classification"] = !incumbent || !candidate ? "missing-candidate" : !incumbent.eligible ? "illegal-incumbent" : incumbent.reasonable ? "reasonable-style-choice" : "rational-correction";
      const rationalDelta = numericDelta(incumbent?.rationalScore, candidate?.rationalScore), finalDelta = numericDelta(incumbent?.finalScore, candidate?.finalScore);
      const impact = round(Math.abs(rationalDelta ?? 0) + Math.abs(finalDelta ?? 0) * .5);
      const classWeight = classification === "illegal-incumbent" ? 400 : classification === "rational-correction" ? 200 : classification === "reasonable-style-choice" ? 100 : 0;
      const relative = path.relative(root, file).replaceAll("\\", "/"), season = seasonFromPath(relative);
      const gate = evaluateBattleAssistGate(incumbent ?? undefined, candidate ?? undefined);
      const hasTarget = Number.isInteger(trace.decisionOrdinal) && trace.decisionOrdinal > 0 && (trace.playerId === "p1" || trace.playerId === "p2") && Number.isInteger(trace.turn);
      let status: UnifiedEvidenceStatus, runner: UnifiedEvidenceRunner, reasons: string[];
      if (classification === "missing-candidate") { status = "archive-only"; runner = null; reasons = ["incomplete-candidate-evidence"]; }
      else if (replayReason) { status = "archive-only"; runner = null; reasons = [replayReason]; }
      else if (!hasTarget) { status = "archive-only"; runner = null; reasons = ["missing-stable-battle-target"]; }
      else if (!gate.recommended) { status = "requires-gate"; runner = null; reasons = [...gate.hardRejections]; }
      else { status = "executable"; runner = "battle"; reasons = []; }
      const battleTarget: UnifiedBattleTarget | undefined = hasTarget ? {sourceGame: gameDir, decisionOrdinal: trace.decisionOrdinal, playerId: trace.playerId, turn: trace.turn, expectedIncumbent: String(comparison.incumbent), selected: String(comparison.shadow)} : undefined;
      const scope=buildBattleAssistScope({ownSpecies:trace.battleContext?.ownSpecies,opponentSpecies:trace.battleContext?.opponentSpecies,incumbent:String(comparison.incumbent),selected:String(comparison.shadow),incumbentTarget:trace.actionTargets?.[comparison.incumbent],selectedTarget:trace.actionTargets?.[comparison.shadow],incumbentCandidate:incumbent??undefined});
      const fingerprint = digest(["battle", status, scope.id, incumbent?.contributions?.slice(0, 4).map((value: any) => value.id).join(",") ?? ""].join("|"));
      const id = digest([root, relative, trace.turn, trace.playerId, comparison.incumbent, comparison.shadow].join("|"));
      cases.push({id, root, sourceSeed: seed, sourceSeason, reviewIndex: 0, decisionId: String(decision.decisionId ?? `battle:${relative}:${trace.turn}:${trace.playerId}`), domain: "battle", actor: String(trace.personalityId ?? trace.playerId ?? "unknown"), season, classification, incumbent: String(comparison.incumbent), shadow: String(comparison.shadow), impact, priority: round(classWeight + (status === "executable" ? 40 : status === "requires-gate" ? 15 : 0) + impact + Math.max(0, season ?? 0) * .01), fingerprint, duplicates: 1, duplicateCaseIds: [], replicas: [], status, runner, reasons, battleScopeId:scope.id, ...(battleTarget ? {battleTarget} : {}), selected: false});
    }
  }
  return {files: files.length, comparisons, cases};
}

function toLineupEvidenceCase(root: string, seed: string, sourceSeason: number, entry: WhiteBoxOpportunityCase): UnifiedEvidenceCase {
  const gate = entry.assistGate;
  let status: UnifiedEvidenceStatus = gate?.recommended ? "executable" : "requires-gate", runner: UnifiedEvidenceRunner = "lineup", reasons = gate?.hardRejections.length ? [...gate.hardRejections] : gate ? [] : ["missing-lineup-assist-gate"];
  if (entry.season === null) { status = "archive-only"; runner = null; reasons = ["missing-intervention-season"]; }
  const classification: WhiteBoxDifferenceCase["classification"] = entry.rationalDelta > 0 ? "rational-correction" : "reasonable-style-choice";
  const impact = round(Math.abs(entry.rationalDelta) + Math.abs(entry.styleDelta) * .5), classWeight = classification === "rational-correction" ? 200 : 100, statusWeight = status === "executable" ? 40 : status === "requires-gate" ? 15 : 0;
  const signals = gate?.supportingSignals.join(",") ?? "";
  const fingerprint = digest(["lineup", UNIFIED_LINEUP_SCENARIO.id, classification, status, reasons.join(","), choiceShape(entry.incumbent), choiceShape(entry.selected), signals].join("|"));
  const id = digest([root, entry.decisionId, entry.actor, entry.incumbent, entry.selected].join("|"));
  return {id, root, sourceSeed: seed, sourceSeason, reviewIndex: 0, decisionId: entry.decisionId, domain: "lineup", actor: entry.actor, season: entry.season, classification, incumbent: entry.incumbent, shadow: entry.selected, impact, priority: round(classWeight + statusWeight + impact + Math.max(0, entry.season ?? 0) * .01), fingerprint, duplicates: 1, duplicateCaseIds: [], replicas: [], status, runner, reasons, lineupScenario: {...UNIFIED_LINEUP_SCENARIO}, selected: false};
}

export function unifiedEvidenceMarkdown(plan: UnifiedEvidencePlan): string {
  const m = plan.metrics;
  const lines = ["# 统一白箱反事实证据清单", "", `- 来源：${plan.sources.length}`, `- 扫描差异：${m.scanned}`, `- 去重后：${m.uniqueFingerprints}`, `- 跨种子假设：${m.crossSeedHypotheses}`, `- 入选：${m.selected}`, `- 可执行/需门禁/仅归档：${m.executable}/${m.requiresGate}/${m.archiveOnly}`, "", "| 优先级 | 领域 | 状态 | 赛季 | 经理 | 旧方案 | 白箱方案 | 副本/种子 |", "|---:|---|---|---:|---|---|---|---:|"];
  for (const entry of plan.cases.filter(entry => entry.selected)) lines.push(`| ${entry.priority.toFixed(2)} | ${entry.domain} | ${entry.status} | ${entry.season ?? "-"} | ${entry.actor} | ${entry.incumbent} | ${entry.shadow} | ${entry.replicas.length}/${new Set(entry.replicas.map(replica => replica.sourceSeed)).size} |`);
  lines.push("", "`executable` 只表示已有隔离重放器和必要门禁；不会自动改变正式联赛。运行实验仍需显式 `--run`。", "");
  return lines.join("\n");
}

function toEvidenceCase(root: string, seed: string, sourceSeason: number, entry: WhiteBoxDifferenceCase, reviewIndex: number): UnifiedEvidenceCase {
  const domain = detailedDomain(entry.decisionId);
  const eligibility = whiteBoxExperimentEligibility(entry);
  let status: UnifiedEvidenceStatus = eligibility.eligible ? "executable" : "archive-only";
  let runner: UnifiedEvidenceRunner = eligibility.eligible ? "general" : null;
  let reasons = [...eligibility.reasons];
  if (domain === "lineup") { status = "requires-gate"; runner = "lineup"; reasons = ["lineup-requires-scenario-and-assist-gate"]; }
  else if(domain==="acquisition") {const target=acquisitionReplayTarget(root,entry);if(!eligibility.eligible){status="requires-gate";runner=null;}else if(!target){status="archive-only";runner=null;reasons=["missing-acquisition-replay-group"];}else{status="executable";runner="acquisition";reasons=[];}}
  else if (entry.classification === "missing-candidate") { status = "archive-only"; runner = null; reasons = ["incomplete-candidate-evidence"]; }
  const impact = round(Math.abs(entry.counterfactual.rationalDelta ?? 0) + Math.abs(entry.counterfactual.finalDelta ?? 0) * .5 + Math.min(5, entry.counterfactual.contributionDeltas.reduce((sum, value) => sum + Math.abs(value.delta), 0) * .2));
  const classWeight = entry.classification === "illegal-incumbent" ? 400 : entry.classification === "rational-correction" ? 200 : entry.classification === "reasonable-style-choice" ? 100 : 0;
  const statusWeight = status === "executable" ? 40 : status === "requires-gate" ? 15 : 0;
  const priority = round(classWeight + statusWeight + impact + Math.max(0, entry.season ?? 0) * .01);
  const fingerprint = digest([domain, entry.classification, status, reasons.join(","), choiceShape(entry.incumbent), choiceShape(entry.shadow), `added:${entry.counterfactual.added.length}`, `removed:${entry.counterfactual.removed.length}`, entry.counterfactual.contributionDeltas.slice(0, 4).map(value => value.id).join(",")].join("|"));
  const id = digest([root, entry.decisionId, entry.actor, entry.incumbent, entry.shadow, entry.source].join("|"));
  const acquisitionTarget=domain==="acquisition"?acquisitionReplayTarget(root,entry):null;
  return {id, root, sourceSeed: seed, sourceSeason, reviewIndex, decisionId: entry.decisionId, domain, actor: entry.actor, season: entry.season, classification: entry.classification, incumbent: entry.incumbent, shadow: entry.shadow, impact, priority, fingerprint, duplicates: 1, duplicateCaseIds: [], replicas: [], status, runner, reasons,...(acquisitionTarget?{acquisitionTarget}:{}), selected: false};
}

function acquisitionReplayTarget(root:string,entry:WhiteBoxDifferenceCase):UnifiedAcquisitionTarget|null{if(entry.season===null)return null;const file=path.join(root,`season-${String(entry.season).padStart(2,"0")}`,"program-opportunities.json");if(!fs.existsSync(file))return null;let snapshot:any;try{snapshot=readJson<any>(file);}catch{return null;}const manager=(snapshot.managers??[]).find((value:any)=>value.managerId===entry.actor),matches=(manager?.decisions??[]).filter((value:any)=>value.id===entry.decisionId&&value.entrypoint==="acquire"&&value.selectedIds?.length===1&&value.selectedIds[0]===entry.incumbent&&value.candidates?.some((candidate:any)=>candidate.id===entry.shadow));return matches.length===1?{managerId:entry.actor,season:entry.season,decisionId:entry.decisionId,candidateId:entry.shadow}:null;}

function replicaFor(entry: UnifiedEvidenceCase): UnifiedEvidenceReplica { return {id: entry.id, root: entry.root, sourceSeed: entry.sourceSeed, sourceSeason: entry.sourceSeason, reviewIndex: entry.reviewIndex, decisionId: entry.decisionId, shadow: entry.shadow, actor: entry.actor, season: entry.season, status: entry.status, runner: entry.runner, reasons: [...entry.reasons], ...(entry.lineupScenario ? {lineupScenario: {...entry.lineupScenario}} : {}), ...(entry.battleTarget ? {battleTarget: {...entry.battleTarget}} : {}), ...(entry.battleScopeId?{battleScopeId:entry.battleScopeId}:{}), ...(entry.memoryTarget?{memoryTarget:{...entry.memoryTarget}}:{}),...(entry.learningTarget?{learningTarget:{...entry.learningTarget}}:{}),...(entry.evolutionTarget?{evolutionTarget:{...entry.evolutionTarget}}:{}),...(entry.acquisitionTarget?{acquisitionTarget:{...entry.acquisitionTarget}}:{}),...(entry.bidTarget?{bidTarget:{...entry.bidTarget}}:{})}; }

function detailedDomain(decisionId: string): string {
  if (decisionId.startsWith("lineup:")) return "lineup";
  if (decisionId.startsWith("keeper:")) return "keeper";
  if (decisionId.startsWith("bid:")) return "auction";
  if (decisionId.startsWith("acquire:")) return "acquisition";
  if (decisionId.startsWith("market:trade:")) return "trade";
  if (decisionId.startsWith("market:background-")) return "background-market";
  if (decisionId.startsWith("market:waiver-")) return "waiver";
  if (decisionId.startsWith("market:free-agent-")) return "free-agent";
  return decisionId.split(":", 1)[0] || "unknown";
}

function comparePriority(left: UnifiedEvidenceCase, right: UnifiedEvidenceCase): number { return right.priority - left.priority || right.impact - left.impact || left.id.localeCompare(right.id); }
function countBy(values: string[]): Record<string, number> { const result: Record<string, number> = {}; for (const value of values) result[value] = (result[value] ?? 0) + 1; return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b))); }
function digest(value: string): string { return crypto.createHash("sha256").update(value).digest("hex").slice(0, 20); }
function choiceShape(value: string): string { if (value === "none" || value === "release-all" || value === "hold" || value === "replace") return value; if (/^move\s/i.test(value)) return value.includes("terastallize") ? "move:tera" : "move"; if (/^switch\s/i.test(value)) return "switch"; const members = value.split("+").filter(Boolean); return `members:${members.length}`; }
function findEvidenceFiles(directory: string, name: string): string[] { const files: string[] = []; if (!fs.existsSync(directory)) return files; const entries = fs.readdirSync(directory, {withFileTypes: true}); const names = new Set(entries.filter(entry => entry.isFile()).map(entry => entry.name)); if (names.has(name)) files.push(path.join(directory, name)); else if (names.has(`${name}.gz`)) files.push(path.join(directory, `${name}.gz`)); for (const entry of entries) if (entry.isDirectory()) files.push(...findEvidenceFiles(path.join(directory, entry.name), name)); return files; }
function seasonFromPath(value: string): number | null { const match = value.match(/(?:^|\/)season-(\d+)(?:\/|$)/); return match ? Number(match[1]) : null; }
function numericDelta(before: unknown, after: unknown): number | null { return typeof before === "number" && Number.isFinite(before) && typeof after === "number" && Number.isFinite(after) ? round(after - before) : null; }
function modelDistance(left: unknown, right: unknown): number { const a=JSON.stringify(left),b=JSON.stringify(right);let changed=Math.abs(a.length-b.length);for(let index=0;index<Math.min(a.length,b.length);index+=1)if(a[index]!==b[index])changed+=1;return round(Math.min(100,changed/10)); }
function readJson<T>(file: string): T { if (!fs.existsSync(file)) throw new Error(`Missing evidence input: ${file}`); const input = fs.readFileSync(file); const text = file.endsWith(".gz") ? zlib.gunzipSync(input).toString("utf8") : input.toString("utf8"); return JSON.parse(text) as T; }
function integer(value: number, min: number, max: number, name: string): number { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function finite(value: number, min: number, max: number, name: string): number { if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be ${min}..${max}`); return value; }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
