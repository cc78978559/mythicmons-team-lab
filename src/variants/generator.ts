import {Dex, toID} from "pokemon-showdown";
import type {PokemonSet} from "pokemon-showdown/dist/sim/teams";
import type {SandboxTeam} from "../sandbox/types";
import type {SandboxTeamVariant, TeamVariant, VariantKind} from "./types";

const ITEM_CANDIDATES = [
  "Leftovers",
  "Heavy-Duty Boots",
  "Choice Scarf",
  "Choice Specs",
  "Choice Band",
  "Life Orb",
  "Focus Sash",
  "Air Balloon",
  "Booster Energy",
  "Rocky Helmet",
  "Assault Vest",
  "Black Glasses",
];

const MOVE_CANDIDATES = [
  "Protect",
  "Substitute",
  "Encore",
  "Taunt",
  "Knock Off",
  "U-turn",
  "Volt Switch",
  "Earthquake",
  "Thunderbolt",
  "Ice Beam",
  "Flamethrower",
  "Shadow Ball",
  "Moonblast",
  "Close Combat",
  "Stealth Rock",
  "Spikes",
  "Rapid Spin",
  "Recover",
  "Swords Dance",
  "Nasty Plot",
];

const EV_SPREADS: Array<{name: string; evs: PokemonSet["evs"]}> = [
  {name: "max Atk / max Spe", evs: {hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252}},
  {name: "max SpA / max Spe", evs: {hp: 4, atk: 0, def: 0, spa: 252, spd: 0, spe: 252}},
  {name: "physically bulky", evs: {hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0}},
  {name: "specially bulky", evs: {hp: 252, atk: 0, def: 4, spa: 0, spd: 252, spe: 0}},
];

export interface GenerateVariantOptions {
  kinds: VariantKind[];
  maxVariants: number;
}

export function generateVariants(team: PokemonSet[], options: GenerateVariantOptions): TeamVariant[] {
  const variants: TeamVariant[] = [];

  for (let memberIndex = 0; memberIndex < team.length; memberIndex += 1) {
    const set = team[memberIndex];
    if (!set) continue;
    const memberName = displayName(set);

    if (options.kinds.includes("item")) {
      for (const item of ITEM_CANDIDATES) {
        if (sameId(set.item, item)) continue;
        variants.push(makeVariant(team, memberIndex, "item", `${memberName}: item ${set.item || "(none)"} -> ${item}`, draft => {
          draft[memberIndex].item = item;
        }));
      }
    }

    if (options.kinds.includes("ability")) {
      const species = Dex.species.get(set.species || set.name);
      for (const ability of Object.values(species.abilities)) {
        if (!ability || sameId(set.ability, ability)) continue;
        variants.push(makeVariant(team, memberIndex, "ability", `${memberName}: ability ${set.ability || "(none)"} -> ${ability}`, draft => {
          draft[memberIndex].ability = ability;
        }));
      }
    }

    if (options.kinds.includes("move")) {
      for (let moveIndex = 0; moveIndex < set.moves.length; moveIndex += 1) {
        for (const move of MOVE_CANDIDATES) {
          if (set.moves.some(existing => sameId(existing, move))) continue;
          const oldMove = set.moves[moveIndex];
          variants.push(makeVariant(team, memberIndex, "move", `${memberName}: move ${oldMove} -> ${move}`, draft => {
            draft[memberIndex].moves[moveIndex] = move;
          }));
        }
      }
    }

    if (options.kinds.includes("evs")) {
      for (const spread of EV_SPREADS) {
        if (sameEvs(set.evs, spread.evs)) continue;
        variants.push(makeVariant(team, memberIndex, "evs", `${memberName}: EVs -> ${spread.name}`, draft => {
          draft[memberIndex].evs = {...spread.evs};
        }));
      }
    }
  }

  return dedupeVariants(variants).slice(0, options.maxVariants);
}

