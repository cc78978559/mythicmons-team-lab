import type {AcademyContractConcessionShadow} from "../../draft/academyContracts";
import type {ManagerMarketPreferences} from "../../draft/academyTalentMarket";

export function evaluateAcademyContractConcession(input: {decisionId: string; incumbentStatus: "arbitrated" | "released"; demand: number; offer: number; maximumSalary: number; academyFit: number; preferences: ManagerMarketPreferences}): AcademyContractConcessionShadow {
  const components = {
    base: .02,
    loyalty: input.preferences.loyalty * .07,
    cultureFit: clamp(input.academyFit) * .04,
    security: (1 - input.preferences.ambition) * .05,
    opportunity: input.preferences.opportunityNeed * .03,
    ambitionPenalty: -input.preferences.ambition * .06,
  };
  const concessionRate = Math.max(0, Math.min(.18, Object.values(components).reduce((sum, value) => sum + value, 0)));
  const minimumAcceptableSalary = input.demand * (1 - concessionRate), relativeGap = input.demand > 1e-9 ? (input.demand - input.offer) / input.demand : 0;
  const selected = input.offer + 1e-9 >= minimumAcceptableSalary ? "accept-offer" as const : "incumbent" as const;
  return {version: "academy-contract-concession-v1", decisionId: input.decisionId, incumbentStatus: input.incumbentStatus, selected, agrees: selected === "incumbent", demand: input.demand, offer: input.offer, maximumSalary: input.maximumSalary, minimumAcceptableSalary, relativeGap, concessionRate, academyFit: clamp(input.academyFit), preferences: {...input.preferences}, components};
}
function clamp(value: number): number { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : .5)); }
