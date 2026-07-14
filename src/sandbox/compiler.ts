import {Dex, Teams, toID} from "pokemon-showdown";
import type {PokemonSet} from "pokemon-showdown/dist/sim/teams";
import type {CompiledSandbox, SandboxMember, SandboxMove, SandboxTeam} from "./types";

const MOD_ID = "mythicmons";
const FORMAT_ID = "gen9mythicmonssandbox";
const COMPOSITE_ITEM_HOOKS = [
  "onStart", "onSwitchIn", "onAnySwitchIn", "onModifyAtk", "onModifyDef", "onModifySpA", "onModifySpD", "onModifySpe",
  "onBasePower", "onModifyDamage", "onModifyMove", "onDisableMove", "onAfterMoveSecondarySelf",
  "onAfterMove", "onResidual", "onDamage", "onTryHit", "onSourceModifyDamage", "onDamagingHit", "onAfterSetStatus",
  "onAfterSubDamage",
  "onImmunity", "onUpdate", "onTryEatItem", "onEat", "onModifyCritRatio", "onSourceModifyAccuracy",
  "onModifyAccuracy", "onSetAbility",
];

export function compileSandboxTeam(sandbox: SandboxTeam, options: {namespace?: string} = {}): CompiledSandbox {
  validateSandboxTeam(sandbox);
  const namespace = toID(options.namespace ?? "").slice(0, 12);
  const modId = namespace ? `${MOD_ID}${namespace}` : MOD_ID;
  const formatName = namespace ? `[Gen 9] MythicMons Sandbox ${namespace}` : "[Gen 9] MythicMons Sandbox";
  const formatId = namespace ? toID(formatName) : FORMAT_ID;
  const abilities: Record<string, string> = {};
  const items: Record<string, string> = {};
  const pokedex: Record<string, string> = {};
  const moves: Record<string, string> = {};
  const syntheticAbilities: string[] = [];
  const syntheticItems: string[] = [];
  const syntheticSpecies: string[] = [];
  const customMoves: string[] = [];
  const warnings: string[] = [];

  for (const move of sandbox.customMoves ?? []) {
    const id = toID(move.id);
    moves[id] = move.entry ?? moveEntry(move);
    customMoves.push(id);
  }

  for (const ability of sandbox.customAbilities ?? []) {
    const id = toID(ability.id);
    abilities[id] = ability.entry ?? objectEntry({
      name: ability.name ?? titleFromId(id),
      shortDesc: ability.shortDesc ?? ability.desc ?? "Custom sandbox ability.",
      desc: ability.desc ?? ability.shortDesc ?? "Custom sandbox ability.",
    });
  }

  for (const item of sandbox.customItems ?? []) {
    const id = toID(item.id);
    items[id] = item.entry ?? objectEntry({
      name: item.name ?? titleFromId(id),
      shortDesc: item.shortDesc ?? item.desc ?? "Custom sandbox item.",
      desc: item.desc ?? item.shortDesc ?? "Custom sandbox item.",
    });
  }

  const team: PokemonSet[] = sandbox.members.map((member, index) => {
    const compiledAbility = compileAbility(member, abilityHash(member));
    if (compiledAbility.entry) {
      abilities[compiledAbility.id] = compiledAbility.entry;
      syntheticAbilities.push(compiledAbility.id);
    }

    const compiledItem = compileItem(member, itemHash(member));
    if (compiledItem.entry) {
      items[compiledItem.id] = compiledItem.entry;
      syntheticItems.push(compiledItem.id);
    }
    warnings.push(...compiledItem.warnings);

    const compiledSpecies = compileSpecies(member, speciesHash(member), compiledAbility.name);
    if (compiledSpecies.entry) {
      pokedex[compiledSpecies.id] = compiledSpecies.entry;
      syntheticSpecies.push(compiledSpecies.id);
    }

    return {
      name: member.nickname || member.species,
      species: compiledSpecies.name,
      item: compiledItem.name,
      ability: compiledAbility.name,
      moves: member.moves.map(move => typeof move === "string" ? move : move.id),
      nature: member.nature || "Serious",
      gender: member.gender || "",
      evs: normalizeStats(member.evs, 0),
      ivs: normalizeStats(member.ivs, 31),
      level: member.level || 100,
      teraType: member.teraType,
    };
  });

  const files = {
    "scripts.js": scriptsFile(),
    "typechart.js": typechartFile(),
    "abilities.js": tableFile("Abilities", abilities),
    "items.js": tableFile("Items", items),
    "pokedex.js": tableFile("Pokedex", pokedex),
    "moves.js": tableFile("Moves", moves),
    "custom-formats.js": customFormatsFile(modId, formatName),
  };
  validateGeneratedSyntax(files);

  return {
    formatId,
    modId,
    formatName,
    team,
    files,
    manifest: {
      syntheticAbilities: [...new Set(syntheticAbilities)],
      syntheticItems: [...new Set(syntheticItems)],
      syntheticSpecies: [...new Set(syntheticSpecies)],
      customAbilities: [...new Set((sandbox.customAbilities ?? []).map(effect => toID(effect.id)))],
      customItems: [...new Set((sandbox.customItems ?? []).map(effect => toID(effect.id)))],
      customMoves: [...new Set(customMoves)],
      warnings: [...new Set(warnings)],
    },
  };
}

