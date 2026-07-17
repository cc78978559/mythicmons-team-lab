import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {buildUnifiedEvidencePlan, type UnifiedEvidenceCase, type UnifiedEvidenceReplica} from "../ai/whiteBox/unifiedEvidence";
import {aggregateUnifiedBattleEvidence} from "../ai/whiteBox/unifiedAggregation";
import type {BattleCounterfactualSample} from "../ai/whiteBox/battleAggregation";

type RunStatus = "complete" | "failed";
interface SamplerRun {replicaId:string;seed:string;status:RunStatus;directory:string;startedAt:string;completedAt:string;error?:string}
interface SamplerManifest {
  schemaVersion:1;
  config:{inputs:string[];targetSamples:number;minimumSeeds:number;maximumSamples:number;maximumPerSeed:number;maximumOutputMb:number;minimumFreeGb:number;requestedHypothesis:string|null};
  hypothesis:{id:string;priority:number;availableReplicas:number;availableSeeds:number};
  runs:SamplerRun[];
  stopReason:string|null;
}

const args=process.argv.slice(2),root=process.cwd(),inputs=option("--inputs","").split(",").map(value=>value.trim()).filter(Boolean).map(value=>path.resolve(value));
if(!inputs.length)throw new Error("--inputs must contain one or more shadow league roots");
const out=path.resolve(option("--out","output/whitebox-battle-sampler")),targetSamples=integerOption("--target-samples",30,10,10000),minimumSeeds=integerOption("--minimum-seeds",10,2,targetSamples),maximumSamples=integerOption("--max-samples",Math.max(90,targetSamples),targetSamples,10000),maximumPerSeed=integerOption("--max-per-seed",9,1,100),maximumOutputMb=integerOption("--max-output-mb",1024,10,102400),minimumFreeGb=numberOption("--min-free-gb",10,0,10000),maximumLaunches=integerOption("--max-launches",10,1,1000),requestedHypothesis=option("--hypothesis","")||null;
const config={inputs,targetSamples,minimumSeeds,maximumSamples,maximumPerSeed,maximumOutputMb,minimumFreeGb,requestedHypothesis};
fs.mkdirSync(out,{recursive:true});
const manifestFile=path.join(out,"battle-sampler-manifest.json"),previous=fs.existsSync(manifestFile)?read<SamplerManifest>(manifestFile):null;
if(previous&&JSON.stringify(previous.config)!==JSON.stringify(config))throw new Error("Battle sampler configuration differs from the existing manifest; use a new --out directory");
const plan=buildUnifiedEvidencePlan(inputs,{maximumCases:10000,maximumPerDomain:1000}),candidates=plan.cases.filter(entry=>entry.domain==="battle"&&entry.status==="executable"&&entry.runner==="battle");
const selectedHypothesis=selectHypothesis(candidates,previous?.hypothesis.id??requestedHypothesis);
if(!selectedHypothesis)throw new Error("No gate-approved, exactly replayable battle hypothesis was found");
const hypothesis:UnifiedEvidenceCase=selectedHypothesis;
const available=boundedReplicas(hypothesis.replicas,maximumPerSeed),availableSeeds=new Set(available.map(entry=>entry.sourceSeed)).size;
const manifest:SamplerManifest={schemaVersion:1,config,hypothesis:{id:hypothesis.id,priority:hypothesis.priority,availableReplicas:available.length,availableSeeds},runs:previous?.runs??[],stopReason:null};
save();

