import {FORMAL_CANARY_ADAPTER_PROTOCOL} from "./formalCanaryControl";
import type {ManagerProgramPredicate, ManagerProgramRuleV2} from "./managerProgramV2";

export interface FormalBattleCanaryDomain {
  id: string;
  target: string;
  expectedDirection: "better" | "worse";
  adapterProtocol: typeof FORMAL_CANARY_ADAPTER_PROTOCOL;
  hypotheses: Array<{managerId: string; rule: ManagerProgramRuleV2}>;
}

export interface FormalBattleCanaryApplication {
  applied: boolean;
  domainId: string;
  managerId: string;
  ruleId: string | null;
  adjustment: number;
  reason: "applied" | "manager-not-covered" | "target-mismatch" | "predicate-mismatch";
}

export function evaluateFormalBattleCanary(
  domain: FormalBattleCanaryDomain,
  managerId: string,
  target: string,
  features: Readonly<Record<string, number>>,
): FormalBattleCanaryApplication {
  if (domain.adapterProtocol !== FORMAL_CANARY_ADAPTER_PROTOCOL || !domain.id || !managerId || !target || !finiteRecord(features)) throw new Error("Invalid formal battle canary request");
  if (target !== domain.target) return result(domain.id, managerId, null, 0, "target-mismatch");
  const hypothesis = domain.hypotheses.find(value => value.managerId === managerId);
  if (!hypothesis) return result(domain.id, managerId, null, 0, "manager-not-covered");
  const rule = hypothesis.rule;
  if (rule.domain !== "battle" || rule.target !== domain.target || (rule.effect > 0 ? "worse" : "better") !== domain.expectedDirection) throw new Error(`Formal canary rule differs from frozen semantics: ${rule.id}`);
  if (!rule.predicates.every(predicate => matches(predicate, features))) return result(domain.id, managerId, rule.id, 0, "predicate-mismatch");
  return result(domain.id, managerId, rule.id, rule.effect, "applied");
}

function result(domainId: string, managerId: string, ruleId: string | null, adjustment: number, reason: FormalBattleCanaryApplication["reason"]): FormalBattleCanaryApplication {
  return {applied: reason === "applied", domainId, managerId, ruleId, adjustment, reason};
}

function matches(predicate: ManagerProgramPredicate, features: Readonly<Record<string, number>>): boolean {
  const value = features[predicate.feature];
  return Number.isFinite(value) && (predicate.operator === "gte" ? value >= predicate.threshold : value < predicate.threshold);
}

function finiteRecord(value: Readonly<Record<string, number>>): boolean { return Object.values(value).every(Number.isFinite); }
