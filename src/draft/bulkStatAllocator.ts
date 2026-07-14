export interface BulkBaseStats {
  hp: number;
  def: number;
  spd: number;
}

export interface BulkStatAllocatorOptions {
  baseStats: BulkBaseStats;
  points: number;
  level?: number;
  iv?: number;
  ev?: number;
  defenseNature?: number;
  specialDefenseNature?: number;
  defenseMultiplier?: number;
  specialDefenseMultiplier?: number;
}

export interface BulkStatAllocation {
  added: BulkBaseStats;
  baseStats: BulkBaseStats;
  battleStats: BulkBaseStats;
  physicalBulk: number;
  specialBulk: number;
  worstCaseBulk: number;
}

/**
 * Allocates integer base-stat points to maximize the weaker of physical and
 * special effective bulk. Product of both bulks is the deterministic tie-break.
 * Nature and battle multipliers (for example Assault Vest or Fur Coat) can be
 * supplied independently so the optimization matches the intended set.
 */
export function allocateBulkStatPoints(options: BulkStatAllocatorOptions): BulkStatAllocation {
  validateOptions(options);
  let best: BulkStatAllocation | undefined;

  for (let hpPoints = 0; hpPoints <= options.points; hpPoints++) {
    for (let defPoints = 0; defPoints <= options.points - hpPoints; defPoints++) {
      const spdPoints = options.points - hpPoints - defPoints;
      const candidate = evaluateAllocation(options, {hp: hpPoints, def: defPoints, spd: spdPoints});
      if (!best || compareAllocations(candidate, best) > 0) best = candidate;
    }
  }

  if (!best) throw new Error("Bulk allocation search produced no result");
  return best;
}

function evaluateAllocation(options: BulkStatAllocatorOptions, added: BulkBaseStats): BulkStatAllocation {
  const level = options.level ?? 100;
  const iv = options.iv ?? 31;
  const ev = options.ev ?? 252;
  const baseStats = {
    hp: options.baseStats.hp + added.hp,
    def: options.baseStats.def + added.def,
    spd: options.baseStats.spd + added.spd,
  };
  const hp = calculateHp(baseStats.hp, level, iv, ev);
  const defense = calculateOtherStat(baseStats.def, level, iv, ev, options.defenseNature ?? 1)
    * (options.defenseMultiplier ?? 1);
  const specialDefense = calculateOtherStat(baseStats.spd, level, iv, ev, options.specialDefenseNature ?? 1)
    * (options.specialDefenseMultiplier ?? 1);
  const physicalBulk = hp * defense;
  const specialBulk = hp * specialDefense;

  return {
    added,
    baseStats,
    battleStats: {hp, def: defense, spd: specialDefense},
    physicalBulk,
    specialBulk,
    worstCaseBulk: Math.min(physicalBulk, specialBulk),
  };
}

function calculateHp(base: number, level: number, iv: number, ev: number): number {
  return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
}

function calculateOtherStat(base: number, level: number, iv: number, ev: number, nature: number): number {
  const raw = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5;
  return Math.floor(raw * nature);
}

function compareAllocations(left: BulkStatAllocation, right: BulkStatAllocation): number {
  if (left.worstCaseBulk !== right.worstCaseBulk) return left.worstCaseBulk - right.worstCaseBulk;
  const leftProduct = left.physicalBulk * left.specialBulk;
  const rightProduct = right.physicalBulk * right.specialBulk;
  if (leftProduct !== rightProduct) return leftProduct - rightProduct;
  if (left.added.hp !== right.added.hp) return left.added.hp - right.added.hp;
  if (left.added.def !== right.added.def) return left.added.def - right.added.def;
  return left.added.spd - right.added.spd;
}

function validateOptions(options: BulkStatAllocatorOptions): void {
  for (const [name, value] of Object.entries(options.baseStats)) {
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} base stat must be a positive integer`);
  }
  if (!Number.isInteger(options.points) || options.points < 0) throw new Error("points must be a non-negative integer");
  for (const [name, value] of Object.entries({
    defenseNature: options.defenseNature ?? 1,
    specialDefenseNature: options.specialDefenseNature ?? 1,
    defenseMultiplier: options.defenseMultiplier ?? 1,
    specialDefenseMultiplier: options.specialDefenseMultiplier ?? 1,
  })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be greater than zero`);
  }
}
