import fs from "node:fs";
import path from "node:path";
import {evaluateBattleAssistGate} from "../ai/whiteBox/battle";
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
  const sourceTraces = read<AiDecisionTrace[]>(path.join(source, "ai-decisions.json"));
  const requestedOrdinal = optionalInteger(args, "--decision-ordinal");
  const candidates = sourceTraces.map(trace => battleCase(trace)).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const target = requestedOrdinal === null ? candidates.find(entry => entry.gate.recommended) : candidates.find(entry => entry.trace.decisionOrdinal === requestedOrdinal);
  if (!target) throw new Error(requestedOrdinal === null ? "No gate-approved battle disagreement was found" : `Decision ordinal ${requestedOrdinal} is not a white-box disagreement`);
  if (!target.gate.recommended) throw new Error(`Decision ordinal ${target.trace.decisionOrdinal} failed battle assist gate: ${target.gate.hardRejections.join(",")}`);

  const common = {...capsule.input, seed: "explicit-replay", explicitSeed: capsule.input.seed, gameIndex: 0};
  const incumbent = await runBattle({...common, outDir: path.join(out, "incumbent")});
  const incumbentTraces = read<AiDecisionTrace[]>(incumbent.decisionLogPath);
  const sourceVerified = JSON.stringify(incumbentTraces) === JSON.stringify(sourceTraces);
  if (!sourceVerified) throw new Error("Exact incumbent replay diverged from retained decision trace");

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
  const prefixVerified = JSON.stringify(whiteboxTraces.slice(0, prefixLength)) === JSON.stringify(sourceTraces.slice(0, prefixLength));
  if (!prefixVerified) throw new Error("White-box branch diverged before the target battle decision");
  const applied = whiteboxTraces[prefixLength];
  if (applied?.incumbentSelected !== intervention.expectedIncumbent || applied.selected !== intervention.selected || !applied.intervention?.applied) {
    throw new Error("White-box branch did not apply the requested decision intervention");
  }
  const summary = {
    schemaVersion: 1,
    sourceGame: source,
    replayInputSha256: capsule.sha256,
    aiVersion: AI_VERSION,
    sourceVerified,
    prefixVerified,
    intervention,
    gate: target.gate,
    incumbent: outcome(incumbent),
    whitebox: outcome(whitebox),
    outcomeChanged: incumbent.winner !== whitebox.winner || incumbent.turns !== whitebox.turns || incumbent.timeout !== whitebox.timeout,
  };
  write(path.join(out, "counterfactual-summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
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
function write(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
