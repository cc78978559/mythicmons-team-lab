import path from "node:path";
import {doctorRelationalTooling} from "../ai/relationalDoctor";

const args = process.argv.slice(2), command = args[0] && !args[0].startsWith("--") ? args[0] : "status", root = path.resolve(option("--root", "output/tooling"));
if (command !== "status" && command !== "doctor") throw new Error("Usage: npm run relational-ai -- <status|doctor> [--root output/tooling] [--verify-corpus]");
const result = doctorRelationalTooling(root, args.includes("--verify-corpus")); console.log(JSON.stringify(result, null, 2)); if (command === "doctor" && !result.healthy) process.exitCode = 2;
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
