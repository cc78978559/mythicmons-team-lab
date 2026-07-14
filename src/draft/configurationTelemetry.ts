import fs from "node:fs";

export interface MoveEvidence {uses: number; damageEvents: number; statusEvents: number; healEvents: number; boostEvents: number; kos: number}
export interface ItemEvidence {triggers: number; consumed: number}
export interface MemberConfigurationEvidence {moves: Record<string, MoveEvidence>; items: Record<string, ItemEvidence>}
export type SideConfigurationEvidence = Record<string, MemberConfigurationEvidence>;

export function analyzeConfigurationTelemetry(logPath: string): {p1: SideConfigurationEvidence; p2: SideConfigurationEvidence} {
  const result: {p1: SideConfigurationEvidence; p2: SideConfigurationEvidence} = {p1: {}, p2: {}};
  const lastMove: Partial<Record<"p1" | "p2", {member: string; move: string}>> = {};
  for (const line of fs.readFileSync(logPath, "utf8").split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const parts = line.split("|"), event = parts[1];
    if (event === "move") {
      const actor = ident(parts[2]);
      if (!actor) continue;
      const move = normalize(parts[3]);
      lastMove[actor.side] = {member: actor.name, move};
      moveEvidence(result[actor.side], actor.name, move).uses += 1;
      continue;
    }
    if (event === "-damage" || event === "-status" || event === "-heal" || event === "-boost" || event === "-unboost") {
      const target = ident(parts[2]);
      if (!target) continue;
      const itemSource = parts.find(part => /^\[from\] item:/i.test(part));
      if (itemSource) {
        itemEvidence(result[target.side], target.name, normalize(itemSource.replace(/^\[from\] item:\s*/i, ""))).triggers += 1;
        continue;
      }
      if (parts.some(part => /^\[from\] (ability|weather|psn|tox|brn|recoil|confusion)/i.test(part))) continue;
      const sourceSide = event === "-heal" || event === "-boost" ? target.side : opponent(target.side);
      const source = lastMove[sourceSide];
      if (!source) continue;
      const evidence = moveEvidence(result[sourceSide], source.member, source.move);
      if (event === "-damage") evidence.damageEvents += 1;
      else if (event === "-status") evidence.statusEvents += 1;
      else if (event === "-heal") evidence.healEvents += 1;
      else evidence.boostEvents += 1;
      continue;
    }
    if (event === "faint") {
      const target = ident(parts[2]);
      if (!target) continue;
      const source = lastMove[opponent(target.side)];
      if (source) moveEvidence(result[opponent(target.side)], source.member, source.move).kos += 1;
      continue;
    }
    if (event === "-activate" || event === "-enditem" || event === "-item") {
      const holder = ident(parts[2]);
      const itemPart = parts.find(part => /^(item: )/i.test(part)) ?? parts[3] ?? "";
      if (!holder || !/item/i.test(itemPart)) continue;
      const item = normalize(itemPart.replace(/^item:\s*/i, ""));
      const evidence = itemEvidence(result[holder.side], holder.name, item);
      evidence.triggers += 1;
      if (event === "-enditem") evidence.consumed += 1;
    }
  }
  return result;
}

export function emptyConfigurationEvidence(): MemberConfigurationEvidence { return {moves: {}, items: {}}; }

export function mergeConfigurationEvidence(target: MemberConfigurationEvidence, source: MemberConfigurationEvidence): void {
  for (const [id, value] of Object.entries(source.moves)) {
    const current = target.moves[id] ?? {uses: 0, damageEvents: 0, statusEvents: 0, healEvents: 0, boostEvents: 0, kos: 0};
    for (const key of Object.keys(current) as Array<keyof MoveEvidence>) current[key] += value[key];
    target.moves[id] = current;
  }
  for (const [id, value] of Object.entries(source.items)) {
    const current = target.items[id] ?? {triggers: 0, consumed: 0};
    current.triggers += value.triggers; current.consumed += value.consumed;
    target.items[id] = current;
  }
}

function memberEvidence(side: SideConfigurationEvidence, name: string): MemberConfigurationEvidence { return side[name] ??= emptyConfigurationEvidence(); }
function moveEvidence(side: SideConfigurationEvidence, name: string, move: string): MoveEvidence { return memberEvidence(side, name).moves[move] ??= {uses: 0, damageEvents: 0, statusEvents: 0, healEvents: 0, boostEvents: 0, kos: 0}; }
function itemEvidence(side: SideConfigurationEvidence, name: string, item: string): ItemEvidence { return memberEvidence(side, name).items[item] ??= {triggers: 0, consumed: 0}; }
function ident(raw = ""): {side: "p1" | "p2"; name: string} | null { const side = raw.startsWith("p1") ? "p1" : raw.startsWith("p2") ? "p2" : null; if (!side) return null; return {side, name: normalize(raw.includes(":") ? raw.split(":").slice(1).join(":") : raw)}; }
function normalize(value = ""): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function opponent(side: "p1" | "p2"): "p1" | "p2" { return side === "p1" ? "p2" : "p1"; }
