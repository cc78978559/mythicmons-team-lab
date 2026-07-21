import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {loadBattleReplayCapsule, runBattle, type BattleResult} from "../showdown/battle";
import {AI_VERSION, type AiDecisionTrace} from "../showdown/choice";
import type {TacticalMemoryAblationSample} from "../ai/whiteBox/tacticalMemoryAblation";

const args = process.argv.slice(2);
const sourceGame = path.resolve(required("--source-game")), out = path.resolve(option("--out", "output/tactical-memory-counterfactual"));
const playerId = required("--player") as "p1" | "p2", candidatePolicy = required("--candidate-policy");
if (playerId !== "p1" && playerId !== "p2") throw new Error("--player must be p1 or p2");

async function main(): Promise<void> {
  if (fs.existsSync(out)) throw new Error(`Counterfactual output already exists: ${out}`);
  const capsule = loadBattleReplayCapsule(path.join(sourceGame, "replay-input.json"));
  if (capsule.input.aiVersion !== AI_VERSION || capsule.input.ai !== "search" || !capsule.input.traceAiDecisions) throw new Error("Tactical-memory source is not replay-compatible with the current search AI");
  if (capsule.input.battleAssistScopes?.length) throw new Error("Tactical-memory source used active battle assist");
  const candidateModel = capsule.input.aiOpponentModelShadows?.[candidatePolicy]?.[playerId];
  if (!candidateModel) throw new Error(`Missing ${candidatePolicy} shadow memory for ${playerId}`);
  if (JSON.stringify(candidateModel) === JSON.stringify(capsule.input.aiOpponentModels[playerId])) throw new Error("Candidate memory is identical to the incumbent memory");
  const sourceTraces = readEvidence<AiDecisionTrace[]>(sourceGame, "ai-decisions.json");
  const common = {...capsule.input, seed: "exact-tactical-memory-replay", explicitSeed: capsule.input.seed, gameIndex: 0};
  const incumbent = await runBattle({...common, outDir: path.join(out, "incumbent")});
  const incumbentTraces = read<AiDecisionTrace[]>(incumbent.decisionLogPath), sourceVerified = JSON.stringify(sourceTraces) === JSON.stringify(incumbentTraces);
  if (!sourceVerified) throw new Error("Exact incumbent replay diverged from retained source");
  const models = structuredClone(capsule.input.aiOpponentModels); models[playerId] = structuredClone(candidateModel);
  const candidate = await runBattle({...common, outDir: path.join(out, "candidate"), aiOpponentModels: models, aiOpponentModelPolicy: candidatePolicy});
  const candidateTraces = read<AiDecisionTrace[]>(candidate.decisionLogPath);
  const sample: TacticalMemoryAblationSample = {
    seed: capsule.input.seed.join("-"), caseId: `${capsule.sha256}:${playerId}:${candidatePolicy}`, playerId,
    confidence: capsule.input.aiOpponentModels[playerId].confidence, candidatePolicy, sourceVerified,
    firstDivergenceOrdinal: firstDivergence(candidateTraces, incumbentTraces, playerId), learned: outcome(candidate), ablated: outcome(incumbent),
  };
  write(path.join(out, "tactical-memory-ablation-sample.json"), sample);
  write(path.join(out, "counterfactual-summary.json"), {schemaVersion: 1, sourceGame, replaySha256: capsule.sha256, intervention: {playerId, candidatePolicy}, ...sample});
  console.log(JSON.stringify({sourceVerified, playerId, candidatePolicy, firstDivergenceOrdinal: sample.firstDivergenceOrdinal, out}, null, 2));
}

function firstDivergence(candidate: AiDecisionTrace[], incumbent: AiDecisionTrace[], side: "p1" | "p2"): number | null { const left=candidate.filter(value=>value.playerId===side),right=incumbent.filter(value=>value.playerId===side),count=Math.min(left.length,right.length);for(let index=0;index<count;index+=1)if(left[index].turn!==right[index].turn||left[index].selected!==right[index].selected)return left[index].decisionOrdinal??index+1;return left.length===right.length?null:left[count]?.decisionOrdinal??right[count]?.decisionOrdinal??count+1; }
function outcome(value: BattleResult) { return {winner:value.winner,turns:value.turns,ended:value.ended,timeout:value.timeout,stalled:value.stalled,errors:[...value.errors]}; }
function readEvidence<T>(directory:string,name:string):T { const plain=path.join(directory,name),compressed=`${plain}.gz`;if(fs.existsSync(plain))return read<T>(plain);if(fs.existsSync(compressed))return JSON.parse(zlib.gunzipSync(fs.readFileSync(compressed)).toString("utf8")) as T;throw new Error(`Missing retained evidence: ${plain}[.gz]`); }
function write(file:string,value:unknown):void { fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,`${JSON.stringify(value,null,2)}\n`,"utf8"); }
function read<T>(file:string):T { return JSON.parse(fs.readFileSync(file,"utf8")) as T; }
function option(name:string,fallback:string):string { const index=args.indexOf(name);return index>=0?args[index+1]??fallback:fallback; }
function required(name:string):string { const value=option(name,"").trim();if(!value)throw new Error(`Missing ${name}`);return value; }

main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
