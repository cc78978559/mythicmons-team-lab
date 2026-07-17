import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {evaluateWhiteBoxCounterfactualBatch,whiteBoxCounterfactualBatchMarkdown,type WhiteBoxCounterfactualSample} from "../ai/whiteBox/counterfactualBatch";
import {reviewWhiteBoxDifferences,whiteBoxDifferenceMarkdown} from "../ai/whiteBox/review";
import {compactWhiteBoxRun,type WhiteBoxRetentionTrace} from "../ai/whiteBox/retention";
import {firstEligibleWhiteBoxCase,whiteBoxExperimentEligibility,whiteBoxProductionEvidenceMinimum,whiteBoxSamplingProgress} from "../ai/whiteBox/sampling";

type TerminalRetention = "audit-summary"|"full";
interface SeedRun {seed:string;status:"no-difference"|"ineligible"|"complete"|"failed";baseline:string;experiment?:string;cases:number;eligibleCases?:number;durationMs:number;retention?:WhiteBoxRetentionTrace|WhiteBoxRetentionTrace[];error?:string}
interface Manifest {schemaVersion:1;config:{targetSamples:number;minimumSeeds:number;baselineSeasons:number;followupSeasons:number;maximumOutputMb:number;ineligibleRetention:TerminalRetention};existing:string[];seeds:SeedRun[]}

const args=process.argv.slice(2),root=process.cwd(),out=path.resolve(option("--out","output/whitebox-counterfactual-sampler"));
const targetSamples=integerOption("--target-samples",10,1,100),minimumSeeds=integerOption("--minimum-seeds",5,1,targetSamples),baselineSeasons=integerOption("--baseline-seasons",2,1,10),followupSeasons=integerOption("--followup-seasons",1,1,10),maximumOutputMb=integerOption("--max-output-mb",1024,50,102400);
const terminalRetention=retentionOption("--terminal-retention",retentionOption("--ineligible-retention","audit-summary"));
const existing=option("--existing","").split(",").map(value=>value.trim()).filter(Boolean).map(value=>path.resolve(value)),candidateSeeds=option("--seeds",Array.from({length:20},(_,index)=>`whitebox-auto-${String(index+1).padStart(2,"0")}`).join(",")).split(",").map(value=>value.trim()).filter(Boolean);
const manifestPath=path.join(out,"sampler-manifest.json");fs.mkdirSync(out,{recursive:true});
let manifest:Manifest=fs.existsSync(manifestPath)?read<Manifest>(manifestPath):{schemaVersion:1,config:{targetSamples,minimumSeeds,baselineSeasons,followupSeasons,maximumOutputMb,ineligibleRetention:terminalRetention},existing,seeds:[]};
if(!(manifest.config as Partial<Manifest["config"]>).ineligibleRetention)manifest.config.ineligibleRetention=terminalRetention;
if(JSON.stringify(manifest.config)!==JSON.stringify({targetSamples,minimumSeeds,baselineSeasons,followupSeasons,maximumOutputMb,ineligibleRetention:terminalRetention}))throw new Error("Sampler configuration differs from existing manifest; use a new --out directory");
const existingSet=new Set(manifest.existing);for(const directory of existing)existingSet.add(directory);manifest.existing=[...existingSet];save();

