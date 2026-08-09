import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {AI_VERSION} from "../showdown/choice";
import {buildEvidenceEpoch, classifyEvidenceEpoch, type EvidenceEpoch} from "../showdown/evidenceEpoch";

const args=process.argv.slice(2),source=path.resolve(required("--source")),frontierFile=path.resolve(required("--frontier")),agendasFile=path.resolve(required("--agendas")),out=path.resolve(required("--out"));
const frontier=read<any>(frontierFile),agendas=readArchive<any>(agendasFile);
if(frontier.schemaVersion!==1||frontier.activationStatus!=="shadow-only"||!["observational-candidate-frontier","post-deployment-exploratory"].includes(frontier.evidenceStatus)||frontier.validity?.activationAllowed!==false||!Array.isArray(frontier.managerMechanisms))throw new Error("Invalid battle candidate frontier");
if(!Array.isArray(agendas)||agendas.some(value=>value.activationStatus!=="shadow-only"))throw new Error("Invalid manager research agendas");
const rowEntries:Array<readonly[string,any]>=(frontier.managerMechanisms??[]).map((value:any)=>[`${value.managerId}|${value.mechanismId??`battle-frontier-${value.mechanism}-v1`}`,value] as const);if(new Set(rowEntries.map(([key])=>key)).size!==rowEntries.length)throw new Error("Duplicate manager mechanism rows in battle frontier");const rows=new Map(rowEntries);
const excludedPlanFiles=option("--exclude-plans","").split(",").map(value=>value.trim()).filter(Boolean).map(value=>path.resolve(value));
if(new Set(excludedPlanFiles.map(value=>value.toLowerCase())).size!==excludedPlanFiles.length)throw new Error("Duplicate excluded battle research plan");
const excludedPlans=excludedPlanFiles.map(file=>({file:path.relative(process.cwd(),file).replaceAll("\\","/"),sha256:shaFile(file)}));
const excludedCases=new Set<string>();
for(const file of excludedPlanFiles){
  const prior=read<any>(file);
  if(prior.schemaVersion!==1||prior.activationStatus!=="shadow-only"||prior.evidenceStatus!=="manager-selected-research-only"||prior.authority!=="no-activation-authority"||!Array.isArray(prior.items))throw new Error(`Invalid excluded battle research plan: ${file}`);
  for(const item of prior.items)if(item.status==="ready"){const key=caseKey(item,path.resolve(String(item.game)));if(excludedCases.has(key))throw new Error(`Duplicate physical case across excluded plans: ${file}`);excludedCases.add(key);}
}
const items:any[]=[];
for(const agenda of agendas){
  const mechanismId=String(agenda.selected?.mechanismId??"");if(!mechanismId.startsWith("battle-frontier-")&&!mechanismId.startsWith("battle-context-"))continue;
  const row:any=rows.get(`${agenda.managerId}|${mechanismId}`);
  if(!row?.examples?.length){items.push({managerId:agenda.managerId,mechanismId,status:"deferred",reason:"no-personal-frontier-opportunity"});continue;}
  const example=row.examples.find((candidate:any)=>!excludedCases.has(caseKey({managerId:agenda.managerId,mechanismId,...candidate},path.resolve(source,String(candidate.game)))));
  if(!example){items.push({managerId:agenda.managerId,mechanismId,status:"deferred",reason:"no-unused-personal-frontier-opportunity"});continue;}
  const game=path.resolve(source,String(example.game)),decisionFile=evidenceFile(game,"ai-decisions.json"),replayFile=path.join(game,"replay-input.json"),endFile=path.join(game,"end.json");
  if(!fs.existsSync(replayFile)||!fs.existsSync(endFile))throw new Error(`Incomplete battle research source: ${game}`);
  const traces=read<any[]>(decisionFile),trace=traces.find(value=>Number(value.decisionOrdinal)===Number(example.decisionOrdinal));
  if(!trace||trace.personalityId!==agenda.managerId||trace.playerId!==example.side||trace.selected!==example.selected||!trace.whiteBoxShadow?.trace?.candidates?.some((value:any)=>value.id===example.alternative&&value.eligible!==false&&value.reasonable===true&&value.finalScore!==null))throw new Error(`Frozen battle frontier example drifted: ${agenda.managerId}/${mechanismId}`);
  const capsule=read<any>(replayFile),epoch=capsule?.input?.evidenceEpoch as EvidenceEpoch|undefined,expected=epoch?buildEvidenceEpoch(AI_VERSION,epoch.content.format,{registryHash:epoch.content.registryHash,configurationPolicyVersion:epoch.content.configurationPolicyVersion}):buildEvidenceEpoch(AI_VERSION,"gen9ou"),classification=classifyEvidenceEpoch(epoch,expected);
  const identity={managerId:agenda.managerId,mechanismId,game:path.relative(process.cwd(),game).replaceAll("\\","/"),decisionOrdinal:Number(example.decisionOrdinal),side:example.side,selected:example.selected,alternative:example.alternative,replaySha256:shaFile(replayFile),decisionsSha256:shaFile(decisionFile),evidenceEpoch:{policySha256:epoch?.policySha256??null,contentSha256:epoch?.contentSha256??null,epochSha256:epoch?.epochSha256??null,compatibility:classification.compatibility,formalActivationAllowed:classification.formalActivationAllowed,reason:classification.reason}};
  items.push({...identity,id:sha(Buffer.from(canonical(identity))).slice(0,24),status:"ready",rationalCost:Number(example.rationalCost),styleDelta:Number(example.styleDelta)});
}
const ready=items.filter(value=>value.status==="ready"),deferred=items.filter(value=>value.status==="deferred"),epochBlocked=ready.filter(value=>value.evidenceEpoch?.compatibility!=="exact-compatible"||value.evidenceEpoch?.formalActivationAllowed!==true),plan={schemaVersion:1,activationStatus:"shadow-only",evidenceStatus:"manager-selected-research-only",authority:"no-activation-authority",executionStatus:epochBlocked.length?"blocked-evidence-epoch":"ready",evidenceEpoch:{policySha256:buildEvidenceEpoch(AI_VERSION,"gen9ou").policySha256,eligibleCases:ready.length-epochBlocked.length,blockedCases:epochBlocked.length},source,frontier:{file:path.relative(process.cwd(),frontierFile).replaceAll("\\","/"),sha256:shaFile(frontierFile)},agendas:{file:path.relative(process.cwd(),agendasFile).replaceAll("\\","/"),sha256:shaFile(agendasFile),round:agendas[0]?.round??null},excludedPlans,excludedReadyCases:excludedCases.size,selectionPolicy:"manager-first-choice-then-minimum-rational-cost-unused-personal-example",ready:ready.length,deferred:deferred.length,items};
fs.mkdirSync(out,{recursive:true});write(path.join(out,"battle-frontier-research-plan.json"),plan);write(path.join(out,"summary.json"),{schemaVersion:1,activationStatus:"shadow-only",ready:ready.length,deferred:deferred.length,byMechanism:count(ready.map(value=>value.mechanismId)),deferredItems:deferred,estimatedTokens:Math.ceil(Buffer.byteLength(JSON.stringify({ready:ready.length,deferred:deferred.length,byMechanism:count(ready.map(value=>value.mechanismId)),deferredItems:deferred}))/4)});console.log(JSON.stringify({ready:ready.length,deferred:deferred.length,byMechanism:count(ready.map(value=>value.mechanismId)),out},null,2));
function evidenceFile(directory:string,name:string):string{const plain=path.join(directory,name),gzip=`${plain}.gz`;if(fs.existsSync(plain))return plain;if(fs.existsSync(gzip))return gzip;throw new Error(`Missing ${name}[.gz]: ${directory}`);}
function read<T>(file:string):T{const bytes=fs.readFileSync(file),text=file.endsWith(".gz")?zlib.gunzipSync(bytes).toString("utf8"):bytes.toString("utf8");return JSON.parse(text) as T;}
function readArchive<T>(file:string):T[]{const value=read<T[]>(file);if(!Array.isArray(value))throw new Error(`Invalid archive: ${file}`);return value;}
function count(values:string[]):Record<string,number>{const result:Record<string,number>={};for(const value of values)result[value]=(result[value]??0)+1;return result;}
function shaFile(file:string):string{return sha(fs.readFileSync(file));}function sha(bytes:Buffer):string{return crypto.createHash("sha256").update(bytes).digest("hex");}
function canonical(value:unknown):string{if(Array.isArray(value))return`[${value.map(canonical).join(",")}]`;if(value&&typeof value==="object"){const record=value as Record<string,unknown>;return`{${Object.keys(record).sort().map(key=>`${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;}return JSON.stringify(value);}
function caseKey(value:any,game:string):string{return canonical({managerId:String(value.managerId),game:path.resolve(game).replaceAll("\\","/").toLowerCase(),decisionOrdinal:Number(value.decisionOrdinal),side:String(value.side),selected:String(value.selected),alternative:String(value.alternative)});}
function write(file:string,value:unknown):void{const temporary=`${file}.${process.pid}.tmp`;fs.writeFileSync(temporary,`${JSON.stringify(value,null,2)}\n`,"utf8");fs.renameSync(temporary,file);}
function required(name:string):string{const value=option(name,"");if(!value)throw new Error(`Missing ${name}`);return value;}function option(name:string,fallback:string):string{const index=args.indexOf(name);return index>=0?String(args[index+1]??fallback):fallback;}
