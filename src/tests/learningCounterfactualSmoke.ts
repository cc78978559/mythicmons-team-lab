import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {loadDynastyState} from "../draft/dynastyStateStore";

const root=process.cwd(),temporary=fs.mkdtempSync(path.join(os.tmpdir(),"learning-counterfactual-")),source=path.join(temporary,"source"),out=path.join(temporary,"experiment");
try{
  const env={...process.env,V12_OUT:source,V12_SEASONS:"2",V12_MANAGER_LIMIT:"6",V12_PAIRS:"1",V12_POOL_SIZE:"100",V12_AUCTION_LOTS:"10",V12_REGULAR_ROUNDS:"1",V12_MAX_TURNS:"20",V12_MIN_ROSTER:"6",V12_MAX_ROSTER:"6",V12_SEED:"learning-counterfactual-smoke",V12_EVOLUTION_MODE:"punctuated",V12_EVOLUTION_POLICY:"shadow",V12_EVIDENCE_RETENTION:"compact",V12_EVIDENCE_SAMPLE_RATE:"0"};
  const league=spawnSync(process.execPath,[require.resolve("tsx/cli"),path.join(root,"src","cli","draftLeagueV12.ts")],{cwd:root,env,encoding:"utf8",maxBuffer:64*1024*1024});assert.equal(league.status,0,league.stderr||league.stdout);
  const replay=spawnSync(process.execPath,[require.resolve("tsx/cli"),path.join(root,"src","cli","counterfactualWhiteBoxLearning.ts"),"--source",source,"--out",out,"--manager","manager-01","--season","1","--followup-seasons","1"],{cwd:root,encoding:"utf8",maxBuffer:64*1024*1024});assert.equal(replay.status,0,replay.stderr||replay.stdout);
  const summary=read<any>(path.join(out,"counterfactual-summary.json"));assert.equal(summary.sourceTraceVerified,true);assert.equal(summary.prefixVerified,true);assert.equal(summary.intervention.policy,"no-learning-experiment");assert.equal(summary.comparison.interventionSeason,1);assert.equal(summary.comparison.finalSeason,2);
  const records=loadDynastyState<any>(path.join(out,"candidate","dynasty-state.json")).decisionRecords,experiment=records.find((record:any)=>record.context?.learningExperiment?.target==="manager-01@1");assert(experiment);assert.equal(experiment.context.learningPolicy,"no-learning-experiment");
  for(const trait of experiment.context.learningWhiteBoxTrace.traits){assert.equal(experiment.context.after[trait.trait],trait.rollback.trait);assert.deepEqual(experiment.context.development.strategies[trait.trait],trait.rollback.posterior);assert.equal(experiment.context.signals.find((signal:any)=>signal.trait===trait.trait).delta,0);}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
function read<T>(file:string):T{return JSON.parse(fs.readFileSync(file,"utf8")) as T;}
console.log("Learning isolated counterfactual smoke passed");
