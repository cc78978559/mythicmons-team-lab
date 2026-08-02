import type {WhiteBoxCandidate, WhiteBoxCandidateTrace, WhiteBoxContribution} from "./decision";
import {LINEUP_SHADOW_PARAMETERS} from "./parameters";

export const WHITE_BOX_LINEUP_ASSIST_VERSION="white-box-lineup-assist-v1";
export interface WhiteBoxLineupAssistGate {version:typeof WHITE_BOX_LINEUP_ASSIST_VERSION;recommended:boolean;hardRejections:string[];parameters:Record<string,number>;rationalRegression:number|null;styleGain:number|null;netMargin:number|null;structureRegression:number|null;supportingSignals:string[]}

export interface WhiteBoxLineupTraits {
  risk: number;
  stars: number;
  synergy: number;
  counter: number;
  value: number;
  flexibility: number;
}

export interface WhiteBoxRoleTarget {
  minimum: number;
  target: number;
  weight: number;
}

export interface WhiteBoxLineupMember {
  id: string;
  strength: number;
  market: number;
  roles: readonly string[];
  risk: number;
  opponentCoverage: number;
  opponentCoverageVector?: readonly number[];
  speed?: number;
  speedAdvantage?: number;
  offensivePressureVector?: readonly number[];
  physicalPressureVector?: readonly number[];
  specialPressureVector?: readonly number[];
  priorityPressureVector?: readonly number[];
  defensiveSafetyVector?: readonly number[];
  historicalMatchup: number;
  tacticalMemory: number;
}

export interface WhiteBoxLineupInput {
  id: string;
  members: readonly WhiteBoxLineupMember[];
  traits: WhiteBoxLineupTraits;
  roleTargets: Readonly<Record<string, WhiteBoxRoleTarget | undefined>>;
  programAdjustment?: number;
}

/** Mirrors the incumbent lineup formula while assigning every term a semantic owner. */
export function buildLineupWhiteBoxCandidate(input: WhiteBoxLineupInput): WhiteBoxCandidate {
  if (input.members.length !== 6) return {id: input.id, hardRejections: [`lineup-size:${input.members.length}`], rational: []};
  const roles = new Set(input.members.flatMap(member => [...member.roles]));
  const roleCounts = countRoles(input.members);
  const rational: WhiteBoxContribution[] = [
    contribution("lineup.strength", "strength", "competence", sum(input.members, member => member.strength / 200), "Combined member strength"),
  ];
  let roleCoverage = 0;
  for (const [role, target] of Object.entries(input.roleTargets)) {
    if (!target) continue;
    const count = roleCounts[role] ?? 0;
    roleCoverage += Math.min(count, target.target) * target.weight * .09;
    if (count < target.minimum) roleCoverage -= (target.minimum - count) * target.weight * .22;
  }
  rational.push(contribution("lineup.rolecoverage", "roles", "goal", roleCoverage, "Declared role targets and minimums"));
  const structuralRoles = ["hazards", "removal", "recovery", "pivot"].filter(role => roles.has(role)).length;
  rational.push(contribution("lineup.structure", "roles", "competence", structuralRoles * .2, "Baseline structural role coverage"));
  rational.push(contribution("lineup.coverage", "matchup", "competence", sum(input.members, member => member.opponentCoverage) * .02, "Baseline offensive coverage into the opposing roster"));

  const style: WhiteBoxContribution[] = [
    contribution("lineup.synergy", "personality", "personality", structuralRoles * input.traits.synergy * .15, "Synergy preference values structural roles"),
    contribution("lineup.flexibility", "personality", "personality", roles.size * input.traits.flexibility * .025, "Flexibility preference values role breadth"),
    contribution("lineup.stars", "personality", "personality", sum(input.members, member => member.market / 30) * input.traits.stars * .035, "Star preference values premium members"),
    contribution("lineup.value", "personality", "personality", sum(input.members, member => member.strength / Math.max(3, member.market)) * input.traits.value * .003, "Value preference rewards strength per market cost"),
    contribution("lineup.risk", "personality", "personality", sum(input.members, member => member.risk) * input.traits.risk * .035, "Risk preference values volatile tools"),
    contribution("lineup.history", "memory", "memory", sum(input.members, member => member.historicalMatchup) * input.traits.counter * .04, "Historical matchup family scores"),
    contribution("lineup.tacticalmemory", "memory", "memory", sum(input.members, member => member.tacticalMemory) * input.traits.counter * .18, "Confidence-bounded tactical family memory"),
    contribution("lineup.counter", "matchup", "personality", sum(input.members, member => member.opponentCoverage) * input.traits.counter * .035, "Counter preference values opponent-specific coverage"),
    contribution("lineup.program", "strategy", "context", input.programAdjustment ?? 0, "Bounded strategy-program adjustment"),
  ];
  return {id: input.id, rational, style, diagnostics: lineupDiagnostics(input.members, roleCounts)};
}

