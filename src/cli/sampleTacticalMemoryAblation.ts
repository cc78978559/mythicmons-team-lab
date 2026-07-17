import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {aggregateTacticalMemoryAblations,tacticalMemoryAblationMarkdown,type TacticalMemoryAblationSample} from "../ai/whiteBox/tacticalMemoryAblation";
import {loadBattleReplayCapsule,runBattle,type BattleReplayCapsule,type BattleResult} from "../showdown/battle";
import {AI_VERSION,EMPTY_OPPONENT_MODEL,type AiDecisionTrace} from "../showdown/choice";

type Side="p1"|"p2";
interface Candidate{id:string;sourceGame:string;replaySha256:string;seed:string;playerId:Side;confidence:number;season:number|null}
interface RunRecord{candidate:Candidate;status:"complete"|"failed";directory:string;startedAt:string;completedAt:string;error?:string;importedFrom?:string}
interface Manifest{schemaVersion:1;config:{inputs:string[];minimumConfidence:number;maximumConfidence:number;targetSamples:number;minimumSeeds:number;minimumDecisivePairs:number;minimumDecisiveSeeds:number;maximumOneSidedP:number;maximumOutputMb:number;minimumFreeGb:number;shadowPolicy:string};candidates:Candidate[];runs:RunRecord[];stopReason:string|null}

const args=process.argv.slice(2),inputs=option("--inputs","").split(",").map(value=>value.trim()).filter(Boolean).map(value=>path.resolve(value));
if(!inputs.length)throw new Error("--inputs must contain one or more retained league roots");
const out=path.resolve(option("--out","output/tactical-memory-ablation")),minimumConfidence=numberOption("--minimum-confidence",.05,0,1),maximumConfidence=numberOption("--maximum-confidence",1,0,1),targetSamples=integerOption("--target-samples",30,3,10000),minimumSeeds=integerOption("--minimum-seeds",10,2,targetSamples),minimumDecisivePairs=integerOption("--minimum-decisive-pairs",10,2,targetSamples),minimumDecisiveSeeds=integerOption("--minimum-decisive-seeds",5,2,minimumSeeds),maximumOneSidedP=numberOption("--maximum-one-sided-p",.1,.001,.5),maximumSamples=integerOption("--max-samples",Math.max(90,targetSamples),targetSamples,10000),maximumOutputMb=integerOption("--max-output-mb",2048,10,102400),minimumFreeGb=numberOption("--min-free-gb",10,0,10000),maximumLaunches=integerOption("--max-launches",10,1,1000),shadowPolicy=option("--shadow-policy","").trim();
if(maximumConfidence<=minimumConfidence)throw new Error("--maximum-confidence must be greater than --minimum-confidence");
const config={inputs,minimumConfidence,maximumConfidence,targetSamples,minimumSeeds,minimumDecisivePairs,minimumDecisiveSeeds,maximumOneSidedP,maximumOutputMb,minimumFreeGb,shadowPolicy};
fs.mkdirSync(out,{recursive:true});
const manifestFile=path.join(out,"tactical-memory-ablation-manifest.json"),previous=fs.existsSync(manifestFile)?read<Manifest>(manifestFile):null,candidates=scanCandidates();
if(previous&&stableJson(withoutLegacySampleCap(previous.config))!==stableJson(config))throw new Error("Tactical-memory ablation configuration differs from the existing manifest; use a new --out directory");
if(previous&&JSON.stringify(previous.candidates)!==JSON.stringify(candidates))throw new Error("Tactical-memory source catalog changed since the manifest was created");
const manifest:Manifest={schemaVersion:1,config,candidates,runs:previous?.runs??importExistingRuns(),stopReason:previous?.stopReason??null};save();

