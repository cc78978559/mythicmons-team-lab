import fs from "node:fs";
import path from "node:path";
import type {WhiteBoxCandidateTrace, WhiteBoxShadowSummary} from "./decision";
import {whiteBoxExperimentEligibility} from "./sampling";

export interface WhiteBoxDifferenceCase {
  id: string; decisionId: string; domain: string; actor: string; season: number | null; decision: string; source: string; incumbent: string; shadow: string;
  classification: "reasonable-style-choice" | "rational-correction" | "illegal-incumbent" | "missing-candidate";
  incumbentCandidate: WhiteBoxCandidateTrace | null; shadowCandidate: WhiteBoxCandidateTrace | null;
  counterfactual: {rationalDelta: number | null; styleDelta: number | null; finalDelta: number | null; added: string[]; removed: string[]; contributionDeltas: Array<{id: string; source: string; delta: number}>};
  experimentGate: {version:string;recommended:boolean;hardRejections:string[]}|null;
}

export interface WhiteBoxDifferenceReview {
  schemaVersion: 1; root: string; records: number; comparisons: number; agreements: number; cases: WhiteBoxDifferenceCase[];
  metrics: {byDomain: Record<string, number>; byClassification: Record<string, number>; experimentEligible:number; experimentIneligible:number};
}

export function reviewWhiteBoxDifferences(rootDirectory: string): WhiteBoxDifferenceReview {
  const root = path.resolve(rootDirectory), state = read<any>(path.join(root, "dynasty-state.json"));
  const sources:Array<{source:string;records:any[]}>= [{source:"dynasty-state.json",records:state.decisionRecords??[]}];
  for(const entry of fs.readdirSync(root,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&/^season-\d+$/.test(entry.name)).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(root,entry.name,"decision-ledger.json");if(fs.existsSync(file))sources.push({source:`${entry.name}/decision-ledger.json`,records:read<any>(file).records??[]});}
  const cases: WhiteBoxDifferenceCase[] = [];
  let comparisons = 0, agreements = 0;
  for(const source of sources)source.records.forEach((record, index) => walk(record.context, value => {
    if (!isShadow(value)) return;
    comparisons += 1;
    if (value.comparison.agrees) {agreements += 1; return;}
    const incumbent = value.candidates.find(entry => entry.id === value.comparison.incumbent) ?? null;
    const shadow = value.candidates.find(entry => entry.id === value.comparison.shadow) ?? null;
    cases.push(buildCase(record, index, source.source, value, incumbent, shadow));
  }));
  const experimentEligible=cases.filter(entry=>whiteBoxExperimentEligibility(entry).eligible).length;
  return {schemaVersion: 1, root, records: sources.reduce((sum,source)=>sum+source.records.length,0), comparisons, agreements, cases, metrics: {byDomain: count(cases.map(entry => entry.domain)), byClassification: count(cases.map(entry => entry.classification)), experimentEligible, experimentIneligible:cases.length-experimentEligible}};
}

export function whiteBoxDifferenceMarkdown(review: WhiteBoxDifferenceReview): string {
  const lines = ["# 白箱 AI 差异案例审查", "", `- 记录：${review.records}`, `- 一致：${review.agreements}/${review.comparisons}`, `- 差异案例：${review.cases.length}`, `- 可实验/仅归档：${review.metrics.experimentEligible}/${review.metrics.experimentIneligible}`, "", "## 分类", "", ...Object.entries(review.metrics.byClassification).sort().map(([key, value]) => `- ${key}: ${value}`), ""];
  for (const entry of review.cases) {
    const cf = entry.counterfactual;
    lines.push(`## ${entry.id}`, "", `- 领域/经理：${entry.domain} / ${entry.actor}`, `- 决策：${entry.decision}`, `- 分类：${entry.classification}`, `- 旧方案：${entry.incumbent}`, `- 白箱方案：${entry.shadow}`, `- 实验资格：${entry.experimentGate ? entry.experimentGate.recommended ? "recommended" : `blocked（${entry.experimentGate.hardRejections.join("；")}）` : "未设置专用门禁"}`, `- 分数变化（理性/人格/最终）：${number(cf.rationalDelta)} / ${number(cf.styleDelta)} / ${number(cf.finalDelta)}`, `- 增加：${cf.added.join("、") || "无"}`, `- 移除：${cf.removed.join("、") || "无"}`, "", "| 参数 | 来源 | 白箱-旧方案 |", "|---|---|---:|", ...cf.contributionDeltas.map(delta => `| ${delta.id} | ${delta.source} | ${signed(delta.delta)} |`), "");
  }
  if (!review.cases.length) lines.push("未发现差异。", "");
  return lines.join("\n");
}