if(args.includes("--run"))for(const seed of candidateSeeds){
  if(manifest.seeds.some(entry=>entry.seed===seed))continue;
  const samples=loadSamples(manifest),progress=whiteBoxSamplingProgress(samples.map(sample=>sample.seed),targetSamples,minimumSeeds);if(progress.complete)break;
  if(directorySize(out)/1048576>maximumOutputMb)throw new Error(`Sampler output exceeded ${maximumOutputMb} MB`);
  const started=Date.now(),seedRoot=path.join(out,"seeds",safe(seed)),baseline=path.join(seedRoot,"baseline"),experiment=path.join(seedRoot,"experiment");
  try{
    if(fs.existsSync(seedRoot))throw new Error(`Untracked seed directory already exists: ${seedRoot}`);
    runBaseline(seed,baseline);
    const review=reviewWhiteBoxDifferences(baseline);
    if(!review.cases.length){writeReview(seedRoot,review);const retention=compactTerminalRuns(seedRoot,[baseline]);manifest.seeds.push({seed,status:"no-difference",baseline,cases:0,durationMs:Date.now()-started,retention});save();process.stdout.write(`sampler ${seed}: no white-box difference${retention.length?`; removed ${retentionBytes(retention)} bytes`:""}\n`);continue;}
    const eligibleCaseIndex=firstEligibleWhiteBoxCase(review.cases),eligibleCases=review.cases.filter(entry=>whiteBoxExperimentEligibility(entry).eligible).length;
    if(eligibleCaseIndex===null){
      writeReview(seedRoot,review);
      const retention=compactTerminalRuns(seedRoot,[baseline]);
      manifest.seeds.push({seed,status:"ineligible",baseline,cases:review.cases.length,eligibleCases:0,durationMs:Date.now()-started,retention});save();process.stdout.write(`sampler ${seed}: ${review.cases.length} differences archived, none passed experiment gates${retention.length?`; removed ${retentionBytes(retention)} bytes`:""}\n`);continue;
    }
    writeReview(seedRoot,review);
    runCounterfactual(baseline,experiment,eligibleCaseIndex);
    const retention=compactTerminalRuns(seedRoot,[baseline,path.join(experiment,"incumbent"),path.join(experiment,"whitebox")]);
    manifest.seeds.push({seed,status:"complete",baseline,experiment,cases:review.cases.length,eligibleCases,durationMs:Date.now()-started,retention});save();process.stdout.write(`sampler ${seed}: paired experiment complete for case ${eligibleCaseIndex}${retention.length?`; removed ${retentionBytes(retention)} bytes`:""}\n`);
  }catch(error){manifest.seeds.push({seed,status:"failed",baseline,cases:0,durationMs:Date.now()-started,error:error instanceof Error?error.message:String(error)});save();throw error;}
}

const samples=loadSamples(manifest),progress=whiteBoxSamplingProgress(samples.map(sample=>sample.seed),targetSamples,minimumSeeds);
let promotion="no-samples";if(samples.length){const batch=evaluateWhiteBoxCounterfactualBatch(samples,whiteBoxProductionEvidenceMinimum(targetSamples));promotion=batch.promotion;fs.writeFileSync(path.join(out,"counterfactual-batch.json"),`${JSON.stringify(batch,null,2)}\n`,"utf8");fs.writeFileSync(path.join(out,"counterfactual-batch.md"),whiteBoxCounterfactualBatchMarkdown(batch),"utf8");}
const result={promotion,progress,attemptedSeeds:manifest.seeds.length,noDifference:manifest.seeds.filter(entry=>entry.status==="no-difference").length,ineligible:manifest.seeds.filter(entry=>entry.status==="ineligible").length,failed:manifest.seeds.filter(entry=>entry.status==="failed").length,retentionRemovedMb:round(manifest.seeds.reduce((sum,entry)=>sum+retentionBytes(entry.retention),0)/1048576),outputMb:round(directorySize(out)/1048576),manifest:manifestPath};
fs.writeFileSync(path.join(out,"sampler-summary.json"),`${JSON.stringify(result,null,2)}\n`,"utf8");console.log(JSON.stringify(result,null,2));

