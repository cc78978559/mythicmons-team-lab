export interface BranchManagerResult {id:string; cash:number; contracts:number; payroll:number; titles:number; totalPoints:number; finalRank:number|null; finalPoints:number|null; finalChampion:boolean}
export interface WhiteBoxBranchComparison {
  managerId:string; interventionSeason:number; finalSeason:number; incumbent:BranchManagerResult; whitebox:BranchManagerResult;
  delta:{cash:number;contracts:number;payroll:number;titles:number;totalPoints:number;finalRank:number|null;finalPoints:number|null};
  champions:{incumbent:string[];whitebox:string[]};
  managerIds?:string[];
  memberComparisons?:WhiteBoxBranchComparison[];
}

export function parseBackgroundDecisionTarget(decisionId:string):{season:number;round:number;managerId:string}|null {
  const match=decisionId.match(/^market:background-action:(\d+):(\d+):([^:]+)$/);
  if(!match)return null;
  return {season:Number(match[1]),round:Number(match[2]),managerId:match[3]};
}

export function parseTradeDecisionTarget(decisionId:string):{season:number;round:number;leftManagerId:string;rightManagerId:string}|null {
  const match=decisionId.match(/^market:trade:(\d+):(\d+):([^:]+):([^:]+)$/);
  if(!match)return null;
  return {season:Number(match[1]),round:Number(match[2]),leftManagerId:match[3],rightManagerId:match[4]};
}

export function compareWhiteBoxBranches(managerId:string,interventionSeason:number,incumbentState:any,whiteboxState:any):WhiteBoxBranchComparison {
  if(incumbentState.completedSeason!==whiteboxState.completedSeason)throw new Error("Counterfactual branches ended at different seasons");
  const incumbent=result(managerId,incumbentState),whitebox=result(managerId,whiteboxState);
  return {managerId,interventionSeason,finalSeason:incumbentState.completedSeason,incumbent,whitebox,delta:{cash:round(whitebox.cash-incumbent.cash),contracts:whitebox.contracts-incumbent.contracts,payroll:round(whitebox.payroll-incumbent.payroll),titles:whitebox.titles-incumbent.titles,totalPoints:whitebox.totalPoints-incumbent.totalPoints,finalRank:nullableDelta(incumbent.finalRank,whitebox.finalRank),finalPoints:nullableDelta(incumbent.finalPoints,whitebox.finalPoints)},champions:{incumbent:champions(incumbentState,interventionSeason),whitebox:champions(whiteboxState,interventionSeason)}};
}

export function compareWhiteBoxTradeBranches(managerIds:readonly [string,string],interventionSeason:number,incumbentState:any,whiteboxState:any):WhiteBoxBranchComparison {
  const members=managerIds.map(managerId=>compareWhiteBoxBranches(managerId,interventionSeason,incumbentState,whiteboxState));
  const incumbent=combine(managerIds.join("+"),members.map(entry=>entry.incumbent));
  const whitebox=combine(managerIds.join("+"),members.map(entry=>entry.whitebox));
  return {managerId:managerIds.join("+"),managerIds:[...managerIds],memberComparisons:members,interventionSeason,finalSeason:incumbentState.completedSeason,incumbent,whitebox,delta:{cash:round(whitebox.cash-incumbent.cash),contracts:whitebox.contracts-incumbent.contracts,payroll:round(whitebox.payroll-incumbent.payroll),titles:whitebox.titles-incumbent.titles,totalPoints:whitebox.totalPoints-incumbent.totalPoints,finalRank:nullableDelta(incumbent.finalRank,whitebox.finalRank),finalPoints:nullableDelta(incumbent.finalPoints,whitebox.finalPoints)},champions:{incumbent:champions(incumbentState,interventionSeason),whitebox:champions(whiteboxState,interventionSeason)}};
}

export function whiteBoxBranchMarkdown(comparison:WhiteBoxBranchComparison):string {
  const a=comparison.incumbent,b=comparison.whitebox,d=comparison.delta;
  return ["# 白箱决策跨赛季反事实", "", `- 经理：${comparison.managerId}`, `- 干预赛季：${comparison.interventionSeason}`, `- 最终赛季：${comparison.finalSeason}`, "", "| 指标 | 旧方案 | 白箱方案 | 差值 |", "|---|---:|---:|---:|", `| 现金 | ${a.cash} | ${b.cash} | ${signed(d.cash)} |`, `| 合同数 | ${a.contracts} | ${b.contracts} | ${signed(d.contracts)} |`, `| 工资 | ${a.payroll} | ${b.payroll} | ${signed(d.payroll)} |`, `| 生涯积分 | ${a.totalPoints} | ${b.totalPoints} | ${signed(d.totalPoints)} |`, `| 冠军数 | ${a.titles} | ${b.titles} | ${signed(d.titles)} |`, `| 最终排名 | ${show(a.finalRank)} | ${show(b.finalRank)} | ${showSigned(d.finalRank)} |`, `| 最终积分 | ${show(a.finalPoints)} | ${show(b.finalPoints)} | ${showSigned(d.finalPoints)} |`, "", `- 后续冠军（旧）：${comparison.champions.incumbent.join("、")||"无"}`, `- 后续冠军（白箱）：${comparison.champions.whitebox.join("、")||"无"}`, "", "该报告是单个固定种子下的配对反事实，不代表总体效果；需要跨种子聚合后才能决定激活。", ""].join("\n");
}

function result(managerId:string,state:any):BranchManagerResult{const manager=state.managers.find((entry:any)=>entry.id===managerId);if(!manager)throw new Error(`Missing manager ${managerId}`);const final=manager.seasons.find((entry:any)=>entry.season===state.completedSeason);return{id:managerId,cash:manager.cash,contracts:manager.contracts.length,payroll:manager.contracts.reduce((sum:number,entry:any)=>sum+entry.salary,0)+(manager.deadMoneyCurrent??0),titles:manager.titles,totalPoints:manager.totalPoints,finalRank:final?.rank??null,finalPoints:final?.points??null,finalChampion:Boolean(final?.champion)};}
function combine(id:string,results:readonly BranchManagerResult[]):BranchManagerResult{return{id,cash:round(results.reduce((sum,entry)=>sum+entry.cash,0)),contracts:results.reduce((sum,entry)=>sum+entry.contracts,0),payroll:round(results.reduce((sum,entry)=>sum+entry.payroll,0)),titles:results.reduce((sum,entry)=>sum+entry.titles,0),totalPoints:results.reduce((sum,entry)=>sum+entry.totalPoints,0),finalRank:results.every(entry=>entry.finalRank!==null)?results.reduce((sum,entry)=>sum+entry.finalRank!,0):null,finalPoints:results.every(entry=>entry.finalPoints!==null)?results.reduce((sum,entry)=>sum+entry.finalPoints!,0):null,finalChampion:results.some(entry=>entry.finalChampion)};}
function champions(state:any,after:number):string[]{return Array.from({length:Math.max(0,state.completedSeason-after)},(_,index)=>after+index+1).map(season=>state.managers.find((manager:any)=>manager.seasons.some((entry:any)=>entry.season===season&&entry.champion))?.id??"unknown");}
function nullableDelta(before:number|null,after:number|null):number|null{return before===null||after===null?null:after-before;}
function signed(value:number):string{return `${value>=0?"+":""}${value}`;}
function show(value:number|null):string{return value===null?"-":String(value);}
function showSigned(value:number|null):string{return value===null?"-":signed(value);}
function round(value:number):number{return Math.round((value+Number.EPSILON)*1e6)/1e6;}
