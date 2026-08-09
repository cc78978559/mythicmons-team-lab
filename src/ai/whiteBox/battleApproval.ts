import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {AI_VERSION} from "../../showdown/choice";
import {buildEvidenceEpoch} from "../../showdown/evidenceEpoch";

export interface BattleAssistApproval {schemaVersion:2;sha256:string;payload:{aiVersion:string;evidencePolicySha256:string;evidenceManifestSha256:string;scopes:Array<{scopeId:string;hypothesisId:string;aggregateSha256:string}>}}

export function buildBattleAssistApproval(evidenceDirectory:string):BattleAssistApproval{
  const unifiedManifest=path.join(evidenceDirectory,"evidence-manifest.json"),samplerManifest=path.join(evidenceDirectory,"battle-sampler-manifest.json"),manifestFile=fs.existsSync(unifiedManifest)?unifiedManifest:samplerManifest,manifest=read<any>(manifestFile),scopes:BattleAssistApproval["payload"]["scopes"]=[];
  const evidencePolicySha256=buildEvidenceEpoch(AI_VERSION,"gen9ou").policySha256;if(manifest.evidenceEpoch?.policySha256!==evidencePolicySha256||manifest.evidenceEpoch?.formalActivationAllowed!==true)throw new Error("Battle evidence is outside the current formal evidence epoch");
  if(fs.existsSync(unifiedManifest))for(const entry of manifest.plan?.cases??[]){if(entry.domain!=="battle"||!entry.battleScopeId)continue;const aggregateFile=path.join(evidenceDirectory,"aggregates",`${entry.id}.json`);appendEligible(scopes,entry.id,entry.battleScopeId,aggregateFile);}
  else appendEligible(scopes,String(manifest.hypothesis?.id??""),String(manifest.hypothesis?.scopeId??""),path.join(evidenceDirectory,"battle-sampler-aggregate.json"));
  const unique=[...new Map(scopes.sort((a,b)=>a.scopeId.localeCompare(b.scopeId)||a.hypothesisId.localeCompare(b.hypothesisId)).map(entry=>[entry.scopeId,entry])).values()];
  if(!unique.length)throw new Error("Evidence directory contains no activation-eligible battle scope");
  const payload={aiVersion:AI_VERSION,evidencePolicySha256,evidenceManifestSha256:fileDigest(manifestFile),scopes:unique};return{schemaVersion:2,sha256:digest(payload),payload};
}
function appendEligible(scopes:BattleAssistApproval["payload"]["scopes"],hypothesisId:string,scopeId:string,aggregateFile:string):void{if(!hypothesisId||!/^[a-f0-9]{24}$/.test(scopeId)||!fs.existsSync(aggregateFile))return;const aggregate=read<any>(aggregateFile);if(aggregate.hypothesisId!==hypothesisId||aggregate.domain!=="battle"||aggregate.activationEligible!==true||aggregate.conclusion!=="candidate-for-activation-review"||aggregate.battleBatch?.promotion!=="candidate-for-assist")return;scopes.push({scopeId,hypothesisId,aggregateSha256:fileDigest(aggregateFile)});}
export function loadBattleAssistApproval(file:string):BattleAssistApproval{const value=read<BattleAssistApproval>(file);if(value.schemaVersion!==2||!/^[a-f0-9]{64}$/.test(value.sha256??"")||value.sha256!==digest(value.payload))throw new Error(`Invalid battle assist approval: ${file}`);if(value.payload.aiVersion!==AI_VERSION)throw new Error(`Battle assist approval AI version ${value.payload.aiVersion} differs from ${AI_VERSION}`);if(value.payload.evidencePolicySha256!==buildEvidenceEpoch(AI_VERSION,"gen9ou").policySha256)throw new Error(`Battle assist approval evidence epoch is stale: ${file}`);if(!/^[a-f0-9]{64}$/.test(value.payload.evidenceManifestSha256)||!value.payload.scopes.length||new Set(value.payload.scopes.map(entry=>entry.scopeId)).size!==value.payload.scopes.length||value.payload.scopes.some(entry=>!/^[a-f0-9]{24}$/.test(entry.scopeId)||!/^[a-f0-9]{20}$/.test(entry.hypothesisId)||!/^[a-f0-9]{64}$/.test(entry.aggregateSha256)))throw new Error(`Malformed battle assist approval scopes: ${file}`);return value;}
function digest(value:unknown):string{return crypto.createHash("sha256").update(canonical(value)).digest("hex");}
function fileDigest(file:string):string{return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");}
function canonical(value:unknown):string{if(Array.isArray(value))return`[${value.map(canonical).join(",")}]`;if(value&&typeof value==="object"){const record=value as Record<string,unknown>;return`{${Object.keys(record).sort().map(key=>`${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;}return JSON.stringify(value);}
function read<T>(file:string):T{if(!fs.existsSync(file))throw new Error(`Missing battle approval input: ${file}`);return JSON.parse(fs.readFileSync(file,"utf8")) as T;}
