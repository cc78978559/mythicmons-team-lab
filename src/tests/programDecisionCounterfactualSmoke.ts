import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const root=process.cwd(),workspace=fs.mkdtempSync(path.join(os.tmpdir(),"mythic-program-decision-")),source=path.join(workspace,"source"),out=path.join(workspace,"experiment");
try{
  const baseline=spawn("src/cli/draftLeagueV12.ts",[],{V12_OUT:source,V12_SEASONS:"1",V12_MANAGER_LIMIT:"6",V12_PAIRS:"1",V12_POOL_SIZE:"100",V12_AUCTION_LOTS:"10",V12_REGULAR_ROUNDS:"1",V12_MAX_TURNS:"20",V12_MIN_ROSTER:"6",V12_MAX_ROSTER:"6",V12_SEED:"program-decision-smoke",V12_EVOLUTION_POLICY:"shadow",V12_EVIDENCE_RETENTION:"compact",V12_EVIDENCE_SAMPLE_RATE:"0"});
  assert.equal(baseline.status,0,baseline.stderr||baseline.stdout);
  const opportunities=read<any>(path.join(source,"season-01","program-opportunities.json")),manager=opportunities.managers.find((entry:any)=>entry.decisions?.some((decision:any)=>decision.entrypoint==="acquire"&&decision.selectedIds.length===1&&decision.candidates.length>1)),decision=manager?.decisions.find((entry:any)=>entry.entrypoint==="acquire"&&entry.selectedIds.length===1&&entry.candidates.length>1),candidate=decision?.candidates.find((entry:any)=>entry.id!==decision.selectedIds[0]);
  assert(manager&&decision&&candidate,"baseline must retain one eligible acquisition decision");
  const experiment=spawn("src/cli/counterfactualProgramDecision.ts",["--source",source,"--out",out,"--decision-id",decision.id,"--manager",manager.managerId,"--candidate",candidate.id,"--season","1","--followup","0"],{});
  assert.equal(experiment.status,0,experiment.stderr||experiment.stdout);
  const summary=read<any>(path.join(out,"counterfactual-summary.json"));
  assert.equal(summary.schemaVersion,1);assert.equal(summary.prefixVerified,true);assert.equal(summary.decision.incumbent.id,decision.selectedIds[0]);assert.equal(summary.decision.candidate.id,candidate.id);assert.equal(summary.intervention.decisionId,decision.id);assert(["better","neutral","worse"].includes(summary.direction));
  const invalid=spawn("src/cli/counterfactualProgramDecision.ts",["--source",source,"--out",path.join(workspace,"invalid"),"--decision-id",decision.id,"--manager",manager.managerId,"--candidate",decision.selectedIds[0],"--season","1","--followup","0"],{});
  assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/already the incumbent/);
  console.log("Isolated program-decision counterfactual smoke passed");
}finally{fs.rmSync(workspace,{recursive:true,force:true});}

function spawn(file:string,parameters:string[],environment:Record<string,string>){return spawnSync(process.execPath,[require.resolve("tsx/cli"),path.join(root,file),...parameters],{cwd:root,env:{...process.env,...environment},encoding:"utf8",maxBuffer:64*1024*1024});}
function read<T>(file:string):T{return JSON.parse(fs.readFileSync(file,"utf8")) as T;}
