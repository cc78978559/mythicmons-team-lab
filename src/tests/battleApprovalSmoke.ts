import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildBattleAssistApproval,loadBattleAssistApproval} from "../ai/whiteBox/battleApproval";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"battle-approval-"));
try{
  const hypothesis="1234567890abcdef1234",scope="abcdefabcdefabcdefabcdef",aggregates=path.join(root,"aggregates");fs.mkdirSync(aggregates,{recursive:true});
  fs.writeFileSync(path.join(root,"evidence-manifest.json"),JSON.stringify({plan:{cases:[{id:hypothesis,domain:"battle",battleScopeId:scope}]}}));
  fs.writeFileSync(path.join(aggregates,`${hypothesis}.json`),JSON.stringify({hypothesisId:hypothesis,domain:"battle",activationEligible:true,conclusion:"candidate-for-activation-review",battleBatch:{promotion:"candidate-for-assist"}}));
  const approval=buildBattleAssistApproval(root),file=path.join(root,"approval.json");fs.writeFileSync(file,JSON.stringify(approval));assert.equal(loadBattleAssistApproval(file).payload.scopes[0].scopeId,scope);
  const sampler=path.join(root,"sampler");fs.mkdirSync(sampler);fs.writeFileSync(path.join(sampler,"battle-sampler-manifest.json"),JSON.stringify({hypothesis:{id:hypothesis,scopeId:scope}}));fs.writeFileSync(path.join(sampler,"battle-sampler-aggregate.json"),JSON.stringify({hypothesisId:hypothesis,domain:"battle",activationEligible:true,conclusion:"candidate-for-activation-review",battleBatch:{promotion:"candidate-for-assist"}}));assert.equal(buildBattleAssistApproval(sampler).payload.scopes[0].scopeId,scope);
  const corrupt=JSON.parse(fs.readFileSync(file,"utf8"));corrupt.payload.scopes[0].scopeId="000000000000000000000000";fs.writeFileSync(file,JSON.stringify(corrupt));assert.throws(()=>loadBattleAssistApproval(file),/Invalid battle assist approval/);
  fs.writeFileSync(path.join(aggregates,`${hypothesis}.json`),JSON.stringify({hypothesisId:hypothesis,domain:"battle",activationEligible:false,conclusion:"continue-sampling",battleBatch:{promotion:"insufficient-evidence"}}));assert.throws(()=>buildBattleAssistApproval(root),/no activation-eligible battle scope/);
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log("Battle assist approval smoke test passed");
