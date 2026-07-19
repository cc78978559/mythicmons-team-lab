import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const root=process.cwd(),workspace=fs.mkdtempSync(path.join(os.tmpdir(),"mythic-program-decision-")),source=path.join(workspace,"source"),out=path.join(workspace,"experiment");
try{
  const baseline=spawn("src/cli/draftLeagueV12.ts",[],{V12_OUT:source,V12_SEASONS:"2",V12_MANAGER_LIMIT:"6",V12_PAIRS:"1",V12_POOL_SIZE:"100",V12_AUCTION_LOTS:"10",V12_REGULAR_ROUNDS:"1",V12_MAX_TURNS:"20",V12_MIN_ROSTER:"6",V12_MAX_ROSTER:"6",V12_SEED:"program-decision-smoke",V12_EVOLUTION_POLICY:"shadow",V12_EVIDENCE_RETENTION:"compact",V12_EVIDENCE_SAMPLE_RATE:"0"});
  assert.equal(baseline.status,0,baseline.stderr||baseline.stdout);
  const opportunities=read<any>(path.join(source,"season-01","program-opportunities.json")),manager=opportunities.managers.find((entry:any)=>entry.decisions?.some((decision:any)=>decision.entrypoint==="acquire"&&decision.selectedIds.length===1&&decision.candidates.length>1)),decision=manager?.decisions.find((entry:any)=>entry.entrypoint==="acquire"&&entry.selectedIds.length===1&&entry.candidates.length>1),candidate=decision?.candidates.find((entry:any)=>entry.id!==decision.selectedIds[0]);
  assert(manager&&decision&&candidate,"baseline must retain one eligible acquisition decision");
  const samplerArgs=["--inputs",source,"--out",out,"--run","--target-samples","1","--minimum-sources","1","--followup","0","--max-output-mb","10"],experiment=spawn("src/cli/sampleProgramDecisionLabels.ts",samplerArgs,{});
  assert.equal(experiment.status,0,experiment.stderr||experiment.stdout);
  const samplerSummary=read<any>(path.join(out,"sampler-summary.json")),archive=read<any>(path.join(out,"label-archive.json")),manifest=read<any>(path.join(out,"sampler-manifest.json")),summary=read<any>(path.join(manifest.runs[0].directory,"counterfactual-summary.json"));
  assert.equal(samplerSummary.complete,true);assert.equal(samplerSummary.labels,1);assert.equal(samplerSummary.sources,1);assert(samplerSummary.retentionRemovedMb>0);assert.equal(archive.metrics.labels,1);assert.equal(archive.labels[0].prefixVerified,true);assert.equal(summary.intervention.decisionId,archive.labels[0].decision.id);assert(["better","neutral","worse"].includes(archive.labels[0].direction));
  const resumed=spawn("src/cli/sampleProgramDecisionLabels.ts",samplerArgs,{});assert.equal(resumed.status,0,resumed.stderr||resumed.stdout);assert.equal(read<any>(path.join(out,"sampler-manifest.json")).runs.length,1,"resume must not repeat a completed source");
  const invalid=spawn("src/cli/counterfactualProgramDecision.ts",["--source",source,"--out",path.join(workspace,"invalid"),"--decision-id",decision.id,"--manager",manager.managerId,"--candidate",decision.selectedIds[0],"--season","1","--followup","0"],{});
  assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/already the incumbent/);
  console.log("Isolated program-decision counterfactual smoke passed");
}finally{fs.rmSync(workspace,{recursive:true,force:true});}

function spawn(file:string,parameters:string[],environment:Record<string,string>){return spawnSync(process.execPath,[require.resolve("tsx/cli"),path.join(root,file),...parameters],{cwd:root,env:{...process.env,...environment},encoding:"utf8",maxBuffer:64*1024*1024});}
function read<T>(file:string):T{return JSON.parse(fs.readFileSync(file,"utf8")) as T;}
