import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildWhiteBoxReleaseArtifacts,verifyWhiteBoxRelease,writeCareerCheckpointFromWhiteBoxRelease,writeWhiteBoxRelease} from "../ai/whiteBox/release";
import {loadCareerMemoryCheckpoint} from "../draft/careerArchive";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"whitebox-release-")),out=path.join(root,"release");
const profile={id:"m1",traits:{risk:.5},tacticalMemory:{opponents:{}},strategyProgram:{version:1}};
const state={version:12,seed:"release-seed",completedSeason:2,settings:{managerLimit:1},fingerprint:{codeHash:"code"},registry:{schemaVersion:1,revision:"r1",hash:"registry",namespace:"test"},evolutionArchive:[],managers:[{id:"m1",name:"Manager 1",baseProfile:profile,currentProfile:profile,pendingProfile:{...profile,traits:{risk:.6}},lineage:{lineageId:"l1"},pendingLineage:{lineageId:"l2"},lineageHistory:[{lineageId:"l1"}],contracts:[],cash:10,titles:0,totalPoints:20,seasons:[{season:1,rank:2,points:8,champion:false},{season:2,rank:1,points:12,champion:true}]}]};
const audit={promotion:"shadow-stable",coverage:1,fatalCount:0,warningCount:0,expectedTraces:1,auditedTraces:1,metrics:{comparisons:1}},review={comparisons:1,agreements:1,cases:[],metrics:{experimentEligible:0,experimentIneligible:0,byDomain:{},byClassification:{}}};
try{const artifacts=buildWhiteBoxReleaseArtifacts(state,audit,review);writeWhiteBoxRelease(out,artifacts);const manifest=verifyWhiteBoxRelease(out);assert.equal(manifest.managerCount,1);assert.equal(manifest.nextSeason,3);const ai=JSON.parse(fs.readFileSync(path.join(out,"ai-state.json"),"utf8"));assert.equal(ai.managers[0].validatedProfile.traits.risk,.5);assert.equal(ai.managers[0].nextSeasonProfile.traits.risk,.6);const imported=writeCareerCheckpointFromWhiteBoxRelease(out,path.join(root,"checkpoint"));const checkpoint=loadCareerMemoryCheckpoint(imported.manifest);assert.equal(checkpoint.managers[0].currentProfile.traits.risk,.5);assert.equal(checkpoint.managers[0].pendingProfile?.traits.risk,.6);assert.deepEqual(fs.readdirSync(out).sort(),["README.md","ai-state.json","audit-index.json","parameters.json","release-manifest.json","runtime-fingerprint.json"].sort());fs.appendFileSync(path.join(out,"README.md"),"corrupt");assert.throws(()=>verifyWhiteBoxRelease(out),/integrity failure/);}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log("White-box AI release smoke test passed");