function validateSandboxTeam(sandbox: SandboxTeam): void {
  if (!sandbox.name?.trim()) throw new Error("Sandbox team name is required");
  if (!Array.isArray(sandbox.members) || !sandbox.members.length) throw new Error("Sandbox team must contain at least one member");
  const customAbilities = new Set((sandbox.customAbilities ?? []).map(effect => toID(effect.id)));
  const customItems = new Set((sandbox.customItems ?? []).map(effect => toID(effect.id)));
  const customMoves = new Set((sandbox.customMoves ?? []).map(effect => toID(effect.id)));
  const memberIds = new Set<string>();

  for (const member of sandbox.members) {
    const memberId = toID(member.id);
    if (!memberId) throw new Error(`Sandbox member id is required for ${member.species || "unknown species"}`);
    if (memberIds.has(memberId)) throw new Error(`Duplicate sandbox member id: ${member.id}`);
    memberIds.add(memberId);
    if (!Dex.species.get(member.species).exists) throw new Error(`Unknown sandbox species: ${member.species}`);
    if (!member.moves?.length) throw new Error(`Sandbox member ${member.id} must have at least one move`);
    if (member.level !== undefined && (!Number.isInteger(member.level) || member.level < 1 || member.level > 9999)) {
      throw new Error(`Sandbox member ${member.id} has invalid level: ${member.level}`);
    }
    for (const type of member.types ?? []) {
      if (!Dex.types.get(type).exists) throw new Error(`Sandbox member ${member.id} has unknown type: ${type}`);
    }
    validateStats(member.id, "baseStats", member.baseStats, 1);
    validateStats(member.id, "evs", member.evs, 0);
    validateStats(member.id, "ivs", member.ivs, 0);
    for (const ability of member.abilities ?? []) {
      const id = toID(ability);
      if (id !== "noability" && !customAbilities.has(id) && !Dex.abilities.get(id).exists) {
        throw new Error(`Sandbox member ${member.id} has unknown ability: ${ability}`);
      }
    }
    for (const item of member.items ?? []) {
      const id = toID(item);
      if (!customItems.has(id) && !Dex.items.get(id).exists) throw new Error(`Sandbox member ${member.id} has unknown item: ${item}`);
    }
    for (const moveRef of member.moves) {
      const move = typeof moveRef === "string" ? moveRef : moveRef.id;
      const id = toID(move);
      if (!customMoves.has(id) && !Dex.moves.get(id).exists) throw new Error(`Sandbox member ${member.id} has unknown move: ${move}`);
    }
  }
}

function validateStats(memberId: string, label: string, stats: Partial<Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>> | undefined, minimum: number): void {
  for (const [stat, value] of Object.entries(stats ?? {})) {
    if (!Number.isFinite(value) || value < minimum) throw new Error(`Sandbox member ${memberId} has invalid ${label}.${stat}: ${value}`);
  }
}

