import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {loadCareerMemoryCheckpoint,type CareerMemoryCheckpoint} from "../../draft/careerArchive";
import {ALL_WHITE_BOX_PARAMETER_REGISTRIES,WHITE_BOX_PARAMETER_SCHEMA_VERSION} from "./parameters";

export const WHITE_BOX_RELEASE_SCHEMA_VERSION = 1;
export const WHITE_BOX_RELEASE_PAYLOAD_FILES = ["ai-state.json","parameters.json","audit-index.json","runtime-fingerprint.json","README.md"] as const;
export const WHITE_BOX_RELEASE_FILES = [...WHITE_BOX_RELEASE_PAYLOAD_FILES,"release-manifest.json"] as const;

export interface WhiteBoxReleaseManifest {
  schemaVersion: typeof WHITE_BOX_RELEASE_SCHEMA_VERSION;
  releaseId: string;
  completedSeason: number;
  nextSeason: number;
  managerCount: number;
  files: Record<string,{sha256:string;bytes:number}>;
}

export interface WhiteBoxReleaseArtifacts {manifest:WhiteBoxReleaseManifest;files:Record<string,string>}

export function buildWhiteBoxReleaseArtifacts(state:any,audit:any,review:any):WhiteBoxReleaseArtifacts {
  if(!Number.isInteger(state?.completedSeason)||!Array.isArray(state?.managers))throw new Error("Invalid dynasty state for white-box release");
  if(Number(audit?.fatalCount??0)>0)throw new Error(`Cannot release AI with ${audit.fatalCount} fatal audit issues`);
  const aiState={schemaVersion:1,dynastyVersion:state.version,seed:state.seed,completedSeason:state.completedSeason,nextSeason:state.completedSeason+1,managers:state.managers.map((manager:any)=>({id:manager.id,name:manager.name,baseProfile:manager.baseProfile,validatedProfile:manager.currentProfile,hasPendingGeneration:Boolean(manager.pendingProfile&&manager.pendingLineage),nextSeasonProfile:manager.pendingProfile??manager.currentProfile,validatedLineage:manager.lineage,nextSeasonLineage:manager.pendingLineage??manager.lineage,lineageHistory:manager.lineageHistory,organization:{contracts:manager.contracts,cash:manager.cash,deadMoneyCurrent:manager.deadMoneyCurrent??0,deadMoneyNext:manager.deadMoneyNext??0,titles:manager.titles,totalPoints:manager.totalPoints},career:manager.seasons.map((season:any)=>({season:season.season,rank:season.rank,points:season.points,champion:season.champion}))})),evolutionArchive:state.evolutionArchive??[]};
  const parameters={schemaVersion:WHITE_BOX_PARAMETER_SCHEMA_VERSION,domains:Object.fromEntries(Object.entries(ALL_WHITE_BOX_PARAMETER_REGISTRIES).map(([domain,registry])=>[domain,{values:registry.snapshot().values,definitions:registry.allDefinitions()}]))};
  const auditIndex={schemaVersion:1,promotion:audit.promotion,coverage:audit.coverage,fatalCount:audit.fatalCount,warningCount:audit.warningCount,expectedTraces:audit.expectedTraces,auditedTraces:audit.auditedTraces,metrics:audit.metrics,differences:{comparisons:review.comparisons,agreements:review.agreements,cases:review.cases.length,experimentEligible:review.metrics.experimentEligible,experimentIneligible:review.metrics.experimentIneligible,byDomain:review.metrics.byDomain,byClassification:review.metrics.byClassification}};
  const runtimeFingerprint={schemaVersion:1,runtime:state.fingerprint,registry:state.registry?{schemaVersion:state.registry.schemaVersion,revision:state.registry.revision,hash:state.registry.hash,namespace:state.registry.namespace}:null,settings:state.settings};
  const readme=["# MythicMons White-box AI Release","",`Release season: ${state.completedSeason}`,`Next season: ${state.completedSeason+1}`,`Managers: ${state.managers.length}`,"","This package contains only final manager AI state, semantic policy parameters, runtime fingerprints, and compact audit metadata.","It intentionally excludes battles, training branches, raw rosters, and sampler work directories.","For each manager, validatedProfile is the personality used in the completed season; nextSeasonProfile is the pending descendant that should activate next season when present.",""].join("\n");
  const files:Record<string,string>={"ai-state.json":json(aiState),"parameters.json":json(parameters),"audit-index.json":json(auditIndex),"runtime-fingerprint.json":json(runtimeFingerprint),"README.md":readme};
  const fileIndex=Object.fromEntries(WHITE_BOX_RELEASE_PAYLOAD_FILES.map(name=>[name,{sha256:sha(files[name]),bytes:Buffer.byteLength(files[name])}]));
  const releaseId=sha(stable(fileIndex));
  return {manifest:{schemaVersion:WHITE_BOX_RELEASE_SCHEMA_VERSION,releaseId,completedSeason:state.completedSeason,nextSeason:state.completedSeason+1,managerCount:state.managers.length,files:fileIndex},files};
}

export function writeWhiteBoxRelease(directory:string,artifacts:WhiteBoxReleaseArtifacts,force=false):void {
  const target=path.resolve(directory),parent=path.dirname(target),temporary=path.join(parent,`.${path.basename(target)}.${artifacts.manifest.releaseId.slice(0,12)}.tmp`);
  if(fs.existsSync(target)&&!force)throw new Error(`Release output exists: ${target}`);
  if(target===path.parse(target).root||target===process.cwd())throw new Error(`Unsafe release target: ${target}`);
  if(fs.existsSync(temporary))fs.rmSync(temporary,{recursive:true,force:true});
  fs.mkdirSync(temporary,{recursive:true});
  for(const [name,content]of Object.entries(artifacts.files))fs.writeFileSync(path.join(temporary,name),content,"utf8");
  fs.writeFileSync(path.join(temporary,"release-manifest.json"),json(artifacts.manifest),"utf8");
  verifyWhiteBoxRelease(temporary);
  if(fs.existsSync(target))fs.rmSync(target,{recursive:true,force:true});
  fs.renameSync(temporary,target);
}

