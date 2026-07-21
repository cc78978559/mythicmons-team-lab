import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {solvePortfolioAuction, type PortfolioAward, type PortfolioBid, type PortfolioManagerLimit} from "../../draft/portfolioAuction";
import type {WhiteBoxBidTrace} from "./auction";
import {WHITE_BOX_BID_COUNTERFACTUAL_POLICY} from "./bidApproval";

export interface PortfolioBidReplayBid extends PortfolioBid {whiteBox:WhiteBoxBidTrace}
export interface PortfolioBidReplayCapsule {schemaVersion:1;root:string;season:number;seed:string;assetIds:string[];bids:PortfolioBidReplayBid[];limits:PortfolioManagerLimit[];managerNames:Record<string,string>;awards:PortfolioAward[];sourceHash:string}
export interface PortfolioAwardChange {assetId:string;before:PortfolioAward|null;after:PortfolioAward|null}
export interface PortfolioBidCounterfactual {policy:typeof WHITE_BOX_BID_COUNTERFACTUAL_POLICY;decisionId:string;managerId:string;incumbentBid:number;candidateBid:number;status:"executable"|"archive-only";reasons:string[];changes:PortfolioAwardChange[];affectedManagerIds:string[];candidateAwards:PortfolioAward[]|null}
export interface PortfolioBidPrecheck {decisionId:string;managerId:string;incumbentBid:number;candidateBid:number;status:"screenable"|"archive-only";reasons:string[];priority:number}

export function loadPortfolioBidReplayCapsule(rootInput:string,season:number):PortfolioBidReplayCapsule{
  const root=path.resolve(rootInput),seasonDir=path.join(root,`season-${String(season).padStart(2,"0")}`),state=read<any>(path.join(root,"dynasty-state.json"));
  if((state.settings?.auctionMode??"sequential")!=="portfolio")throw new Error("Source dynasty does not use portfolio auctions");
  const records=(read<any>(path.join(seasonDir,"decision-ledger.json")).records??[]).filter((record:any)=>record.stage==="auction"&&record.context?.mode==="portfolio");
  if(!records.length)throw new Error(`Season ${season} retains no portfolio-auction records`);
  const budgets=read<any>(path.join(seasonDir,"starting-budgets.json")).managers??{},keepers=read<any>(path.join(seasonDir,"keepers.json")).managers??{},profiles=read<any>(path.join(seasonDir,"manager-profiles.json")).managers??[];
  const managerNames=Object.fromEntries(profiles.map((profile:any)=>[String(profile.id),String(profile.name)]));
  const assetIds:string[]=[],bids:PortfolioBidReplayBid[]=[];
  for(const record of records){const retained=record.context?.bids??[],assetId=String(retained[0]?.assetId??"");if(!assetId)throw new Error("Portfolio record is missing its solver asset id");if(assetIds.includes(assetId))throw new Error(`Duplicate portfolio asset ${assetId}`);assetIds.push(assetId);for(const bid of retained){if(bid.whiteBox?.version!=="white-box-bid-v1"||bid.whiteBox.decisionId!==`bid:${season}:${record.context.lot}:${bid.managerId}:${bid.assetId}`)throw new Error(`Invalid retained portfolio bid for ${bid.managerId}:${bid.assetId}`);bids.push({managerId:String(bid.managerId),assetId:String(bid.assetId),bid:Number(bid.bid),utility:Number(bid.utility),whiteBox:bid.whiteBox});}}
  const minRoster=Number(state.settings?.minRoster??6),maxRoster=Number(state.settings?.maxRoster??10),managerIds=Object.keys(budgets).sort();
  const limits:PortfolioManagerLimit[]=managerIds.map(managerId=>({managerId,budget:Number(budgets[managerId]),reserve:Math.max(0,minRoster-(keepers[managerId]?.length??0)),maxWins:Math.max(0,maxRoster-(keepers[managerId]?.length??0))}));
  if(limits.some(limit=>!Number.isFinite(limit.budget)||limit.budget<0))throw new Error("Invalid retained portfolio manager limits");
  const seed=`${state.seed}:season:${season}:portfolio:${season}`,awards=solvePortfolioAuction(assetIds,bids,limits,seed);
  verifySourceAwards(records,awards,managerNames);
  const sourceHash=digest({season,seed,assetIds,bids:bids.map(({whiteBox,...bid})=>({...bid,decisionId:whiteBox.decisionId,ceiling:whiteBox.ceiling})),limits,awards});
  return{schemaVersion:1,root,season,seed,assetIds,bids,limits,managerNames,awards,sourceHash};
}

export function evaluatePortfolioBidCounterfactual(capsule:PortfolioBidReplayCapsule,decisionId:string):PortfolioBidCounterfactual{
  const matches=capsule.bids.filter(bid=>bid.whiteBox.decisionId===decisionId);if(matches.length!==1)throw new Error(`Expected one portfolio bid ${decisionId}; found ${matches.length}`);const target=matches[0],trace=target.whiteBox,reasons:string[]=[];
  const precheck=precheckPortfolioBid(capsule,target);if(precheck.status==="archive-only")return result(target,precheck.reasons,[],null);
  const candidateBids=capsule.bids.map(bid=>bid===target?{...bid,bid:trace.ceiling}:bid),candidateAwards=solvePortfolioAuction(capsule.assetIds,candidateBids,capsule.limits,capsule.seed),changes=awardChanges(capsule.awards,candidateAwards);
  if(!changes.length)return result(target,["portfolio-allocation-unchanged"],[],candidateAwards);
  return result(target,[],changes,candidateAwards);
}

