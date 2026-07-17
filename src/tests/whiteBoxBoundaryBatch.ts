import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {evaluateWhiteBoxDecision,type WhiteBoxCandidate} from "../ai/whiteBox/decision";
import {ALL_WHITE_BOX_PARAMETER_REGISTRIES} from "../ai/whiteBox/parameters";
import {buildWhiteBoxReleaseArtifacts,resolveWhiteBoxRelease,writeWhiteBoxRelease} from "../ai/whiteBox/release";
import {activateWhiteBoxRelease,readWhiteBoxReleaseRegistry,registerWhiteBoxRelease,rejectWhiteBoxRelease,rollbackWhiteBoxRelease,verifyWhiteBoxReleaseRegistry} from "../ai/whiteBox/releaseRegistry";

const args=process.argv.slice(2),started=Date.now(),temporaryRoot=fs.mkdtempSync(path.join(os.tmpdir(),"whitebox-boundary-batch-"));let parameterDefinitions=0,parameterCases=0,decisionCases=0,invalidDecisionCases=0,registryFaults=0;
try{
  for(const registry of Object.values(ALL_WHITE_BOX_PARAMETER_REGISTRIES))for(const definition of registry.allDefinitions()){
    parameterDefinitions+=1;for(const value of [definition.minimum,definition.defaultValue,definition.maximum,...samples(definition.minimum,definition.maximum,64)]){assert.equal(registry.snapshot({[definition.id]:value}).values[definition.id],value);parameterCases+=1;}
    const delta=Math.max(1,Math.abs(definition.maximum-definition.minimum))*.000001;for(const value of [definition.minimum-delta,definition.maximum+delta,Number.NaN,Number.POSITIVE_INFINITY,Number.NEGATIVE_INFINITY]){assert.throws(()=>registry.snapshot({[definition.id]:value}),/must be within/);parameterCases+=1;}
  }
  for(const registry of Object.values(ALL_WHITE_BOX_PARAMETER_REGISTRIES)){assert.throws(()=>registry.snapshot({"unknown.parameter":0}),/Unknown/);parameterCases+=1;}

  const random=lcg(0x5eed1234);for(let index=0;index<5000;index+=1){const candidates:WhiteBoxCandidate[]=Array.from({length:4},(_,candidate)=>({id:`candidate-${candidate}`,hardRejections:candidate===3?["illegal"]:[],rational:[contribution(`r-${candidate}`,between(random,-100,100),"rational")],style:[contribution(`s-${candidate}`,between(random,-1000,1000),"style")]}));const input={decisionId:`boundary-${index}`,reasonableBand:between(random,0,50),styleContributionLimit:between(random,0,30),candidates},trace=evaluateWhiteBoxDecision(input);assert.deepEqual(trace,evaluateWhiteBoxDecision(input));assert.notEqual(trace.selected,"candidate-3");for(const candidate of trace.candidates){for(const value of [candidate.rationalScore,candidate.rawStyleScore,candidate.appliedStyleScore,candidate.finalScore])assert(value===null||Number.isFinite(value));if(candidate.appliedStyleScore!==null)assert(Math.abs(candidate.appliedStyleScore)<=input.styleContributionLimit+.000001);}decisionCases+=1;}
  for(const value of [Number.NaN,Number.POSITIVE_INFINITY,Number.NEGATIVE_INFINITY]){assert.throws(()=>evaluateWhiteBoxDecision({decisionId:"invalid-band",reasonableBand:value,styleContributionLimit:1,candidates:[]}));assert.throws(()=>evaluateWhiteBoxDecision({decisionId:"invalid-style",reasonableBand:1,styleContributionLimit:value,candidates:[]}));assert.throws(()=>evaluateWhiteBoxDecision({decisionId:"invalid-contribution",reasonableBand:1,styleContributionLimit:1,candidates:[{id:"x",rational:[contribution("bad",value,"rational")]}]}));invalidDecisionCases+=3;}

  const releaseA=makeRelease(temporaryRoot,"a",.4),releaseB=makeRelease(temporaryRoot,"b",.5),releaseC=makeRelease(temporaryRoot,"c",.6),clean=path.join(temporaryRoot,"registry");const a=registerWhiteBoxRelease(clean,releaseA).manifest.releaseId,b=registerWhiteBoxRelease(clean,releaseB).manifest.releaseId,c=registerWhiteBoxRelease(clean,releaseC).manifest.releaseId;activateWhiteBoxRelease(clean,a);assert.throws(()=>rollbackWhiteBoxRelease(clean),/No previous/);registryFaults+=1;activateWhiteBoxRelease(clean,b);activateWhiteBoxRelease(clean,c);rejectWhiteBoxRelease(clean,b,"fault injection rejection");assert.equal(rollbackWhiteBoxRelease(clean).entries.find(entry=>entry.status==="active")?.releaseId,a);verifyWhiteBoxReleaseRegistry(clean);
  registryFaults+=fault(clean,"payload-corruption",root=>fs.appendFileSync(path.join(resolveWhiteBoxRelease(root),"README.md"),"corrupt"),/integrity failure/);
  registryFaults+=fault(clean,"unexpected-file",root=>fs.writeFileSync(path.join(resolveWhiteBoxRelease(root),"unexpected.txt"),"x"),/unexpected files/);
  registryFaults+=fault(clean,"pointer-escape",root=>write(path.join(root,"active.json"),{schemaVersion:1,releaseId:a,relativePath:"../escape"}),/escapes registry root/);
  registryFaults+=fault(clean,"pointer-mismatch",root=>write(path.join(root,"active.json"),{schemaVersion:1,releaseId:c,relativePath:`releases/${a}`}),/pointer id mismatch/);
  registryFaults+=fault(clean,"multiple-active",root=>mutateRegistry(root,value=>{value.entries[1].status="active";}),/multiple active/);
  registryFaults+=fault(clean,"invalid-status",root=>mutateRegistry(root,value=>{value.entries[0].status="unknown";}),/Invalid.*entry/);
  registryFaults+=fault(clean,"duplicate-id",root=>mutateRegistry(root,value=>{value.entries[1].releaseId=value.entries[0].releaseId;}),/Duplicate.*entry/);
  registryFaults+=fault(clean,"history-sequence",root=>mutateRegistry(root,value=>{value.activationHistory[0].sequence=99;}),/activation history/);
  const out=path.resolve(option("--out","output/whitebox-boundary-batch-01"));fs.mkdirSync(out,{recursive:true});const summary={status:"boundary-stable",parameterDefinitions,parameterCases,decisionCases,invalidDecisionCases,registryFaults,durationMs:Date.now()-started};fs.writeFileSync(path.join(out,"summary.json"),`${JSON.stringify(summary,null,2)}\n`,"utf8");console.log(JSON.stringify({...summary,summary:path.join(out,"summary.json")},null,2));
}finally{fs.rmSync(temporaryRoot,{recursive:true,force:true});}

