export interface LineupSpeedCausalChoice {
  id: string;
  decisionId: string;
  season: number;
  managerId: string;
  sourceOutcome: "win" | "loss";
  incumbentId: string;
  candidateId: string;
  deltas: {speedAdvantageMean: number; strengthFloor: number; roleTagBreadth: number};
}

export interface LineupSpeedCausalPlan {
  schemaVersion: 1;
  hypothesis: {
    primaryFeature: "lineup.speedAdvantageMean";
    direction: "increase";
    guardrails: {minimumStrengthFloorDelta: number; minimumRoleTagBreadthDelta: number};
    primaryOutcome: "local-pair-margin";
    analysisUnit: "manager";
  };
  requested: number;
  availableChoices: number;
  availableManagers: number;
  selected: LineupSpeedCausalChoice[];
  coverage: {seasons: Record<string, number>; sourceOutcomes: Record<"win" | "loss", number>; managers: number};
}

export function buildLineupSpeedCausalPlan(choices: readonly LineupSpeedCausalChoice[], requested = 24): LineupSpeedCausalPlan {
  if (!Number.isInteger(requested) || requested < 6 || requested > 30 || requested % 6 !== 0) throw new Error("requested speed causal cases must be a multiple of six within 6..30");
  const eligible = choices.filter(choice => choice.deltas.speedAdvantageMean > 1e-9 && choice.deltas.strengthFloor >= -5 && choice.deltas.roleTagBreadth >= -1);
  const unique = new Map<string, LineupSpeedCausalChoice>();
  for (const choice of eligible) {
    const key = `${choice.managerId}:${choice.season}:${choice.sourceOutcome}`;
    const current = unique.get(key);
    if (!current || compareChoice(choice, current) < 0) unique.set(key, choice);
  }
  const seasons = [...new Set(eligible.map(choice => choice.season))].sort((left, right) => left - right);
  if (seasons.length !== 3) throw new Error(`Speed causal plan requires exactly three seasons, found ${seasons.length}`);
  const perStratum = requested / 6;
  const slots = seasons.flatMap(season => (["win", "loss"] as const).flatMap(outcome => Array.from({length: perStratum}, (_, index) => `${season}:${outcome}:${index}`)));
  const byManager = new Map<string, LineupSpeedCausalChoice[]>();
  for (const choice of unique.values()) {
    const values = byManager.get(choice.managerId) ?? [];
    values.push(choice); byManager.set(choice.managerId, values);
  }
  const slotManager = new Map<string, string>();
  const managers = [...byManager.keys()].sort((left, right) => distinctStrata(byManager.get(left)!) - distinctStrata(byManager.get(right)!) || left.localeCompare(right));
  for (const manager of managers) assign(manager, new Set());
  const managerSlot = new Map([...slotManager].map(([slot, manager]) => [manager, slot]));
  const selected = [...managerSlot].map(([manager, slot]) => {
    const [season, outcome] = slot.split(":");
    return byManager.get(manager)!.filter(choice => choice.season === Number(season) && choice.sourceOutcome === outcome).sort(compareChoice)[0];
  }).sort((left, right) => left.season - right.season || left.sourceOutcome.localeCompare(right.sourceOutcome) || left.managerId.localeCompare(right.managerId));
  if (selected.length < requested) throw new Error(`Only ${selected.length}/${requested} manager-unique balanced speed interventions are available`);
  const final = selected.slice(0, requested);
  return {
    schemaVersion: 1,
    hypothesis: {
      primaryFeature: "lineup.speedAdvantageMean",
      direction: "increase",
      guardrails: {minimumStrengthFloorDelta: -5, minimumRoleTagBreadthDelta: -1},
      primaryOutcome: "local-pair-margin",
      analysisUnit: "manager",
    },
    requested,
    availableChoices: eligible.length,
    availableManagers: new Set(eligible.map(choice => choice.managerId)).size,
    selected: final,
    coverage: {
      seasons: Object.fromEntries(seasons.map(season => [String(season), final.filter(choice => choice.season === season).length])),
      sourceOutcomes: {win: final.filter(choice => choice.sourceOutcome === "win").length, loss: final.filter(choice => choice.sourceOutcome === "loss").length},
      managers: new Set(final.map(choice => choice.managerId)).size,
    },
  };

  function assign(manager: string, visitedSlots: Set<string>): boolean {
    const strata = [...new Set(byManager.get(manager)!.map(choice => `${choice.season}:${choice.sourceOutcome}`))].sort();
    for (const stratum of strata) {
      for (const slot of slots.filter(value => value.startsWith(`${stratum}:`))) {
        if (visitedSlots.has(slot)) continue;
        visitedSlots.add(slot);
        const displaced = slotManager.get(slot);
        if (!displaced || assign(displaced, visitedSlots)) {
          slotManager.set(slot, manager);
          return true;
        }
      }
    }
    return false;
  }
}

function compareChoice(left: LineupSpeedCausalChoice, right: LineupSpeedCausalChoice): number {
  return right.deltas.speedAdvantageMean - left.deltas.speedAdvantageMean
    || right.deltas.strengthFloor - left.deltas.strengthFloor
    || right.deltas.roleTagBreadth - left.deltas.roleTagBreadth
    || left.id.localeCompare(right.id);
}
function distinctStrata(choices: readonly LineupSpeedCausalChoice[]): number { return new Set(choices.map(choice => `${choice.season}:${choice.sourceOutcome}`)).size; }