function validateGeneratedSyntax(files: Record<string, string>): void {
  for (const [file, source] of Object.entries(files)) {
    try {
      void new Function("exports", "module", source);
    } catch (error) {
      throw new Error(`Generated ${file} is invalid JavaScript: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function exportCompiledTeam(compiled: CompiledSandbox): string {
  return Teams.export(compiled.team);
}

function compileSpecies(member: SandboxMember, hash: string, abilityName: string): {id: string; name: string; entry?: string} {
  const base = speciesBaseForMember(member);
  if (!member.baseStats && !member.types?.length) {
    return {id: toID(base.name || member.species), name: base.name || member.species};
  }

  const name = `Mythic ${base.name || member.species} ${hash}`;
  const id = toID(name);

  return {
    id,
    name,
    entry: objectEntry({
      num: -100000,
      name,
      baseSpecies: base.baseSpecies || base.name || member.species,
      forme: "Mythic",
      types: member.types ?? base.types,
      genderRatio: base.genderRatio,
      baseStats: member.baseStats ?? base.baseStats,
      abilities: {"0": abilityName},
      heightm: base.heightm || 1,
      weightkg: base.weightkg || 1,
      color: base.color || "White",
      nfe: base.nfe,
      prevo: base.prevo,
      evos: base.evos,
      eggGroups: base.eggGroups?.length ? base.eggGroups : ["Undiscovered"],
    }),
  };
}

function speciesBaseForMember(member: SandboxMember) {
  const species = Dex.species.get(member.species);
  const megaStoneId = defaultMegaStoneId(member);
  const megaStone = megaStoneId ? Dex.items.get(megaStoneId) : null;
  if (!megaStone?.megaStone) return species;

  const megaSpecies = Dex.species.get(megaStone.megaStone);
  return megaSpecies.exists ? megaSpecies : species;
}

function compileAbility(member: SandboxMember, hash: string): {id: string; name: string; entry?: string} {
  const abilities = canonicalEffectList(member.abilities);
  if (abilities.length <= 1) return {id: toID(abilities[0] || "noability"), name: abilities[0] || "No Ability"};

  const name = `Mythic Ability ${hash}`;
  const id = toID(name);
  const innates = abilities.map(toID);
  return {
    id,
    name,
    entry: `{
		name: ${js(name)},
		shortDesc: ${js(`Composite ability: ${abilities.join(" + ")}`)},
		mythicSourceAbilities: ${JSON.stringify(innates)},
		onStart(pokemon) {
			pokemon.m.innates = ${JSON.stringify(innates)};
			for (const innate of pokemon.m.innates) pokemon.addVolatile('ability:' + innate, pokemon);
			this.add('-ability', pokemon, ${js(name)});
		},
		onEnd(pokemon) {
			if (!pokemon.m.innates) return;
			for (const innate of pokemon.m.innates) pokemon.removeVolatile('ability:' + innate);
		},
	}`,
  };
}

function compileItem(member: SandboxMember, hash: string): {id: string; name: string; entry?: string; warnings: string[]} {
  const items = activeItemsForMember(member);
  if (items.length <= 1) return {id: toID(items[0] || ""), name: items[0] || "", warnings: []};

  const itemIds = items.map(toID);
  const name = `Mythic Item ${hash}`;
  const id = toID(name);
  return {
    id,
    name,
    warnings: compositeItemWarnings(name, itemIds),
	entry: `{
		name: ${js(name)},
		shortDesc: ${js(`Composite item: ${items.join(" + ")}`)},
		mythicSourceItems: ${JSON.stringify(itemIds)},
${delegatingTakeItemHook(itemIds)}
		isChoice: ${itemIds.some(itemId => Dex.items.get(itemId).isChoice) ? "true" : "false"},
		isBerry: ${itemIds.some(itemId => Dex.items.get(itemId).isBerry) ? "true" : "false"},
${delegatingItemHooks(itemIds)}
	}`,
  };
}

function delegatingItemHooks(itemIds: string[]): string {
  return COMPOSITE_ITEM_HOOKS.map(hook => `${delegatingItemHookMetadata(itemIds, hook)}		${hook}(...args) {
			let last;
			const holder = ${hook.startsWith("onSource")
    ? "args[2] && typeof args[2].mythicSourceItemIds === 'function' ? args[2] : undefined"
    : "args.find(arg => arg && typeof arg.mythicSourceItemIds === 'function') || (this.effectState?.target && typeof this.effectState.target.mythicSourceItemIds === 'function' ? this.effectState.target : undefined)"};
			const activeItemIds = holder ? holder.mythicSourceItemIds() : ${JSON.stringify(itemIds)};
			for (const itemId of activeItemIds) {
				const fn = this.dex.items.get(itemId).${hook};
				if (typeof fn === 'function') {
					if (holder) holder.m = holder.m || {};
					const previousSourceItem = holder?.m.mythicActiveSourceItem;
					const previousHeldItem = holder?.item;
					const previousItemState = holder?.itemState ? {...holder.itemState} : undefined;
					if (holder) holder.m.mythicActiveSourceItem = itemId;
					try {
						const result = fn.call(this, ...args);
						if (result !== undefined) last = result;
					} finally {
						if (holder && previousHeldItem && holder.item !== previousHeldItem) {
							holder.item = previousHeldItem;
							if (previousItemState) holder.itemState = previousItemState;
							holder.mythicConsumeSourceItem(itemId);
						}
						if (holder) holder.m.mythicActiveSourceItem = previousSourceItem;
					}
				}
			}
			return last;
		},`).join("\n");
}

function delegatingTakeItemHook(itemIds: string[]): string {
  return `		onTakeItem(...args) {
			for (const itemId of ${JSON.stringify(itemIds)}) {
				const sourceItem = this.dex.items.get(itemId);
				if (sourceItem.onTakeItem === false) return false;
				if (typeof sourceItem.onTakeItem === 'function' && sourceItem.onTakeItem.call(this, ...args) === false) return false;
			}
			return true;
		},`;
}

function compositeItemWarnings(compositeName: string, itemIds: string[]): string[] {
  const warnings: string[] = [];
  const unsupportedHooks = new Set<string>();
  const orderedHooks = new Set<string>();
  const sourceNames = itemIds.map(itemId => Dex.items.get(itemId).name || itemId).join(" + ");

  for (const itemId of itemIds) {
    const item = Dex.items.get(itemId) as unknown as Record<string, unknown>;
    for (const key of Object.keys(item)) {
      if (!key.startsWith("on") || key.endsWith("Priority") || key.endsWith("Order") || key.endsWith("SubOrder")) continue;
      if (key === "onTakeItem") continue;
      if (typeof item[key] === "function" && !COMPOSITE_ITEM_HOOKS.includes(key)) unsupportedHooks.add(`${itemId}.${key}`);
    }
  }

  for (const hook of COMPOSITE_ITEM_HOOKS) {
    const metadata = [`${hook}Priority`, `${hook}Order`, `${hook}SubOrder`];
    if (metadata.some(field => distinctNumericValues(itemIds, field).length > 1)) orderedHooks.add(hook);
  }

  if (unsupportedHooks.size) {
    warnings.push(`${compositeName} approximates ${sourceNames}; unsupported item hooks: ${[...unsupportedHooks].sort().join(", ")}`);
  }
  if (orderedHooks.size) {
    warnings.push(`${compositeName} approximates ${sourceNames}; multiple source items define different priority/order metadata for: ${[...orderedHooks].sort().join(", ")}`);
  }
  return warnings;
}

function distinctNumericValues(itemIds: string[], field: string): number[] {
  return [...new Set(itemIds
    .map(itemId => (Dex.items.get(itemId) as unknown as Record<string, unknown>)[field])
    .filter((value): value is number => typeof value === "number"))];
}

function delegatingItemHookMetadata(itemIds: string[], hook: string): string {
  const fields = [`${hook}Priority`, `${hook}Order`, `${hook}SubOrder`];
  return fields.map(field => {
    const values = itemIds
      .map(itemId => (Dex.items.get(itemId) as unknown as Record<string, unknown>)[field])
      .filter((value): value is number => typeof value === "number");
    if (!values.length) return "";
    return `		${field}: ${Math.max(...values)},\n`;
  }).join("");
}

function moveEntry(move: SandboxMove): string {
  return objectEntry({
    name: move.name ?? titleFromId(move.id),
    accuracy: move.accuracy ?? 100,
    basePower: move.basePower ?? 0,
    category: move.category,
    type: move.type,
    pp: move.pp ?? 10,
    priority: move.priority ?? 0,
    target: move.target ?? (move.category === "Status" ? "self" : "normal"),
    flags: move.flags ?? (move.category === "Status" ? {} : {protect: 1, mirror: 1}),
    shortDesc: "Custom sandbox move.",
  });
}

function scriptsFile(): string {
  return `"use strict";
exports.Scripts = {
	gen: 9,
	inherit: "gen9",
	checkEVBalance() {},
	field: {
		suppressingWeather() {
			for (const pokemon of this.battle.getAllActive()) {
				if (pokemon && !pokemon.fainted && !pokemon.ignoringAbility() &&
					(pokemon.getAbility().suppressWeather ||
						pokemon.m.innates?.some(k => this.battle.dex.abilities.get(k).suppressWeather))) {
					return true;
				}
			}
			return false;
		},
	},
	pokemon: {
		mythicSourceItemIds() {
			const item = this.getItem();
			const sourceItems = Array.isArray(item.mythicSourceItems) ? item.mythicSourceItems : [];
			const consumed = new Set(this.m.mythicConsumedItems || []);
			return sourceItems.filter(itemId => !consumed.has(itemId));
		},
		mythicConsumeSourceItem(itemId) {
			this.m.mythicConsumedItems = this.m.mythicConsumedItems || [];
			if (!this.m.mythicConsumedItems.includes(itemId)) this.m.mythicConsumedItems.push(itemId);
		},
		ignoringAbility() {
			let neutralizinggas = false;
			for (const pokemon of this.battle.getAllActive()) {
				if ((pokemon.ability === 'neutralizinggas' || pokemon.m.innates?.some(k => k === 'neutralizinggas')) &&
					!pokemon.volatiles['gastroacid'] && !pokemon.abilityState.ending) {
					neutralizinggas = true;
					break;
				}
			}
			const hasNeutralizingGas = this.ability === 'neutralizinggas' ||
				!!this.m.innates?.includes('neutralizinggas');
			return !!((this.battle.gen >= 5 && !this.isActive) ||
				((this.volatiles['gastroacid'] ||
					(neutralizinggas && !hasNeutralizingGas)) &&
					!this.getAbility().flags['cantsuppress']));
		},
		hasAbility(ability) {
			if (this.ignoringAbility()) return false;
			if (Array.isArray(ability)) return ability.some(abil => this.hasAbility(abil));
			ability = this.battle.toID(ability);
			return this.ability === ability || !!this.volatiles['ability:' + ability] || !!this.m.innates?.includes(ability);
		},
		hasItem(item) {
			if (this.ignoringItem()) return false;
			const itemIds = Array.isArray(item) ? item.map(k => this.battle.toID(k)) : [this.battle.toID(item)];
			if (itemIds.includes(this.item)) return true;
			return this.mythicSourceItemIds().some(itemId => itemIds.includes(itemId));
		},
		eatItem(force, source, sourceEffect) {
			if (!this.item || this.itemState.knockedOff) return false;
			if ((!this.hp && this.item !== 'jabocaberry' && this.item !== 'rowapberry') || !this.isActive) return false;

			if (!sourceEffect && this.battle.effect) sourceEffect = this.battle.effect;
			if (!source && this.battle.event?.target) source = this.battle.event.target;

			const sourceItems = this.mythicSourceItemIds().map(itemId => this.battle.dex.items.get(itemId));
			const requestedItemId = this.m.mythicActiveSourceItem ||
				(sourceEffect?.effectType === 'Item' ? sourceEffect.id : '');
			const compositeBerry = sourceItems.find(item => item.isBerry && item.id === requestedItemId) ||
				sourceItems.find(item => item.isBerry);
			const item = compositeBerry || this.getItem();
			if (sourceEffect?.effectType === 'Item' && source === this &&
				sourceEffect.id !== this.item && sourceEffect.id !== item.id) {
				return false;
			}
			if (
				this.battle.runEvent('UseItem', this, null, null, item) &&
				(force || this.battle.runEvent('TryEatItem', this, null, null, item))
			) {
				this.battle.add('-enditem', this, item, '[eat]');
				this.battle.singleEvent('Eat', item, this.itemState, this, source, sourceEffect);
				this.battle.runEvent('EatItem', this, null, null, item);

				this.lastItem = item.id;
				if (compositeBerry) {
					this.mythicConsumeSourceItem(item.id);
				} else {
					this.item = '';
					this.battle.clearEffectState(this.itemState);
				}
				this.usedItemThisTurn = true;
				this.ateBerry = true;
				this.battle.runEvent('AfterUseItem', this, null, null, item);
				return true;
			}
			return false;
		},
		useItem(source, sourceEffect) {
			if ((!this.hp && !this.getItem().isGem) || !this.isActive) return false;
			if (!this.item || this.itemState.knockedOff) return false;
			if (!sourceEffect && this.battle.effect) sourceEffect = this.battle.effect;
			if (!source && this.battle.event?.target) source = this.battle.event.target;

			const sourceItems = this.mythicSourceItemIds().map(itemId => this.battle.dex.items.get(itemId));
			const requestedItemId = this.m.mythicActiveSourceItem ||
				(sourceEffect?.effectType === 'Item' ? sourceEffect.id : '');
			const compositeItem = sourceItems.find(item => item.id === requestedItemId);
			const item = compositeItem || this.getItem();
			if (sourceEffect?.effectType === 'Item' && source === this &&
				sourceEffect.id !== this.item && sourceEffect.id !== item.id) {
				return false;
			}

			if (this.battle.runEvent('UseItem', this, null, null, item)) {
				if (item.id === 'redcard') {
					this.battle.add('-enditem', this, item, '[of] ' + source);
				} else if (item.isGem) {
					this.battle.add('-enditem', this, item, '[from] gem');
				} else {
					this.battle.add('-enditem', this, item);
				}
				if (item.boosts) this.battle.boost(item.boosts, this, source, item);
				this.battle.singleEvent('Use', item, this.itemState, this, source, sourceEffect);
				this.lastItem = item.id;
				if (compositeItem) {
					this.mythicConsumeSourceItem(item.id);
				} else {
					this.item = '';
					this.battle.clearEffectState(this.itemState);
				}
				this.usedItemThisTurn = true;
				this.battle.runEvent('AfterUseItem', this, null, null, item);
				return true;
			}
			return false;
		},
	},
};
`;
}

function typechartFile(): string {
  return `"use strict";
exports.TypeChart = {};
`;
}

function customFormatsFile(modId: string, formatName: string): string {
  return `"use strict";
exports.Formats = [
	{
		name: ${JSON.stringify(formatName)},
		mod: ${JSON.stringify(modId)},
		searchShow: false,
		debug: true,
		battle: { trunc: Math.trunc },
		ruleset: ["Team Preview", "Cancel Mod", "Max Team Size = 24", "Max Move Count = 24", "Max Level = 9999", "Default Level = 100"],
	},
];
`;
}

function tableFile(name: string, entries: Record<string, string>): string {
  const body = Object.entries(entries)
    .map(([id, entry]) => `	${id}: ${entry},`)
    .join("\n");
  return `"use strict";
exports.${name} = {
${body}
};
`;
}

function objectEntry(value: unknown): string {
  return JSON.stringify(value, null, "\t").replace(/"([^"]+)":/g, "$1:");
}

function normalizeStats(stats: Partial<Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>> | undefined, fallback: number) {
  return {
    hp: stats?.hp ?? fallback,
    atk: stats?.atk ?? fallback,
    def: stats?.def ?? fallback,
    spa: stats?.spa ?? fallback,
    spd: stats?.spd ?? fallback,
    spe: stats?.spe ?? fallback,
  };
}

function cleanList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).filter(Boolean))];
}

function canonicalEffectList(values: string[] | undefined): string[] {
  return cleanList(values).sort((left, right) => toID(left).localeCompare(toID(right)));
}

function activeItemsForMember(member: SandboxMember): string[] {
  const consumedMegaStone = defaultMegaStoneId(member);
  return canonicalEffectList(member.items).filter(item => toID(item) !== consumedMegaStone);
}

function defaultMegaStoneId(member: SandboxMember): string | null {
  const species = Dex.species.get(member.species);
  const stone = canonicalEffectList(member.items)
    .map(item => Dex.items.get(item))
    .find(item => item.megaStone && toID(item.megaEvolves || "") === toID(species.baseSpecies || species.name || member.species));
  return stone?.id ?? null;
}

function speciesHash(member: SandboxMember): string {
  return stableHash({
    species: member.species,
    types: member.types,
    baseStats: member.baseStats,
  });
}

function abilityHash(member: SandboxMember): string {
  return stableHash({
    abilities: canonicalEffectList(member.abilities).map(toID),
  });
}

function itemHash(member: SandboxMember): string {
  return stableHash({
    items: activeItemsForMember(member).map(toID),
  });
}

function stableHash(value: unknown): string {
  const payload = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 6);
}

function titleFromId(id: string): string {
  const effect = Dex.abilities.get(id);
  if (effect.exists) return effect.name;
  const item = Dex.items.get(id);
  if (item.exists) return item.name;
  const move = Dex.moves.get(id);
  if (move.exists) return move.name;
  return id.split(/[-_\s]+/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(" ");
}

function js(value: string): string {
  return JSON.stringify(value);
}
