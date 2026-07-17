import type {WhiteBoxCandidateTrace} from "./decision";
import {BATTLE_SHADOW_PARAMETERS} from "./parameters";

export const WHITE_BOX_BATTLE_ASSIST_VERSION = "white-box-battle-assist-v1";

export interface WhiteBoxBattleAssistGate {
  version: typeof WHITE_BOX_BATTLE_ASSIST_VERSION;
  recommended: boolean;
  hardRejections: string[];
  parameters: Record<string, number>;
  rationalGain: number | null;
  finalRegression: number | null;
  riskRegression: number | null;
}

export function evaluateBattleAssistGate(
  incumbent: WhiteBoxCandidateTrace | undefined,
  selected: WhiteBoxCandidateTrace | undefined,
  overrides: Readonly<Record<string, number>> = {},
): WhiteBoxBattleAssistGate {
  const parameters = BATTLE_SHADOW_PARAMETERS.snapshot(overrides).values;
  const hardRejections: string[] = [];
  if (!scored(incumbent) || !scored(selected)) {
    return {version: WHITE_BOX_BATTLE_ASSIST_VERSION, recommended: false, hardRejections: ["missing-candidate"], parameters, rationalGain: null, finalRegression: null, riskRegression: null};
  }
  if (!incumbent.eligible) hardRejections.push("illegal-incumbent");
  if (!selected.eligible || !selected.reasonable || selected.finalScore === null) hardRejections.push("ineligible-selection");
  const rationalGain = round(selected.rationalScore! - incumbent.rationalScore!);
  const incumbentExecutedScore = incumbent.finalScore ?? incumbent.rationalScore + incumbent.rawStyleScore;
  const selectedExecutedScore = selected.finalScore ?? selected.rationalScore + selected.rawStyleScore;
  const finalRegression = round(Math.max(0, incumbentExecutedScore - selectedExecutedScore));
  const riskRegression = round(Math.max(0, riskScore(incumbent) - riskScore(selected)));
  if (rationalGain + 1e-9 < parameters["battle.assistminimumrationalgain"]) hardRejections.push("insufficient-rational-gain");
  if (finalRegression > parameters["battle.assistmaximumfinalregression"] + 1e-9) hardRejections.push("final-score-regression");
  if (riskRegression > parameters["battle.assistmaximumriskregression"] + 1e-9) hardRejections.push("risk-regression");
  return {version: WHITE_BOX_BATTLE_ASSIST_VERSION, recommended: hardRejections.length === 0, hardRejections, parameters, rationalGain, finalRegression, riskRegression};
}

function scored(candidate: WhiteBoxCandidateTrace | undefined): candidate is WhiteBoxCandidateTrace & {rationalScore:number;rawStyleScore:number} {
  return Boolean(candidate && candidate.rationalScore !== null && candidate.rawStyleScore !== null);
}

function riskScore(candidate: WhiteBoxCandidateTrace): number {
  return candidate.contributions.filter(entry => entry.id === "battle.downside" || entry.id === "battle.worst").reduce((sum, entry) => sum + entry.value, 0);
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}
