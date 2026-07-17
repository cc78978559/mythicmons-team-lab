import {aggregateBattleCounterfactuals, type BattleCounterfactualAggregate, type BattleOutcomeEvidence} from "./battleAggregation";

export type TacticalMemoryConclusion = "blocked" | "insufficient-evidence" | "supported" | "harmful-review" | "no-observed-outcome-effect" | "no-clear-benefit";

export interface TacticalMemoryAblationSample {
  seed: string;
  caseId: string;
  playerId: "p1" | "p2";
  confidence: number;
  candidatePolicy?: string;
  sourceVerified: boolean;
  firstDivergenceOrdinal: number | null;
  learned: BattleOutcomeEvidence;
  ablated: BattleOutcomeEvidence;
}

export interface TacticalMemoryAblationAggregate {
  schemaVersion: 1;
  conclusion: TacticalMemoryConclusion;
  metrics: BattleCounterfactualAggregate["metrics"] & {decisionDivergences: number; divergenceRate: number; averageConfidence: number;confidenceBands:Array<{band:string;samples:number;decisionDivergences:number;better:number;neutral:number;worse:number;meanScoreDelta:number}>};
  thresholds: BattleCounterfactualAggregate["thresholds"];
  issues: BattleCounterfactualAggregate["issues"];
  samples: TacticalMemoryAblationSample[];
}

export function aggregateTacticalMemoryAblations(samples: readonly TacticalMemoryAblationSample[], options: {minimumSamples?:number;minimumSeeds?:number;minimumDecisivePairs?:number;minimumDecisiveSeeds?:number;maximumOneSidedP?:number} = {}): TacticalMemoryAblationAggregate {
  const battle = aggregateBattleCounterfactuals(samples.map(sample => ({seed:sample.seed,caseId:sample.caseId,playerId:sample.playerId,sourceVerified:sample.sourceVerified,prefixVerified:true,incumbent:sample.ablated,whitebox:sample.learned})), options);
  const enough = battle.metrics.samples >= battle.thresholds.minimumSamples && battle.metrics.seeds >= battle.thresholds.minimumSeeds;
  const directionalEnough = battle.metrics.decisivePairs >= battle.thresholds.minimumDecisivePairs && battle.metrics.decisiveSeeds >= battle.thresholds.minimumDecisiveSeeds;
  const fatal = battle.issues.some(issue => issue.severity === "fatal");
  const conclusion: TacticalMemoryConclusion = fatal ? "blocked"
    : !enough || !directionalEnough ? (enough && battle.metrics.decisivePairs === 0 ? "no-observed-outcome-effect" : "insufficient-evidence")
    : battle.metrics.oneSidedImprovementP <= battle.thresholds.maximumOneSidedP && battle.metrics.better > battle.metrics.worse ? "supported"
    : battle.metrics.oneSidedRegressionP <= battle.thresholds.maximumOneSidedP && battle.metrics.worse > battle.metrics.better ? "harmful-review"
    : "no-clear-benefit";
  const decisionDivergences = samples.filter(sample => sample.firstDivergenceOrdinal !== null).length;
  const averageConfidence = samples.reduce((sum, sample) => sum + sample.confidence, 0) / samples.length;
  const confidenceBands=[["low [0,.15)",0,.15],["mid [.15,.30)",.15,.3],["high [.30,1]",.3,1.0000001]] as const;
  const bandMetrics=confidenceBands.map(([band,minimum,maximum])=>{const selected=samples.filter(sample=>sample.confidence>=minimum&&sample.confidence<maximum),deltas=selected.map(sample=>score(sample.learned,sample.playerId)-score(sample.ablated,sample.playerId));return{band,samples:selected.length,decisionDivergences:selected.filter(sample=>sample.firstDivergenceOrdinal!==null).length,better:deltas.filter(value=>value>0).length,neutral:deltas.filter(value=>value===0).length,worse:deltas.filter(value=>value<0).length,meanScoreDelta:round(deltas.length?deltas.reduce((sum,value)=>sum+value,0)/deltas.length:0)};});
  return {schemaVersion:1,conclusion,metrics:{...battle.metrics,decisionDivergences,divergenceRate:round(decisionDivergences/samples.length),averageConfidence:round(averageConfidence),confidenceBands:bandMetrics},thresholds:battle.thresholds,issues:battle.issues,samples:samples.map(sample=>structuredClone(sample))};
}

export function tacticalMemoryAblationMarkdown(value:TacticalMemoryAblationAggregate):string {
  const m=value.metrics;
  const candidatePolicy=value.samples.find(sample=>sample.candidatePolicy)?.candidatePolicy,label=candidatePolicy??"Learned";
  const method=candidatePolicy?`Only one side's opponent model is replaced with the ${candidatePolicy} shadow in each paired replay.`:"Only one side's opponent model is removed in each paired replay.";
  return ["# Tactical memory ablation","",`- Conclusion: ${value.conclusion}`,`- Samples/seeds: ${m.samples}/${m.seeds}`,`- ${label} better/neutral/worse: ${m.better}/${m.neutral}/${m.worse}`,`- Decision divergences: ${m.decisionDivergences} (${(m.divergenceRate*100).toFixed(1)}%)`,`- Mean candidate score delta: ${signed(m.meanScoreDelta)}`,`- Directional seed clusters: ${m.decisiveSeeds}`,`- Improvement/regression p: ${m.oneSidedImprovementP.toFixed(4)}/${m.oneSidedRegressionP.toFixed(4)}`,"","| Confidence | Samples | Divergences | Better | Neutral | Worse | Mean delta |","|---|---:|---:|---:|---:|---:|---:|",...m.confidenceBands.map(band=>`| ${band.band} | ${band.samples} | ${band.decisionDivergences} | ${band.better} | ${band.neutral} | ${band.worse} | ${signed(band.meanScoreDelta)} |`),"",`${method} Teams, tactical profile, opponent behavior, exact Showdown seed, and all battle rules remain fixed. Turn count is audit context and is not rewarded.`,""].join("\n");
}

function round(value:number):number{return Math.round((value+Number.EPSILON)*1e6)/1e6;}
function signed(value:number):string{return `${value>=0?"+":""}${value.toFixed(3)}`;}
function score(value:BattleOutcomeEvidence,playerId:"p1"|"p2"):number{const own=playerId==="p1"?"Team A":"Team B";return value.winner===own?1:value.winner===null ? .5 : 0;}
