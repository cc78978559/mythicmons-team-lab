import type {WhiteBoxCandidate, WhiteBoxContribution} from "./decision";

export interface WhiteBoxKeeperMember {
  id: string;
  family?: string;
  salary: number;
  regularSeasonContribution: number;
  usageValue: number;
  starPreference: number;
  continuity: number;
  scarcePreference: number;
  valuePenalty: number;
  replacementFriction?: number;
  depthInsurance?: number;
}

export interface WhiteBoxKeeperPortfolioInput {
  id: string;
  members: readonly WhiteBoxKeeperMember[];
  keeperLimit: number;
  salaryCap: number;
}

export function buildKeeperPortfolioCandidate(input: WhiteBoxKeeperPortfolioInput): WhiteBoxCandidate {
  const hardRejections: string[] = [];
  const salary = input.members.reduce((total, member) => total + member.salary, 0);
  if (input.members.length > input.keeperLimit) hardRejections.push(`keeper-limit:${input.members.length}>${input.keeperLimit}`);
  if (salary > input.salaryCap) hardRejections.push(`keeper-cap:${salary}>${input.salaryCap}`);
  const families = input.members.map(member => member.family).filter((family): family is string => Boolean(family));
  if (new Set(families).size !== families.length) hardRejections.push("duplicate-family");
  const rational: WhiteBoxContribution[] = [
    contribution("keeper.production", "production", "competence", sum(input.members, member => member.regularSeasonContribution), "Regular-season appearances and knockouts"),
    contribution("keeper.usage", "production", "competence", sum(input.members, member => member.usageValue), "Regular-season knockout rate"),
    contribution("keeper.replacement", "roster", "goal", sum(input.members, member => member.replacementFriction ?? 0), "Avoided reacquisition cost and replacement uncertainty"),
    contribution("keeper.depth", "roster", "risk", sum(input.members, member => member.depthInsurance ?? 0), "Retained depth and availability insurance"),
  ];
  const style: WhiteBoxContribution[] = [
    contribution("keeper.stars", "personality", "personality", sum(input.members, member => member.starPreference), "Preference for proven premium members"),
    contribution("keeper.continuity", "relationship", "relationship", sum(input.members, member => member.continuity), "Roster continuity and accumulated tenure"),
    contribution("keeper.scarcity", "personality", "personality", sum(input.members, member => member.scarcePreference), "Preference for scarce controlled assets"),
    contribution("keeper.salary", "risk", "risk", -sum(input.members, member => member.valuePenalty), `Salary opportunity cost; committed ${salary} of ${input.salaryCap}`),
  ];
  return {id: input.id, hardRejections, rational, style};
}

export function keeperPortfolioId(memberIds: readonly string[]): string {
  return memberIds.length ? [...memberIds].sort().join("+") : "release-all";
}

export function whiteBoxKeeperMemberTotal(member: WhiteBoxKeeperMember): number {
  return member.regularSeasonContribution + member.usageValue + (member.replacementFriction ?? 0) + (member.depthInsurance ?? 0) + member.starPreference + member.continuity + member.scarcePreference - member.valuePenalty;
}

function contribution(id: string, group: string, source: WhiteBoxContribution["source"], value: number, reason: string): WhiteBoxContribution {
  return {id, group, source, value, reason};
}

function sum<T>(values: readonly T[], value: (entry: T) => number): number {
  return values.reduce((total, entry) => total + value(entry), 0);
}
