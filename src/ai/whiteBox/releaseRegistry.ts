import fs from "node:fs";
import path from "node:path";
import {resolveWhiteBoxRelease,verifyWhiteBoxRelease,WHITE_BOX_RELEASE_FILES,type WhiteBoxReleaseManifest} from "./release";

export const WHITE_BOX_RELEASE_REGISTRY_SCHEMA_VERSION=1;
export type WhiteBoxReleaseStatus="staged"|"active"|"rejected";
export interface WhiteBoxReleaseRegistryEntry {releaseId:string;status:WhiteBoxReleaseStatus;relativePath:string;registeredOrder:number;reason?:string}
export interface WhiteBoxReleaseActivation {sequence:number;releaseId:string;previousReleaseId:string|null;action:"activate"|"rollback"}
export interface WhiteBoxReleaseRegistry {schemaVersion:typeof WHITE_BOX_RELEASE_REGISTRY_SCHEMA_VERSION;entries:WhiteBoxReleaseRegistryEntry[];activationHistory:WhiteBoxReleaseActivation[]}

export function readWhiteBoxReleaseRegistry(directory:string):WhiteBoxReleaseRegistry {
  const root=path.resolve(directory),file=path.join(root,"registry.json");
  if(!fs.existsSync(file))return{schemaVersion:WHITE_BOX_RELEASE_REGISTRY_SCHEMA_VERSION,entries:[],activationHistory:[]};
  const registry=JSON.parse(fs.readFileSync(file,"utf8")) as WhiteBoxReleaseRegistry;
  if(registry.schemaVersion!==WHITE_BOX_RELEASE_REGISTRY_SCHEMA_VERSION||!Array.isArray(registry.entries)||!Array.isArray(registry.activationHistory))throw new Error("Invalid white-box release registry");
  const ids=new Set<string>(),orders=new Set<number>(),statuses=new Set<WhiteBoxReleaseStatus>(["staged","active","rejected"]);
  for(const entry of registry.entries){
    if(!entry||!/^[a-f0-9]{64}$/.test(entry.releaseId)||!statuses.has(entry.status)||typeof entry.relativePath!=="string"||!entry.relativePath||!Number.isInteger(entry.registeredOrder)||entry.registeredOrder<1)throw new Error("Invalid white-box release registry entry");
    if(ids.has(entry.releaseId)||orders.has(entry.registeredOrder))throw new Error("Duplicate white-box release registry entry");ids.add(entry.releaseId);orders.add(entry.registeredOrder);
    if(entry.status==="rejected"&&!entry.reason?.trim())throw new Error("Rejected white-box release is missing a reason");
  }
  if(registry.entries.filter(entry=>entry.status==="active").length>1)throw new Error("Registry contains multiple active releases");
  for(let index=0;index<registry.activationHistory.length;index+=1){const event=registry.activationHistory[index];if(!event||event.sequence!==index+1||!ids.has(event.releaseId)||(event.previousReleaseId!==null&&!ids.has(event.previousReleaseId))||(event.action!=="activate"&&event.action!=="rollback"))throw new Error("Invalid white-box release activation history");}
  return registry;
}

export function registerWhiteBoxRelease(registryDirectory:string,releaseDirectory:string):{registry:WhiteBoxReleaseRegistry;entry:WhiteBoxReleaseRegistryEntry;manifest:WhiteBoxReleaseManifest} {
  const root=path.resolve(registryDirectory),source=resolveWhiteBoxRelease(releaseDirectory),manifest=verifyWhiteBoxRelease(source);ensureRegistryRoot(root);
  const registry=readWhiteBoxReleaseRegistry(root),existing=registry.entries.find(entry=>entry.releaseId===manifest.releaseId);
  if(existing){verifyRegisteredRelease(root,existing);return{registry,entry:existing,manifest};}
  const relativePath=path.join("releases",manifest.releaseId),target=path.join(root,relativePath),temporary=`${target}.tmp`;
  if(fs.existsSync(temporary))fs.rmSync(temporary,{recursive:true,force:true});fs.mkdirSync(temporary,{recursive:true});
  try{for(const file of WHITE_BOX_RELEASE_FILES)fs.copyFileSync(path.join(source,file),path.join(temporary,file));verifyWhiteBoxRelease(temporary);fs.renameSync(temporary,target);}catch(error){fs.rmSync(temporary,{recursive:true,force:true});throw error;}
  const entry:WhiteBoxReleaseRegistryEntry={releaseId:manifest.releaseId,status:"staged",relativePath:normalize(relativePath),registeredOrder:registry.entries.length+1};registry.entries.push(entry);writeRegistry(root,registry);return{registry,entry,manifest};
}

