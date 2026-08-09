import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export type BattleFrontierMechanism = "move-to-switch"|"switch-to-move"|"alternate-move"|"alternate-switch";
export interface BattleFrontierContext {phase:"unknown"|"opening"|"midgame"|"endgame";opponentConfidence:"unknown"|"low"|"developing"|"high";opponentSwitchTendency:"unknown"|"low"|"balanced"|"high";rationalGap:"alternative-ahead"|"tied"|"near"|"distant";styleAlignment:"alternative"|"neutral"|"incumbent";riskBalance:"alternative-safer"|"comparable"|"incumbent-safer"}
export interface BattleFrontierContextMetrics {turn:number|null;opponentConfidence:number|null;opponentSwitchRate:number|null;rationalCost:number;styleDelta:number;riskDelta:number}
interface FrontierExample {game:string;decisionOrdinal:number;turn:number;side:"p1"|"p2";selected:string;alternative:string;rationalCost:number;styleDelta:number;context:BattleFrontierContext;contextMetrics:BattleFrontierContextMetrics;won:boolean}
interface ManagerMechanism {managerId:string;mechanism:BattleFrontierMechanism;opportunities:number;exactTies:number;wins:number;losses:number;meanRationalCost:number;meanStyleDelta:number;examples:FrontierExample[]}
export interface BattleCandidateFrontierAudit {schemaVersion:1;contextSchemaVersion:1;activationStatus:"shadow-only";evidenceStatus:"observational-candidate-frontier";source:string;coverage:{traceFiles:number;decisions:number;comparisons:number;agreements:number;disagreements:number;frontierDecisions:number;managers:number;retainedExamples:number;truncatedManagerMechanisms:number};mechanisms:Array<{id:string;mechanism:BattleFrontierMechanism;managers:number;opportunities:number;exactTies:number}>;managerMechanisms:ManagerMechanism[];validity:{causalClaimsAllowed:false;activationAllowed:false;notes:string[]}}

export function auditBattleCandidateFrontier(source:string,options:{examplesPerManagerMechanism?:number}={}):BattleCandidateFrontierAudit{
  const requested=Math.floor(options.examplesPerManagerMechanism??3),exampleLimit=requested===0?Number.POSITIVE_INFINITY:Math.max(1,Math.min(100000,requested));
  const root=path.resolve(source),files=find(root,"ai-decisions.json"),acc=new Map<string,{managerId:string;mechanism:BattleFrontierMechanism;costs:number[];styles:number[];wins:number;losses:number;examples:FrontierExample[]}>();
  let decisions=0,comparisons=0,agreements=0,disagreements=0,frontierDecisions=0;
  for(const file of files){
    const game=path.dirname(file),endFile=path.join(game,"end.json");if(!fs.existsSync(endFile))continue;
    const end=read<any>(endFile),traces=read<any[]>(file);
    for(const trace of traces){
      decisions+=1;const comparison=trace?.whiteBoxShadow?.comparison,candidates:any[]=trace?.whiteBoxShadow?.trace?.candidates??[];
      if(!comparison||!Array.isArray(candidates))continue;comparisons+=1;if(comparison.agrees)agreements+=1;else disagreements+=1;
      const selected=String(trace.selected??comparison.incumbent??""),incumbent=candidates.find(value=>value.id===selected);if(!incumbent||!Number.isFinite(Number(incumbent.rationalScore)))continue;
      const side=trace.playerId as "p1"|"p2";if(side!=="p1"&&side!=="p2")continue;
      const managerId=String(trace.personalityId??end.aiProfiles?.[side]??side),won=String(end.winner??"")===String(end[side]??(side==="p1"?"Team A":"Team B"));
      const bestByMechanism=new Map<BattleFrontierMechanism,{candidate:any;cost:number}>();
      for(const candidate of candidates){
        if(candidate.id===selected||candidate.eligible===false||candidate.reasonable!==true||!Number.isFinite(Number(candidate.rationalScore)))continue;
        const mechanism=classify(selected,String(candidate.id));if(!mechanism)continue;
        const cost=round(Number(incumbent.rationalScore)-Number(candidate.rationalScore)),prior=bestByMechanism.get(mechanism);
        if(!prior||cost<prior.cost)bestByMechanism.set(mechanism,{candidate,cost});
      }
      if(bestByMechanism.size)frontierDecisions+=1;
      for(const [mechanism,{candidate,cost}] of bestByMechanism){
        const key=`${managerId}|${mechanism}`,row=acc.get(key)??{managerId,mechanism,costs:[],styles:[],wins:0,losses:0,examples:[]},styleDelta=round(Number(candidate.rawStyleScore??0)-Number(incumbent.rawStyleScore??0));
        row.costs.push(cost);row.styles.push(styleDelta);if(won)row.wins+=1;else row.losses+=1;
        const contextMetrics=frontierContextMetrics(trace,incumbent,candidate,cost,styleDelta),example={game:path.relative(root,game).replaceAll("\\","/"),decisionOrdinal:Number(trace.decisionOrdinal),turn:Number(trace.turn),side,selected,alternative:String(candidate.id),rationalCost:cost,styleDelta,context:classifyBattleFrontierContext(contextMetrics),contextMetrics,won};
        row.examples.push(example);row.examples.sort((a,b)=>a.rationalCost-b.rationalCost||a.game.localeCompare(b.game)||a.decisionOrdinal-b.decisionOrdinal);row.examples=row.examples.slice(0,exampleLimit);acc.set(key,row);
      }
    }
  }
  const managerMechanisms=[...acc.values()].map(row=>({managerId:row.managerId,mechanism:row.mechanism,opportunities:row.costs.length,exactTies:row.costs.filter(value=>Math.abs(value)<1e-9).length,wins:row.wins,losses:row.losses,meanRationalCost:round(mean(row.costs)),meanStyleDelta:round(mean(row.styles)),examples:row.examples})).sort((a,b)=>a.managerId.localeCompare(b.managerId)||a.mechanism.localeCompare(b.mechanism));
  const mechanisms=([...new Set(managerMechanisms.map(value=>value.mechanism))] as BattleFrontierMechanism[]).sort().map(mechanism=>{const rows=managerMechanisms.filter(value=>value.mechanism===mechanism);return{id:`battle-frontier-${mechanism}-v1`,mechanism,managers:rows.length,opportunities:rows.reduce((sum,value)=>sum+value.opportunities,0),exactTies:rows.reduce((sum,value)=>sum+value.exactTies,0)}});
  return{schemaVersion:1,contextSchemaVersion:1,activationStatus:"shadow-only",evidenceStatus:"observational-candidate-frontier",source:root,coverage:{traceFiles:files.length,decisions,comparisons,agreements,disagreements,frontierDecisions,managers:new Set(managerMechanisms.map(value=>value.managerId)).size,retainedExamples:managerMechanisms.reduce((sum,value)=>sum+value.examples.length,0),truncatedManagerMechanisms:managerMechanisms.filter(value=>value.examples.length<value.opportunities).length},mechanisms,managerMechanisms,validity:{causalClaimsAllowed:false,activationAllowed:false,notes:["Alternatives were legal and reasonable in the contemporaneous trace.","Win/loss counts are post-decision observational context and cannot score a live action.","Decision-time context uses an explicitly versioned schema and retains raw metrics for boundary sensitivity audits.","The audit exposes manager research choices; it does not prescribe a tactical preference."]}};
}

