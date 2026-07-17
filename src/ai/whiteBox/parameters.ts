export const WHITE_BOX_PARAMETER_SCHEMA_VERSION = 1;

export type WhiteBoxParameterScope = "global" | "manager";

export interface WhiteBoxNumberParameter {
  id: string;
  description: string;
  scope: WhiteBoxParameterScope;
  defaultValue: number;
  minimum: number;
  maximum: number;
  version: number;
}

export interface WhiteBoxParameterSnapshot {
  schemaVersion: typeof WHITE_BOX_PARAMETER_SCHEMA_VERSION;
  values: Record<string, number>;
}

export class WhiteBoxParameterRegistry {
  private readonly definitions = new Map<string, WhiteBoxNumberParameter>();

  constructor(definitions: readonly WhiteBoxNumberParameter[]) {
    for (const definition of definitions) this.register(definition);
  }

  get size(): number {
    return this.definitions.size;
  }

  definition(id: string): WhiteBoxNumberParameter {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Unknown white-box parameter: ${id}`);
    return {...definition};
  }

  allDefinitions(): WhiteBoxNumberParameter[] {
    return [...this.definitions.values()].map(definition => ({...definition}));
  }

  snapshot(overrides: Readonly<Record<string, number>> = {}): WhiteBoxParameterSnapshot {
    for (const id of Object.keys(overrides)) if (!this.definitions.has(id)) throw new Error(`Unknown white-box parameter override: ${id}`);
    const values: Record<string, number> = {};
    for (const definition of this.definitions.values()) {
      const value = overrides[definition.id] ?? definition.defaultValue;
      validateValue(definition, value);
      values[definition.id] = value;
    }
    return {schemaVersion: WHITE_BOX_PARAMETER_SCHEMA_VERSION, values};
  }

  private register(definition: WhiteBoxNumberParameter): void {
    if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(definition.id)) throw new Error(`Invalid white-box parameter id: ${definition.id}`);
    if (!definition.description.trim()) throw new Error(`Missing description for ${definition.id}`);
    if (!Number.isInteger(definition.version) || definition.version < 1) throw new Error(`Invalid version for ${definition.id}`);
    if (!Number.isFinite(definition.minimum) || !Number.isFinite(definition.maximum) || definition.minimum > definition.maximum) throw new Error(`Invalid range for ${definition.id}`);
    if (this.definitions.has(definition.id)) throw new Error(`Duplicate white-box parameter: ${definition.id}`);
    validateValue(definition, definition.defaultValue);
    this.definitions.set(definition.id, {...definition});
  }
}

export const BATTLE_SHADOW_PARAMETERS = new WhiteBoxParameterRegistry([
  {
    id: "battle.reasonableband",
    description: "Maximum rational-score deficit that remains eligible for personality influence.",
    scope: "global",
    defaultValue: 12,
    minimum: 0,
    maximum: 50,
    version: 1,
  },
  {
    id: "battle.stylelimit",
    description: "Maximum absolute personality and memory contribution to a battle choice.",
    scope: "global",
    defaultValue: 15,
    minimum: 0,
    maximum: 30,
    version: 1,
  },
  numeric("battle.assistminimumrationalgain", "Minimum rational-score improvement required for a battle-choice intervention.", .5, 0, 50, "global", 2),
  numeric("battle.assistmaximumfinalregression", "Maximum final-score regression allowed for a rational battle correction.", 2, 0, 30, "global", 2),
  numeric("battle.assistmaximumriskregression", "Maximum combined downside and worst-case regression allowed for a battle correction.", 1, 0, 30, "global", 2),
]);

export const LINEUP_SHADOW_PARAMETERS = new WhiteBoxParameterRegistry([
  {
    id: "lineup.reasonableband",
    description: "Maximum rational-score deficit that remains eligible for lineup personality influence.",
    scope: "global",
    defaultValue: .25,
    minimum: 0,
    maximum: 5,
    version: 1,
  },
  {
    id: "lineup.stylelimit",
    description: "Maximum absolute personality, memory, and strategy contribution to a lineup.",
    scope: "global",
    defaultValue: 2,
    minimum: 0,
    maximum: 5,
    version: 1,
  },
  numeric("lineup.assistminimummargin", "Minimum net score advantage required for a personality-weighted lineup assist.", .001, 0, .1, "global", 2),
  numeric("lineup.assistmaximumrationalregression", "Maximum rational-score regression allowed for a lineup assist.", .1, 0, 1, "global", 2),
  numeric("lineup.assistminimumsignals", "Minimum independent positive personality or memory contributions required for lineup assist.", 2, 1, 6, "global", 2),
  numeric("lineup.assistmaximumstructureregression", "Maximum regression allowed across declared role coverage and baseline structure.", 0, 0, 1, "global", 2),
]);

export const KEEPER_SHADOW_PARAMETERS = new WhiteBoxParameterRegistry([
  {
    id: "keeper.reasonableband",
    description: "Maximum production-score deficit that remains eligible for retention personality influence.",
    scope: "global",
    defaultValue: 2,
    minimum: 0,
    maximum: 10,
    version: 1,
  },
  {
    id: "keeper.stylelimit",
    description: "Maximum absolute personality, relationship, and salary-risk contribution to a keeper portfolio.",
    scope: "global",
    defaultValue: 6,
    minimum: 0,
    maximum: 20,
    version: 1,
  },
  {
    id: "keeper.replacementfriction",
    description: "Rational cost avoided when a controlled roster slot does not need to be reacquired.",
    scope: "global",
    defaultValue: .35,
    minimum: 0,
    maximum: 3,
    version: 2,
  },
  {
    id: "keeper.depthinsurance",
    description: "Rational depth and availability insurance contributed by each retained member.",
    scope: "global",
    defaultValue: .15,
    minimum: 0,
    maximum: 2,
    version: 2,
  },
]);

export const ACQUISITION_SHADOW_PARAMETERS = new WhiteBoxParameterRegistry([
  {
    id: "acquire.reasonableband",
    description: "Maximum competence-and-goal deficit that remains eligible for acquisition personality influence.",
    scope: "global",
    defaultValue: .05,
    minimum: 0,
    maximum: 5,
    version: 1,
  },
  {
    id: "acquire.stylelimit",
    description: "Maximum absolute personality, strategy, and exploration contribution to an acquisition choice.",
    scope: "global",
    defaultValue: 3,
    minimum: 0,
    maximum: 10,
    version: 1,
  },
]);

export const REGISTRATION_SHADOW_PARAMETERS = new WhiteBoxParameterRegistry([
  {
    id: "registration.reasonableband",
    description: "Maximum competence-and-goal deficit that remains eligible for public-registration personality influence.",
    scope: "global",
    defaultValue: .1,
    minimum: 0,
    maximum: 5,
    version: 1,
  },
  {
    id: "registration.stylelimit",
    description: "Maximum absolute personality, system, and exploration contribution to a public registration.",
    scope: "global",
    defaultValue: 3,
    minimum: 0,
    maximum: 10,
    version: 1,
  },
]);

export const BID_SHADOW_PARAMETERS = new WhiteBoxParameterRegistry([
  numeric("bid.standard.marketweight", "Reference-market contribution to a standard bid.", .65, 0, 2),
  numeric("bid.standard.starpremiumweight", "Manager star-premium contribution to a standard bid.", .3, 0, 2),
  numeric("bid.standard.fitweight", "Roster-fit contribution to a standard bid.", 2.5, 0, 10),
  numeric("bid.standard.aggressionweight", "Manager aggression contribution to a standard bid.", 2, 0, 10),
  numeric("bid.sports.fundamentalweight", "Independent-fundamental contribution in sports-market mode.", .8, 0, 2),
  numeric("bid.sports.aggressionweight", "Manager aggression contribution in sports-market mode.", .25, 0, 2),
  numeric("bid.sports.marketweight", "Weak reference-market anchor in sports-market mode.", .2, 0, 1),
  numeric("bid.cashdisciplineweight", "Cash-utility penalty reserved for remaining roster needs.", 1, 0, 5),
  numeric("bid.shadescale", "Seeded strategic bid-shading scale.", 700, 0, 2000),
]);

export const MARKET_FLOW_SHADOW_PARAMETERS = new WhiteBoxParameterRegistry([
  numeric("trade.acceptancebase", "Base one-sided utility loss tolerated in a mutually beneficial trade.", 2, 0, 10),
  numeric("trade.contenderbuffer", "Additional short-term utility loss tolerated by a contender.", 4, 0, 10),
  numeric("trade.minimumsurplus", "Minimum combined utility gain required for a trade.", .1, 0, 10),
  numeric("trade.minimumcoverageweight", "Utility weight for preserving role-target minimum coverage after a trade.", 4, 0, 12),
  numeric("trade.targetdepthweight", "Utility weight for improving depth between each role minimum and target.", .2, 0, 6, "global", 2),
  numeric("trade.typepressureweight", "Utility weight for reducing unbuffered repeated type weaknesses after a trade.", .15, 0, 2),
  numeric("trade.assistminimummargin", "Minimum white-box rational advantage required before a trade may enter assisted testing.", .25, 0, 5),
  numeric("trade.assistmaximumsideregression", "Maximum augmented utility regression allowed for either trade participant.", .25, 0, 5),
  numeric("trade.assistminimumsignals", "Minimum independent structural improvements required for assisted testing.", 2, 1, 3),
  numeric("waiver.poorrecordweight", "Waiver-priority weight for inverse winning percentage.", .6, 0, 1),
  numeric("waiver.waitweight", "Waiver-priority weight for time since a successful claim.", .4, 0, 1),
  numeric("waiver.waitrounds", "Rounds required to saturate the waiting-time priority component.", 16, 1, 100),
  numeric("waiver.minimumupgrade", "Minimum manager-value ratio required to submit a waiver claim.", 1.04, 1, 2),
  numeric("freeagent.minimumupgrade", "Minimum strength ratio when a free agent does not fill a missing role.", 1.06, 1, 2),
  numeric("background.minimumupgrade", "Minimum manager-value ratio for a public background-member adjustment.", 1.035, 1, 2),
  numeric("background.switchcostrate", "Experimental continuity cost rate for replacing a fully used public member; disabled after paired rejection.", 0, 0, .2, "global", 2),
  numeric("market.minimumcash", "Minimum available cash required for an in-season acquisition.", 2, 0, 20),
  numeric("market.costrate", "Fraction of reference market value charged for an in-season acquisition.", .35, 0, 1),
]);

export const LEARNING_SHADOW_PARAMETERS = new WhiteBoxParameterRegistry([
  numeric("learning.priorretention", "Fraction of prior effective samples retained each season.", .94, 0, 1),
  numeric("learning.minimumsamples", "Minimum effective sample mass retained for every trait.", 2, 1, 12),
  numeric("learning.maximumsamples", "Maximum effective sample mass for a trait posterior.", 12, 2, 100),
  numeric("learning.samplesperseason", "Maximum new effective sample mass contributed by one season.", 1, 0, 4),
  numeric("learning.confidencespan", "Effective samples above the minimum required for full confidence.", 6, 1, 30),
  numeric("learning.traitgain", "Posterior-to-personality mapping gain.", 1.6, 0, 4),
  numeric("learning.maximumtraitdelta", "Maximum absolute personality change allowed in one season.", .2, 0, .5),
  numeric("learning.explorationstart", "Initial scale of the scheduled exploration curve.", .8, 0, 1),
  numeric("learning.explorationdecayseasons", "Season time constant of exploration decay.", 8, 1, 100),
  numeric("learning.explorationfloor", "Minimum scheduled exploration retained long term.", .12, 0, 1),
]);

export const EVOLUTION_SHADOW_PARAMETERS = new WhiteBoxParameterRegistry([
  numeric("evolution.crossoverrate", "Probability of selecting a second parent for an unprotected descendant.", .12, 0, 1),
  numeric("evolution.traitrate", "Per-trait mutation probability.", .22, 0, 1),
  numeric("evolution.traitscale", "Maximum absolute trait mutation.", .12, 0, .5),
  numeric("evolution.economicsrate", "Per-economics-gene mutation probability.", .12, 0, 1),
  numeric("evolution.economicsscale", "Maximum absolute economics-gene mutation.", .1, 0, .5),
  numeric("evolution.tacticsrate", "Per-tactics-gene mutation probability.", .1, 0, 1),
  numeric("evolution.tacticsscale", "Maximum absolute tactics-gene mutation.", .16, 0, .5),
  numeric("evolution.rolerate", "Per-role-gene mutation probability.", .08, 0, 1),
  numeric("evolution.rolescale", "Maximum absolute role-gene mutation.", .2, 0, .5),
  numeric("evolution.configurationrate", "Per-configuration-gene mutation probability.", .08, 0, 1),
  numeric("evolution.configurationscale", "Maximum absolute configuration-gene mutation.", .18, 0, .5),
  numeric("evolution.systemsrate", "Per-system-gene mutation probability.", .07, 0, 1),
  numeric("evolution.systemsscale", "Maximum absolute system-gene mutation.", .18, 0, .5),
  numeric("evolution.organizationrate", "Per-organization-gene mutation probability.", .08, 0, 1),
  numeric("evolution.organizationscale", "Maximum absolute organization-gene mutation.", .15, 0, .5),
  numeric("evolution.learningrate", "Mutation probability for learning-rate and memory genes.", .08, 0, 1),
  numeric("evolution.explorationrate", "Mutation probability for the exploration gene.", .1, 0, 1),
  numeric("evolution.programrate", "Strategy-program mutation probability when program evolution is enabled.", .7, 0, 1),
]);

export const MEMORY_SHADOW_PARAMETERS = new WhiteBoxParameterRegistry([
  numeric("memory.tactical.maximumsamples", "Maximum effective samples retained in a tactical posterior.", 24, 1, 100),
  numeric("memory.tactical.confidencesamples", "Effective tactical samples required for full confidence.", 8, 1, 50),
  numeric("memory.tactical.episodelimit", "Maximum raw tactical episodes retained per opponent.", 32, 1, 200),
  numeric("memory.configuration.priorretention", "Fraction of prior configuration samples retained.", .94, 0, 1),
  numeric("memory.configuration.minimumsamples", "Minimum configuration sample mass.", 2, 1, 12),
  numeric("memory.configuration.maximumsamples", "Maximum configuration sample mass.", 24, 2, 100),
  numeric("memory.configuration.confidencespan", "Configuration samples above the minimum required for full confidence.", 10, 1, 50),
  numeric("memory.configuration.moveweight", "Maximum evidence weight contributed by move uses.", 4, 1, 20),
  numeric("memory.configuration.itemweight", "Maximum evidence weight contributed by item triggers.", 3, 1, 20),
  numeric("memory.configuration.programweight", "Maximum strategy-program adjustment to move evidence.", .08, 0, .5),
]);

export const ALL_WHITE_BOX_PARAMETER_REGISTRIES = {
  battle: BATTLE_SHADOW_PARAMETERS,
  lineup: LINEUP_SHADOW_PARAMETERS,
  keeper: KEEPER_SHADOW_PARAMETERS,
  acquisition: ACQUISITION_SHADOW_PARAMETERS,
  registration: REGISTRATION_SHADOW_PARAMETERS,
  bid: BID_SHADOW_PARAMETERS,
  marketFlow: MARKET_FLOW_SHADOW_PARAMETERS,
  learning: LEARNING_SHADOW_PARAMETERS,
  evolution: EVOLUTION_SHADOW_PARAMETERS,
  memory: MEMORY_SHADOW_PARAMETERS,
} as const;

function numeric(id: string, description: string, defaultValue: number, minimum: number, maximum: number, scope: WhiteBoxParameterScope = "global", version = 1): WhiteBoxNumberParameter {
  return {id, description, scope, defaultValue, minimum, maximum, version};
}

function validateValue(definition: WhiteBoxNumberParameter, value: number): void {
  if (!Number.isFinite(value) || value < definition.minimum || value > definition.maximum) {
    throw new Error(`White-box parameter ${definition.id} must be within ${definition.minimum}..${definition.maximum}`);
  }
}
