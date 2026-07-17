import type {WhiteBoxBranchComparison} from "./counterfactual";

export interface WhiteBoxCounterfactualSample {seed:string;caseId:string;prefixVerified:boolean;comparison:WhiteBoxBranchComparison}
export interface WhiteBoxCounterfactualBatch {
  schemaVersion:1; samples:WhiteBoxCounterfactualSample[]; promotion:"blocked"|"insufficient-evidence"|"reject-current-rule"|"candidate-for-assist";
  issues:Array<{severity:"fatal"|"warning";code:string;message:string}>;
  metrics:{samples:number;seeds:number;better:number;neutral:number;worse:number;competitiveWinRate:number;meanCashDelta:number;meanPayrollDelta:number;meanPointsDelta:number;meanRankImprovement:number;meanTitlesDelta:number};
}

export function evaluateWhiteBoxCounterfactualBatch(samples:readonly WhiteBoxCounterfactualSample[],minimumSamples=10):WhiteBoxCounterfactualBatch {
  if(!samples.length)throw new Error("Counterfactual batch requires at least one sample");
  if(!Number.isInteger(minimumSamples)||minimumSamples<2)throw new Error("minimumSamples must be at least 2");
  const issues:WhiteBoxCounterfactualBatch["issues"]=[];
  if(samples.some(sample=>!sample.prefixVerified))issues.push({severity:"fatal",code:"prefix-drift",message:"At least one experiment did not reproduce its source prefix"});
  const directions=samples.map(sample=>competitiveDirection(sample.comparison));
  const better=directions.filter(value=>value>0).length,neutral=directions.filter(value=>value===0).length,worse=directions.filter(value=>value<0).length;
  if(samples.length<minimumSamples)issues.push({severity:"warning",code:"insufficient-samples",message:`${samples.length}/${minimumSamples} paired experiments`});
  if(new Set(samples.map(sample=>sample.seed)).size<Math.min(5,minimumSamples))issues.push({severity:"warning",code:"insufficient-seeds",message:"Fewer than five independent seeds"});
  const metrics={samples:samples.length,seeds:new Set(samples.map(sample=>sample.seed)).size,better,neutral,worse,competitiveWinRate:(better+neutral*.5)/samples.length,meanCashDelta:mean(samples.map(sample=>sample.comparison.delta.cash)),meanPayrollDelta:mean(samples.map(sample=>sample.comparison.delta.payroll)),meanPointsDelta:mean(samples.map(sample=>sample.comparison.delta.totalPoints)),meanRankImprovement:mean(samples.map(sample=>-(sample.comparison.delta.finalRank??0))),meanTitlesDelta:mean(samples.map(sample=>sample.comparison.delta.titles))};
  const fatal=issues.some(issue=>issue.severity==="fatal"),enough=samples.length>=minimumSamples&&metrics.seeds>=Math.min(5,minimumSamples);
  const promotion=fatal?"blocked":!enough?"insufficient-evidence":metrics.competitiveWinRate<.45||metrics.meanPointsDelta<0?"reject-current-rule":"candidate-for-assist";
  return {schemaVersion:1,samples:samples.map(sample=>structuredClone(sample)),promotion,issues,metrics};
}

export function whiteBoxCounterfactualBatchMarkdown(batch:WhiteBoxCounterfactualBatch):string {
  const m=batch.metrics;
  return ["# 白箱 AI 跨种子反事实聚合", "", `- 结论：${batch.promotion}`, `- 样本/种子：${m.samples}/${m.seeds}`, `- 竞技更好/持平/更差：${m.better}/${m.neutral}/${m.worse}`, `- 配对竞技胜率：${percent(m.competitiveWinRate)}`, `- 平均积分差：${signed(m.meanPointsDelta)}`, `- 平均排名改善：${signed(m.meanRankImprovement)}`, `- 平均现金差：${signed(m.meanCashDelta)}`, `- 平均工资差：${signed(m.meanPayrollDelta)}`, `- 平均冠军差：${signed(m.meanTitlesDelta)}`, "", "## 样本", "", "| 种子 | 案例 | 积分差 | 排名改善 | 现金差 | 工资差 |", "|---|---|---:|---:|---:|---:|", ...batch.samples.map(sample=>`| ${sample.seed} | ${sample.caseId} | ${signed(sample.comparison.delta.totalPoints)} | ${signed(-(sample.comparison.delta.finalRank??0))} | ${signed(sample.comparison.delta.cash)} | ${signed(sample.comparison.delta.payroll)} |`), "", "## 门禁问题", "", ...(batch.issues.length?batch.issues.map(issue=>`- [${issue.severity.toUpperCase()}] ${issue.code}：${issue.message}`):["未发现问题。"]), "", "只有达到最小配对样本和独立种子要求后，聚合器才会给出采用或拒绝建议；此前结论仅用于继续采样。", ""].join("\n");
}

function competitiveDirection(comparison:WhiteBoxBranchComparison):number{const d=comparison.delta;if(d.titles!==0)return Math.sign(d.titles);if(d.totalPoints!==0)return Math.sign(d.totalPoints);if(d.finalRank!==null&&d.finalRank!==0)return-Math.sign(d.finalRank);return 0;}
function mean(values:number[]):number{return round(values.reduce((sum,value)=>sum+value,0)/values.length);}
function round(value:number):number{return Math.round((value+Number.EPSILON)*1e6)/1e6;}
function signed(value:number):string{return `${value>=0?"+":""}${value.toFixed(2)}`;}
function percent(value:number):string{return`${(value*100).toFixed(1)}%`;}
