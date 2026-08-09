import {Dex, toID} from "pokemon-showdown";

export type BattleActionFamily = "switch" | "removal" | "hazard" | "pivot" | "recovery" | "setup" | "priority" | "status" | "physical-attack" | "special-attack" | "unknown-move";

export function battleActionFamily(choice: string): BattleActionFamily {
  if (choice.startsWith("switch ")) return "switch";
  const id = toID(choice.match(/^move\s+([^\s]+)/)?.[1] ?? ""), move = Dex.moves.get(id);
  if (!move.exists) return "unknown-move";
  if (["rapidspin", "defog", "mortalspin", "tidyup", "courtchange"].includes(id)) return "removal";
  if (["stealthrock", "spikes", "toxicspikes", "stickyweb", "stoneaxe", "ceaselessedge"].includes(id)) return "hazard";
  if (["uturn", "voltswitch", "flipturn", "partingshot", "chillyreception", "batonpass", "teleport"].includes(id)) return "pivot";
  if ((move as any).heal || ["recover", "roost", "slackoff", "softboiled", "synthesis", "moonlight", "morningsun", "wish", "shoreup", "strengthsap"].includes(id)) return "recovery";
  if (move.category === "Status" && ((move.boosts && Object.values(move.boosts).some(value => Number(value) > 0)) || (move.self?.boosts && Object.values(move.self.boosts).some(value => Number(value) > 0)))) return "setup";
  if (move.priority > 0) return "priority";
  if (move.category === "Status") return "status";
  return move.category === "Physical" ? "physical-attack" : "special-attack";
}
