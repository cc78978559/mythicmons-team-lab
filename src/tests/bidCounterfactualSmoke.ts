import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {evaluateWhiteBoxBidApproval} from "../ai/whiteBox/bidApproval";
import type {WhiteBoxBidTrace} from "../ai/whiteBox/auction";
import {evaluatePortfolioBidCounterfactual,loadPortfolioBidReplayCapsule,precheckPortfolioBids} from "../ai/whiteBox/portfolioBidCounterfactual";
import {buildUnifiedEvidencePlan} from "../ai/whiteBox/unifiedEvidence";

const root=process.cwd(),directory=fs.mkdtempSync(path.join(os.tmpdir(),"bid-counterfactual-")),source=path.join(directory,"source"),out=path.join(directory,"result");
try{
  run(path.join(root,"src","cli","draftLeagueV12.ts"),[],{V12_OUT:source,V12_SEED:"bid-counterfactual-smoke",V12_SEASONS:"1",V12_MANAGER_LIMIT:"6",V12_PAIRS:"1",V12_POOL_SIZE:"100",V12_AUCTION_LOTS:"10",V12_REGULAR_ROUNDS:"1",V12_MAX_TURNS:"60",V12_MIN_ROSTER:"6",V12_MAX_ROSTER:"8",V12_AUCTION_MODE:"sequential",V12_EVIDENCE_RETENTION:"compact",V12_EVIDENCE_SAMPLE_RATE:"0"});
  const records=read<any>(path.join(source,"season-01","decision-ledger.json")).records??[];
  let selected:{managerId:string;decisionId:string;approval:ReturnType<typeof evaluateWhiteBoxBidApproval>}|null=null;
  for(const record of records.filter((entry:any)=>entry.stage==="auction")){
    const bids=record.context?.bids??[],winner=[...bids].filter((entry:any)=>entry.bid>0).sort((left:any,right:any)=>right.bid-left.bid)[0]??null;
    for(const bid of bids){const trace=bid.whiteBox as WhiteBoxBidTrace|undefined;if(trace?.version!=="white-box-bid-v1")continue;const highestCompetingBid=Math.max(0,...bids.filter((entry:any)=>entry.manager!==bid.manager).map((entry:any)=>Number(entry.bid)||0)),approval=evaluateWhiteBoxBidApproval({auctionMode:"sequential",bidderId:bid.manager,incumbentWinnerId:winner?.manager??null,highestCompetingBid,trace});if(approval.recommended){selected={managerId:bid.manager,decisionId:trace.decisionId,approval};break;}}
    if(selected)break;
  }
  assert(selected,"deterministic smoke source must contain an admitted bid");
  run(path.join(root,"src","cli","counterfactualWhiteBoxBid.ts"),["--source",source,"--out",out,"--decision-id",selected.decisionId,"--manager",selected.managerId,"--season","1","--followup-seasons","0"],{});
  const summary=read<any>(path.join(out,"counterfactual-summary.json"));
  assert.equal(summary.sourceTraceVerified,true);assert.equal(summary.prefixVerified,true);assert.equal(summary.auctionPrefixVerified,true);assert.equal(summary.policy,"unshaded-ceiling-experiment");
  assert.equal(summary.intervention.incumbentBid,selected.approval.incumbentBid);assert.equal(summary.intervention.candidateBid,selected.approval.candidateBid);assert(summary.displacedManagerId);
  const experimentRecords=read<any>(path.join(out,"experiment","season-01","decision-ledger.json")).records??[],experiments=experimentRecords.flatMap((record:any)=>(record.context?.bids??[]).map((bid:any)=>bid.bidExperiment).filter(Boolean));
  assert.equal(experiments.length,1,"exactly one bid may change in the experiment branch");
  const portfolioSource=path.join(directory,"portfolio-source"),portfolioOut=path.join(directory,"portfolio-result"),screenOut=path.join(directory,"portfolio-screen");
  run(path.join(root,"src","cli","draftLeagueV12.ts"),[],{V12_OUT:portfolioSource,V12_SEED:"portfolio-bid-smoke",V12_SEASONS:"1",V12_MANAGER_LIMIT:"6",V12_PAIRS:"1",V12_POOL_SIZE:"100",V12_AUCTION_LOTS:"10",V12_REGULAR_ROUNDS:"1",V12_MAX_TURNS:"60",V12_MIN_ROSTER:"6",V12_MAX_ROSTER:"8",V12_AUCTION_MODE:"portfolio",V12_EVIDENCE_RETENTION:"compact",V12_EVIDENCE_SAMPLE_RATE:"0"});
  const capsule=loadPortfolioBidReplayCapsule(portfolioSource,1);assert.equal(capsule.assetIds.length,10);assert.equal(capsule.limits.length,6);
  const prechecks=precheckPortfolioBids(capsule).filter(entry=>entry.status==="screenable");assert(prechecks.length,"portfolio source must retain screenable shaded bids");
  const portfolioSelected=prechecks.map(entry=>evaluatePortfolioBidCounterfactual(capsule,entry.decisionId)).find(entry=>entry.status==="executable");assert(portfolioSelected,"portfolio source must contain an allocation-changing bid");assert(portfolioSelected.changes.length);assert(portfolioSelected.affectedManagerIds.length);
  run(path.join(root,"src","cli","screenPortfolioBids.ts"),["--source",portfolioSource,"--out",screenOut,"--max-candidates","2"],{});const screen=read<any>(path.join(screenOut,"portfolio-bid-screen.json"));assert.equal(screen.sourceVerified,true);assert.equal(screen.evaluated,2);const portfolioPlan=buildUnifiedEvidencePlan([portfolioSource],{portfolioBidScreens:[screenOut]});assert(portfolioPlan.cases.some(entry=>entry.domain==="auction"&&entry.status==="executable"&&entry.runner==="bid"));
  run(path.join(root,"src","cli","counterfactualWhiteBoxBid.ts"),["--source",portfolioSource,"--out",portfolioOut,"--decision-id",portfolioSelected.decisionId,"--manager",portfolioSelected.managerId,"--season","1","--followup-seasons","0"],{});
  const portfolioSummary=read<any>(path.join(portfolioOut,"counterfactual-summary.json"));assert.equal(portfolioSummary.auctionMode,"portfolio");assert.equal(portfolioSummary.auctionPrefixVerified,true);assert.equal(portfolioSummary.approval.status,"executable");assert(portfolioSummary.approval.changes.length);assert.deepEqual(portfolioSummary.affectedManagerIds,portfolioSelected.affectedManagerIds);
  const portfolioRecords=read<any>(path.join(portfolioOut,"experiment","season-01","decision-ledger.json")).records??[],portfolioExperiments=portfolioRecords.flatMap((record:any)=>(record.context?.bids??[]).map((bid:any)=>bid.bidExperiment).filter(Boolean));assert.equal(portfolioExperiments.length,1,"portfolio branch must change exactly one submitted bid");
  fs.rmSync(path.join(portfolioOut,"counterfactual-summary.json"));fs.rmSync(path.join(portfolioOut,"counterfactual-report.md"));
  run(path.join(root,"src","cli","counterfactualWhiteBoxBid.ts"),["--source",portfolioSource,"--out",portfolioOut,"--decision-id",portfolioSelected.decisionId,"--manager",portfolioSelected.managerId,"--season","1","--followup-seasons","0","--resume"],{});
  assert.equal(read<any>(path.join(portfolioOut,"counterfactual-summary.json")).prefixVerified,true,"completed portfolio branches must resume into a verified summary");
  const transitioned=read<any>(path.join(portfolioSource,"dynasty-state.json"));transitioned.decisionRecords.push({decision:"显式采用联盟代码升级",context:{}},{decision:"启动王朝第1季",context:{season:1}});fs.writeFileSync(path.join(portfolioSource,"dynasty-state.json"),JSON.stringify(transitioned));
  const transitionedPlan=buildUnifiedEvidencePlan([portfolioSource],{portfolioBidScreens:[screenOut]}),transitionedBids=transitionedPlan.cases.filter(entry=>entry.domain==="auction"&&entry.reasons.includes("historical-runtime-transition-checkpoint-required"));assert(transitionedBids.length);assert(transitionedBids.every(entry=>entry.status!=="executable"));
}finally{fs.rmSync(directory,{recursive:true,force:true});}
console.log("White-box bid counterfactual smoke test passed");

function run(script:string,args:string[],extraEnv:Record<string,string>):void{const result=spawnSync(process.execPath,[require.resolve("tsx/cli"),script,...args],{cwd:root,env:{...process.env,...extraEnv},encoding:"utf8",maxBuffer:64*1024*1024});if(result.status!==0)throw new Error(result.stderr||result.stdout||`Command failed: ${script}`);}
function read<T>(file:string):T{return JSON.parse(fs.readFileSync(file,"utf8")) as T;}
