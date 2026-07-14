import fs from "node:fs";
import type {AiDecisionTrace} from "../showdown/choice";

export interface KeyBattleDecision {
  turn: number;
  playerId: "p1" | "p2";
  selected: string;
  selectedScore: number;
  runnerUp: string | null;
  runnerUpScore: number | null;
  margin: number | null;
  kind: "close-call" | "switch" | "tera" | "strategic-move" | "high-downside";
  rationale: string[];
  personalityId: string;
}

const STRATEGIC_MOVES = new Set(["stealthrock", "spikes", "toxicspikes", "stickyweb", "defog", "rapidspin", "tidyup", "trickroom", "reflect", "lightscreen", "auroraveil", "nastyplot", "swordsdance", "dragondance", "shellsmash", "recover", "roost", "wish", "trick", "encore", "taunt", "yawn"]);

export function extractKeyBattleDecisions(decisionLogPath: string, limit = 6): KeyBattleDecision[] {
  const traces = JSON.parse(fs.readFileSync(decisionLogPath, "utf8")) as AiDecisionTrace[];
  const candidates = traces.map(trace => classifyTrace(trace)).filter((value): value is KeyBattleDecision & {importance: number} => value !== null);
  return candidates.sort((left, right) => right.importance - left.importance || left.turn - right.turn).slice(0, limit).map(({importance: _importance, ...decision}) => decision);
}

function classifyTrace(trace: AiDecisionTrace): (KeyBattleDecision & {importance: number}) | null {
  const ranked = [...trace.candidates].sort((left, right) => right.score - left.score);
  const selected = ranked.find(candidate => candidate.choice === trace.selected) ?? ranked[0];
  if (!selected) return null;
  const runnerUp = ranked.find(candidate => candidate.choice !== selected.choice) ?? null;
  const margin = runnerUp ? selected.score - runnerUp.score : null;
  const moveId = trace.selected.match(/^move\s+([^\s]+)/)?.[1] ?? "";
  let kind: KeyBattleDecision["kind"] | null = null;
  let importance = 0;
  const rationale: string[] = [];
  if (Math.abs(selected.personalityAdjustment) >= .01) rationale.push(`${trace.personalityId}人格修正${selected.personalityAdjustment > 0 ? "+" : ""}${selected.personalityAdjustment.toFixed(2)}`);
  if (margin !== null && margin <= 10) { kind = "close-call"; importance += 30 - Math.max(0, margin); rationale.push(`与第二方案仅差${margin.toFixed(2)}`); }
  if (trace.selected.startsWith("switch ")) { kind = kind ?? "switch"; importance += 18; rationale.push("主动改变对位"); }
  if (trace.selected.includes("terastallize")) { kind = "tera"; importance += 35; rationale.push("投入一次性太晶资源"); }
  if (STRATEGIC_MOVES.has(moveId)) { kind = kind ?? "strategic-move"; importance += 20; rationale.push("执行场地、强化、回复或限制计划"); }
  if (selected.downside < -40 || selected.worst < -80) { kind = kind ?? "high-downside"; importance += 12; rationale.push(`最坏估值${selected.worst.toFixed(1)}`); }
  if (!kind) return null;
  return {turn: trace.turn, playerId: trace.playerId, selected: trace.selected, selectedScore: selected.score, runnerUp: runnerUp?.choice ?? null, runnerUpScore: runnerUp?.score ?? null, margin, kind, rationale, personalityId: trace.personalityId, importance};
}
