import {evaluateWhiteBoxDecision, type WhiteBoxCandidate, type WhiteBoxContribution, type WhiteBoxDecisionTrace} from "./decision";
import {MARKET_FLOW_SHADOW_PARAMETERS} from "./parameters";

export const WHITE_BOX_MARKET_FLOW_VERSION = "white-box-market-flow-v1";
export const WHITE_BOX_TRADE_ASSIST_VERSION = "white-box-trade-assist-v1";

export interface TradeCandidateInput {
  id: string;
  leftBefore: number;
  leftAfter: number;
  rightBefore: number;
  rightAfter: number;
  leftContender: number;
  rightContender: number;
  leftMinimumCoverageChange?: number;
  rightMinimumCoverageChange?: number;
  leftTargetDepthChange?: number;
  rightTargetDepthChange?: number;
  leftTypePressureImprovement?: number;
  rightTypePressureImprovement?: number;
  duplicateFamily?: boolean;
  parameters?: Readonly<Record<string, number>>;
}

export interface TradeAssistTrace {
  version: typeof WHITE_BOX_TRADE_ASSIST_VERSION;
  decisionId: string;
  incumbent: string;
  shadow: string | null;
  recommended: boolean;
  hardRejections: string[];
  parameters: Record<string, number>;
  rationalMargin: number | null;
  leftSideRegression: number | null;
  rightSideRegression: number | null;
  supportingSignals: string[];
}

export interface WaiverPriorityInput {
  teamId: string;
  winPct: number;
  roundsSinceClaim: number;
}

export interface MarketReplacementInput {
  decisionId: string;
  mode: "waiver" | "free-agent" | "background";
  budget: number;
  rosterLegal: boolean;
  duplicateFamily: boolean;
  currentValue: number;
  targetValue: number;
  currentStrength: number;
  targetStrength: number;
  fillsNeed: boolean;
  cost: number;
  continuityEvidence?: number;
  parameters?: Readonly<Record<string, number>>;
}

export interface MarketReplacementTrace {
  version: typeof WHITE_BOX_MARKET_FLOW_VERSION;
  decisionId: string;
  mode: MarketReplacementInput["mode"];
  hardRejections: string[];
  accepted: boolean;
  parameters: Record<string, number>;
  budget: number;
  cost: number;
  currentValue: number;
  targetValue: number;
  valueRatio: number | null;
  currentStrength: number;
  targetStrength: number;
  strengthRatio: number | null;
  fillsNeed: boolean;
  thresholdSatisfied: boolean;
  continuityEvidence: number;
  switchCost: number;
}

export function buildTradeWhiteBoxCandidate(input: TradeCandidateInput): WhiteBoxCandidate {
  const parameters = MARKET_FLOW_SHADOW_PARAMETERS.snapshot(input.parameters).values;
  const leftGain = input.leftAfter - input.leftBefore;
  const rightGain = input.rightAfter - input.rightBefore;
  const leftFloor = -(parameters["trade.acceptancebase"] + parameters["trade.contenderbuffer"] * clamp01(input.leftContender));
  const rightFloor = -(parameters["trade.acceptancebase"] + parameters["trade.contenderbuffer"] * clamp01(input.rightContender));
  const minimumCoverageChange = (input.leftMinimumCoverageChange ?? 0) + (input.rightMinimumCoverageChange ?? 0);
  const targetDepthChange = (input.leftTargetDepthChange ?? 0) + (input.rightTargetDepthChange ?? 0);
  const typePressureImprovement = (input.leftTypePressureImprovement ?? 0) + (input.rightTypePressureImprovement ?? 0);
  const hardRejections: string[] = [];
  if (input.duplicateFamily) hardRejections.push("duplicate-family");
  if (leftGain < leftFloor) hardRejections.push(`left-utility:${round(leftGain)}<${round(leftFloor)}`);
  if (rightGain < rightFloor) hardRejections.push(`right-utility:${round(rightGain)}<${round(rightFloor)}`);
  if (leftGain + rightGain < parameters["trade.minimumsurplus"]) hardRejections.push(`combined-surplus:${round(leftGain + rightGain)}<${parameters["trade.minimumsurplus"]}`);
  return {
    id: input.id,
    hardRejections,
    rational: [
      contribution("trade.leftgain", "mutual-utility", "goal", leftGain, "Left manager utility change"),
      contribution("trade.rightgain", "mutual-utility", "goal", rightGain, "Right manager utility change"),
      contribution("trade.minimumcoverage", "roster-structure", "competence", minimumCoverageChange * parameters["trade.minimumcoverageweight"], "Combined change in weighted minimum role coverage"),
      contribution("trade.targetdepth", "roster-structure", "competence", targetDepthChange * parameters["trade.targetdepthweight"], "Combined change in weighted role depth above minimums"),
      contribution("trade.typepressure", "roster-structure", "risk", typePressureImprovement * parameters["trade.typepressureweight"], "Combined reduction in unbuffered repeated type weaknesses"),
    ],
  };
}