if(args.includes("--run")){
  const completed=new Set(manifest.runs.filter(run=>run.status==="complete").map(run=>run.replicaId)),failed=new Set(manifest.runs.filter(run=>run.status==="failed").map(run=>run.replicaId));
  if(failed.size)manifest.stopReason=`previous-failure:${[...failed].sort()[0]}`;
  let launched=0;
  for(const replica of (failed.size?[]:roundRobin(available).filter(entry=>!completed.has(entry.id)))){
    const terminal=currentAggregate();
    if(terminal&&terminal.battleBatch.metrics.samples>=targetSamples&&terminal.battleBatch.metrics.seeds>=minimumSeeds&&terminal.battleBatch.promotion!=="insufficient-evidence"){manifest.stopReason=`terminal:${terminal.battleBatch.promotion}`;break;}
    if(completed.size>=maximumSamples){manifest.stopReason=`sample-cap:${maximumSamples}`;break;}
    if(launched>=maximumLaunches){manifest.stopReason=`launch-budget:${maximumLaunches}`;break;}
    const outputMb=directorySize(out)/1048576,freeGb=freeBytes(out)/1073741824;
    if(outputMb>=maximumOutputMb){manifest.stopReason=`output-budget:${round(outputMb)}MB/${maximumOutputMb}MB`;break;}
    if(freeGb<minimumFreeGb){manifest.stopReason=`disk-reserve:${round(freeGb)}GB/${minimumFreeGb}GB`;break;}
    runReplica(replica);completed.add(replica.id);launched+=1;
  }
  if(!manifest.stopReason){const aggregate=currentAggregate();manifest.stopReason=aggregate&&aggregate.battleBatch.metrics.samples>=targetSamples&&aggregate.battleBatch.promotion!=="insufficient-evidence"?`terminal:${aggregate.battleBatch.promotion}`:"source-pool-exhausted";}
  save();
}

const aggregate=currentAggregate();
const summary={schemaVersion:1,hypothesisId:hypothesis.id,availableReplicas:available.length,availableSeeds,completed:manifest.runs.filter(run=>run.status==="complete").length,failed:manifest.runs.filter(run=>run.status==="failed").length,stage:aggregate?.stage??"not-started",conclusion:aggregate?.conclusion??"not-started",promotion:aggregate?.battleBatch.promotion??"not-started",metrics:aggregate?.battleBatch.metrics??null,stopReason:manifest.stopReason,outputMb:round(directorySize(out)/1048576),manifest:manifestFile};
write(path.join(out,"battle-sampler-summary.json"),summary);console.log(JSON.stringify(summary,null,2));

