import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {compareWhiteBoxBranches,compareWhiteBoxTradeBranches,parseBackgroundDecisionTarget,parseTradeDecisionTarget,whiteBoxBranchMarkdown} from "../ai/whiteBox/counterfactual";
import {reviewWhiteBoxDifferences} from "../ai/whiteBox/review";

const args=process.argv.slice(2),root=process.cwd(),source=path.resolve(option("--source","output/draft-league-v12")),out=path.resolve(option("--out","output/whitebox-counterfactual"));
const followup=integerOption("--followup-seasons",1,1,10),caseIndex=integerOption("--case-index",1,1,1000);
const sourceState=read<any>(path.join(source,"dynasty-state.json")),review=reviewWhiteBoxDifferences(source),entry=review.cases[caseIndex-1];
if(!entry)throw new Error(`Difference case ${caseIndex} does not exist; found ${review.cases.length}`);
const keeperCase=entry.domain==="keeper",backgroundCase=entry.decisionId.startsWith("market:background-action:"),tradeCase=entry.decisionId.startsWith("market:trade:");
if((!keeperCase&&!backgroundCase&&!tradeCase)||entry.season===null)throw new Error(`Case ${caseIndex} is not an executable keeper, background-action, or trade difference`);
const backgroundTarget=backgroundCase?parseBackgroundDecisionTarget(entry.decisionId):null,interventionRound=backgroundTarget?.round??null;
const tradeTarget=tradeCase?parseTradeDecisionTarget(entry.decisionId):null;
if(backgroundCase&&(!backgroundTarget||backgroundTarget.managerId!==entry.actor||backgroundTarget.season!==entry.season))throw new Error(`Case ${caseIndex} has an invalid background intervention target`);
if(tradeCase&&(!tradeTarget||`${tradeTarget.leftManagerId}+${tradeTarget.rightManagerId}`!==entry.actor||tradeTarget.season!==entry.season))throw new Error(`Case ${caseIndex} has an invalid trade intervention target`);
if(fs.existsSync(out)){if(!args.includes("--force"))throw new Error(`Counterfactual output exists: ${out}; pass --force to replace it`);const resolved=path.resolve(out);if(path.parse(resolved).root===resolved||resolved===root||resolved===source||source.startsWith(`${resolved}${path.sep}`))throw new Error(`Refusing to remove unsafe counterfactual target: ${resolved}`);fs.rmSync(resolved,{recursive:true,force:true});}
fs.mkdirSync(out,{recursive:true});
const finalSeason=Math.max(sourceState.completedSeason,entry.season)+followup,incumbentDir=path.join(out,"incumbent"),whiteboxDir=path.join(out,"whitebox");
runBranch(incumbentDir,false);runBranch(whiteboxDir,true);
verifyPrefix(source,incumbentDir,sourceState.completedSeason);verifyPrefix(source,whiteboxDir,keeperCase?entry.season:Math.max(0,entry.season-1));
const incumbent=read<any>(path.join(incumbentDir,"dynasty-state.json")),whitebox=read<any>(path.join(whiteboxDir,"dynasty-state.json"));
const comparison=tradeTarget?compareWhiteBoxTradeBranches([tradeTarget.leftManagerId,tradeTarget.rightManagerId],entry.season,incumbent,whitebox):compareWhiteBoxBranches(entry.actor,entry.season,incumbent,whitebox);
const normalizedCaseId=backgroundCase?`${entry.actor}@${entry.season}@${interventionRound}`:tradeCase?`${entry.actor}@${entry.season}@${tradeTarget!.round}`:`${entry.actor}@${entry.season}`;
const summary={schemaVersion:1,source,caseIndex,caseId:normalizedCaseId,domain:backgroundCase?"background":tradeCase?"trade":"keeper",sourceTraceId:entry.id,incumbentChoice:entry.incumbent,whiteboxChoice:entry.shadow,prefixVerified:true,comparison};
fs.writeFileSync(path.join(out,"counterfactual-summary.json"),`${JSON.stringify(summary,null,2)}\n`,"utf8");
fs.writeFileSync(path.join(out,"counterfactual-report.md"),whiteBoxBranchMarkdown(comparison),"utf8");
console.log(JSON.stringify({caseId:normalizedCaseId,sourceTraceId:entry.id,prefixVerified:true,comparison,report:path.join(out,"counterfactual-report.md")},null,2));