export function whiteBoxCandidateTotal(candidate: WhiteBoxCandidate): number {
  return [...candidate.rational, ...(candidate.style ?? [])].reduce((total, entry) => total + entry.value, 0);
}

export function evaluateLineupAssistGate(incumbent:WhiteBoxCandidateTrace|undefined,selected:WhiteBoxCandidateTrace|undefined,overrides:Readonly<Record<string,number>>={}):WhiteBoxLineupAssistGate {
  const parameters=LINEUP_SHADOW_PARAMETERS.snapshot(overrides).values,hardRejections:string[]=[];
  if(!incumbent||!selected||incumbent.rationalScore===null||selected.rationalScore===null||incumbent.rawStyleScore===null||selected.rawStyleScore===null){hardRejections.push("missing-candidate");return{version:WHITE_BOX_LINEUP_ASSIST_VERSION,recommended:false,hardRejections,parameters,rationalRegression:null,styleGain:null,netMargin:null,structureRegression:null,supportingSignals:[]};}
  const rationalRegression=round(incumbent.rationalScore-selected.rationalScore),styleGain=round(selected.rawStyleScore-incumbent.rawStyleScore),netMargin=round(styleGain-rationalRegression),structureDelta=traceContribution(selected,"lineup.rolecoverage")+traceContribution(selected,"lineup.structure")-traceContribution(incumbent,"lineup.rolecoverage")-traceContribution(incumbent,"lineup.structure"),structureRegression=round(Math.max(0,-structureDelta));
  const supportingSignals=selected.contributions.filter(entry=>entry.source==="personality"||entry.source==="memory"||entry.source==="context").filter(entry=>entry.value-traceContribution(incumbent,entry.id)>1e-6).map(entry=>entry.id).sort();
  if(rationalRegression>parameters["lineup.assistmaximumrationalregression"]+1e-9)hardRejections.push("rational-regression");if(netMargin+1e-9<parameters["lineup.assistminimummargin"])hardRejections.push("insufficient-margin");if(structureRegression>parameters["lineup.assistmaximumstructureregression"]+1e-9)hardRejections.push("structure-regression");if(supportingSignals.length<parameters["lineup.assistminimumsignals"])hardRejections.push("insufficient-signals");
  return{version:WHITE_BOX_LINEUP_ASSIST_VERSION,recommended:hardRejections.length===0,hardRejections,parameters,rationalRegression,styleGain,netMargin,structureRegression,supportingSignals};
}

function countRoles(members: readonly WhiteBoxLineupMember[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const member of members) for (const role of member.roles) counts[role] = (counts[role] ?? 0) + 1;
  return counts;
}

