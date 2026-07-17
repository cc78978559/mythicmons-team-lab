import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {reviewWhiteBoxDifferences,whiteBoxDifferenceMarkdown} from "../ai/whiteBox/review";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"whitebox-review-"));
const candidate=(id:string,rational:number,style:number)=>({id,eligible:true,reasonable:true,hardRejections:[],rationalScore:rational,rawStyleScore:style,appliedStyleScore:style,finalScore:rational+style,contributions:[{id:"keeper.production",group:"production",source:"competence",value:rational,reason:"production"},{id:"keeper.salary",group:"risk",source:"risk",value:style,reason:"salary"}]});
fs.writeFileSync(path.join(root,"dynasty-state.json"),JSON.stringify({decisionRecords:[{id:"decision-1",actor:"manager-1",decision:"review",context:{keeperWhiteBoxShadow:{version:"white-box-decision-v1",decisionId:"keeper:manager-1:season-1",comparison:{incumbent:"a+b",shadow:"a",agrees:false},candidateCount:2,reasonableCount:2,hardRejectedCount:0,candidates:[candidate("a",3,1),candidate("a+b",3.2,.2)]}}}]}));
const review=reviewWhiteBoxDifferences(root),entry=review.cases[0];
assert.equal(review.cases.length,1);assert.equal(entry.classification,"reasonable-style-choice");assert.equal(entry.experimentGate,null);assert.deepEqual(entry.counterfactual.removed,["b"]);assert.equal(entry.counterfactual.finalDelta,.6);assert.match(whiteBoxDifferenceMarkdown(review),/白箱 AI 差异案例审查/);
fs.rmSync(root,{recursive:true,force:true});
console.log("White-box difference review smoke test passed");