export function activateWhiteBoxRelease(registryDirectory:string,releaseId:string):WhiteBoxReleaseRegistry {
  const root=path.resolve(registryDirectory),registry=readWhiteBoxReleaseRegistry(root),target=requiredEntry(registry,releaseId);if(target.status==="rejected")throw new Error(`Cannot activate rejected release: ${releaseId}`);verifyRegisteredRelease(root,target);
  const current=registry.entries.find(entry=>entry.status==="active");if(current?.releaseId===releaseId)return registry;if(current)current.status="staged";target.status="active";delete target.reason;
  registry.activationHistory.push({sequence:registry.activationHistory.length+1,releaseId,previousReleaseId:current?.releaseId??null,action:"activate"});writeRegistryAndPointer(root,registry,target);return registry;
}

export function rejectWhiteBoxRelease(registryDirectory:string,releaseId:string,reason:string):WhiteBoxReleaseRegistry {
  if(!reason.trim())throw new Error("A rejection reason is required");const root=path.resolve(registryDirectory),registry=readWhiteBoxReleaseRegistry(root),target=requiredEntry(registry,releaseId);if(target.status==="active")throw new Error(`Cannot reject active release: ${releaseId}`);target.status="rejected";target.reason=reason.trim();writeRegistry(root,registry);return registry;
}

export function rollbackWhiteBoxRelease(registryDirectory:string):WhiteBoxReleaseRegistry {
  const root=path.resolve(registryDirectory),registry=readWhiteBoxReleaseRegistry(root),current=registry.entries.find(entry=>entry.status==="active");if(!current)throw new Error("Cannot rollback without an active release");
  const previous=[...registry.activationHistory].reverse().map(item=>item.releaseId===current.releaseId?item.previousReleaseId:item.releaseId).find(id=>id&&id!==current.releaseId&&registry.entries.some(entry=>entry.releaseId===id&&entry.status!=="rejected"));
  if(!previous)throw new Error("No previous eligible release is available for rollback");const target=requiredEntry(registry,previous);verifyRegisteredRelease(root,target);current.status="staged";target.status="active";registry.activationHistory.push({sequence:registry.activationHistory.length+1,releaseId:target.releaseId,previousReleaseId:current.releaseId,action:"rollback"});writeRegistryAndPointer(root,registry,target);return registry;
}

export function verifyWhiteBoxReleaseRegistry(directory:string):WhiteBoxReleaseRegistry {
  const root=path.resolve(directory),registry=readWhiteBoxReleaseRegistry(root);for(const entry of registry.entries)verifyRegisteredRelease(root,entry);const active=registry.entries.find(entry=>entry.status==="active");if(active){const resolved=resolveWhiteBoxRelease(root);if(verifyWhiteBoxRelease(resolved).releaseId!==active.releaseId)throw new Error("Registry active pointer does not match registry state");}else if(fs.existsSync(path.join(root,"active.json")))throw new Error("Registry has an active pointer but no active release");return registry;
}

function requiredEntry(registry:WhiteBoxReleaseRegistry,releaseId:string):WhiteBoxReleaseRegistryEntry {const entry=registry.entries.find(item=>item.releaseId===releaseId);if(!entry)throw new Error(`Unknown white-box release: ${releaseId}`);return entry;}
function ensureRegistryRoot(root:string):void {if(root===path.parse(root).root||root===process.cwd())throw new Error(`Unsafe registry target: ${root}`);fs.mkdirSync(path.join(root,"releases"),{recursive:true});}
function verifyRegisteredRelease(root:string,entry:WhiteBoxReleaseRegistryEntry):WhiteBoxReleaseManifest {const target=path.resolve(root,entry.relativePath),relative=path.relative(root,target);if(relative.startsWith("..")||path.isAbsolute(relative))throw new Error(`Registered release escapes registry root: ${entry.releaseId}`);const manifest=verifyWhiteBoxRelease(target);if(manifest.releaseId!==entry.releaseId)throw new Error(`Registered release id mismatch: ${entry.releaseId}`);return manifest;}
function writeRegistryAndPointer(root:string,registry:WhiteBoxReleaseRegistry,active:WhiteBoxReleaseRegistryEntry):void {writeJsonAtomic(path.join(root,"active.json"),{schemaVersion:1,releaseId:active.releaseId,relativePath:active.relativePath});writeRegistry(root,registry);}
function writeRegistry(root:string,registry:WhiteBoxReleaseRegistry):void {writeJsonAtomic(path.join(root,"registry.json"),registry);}
function writeJsonAtomic(file:string,value:any):void {fs.mkdirSync(path.dirname(file),{recursive:true});const temporary=`${file}.tmp`;fs.writeFileSync(temporary,`${JSON.stringify(value,null,2)}\n`,"utf8");fs.renameSync(temporary,file);}
function normalize(value:string):string{return value.split(path.sep).join("/");}