function lineupDiagnostics(members: readonly WhiteBoxLineupMember[], roleCounts: Readonly<Record<string, number>>): Record<string, number> {
  const structuralRoles = ["hazards", "removal", "recovery", "pivot"];
  const representedRoles = ["hazards", "removal", "recovery", "pivot", "setup", "priority", "screens", "status", "physical", "special"] as const;
  const structuralDepths = structuralRoles.map(role => roleCounts[role] ?? 0);
  const strengths = members.map(member => member.strength);
  const risks = members.map(member => member.risk);
  const memberCoverage = members.map(member => member.opponentCoverage);
  const diagnostics: Record<string, number> = {
    "lineup.representationVersion": 5,
    "lineup.roleTagBreadth": Object.keys(roleCounts).length,
    "lineup.structuralCoverage": structuralDepths.filter(depth => depth > 0).length,
    "lineup.structuralRedundancy": structuralDepths.reduce((total, depth) => total + Math.max(0, depth - 1), 0),
    "lineup.structuralSinglePoints": structuralDepths.filter(depth => depth === 1).length,
    "lineup.structuralMinimumDepth": Math.min(...structuralDepths),
    "lineup.strengthFloor": Math.min(...strengths),
    "lineup.strengthSpread": standardDeviation(strengths),
    "lineup.riskPeak": Math.max(...risks),
    "lineup.memberCoverageFloor": Math.min(...memberCoverage),
    "lineup.memberCoverageSpread": standardDeviation(memberCoverage),
    ...Object.fromEntries(representedRoles.map(role => [`lineup.role${role[0].toUpperCase()}${role.slice(1)}Count`, roleCounts[role] ?? 0])),
  };
  const vectors = members.map(member => member.opponentCoverageVector);
  const opponentCount = vectors[0]?.length ?? 0;
  if (opponentCount > 0 && vectors.every(vector => vector?.length === opponentCount)) {
    const answerDepths = Array.from({length: opponentCount}, (_, index) => vectors.reduce((total, vector) => total + (vector?.[index] ?? 0), 0));
    diagnostics["lineup.opponentUnansweredCount"] = answerDepths.filter(depth => depth <= 0).length;
    diagnostics["lineup.opponentSingletonCount"] = answerDepths.filter(depth => depth === 1).length;
    diagnostics["lineup.opponentMinimumAnswerDepth"] = Math.min(...answerDepths);
    diagnostics["lineup.opponentMeanAnswerDepth"] = mean(answerDepths);
    diagnostics["lineup.opponentAnswerDepthSpread"] = standardDeviation(answerDepths);
  }
  const speeds = members.map(member => member.speed).filter((value): value is number => Number.isFinite(value));
  if (speeds.length === members.length) {
    diagnostics["lineup.speedFloor"] = Math.min(...speeds);
    diagnostics["lineup.speedMedian"] = median(speeds);
    diagnostics["lineup.speedSpread"] = standardDeviation(speeds);
    diagnostics["lineup.speedAdvantageMean"] = mean(members.map(member => member.speedAdvantage ?? 0));
  }
  addMatchupPressureDiagnostics(diagnostics, members, opponentCount);
  return diagnostics;
}

function addMatchupPressureDiagnostics(
  diagnostics: Record<string, number>,
  members: readonly WhiteBoxLineupMember[],
  opponentCount: number,
): void {
  const offense = members.map(member => member.offensivePressureVector);
  const defense = members.map(member => member.defensiveSafetyVector);
  if (opponentCount <= 0 || !offense.every(vector => vector?.length === opponentCount) || !defense.every(vector => vector?.length === opponentCount)) return;
  const bestOffense: number[] = [], secondOffense: number[] = [], bestDefense: number[] = [], secondDefense: number[] = [], twoWay: number[] = [];
  for (let index = 0; index < opponentCount; index++) {
    const offensive = offense.map(vector => vector?.[index] ?? 0).sort((left, right) => right - left);
    const defensive = defense.map(vector => vector?.[index] ?? 0).sort((left, right) => right - left);
    bestOffense.push(offensive[0] ?? 0);
    secondOffense.push(offensive[1] ?? 0);
    bestDefense.push(defensive[0] ?? 0);
    secondDefense.push(defensive[1] ?? 0);
    twoWay.push(Math.max(...members.map((_, memberIndex) => Math.sqrt((offense[memberIndex]?.[index] ?? 0) * (defense[memberIndex]?.[index] ?? 0)))));
  }
  diagnostics["lineup.offensivePressureFloor"] = Math.min(...bestOffense);
  diagnostics["lineup.offensivePressureMean"] = mean(bestOffense);
  diagnostics["lineup.offensiveRedundancyFloor"] = Math.min(...secondOffense);
  diagnostics["lineup.defensiveSafetyFloor"] = Math.min(...bestDefense);
  diagnostics["lineup.defensiveSafetyMean"] = mean(bestDefense);
  diagnostics["lineup.defensiveRedundancyFloor"] = Math.min(...secondDefense);
  diagnostics["lineup.twoWayMatchupFloor"] = Math.min(...twoWay);
  addCategoryPressureDiagnostics(diagnostics, members, opponentCount);
  addRoleSafetyDiagnostics(diagnostics, members, defense, opponentCount);
}