export function evaluateTradeAssistGate(decisionId: string, incumbent: TradeCandidateInput, shadow: TradeCandidateInput | undefined, parametersOverride: Readonly<Record<string, number>> = {}): TradeAssistTrace {
  const parameters = MARKET_FLOW_SHADOW_PARAMETERS.snapshot(parametersOverride).values;
  if (!Number.isInteger(parameters["trade.assistminimumsignals"])) throw new Error("trade.assistminimumsignals must be an integer");
  const hardRejections: string[] = [];
  if (!shadow || shadow.id === incumbent.id) hardRejections.push("no-shadow-difference");
  const incumbentScores = augmentedTradeScores(incumbent, parameters);
  const shadowScores = shadow ? augmentedTradeScores(shadow, parameters) : null;
  const rationalMargin = shadowScores ? shadowScores.total - incumbentScores.total : null;
  const leftSideRegression = shadowScores ? incumbentScores.left - shadowScores.left : null;
  const rightSideRegression = shadowScores ? incumbentScores.right - shadowScores.right : null;
  const supportingSignals = shadow ? structuralSignals(incumbent, shadow) : [];
  if (rationalMargin !== null && rationalMargin < parameters["trade.assistminimummargin"]) hardRejections.push(`insufficient-margin:${round(rationalMargin)}<${parameters["trade.assistminimummargin"]}`);
  if (leftSideRegression !== null && leftSideRegression > parameters["trade.assistmaximumsideregression"]) hardRejections.push(`left-side-regression:${round(leftSideRegression)}>${parameters["trade.assistmaximumsideregression"]}`);
  if (rightSideRegression !== null && rightSideRegression > parameters["trade.assistmaximumsideregression"]) hardRejections.push(`right-side-regression:${round(rightSideRegression)}>${parameters["trade.assistmaximumsideregression"]}`);
  if (supportingSignals.length < parameters["trade.assistminimumsignals"]) hardRejections.push(`insufficient-support:${supportingSignals.length}<${parameters["trade.assistminimumsignals"]}`);
  return {version: WHITE_BOX_TRADE_ASSIST_VERSION, decisionId, incumbent: incumbent.id, shadow: shadow?.id ?? null, recommended: hardRejections.length === 0, hardRejections, parameters, rationalMargin: nullableRound(rationalMargin), leftSideRegression: nullableRound(leftSideRegression), rightSideRegression: nullableRound(rightSideRegression), supportingSignals};
}

export function evaluateWaiverPriority(decisionId: string, claims: readonly WaiverPriorityInput[], parametersOverride: Readonly<Record<string, number>> = {}): WhiteBoxDecisionTrace {
  const parameters = MARKET_FLOW_SHADOW_PARAMETERS.snapshot(parametersOverride).values;
  return evaluateWhiteBoxDecision({
    decisionId,
    reasonableBand: 0,
    styleContributionLimit: 0,
    candidates: claims.map(claim => ({
      id: claim.teamId,
      rational: [
        contribution("waiver.poorrecord", "priority", "context", parameters["waiver.poorrecordweight"] * (1 - clamp01(claim.winPct)), "Priority for the lower winning percentage"),
        contribution("waiver.wait", "priority", "context", parameters["waiver.waitweight"] * clamp01(claim.roundsSinceClaim / parameters["waiver.waitrounds"]), "Priority for time since last successful claim"),
      ],
    })),
  });
}