function runBaseline(seed:string,directory:string):void{const env={...process.env,V12_OUT:directory,V12_SEED:seed,V12_SEASONS:String(baselineSeasons),V12_RESUME:"false",V12_MANAGER_LIMIT:option("--managers","6"),V12_PAIRS:option("--pairs","1"),V12_POOL_SIZE:option("--pool","100"),V12_AUCTION_LOTS:option("--auction-lots","10"),V12_REGULAR_ROUNDS:option("--rounds","2"),V12_MAX_TURNS:option("--max-turns","80"),V12_MIN_ROSTER:option("--min-roster","6"),V12_MAX_ROSTER:option("--max-roster","6"),V12_REGISTRY_SOURCE:path.resolve(option("--registry","data/draft")),V12_REGISTRY_REVISION:`whitebox-sampler:${seed}`,V12_EVIDENCE_RETENTION:"compact"};run([path.join(root,"src","cli","draftLeagueV12.ts")],env,`Baseline ${seed}`);}
function runCounterfactual(source:string,destination:string,caseIndex:number):void{run([path.join(root,"src","cli","counterfactualWhiteBox.ts"),"--source",source,"--out",destination,"--case-index",String(caseIndex),"--followup-seasons",String(followupSeasons)],process.env,"Counterfactual");}
function run(cliArgs:string[],env:NodeJS.ProcessEnv,label:string):void{const result=spawnSync(process.execPath,[require.resolve("tsx/cli"),...cliArgs],{cwd:root,env:{...env},encoding:"utf8",maxBuffer:64*1024*1024});if(result.status!==0)throw new Error(`${label} failed:\n${result.stderr||result.stdout}`);}
function loadSamples(value:Manifest):WhiteBoxCounterfactualSample[]{return[...value.existing,...value.seeds.filter(entry=>entry.status==="complete"&&entry.experiment).map(entry=>entry.experiment!)].map(directory=>{const summary=read<any>(path.join(directory,"counterfactual-summary.json")),state=read<any>(path.join(directory,"incumbent","dynasty-state.json")),comparison=summary.comparison;return{seed:state.seed,caseId:summary.caseId??`${comparison.managerId}@${comparison.interventionSeason}`,prefixVerified:Boolean(summary.prefixVerified),comparison};});}
function writeReview(directory:string,review:ReturnType<typeof reviewWhiteBoxDifferences>):void{fs.writeFileSync(path.join(directory,"whitebox-differences.json"),`${JSON.stringify(review,null,2)}\n`,"utf8");fs.writeFileSync(path.join(directory,"whitebox-differences.md"),whiteBoxDifferenceMarkdown(review),"utf8");}
function compactTerminalRuns(seedRoot:string,directories:string[]):WhiteBoxRetentionTrace[]{if(terminalRetention==="full")return[];const traces=directories.map(directory=>compactWhiteBoxRun(directory));fs.writeFileSync(path.join(seedRoot,"terminal-retention.json"),`${JSON.stringify({schemaVersion:1,policy:terminalRetention,traces,totalRemovedBytes:retentionBytes(traces)},null,2)}\n`,"utf8");return traces;}
function retentionBytes(value:WhiteBoxRetentionTrace|WhiteBoxRetentionTrace[]|undefined):number{return(value?Array.isArray(value)?value:[value]:[]).reduce((sum,entry)=>sum+entry.removedBytes,0);}
function save():void{fs.writeFileSync(manifestPath,`${JSON.stringify(manifest,null,2)}\n`,"utf8");}
function directorySize(directory:string):number{if(!fs.existsSync(directory))return 0;let total=0;for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const target=path.join(directory,entry.name);total+=entry.isDirectory()?directorySize(target):fs.statSync(target).size;}return total;}
function safe(value:string):string{return value.replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"")||"seed";}
function option(name:string,fallback:string):string{const index=args.indexOf(name);return index>=0?args[index+1]??fallback:fallback;}
function integerOption(name:string,fallback:number,min:number,max:number):number{const value=Number(option(name,String(fallback)));if(!Number.isInteger(value)||value<min||value>max)throw new Error(`${name} must be ${min}..${max}`);return value;}
function retentionOption(name:string,fallback:TerminalRetention):TerminalRetention{const value=option(name,fallback);if(value!=="audit-summary"&&value!=="full")throw new Error(`${name} must be audit-summary or full`);return value;}
function read<T>(file:string):T{return JSON.parse(fs.readFileSync(file,"utf8")) as T;}
function round(value:number):number{return Math.round(value*100)/100;}