export function precheckPortfolioBids(capsule:PortfolioBidReplayCapsule):PortfolioBidPrecheck[]{return capsule.bids.map(target=>precheckPortfolioBid(capsule,target)).sort((left,right)=>right.priority-left.priority||left.decisionId.localeCompare(right.decisionId));}

function precheckPortfolioBid(capsule:PortfolioBidReplayCapsule,target:PortfolioBidReplayBid):PortfolioBidPrecheck{const trace=target.whiteBox,reasons:string[]=[];
  if(trace.hardRejections.length)reasons.push("hard-rejection-present");if(trace.shade<=0||trace.ceiling<=trace.bid)reasons.push("no-removable-bid-shade");if(trace.ceiling>trace.availableBudget)reasons.push("ceiling-exceeds-available-budget");
  const sourceAward=capsule.awards.find(award=>award.assetId===target.assetId)??null;
  if(!reasons.length&&sourceAward?.managerId===target.managerId&&sourceAward.payment<trace.bid)reasons.push("incumbent-award-and-payment-unchanged");
  if(!reasons.length&&sourceAward?.managerId!==target.managerId){
    if(trace.ceiling<=(sourceAward?.bid??0))reasons.push("candidate-does-not-strictly-beat-source-award");
    const limit=capsule.limits.find(entry=>entry.managerId===target.managerId),managerAwards=capsule.awards.filter(award=>award.managerId===target.managerId),spent=managerAwards.reduce((sum,award)=>sum+award.payment,0),runnerUp=Math.max(0,...capsule.bids.filter(bid=>bid.assetId===target.assetId&&bid.managerId!==target.managerId).map(bid=>bid.bid)),candidatePayment=Math.min(trace.ceiling,Math.max(1,runnerUp+1));
    if(!limit)reasons.push("missing-manager-limit");else if(managerAwards.length>=limit.maxWins)reasons.push("source-manager-at-win-limit");else if(spent+candidatePayment>limit.budget-limit.reserve)reasons.push("source-manager-lacks-direct-budget");
  }
  const gap=sourceAward?trace.ceiling-sourceAward.bid:trace.ceiling,priority=Math.max(0,gap)*10+trace.shade+target.utility;
  return{decisionId:trace.decisionId,managerId:target.managerId,incumbentBid:trace.bid,candidateBid:trace.ceiling,status:reasons.length?"archive-only":"screenable",reasons,priority};
}

export function portfolioAwardSignature(awards:readonly PortfolioAward[]):string{return digest([...awards].sort((left,right)=>left.assetId.localeCompare(right.assetId)).map(award=>({assetId:award.assetId,managerId:award.managerId,bid:award.bid,payment:award.payment,utility:award.utility,runnerUpBid:award.runnerUpBid})));}

function result(target:PortfolioBidReplayBid,reasons:string[],changes:PortfolioAwardChange[],candidateAwards:PortfolioAward[]|null):PortfolioBidCounterfactual{const affected=new Set<string>();for(const change of changes){if(change.before)affected.add(change.before.managerId);if(change.after)affected.add(change.after.managerId);}affected.add(target.managerId);return{policy:WHITE_BOX_BID_COUNTERFACTUAL_POLICY,decisionId:target.whiteBox.decisionId,managerId:target.managerId,incumbentBid:target.bid,candidateBid:target.whiteBox.ceiling,status:reasons.length?"archive-only":"executable",reasons,changes,affectedManagerIds:[...affected].sort(),candidateAwards};}
function awardChanges(before:readonly PortfolioAward[],after:readonly PortfolioAward[]):PortfolioAwardChange[]{const left=new Map(before.map(award=>[award.assetId,award])),right=new Map(after.map(award=>[award.assetId,award])),changes:PortfolioAwardChange[]=[];for(const assetId of new Set([...left.keys(),...right.keys()])){const a=left.get(assetId)??null,b=right.get(assetId)??null;if(JSON.stringify(a)!==JSON.stringify(b))changes.push({assetId,before:a,after:b});}return changes.sort((a,b)=>a.assetId.localeCompare(b.assetId));}
function verifySourceAwards(records:any[],awards:PortfolioAward[],managerNames:Record<string,string>):void{const byAsset=new Map(awards.map(award=>[award.assetId,award]));for(const record of records){const assetId=String(record.context?.bids?.[0]?.assetId??""),award=byAsset.get(assetId)??null,winningBid=Number(record.context?.winningBid??0),payment=Number(record.context?.criticalBidPrice??0),runner=Number(record.context?.runnerUpBid??0);if(!award){if(winningBid||payment||runner)throw new Error(`Retained portfolio result drift for unawarded ${assetId}`);continue;}if(award.bid!==winningBid||award.payment!==payment||award.runnerUpBid!==runner)throw new Error(`Retained portfolio numeric result drift for ${assetId}`);const name=managerNames[award.managerId];if(!name||record.selected!==`${name} ${award.payment}`)throw new Error(`Retained portfolio winner drift for ${assetId}`);}}
function digest(value:unknown):string{return crypto.createHash("sha256").update(stable(value)).digest("hex");}function stable(value:any):string{if(Array.isArray(value))return`[${value.map(stable).join(",")}]`;if(value&&typeof value==="object")return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;return JSON.stringify(value);}
function read<T>(file:string):T{if(!fs.existsSync(file))throw new Error(`Missing portfolio replay input: ${file}`);return JSON.parse(fs.readFileSync(file,"utf8")) as T;}
