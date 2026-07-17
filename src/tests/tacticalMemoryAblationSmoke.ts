import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {spawnSync} from "node:child_process";
import {aggregateTacticalMemoryAblations,type TacticalMemoryAblationSample} from "../ai/whiteBox/tacticalMemoryAblation";
import {runBattle} from "../showdown/battle";
import {EMPTY_OPPONENT_MODEL} from "../showdown/choice";
import {loadTeam} from "../showdown/team";

const outcome=(winner:string|null)=>({winner,turns:10,ended:true,timeout:false,stalled:false,errors:[] as string[]});
const sample=(index:number,direction:"better"|"worse"|"neutral"):TacticalMemoryAblationSample=>({seed:`seed-${index%10}`,caseId:`case-${index}`,playerId:"p1",confidence:.8,sourceVerified:true,firstDivergenceOrdinal:direction==="neutral"?null:2,learned:outcome(direction==="better"?"Team A":direction==="worse"?"Team B":null),ablated:outcome(direction==="better"?"Team B":direction==="worse"?"Team A":null)});
assert.equal(aggregateTacticalMemoryAblations(Array.from({length:30},(_,index)=>sample(index,index<20?"better":"neutral"))).conclusion,"supported");
assert.equal(aggregateTacticalMemoryAblations(Array.from({length:30},(_,index)=>sample(index,index<20?"worse":"neutral"))).conclusion,"harmful-review");
assert.equal(aggregateTacticalMemoryAblations(Array.from({length:30},(_,index)=>sample(index,"neutral"))).conclusion,"no-observed-outcome-effect");

async function main():Promise<void>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),"tactical-memory-ablation-"));
  try{
    const model={...structuredClone(EMPTY_OPPONENT_MODEL),confidence:.8,switchRate:.2,moveUsage:{earthquake:8,closecombat:1},moveUsageBySpecies:{greattusk:{earthquake:8,closecombat:1}}};
    const source=await runBattle({format:"gen9ou",teamA:loadTeam("examples/teamA.txt").packed,teamB:loadTeam("examples/teamB.txt").packed,seed:"tactical-memory-source",gameIndex:0,outDir:path.join(temporary,"source-root","season-02","battles","series"),maxTurns:8,ai:"search",openTeamSheets:true,traceAiDecisions:true,aiOpponentModels:{p1:model,p2:model}});
    const sourceDecisions=fs.readFileSync(source.decisionLogPath);fs.writeFileSync(`${source.decisionLogPath}.gz`,zlib.gzipSync(sourceDecisions));fs.rmSync(source.decisionLogPath);
    const input=path.join(temporary,"source-root"),output=path.join(temporary,"output"),base=[require.resolve("tsx/cli"),path.join(process.cwd(),"src","cli","sampleTacticalMemoryAblation.ts"),"--inputs",`${input},${input}`,"--out",output,"--target-samples","3","--minimum-seeds","2","--minimum-decisive-pairs","2","--minimum-decisive-seeds","2","--max-samples","4","--min-free-gb","0"];
    const compactOnly=path.join(input,"season-02","battles","compact-only","game-0001");fs.mkdirSync(compactOnly,{recursive:true});fs.copyFileSync(source.replayInputPath,path.join(compactOnly,"replay-input.json"));
    run(base);const planned=read<any>(path.join(output,"tactical-memory-ablation-summary.json"));assert.equal(planned.completed,0);assert.equal(planned.candidates,2);
    run([...base,"--max-launches","1","--run"]);assert.equal(read<any>(path.join(output,"tactical-memory-ablation-summary.json")).completed,1);assert.equal(read<any>(path.join(output,"tactical-memory-ablation-summary.json")).stopReason,"launch-budget:1");
    run([...base,"--max-samples","5","--max-launches","2","--run"]);const summary=read<any>(path.join(output,"tactical-memory-ablation-summary.json"));assert.equal(summary.completed,2);assert.equal(summary.failed,0);assert.equal(summary.stopReason,"source-pool-exhausted");
    run(base);assert.equal(read<any>(path.join(output,"tactical-memory-ablation-summary.json")).stopReason,"source-pool-exhausted");
    const manifest=read<any>(path.join(output,"tactical-memory-ablation-manifest.json"));assert.equal(manifest.runs.length,2);for(const record of manifest.runs){const value=read<any>(path.join(record.directory,"tactical-memory-ablation-sample.json"));assert.equal(value.sourceVerified,true);assert.equal(value.confidence,.8);}
    const importedOutput=path.join(temporary,"imported-output"),importCommand=[...base];importCommand[importCommand.indexOf("--out")+1]=importedOutput;run([...importCommand,"--existing",output]);const imported=read<any>(path.join(importedOutput,"tactical-memory-ablation-summary.json"));assert.equal(imported.completed,2);assert.equal(imported.imported,2);assert.equal(directorySize(importedOutput)<directorySize(output),true);
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}

function run(command:string[]):void{const result=spawnSync(process.execPath,command,{cwd:process.cwd(),encoding:"utf8",maxBuffer:64*1024*1024});assert.equal(result.status,0,result.stderr||result.stdout);}
function read<T>(file:string):T{return JSON.parse(fs.readFileSync(file,"utf8")) as T;}
function directorySize(directory:string):number{let total=0;for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const target=path.join(directory,entry.name);total+=entry.isDirectory()?directorySize(target):fs.statSync(target).size;}return total;}
main().then(()=>console.log("Tactical memory ablation smoke test passed")).catch(error=>{console.error(error);process.exitCode=1;});