function buildCase(record:any,index:number,source:string,trace:WhiteBoxShadowSummary,incumbent:WhiteBoxCandidateTrace|null,shadow:WhiteBoxCandidateTrace|null):WhiteBoxDifferenceCase {
  const incumbentId=trace.comparison.incumbent, shadowId=trace.comparison.shadow??"none";
  const classification=!incumbent||!shadow?"missing-candidate":!incumbent.eligible?"illegal-incumbent":incumbent.reasonable?"reasonable-style-choice":"rational-correction";
  const ids=new Set([...(incumbent?.contributions??[]),...(shadow?.contributions??[])].map(entry=>entry.id));
  const contributionDeltas=[...ids].map(id=>{const before=incumbent?.contributions.find(entry=>entry.id===id),after=shadow?.contributions.find(entry=>entry.id===id);return{id,source:after?.source??before?.source??"unknown",delta:round((after?.value??0)-(before?.value??0))};}).filter(entry=>entry.delta!==0).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)||a.id.localeCompare(b.id));
  const before=members(incumbentId),after=members(shadowId);
  const gate=record.context?.whiteBoxTradeAssist;
  const experimentGate=gate?.version==="white-box-trade-assist-v1"?{version:String(gate.version),recommended:Boolean(gate.recommended),hardRejections:Array.isArray(gate.hardRejections)?gate.hardRejections.map(String):[]}:null;
  return {id:`${source}#${index+1}:${record.id??`record-${index+1}`}:${trace.decisionId}`,decisionId:trace.decisionId,domain:domain(trace.decisionId),actor:String(record.actor??"unknown"),season:traceSeason(record,trace),decision:String(record.decision??"unknown"),source:`${source}#${index+1}`,incumbent:incumbentId,shadow:shadowId,classification,incumbentCandidate:incumbent,shadowCandidate:shadow,experimentGate,counterfactual:{rationalDelta:delta(incumbent?.rationalScore,shadow?.rationalScore),styleDelta:delta(incumbent?.appliedStyleScore,shadow?.appliedStyleScore),finalDelta:delta(incumbent?.finalScore,shadow?.finalScore),added:[...after].filter(id=>!before.has(id)).sort(),removed:[...before].filter(id=>!after.has(id)).sort(),contributionDeltas}};
}

function isShadow(value:any):value is WhiteBoxShadowSummary{return Boolean(value?.version==="white-box-decision-v1"&&value.comparison&&Array.isArray(value.candidates));}
function walk(value:any,visit:(value:any)=>void):void{if(!value||typeof value!=="object")return;visit(value);if(isShadow(value))return;for(const child of Array.isArray(value)?value:Object.values(value))walk(child,visit);}
function domain(id:string):string{return id.split(":",1)[0]||"unknown";}
function traceSeason(record:any,trace:WhiteBoxShadowSummary):number|null{if(Number.isInteger(record.context?.season))return record.context.season;const match=trace.decisionId.match(/(?:^|:)(\d+)(?::|$)/);return match?Number(match[1]):null;}
function members(id:string):Set<string>{return new Set(id==="release-all"||id==="none"?[]:id.split("+").filter(Boolean));}
function delta(before:number|null|undefined,after:number|null|undefined):number|null{return before==null||after==null?null:round(after-before);}
function count(values:string[]):Record<string,number>{return Object.fromEntries([...new Set(values)].sort().map(value=>[value,values.filter(entry=>entry===value).length]));}
function read<T>(file:string):T{if(!fs.existsSync(file))throw new Error(`Missing dynasty state: ${file}`);return JSON.parse(fs.readFileSync(file,"utf8")) as T;}
function round(value:number):number{return Math.round((value+Number.EPSILON)*1e6)/1e6;}
function number(value:number|null):string{return value===null?"不可计算":signed(value);}
function signed(value:number):string{return `${value>=0?"+":""}${value.toFixed(3)}`;}