function addCategoryPressureDiagnostics(diagnostics: Record<string, number>, members: readonly WhiteBoxLineupMember[], opponentCount: number): void {
  const categories = [
    {name: "Physical", vectors: members.map(member => member.physicalPressureVector)},
    {name: "Special", vectors: members.map(member => member.specialPressureVector)},
    {name: "Priority", vectors: members.map(member => member.priorityPressureVector)},
  ];
  const bestByCategory = new Map<string, number[]>();
  for (const category of categories) {
    if (!category.vectors.every(vector => vector?.length === opponentCount)) return;
    const best: number[] = [], second: number[] = [];
    for (let index = 0; index < opponentCount; index++) { const values = category.vectors.map(vector => vector?.[index] ?? 0).sort((left, right) => right - left); best.push(values[0] ?? 0); second.push(values[1] ?? 0); }
    bestByCategory.set(category.name, best);
    diagnostics[`lineup.${category.name[0].toLowerCase()}${category.name.slice(1)}PressureFloor`] = Math.min(...best);
    diagnostics[`lineup.${category.name[0].toLowerCase()}${category.name.slice(1)}PressureMean`] = mean(best);
    diagnostics[`lineup.${category.name[0].toLowerCase()}${category.name.slice(1)}PressureRedundancyFloor`] = Math.min(...second);
  }
  const physical = bestByCategory.get("Physical")!, special = bestByCategory.get("Special")!, dual = physical.map((value, index) => Math.sqrt(value * special[index]));
  diagnostics["lineup.dualCategoryPressureFloor"] = Math.min(...dual);
  diagnostics["lineup.dualCategoryPressureMean"] = mean(dual);
}

function addRoleSafetyDiagnostics(diagnostics: Record<string, number>, members: readonly WhiteBoxLineupMember[], defense: readonly (readonly number[] | undefined)[], opponentCount: number): void {
  for (const role of ["hazards", "removal", "recovery", "pivot", "setup", "screens", "status"] as const) {
    const eligible = members.map((member, index) => member.roles.includes(role) ? defense[index] : undefined).filter((vector): vector is readonly number[] => Boolean(vector));
    const name = `${role[0].toUpperCase()}${role.slice(1)}`;
    if (!eligible.length) { diagnostics[`lineup.role${name}SafetyFloor`] = 0; diagnostics[`lineup.role${name}SafetyMean`] = 0; continue; }
    const best = Array.from({length: opponentCount}, (_, index) => Math.max(...eligible.map(vector => vector[index] ?? 0)));
    diagnostics[`lineup.role${name}SafetyFloor`] = Math.min(...best);
    diagnostics[`lineup.role${name}SafetyMean`] = mean(best);
  }
}

function contribution(id: string, group: string, source: WhiteBoxContribution["source"], value: number, reason: string): WhiteBoxContribution {
  return {id, group, source, value, reason};
}

function sum<T>(values: readonly T[], value: (entry: T) => number): number {
  return values.reduce((total, entry) => total + value(entry), 0);
}
function mean(values: readonly number[]): number{return values.reduce((total,value)=>total+value,0)/values.length;}
function median(values: readonly number[]): number{const sorted=[...values].sort((left,right)=>left-right),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;}
function standardDeviation(values: readonly number[]): number{const average=mean(values);return Math.sqrt(values.reduce((total,value)=>total+(value-average)**2,0)/values.length);}
function traceContribution(candidate:WhiteBoxCandidateTrace,id:string):number{return candidate.contributions.find(entry=>entry.id===id)?.value??0;}
function round(value:number):number{return Math.round((value+Number.EPSILON)*1e6)/1e6;}