function runReplica(replica:UnifiedEvidenceReplica):void{
  const target=replica.battleTarget;if(!target)throw new Error(`Incomplete battle replica: ${replica.id}`);
  const directory=path.join(out,"runs",hypothesis.id,replica.id),startedAt=new Date().toISOString();if(fs.existsSync(directory))throw new Error(`Untracked battle experiment directory exists: ${directory}`);
  const command=[require.resolve("tsx/cli"),path.join(root,"src","cli","counterfactualWhiteBoxBattle.ts"),"--source-game",target.sourceGame,"--out",directory,"--decision-ordinal",String(target.decisionOrdinal)],result=spawnSync(process.execPath,command,{cwd:root,encoding:"utf8",maxBuffer:64*1024*1024});
  if(result.status!==0)return failReplica(replica,directory,startedAt,result.stderr||result.stdout||`Counterfactual exited ${result.status}`);
  try{const sample=sampleFrom(directory,replica);if(!sample.sourceVerified||!sample.prefixVerified)throw new Error(`Battle replay verification drifted: ${replica.id}`);}catch(error){return failReplica(replica,directory,startedAt,error instanceof Error?error.message:String(error));}
  manifest.runs.push({replicaId:replica.id,seed:replica.sourceSeed,status:"complete",directory,startedAt,completedAt:new Date().toISOString()});save();
}
function failReplica(replica:UnifiedEvidenceReplica,directory:string,startedAt:string,error:string):never{safeRemove(directory);manifest.runs.push({replicaId:replica.id,seed:replica.sourceSeed,status:"failed",directory,startedAt,completedAt:new Date().toISOString(),error});manifest.stopReason=`experiment-failed:${replica.id}`;save();throw new Error(error);}
function currentAggregate(){const runs=manifest.runs.filter(run=>run.status==="complete");if(!runs.length)return null;return aggregateUnifiedBattleEvidence(hypothesis.id,runs.map(run=>sampleFrom(run.directory,{id:run.replicaId,sourceSeed:run.seed} as UnifiedEvidenceReplica)),{activationSamples:targetSamples,activationSeeds:minimumSeeds});}
function sampleFrom(directory:string,replica:UnifiedEvidenceReplica):BattleCounterfactualSample{const value=read<any>(path.join(directory,"counterfactual-summary.json"));return{seed:replica.sourceSeed,caseId:replica.id,sourceVerified:Boolean(value.sourceVerified),prefixVerified:Boolean(value.prefixVerified),playerId:value.intervention?.playerId,incumbent:value.incumbent,whitebox:value.whitebox};}
function selectHypothesis(values:UnifiedEvidenceCase[],requested:string|null):UnifiedEvidenceCase|undefined{if(requested)return values.find(entry=>entry.id===requested);return [...values].sort((a,b)=>new Set(b.replicas.map(value=>value.sourceSeed)).size-new Set(a.replicas.map(value=>value.sourceSeed)).size||b.replicas.length-a.replicas.length||b.priority-a.priority||a.id.localeCompare(b.id))[0];}
function boundedReplicas(values:UnifiedEvidenceReplica[],limit:number):UnifiedEvidenceReplica[]{const counts=new Map<string,number>();return[...values].sort((a,b)=>a.sourceSeed.localeCompare(b.sourceSeed)||a.id.localeCompare(b.id)).filter(entry=>{const count=counts.get(entry.sourceSeed)??0;if(count>=limit)return false;counts.set(entry.sourceSeed,count+1);return true;});}
function roundRobin(values:UnifiedEvidenceReplica[]):UnifiedEvidenceReplica[]{const groups=new Map<string,UnifiedEvidenceReplica[]>();for(const value of values)groups.set(value.sourceSeed,[...(groups.get(value.sourceSeed)??[]),value]);const result:UnifiedEvidenceReplica[]=[];for(let index=0;;index+=1){let added=false;for(const seed of [...groups.keys()].sort()){const value=groups.get(seed)?.[index];if(value){result.push(value);added=true;}}if(!added)return result;}}
function save():void{write(manifestFile,manifest);}
function safeRemove(directory:string):void{const resolved=path.resolve(directory);if(!resolved.startsWith(`${path.resolve(out)}${path.sep}`)||resolved===path.resolve(out))throw new Error(`Unsafe sampler cleanup target: ${resolved}`);fs.rmSync(resolved,{recursive:true,force:true});}
function directorySize(directory:string):number{if(!fs.existsSync(directory))return 0;let total=0;for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const target=path.join(directory,entry.name);total+=entry.isDirectory()?directorySize(target):fs.statSync(target).size;}return total;}
function freeBytes(directory:string):number{const stats=fs.statfsSync(directory);return Number(stats.bavail)*Number(stats.bsize);}
function write(file:string,value:unknown):void{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,`${JSON.stringify(value,null,2)}\n`,"utf8");}
function read<T>(file:string):T{return JSON.parse(fs.readFileSync(file,"utf8")) as T;}
function option(name:string,fallback:string):string{const index=args.indexOf(name);return index>=0?args[index+1]??fallback:fallback;}
function integerOption(name:string,fallback:number,min:number,max:number):number{const value=Number(option(name,String(fallback)));if(!Number.isInteger(value)||value<min||value>max)throw new Error(`${name} must be ${min}..${max}`);return value;}
function numberOption(name:string,fallback:number,min:number,max:number):number{const value=Number(option(name,String(fallback)));if(!Number.isFinite(value)||value<min||value>max)throw new Error(`${name} must be ${min}..${max}`);return value;}
function round(value:number):number{return Math.round(value*100)/100;}
