import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {evaluateBattleAssistGate} from "../ai/whiteBox/battle";
import {SEMANTIC_DECISION_TRACE_POLICY, semanticTraceEqual} from "../ai/semanticDecisionTrace";
import {loadBattleReplayCapsule, runBattle, type BattleDecisionIntervention, type BattleResult} from "../showdown/battle";
import {AI_VERSION, type AiDecisionTrace} from "../showdown/choice";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const source = path.resolve(option(args, "--source-game", ""));
  const out = path.resolve(option(args, "--out", "output/whitebox-battle-counterfactual"));
  if (!source || !fs.existsSync(source)) throw new Error("--source-game must identify a retained battle directory");
  if (fs.existsSync(out)) throw new Error(`Output directory already exists: ${out}`);
  const capsule = loadBattleReplayCapsule(path.join(source, "replay-input.json"));
  if (capsule.input.aiVersion !== AI_VERSION) throw new Error(`Replay AI version ${capsule.input.aiVersion} differs from current ${AI_VERSION}`);
  const sourceTraces = readEvidence<AiDecisionTrace[]>(source, "ai-decisions.json");
  const requestedOrdinal = optionalInteger(args, "--decision-ordinal");
  const researchAlternative = option(args, "--research-alternative", "") || null;
  const candidates = sourceTraces.map(trace => battleCase(trace)).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const researchTarget=researchAlternative?researchBattleCase(sourceTraces,requestedOrdinal,researchAlternative):null;
  const target = researchTarget??(requestedOrdinal === null ? candidates.find(entry => entry.gate.recommended) : candidates.find(entry => entry.trace.decisionOrdinal === requestedOrdinal));
  if (!target) throw new Error(researchAlternative?`Decision ordinal ${requestedOrdinal ?? "missing"} has no eligible reasonable research alternative ${researchAlternative}`:requestedOrdinal === null ? "No gate-approved battle disagreement was found" : `Decision ordinal ${requestedOrdinal} is not a white-box disagreement`);
  if (!researchTarget&&!target.gate.recommended) throw new Error(`Decision ordinal ${target.trace.decisionOrdinal} failed battle assist gate: ${target.gate.hardRejections.join(",")}`);

  const common = {...capsule.input, seed: "explicit-replay", explicitSeed: capsule.input.seed, gameIndex: 0};
  const incumbent = await runBattle({...common, outDir: path.join(out, "incumbent")});
  const incumbentTraces = read<AiDecisionTrace[]>(incumbent.decisionLogPath);
  const sourceVerified = semanticTraceEqual(incumbentTraces, sourceTraces);
  if (!sourceVerified) throw new Error("Exact incumbent replay diverged from retained decision trace");
  if (args.includes("--verify-source-only")) {
    console.log(JSON.stringify({sourceVerified: true}));
    return;
  }

  const intervention: BattleDecisionIntervention = {
    decisionOrdinal: target.trace.decisionOrdinal!,
    playerId: target.trace.playerId,
    turn: target.trace.turn,
    expectedIncumbent: target.comparison.incumbent,
    selected: target.comparison.shadow,
  };
  const whitebox = await runBattle({...common, outDir: path.join(out, "whitebox"), decisionIntervention: intervention});
  const whiteboxTraces = read<AiDecisionTrace[]>(whitebox.decisionLogPath);
  const prefixLength = intervention.decisionOrdinal - 1;
  const prefixVerified = semanticTraceEqual(whiteboxTraces.slice(0, prefixLength), sourceTraces.slice(0, prefixLength));
  if (!prefixVerified) throw new Error("White-box branch diverged before the target battle decision");
  const applied = whiteboxTraces[prefixLength];
  if (applied?.incumbentSelected !== intervention.expectedIncumbent || applied.selected !== intervention.selected || !applied.intervention?.applied) {
    throw new Error("White-box branch did not apply the requested decision intervention");
  }
  const winnerChanged = incumbent.winner !== whitebox.winner, turnCountChanged = incumbent.turns !== whitebox.turns, timeoutChanged = incumbent.timeout !== whitebox.timeout, trajectoryChanged = winnerChanged || turnCountChanged || timeoutChanged;
  const summary = {
    schemaVersion: 1,
    sourceGame: source,
    replayInputSha256: capsule.sha256,
    aiVersion: AI_VERSION,
    sourceVerified,
    prefixVerified,
    comparisonPolicy: SEMANTIC_DECISION_TRACE_POLICY,
    intervention,
    gate: target.gate,
    evidenceStatus: researchTarget?"manager-selected-research-only":"assist-gated-counterfactual",
    activationAllowed: false,
    incumbent: outcome(incumbent),
    whitebox: outcome(whitebox),
    actionApplied: true,
    winnerChanged,
    turnCountChanged,
    timeoutChanged,
    trajectoryChanged,
    outcomeChanged: trajectoryChanged,
  };
  write(path.join(out, "counterfactual-summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}

function researchBattleCase(traces:AiDecisionTrace[],ordinal:number|null,alternative:string){
  if(ordinal===null)throw new Error("--research-alternative requires --decision-ordinal");
  const trace=traces.find(value=>value.decisionOrdinal===ordinal),decision=trace?.whiteBoxShadow?.trace;if(!trace||!decision)return null;
  const incumbent=decision.candidates.find(entry=>entry.id===trace.selected),selected=decision.candidates.find(entry=>entry.id===alternative);
  if(!incumbent?.eligible||!selected?.eligible||!selected.reasonable||selected.finalScore===null||selected.id===incumbent.id)return null;
  return{trace,comparison:{incumbent:incumbent.id,shadow:selected.id},gate:evaluateBattleAssistGate(incumbent,selected)};
}

function battleCase(trace: AiDecisionTrace) {
  const shadow = trace.whiteBoxShadow;
  if (!shadow || shadow.comparison.agrees || !shadow.comparison.shadow || !trace.decisionOrdinal) return null;
  const incumbent = shadow.trace.candidates.find(entry => entry.id === shadow.comparison.incumbent);
  const selected = shadow.trace.candidates.find(entry => entry.id === shadow.comparison.shadow!);
  return {trace, comparison: {incumbent: shadow.comparison.incumbent, shadow: shadow.comparison.shadow}, gate: evaluateBattleAssistGate(incumbent, selected)};
}

function outcome(result: BattleResult) {
  return {winner: result.winner, turns: result.turns, ended: result.ended, timeout: result.timeout, adjudication: result.adjudication, stalled: result.stalled, errors: result.errors};
}

function option(args: string[], name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function optionalInteger(args: string[], name: string): number | null { const raw = option(args, name, ""); if (!raw) return null; const value = Number(raw); if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`); return value; }
function read<T>(file: string): T { if (!fs.existsSync(file)) throw new Error(`Missing battle evidence: ${file}`); return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function readEvidence<T>(directory:string,name:string):T { const plain=path.join(directory,name),compressed=`${plain}.gz`;if(fs.existsSync(plain))return read<T>(plain);if(fs.existsSync(compressed))return JSON.parse(zlib.gunzipSync(fs.readFileSync(compressed)).toString("utf8")) as T;throw new Error(`Missing battle evidence: ${plain}[.gz]`); }
function write(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