export function generateSandboxVariants(sandbox: SandboxTeam, options: GenerateVariantOptions): SandboxTeamVariant[] {
  const variants: SandboxTeamVariant[] = [];

  for (let memberIndex = 0; memberIndex < sandbox.members.length; memberIndex += 1) {
    const member = sandbox.members[memberIndex];
    const memberName = member.nickname || member.species;

    if (options.kinds.includes("item")) {
      const currentItems = member.items ?? [];
      for (let itemIndex = 0; itemIndex < Math.max(1, currentItems.length); itemIndex += 1) {
        for (const item of ITEM_CANDIDATES) {
          if (currentItems.some(existing => sameId(existing, item))) continue;
          const previous = currentItems[itemIndex] || "(none)";
          variants.push(makeSandboxVariant(sandbox, memberIndex, "item", `${memberName}: item slot ${itemIndex + 1} ${previous} -> ${item}`, draft => {
            const items = [...(draft.members[memberIndex].items ?? [])];
            if (itemIndex < items.length) items[itemIndex] = item;
            else items.push(item);
            draft.members[memberIndex].items = items;
          }));
        }
      }
    }

    if (options.kinds.includes("ability")) {
      const currentAbilities = member.abilities ?? [];
      const species = Dex.species.get(member.species);
      const candidates = [...new Set(Object.values(species.abilities).filter(Boolean))];
      for (let abilityIndex = 0; abilityIndex < Math.max(1, currentAbilities.length); abilityIndex += 1) {
        for (const ability of candidates) {
          if (currentAbilities.some(existing => sameId(existing, ability))) continue;
          const previous = currentAbilities[abilityIndex] || "(none)";
          variants.push(makeSandboxVariant(sandbox, memberIndex, "ability", `${memberName}: ability slot ${abilityIndex + 1} ${previous} -> ${ability}`, draft => {
            const abilities = [...(draft.members[memberIndex].abilities ?? [])];
            if (abilityIndex < abilities.length) abilities[abilityIndex] = ability;
            else abilities.push(ability);
            draft.members[memberIndex].abilities = abilities;
          }));
        }
      }
    }

    if (options.kinds.includes("move")) {
      for (let moveIndex = 0; moveIndex < member.moves.length; moveIndex += 1) {
        for (const move of MOVE_CANDIDATES) {
          if (member.moves.some(existing => sameId(typeof existing === "string" ? existing : existing.id, move))) continue;
          const previousRef = member.moves[moveIndex];
          const previous = typeof previousRef === "string" ? previousRef : previousRef.id;
          variants.push(makeSandboxVariant(sandbox, memberIndex, "move", `${memberName}: move ${previous} -> ${move}`, draft => {
            draft.members[memberIndex].moves[moveIndex] = move;
          }));
        }
      }
    }

    if (options.kinds.includes("evs")) {
      for (const spread of EV_SPREADS) {
        if (sameEvs(member.evs, spread.evs)) continue;
        variants.push(makeSandboxVariant(sandbox, memberIndex, "evs", `${memberName}: EVs -> ${spread.name}`, draft => {
          draft.members[memberIndex].evs = {...spread.evs};
        }));
      }
    }
  }

  return dedupeSandboxVariants(variants).slice(0, options.maxVariants);
}

function makeSandboxVariant(
  sandbox: SandboxTeam,
  memberIndex: number,
  kind: VariantKind,
  description: string,
  mutate: (sandbox: SandboxTeam) => void,
): SandboxTeamVariant {
  const draft = JSON.parse(JSON.stringify(sandbox)) as SandboxTeam;
  mutate(draft);
  return {
    id: `${kind}-${memberIndex + 1}-${toID(description).slice(0, 60)}`,
    kind,
    memberIndex,
    memberName: sandbox.members[memberIndex].nickname || sandbox.members[memberIndex].species,
    description,
    sandbox: draft,
  };
}

function dedupeSandboxVariants(variants: SandboxTeamVariant[]): SandboxTeamVariant[] {
  const seen = new Set<string>();
  return variants.filter(variant => {
    const serialized = JSON.stringify(variant.sandbox);
    if (seen.has(serialized)) return false;
    seen.add(serialized);
    return true;
  });
}

function makeVariant(
  team: PokemonSet[],
  memberIndex: number,
  kind: VariantKind,
  description: string,
  mutate: (team: PokemonSet[]) => void,
): TeamVariant {
  const draft = cloneTeam(team);
  mutate(draft);
  const memberName = displayName(team[memberIndex]);
  return {
    id: `${kind}-${memberIndex + 1}-${toID(description).slice(0, 60)}`,
    kind,
    memberIndex,
    memberName,
    description,
    team: draft,
  };
}

function cloneTeam(team: PokemonSet[]): PokemonSet[] {
  return JSON.parse(JSON.stringify(team)) as PokemonSet[];
}

function displayName(set: PokemonSet): string {
  return set.name || set.species || "Unknown";
}

function sameId(a = "", b = ""): boolean {
  return toID(a) === toID(b);
}

function sameEvs(a: PokemonSet["evs"], b: PokemonSet["evs"]): boolean {
  return (["hp", "atk", "def", "spa", "spd", "spe"] as const).every(stat => (a?.[stat] ?? 0) === (b?.[stat] ?? 0));
}

function dedupeVariants(variants: TeamVariant[]): TeamVariant[] {
  const seen = new Set<string>();
  const out: TeamVariant[] = [];
  for (const variant of variants) {
    const packed = JSON.stringify(variant.team);
    if (seen.has(packed)) continue;
    seen.add(packed);
    out.push(variant);
  }
  return out;
}
