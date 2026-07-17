import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {createBattleReplayCapsule} from "../showdown/battle";
import {AI_VERSION, DEFAULT_TACTICAL_PROFILE, EMPTY_OPPONENT_MODEL} from "../showdown/choice";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"battle-sampler-"));
try{
  const inputs:string[]=[];
  for(let seed=1;seed<=3;seed+=1){
    const source=path.join(root,`source-${seed}`),game=path.join(source,"season-01","battles","series","game-0001");fs.mkdirSync(game,{recursive:true});inputs.push(source);
    fs.writeFileSync(path.join(source,"dynasty-state.json"),JSON.stringify({seed:`sampler-${seed}`,completedSeason:1,decisionRecords:[]}));
    const traces=[1,2].map((ordinal)=>({decisionOrdinal:ordinal,turn:ordinal+2,playerId:"p1",personalityId:"manager-01",battleContext:{ownSpecies:"Alpha",opponentSpecies:"Beta"},whiteBoxShadow:{comparison:{incumbent:"move tackle",shadow:"switch 2",agrees:false},trace:{version:"white-box-decision-v1",decisionId:`battle:${ordinal}:p1`,selected:"switch 2",reasonableBand:12,styleContributionLimit:15,candidates:[candidate("move tackle",2,0),candidate("switch 2",3,.1)]}}}));
    fs.writeFileSync(path.join(game,"ai-decisions.json"),JSON.stringify(traces));
    const capsule=createBattleReplayCapsule({schemaVersion:1,aiVersion:AI_VERSION,format:"gen9customgame",teamA:"team-a",teamB:"team-b",seed:[seed,2,3,4],maxTurns:100,idleTimeoutMs:5000,wallClockTimeoutMs:30000,ai:"search",openTeamSheets:true,traceAiDecisions:true,aiProfiles:{p1:{...DEFAULT_TACTICAL_PROFILE,id:"manager-01"},p2:{...DEFAULT_TACTICAL_PROFILE,id:"manager-02"}},aiOpponentModels:{p1:structuredClone(EMPTY_OPPONENT_MODEL),p2:structuredClone(EMPTY_OPPONENT_MODEL)}});
    fs.writeFileSync(path.join(game,"replay-input.json"),JSON.stringify(capsule));
  }
  const out=path.join(root,"sampler-output"),command=[require.resolve("tsx/cli"),path.join(process.cwd(),"src","cli","sampleWhiteBoxBattle.ts"),"--inputs",inputs.join(","),"--out",out,"--target-samples","10","--minimum-seeds","3","--max-samples","10","--max-per-seed","2"];
  for(let pass=0;pass<2;pass+=1){const result=spawnSync(process.execPath,command,{cwd:process.cwd(),encoding:"utf8"});if(result.status!==0)throw new Error(result.stderr||result.stdout);}
  const manifest=JSON.parse(fs.readFileSync(path.join(out,"battle-sampler-manifest.json"),"utf8")),summary=JSON.parse(fs.readFileSync(path.join(out,"battle-sampler-summary.json"),"utf8"));
  assert.equal(manifest.schemaVersion,1);assert.equal(manifest.hypothesis.availableSeeds,3);assert.equal(manifest.hypothesis.availableReplicas,6);assert.deepEqual(manifest.runs,[]);assert.equal(summary.completed,0);assert.equal(summary.stage,"not-started");assert.equal(fs.existsSync(path.join(out,"runs")),false);
  const empty=path.join(root,"empty-source");fs.mkdirSync(empty,{recursive:true});fs.writeFileSync(path.join(empty,"dynasty-state.json"),JSON.stringify({seed:"empty",completedSeason:1,decisionRecords:[]}));
  const emptyOut=path.join(root,"empty-output"),emptyResult=spawnSync(process.execPath,[require.resolve("tsx/cli"),path.join(process.cwd(),"src","cli","sampleWhiteBoxBattle.ts"),"--inputs",empty,"--out",emptyOut],{cwd:process.cwd(),encoding:"utf8"});
  assert.equal(emptyResult.status,0,emptyResult.stderr||emptyResult.stdout);assert.equal(JSON.parse(fs.readFileSync(path.join(emptyOut,"battle-sampler-summary.json"),"utf8")).conclusion,"no-eligible-hypothesis");assert(fs.existsSync(path.join(emptyOut,"battle-sampler-plan.json")));
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log("Battle counterfactual sampler smoke test passed");

function candidate(id:string,rational:number,style:number){return{id,eligible:true,reasonable:true,hardRejections:[],rationalScore:rational,rawStyleScore:style,appliedStyleScore:style,finalScore:rational+style,contributions:[{id:"battle.expected",group:"expected",source:"competence",value:rational,reason:"expected"},{id:"battle.downside",group:"risk",source:"risk",value:0,reason:"downside"},{id:"battle.worst",group:"risk",source:"risk",value:0,reason:"worst"},{id:"battle.personality",group:"personality",source:"personality",value:style,reason:"style"}]};}