function runBranch(directory:string,whitebox:boolean):void{
  const settings=sourceState.settings,registry=sourceState.registry;
  const registrySource=registry?.snapshot?path.resolve(source,registry.snapshot):path.resolve(option("--registry","data/draft"));
  const env={...process.env,V12_OUT:directory,V12_SEED:sourceState.seed,V12_SEASONS:String(finalSeason),V12_RESUME:"false",V12_MANAGER_LIMIT:String(settings.managerLimit),V12_PAIRS:String(settings.pairs),V12_POOL_SIZE:String(settings.poolSize),V12_AUCTION_LOTS:String(settings.auctionLots),V12_REGULAR_ROUNDS:String(settings.regularRounds),V12_MAX_TURNS:String(settings.maxTurns),V12_MIN_ROSTER:String(settings.minRoster??6),V12_MAX_ROSTER:String(settings.maxRoster??10),V12_BASE_CASH:String(settings.baseBudget??40),V12_REGISTRY_SOURCE:registrySource,V12_REGISTRY_REVISION:registry?.revision??"counterfactual",V12_EVIDENCE_RETENTION:"compact",V4_KEEPER_POLICY:whitebox&&keeperCase?"whitebox-experiment":"incumbent",V4_KEEPER_POLICY_TARGET:whitebox&&keeperCase?`${entry.actor}@${entry.season}`:"",V4_BACKGROUND_POLICY:whitebox&&backgroundCase?"whitebox-experiment":"incumbent",V4_BACKGROUND_POLICY_TARGET:whitebox&&backgroundCase?`${entry.actor}@${entry.season}@${interventionRound}`:"",V4_TRADE_POLICY:whitebox&&tradeCase?"whitebox-experiment":"incumbent",V4_TRADE_POLICY_TARGET:whitebox&&tradeCase?entry.decisionId:""};
  const result=spawnSync(process.execPath,[require.resolve("tsx/cli"),path.join(root,"src","cli","draftLeagueV12.ts")],{cwd:root,env,encoding:"utf8",maxBuffer:64*1024*1024});
  if(result.status!==0)throw new Error(`${whitebox?"White-box":"Incumbent"} branch failed:\n${result.stderr||result.stdout}`);
}
function verifyPrefix(expectedRoot:string,actualRoot:string,seasons:number):void{for(let season=1;season<=seasons;season++){const name=`season-${String(season).padStart(2,"0")}`,expected=essential(read<any>(path.join(expectedRoot,name,"season.json"))),actual=essential(read<any>(path.join(actualRoot,name,"season.json")));if(digest(expected)!==digest(actual))throw new Error(`Replayed ${name} does not match source prefix`);}}
function essential(season:any):any{return{season:season.season,champion:season.champion,standings:season.standings,transactions:season.transactions,validity:season.validity};}
function digest(value:any):string{return crypto.createHash("sha256").update(stable(value)).digest("hex");}
function stable(value:any):string{if(Array.isArray(value))return`[${value.map(stable).join(",")}]`;if(value&&typeof value==="object")return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;return JSON.stringify(value);}
function option(name:string,fallback:string):string{const index=args.indexOf(name);return index>=0?args[index+1]??fallback:fallback;}
function integerOption(name:string,fallback:number,min:number,max:number):number{const value=Number(option(name,String(fallback)));if(!Number.isInteger(value)||value<min||value>max)throw new Error(`${name} must be ${min}..${max}`);return value;}
function read<T>(file:string):T{return JSON.parse(fs.readFileSync(file,"utf8")) as T;}
