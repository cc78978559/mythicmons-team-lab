import path from "node:path";
import {compactLineupCounterfactual} from "../ai/whiteBox/counterfactualCapsule";

const args = process.argv.slice(2), directory = path.resolve(required("--input"));
const result = compactLineupCounterfactual(directory);
console.log(JSON.stringify({...result, reductionRate: result.beforeBytes ? Math.round(result.removedBytes / result.beforeBytes * 1e6) / 1e6 : 0}, null, 2));
function required(name: string): string { const index = args.indexOf(name), value = index >= 0 ? args[index + 1] : ""; if (!value) throw new Error(`Missing ${name}`); return value; }
