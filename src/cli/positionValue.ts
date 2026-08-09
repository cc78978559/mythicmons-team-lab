import fs from "node:fs";
import path from "node:path";
import {buildPositionValueModel, doctorPositionValue, predictPairedPositionValue, type PositionValueModel} from "../ai/positionValue";
import type {PositionSnapshot} from "../showdown/choice";

const args = process.argv.slice(2), command = args[0] && !args[0].startsWith("--") ? args[0] : "status", out = path.resolve(option("--out", "output/tooling/position-value-stage2"));
if (command === "build") console.log(JSON.stringify(buildPositionValueModel(path.resolve(option("--source", "output/tooling/position-value-corpus-v1")), out), null, 2));
else if (command === "doctor") { const result = doctorPositionValue(out, args.includes("--verify-sources")); console.log(JSON.stringify(result, null, 2)); if (result.healthy === false) process.exitCode = 2; }
else if (command === "status") printOptional(path.join(out, "summary.json"));
else if (command === "estimate") { const snapshot = JSON.parse(fs.readFileSync(path.resolve(required("--snapshot")), "utf8")) as PositionSnapshot, opponent = JSON.parse(fs.readFileSync(path.resolve(required("--opponent-snapshot")), "utf8")) as PositionSnapshot, model = JSON.parse(fs.readFileSync(path.join(out, "model.json"), "utf8")) as PositionValueModel; console.log(JSON.stringify({winProbability: predictPairedPositionValue(snapshot, opponent, model), modelSha256: model.sha256, pairing: "same-battle-same-turn"}, null, 2)); }
else throw new Error("Usage: npm run position-value -- <build|status|doctor|estimate> [options]");
function option(name: string, fallback: string): string { const index = args.indexOf(name); return index >= 0 ? args[index + 1] ?? fallback : fallback; }
function required(name: string): string { const value = option(name, ""); if (!value) throw new Error(`${name} is required`); return value; }
function printOptional(file: string): void { if (!fs.existsSync(file)) { console.log(JSON.stringify({available: false, outputDirectory: out}, null, 2)); return; } console.log(fs.readFileSync(file, "utf8")); }