export function evaluateMarketReplacement(input: MarketReplacementInput): MarketReplacementTrace {
  const parameters = MARKET_FLOW_SHADOW_PARAMETERS.snapshot(input.parameters).values;
  const hardRejections: string[] = [];
  if (!input.rosterLegal) hardRejections.push("roster-not-eligible");
  if (input.duplicateFamily) hardRejections.push("duplicate-family");
  if (input.budget < parameters["market.minimumcash"] || input.cost > input.budget) hardRejections.push("insufficient-cash");
  const valueRatio = input.currentValue > 0 ? input.targetValue / input.currentValue : null;
  const strengthRatio = input.currentStrength > 0 ? input.targetStrength / input.currentStrength : null;
  const continuityEvidence = clamp01(input.continuityEvidence ?? 0);
  const switchCost = input.mode === "background" ? input.currentValue * parameters["background.switchcostrate"] * continuityEvidence : 0;
  const thresholdSatisfied = input.mode === "waiver"
    ? valueRatio !== null && valueRatio >= parameters["waiver.minimumupgrade"]
    : input.mode === "background"
      ? input.targetValue >= input.currentValue * parameters["background.minimumupgrade"] + switchCost
      : input.fillsNeed || (strengthRatio !== null && strengthRatio >= parameters["freeagent.minimumupgrade"]);
  if (!thresholdSatisfied) hardRejections.push(input.mode === "waiver" || input.mode === "background" ? "insufficient-value-upgrade" : "no-need-or-strength-upgrade");
  return {
    version: WHITE_BOX_MARKET_FLOW_VERSION,
    decisionId: input.decisionId,
    mode: input.mode,
    hardRejections,
    accepted: hardRejections.length === 0,
    parameters,
    budget: input.budget,
    cost: input.cost,
    currentValue: round(input.currentValue),
    targetValue: round(input.targetValue),
    valueRatio: valueRatio === null ? null : round(valueRatio),
    currentStrength: round(input.currentStrength),
    targetStrength: round(input.targetStrength),
    strengthRatio: strengthRatio === null ? null : round(strengthRatio),
    fillsNeed: input.fillsNeed,
    thresholdSatisfied,
    continuityEvidence: round(continuityEvidence),
    switchCost: round(switchCost),
  };
}

function contribution(id: string, group: string, source: WhiteBoxContribution["source"], value: number, reason: string): WhiteBoxContribution {
  return {id, group, source, value, reason};
}

function augmentedTradeScores(input: TradeCandidateInput, parameters: Readonly<Record<string, number>>): {left: number; right: number; total: number} {
  const left = input.leftAfter - input.leftBefore
    + (input.leftMinimumCoverageChange ?? 0) * parameters["trade.minimumcoverageweight"]
    + (input.leftTargetDepthChange ?? 0) * parameters["trade.targetdepthweight"]
    + (input.leftTypePressureImprovement ?? 0) * parameters["trade.typepressureweight"];
  const right = input.rightAfter - input.rightBefore
    + (input.rightMinimumCoverageChange ?? 0) * parameters["trade.minimumcoverageweight"]
    + (input.rightTargetDepthChange ?? 0) * parameters["trade.targetdepthweight"]
    + (input.rightTypePressureImprovement ?? 0) * parameters["trade.typepressureweight"];
  return {left, right, total: left + right};
}

function structuralSignals(incumbent: TradeCandidateInput, shadow: TradeCandidateInput): string[] {
  const signals: Array<[string, number]> = [
    ["minimum-coverage", (shadow.leftMinimumCoverageChange ?? 0) + (shadow.rightMinimumCoverageChange ?? 0) - (incumbent.leftMinimumCoverageChange ?? 0) - (incumbent.rightMinimumCoverageChange ?? 0)],
    ["target-depth", (shadow.leftTargetDepthChange ?? 0) + (shadow.rightTargetDepthChange ?? 0) - (incumbent.leftTargetDepthChange ?? 0) - (incumbent.rightTargetDepthChange ?? 0)],
    ["type-pressure", (shadow.leftTypePressureImprovement ?? 0) + (shadow.rightTypePressureImprovement ?? 0) - (incumbent.leftTypePressureImprovement ?? 0) - (incumbent.rightTypePressureImprovement ?? 0)],
  ];
  return signals.filter(([, value]) => value > 1e-9).map(([id]) => id);
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function round(value: number): number { return Math.round((value + Number.EPSILON) * 1e6) / 1e6; }
function nullableRound(value: number | null): number | null { return value === null ? null : round(value); }
