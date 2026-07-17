import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildWhiteBoxReleaseArtifacts,resolveWhiteBoxRelease,verifyWhiteBoxRelease,writeCareerCheckpointFromWhiteBoxRelease,writeWhiteBoxRelease} from "../ai/whiteBox/release";
import {activateWhiteBoxRelease,registerWhiteBoxRelease,rejectWhiteBoxRelease,rollbackWhiteBoxRelease,verifyWhiteBoxReleaseRegistry} from "../ai/whiteBox/releaseRegistry";
import {loadCareerMemoryCheckpoint} from "../draft/careerArchive";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"whitebox-release-registry-")),registryRoot=path.join(root,"registry"),releaseA=path.join(root,"release-a"),releaseB=path.join(root,"release-b");
const profile={id:"m1",traits:{risk:.5},tacticalMemory:{opponents:{}},strategyProgram:{version:1}},audit={promotion:"shadow-stable",coverage:1,fatalCount:0,warningCount:0,expectedTraces:1,auditedTraces:1,metrics:{comparisons:1}},review={comparisons:1,agreements:1,cases:[],metrics:{experimentEligible:0,experimentIneligible:0,byDomain:{},byClassification:{}}};
function state(seed:string,risk:number){const current={...profile,traits:{risk}};return{version:12,seed,completedSeason:2,settings:{managerLimit:1},fingerprint:{codeHash:"code"},registry:{schemaVersion:1,revision:"r1",hash:"registry",namespace:"test"},evolutionArchive:[],managers:[{id:"m1",name:"Manager 1",baseProfile:profile,currentProfile:current,pendingProfile:undefined,lineage:{lineageId:`${seed}-lineage`},pendingLineage:undefined,lineageHistory:[{lineageId:`${seed}-lineage`}],contracts:[],cash:10,titles:0,totalPoints:20,seasons:[{season:2,rank:1,points:20,champion:true}]}]};}
try{
  writeWhiteBoxRelease(releaseA,buildWhiteBoxReleaseArtifacts(state("release-a",.5),audit,review));writeWhiteBoxRelease(releaseB,buildWhiteBoxReleaseArtifacts(state("release-b",.6),audit,review));
  const registeredA=registerWhiteBoxRelease(registryRoot,releaseA),registeredB=registerWhiteBoxRelease(registryRoot,releaseB);assert.equal(registerWhiteBoxRelease(registryRoot,releaseA).registry.entries.length,2);assert.equal(registeredA.entry.status,"staged");assert.equal(registeredB.entry.status,"staged");
  activateWhiteBoxRelease(registryRoot,registeredA.manifest.releaseId);activateWhiteBoxRelease(registryRoot,registeredB.manifest.releaseId);let registry=rollbackWhiteBoxRelease(registryRoot);assert.equal(registry.entries.find(entry=>entry.status==="active")?.releaseId,registeredA.manifest.releaseId);assert.equal(verifyWhiteBoxRelease(resolveWhiteBoxRelease(registryRoot)).releaseId,registeredA.manifest.releaseId);
  assert.throws(()=>rejectWhiteBoxRelease(registryRoot,registeredA.manifest.releaseId,"bad"),/Cannot reject active/);registry=rejectWhiteBoxRelease(registryRoot,registeredB.manifest.releaseId,"paired evidence regressed");assert.equal(registry.entries.find(entry=>entry.releaseId===registeredB.manifest.releaseId)?.status,"rejected");assert.throws(()=>activateWhiteBoxRelease(registryRoot,registeredB.manifest.releaseId),/Cannot activate rejected/);
  const verified=verifyWhiteBoxReleaseRegistry(registryRoot);assert.equal(verified.activationHistory.length,3);assert.equal(verified.activationHistory.at(-1)?.action,"rollback");
  const imported=writeCareerCheckpointFromWhiteBoxRelease(registryRoot,path.join(root,"checkpoint")),checkpoint=loadCareerMemoryCheckpoint(imported.manifest);assert.equal(imported.releaseId,registeredA.manifest.releaseId);assert.equal(checkpoint.managers[0].currentProfile.traits.risk,.5);
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log("White-box AI release registry smoke test passed");
