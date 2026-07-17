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
  return {id: input.id, rational, style};
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

function contribution(id: string, group: string, source: WhiteBoxContribution["source"], value: number, reason: string): WhiteBoxContribution {
  return {id, group, source, value, reason};
}

function sum<T>(values: readonly T[], value: (entry: T) => number): number {
  return values.reduce((total, entry) => total + value(entry), 0);
}
function traceContribution(candidate:WhiteBoxCandidateTrace,id:string):number{return candidate.contributions.find(entry=>entry.id===id)?.value??0;}
function round(value:number):number{return Math.round((value+Number.EPSILON)*1e6)/1e6;}
