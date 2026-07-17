import fs from "node:fs";
import path from "node:path";
import {buildBattleAssistApproval,loadBattleAssistApproval} from "../ai/whiteBox/battleApproval";
const args=process.argv.slice(2),evidence=path.resolve(option("--evidence","")),out=path.resolve(option("--out","output/battle-assist-approval.json"));if(!evidence)throw new Error("--evidence is required");if(fs.existsSync(out))throw new Error(`Approval output already exists: ${out}`);const approval=buildBattleAssistApproval(evidence);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,`${JSON.stringify(approval,null,2)}\n`,"utf8");loadBattleAssistApproval(out);console.log(JSON.stringify({out,sha256:approval.sha256,aiVersion:approval.payload.aiVersion,scopes:approval.payload.scopes.length},null,2));
function option(name:string,fallback:string):string{const index=args.indexOf(name);return index>=0?args[index+1]??fallback:fallback;}