export function verifyWhiteBoxRelease(directory:string):WhiteBoxReleaseManifest {
  const root=path.resolve(directory),manifest=read<WhiteBoxReleaseManifest>(path.join(root,"release-manifest.json"));
  const allowed=new Set<string>(WHITE_BOX_RELEASE_FILES),entries=fs.readdirSync(root,{withFileTypes:true});
  if(entries.some(entry=>entry.isDirectory()||!allowed.has(entry.name)))throw new Error("Release contains unexpected files or directories");
  for(const name of WHITE_BOX_RELEASE_PAYLOAD_FILES){const file=path.join(root,name),content=fs.readFileSync(file);const expected=manifest.files[name];if(!expected||expected.bytes!==content.byteLength||expected.sha256!==sha(content))throw new Error(`Release integrity failure: ${name}`);}
  if(manifest.releaseId!==sha(stable(manifest.files)))throw new Error("Release id does not match payload index");
  return manifest;
}

export function resolveWhiteBoxRelease(input:string):string {
  const root=path.resolve(input);
  if(fs.existsSync(path.join(root,"release-manifest.json"))){verifyWhiteBoxRelease(root);return root;}
  const pointerFile=path.join(root,"active.json");
  if(!fs.existsSync(pointerFile))throw new Error(`Not a white-box release or release registry: ${root}`);
  const pointer=read<{schemaVersion:number;releaseId:string;relativePath:string}>(pointerFile);
  if(pointer.schemaVersion!==1||!pointer.releaseId||!pointer.relativePath)throw new Error("Invalid white-box release active pointer");
  const releaseRoot=path.resolve(root,pointer.relativePath),relative=path.relative(root,releaseRoot);
  if(relative.startsWith("..")||path.isAbsolute(relative))throw new Error("White-box release active pointer escapes registry root");
  const manifest=verifyWhiteBoxRelease(releaseRoot);
  if(manifest.releaseId!==pointer.releaseId)throw new Error("White-box release active pointer id mismatch");
  return releaseRoot;
}

export function writeCareerCheckpointFromWhiteBoxRelease(releaseDirectory:string,destination:string,force=false):{manifest:string;archive:string;sourceBytes:number;compressedBytes:number;releaseId:string} {
  const releaseRoot=resolveWhiteBoxRelease(releaseDirectory),releaseManifest=verifyWhiteBoxRelease(releaseRoot),ai=read<any>(path.join(releaseRoot,"ai-state.json")),fingerprint=read<any>(path.join(releaseRoot,"runtime-fingerprint.json"));
  const checkpoint:CareerMemoryCheckpoint={schemaVersion:1,source:{seed:ai.seed,completedSeason:ai.completedSeason,stateVersion:ai.dynastyVersion,fingerprint:fingerprint.runtime,registry:fingerprint.registry?{hash:fingerprint.registry.hash,revision:fingerprint.registry.revision}:undefined},managers:ai.managers.map((manager:any)=>({id:manager.id,name:manager.name,baseProfile:manager.baseProfile,currentProfile:manager.validatedProfile,lineage:manager.validatedLineage,lineageHistory:manager.lineageHistory,pendingProfile:manager.hasPendingGeneration?manager.nextSeasonProfile:undefined,pendingLineage:manager.hasPendingGeneration?manager.nextSeasonLineage:undefined}))};
  const target=path.resolve(destination);if(fs.existsSync(target)&&!force)throw new Error(`Checkpoint output exists: ${target}`);if(target===path.parse(target).root||target===process.cwd())throw new Error(`Unsafe checkpoint target: ${target}`);if(fs.existsSync(target))fs.rmSync(target,{recursive:true,force:true});fs.mkdirSync(target,{recursive:true});
  const source=Buffer.from(`${JSON.stringify(checkpoint)}\n`,"utf8"),compressed=zlib.gzipSync(source,{level:9}),archive=path.join(target,"career-memory.json.gz"),manifest=path.join(target,"career-memory.json"),sourceHash=sha(source);
  fs.writeFileSync(archive,compressed);fs.writeFileSync(manifest,json({schemaVersion:1,archive:path.basename(archive),sha256:sourceHash,sourceBytes:source.length,compressedBytes:compressed.length,managers:checkpoint.managers.length,completedSeason:checkpoint.source.completedSeason,releaseId:releaseManifest.releaseId,carries:["baseProfile","currentProfile","lineage","lineageHistory","pendingProfile","pendingLineage"],resets:["season","titles","points","cash","contracts","assets","market"]}),"utf8");
  loadCareerMemoryCheckpoint(manifest);
  return{manifest,archive,sourceBytes:source.length,compressedBytes:compressed.length,releaseId:releaseManifest.releaseId};
}

function json(value:any):string{return`${JSON.stringify(value,null,2)}\n`;}
function sha(value:string|Buffer):string{return crypto.createHash("sha256").update(value).digest("hex");}
function stable(value:any):string{if(Array.isArray(value))return`[${value.map(stable).join(",")}]`;if(value&&typeof value==="object")return`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;return JSON.stringify(value);}
function read<T>(file:string):T{return JSON.parse(fs.readFileSync(file,"utf8")) as T;}