function classify(selected:string,alternative:string):BattleFrontierMechanism|null{const a=shape(selected),b=shape(alternative);if(a.historicalTera||b.historicalTera)return null;if(a.kind==="move"&&b.kind==="switch")return"move-to-switch";if(a.kind==="switch"&&b.kind==="move")return"switch-to-move";if(a.kind==="move"&&b.kind==="move")return"alternate-move";if(a.kind==="switch"&&b.kind==="switch")return"alternate-switch";return null;}
function shape(value:string):{kind:"move"|"switch"|"other";historicalTera:boolean}{const historicalTera=/\bterastallize\b/.test(value),kind=value.startsWith("move ")?"move":value.startsWith("switch ")?"switch":"other";return{kind,historicalTera};}
function frontierContextMetrics(trace:any,incumbent:any,candidate:any,rationalCost:number,styleDelta:number):BattleFrontierContextMetrics{const turn=Number(trace.turn),confidence=Number(trace.opponentModel?.confidence),switchRate=Number(trace.opponentModel?.switchRate);return{turn:Number.isFinite(turn)?turn:null,opponentConfidence:Number.isFinite(confidence)?confidence:null,opponentSwitchRate:Number.isFinite(switchRate)?switchRate:null,rationalCost,styleDelta,riskDelta:round(contribution(candidate,"risk")-contribution(incumbent,"risk"))};}
export function classifyBattleFrontierContext(metrics:BattleFrontierContextMetrics,sensitivity:-1|0|1=0):BattleFrontierContext{
  const phaseOpening=3+sensitivity,phaseMidgame=10+sensitivity,confidenceLow=.25+sensitivity*.05,confidenceHigh=.6+sensitivity*.05,switchLow=.35+sensitivity*.05,switchHigh=.65+sensitivity*.05,tie=.05+sensitivity*.025,near=2+sensitivity*.5,style=.05+sensitivity*.025,risk=.5+sensitivity*.25;
  return{phase:metrics.turn===null?"unknown":metrics.turn<=phaseOpening?"opening":metrics.turn<=phaseMidgame?"midgame":"endgame",opponentConfidence:metrics.opponentConfidence===null?"unknown":metrics.opponentConfidence<confidenceLow?"low":metrics.opponentConfidence<confidenceHigh?"developing":"high",opponentSwitchTendency:metrics.opponentSwitchRate===null?"unknown":metrics.opponentSwitchRate<switchLow?"low":metrics.opponentSwitchRate>switchHigh?"high":"balanced",rationalGap:metrics.rationalCost<-tie?"alternative-ahead":Math.abs(metrics.rationalCost)<=tie?"tied":metrics.rationalCost<=near?"near":"distant",styleAlignment:metrics.styleDelta>style?"alternative":metrics.styleDelta<-style?"incumbent":"neutral",riskBalance:metrics.riskDelta>risk?"alternative-safer":metrics.riskDelta<-risk?"incumbent-safer":"comparable"};
}
function contribution(candidate:any,group:string):number{return(candidate?.contributions??[]).filter((value:any)=>value.group===group).reduce((sum:number,value:any)=>sum+(Number(value.value)||0),0);}
function find(directory:string,name:string):string[]{const files:string[]=[];if(!fs.existsSync(directory))return files;for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const target=path.join(directory,entry.name);if(entry.isDirectory())files.push(...find(target,name));else if(entry.name===name||entry.name===`${name}.gz`)files.push(target);}return files.sort();}
function read<T>(file:string):T{const bytes=fs.readFileSync(file),text=file.endsWith(".gz")?zlib.gunzipSync(bytes).toString("utf8"):bytes.toString("utf8");return JSON.parse(text) as T;}
function mean(values:number[]):number{return values.reduce((sum,value)=>sum+value,0)/Math.max(1,values.length);}
function round(value:number):number{return Math.round((value+Number.EPSILON)*1e6)/1e6;}
export function battleFrontierDigest(value:BattleCandidateFrontierAudit):string{return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");}
