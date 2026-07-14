import {allocateBulkStatPoints} from "../draft/bulkStatAllocator";

const args = parseArgs(process.argv.slice(2));
const result = allocateBulkStatPoints({
  baseStats: {hp: required(args, "hp"), def: required(args, "def"), spd: required(args, "spd")},
  points: required(args, "points"),
  level: optional(args, "level"),
  iv: optional(args, "iv"),
  ev: optional(args, "ev"),
  defenseNature: optional(args, "def-nature"),
  specialDefenseNature: optional(args, "spd-nature"),
  defenseMultiplier: optional(args, "def-mult"),
  specialDefenseMultiplier: optional(args, "spd-mult"),
});

console.log(JSON.stringify(result, null, 2));

function parseArgs(tokens: string[]): Map<string, number> {
  const parsed = new Map<string, number>();
  for (let index = 0; index < tokens.length; index += 2) {
    const key = tokens[index];
    const rawValue = tokens[index + 1];
    if (!key?.startsWith("--") || rawValue === undefined) {
      throw new Error("Arguments must be supplied as --name value pairs");
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value)) throw new Error(`Invalid numeric value for ${key}: ${rawValue}`);
    parsed.set(key.slice(2), value);
  }
  return parsed;
}

function required(args: Map<string, number>, name: string): number {
  const value = args.get(name);
  if (value === undefined) throw new Error(`Missing required argument --${name}`);
  return value;
}

function optional(args: Map<string, number>, name: string): number | undefined {
  return args.get(name);
}