function samples(minimum:number,maximum:number,count:number):number[]{if(minimum===maximum)return Array(count).fill(minimum);return Array.from({length:count},(_,index)=>minimum+(maximum-minimum)*(index+1)/(count+1));}
function contribution(id:string,value:number,group:string){return{id,group,source:"competence" as const,value,reason:id};}
function lcg(seed:number):()=>number{let state=seed>>>0;return()=>((state=Math.imul(1664525,state)+1013904223>>>0)/0x100000000);}
function between(random:()=>number,minimum:number,maximum:number):number{return minimum+(maximum-minimum)*random();}
function makeRelease(root:string,name:string,risk:number):string{const out=path.join(root,`release-${name}`),profile={id:"m1",traits:{risk},tacticalMemory:{opponents:{}},strategyProgram:{version:1}},state={version:12,seed:`boundary-${name}`,completedSeason:1,settings:{},fingerprint:{codeHash:"code"},registry:{schemaVersion:1,revision:"r1",hash:"registry",namespace:"test"},evolutionArchive:[],managers:[{id:"m1",name:"Manager",baseProfile:profile,currentProfile:profile,lineage:{lineageId:name},lineageHistory:[{lineageId:name}],contracts:[],cash:0,titles:0,totalPoints:0,seasons:[]}]},audit={promotion:"shadow-stable",coverage:1,fatalCount:0,warningCount:0,expectedTraces:1,auditedTraces:1,metrics:{}},review={comparisons:0,agreements:0,cases:[],metrics:{experimentEligible:0,experimentIneligible:0,byDomain:{},byClassification:{}}};writeWhiteBoxRelease(out,buildWhiteBoxReleaseArtifacts(state,audit,review));return out;}
function fault(source:string,name:string,mutate:(root:string)=>void,expected:RegExp):number{const root=path.join(temporaryRoot,`fault-${name}`);fs.cpSync(source,root,{recursive:true});mutate(root);assert.throws(()=>verifyWhiteBoxReleaseRegistry(root),expected);return 1;}
function mutateRegistry(root:string,mutate:(value:any)=>void):void{const file=path.join(root,"registry.json"),value=JSON.parse(fs.readFileSync(file,"utf8"));mutate(value);write(file,value);}
function write(file:string,value:any):void{fs.writeFileSync(file,`${JSON.stringify(value,null,2)}\n`,"utf8");}
function option(name:string,fallback:string):string{const index=args.indexOf(name);return index>=0?args[index+1]??fallback:fallback;}