async function main():Promise<void>{
  if(args.includes("--run")){
    manifest.stopReason=null;
    const failed=manifest.runs.find(run=>run.status==="failed");
    if(failed)manifest.stopReason=`previous-failure:${failed.candidate.id}`;
    else{
      const completed=new Set(manifest.runs.filter(run=>run.status==="complete").map(run=>run.candidate.id));let launched=0;
      for(const candidate of roundRobin(candidates).filter(candidate=>!completed.has(candidate.id))){
        const aggregate=currentAggregate();
        if(!args.includes("--exhaust-source-pool")&&aggregate&&terminal(aggregate.conclusion)){manifest.stopReason=`terminal:${aggregate.conclusion}`;break;}
        if(completed.size>=maximumSamples){manifest.stopReason=`sample-cap:${maximumSamples}`;break;}
        if(launched>=maximumLaunches){manifest.stopReason=`launch-budget:${maximumLaunches}`;break;}
        const outputMb=directorySize(out)/1048576,freeGb=freeBytes(out)/1073741824;
        if(outputMb>=maximumOutputMb){manifest.stopReason=`output-budget:${round(outputMb)}MB/${maximumOutputMb}MB`;break;}
        if(freeGb<minimumFreeGb){manifest.stopReason=`disk-reserve:${round(freeGb)}GB/${minimumFreeGb}GB`;break;}
        await runCandidate(candidate);completed.add(candidate.id);launched+=1;
      }
      if(!manifest.stopReason)manifest.stopReason="source-pool-exhausted";
    }
    save();
  }
  const aggregate=currentAggregate();if(aggregate){write(path.join(out,"tactical-memory-ablation-aggregate.json"),aggregate);fs.writeFileSync(path.join(out,"tactical-memory-ablation-aggregate.md"),tacticalMemoryAblationMarkdown(aggregate),"utf8");}
  const summary={schemaVersion:1,candidates:candidates.length,candidateSeeds:new Set(candidates.map(value=>value.seed)).size,completed:manifest.runs.filter(run=>run.status==="complete").length,imported:manifest.runs.filter(run=>run.importedFrom).length,failed:manifest.runs.filter(run=>run.status==="failed").length,conclusion:aggregate?.conclusion??"not-started",metrics:aggregate?.metrics??null,stopReason:manifest.stopReason,outputMb:round(directorySize(out)/1048576),manifest:manifestFile};write(path.join(out,"tactical-memory-ablation-summary.json"),summary);console.log(JSON.stringify(summary,null,2));
}

async function runCandidate(candidate:Candidate):Promise<void>{
  const directory=path.join(out,"runs",candidate.id),startedAt=new Date().toISOString();if(fs.existsSync(directory))throw new Error(`Untracked tactical-memory experiment directory exists: ${directory}`);
  try{
    const capsule=loadBattleReplayCapsule(path.join(candidate.sourceGame,"replay-input.json")),sourceTraces=readEvidence<AiDecisionTrace[]>(candidate.sourceGame,"ai-decisions.json");
    const common={...capsule.input,seed:"exact-tactical-memory-replay",explicitSeed:capsule.input.seed,gameIndex:0};
    const incumbent=await runBattle({...common,outDir:path.join(directory,"incumbent")}),incumbentTraces=read<AiDecisionTrace[]>(incumbent.decisionLogPath),sourceVerified=JSON.stringify(sourceTraces)===JSON.stringify(incumbentTraces);
    if(!sourceVerified)throw new Error(`Exact learned replay diverged from source: ${candidate.id}`);
    const models=structuredClone(capsule.input.aiOpponentModels);models[candidate.playerId]=structuredClone(EMPTY_OPPONENT_MODEL);
    if(shadowPolicy)models[candidate.playerId]=structuredClone(requiredShadow(capsule,candidate.playerId));
    const branch=await runBattle({...common,outDir:path.join(directory,shadowPolicy?"candidate":"ablated"),aiOpponentModels:models,aiOpponentModelPolicy:shadowPolicy||capsule.input.aiOpponentModelPolicy}),branchTraces=read<AiDecisionTrace[]>(branch.decisionLogPath);
    const sample:TacticalMemoryAblationSample={seed:candidate.seed,caseId:candidate.id,playerId:candidate.playerId,confidence:candidate.confidence,candidatePolicy:shadowPolicy||undefined,sourceVerified,firstDivergenceOrdinal:firstDivergence(branchTraces,incumbentTraces,candidate.playerId),learned:outcome(shadowPolicy?branch:incumbent),ablated:outcome(shadowPolicy?incumbent:branch)};
    write(path.join(directory,"tactical-memory-ablation-sample.json"),sample);manifest.runs.push({candidate,status:"complete",directory,startedAt,completedAt:new Date().toISOString()});save();
  }catch(error){const message=error instanceof Error?error.message:String(error);manifest.runs.push({candidate,status:"failed",directory,startedAt,completedAt:new Date().toISOString(),error:message});manifest.stopReason=`experiment-failed:${candidate.id}`;save();throw error;}
}

