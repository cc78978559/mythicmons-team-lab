import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {compareWhiteBoxBranches,whiteBoxBranchMarkdown} from "../ai/whiteBox/counterfactual";

const args=process.argv.slice(2),root=process.cwd(),source=path.resolve(option("--source","output/draft-league-v12")),out=path.resolve(option("--out","output/whitebox-learning-counterfactual"));
const manager=required("--manager"),season=integerOption("--season",1,1,1000),followup=integerOption("--followup-seasons",1,1,10),target=`${manager}@${season}`;
const sourceState=read<any>(path.join(source,"dynasty-state.json"));
if(sourceState.completedSeason<season)throw new Error(`Source has not completed learning season ${season}`);
const sourceRecord=findLearningRecord(source,manager,season);verifyLearningRollback(sourceRecord.context.learningWhiteBoxTrace,sourceRecord.context.before);
if(fs.existsSync(out))throw new Error(`Counterfactual output already exists: ${out}`);
fs.mkdirSync(out,{recursive:true});
const finalSeason=season+followup,incumbentDir=path.join(out,"incumbent"),candidateDir=path.join(out,"candidate");
runBranch(incumbentDir,false);runBranch(candidateDir,true);
verifyPrefix(source,incumbentDir,Math.min(finalSeason,sourceState.completedSeason));verifyPrefix(source,candidateDir,season);
if(findExperiments(incumbentDir).length)throw new Error("Incumbent branch unexpectedly contains a learning experiment");
const experiments=findExperiments(candidateDir).filter(record=>record.context.learningExperiment?.target===target);
if(experiments.length!==1)throw new Error(`Expected exactly one learning experiment for ${target}; found ${experiments.length}`);
verifyExperiment(experiments[0]);
const incumbent=read<any>(path.join(incumbentDir,"dynasty-state.json")),candidate=read<any>(path.join(candidateDir,"dynasty-state.json")),comparison=compareWhiteBoxBranches(manager,season,incumbent,candidate);
const summary={schemaVersion:1,source,caseId:target,domain:"learning",intervention:{manager,season,policy:"no-learning-experiment"},sourceTraceVerified:true,prefixVerified:true,comparison};
write(path.join(out,"counterfactual-summary.json"),summary);fs.writeFileSync(path.join(out,"counterfactual-report.md"),whiteBoxBranchMarkdown(comparison),"utf8");
console.log(JSON.stringify({caseId:target,sourceTraceVerified:true,prefixVerified:true,comparison,report:path.join(out,"counterfactual-report.md")},null,2));

function runBranch(directory:string,candidate:boolean):void{const settings=sourceState.settings,registry=sourceState.registry,registrySource=registry?.snapshot?path.resolve(source,registry.snapshot):path.resolve(option("--registry","data/draft"));const env={...process.env,V12_OUT:directory,V12_SEED:sourceState.seed,V12_SEASONS:String(finalSeason),V12_RESUME:"false",V12_MANAGER_LIMIT:String(settings.managerLimit),V12_PAIRS:String(settings.pairs),V12_POOL_SIZE:String(settings.poolSize),V12_AUCTION_LOTS:String(settings.auctionLots),V12_REGULAR_ROUNDS:String(settings.regularRounds),V12_MAX_TURNS:String(settings.maxTurns),V12_MIN_ROSTER:String(settings.minRoster??6),V12_MAX_ROSTER:String(settings.maxRoster??10),V12_BASE_CASH:String(settings.baseBudget??40),V12_REGISTRY_SOURCE:registrySource,V12_REGISTRY_REVISION:registry?.revision??"learning-counterfactual",V12_EVIDENCE_RETENTION:"compact",V4_LEARNING_POLICY:candidate?"no-learning-experiment":"incumbent",V4_LEARNING_POLICY_TARGET:candidate?target:""};const result=spawnSync(process.execPath,[require.resolve("tsx/cli"),path.join(root,"src","cli","draftLeagueV12.ts")],{cwd:root,env,encoding:"utf8",maxBuffer:64*1024*1024});if(result.status!==0)throw new Error(`${candidate?"No-learning":"Incumbent"} branch failed:\n${result.stderr||result.stdout}`);}
function findLearningRecord(directory:string,actor:string,targetSeason:number):any{const records=retainedRecords(directory),matches=records.filter((record:any)=>record.stage==="review"&&record.actor===actor&&record.context?.season===targetSeason&&record.context?.learningWhiteBoxTrace);if(matches.length!==1)throw new Error(`Expected one retained learning trace for ${actor}@${targetSeason}; found ${matches.length}`);return matches[0];}
function findExperiments(directory:string):any[]{return retainedRecords(directory).filter((record:any)=>record.context?.learningExperiment);}
function retainedRecords(directory:string):any[]{const stateRecords=read<any>(path.join(directory,"dynasty-state.json")).decisionRecords??[];if(stateRecords.length)return stateRecords;const career=path.join(directory,"career-decisions","decision-ledger.json");return fs.existsSync(career)?read<any>(career).records??[]:[];}
function verifyLearningRollback(trace:any,before:any):void{if(trace?.version!=="white-box-learning-v1"||!Array.isArray(trace.traits)||trace.traits.length!==6)throw new Error("Invalid learning trace");for(const trait of trace.traits)if(trait.rollback?.trait!==before?.[trait.trait]||JSON.stringify(trait.rollback?.posterior)!==JSON.stringify(trait.prior))throw new Error(`Learning rollback drift for ${trait.trait}`);}
function verifyExperiment(record:any):void{const context=record.context,trace=context.learningWhiteBoxTrace;verifyLearningRollback(trace,context.before);for(const trait of trace.traits){if(context.after?.[trait.trait]!==trait.rollback.trait)throw new Error(`Learning experiment trait was not rolled back: ${trait.trait}`);if(JSON.stringify(context.development?.strategies?.[trait.trait])!==JSON.stringify(trait.rollback.posterior))throw new Error(`Learning experiment posterior was not rolled back: ${trait.trait}`);}}
function verifyPrefix(expectedRoot:string,actualRoot:string,seasons:number):void{for(let value=1;value<=seasons;value+=1){const name=`season-${String(value).padStart(2,"0")}`,expected=essential(read<any>(path.join(expectedRoot,name,"season.json"))),actual=essential(read<any>(path.join(actualRoot,name,"season.json")));if(digest(expected)!==digest(actual))throw new Error(`Replayed ${name} does not match source prefix`);}}
function essential(value:any):any{return{season:value.season,champion:value.champion,standings:value.standings,transactions:value.transactions,validity:value.validity};}
function digest(value:any):string{return crypto.createHash("sha256").update(stable(value)).digest("hex");}
function stable(value:any):string{if(Array.isArray(value))return`[${value.map(stable).join(",")}]`;if(value&&typeof value==="object")return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;return JSON.stringify(value);}
function write(file:string,value:unknown):void{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,`${JSON.stringify(value,null,2)}\n`,"utf8");}
function read<T>(file:string):T{return JSON.parse(fs.readFileSync(file,"utf8")) as T;}
function option(name:string,fallback:string):string{const index=args.indexOf(name);return index>=0?args[index+1]??fallback:fallback;}
function required(name:string):string{const value=option(name,"").trim();if(!value)throw new Error(`Missing ${name}`);return value;}
function integerOption(name:string,fallback:number,min:number,max:number):number{const value=Number(option(name,String(fallback)));if(!Number.isInteger(value)||value<min||value>max)throw new Error(`${name} must be ${min}..${max}`);return value;}