function scanCandidates():Candidate[]{const values=new Map<string,Candidate>();for(const root of inputs)for(const file of findNamed(root,"replay-input.json")){const sourceGame=path.dirname(file);if(!hasEvidence(sourceGame,"ai-decisions.json"))continue;try{const capsule=loadBattleReplayCapsule(file);if(!eligible(capsule))continue;if(shadowPolicy&&capsule.input.aiOpponentModelPolicy!=="cumulative")continue;for(const playerId of ["p1","p2"] as const){const confidence=capsule.input.aiOpponentModels[playerId].confidence;if(confidence+1e-12<minimumConfidence||(maximumConfidence<1&&confidence>=maximumConfidence))continue;if(shadowPolicy&&JSON.stringify(capsule.input.aiOpponentModels[playerId])===JSON.stringify(requiredShadow(capsule,playerId)))continue;const seed=capsule.input.seed.join("-"),id=digest(shadowPolicy?`${capsule.sha256}:${playerId}:${shadowPolicy}`:`${capsule.sha256}:${playerId}`);values.set(id,{id,sourceGame,replaySha256:capsule.sha256,seed,playerId,confidence:round(confidence),season:seasonFromPath(path.relative(root,file).replaceAll("\\","/"))});}}catch{continue;}}return[...values.values()].sort((a,b)=>b.confidence-a.confidence||a.seed.localeCompare(b.seed)||a.playerId.localeCompare(b.playerId)||a.sourceGame.localeCompare(b.sourceGame));}
function importExistingRuns():RunRecord[]{const sources=option("--existing","").split(",").map(value=>value.trim()).filter(Boolean).map(value=>path.resolve(value)),allowed=new Map(candidates.map(candidate=>[candidate.id,candidate])),imported=new Map<string,RunRecord>();for(const source of sources){const file=path.join(source,"tactical-memory-ablation-manifest.json");if(!fs.existsSync(file))throw new Error(`Missing existing tactical-memory manifest: ${file}`);for(const run of read<Manifest>(file).runs.filter(run=>run.status==="complete")){const candidate=allowed.get(run.candidate.id),sampleFile=path.join(run.directory,"tactical-memory-ablation-sample.json");if(!candidate||imported.has(candidate.id)||!fs.existsSync(sampleFile))continue;if(candidate.replaySha256!==run.candidate.replaySha256)throw new Error(`Existing tactical-memory source drift: ${candidate.id}`);const sample=read<TacticalMemoryAblationSample>(sampleFile);if(!sample.sourceVerified||sample.caseId!==candidate.id)throw new Error(`Existing tactical-memory sample failed verification: ${candidate.id}`);imported.set(candidate.id,{...run,candidate,directory:path.resolve(run.directory),importedFrom:source});}}return[...imported.values()];}
function eligible(capsule:BattleReplayCapsule):boolean{return capsule.input.aiVersion===AI_VERSION&&capsule.input.ai==="search"&&capsule.input.traceAiDecisions&&!capsule.input.battleAssistScopes?.length;}
function requiredShadow(capsule:BattleReplayCapsule,playerId:Side){const model=capsule.input.aiOpponentModelShadows?.[shadowPolicy]?.[playerId];if(!model)throw new Error(`Missing ${shadowPolicy} shadow for ${playerId}`);return model;}
function currentAggregate(){const samples=manifest.runs.filter(run=>run.status==="complete").map(run=>read<TacticalMemoryAblationSample>(path.join(run.directory,"tactical-memory-ablation-sample.json")));return samples.length?aggregateTacticalMemoryAblations(samples,{minimumSamples:targetSamples,minimumSeeds,minimumDecisivePairs,minimumDecisiveSeeds,maximumOneSidedP}):null;}
function firstDivergence(learned:AiDecisionTrace[],ablated:AiDecisionTrace[],playerId:Side):number|null{const left=learned.filter(trace=>trace.playerId===playerId),right=ablated.filter(trace=>trace.playerId===playerId),count=Math.min(left.length,right.length);for(let index=0;index<count;index+=1)if(left[index].turn!==right[index].turn||left[index].selected!==right[index].selected)return left[index].decisionOrdinal??index+1;return left.length===right.length?null:left[count]?.decisionOrdinal??right[count]?.decisionOrdinal??count+1;}
function outcome(result:BattleResult){return{winner:result.winner,turns:result.turns,ended:result.ended,timeout:result.timeout,stalled:result.stalled,errors:[...result.errors]};}
function roundRobin(values:Candidate[]):Candidate[]{const groups=new Map<string,Candidate[]>();for(const value of values)groups.set(value.seed,[...(groups.get(value.seed)??[]),value]);const result:Candidate[]=[];for(let index=0;;index+=1){let added=false;for(const seed of [...groups.keys()].sort()){const value=groups.get(seed)?.[index];if(value){result.push(value);added=true;}}if(!added)return result;}}
function terminal(value:string):boolean{return["supported","harmful-review","no-observed-outcome-effect","no-clear-benefit","blocked"].includes(value);}
function readEvidence<T>(directory:string,name:string):T{const plain=path.join(directory,name),compressed=`${plain}.gz`;if(fs.existsSync(plain))return read<T>(plain);if(fs.existsSync(compressed))return JSON.parse(zlib.gunzipSync(fs.readFileSync(compressed)).toString("utf8")) as T;throw new Error(`Missing retained evidence: ${plain}[.gz]`);}
function hasEvidence(directory:string,name:string):boolean{return fs.existsSync(path.join(directory,name))||fs.existsSync(path.join(directory,`${name}.gz`));}
function findNamed(directory:string,name:string):string[]{if(!fs.existsSync(directory))return[];const files:string[]=[];for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const target=path.join(directory,entry.name);if(entry.isDirectory())files.push(...findNamed(target,name));else if(entry.name===name)files.push(target);}return files;}
function seasonFromPath(value:string):number|null{const match=value.match(/(?:^|\/)season-(\d+)(?:\/|$)/);return match?Number(match[1]):null;}
function digest(value:string):string{return crypto.createHash("sha256").update(value).digest("hex").slice(0,20);}
function withoutLegacySampleCap(value:Omit<Manifest["config"],"maximumConfidence"|"shadowPolicy">&{maximumConfidence?:number;maximumSamples?:number;shadowPolicy?:string}):Manifest["config"]{const copy={...value,maximumConfidence:value.maximumConfidence??1,shadowPolicy:value.shadowPolicy??""};delete copy.maximumSamples;return copy;}
function stableJson(value:Record<string,unknown>):string{return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left],[right])=>left.localeCompare(right))));}
function save():void{write(manifestFile,manifest);}
function directorySize(directory:string):number{if(!fs.existsSync(directory))return 0;let total=0;for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const target=path.join(directory,entry.name);total+=entry.isDirectory()?directorySize(target):fs.statSync(target).size;}return total;}
function freeBytes(directory:string):number{const stats=fs.statfsSync(directory);return Number(stats.bavail)*Number(stats.bsize);}
function write(file:string,value:unknown):void{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,`${JSON.stringify(value,null,2)}\n`,"utf8");}
function read<T>(file:string):T{return JSON.parse(fs.readFileSync(file,"utf8")) as T;}
function option(name:string,fallback:string):string{const index=args.indexOf(name);return index>=0?args[index+1]??fallback:fallback;}
function integerOption(name:string,fallback:number,min:number,max:number):number{const value=Number(option(name,String(fallback)));if(!Number.isInteger(value)||value<min||value>max)throw new Error(`${name} must be ${min}..${max}`);return value;}
function numberOption(name:string,fallback:number,min:number,max:number):number{const value=Number(option(name,String(fallback)));if(!Number.isFinite(value)||value<min||value>max)throw new Error(`${name} must be ${min}..${max}`);return value;}
function round(value:number):number{return Math.round((value+Number.EPSILON)*1e6)/1e6;}

main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
